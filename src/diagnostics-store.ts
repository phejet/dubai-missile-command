// Chunked JSONL file store for production diagnostics (see diagnostics-log.ts).
//
// Layout: diagnostics/diag-<sessionStartMs 13-digit>-<seq 3-digit>.jsonl under
// Directory.Data (persists across launches; iOS does not purge it under storage
// pressure the way it purges Cache). Fixed-width decimal names make lexicographic
// order chronological, so rotation and pruning never need to parse timestamps.
//
// All filesystem work runs on a single promise chain, so appends, rotation,
// pruning, export, and clear can never interleave. Append failures are swallowed
// after a console.warn — diagnostics must never break gameplay.

import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

export interface DiagFileInfo {
  name: string;
  size: number;
}

export interface DiagFsAdapter {
  appendFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<DiagFileInfo[]>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface DiagnosticsStore {
  /** Synchronous enqueue; never throws. flushNow forces an immediate write. */
  append(line: string, flushNow: boolean): void;
  flush(): Promise<void>;
  /** Newest chunks first within the byte budget, concatenated chronologically. */
  exportConcatenated(maxBytes?: number): Promise<string>;
  totalBytes(): Promise<number>;
  clear(): Promise<void>;
  /** Starts a fresh chunk series for this boot and prunes old chunks. */
  startSession(startedAtMs: number): void;
}

const DIAG_DIR = "diagnostics";
const CHUNK_RE = /^diag-\d{13}-\d{3}\.jsonl$/;
export const CHUNK_MAX_BYTES = 1024 * 1024;
export const TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const EXPORT_MAX_BYTES = 10 * 1024 * 1024;
const FLUSH_MAX_PENDING = 20;
const FLUSH_DELAY_MS = 3000;

export function createDiagnosticsStore(fs: DiagFsAdapter): DiagnosticsStore {
  let chain: Promise<void> = Promise.resolve();
  let chunkBase = String(Date.now()).padStart(13, "0");
  let seq = 0;
  // Byte counts use string length; game event JSON is effectively ASCII and
  // chunk rotation only needs to be approximately right.
  let currentChunkBytes = 0;
  let pending: string[] = [];
  let pendingBytes = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirReady = false;

  const chunkName = () => `diag-${chunkBase}-${String(seq).padStart(3, "0")}.jsonl`;

  function enqueue(op: () => Promise<void>): Promise<void> {
    chain = chain.then(op).catch((error) => {
      console.warn("[diagnostics] fs op failed", error);
    });
    return chain;
  }

  function run<T>(op: () => Promise<T>): Promise<T> {
    const result = chain.then(op);
    chain = result.then(
      () => undefined,
      (error) => {
        console.warn("[diagnostics] fs op failed", error);
      },
    );
    return result;
  }

  async function ensureDir(): Promise<void> {
    if (dirReady) return;
    try {
      await fs.mkdir(DIAG_DIR);
    } catch {
      // Already exists.
    }
    dirReady = true;
  }

  async function listChunks(): Promise<DiagFileInfo[]> {
    let entries: DiagFileInfo[];
    try {
      entries = await fs.readdir(DIAG_DIR);
    } catch {
      return [];
    }
    return entries.filter((f) => CHUNK_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function pruneNow(): Promise<void> {
    const files = await listChunks();
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const current = chunkName();
    for (const file of files) {
      if (total <= TOTAL_MAX_BYTES || file.name === current) break;
      await fs.deleteFile(`${DIAG_DIR}/${file.name}`);
      total -= file.size;
    }
  }

  async function writeBatch(lines: string[], bytes: number): Promise<void> {
    await ensureDir();
    if (currentChunkBytes > 0 && currentChunkBytes + bytes > CHUNK_MAX_BYTES) {
      seq += 1;
      currentChunkBytes = 0;
      await pruneNow();
    }
    await fs.appendFile(`${DIAG_DIR}/${chunkName()}`, lines.join("\n") + "\n");
    currentChunkBytes += bytes;
  }

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flush(): Promise<void> {
    clearFlushTimer();
    if (pending.length === 0) return chain.catch(() => undefined);
    const lines = pending;
    const bytes = pendingBytes;
    pending = [];
    pendingBytes = 0;
    return enqueue(() => writeBatch(lines, bytes));
  }

  return {
    append(line, flushNow) {
      try {
        pending.push(line);
        pendingBytes += line.length + 1;
        if (flushNow || pending.length >= FLUSH_MAX_PENDING) {
          void flush();
        } else if (flushTimer === null) {
          flushTimer = setTimeout(() => {
            void flush();
          }, FLUSH_DELAY_MS);
        }
      } catch {
        // Never throw into game code.
      }
    },

    flush,

    async exportConcatenated(maxBytes = EXPORT_MAX_BYTES) {
      await flush();
      return run(async () => {
        const files = await listChunks();
        const selected: DiagFileInfo[] = [];
        let budget = maxBytes;
        for (let i = files.length - 1; i >= 0; i--) {
          if (files[i].size > budget) break;
          selected.unshift(files[i]);
          budget -= files[i].size;
        }
        const dropped = files.length - selected.length;
        const parts: string[] = [];
        if (dropped > 0) {
          parts.push(
            JSON.stringify({ t: Date.now(), channel: "export", event: "truncated", droppedFiles: dropped }) + "\n",
          );
        }
        for (const file of selected) {
          parts.push(await fs.readFile(`${DIAG_DIR}/${file.name}`));
        }
        return parts.join("");
      });
    },

    totalBytes() {
      return run(async () => {
        const files = await listChunks();
        return files.reduce((sum, f) => sum + f.size, 0);
      });
    },

    clear() {
      clearFlushTimer();
      pending = [];
      pendingBytes = 0;
      return run(async () => {
        const files = await listChunks();
        for (const file of files) {
          await fs.deleteFile(`${DIAG_DIR}/${file.name}`);
        }
        currentChunkBytes = 0;
      });
    },

    startSession(startedAtMs) {
      chunkBase = String(startedAtMs).padStart(13, "0");
      seq = 0;
      currentChunkBytes = 0;
      void enqueue(async () => {
        await ensureDir();
        await pruneNow();
      });
    },
  };
}

export function createCapacitorFsAdapter(): DiagFsAdapter {
  return {
    async appendFile(path, data) {
      await Filesystem.appendFile({ path, data, directory: Directory.Data, encoding: Encoding.UTF8 });
    },
    async readFile(path) {
      const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof result.data === "string" ? result.data : "";
    },
    async readdir(path) {
      const result = await Filesystem.readdir({ path, directory: Directory.Data });
      return result.files.map((f) => ({ name: f.name, size: f.size }));
    },
    async deleteFile(path) {
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    },
    async mkdir(path) {
      await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
    },
  };
}
