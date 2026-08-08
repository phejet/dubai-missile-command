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
}

export interface AuthenticatedUploadInput {
  endpoint: string;
  channel: RemoteChannel;
  purpose: CapturePurpose;
  buildId: string;
  decodedBodySha256: string;
}

const queues = new Map<string, Promise<void>>();

function storageKey(channel: RemoteChannel): string {
  return `dmc.app-attest.key-id.v1.${channel}`;
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
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(endpointUrl(endpoint, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`capture authentication failed (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

async function challenge(
  input: { endpoint: string; purpose: "ios-enroll" | CapturePurpose; buildId: string; keyId?: string },
  fetchImpl: typeof fetch,
): Promise<string> {
  const result = await jsonPost(
    input.endpoint,
    "/api/auth/challenge",
    { purpose: input.purpose, buildId: input.buildId, ...(input.keyId ? { keyId: input.keyId } : {}) },
    fetchImpl,
  );
  if (typeof result.challengeToken !== "string") throw new Error("capture challenge response is invalid");
  return result.challengeToken;
}

export async function enrollCaptureCredential(
  input: { endpoint: string; channel: RemoteChannel; buildId: string },
  deps: CaptureAuthDeps = {},
): Promise<{ keyId: string }> {
  const attest = deps.appAttest ?? appAttestClient;
  if (!(await attest.isSupported())) throw new Error("App Attest is unavailable on this device");
  const storage = resolvedStorage(deps);
  const existing = storage.getItem(storageKey(input.channel));
  const keyId = existing || (await attest.generateKey());
  const fetchImpl = deps.fetch ?? fetch;
  const challengeToken = await challenge(
    { endpoint: input.endpoint, purpose: "ios-enroll", buildId: input.buildId },
    fetchImpl,
  );
  const clientDataHash = await sha256Bytes(enrollmentClientData(challengeToken));
  const attestation = await attest.attestKey(keyId, clientDataHash);
  await jsonPost(
    input.endpoint,
    "/api/auth/ios/enroll",
    { keyId, attestation, challengeToken, buildId: input.buildId },
    fetchImpl,
  );
  storage.setItem(storageKey(input.channel), keyId);
  return { keyId };
}

export function forgetCaptureCredential(channel: RemoteChannel, deps: CaptureAuthDeps = {}): void {
  resolvedStorage(deps).removeItem(storageKey(channel));
}

export async function withAuthenticatedCaptureUpload<T>(
  input: AuthenticatedUploadInput,
  send: (headers: Record<string, string>) => Promise<T>,
  deps: CaptureAuthDeps = {},
): Promise<T> {
  const storage = resolvedStorage(deps);
  const keyId = storage.getItem(storageKey(input.channel));
  if (!keyId) throw new Error("capture credential is not enrolled");
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
    const fetchImpl = deps.fetch ?? fetch;
    const challengeToken = await challenge(
      { endpoint: input.endpoint, purpose: input.purpose, buildId: input.buildId, keyId },
      fetchImpl,
    );
    const clientDataHash = await sha256Bytes(captureClientData(challengeToken, input.decodedBodySha256));
    const assertion = await (deps.appAttest ?? appAttestClient).generateAssertion(keyId, clientDataHash);
    return await send({ "x-dmc-challenge-token": challengeToken, "x-dmc-assertion": assertion });
  } finally {
    release();
    if (queues.get(queueKey) === queued) queues.delete(queueKey);
  }
}

export function resetCaptureAuthCoordinatorForTest(): void {
  queues.clear();
}
