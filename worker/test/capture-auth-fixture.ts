import { encodeCBOR, type CBORType } from "@levischuck/tiny-cbor";
import { env, SELF } from "cloudflare:test";
import { captureClientData } from "../../src/capture-auth-protocol";
import { appAttestKeyIdHash } from "../src/capture-auth";

const APP_ID = "TESTTEAM1.com.phejet.dubaicmd.dev";
const BUILD_ID = "build+dirty";
const BUNDLE_VERSION = "1";
let challengeSequence = 0;

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

let activeCredential: Awaited<ReturnType<typeof createCredential>> | null = null;

async function createCredential(): Promise<{
  keyId: string;
  keyIdHash: string;
  keyPair: CryptoKeyPair;
  publicKeySpki: Uint8Array;
}> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const keyId = base64(await sha256(publicKeyRaw));
  return { keyId, keyIdHash: await appAttestKeyIdHash(keyId), keyPair, publicKeySpki };
}

function credential(): Awaited<ReturnType<typeof createCredential>> {
  if (!activeCredential) throw new Error("test credential not initialized");
  return activeCredential;
}

export async function resetTestCredential(): Promise<{ keyId: string; keyIdHash: string }> {
  await env.DB.prepare("DELETE FROM app_attest_credentials").run();
  return addTestCredential();
}

export async function addTestCredential(): Promise<{ keyId: string; keyIdHash: string }> {
  const value = await createCredential();
  activeCredential = value;
  await env.DB.prepare(
    `INSERT INTO app_attest_credentials (
      key_id_hash, public_key, apple_environment, apple_app_id, assertion_counter, status,
      created_at, last_seen_at, revoked_at
    ) VALUES (?, ?, 'development', ?, 0, 'active', 1, 1, NULL)`,
  )
    .bind(value.keyIdHash, ownedArrayBuffer(value.publicKeySpki), APP_ID)
    .run();
  return { keyId: value.keyId, keyIdHash: value.keyIdHash };
}

async function challenge(purpose: "session" | "report" | "share" | "feedback", keyId: string): Promise<string> {
  const response = await SELF.fetch("https://worker.test/api/auth/challenge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": `192.0.2.${++challengeSequence}`,
    },
    body: JSON.stringify({ purpose, keyId, buildId: BUILD_ID }),
  });
  if (!response.ok) throw new Error(`test challenge failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { challengeToken: string }).challengeToken;
}

async function assertion(token: string, bodySha256: string, counter: number): Promise<string> {
  const value = credential();
  const rpIdHash = await sha256(new TextEncoder().encode(APP_ID));
  const counterBytes = new Uint8Array(4);
  new DataView(counterBytes.buffer).setUint32(0, counter);
  const extensions = encodeCBOR(
    new Map<string | number, CBORType>([
      ["apple_bundle_version_01", BUNDLE_VERSION],
      ["apple_validation_category_01", new Uint8Array([1, 0, 0, 0])],
    ]),
  );
  const authenticatorData = concatBytes(rpIdHash, new Uint8Array([0]), counterBytes, extensions);
  const clientDataHash = await sha256(captureClientData(token, bodySha256));
  const nonce = await sha256(concatBytes(authenticatorData, clientDataHash));
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, value.keyPair.privateKey, ownedArrayBuffer(nonce)),
  );
  return base64Url(
    encodeCBOR(
      new Map<string | number, CBORType>([
        ["signature", rawSignatureToDer(rawSignature)],
        ["authenticatorData", authenticatorData],
      ]),
    ),
  );
}

export async function captureAuthHeaders(
  purpose: "session" | "report" | "share" | "feedback",
  bodySha256: string,
): Promise<Record<string, string>> {
  const value = credential();
  const token = await challenge(purpose, value.keyId);
  const row = await env.DB.prepare("SELECT assertion_counter FROM app_attest_credentials WHERE key_id_hash = ?")
    .bind(value.keyIdHash)
    .first<{ assertion_counter: number }>();
  if (!row) throw new Error("test credential missing");
  return {
    "x-dmc-challenge-token": token,
    "x-dmc-assertion": await assertion(token, bodySha256, row.assertion_counter + 1),
  };
}

export async function currentTestCredential(): Promise<{ keyId: string; keyIdHash: string }> {
  const value = credential();
  return { keyId: value.keyId, keyIdHash: value.keyIdHash };
}
