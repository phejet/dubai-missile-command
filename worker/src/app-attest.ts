import "reflect-metadata";
import { decodeCBOR, decodePartialCBOR, type CBORType } from "@levischuck/tiny-cbor";
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509Certificate,
  X509ChainBuilder,
} from "@peculiar/x509";
import { Constructed, fromBER, Integer, OctetString, Sequence } from "asn1js";
import { APPLE_APP_ATTEST_ROOT_CA_PEM } from "./apple-app-attest-root";

const APPLE_NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";
// Apple's current official fixture carries this App Attest credential purpose.
// Do not substitute the older .4.8 OID: that belongs to Safari extension signing.
const APPLE_APP_ATTEST_EKU_OID = "1.2.840.113635.100.4.24";
const DEVELOPMENT_AAGUID = new TextEncoder().encode("appattestdevelop");
const PRODUCTION_AAGUID = new Uint8Array([...new TextEncoder().encode("appattest"), 0, 0, 0, 0, 0, 0, 0]);

export type AppleAttestEnvironment = "development" | "production";

export interface VerifyAttestationOptions {
  attestationObject: Uint8Array;
  keyId: string;
  clientDataHash: Uint8Array;
  expectedAppId: string;
  allowedEnvironments: readonly AppleAttestEnvironment[];
  allowedBundleVersions?: ReadonlySet<string>;
  now?: Date;
}

export interface VerifiedAttestation {
  publicKeySpki: Uint8Array;
  publicKeyRaw: Uint8Array;
  appleEnvironment: AppleAttestEnvironment;
  assertionCounter: 0;
  validationCategory: number | null;
  bundleVersion: string | null;
}

export interface VerifyAssertionOptions {
  assertionObject: Uint8Array;
  clientDataHash: Uint8Array;
  publicKeySpki: Uint8Array;
  expectedAppId: string;
  previousCounter: number;
  allowedBundleVersions?: ReadonlySet<string>;
}

export interface VerifiedAssertion {
  counter: number;
  validationCategory: number | null;
  bundleVersion: string | null;
}

interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  counter: number;
  aaguid: Uint8Array | null;
  credentialId: Uint8Array | null;
  credentialPublicKey: Map<string | number, CBORType> | null;
  extensions: Map<string | number, CBORType> | null;
}

export class AppAttestVerificationError extends Error {
  constructor(readonly reason: string) {
    super("App Attest verification failed");
  }
}

function reject(reason: string): never {
  throw new AppAttestVerificationError(reason);
}

function asMap(value: CBORType, label: string): Map<string | number, CBORType> {
  if (!(value instanceof Map)) reject(`${label}:map`);
  return value;
}

function asBytes(value: CBORType | undefined, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) reject(`${label}:bytes`);
  return value;
}

function asString(value: CBORType | undefined, label: string): string {
  if (typeof value !== "string") reject(`${label}:string`);
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)));
}

function decodeStandardBase64(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) reject(`${label}:base64`);
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    reject(`${label}:base64`);
  }
}

function certificateValidAt(certificate: X509Certificate, now: Date): boolean {
  return certificate.notBefore.getTime() <= now.getTime() && certificate.notAfter.getTime() >= now.getTime();
}

function extractAppleNonce(certificate: X509Certificate): Uint8Array {
  const extension = certificate.getExtension(APPLE_NONCE_EXTENSION_OID);
  if (!extension) reject("attestation:nonce-extension-missing");
  const decoded = fromBER(extension.value);
  if (decoded.offset === -1 || !(decoded.result instanceof Sequence)) reject("attestation:nonce-extension-der");
  const sequence = decoded.result.valueBlock.value;
  const tagged = sequence[0];
  if (
    sequence.length !== 1 ||
    !(tagged instanceof Constructed) ||
    tagged.idBlock.tagClass !== 3 ||
    tagged.idBlock.tagNumber !== 1
  ) {
    reject("attestation:nonce-extension-shape");
  }
  const taggedValues = tagged.valueBlock.value;
  if (taggedValues.length !== 1 || !(taggedValues[0] instanceof OctetString)) {
    reject("attestation:nonce-extension-value");
  }
  return taggedValues[0].valueBlock.valueHexView;
}

function parseExtensions(bytes: Uint8Array, offset: number): { value: Map<string | number, CBORType>; read: number } {
  const [decoded, read] = decodePartialCBOR(bytes, offset);
  return { value: asMap(decoded, "authenticator:extensions"), read };
}

function parseAuthenticatorData(bytes: Uint8Array, requireAttestedCredential: boolean): ParsedAuthenticatorData {
  if (bytes.byteLength < 37) reject("authenticator:short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[32];
  let offset = 37;
  let aaguid: Uint8Array | null = null;
  let credentialId: Uint8Array | null = null;
  let credentialPublicKey: Map<string | number, CBORType> | null = null;

  if ((flags & 0x40) !== 0) {
    if (bytes.byteLength < offset + 18) reject("authenticator:credential-short");
    aaguid = bytes.slice(offset, offset + 16);
    offset += 16;
    const credentialLength = view.getUint16(offset);
    offset += 2;
    if (credentialLength !== 32 || bytes.byteLength < offset + credentialLength) {
      reject("authenticator:credential-id-length");
    }
    credentialId = bytes.slice(offset, offset + credentialLength);
    offset += credentialLength;
    const [decodedKey, keyBytes] = decodePartialCBOR(bytes, offset);
    credentialPublicKey = asMap(decodedKey, "authenticator:credential-key");
    offset += keyBytes;
  } else if (requireAttestedCredential) {
    reject("authenticator:credential-missing");
  }

  let extensions: Map<string | number, CBORType> | null = null;
  if (offset < bytes.byteLength) {
    const parsed = parseExtensions(bytes, offset);
    extensions = parsed.value;
    offset += parsed.read;
  }
  if (offset !== bytes.byteLength) reject("authenticator:trailing-bytes");

  return {
    rpIdHash: bytes.slice(0, 32),
    counter: view.getUint32(33),
    aaguid,
    credentialId,
    credentialPublicKey,
    extensions,
  };
}

function validationFacts(
  extensions: Map<string | number, CBORType> | null,
  allowedBundleVersions: ReadonlySet<string> | undefined,
): { validationCategory: number | null; bundleVersion: string | null } {
  const categoryValue = extensions?.get("apple_validation_category_01");
  let validationCategory: number | null = null;
  if (categoryValue !== undefined) {
    if (!(categoryValue instanceof Uint8Array) || categoryValue.byteLength !== 4) {
      reject("authenticator:validation-category-shape");
    }
    validationCategory = new DataView(
      categoryValue.buffer,
      categoryValue.byteOffset,
      categoryValue.byteLength,
    ).getUint32(0, true);
    if (validationCategory !== 1) reject("authenticator:validation-category");
  }

  const bundleValue = extensions?.get("apple_bundle_version_01");
  const bundleVersion = bundleValue === undefined ? null : asString(bundleValue, "authenticator:bundle-version");
  if (bundleVersion !== null && allowedBundleVersions !== undefined && !allowedBundleVersions.has(bundleVersion)) {
    reject("authenticator:bundle-version-mismatch");
  }
  return { validationCategory, bundleVersion };
}

function environmentForAaguid(aaguid: Uint8Array): AppleAttestEnvironment {
  if (equalBytes(aaguid, DEVELOPMENT_AAGUID)) return "development";
  if (equalBytes(aaguid, PRODUCTION_AAGUID)) return "production";
  reject("attestation:aaguid");
}

async function validateCertificateChain(
  leaf: X509Certificate,
  intermediate: X509Certificate,
  now: Date,
): Promise<void> {
  const root = new X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM);
  const chain = await new X509ChainBuilder({ certificates: [intermediate, root] }).build(leaf, crypto);
  if (chain.length !== 3 || !chain[2].equal(root)) reject("attestation:certificate-chain");
  if (![leaf, intermediate, root].every((certificate) => certificateValidAt(certificate, now))) {
    reject("attestation:certificate-validity");
  }
  if (!(await leaf.verify({ publicKey: intermediate.publicKey, date: now }, crypto))) {
    reject("attestation:leaf-signature");
  }
  if (!(await intermediate.verify({ publicKey: root.publicKey, date: now }, crypto))) {
    reject("attestation:intermediate-signature");
  }
  if (!(await root.isSelfSigned(crypto))) reject("attestation:root-signature");

  const leafConstraints = leaf.getExtension(BasicConstraintsExtension);
  const intermediateConstraints = intermediate.getExtension(BasicConstraintsExtension);
  const rootConstraints = root.getExtension(BasicConstraintsExtension);
  if (leafConstraints?.ca || !intermediateConstraints?.ca || !rootConstraints?.ca) {
    reject("attestation:basic-constraints");
  }
  const intermediateUsage = intermediate.getExtension(KeyUsagesExtension);
  const rootUsage = root.getExtension(KeyUsagesExtension);
  if (
    !intermediateUsage ||
    (intermediateUsage.usages & KeyUsageFlags.keyCertSign) === 0 ||
    !rootUsage ||
    (rootUsage.usages & KeyUsageFlags.keyCertSign) === 0
  ) {
    reject("attestation:ca-key-usage");
  }
  const leafUsage = leaf.getExtension(KeyUsagesExtension);
  if (!leafUsage || (leafUsage.usages & KeyUsageFlags.digitalSignature) === 0) {
    reject("attestation:leaf-key-usage");
  }
  const leafExtendedUsage = leaf.getExtension(ExtendedKeyUsageExtension);
  if (!leafExtendedUsage?.usages.includes(APPLE_APP_ATTEST_EKU_OID)) {
    reject("attestation:extended-key-usage");
  }
}

function rawCosePublicKey(cose: Map<string | number, CBORType>): Uint8Array {
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) reject("attestation:cose-algorithm");
  const x = asBytes(cose.get(-2), "attestation:cose-x");
  const y = asBytes(cose.get(-3), "attestation:cose-y");
  if (x.byteLength !== 32 || y.byteLength !== 32) reject("attestation:cose-coordinate-length");
  return concatBytes(new Uint8Array([4]), x, y);
}

async function verifyAppAttestAttestationCore(
  options: VerifyAttestationOptions,
  requireHashedClientData: boolean,
): Promise<VerifiedAttestation> {
  if (
    (requireHashedClientData && options.clientDataHash.byteLength !== 32) ||
    (!requireHashedClientData && options.clientDataHash.byteLength === 0)
  ) {
    reject("attestation:client-data-hash-length");
  }
  let decoded: CBORType;
  try {
    decoded = decodeCBOR(options.attestationObject);
  } catch {
    reject("attestation:cbor");
  }
  const object = asMap(decoded, "attestation");
  if (object.get("fmt") !== "apple-appattest") reject("attestation:format");
  const attestationStatement = asMap(object.get("attStmt"), "attestation:statement");
  const x5c = attestationStatement.get("x5c");
  if (!Array.isArray(x5c) || x5c.length !== 2) reject("attestation:x5c");
  const leafBytes = asBytes(x5c[0], "attestation:leaf");
  const intermediateBytes = asBytes(x5c[1], "attestation:intermediate");
  const authData = asBytes(object.get("authData"), "attestation:auth-data");
  const leaf = new X509Certificate(ownedArrayBuffer(leafBytes));
  const intermediate = new X509Certificate(ownedArrayBuffer(intermediateBytes));
  await validateCertificateChain(leaf, intermediate, options.now ?? new Date());

  const parsed = parseAuthenticatorData(authData, true);
  const expectedAppIdHash = await sha256(new TextEncoder().encode(options.expectedAppId));
  if (!equalBytes(parsed.rpIdHash, expectedAppIdHash)) reject("attestation:app-id");
  if (parsed.counter !== 0) reject("attestation:counter");
  const appleEnvironment = environmentForAaguid(parsed.aaguid!);
  if (!options.allowedEnvironments.includes(appleEnvironment)) reject("attestation:environment");

  const keyId = decodeStandardBase64(options.keyId, "attestation:key-id");
  if (!equalBytes(parsed.credentialId!, keyId)) reject("attestation:credential-id");
  const leafKey = await leaf.publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"], crypto);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", leafKey));
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", leafKey));
  if (!equalBytes(await sha256(publicKeyRaw), keyId)) reject("attestation:key-id-hash");
  if (!equalBytes(rawCosePublicKey(parsed.credentialPublicKey!), publicKeyRaw)) {
    reject("attestation:cose-public-key");
  }

  const nonce = await sha256(concatBytes(authData, options.clientDataHash));
  if (!equalBytes(extractAppleNonce(leaf), nonce)) reject("attestation:nonce");
  const facts = validationFacts(parsed.extensions, options.allowedBundleVersions);
  return { publicKeySpki, publicKeyRaw, appleEnvironment, assertionCounter: 0, ...facts };
}

export function verifyAppAttestAttestation(options: VerifyAttestationOptions): Promise<VerifiedAttestation> {
  return verifyAppAttestAttestationCore(options, true);
}

/** @internal Apple's published fixture signs its raw example challenge instead of a 32-byte hash. */
export function verifyApplePublishedAttestationFixture(
  options: VerifyAttestationOptions,
): Promise<VerifiedAttestation> {
  return verifyAppAttestAttestationCore(options, false);
}

function derEcdsaSignatureToRaw(signature: Uint8Array): Uint8Array {
  const decoded = fromBER(signature);
  if (decoded.offset === -1 || decoded.offset !== signature.byteLength || !(decoded.result instanceof Sequence)) {
    reject("assertion:signature-der");
  }
  const values = decoded.result.valueBlock.value;
  if (values.length !== 2 || !(values[0] instanceof Integer) || !(values[1] instanceof Integer)) {
    reject("assertion:signature-shape");
  }
  const component = (integer: Integer): Uint8Array => {
    let bytes = integer.valueBlock.valueHexView;
    if (bytes.byteLength === 33 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.byteLength > 32) reject("assertion:signature-component");
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.byteLength);
    return padded;
  };
  return concatBytes(component(values[0]), component(values[1]));
}

export async function verifyAppAttestAssertion(options: VerifyAssertionOptions): Promise<VerifiedAssertion> {
  if (options.clientDataHash.byteLength !== 32) reject("assertion:client-data-hash-length");
  let decoded: CBORType;
  try {
    decoded = decodeCBOR(options.assertionObject);
  } catch {
    reject("assertion:cbor");
  }
  const object = asMap(decoded, "assertion");
  const signature = asBytes(object.get("signature"), "assertion:signature");
  const authenticatorData = asBytes(object.get("authenticatorData"), "assertion:authenticator-data");
  const parsed = parseAuthenticatorData(authenticatorData, false);
  if (parsed.credentialId !== null) reject("assertion:unexpected-credential");
  const expectedAppIdHash = await sha256(new TextEncoder().encode(options.expectedAppId));
  if (!equalBytes(parsed.rpIdHash, expectedAppIdHash)) reject("assertion:app-id");
  if (parsed.counter <= options.previousCounter || parsed.counter === 0) reject("assertion:counter");

  const nonce = await sha256(concatBytes(authenticatorData, options.clientDataHash));
  const key = await crypto.subtle.importKey(
    "spki",
    ownedArrayBuffer(options.publicKeySpki),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    ownedArrayBuffer(derEcdsaSignatureToRaw(signature)),
    ownedArrayBuffer(nonce),
  );
  if (!valid) reject("assertion:signature");
  return { counter: parsed.counter, ...validationFacts(parsed.extensions, options.allowedBundleVersions) };
}
