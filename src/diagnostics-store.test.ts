import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_MAX_BYTES,
  createDiagnosticsStore,
  TOTAL_MAX_BYTES,
  type DiagFileInfo,
  type DiagFsAdapter,
} from "./diagnostics-store";

interface FakeFs extends DiagFsAdapter {
  files: Map<string, string>;
  appendCalls: string[];
}

function createFakeFs(): FakeFs {
  const files = new Map<string, string>();
  const appendCalls: string[] = [];
  return {
    files,
    appendCalls,
    async appendFile(path, data) {
      appendCalls.push(path);
      files.set(path, (files.get(path) ?? "") + data);
    },
    async readFile(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    async readdir(path) {
      const prefix = `${path}/`;
      const result: DiagFileInfo[] = [];
      for (const [key, value] of files) {
        if (key.startsWith(prefix)) result.push({ name: key.slice(prefix.length), size: value.length });
      }
      return result;
    },
    async deleteFile(path) {
      if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
    async mkdir() {},
  };
}

const T0 = 1760000000000;
const chunkPath = (startedAtMs: number, seq: number) =>
  `diagnostics/diag-${String(startedAtMs).padStart(13, "0")}-${String(seq).padStart(3, "0")}.jsonl`;

describe("diagnostics store", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("joins batched lines in order into one append", async () => {
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"a":1}', false);
    store.append('{"a":2}', false);
    await store.flush();

    expect(fs.appendCalls).toEqual([chunkPath(T0, 0)]);
    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"a":1}\n{"a":2}\n');
  });

  it("flushes immediately for critical appends", async () => {
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"critical":true}', true);
    await store.flush();
    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"critical":true}\n');
  });

  it("auto-flushes when 20 events are pending", async () => {
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    for (let i = 0; i < 20; i++) store.append(`{"i":${i}}`, false);
    await store.flush();
    expect(fs.appendCalls).toHaveLength(1);
    expect(fs.files.get(chunkPath(T0, 0))).toContain('{"i":19}');
  });

  it("flushes pending events after the 3s timer", async () => {
    vi.useFakeTimers();
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"later":1}', false);
    expect(fs.appendCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"later":1}\n');
  });

  it("serializes filesystem work so appends never interleave", async () => {
    const fs = createFakeFs();
    let active = 0;
    let maxActive = 0;
    const baseAppend = fs.appendFile.bind(fs);
    fs.appendFile = async (path, data) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await baseAppend(path, data);
      active -= 1;
    };
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"n":1}', true);
    store.append('{"n":2}', true);
    store.append('{"n":3}', true);
    await store.flush();

    expect(maxActive).toBe(1);
    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
  });

  it("rotates to the next chunk when the current one would exceed the cap", async () => {
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    const big = "x".repeat(Math.ceil(CHUNK_MAX_BYTES * 0.6));
    store.append(big, true);
    await store.flush();
    store.append(big, true);
    await store.flush();

    expect(fs.files.has(chunkPath(T0, 0))).toBe(true);
    expect(fs.files.has(chunkPath(T0, 1))).toBe(true);
  });

  it("prunes oldest chunks past the 20MB total, never the current chunk", async () => {
    const fs = createFakeFs();
    const mb = "x".repeat(1024 * 1024 + 10240);
    for (let i = 0; i < 25; i++) {
      fs.files.set(chunkPath(T0 - 100000 + i, 0), mb);
    }
    expect([...fs.files.keys()]).toHaveLength(25);

    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"fresh":1}', true);
    await store.flush();

    const remaining = [...fs.files.keys()].sort();
    const total = [...fs.files.values()].reduce((sum, v) => sum + v.length, 0);
    expect(total).toBeLessThanOrEqual(TOTAL_MAX_BYTES);
    expect(remaining).not.toContain(chunkPath(T0 - 100000, 0));
    expect(remaining).toContain(chunkPath(T0, 0));
    expect(remaining).toContain(chunkPath(T0 - 100000 + 24, 0));
  });

  it("exports chronologically and drops oldest whole chunks past the byte cap", async () => {
    const fs = createFakeFs();
    fs.files.set(chunkPath(T0, 0), "old-1\n");
    fs.files.set(chunkPath(T0 + 1, 0), "mid-2\n");
    fs.files.set(chunkPath(T0 + 2, 0), "new-3\n");

    const store = createDiagnosticsStore(fs);
    const full = await store.exportConcatenated();
    expect(full).toBe("old-1\nmid-2\nnew-3\n");

    const capped = await store.exportConcatenated(12);
    const lines = capped.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ channel: "export", event: "truncated", droppedFiles: 1 });
    expect(lines[1]).toBe("mid-2");
    expect(lines[2]).toBe("new-3");
  });

  it("clears all chunks and keeps accepting appends afterwards", async () => {
    const fs = createFakeFs();
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"a":1}', true);
    await store.flush();
    await store.clear();
    expect([...fs.files.keys()]).toHaveLength(0);

    store.append('{"b":2}', true);
    await store.flush();
    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"b":2}\n');
    expect(await store.totalBytes()).toBeGreaterThan(0);
  });

  it("swallows adapter failures and keeps the chain alive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fs = createFakeFs();
    let failNext = true;
    const baseAppend = fs.appendFile.bind(fs);
    fs.appendFile = async (path, data) => {
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      await baseAppend(path, data);
    };
    const store = createDiagnosticsStore(fs);
    store.startSession(T0);
    store.append('{"lost":1}', true);
    await store.flush();
    store.append('{"kept":2}', true);
    await store.flush();

    expect(fs.files.get(chunkPath(T0, 0))).toBe('{"kept":2}\n');
    expect(warn).toHaveBeenCalled();
  });
});
