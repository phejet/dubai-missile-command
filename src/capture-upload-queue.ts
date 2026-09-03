import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { RUN_FEEDBACK_EMOJIS, serializedBytes, type RunFeedbackEmoji, type SessionUpload } from "./capture";
import type { UploadCaptureResult } from "./capture-sink";

export type SessionUploadChannel = "staging" | "production";

export const SESSION_UPLOAD_QUEUE_MAX_COUNT = 5;
export const SESSION_UPLOAD_QUEUE_MAX_BYTES = 20 * 1024 * 1024;
export const SESSION_UPLOAD_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_UPLOAD_RETRY_BASE_MS = 30 * 1_000;
export const SESSION_UPLOAD_RETRY_MAX_MS = 6 * 60 * 60 * 1_000;

interface QueuedSessionUpload {
  runId: string;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  rawBytes: number;
  session: SessionUpload;
  pendingFeedbackEmoji?: RunFeedbackEmoji;
}

interface QueueFile {
  version: 1;
  items: QueuedSessionUpload[];
}

export interface SessionUploadQueueStore {
  read(channel: SessionUploadChannel): Promise<string | null>;
  write(channel: SessionUploadChannel, value: string): Promise<void>;
}

export interface SessionUploadQueueSnapshot {
  count: number;
  rawBytes: number;
}

export interface SessionUploadDrainResult extends SessionUploadQueueSnapshot {
  sentRunIds: string[];
  droppedRunIds: string[];
  deferred: number;
}

type QueueFeedbackResult = { ok: true } | { ok: false; reason: string; status?: number };

export interface SessionUploadQueue {
  enqueue(session: SessionUpload): Promise<SessionUploadQueueSnapshot & { accepted: boolean }>;
  inspect(): Promise<SessionUploadQueueSnapshot>;
  drain(
    send: (session: SessionUpload) => Promise<UploadCaptureResult>,
    sendFeedback?: (runId: string, emoji: RunFeedbackEmoji) => Promise<QueueFeedbackResult>,
  ): Promise<SessionUploadDrainResult>;
  setFeedbackEmoji(runId: string, emoji: RunFeedbackEmoji): Promise<SessionUploadQueueSnapshot & { found: boolean }>;
  remove(runId: string): Promise<SessionUploadQueueSnapshot>;
  clear(): Promise<void>;
}

function queuePath(channel: SessionUploadChannel): string {
  return `capture/session-upload-queue-v1-${channel}.json`;
}

const filesystemQueueStore: SessionUploadQueueStore = {
  async read(channel) {
    try {
      const result = await Filesystem.readFile({
        path: queuePath(channel),
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      });
      return typeof result.data === "string" ? result.data : null;
    } catch {
      return null;
    }
  },
  async write(channel, value) {
    await Filesystem.writeFile({
      path: queuePath(channel),
      directory: Directory.LibraryNoCloud,
      encoding: Encoding.UTF8,
      recursive: true,
      data: value,
    });
  },
};

function validSession(value: unknown): value is SessionUpload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const session = value as Partial<SessionUpload>;
  return (
    session.captureSchema === 2 &&
    session.kind === "session" &&
    typeof session.meta === "object" &&
    session.meta !== null &&
    typeof session.meta.runId === "string" &&
    session.meta.runId.length > 0
  );
}

function validItem(value: unknown): value is QueuedSessionUpload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Partial<QueuedSessionUpload>;
  return (
    typeof item.runId === "string" &&
    Number.isFinite(item.queuedAt) &&
    Number.isSafeInteger(item.attempts) &&
    (item.attempts ?? 0) >= 1 &&
    Number.isFinite(item.nextAttemptAt) &&
    Number.isSafeInteger(item.rawBytes) &&
    (item.rawBytes ?? 0) >= 0 &&
    validSession(item.session) &&
    item.session.meta.runId === item.runId &&
    (item.pendingFeedbackEmoji === undefined || RUN_FEEDBACK_EMOJIS.includes(item.pendingFeedbackEmoji))
  );
}

function decodeQueue(value: string | null): QueuedSessionUpload[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as Partial<QueueFile>;
    return parsed.version === 1 && Array.isArray(parsed.items) ? parsed.items.filter(validItem) : [];
  } catch {
    return [];
  }
}

function snapshot(items: QueuedSessionUpload[]): SessionUploadQueueSnapshot {
  return {
    count: items.length,
    rawBytes: items.reduce((total, item) => total + item.rawBytes, 0),
  };
}

function prune(items: QueuedSessionUpload[], now: number): QueuedSessionUpload[] {
  const kept = items
    .filter((item) => now - item.queuedAt <= SESSION_UPLOAD_QUEUE_MAX_AGE_MS)
    .sort((left, right) => left.queuedAt - right.queuedAt);
  while (kept.length > SESSION_UPLOAD_QUEUE_MAX_COUNT || snapshot(kept).rawBytes > SESSION_UPLOAD_QUEUE_MAX_BYTES) {
    kept.shift();
  }
  return kept;
}

function retryDelay(attempts: number): number {
  return Math.min(SESSION_UPLOAD_RETRY_MAX_MS, SESSION_UPLOAD_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export function isRetryableUploadResult(result: UploadCaptureResult | QueueFeedbackResult): boolean {
  if (result.ok) return false;
  if (result.reason === "network" || result.reason === "timeout") return true;
  return (
    result.reason === "http" &&
    result.status !== undefined &&
    ([408, 425, 429].includes(result.status) || result.status >= 500)
  );
}

export function createSessionUploadQueue(
  channel: SessionUploadChannel,
  options: { store?: SessionUploadQueueStore; now?: () => number } = {},
): SessionUploadQueue {
  const store = options.store ?? filesystemQueueStore;
  const now = options.now ?? Date.now;
  let prior: Promise<void> = Promise.resolve();

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = prior.then(work, work);
    prior = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const load = async () => prune(decodeQueue(await store.read(channel)), now());
  const save = (items: QueuedSessionUpload[]) =>
    store.write(channel, JSON.stringify({ version: 1, items } satisfies QueueFile));

  return {
    enqueue(session) {
      return exclusive(async () => {
        const items = await load();
        const existing = items.find((item) => item.runId === session.meta.runId);
        if (existing) return { ...snapshot(items), accepted: true };
        const rawBytes = serializedBytes(session).byteLength;
        if (rawBytes > SESSION_UPLOAD_QUEUE_MAX_BYTES) return { ...snapshot(items), accepted: false };
        const queuedAt = now();
        const next = prune(
          [
            ...items,
            {
              runId: session.meta.runId,
              queuedAt,
              attempts: 1,
              nextAttemptAt: queuedAt + retryDelay(1),
              rawBytes,
              session: structuredClone(session),
            },
          ],
          queuedAt,
        );
        await save(next);
        return { ...snapshot(next), accepted: next.some((item) => item.runId === session.meta.runId) };
      });
    },
    inspect() {
      return exclusive(async () => {
        const items = await load();
        await save(items);
        return snapshot(items);
      });
    },
    drain(send, sendFeedback) {
      return exclusive(async () => {
        let items = await load();
        await save(items);
        const sentRunIds: string[] = [];
        const droppedRunIds: string[] = [];
        let deferred = 0;
        for (const item of [...items]) {
          const currentTime = now();
          if (item.nextAttemptAt > currentTime) {
            deferred += 1;
            continue;
          }
          const result = await send(structuredClone(item.session));
          if (result.ok) {
            const feedbackResult: QueueFeedbackResult = item.pendingFeedbackEmoji
              ? sendFeedback
                ? await sendFeedback(item.runId, item.pendingFeedbackEmoji)
                : { ok: false as const, reason: "feedback-handler-unavailable" }
              : { ok: true as const };
            if (feedbackResult.ok) {
              sentRunIds.push(item.runId);
              items = items.filter((candidate) => candidate.runId !== item.runId);
            } else if (isRetryableUploadResult(feedbackResult)) {
              item.attempts += 1;
              item.nextAttemptAt = currentTime + retryDelay(item.attempts);
              await save(items);
              break;
            } else {
              droppedRunIds.push(item.runId);
              items = items.filter((candidate) => candidate.runId !== item.runId);
            }
          } else if (isRetryableUploadResult(result)) {
            item.attempts += 1;
            item.nextAttemptAt = currentTime + retryDelay(item.attempts);
            await save(items);
            break;
          } else {
            droppedRunIds.push(item.runId);
            items = items.filter((candidate) => candidate.runId !== item.runId);
          }
          await save(items);
        }
        return { ...snapshot(items), sentRunIds, droppedRunIds, deferred };
      });
    },
    setFeedbackEmoji(runId, emoji) {
      return exclusive(async () => {
        const items = await load();
        const item = items.find((candidate) => candidate.runId === runId);
        if (!item) return { ...snapshot(items), found: false };
        item.pendingFeedbackEmoji = emoji;
        const next = prune(items, now());
        await save(next);
        return { ...snapshot(next), found: next.some((candidate) => candidate.runId === runId) };
      });
    },
    remove(runId) {
      return exclusive(async () => {
        const items = (await load()).filter((item) => item.runId !== runId);
        await save(items);
        return snapshot(items);
      });
    },
    clear() {
      return exclusive(() => save([]));
    },
  };
}
