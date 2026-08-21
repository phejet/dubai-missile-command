import { describe, expect, it, vi } from "vitest";
import { sessionFixture } from "../test-fixtures/capture";
import type { SessionUpload } from "./capture";
import type { UploadCaptureResult } from "./capture-sink";
import {
  createSessionUploadQueue,
  isRetryableUploadResult,
  SESSION_UPLOAD_QUEUE_MAX_AGE_MS,
  SESSION_UPLOAD_QUEUE_MAX_COUNT,
  SESSION_UPLOAD_RETRY_BASE_MS,
  type SessionUploadQueueStore,
} from "./capture-upload-queue";

function memoryStore(): SessionUploadQueueStore {
  const values = new Map<string, string>();
  return {
    read: async (channel) => values.get(channel) ?? null,
    write: async (channel, value) => void values.set(channel, value),
  };
}

describe("completed-session upload queue", () => {
  it("bounds count, deduplicates run ids, and expires old sessions", async () => {
    let time = 1_000;
    const queue = createSessionUploadQueue("staging", { store: memoryStore(), now: () => time });
    for (let index = 0; index < SESSION_UPLOAD_QUEUE_MAX_COUNT + 1; index += 1) {
      await queue.enqueue(sessionFixture({ runId: `run-${index}` }));
      time += 1;
    }
    expect(await queue.inspect()).toMatchObject({ count: SESSION_UPLOAD_QUEUE_MAX_COUNT });
    await queue.enqueue(sessionFixture({ runId: "run-5" }));
    expect(await queue.inspect()).toMatchObject({ count: SESSION_UPLOAD_QUEUE_MAX_COUNT });
    time += SESSION_UPLOAD_QUEUE_MAX_AGE_MS + 1;
    expect(await queue.inspect()).toEqual({ count: 0, rawBytes: 0 });
  });

  it("backs off transport failures, sends later, and removes the durable item", async () => {
    let time = 10_000;
    const queue = createSessionUploadQueue("staging", { store: memoryStore(), now: () => time });
    await queue.enqueue(sessionFixture({ runId: "offline-run" }));
    const send = vi.fn<(session: SessionUpload) => Promise<UploadCaptureResult>>(async () => ({
      ok: false,
      reason: "network",
    }));
    expect(await queue.drain(send)).toMatchObject({ count: 1, deferred: 1 });
    expect(send).not.toHaveBeenCalled();

    time += SESSION_UPLOAD_RETRY_BASE_MS;
    expect(await queue.drain(send)).toMatchObject({ count: 1, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    time += SESSION_UPLOAD_RETRY_BASE_MS * 2;
    send.mockResolvedValueOnce({ ok: true, id: "offline-run", encoding: "none" });
    expect(await queue.drain(send)).toMatchObject({ count: 0, sentRunIds: ["offline-run"] });
  });

  it("drops terminal authentication failures instead of retrying revoked credentials", async () => {
    let time = 20_000;
    const queue = createSessionUploadQueue("staging", { store: memoryStore(), now: () => time });
    await queue.enqueue(sessionFixture({ runId: "revoked-run" }));
    time += SESSION_UPLOAD_RETRY_BASE_MS;
    const result = await queue.drain(async () => ({ ok: false, reason: "auth", status: 401 }));
    expect(result).toMatchObject({ count: 0, droppedRunIds: ["revoked-run"] });
  });

  it("stops a drain after the first transient failure", async () => {
    let time = 30_000;
    const queue = createSessionUploadQueue("staging", { store: memoryStore(), now: () => time });
    await queue.enqueue(sessionFixture({ runId: "first-run" }));
    await queue.enqueue(sessionFixture({ runId: "second-run" }));
    time += SESSION_UPLOAD_RETRY_BASE_MS;
    const send = vi.fn(async () => ({ ok: false as const, reason: "network" }));
    expect(await queue.drain(send)).toMatchObject({ count: 2 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("classifies only transport and transient HTTP outcomes as retryable", () => {
    expect(isRetryableUploadResult({ ok: false, reason: "network" })).toBe(true);
    expect(isRetryableUploadResult({ ok: false, reason: "timeout" })).toBe(true);
    expect(isRetryableUploadResult({ ok: false, reason: "http", status: 503 })).toBe(true);
    expect(isRetryableUploadResult({ ok: false, reason: "http", status: 429 })).toBe(true);
    expect(isRetryableUploadResult({ ok: false, reason: "auth", status: 401 })).toBe(false);
    expect(isRetryableUploadResult({ ok: false, reason: "http", status: 400 })).toBe(false);
  });
});
