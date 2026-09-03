import { captureClientData, enrollmentClientData } from "../../src/capture-auth-protocol";
import { SHA256 } from "../../src/capture-contract";
import {
  AppAttestVerificationError,
  verifyAppAttestAssertion,
  verifyAppAttestAttestation,
  type AppleAttestEnvironment,
} from "./app-attest";
import type { D1Result, Env } from "./bindings";
import { deriveCaptureProvenance, type CaptureSubmissionProvenance } from "./capture-provenance";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 2 * 60 * 1_000;
const KEY_HASH_PREFIX = new TextEncoder().encode("DMC-APP-ATTEST-KEY-v1\0");
const MAX_AUTH_BODY_BYTES = 24 * 1_024;
const PURPOSES = new Set<ChallengePurpose>(["ios-enroll", "session", "report", "share", "feedback"]);

export type ChallengePurpose = "ios-enroll" | "session" | "report" | "share" | "feedback";

export interface CaptureAuthConfig {
  workerEnvironment: "dev" | "staging" | "production";
  authSecret: string;
  allowedBuilds: ReadonlySet<string>;
  appleTeamId: string;
  appIds: ReadonlySet<string>;
  allowedBundleVersions: ReadonlySet<string>;
  allowedValidationCategories: ReadonlySet<number>;
  allowedAppleEnvironments: readonly AppleAttestEnvironment[];
  enrollmentEnabled: boolean;
}

interface ChallengeClaims {
  version: 1;
  nonce: string;
  purpose: ChallengePurpose;
  keyIdHash: string;
  build: string;
  workerEnvironment: string;
  expiresAt: number;
  expectedCounter: number;
}

interface CredentialRow {
  key_id_hash: string;
  public_key: ArrayBuffer | Uint8Array;
  apple_environment: AppleAttestEnvironment;
  apple_app_id: string | null;
  assertion_counter: number;
  status: "active" | "revoked";
}

export interface AuthorizedCapture {
  keyIdHash: string;
  assertionCounter: number;
  provenance: CaptureSubmissionProvenance;
}

interface EnrollmentDeps {
  verifyAttestation?: typeof verifyAppAttestAttestation;
}

export class CaptureAuthorizationError extends Error {
  constructor(
    readonly reason: string,
    readonly status = 401,
  ) {
    super("Capture authorization failed");
  }
}

function reject(reason: string, status = 401): never {
  throw new CaptureAuthorizationError(reason, status);
}

async function asAuthorizationFailure<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppAttestVerificationError) reject(`${operation}:${error.reason}`);
    throw error;
  }
}

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

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string, label = "binary value"): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) reject(`${label}:base64url`, 400);
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(standard + "=".repeat((4 - (standard.length % 4)) % 4)), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    reject(`${label}:base64url`, 400);
  }
}

function fromKeyIdBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) reject("key-id:base64", 400);
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32) reject("key-id:length", 400);
    return bytes;
  } catch {
    reject("key-id:base64", 400);
  }
}

export async function appAttestKeyIdHash(keyId: string): Promise<string> {
  return toHex(await sha256(concatBytes(KEY_HASH_PREFIX, fromKeyIdBase64(keyId))));
}

function parseList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function parseValidationCategories(value: string | undefined): Set<number> {
  const documented = new Set([1, 2, 3, 4, 5, 6, 10]);
  const values = parseList(value);
  const parsed = new Set(values.map(Number));
  if (
    values.length === 0 ||
    parsed.size !== values.length ||
    values.some((value) => !/^(?:[1-6]|10)$/.test(value)) ||
    [...parsed].some((value) => !documented.has(value))
  ) {
    reject("config:apple-validation-categories", 503);
  }
  return parsed;
}

export function captureAuthConfig(env: Env): CaptureAuthConfig {
  const workerEnvironment = env.WORKER_BUILD;
  if (workerEnvironment !== "dev" && workerEnvironment !== "staging" && workerEnvironment !== "production") {
    reject("config:worker-environment", 503);
  }
  if (!env.CAPTURE_AUTH_SECRET || new TextEncoder().encode(env.CAPTURE_AUTH_SECRET).byteLength < 32) {
    reject("config:auth-secret", 503);
  }
  const allowedBuilds = new Set(parseList(env.ALLOWED_BUILDS));
  if (allowedBuilds.size === 0) reject("config:allowed-builds", 503);
  const allowedBundleVersions = new Set(parseList(env.APPLE_BUNDLE_VERSIONS));
  const allowedValidationCategories = parseValidationCategories(env.APPLE_VALIDATION_CATEGORIES);
  const appleTeamId = env.APPLE_TEAM_ID?.trim() ?? "";
  const appleBundleIds = parseList(env.APPLE_BUNDLE_IDS);
  if (
    !appleTeamId ||
    appleBundleIds.length === 0 ||
    appleBundleIds.some((bundleId) => !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) ||
    allowedBundleVersions.size === 0
  ) {
    reject("config:apple-app", 503);
  }
  if (
    workerEnvironment === "production" &&
    (appleBundleIds.length !== 1 || appleBundleIds[0] !== "com.phejet.dubaicmd")
  ) {
    reject("config:production-apple-bundle-id", 503);
  }
  const allowedAppleEnvironments = parseList(env.APPLE_ATTEST_ENVIRONMENTS);
  if (
    allowedAppleEnvironments.length === 0 ||
    allowedAppleEnvironments.some((value) => value !== "development" && value !== "production")
  ) {
    reject("config:apple-environments", 503);
  }
  if (workerEnvironment === "production" && allowedAppleEnvironments.some((value) => value !== "production")) {
    reject("config:production-apple-environment", 503);
  }
  if (env.ENROLLMENT_ENABLED !== "true" && env.ENROLLMENT_ENABLED !== "false") {
    reject("config:enrollment-switch", 503);
  }
  return {
    workerEnvironment,
    authSecret: env.CAPTURE_AUTH_SECRET,
    allowedBuilds,
    appleTeamId,
    appIds: new Set(appleBundleIds.map((bundleId) => `${appleTeamId}.${bundleId}`)),
    allowedBundleVersions,
    allowedValidationCategories,
    allowedAppleEnvironments: allowedAppleEnvironments as AppleAttestEnvironment[],
    enrollmentEnabled: env.ENROLLMENT_ENABLED === "true",
  };
}

export function requireAllowedBuild(build: string, config: CaptureAuthConfig): void {
  if (!config.allowedBuilds.has(build)) reject("build:not-allowed", 400);
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function claimsArray(claims: ChallengeClaims): [number, string, string, string, string, string, number, number] {
  return [
    claims.version,
    claims.nonce,
    claims.purpose,
    claims.keyIdHash,
    claims.build,
    claims.workerEnvironment,
    claims.expiresAt,
    claims.expectedCounter,
  ];
}

async function issueChallengeToken(
  input: Omit<ChallengeClaims, "version" | "nonce" | "expiresAt">,
  secret: string,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  const claims: ChallengeClaims = {
    version: TOKEN_VERSION,
    nonce: toBase64Url(nonce),
    expiresAt: now + TOKEN_TTL_MS,
    ...input,
  };
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claimsArray(claims))));
  return { token: `${payload}.${toBase64Url(await hmac(payload, secret))}`, expiresAt: claims.expiresAt };
}

async function verifyChallengeToken(
  token: string,
  expected: { purpose: ChallengePurpose; build: string; workerEnvironment: string },
  secret: string,
  now = Date.now(),
): Promise<ChallengeClaims> {
  if (token.length === 0 || token.length > 4_096) reject("token:length");
  const parts = token.split(".");
  if (parts.length !== 2) reject("token:shape");
  const actualMac = fromBase64Url(parts[1], "token-signature");
  const expectedMac = await hmac(parts[0], secret);
  let difference = actualMac.byteLength ^ expectedMac.byteLength;
  for (let index = 0; index < Math.max(actualMac.byteLength, expectedMac.byteLength); index += 1) {
    difference |= (actualMac[index] ?? 0) ^ (expectedMac[index] ?? 0);
  }
  if (difference !== 0) reject("token:signature");

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0], "token-payload")));
  } catch {
    reject("token:payload");
  }
  if (!Array.isArray(value) || value.length !== 8) reject("token:claims");
  const [version, nonce, purpose, keyIdHash, build, workerEnvironment, expiresAt, expectedCounter] = value;
  if (
    version !== TOKEN_VERSION ||
    typeof nonce !== "string" ||
    fromBase64Url(nonce, "token-nonce").byteLength !== 32 ||
    typeof purpose !== "string" ||
    !PURPOSES.has(purpose as ChallengePurpose) ||
    typeof keyIdHash !== "string" ||
    (keyIdHash !== "" && !SHA256.test(keyIdHash)) ||
    typeof build !== "string" ||
    typeof workerEnvironment !== "string" ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(expectedCounter) ||
    (expectedCounter as number) < 0
  ) {
    reject("token:claims");
  }
  const claims: ChallengeClaims = {
    version: 1,
    nonce,
    purpose: purpose as ChallengePurpose,
    keyIdHash,
    build,
    workerEnvironment,
    expiresAt: expiresAt as number,
    expectedCounter: expectedCounter as number,
  };
  if (claims.expiresAt <= now || claims.expiresAt > now + TOKEN_TTL_MS) reject("token:expiry");
  if (claims.purpose !== expected.purpose) reject("token:purpose");
  if (claims.build !== expected.build) reject("token:build");
  if (claims.workerEnvironment !== expected.workerEnvironment) reject("token:environment");
  return claims;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES) reject("request:size", 400);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > MAX_AUTH_BODY_BYTES) {
          await reader.cancel();
          reject("request:size", 400);
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) reject("request:json", 400);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CaptureAuthorizationError) throw error;
    reject("request:json", 400);
  }
}

async function ipRateLimit(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") || "__local__";
  if (!(await env.INGEST_IP.limit({ key: ip })).success) reject("rate:ip", 429);
}

function authResponse(error: unknown, environment: string, operation: string): Response {
  const known = error instanceof CaptureAuthorizationError ? error : new CaptureAuthorizationError("internal", 500);
  console.warn(`[capture-auth] rejected operation=${operation} environment=${environment} reason=${known.reason}`);
  const message = known.status === 503 ? "Capture authentication unavailable" : "Unauthorized";
  return Response.json({ ok: false, stage: "auth", message }, { status: known.status });
}

export async function challenge(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== "POST") reject("challenge:method", 405);
    const config = captureAuthConfig(env);
    await ipRateLimit(request, env);
    const body = await readJson(request);
    const purpose = body.purpose;
    const build = body.buildId;
    if (typeof purpose !== "string" || !PURPOSES.has(purpose as ChallengePurpose)) reject("challenge:purpose", 400);
    if (typeof build !== "string") reject("challenge:build", 400);
    requireAllowedBuild(build, config);

    let keyIdHash = "";
    let expectedCounter = 0;
    if (purpose !== "ios-enroll") {
      if (typeof body.keyId !== "string") reject("challenge:key-id", 400);
      keyIdHash = await appAttestKeyIdHash(body.keyId);
      const credential = await env.DB.prepare(
        "SELECT assertion_counter, status FROM app_attest_credentials WHERE key_id_hash = ?",
      )
        .bind(keyIdHash)
        .first<Pick<CredentialRow, "assertion_counter" | "status">>();
      if (!credential || credential.status !== "active") reject("challenge:credential");
      expectedCounter = credential.assertion_counter;
    }
    const issued = await issueChallengeToken(
      {
        purpose: purpose as ChallengePurpose,
        keyIdHash,
        build,
        workerEnvironment: config.workerEnvironment,
        expectedCounter,
      },
      config.authSecret,
    );
    return Response.json({ ok: true, challengeToken: issued.token, expiresAt: issued.expiresAt });
  } catch (error) {
    return authResponse(error, env.WORKER_BUILD ?? "missing", "challenge");
  }
}

function boundedBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
}

export async function enroll(request: Request, env: Env, deps: EnrollmentDeps = {}): Promise<Response> {
  try {
    if (request.method !== "POST") reject("enroll:method", 405);
    const config = captureAuthConfig(env);
    await ipRateLimit(request, env);
    if (!config.enrollmentEnabled) reject("enroll:disabled", 403);
    const body = await readJson(request);
    if (
      typeof body.keyId !== "string" ||
      typeof body.attestation !== "string" ||
      typeof body.challengeToken !== "string" ||
      typeof body.buildId !== "string"
    ) {
      reject("enroll:body", 400);
    }
    requireAllowedBuild(body.buildId, config);
    const claims = await verifyChallengeToken(
      body.challengeToken,
      { purpose: "ios-enroll", build: body.buildId, workerEnvironment: config.workerEnvironment },
      config.authSecret,
    );
    if (claims.keyIdHash !== "" || claims.expectedCounter !== 0) reject("enroll:token");
    const clientDataHash = await sha256(enrollmentClientData(body.challengeToken));
    if (clientDataHash.byteLength !== 32) reject("enroll:client-data-hash", 500);
    const verified = await asAuthorizationFailure("enroll", () =>
      (deps.verifyAttestation ?? verifyAppAttestAttestation)({
        attestationObject: fromBase64Url(body.attestation as string, "attestation"),
        keyId: body.keyId as string,
        clientDataHash,
        expectedAppIds: config.appIds,
        allowedBundleVersions: config.allowedBundleVersions,
        allowedValidationCategories: config.allowedValidationCategories,
        allowedEnvironments: config.allowedAppleEnvironments,
      }),
    );
    if (
      !config.appIds.has(verified.appId) ||
      !config.allowedAppleEnvironments.includes(verified.appleEnvironment) ||
      (verified.bundleVersion !== null && !config.allowedBundleVersions.has(verified.bundleVersion)) ||
      (verified.validationCategory !== null && !config.allowedValidationCategories.has(verified.validationCategory))
    ) {
      reject("enroll:attestation-policy");
    }
    const keyIdHash = await appAttestKeyIdHash(body.keyId);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO app_attest_credentials (
        key_id_hash, public_key, apple_environment, apple_app_id, assertion_counter, status,
        created_at, last_seen_at, revoked_at
      ) VALUES (?, ?, ?, ?, 0, 'active', ?, ?, NULL)
      ON CONFLICT(key_id_hash) DO NOTHING`,
    )
      .bind(keyIdHash, ownedArrayBuffer(verified.publicKeySpki), verified.appleEnvironment, verified.appId, now, now)
      .run();
    const stored = await env.DB.prepare(
      `SELECT key_id_hash, public_key, apple_environment, apple_app_id, assertion_counter, status
       FROM app_attest_credentials WHERE key_id_hash = ?`,
    )
      .bind(keyIdHash)
      .first<CredentialRow>();
    if (
      !stored ||
      stored.status !== "active" ||
      stored.apple_environment !== verified.appleEnvironment ||
      (stored.apple_app_id !== null && stored.apple_app_id !== verified.appId) ||
      toHex(boundedBytes(stored.public_key)) !== toHex(verified.publicKeySpki)
    ) {
      reject("enroll:credential-conflict", 409);
    }
    if (stored.apple_app_id === null) {
      await env.DB.prepare(
        "UPDATE app_attest_credentials SET apple_app_id = ? WHERE key_id_hash = ? AND apple_app_id IS NULL",
      )
        .bind(verified.appId, keyIdHash)
        .run();
    }
    const provenance = deriveCaptureProvenance(verified.appId, config.appleTeamId, verified.appleEnvironment);
    return Response.json({ ok: true, keyIdHash, appFlavor: provenance.appFlavor });
  } catch (error) {
    return authResponse(error, env.WORKER_BUILD ?? "missing", "enroll");
  }
}

export async function authorizeCapture(
  request: Request,
  env: Env,
  input: { purpose: Exclude<ChallengePurpose, "ios-enroll">; build: string; decodedBodySha256: string },
): Promise<AuthorizedCapture> {
  const config = captureAuthConfig(env);
  requireAllowedBuild(input.build, config);
  const token = request.headers.get("x-dmc-challenge-token") ?? "";
  const assertion = request.headers.get("x-dmc-assertion") ?? "";
  if (!token || !assertion) reject("submission:proof-missing");
  const claims = await verifyChallengeToken(
    token,
    { purpose: input.purpose, build: input.build, workerEnvironment: config.workerEnvironment },
    config.authSecret,
  );
  if (!claims.keyIdHash) reject("submission:key-hash");
  const credential = await env.DB.prepare(
    `SELECT key_id_hash, public_key, apple_environment, apple_app_id, assertion_counter, status
     FROM app_attest_credentials WHERE key_id_hash = ?`,
  )
    .bind(claims.keyIdHash)
    .first<CredentialRow>();
  if (!credential || credential.status !== "active") reject("submission:credential");
  if (credential.assertion_counter !== claims.expectedCounter) reject("submission:token-counter");
  if (!config.allowedAppleEnvironments.includes(credential.apple_environment)) {
    reject("submission:apple-environment");
  }

  const clientDataHash = await sha256(captureClientData(token, input.decodedBodySha256));
  const verified = await asAuthorizationFailure("submission", () =>
    verifyAppAttestAssertion({
      assertionObject: fromBase64Url(assertion, "assertion"),
      clientDataHash,
      publicKeySpki: boundedBytes(credential.public_key),
      expectedAppIds: config.appIds,
      previousCounter: credential.assertion_counter,
      allowedBundleVersions: config.allowedBundleVersions,
      allowedValidationCategories: config.allowedValidationCategories,
    }),
  );
  if (credential.apple_app_id !== null && credential.apple_app_id !== verified.appId) {
    reject("submission:app-id-conflict");
  }
  const quota = input.purpose === "report" ? env.REPORT_INSTALL : env.INGEST_INSTALL;
  if (!(await quota.limit({ key: claims.keyIdHash })).success) reject("rate:credential", 429);

  const reserved = await env.DB.prepare(
    `UPDATE app_attest_credentials
     SET assertion_counter = ?, last_seen_at = ?, apple_app_id = COALESCE(apple_app_id, ?)
     WHERE key_id_hash = ? AND status = 'active' AND assertion_counter = ? AND ? > assertion_counter
       AND (apple_app_id IS NULL OR apple_app_id = ?)`,
  )
    .bind(
      verified.counter,
      Date.now(),
      verified.appId,
      claims.keyIdHash,
      claims.expectedCounter,
      verified.counter,
      verified.appId,
    )
    .run();
  if (!reserved.success || reserved.meta?.changes !== 1) reject("submission:counter-conflict");
  return {
    keyIdHash: claims.keyIdHash,
    assertionCounter: verified.counter,
    provenance: deriveCaptureProvenance(verified.appId, config.appleTeamId, credential.apple_environment),
  };
}

export async function revokeCredential(keyIdHash: string, env: Env): Promise<boolean> {
  if (!SHA256.test(keyIdHash)) reject("revoke:key-hash", 400);
  const result = (await env.DB.prepare(
    `UPDATE app_attest_credentials
     SET status = 'revoked', revoked_at = ?
     WHERE key_id_hash = ? AND status = 'active'`,
  )
    .bind(Date.now(), keyIdHash)
    .run()) as D1Result;
  return result.meta?.changes === 1;
}
