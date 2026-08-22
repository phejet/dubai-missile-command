import { encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { describe, expect, it } from "vitest";
import {
  AppAttestVerificationError,
  verifyApplePublishedAttestationFixture,
  verifyAppAttestAssertion,
  verifyAppAttestAttestation,
} from "../src/app-attest";
import {
  APPLE_FIXTURE_APP_ID,
  APPLE_FIXTURE_ATTESTATION,
  APPLE_FIXTURE_BUNDLE_VERSION,
  APPLE_FIXTURE_CHALLENGE,
  APPLE_FIXTURE_KEY_ID,
  APPLE_FIXTURE_NOW,
} from "../test-fixtures/apple-app-attest";

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
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

function expectReason(error: unknown, reason: string): boolean {
  expect(error).toBeInstanceOf(AppAttestVerificationError);
  expect((error as AppAttestVerificationError).reason).toBe(reason);
  return true;
}

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const component = (bytes: Uint8Array): Uint8Array => {
    let first = 0;
    while (first < bytes.byteLength - 1 && bytes[first] === 0) first += 1;
    const trimmed = bytes.slice(first);
    return (trimmed[0] & 0x80) === 0 ? trimmed : concatBytes(new Uint8Array([0]), trimmed);
  };
  const r = component(raw.slice(0, 32));
  const s = component(raw.slice(32));
  return concatBytes(
    new Uint8Array([0x30, 4 + r.byteLength + s.byteLength, 0x02, r.byteLength]),
    r,
    new Uint8Array([0x02, s.byteLength]),
    s,
  );
}

async function assertionFixture(counter = 1): Promise<{
  assertionObject: Uint8Array;
  clientDataHash: Uint8Array;
  publicKeySpki: Uint8Array;
}> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rpIdHash = await sha256(new TextEncoder().encode(APPLE_FIXTURE_APP_ID));
  const counterBytes = new Uint8Array(4);
  new DataView(counterBytes.buffer).setUint32(0, counter);
  const extensions = encodeCBOR(
    new Map<string | number, CBORType>([
      ["apple_bundle_version_01", APPLE_FIXTURE_BUNDLE_VERSION],
      ["apple_validation_category_01", new Uint8Array([1, 0, 0, 0])],
    ]),
  );
  // Apple's assertion authenticator data is simplified: the AT bit may remain set,
  // but no attested-credential block follows it.
  const authenticatorData = concatBytes(rpIdHash, new Uint8Array([0x40]), counterBytes, extensions);
  const clientDataHash = await sha256(new TextEncoder().encode("exact-request-client-data"));
  const nonce = await sha256(concatBytes(authenticatorData, clientDataHash));
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, ownedArrayBuffer(nonce)),
  );
  return {
    assertionObject: encodeCBOR(
      new Map<string | number, CBORType>([
        ["signature", rawSignatureToDer(rawSignature)],
        ["authenticatorData", authenticatorData],
      ]),
    ),
    clientDataHash,
    publicKeySpki: new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

describe("Apple App Attest verification in workerd", () => {
  it("verifies Apple's official production attestation fixture against the pinned root", async () => {
    // Apple's current fixture was generated with the raw example challenge even
    // though its surrounding prose recommends hashing it first.
    const clientDataHash = new TextEncoder().encode(APPLE_FIXTURE_CHALLENGE);
    const result = await verifyApplePublishedAttestationFixture({
      attestationObject: fromBase64(APPLE_FIXTURE_ATTESTATION),
      keyId: APPLE_FIXTURE_KEY_ID,
      clientDataHash,
      expectedAppIds: new Set([APPLE_FIXTURE_APP_ID, "TEAM.com.example.staging"]),
      allowedBundleVersions: new Set([APPLE_FIXTURE_BUNDLE_VERSION]),
      allowedEnvironments: ["production"],
      now: APPLE_FIXTURE_NOW,
    });

    expect(result).toMatchObject({
      appId: APPLE_FIXTURE_APP_ID,
      appleEnvironment: "production",
      assertionCounter: 0,
      validationCategory: 1,
      bundleVersion: APPLE_FIXTURE_BUNDLE_VERSION,
    });
    expect(result.publicKeyRaw).toHaveLength(65);
    expect(result.publicKeySpki.byteLength).toBeGreaterThan(65);
  });

  it("rejects an attestation moved to another challenge, app, environment, or bundle", async () => {
    const attestationObject = fromBase64(APPLE_FIXTURE_ATTESTATION);
    const clientDataHash = new TextEncoder().encode(APPLE_FIXTURE_CHALLENGE);
    const common = {
      attestationObject,
      keyId: APPLE_FIXTURE_KEY_ID,
      clientDataHash,
      expectedAppIds: new Set([APPLE_FIXTURE_APP_ID]),
      allowedBundleVersions: new Set([APPLE_FIXTURE_BUNDLE_VERSION, "2"]),
      allowedEnvironments: ["production"] as const,
      now: APPLE_FIXTURE_NOW,
    };

    await expect(
      verifyApplePublishedAttestationFixture({ ...common, clientDataHash: await sha256(new Uint8Array([1])) }),
    ).rejects.toSatisfy((error) => expectReason(error, "attestation:nonce"));
    await expect(
      verifyApplePublishedAttestationFixture({
        ...common,
        expectedAppIds: new Set(["1234567890.com.attacker.app"]),
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "attestation:app-id"));
    await expect(
      verifyApplePublishedAttestationFixture({ ...common, allowedEnvironments: ["development"] }),
    ).rejects.toSatisfy((error) => expectReason(error, "attestation:environment"));
    await expect(
      verifyApplePublishedAttestationFixture({ ...common, allowedBundleVersions: new Set(["2", "3"]) }),
    ).rejects.toSatisfy((error) => expectReason(error, "authenticator:bundle-version-mismatch"));
  });

  it("requires an exact 32-byte client-data hash at the production verifier boundary", async () => {
    await expect(
      verifyAppAttestAttestation({
        attestationObject: fromBase64(APPLE_FIXTURE_ATTESTATION),
        keyId: APPLE_FIXTURE_KEY_ID,
        clientDataHash: new TextEncoder().encode(APPLE_FIXTURE_CHALLENGE),
        expectedAppIds: new Set([APPLE_FIXTURE_APP_ID]),
        allowedEnvironments: ["production"],
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "attestation:client-data-hash-length"));
  });

  it("verifies a DER assertion and rejects tampering, replay, and the wrong App ID", async () => {
    const fixture = await assertionFixture(18);
    await expect(
      verifyAppAttestAssertion({
        ...fixture,
        expectedAppIds: new Set([APPLE_FIXTURE_APP_ID, "TEAM.com.example.staging"]),
        allowedBundleVersions: new Set([APPLE_FIXTURE_BUNDLE_VERSION, "2"]),
        allowedValidationCategories: new Set([1, 3]),
        previousCounter: 17,
      }),
    ).resolves.toMatchObject({
      appId: APPLE_FIXTURE_APP_ID,
      counter: 18,
      validationCategory: 1,
      bundleVersion: APPLE_FIXTURE_BUNDLE_VERSION,
    });

    await expect(
      verifyAppAttestAssertion({
        ...fixture,
        expectedAppIds: new Set([APPLE_FIXTURE_APP_ID]),
        previousCounter: 17,
        allowedValidationCategories: new Set([3]),
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "authenticator:validation-category-mismatch"));

    await expect(
      verifyAppAttestAssertion({
        ...fixture,
        clientDataHash: await sha256(new Uint8Array([9])),
        expectedAppIds: new Set([APPLE_FIXTURE_APP_ID]),
        previousCounter: 17,
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "assertion:signature"));
    await expect(
      verifyAppAttestAssertion({
        ...fixture,
        expectedAppIds: new Set([APPLE_FIXTURE_APP_ID]),
        previousCounter: 18,
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "assertion:counter"));
    await expect(
      verifyAppAttestAssertion({
        ...fixture,
        expectedAppIds: new Set(["1234567890.com.attacker.app"]),
        previousCounter: 17,
      }),
    ).rejects.toSatisfy((error) => expectReason(error, "assertion:app-id"));
  });
});
