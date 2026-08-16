import { appAttestClient, type AppAttestClient } from "./app-attest";
import { captureClientData, enrollmentClientData } from "./capture-auth-protocol";
import type { CaptureChannel } from "./capture-policy";
import { sha256Hex } from "./sha256";

type RemoteChannel = Extract<CaptureChannel, "staging" | "production">;
type CapturePurpose = "session" | "report";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CaptureAuthDeps {
  appAttest?: AppAttestClient;
  fetch?: typeof fetch;
  storage?: StorageLike;
  timeoutMs?: number;
}

export interface AuthenticatedUploadInput {
  endpoint: string;
  channel: RemoteChannel;
  purpose: CapturePurpose;
  buildId: string;
  decodedBodySha256: string;
}

interface PendingEnrollment {
  version: 1;
  keyId: string;
  endpoint: string;
  buildId: string;
  challengeToken?: string;
  expiresAt?: number;
  attestation?: string;
}

const queues = new Map<string, Promise<void>>();
const DEFAULT_AUTH_TIMEOUT_MS = 20_000;
const ENROLLMENT_EXPIRY_SKEW_MS = 5_000;

export class CaptureAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CaptureAuthError";
  }
}

export class CaptureAuthTimeoutError extends Error {
  constructor() {
    super("capture authentication timed out");
    this.name = "CaptureAuthTimeoutError";
  }
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new CaptureAuthTimeoutError();
          reject(error);
          controller.abort(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function storageKey(channel: RemoteChannel): string {
  return `dmc.app-attest.key-id.v1.${channel}`;
}

function pendingEnrollmentStorageKey(channel: RemoteChannel): string {
  return `dmc.app-attest.pending-enrollment.v1.${channel}`;
}

function parsePendingEnrollment(value: string | null): PendingEnrollment | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingEnrollment>;
    const hasChallenge = parsed.challengeToken !== undefined || parsed.expiresAt !== undefined;
    if (
      parsed.version !== 1 ||
      typeof parsed.keyId !== "string" ||
      typeof parsed.endpoint !== "string" ||
      typeof parsed.buildId !== "string" ||
      (hasChallenge &&
        (typeof parsed.challengeToken !== "string" ||
          typeof parsed.expiresAt !== "number" ||
          !Number.isFinite(parsed.expiresAt))) ||
      (parsed.attestation !== undefined && (typeof parsed.attestation !== "string" || !hasChallenge))
    ) {
      return null;
    }
    return parsed as PendingEnrollment;
  } catch {
    return null;
  }
}

function savePendingEnrollment(storage: StorageLike, channel: RemoteChannel, pending: PendingEnrollment): void {
  storage.setItem(pendingEnrollmentStorageKey(channel), JSON.stringify(pending));
}

function clearCaptureCredential(storage: StorageLike, channel: RemoteChannel): void {
  storage.removeItem(storageKey(channel));
  storage.removeItem(pendingEnrollmentStorageKey(channel));
}

function isServerUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "APP_ATTEST_SERVER_UNAVAILABLE"
  );
}

function isTerminalEnrollmentResponse(error: unknown): boolean {
  if (!(error instanceof CaptureAuthError) || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status);
}

function requireActive(signal: AbortSignal): void {
  if (signal.aborted) throw new CaptureAuthTimeoutError();
}

function resolvedStorage(deps: CaptureAuthDeps): StorageLike {
  if (deps.storage) return deps.storage;
  if (typeof localStorage === "undefined") throw new Error("capture credential storage unavailable");
  return localStorage;
}

function endpointUrl(base: string, path: string): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const hex = await sha256Hex(bytes);
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

async function jsonPost(
  endpoint: string,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(endpointUrl(endpoint, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new CaptureAuthError(`capture authentication failed (${response.status})`, response.status);
  try {
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw new TypeError("expected an object");
    }
    return result as Record<string, unknown>;
  } catch (error) {
    throw new CaptureAuthError("capture authentication response is invalid", response.status, error);
  }
}

async function challenge(
  input: { endpoint: string; purpose: "ios-enroll" | CapturePurpose; buildId: string; keyId?: string },
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ token: string; expiresAt?: number }> {
  const result = await jsonPost(
    input.endpoint,
    "/api/auth/challenge",
    { purpose: input.purpose, buildId: input.buildId, ...(input.keyId ? { keyId: input.keyId } : {}) },
    fetchImpl,
    signal,
  );
  if (typeof result.challengeToken !== "string") throw new CaptureAuthError("capture challenge response is invalid");
  if (result.expiresAt !== undefined && (typeof result.expiresAt !== "number" || !Number.isFinite(result.expiresAt))) {
    throw new CaptureAuthError("capture challenge response is invalid");
  }
  return { token: result.challengeToken, ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }) };
}

export async function enrollCaptureCredential(
  input: { endpoint: string; channel: RemoteChannel; buildId: string },
  deps: CaptureAuthDeps = {},
): Promise<{ keyId: string }> {
  const attest = deps.appAttest ?? appAttestClient;
  if (!(await attest.isSupported())) throw new Error("App Attest is unavailable on this device");
  const storage = resolvedStorage(deps);
  const pendingValue = storage.getItem(pendingEnrollmentStorageKey(input.channel));
  let keyId = storage.getItem(storageKey(input.channel));
  let pending = parsePendingEnrollment(pendingValue);

  if (pendingValue !== null && pending === null) {
    clearCaptureCredential(storage, input.channel);
    keyId = null;
  }
  if (keyId && !pending) return { keyId };
  if (
    pending &&
    (pending.keyId !== keyId ||
      pending.endpoint !== input.endpoint ||
      pending.buildId !== input.buildId ||
      (pending.expiresAt !== undefined && pending.expiresAt <= Date.now() + ENROLLMENT_EXPIRY_SKEW_MS))
  ) {
    clearCaptureCredential(storage, input.channel);
    keyId = null;
    pending = null;
  }
  if (!keyId) {
    keyId = await attest.generateKey();
    storage.setItem(storageKey(input.channel), keyId);
    pending = { version: 1, keyId, endpoint: input.endpoint, buildId: input.buildId };
    savePendingEnrollment(storage, input.channel, pending);
  }
  if (!pending) throw new CaptureAuthError("capture enrollment state is invalid");

  const fetchImpl = deps.fetch ?? fetch;
  let challengeToken = pending.challengeToken;
  if (!challengeToken) {
    const issued = await challenge(
      { endpoint: input.endpoint, purpose: "ios-enroll", buildId: input.buildId },
      fetchImpl,
    );
    if (issued.expiresAt === undefined) throw new CaptureAuthError("capture challenge response is invalid");
    pending = { ...pending, challengeToken: issued.token, expiresAt: issued.expiresAt };
    savePendingEnrollment(storage, input.channel, pending);
    challengeToken = issued.token;
  }
  let attestation = pending.attestation;
  if (!attestation) {
    const clientDataHash = await sha256Bytes(enrollmentClientData(challengeToken));
    try {
      attestation = await attest.attestKey(keyId, clientDataHash);
      pending = { ...pending, attestation };
      savePendingEnrollment(storage, input.channel, pending);
    } catch (error) {
      if (!isServerUnavailable(error)) clearCaptureCredential(storage, input.channel);
      throw error;
    }
  }
  try {
    await jsonPost(
      input.endpoint,
      "/api/auth/ios/enroll",
      {
        keyId,
        attestation,
        challengeToken,
        buildId: input.buildId,
      },
      fetchImpl,
    );
  } catch (error) {
    if (isTerminalEnrollmentResponse(error)) clearCaptureCredential(storage, input.channel);
    throw error;
  }
  storage.removeItem(pendingEnrollmentStorageKey(input.channel));
  return { keyId };
}

export function forgetCaptureCredential(channel: RemoteChannel, deps: CaptureAuthDeps = {}): void {
  clearCaptureCredential(resolvedStorage(deps), channel);
}

export async function withAuthenticatedCaptureUpload<T>(
  input: AuthenticatedUploadInput,
  send: (headers: Record<string, string>, signal?: AbortSignal) => Promise<T>,
  deps: CaptureAuthDeps = {},
): Promise<T> {
  const storage = resolvedStorage(deps);
  const keyId = storage.getItem(storageKey(input.channel));
  if (!keyId) throw new CaptureAuthError("capture credential is not enrolled");
  const queueKey = `${input.channel}:${keyId}`;
  const prior = queues.get(queueKey) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => turn);
  queues.set(queueKey, queued);
  await prior;
  try {
    return await withTimeout(async (signal) => {
      const fetchImpl = deps.fetch ?? fetch;
      const { token: challengeToken } = await challenge(
        { endpoint: input.endpoint, purpose: input.purpose, buildId: input.buildId, keyId },
        fetchImpl,
        signal,
      );
      requireActive(signal);
      const clientDataHash = await sha256Bytes(captureClientData(challengeToken, input.decodedBodySha256));
      requireActive(signal);
      let assertion: string;
      try {
        assertion = await (deps.appAttest ?? appAttestClient).generateAssertion(keyId, clientDataHash);
      } catch (error) {
        if (signal.aborted) throw new CaptureAuthTimeoutError();
        throw new CaptureAuthError("capture assertion failed", undefined, error);
      }
      requireActive(signal);
      return await send({ "x-dmc-challenge-token": challengeToken, "x-dmc-assertion": assertion }, signal);
    }, deps.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
  } finally {
    release();
    if (queues.get(queueKey) === queued) queues.delete(queueKey);
  }
}

export function resetCaptureAuthCoordinatorForTest(): void {
  queues.clear();
}
