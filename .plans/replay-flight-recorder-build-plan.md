# Replay Flight Recorder — Build Plan

Status: final — review consensus incorporated; ready to implement.
Date: 2026-07-31

Companion to [`docs/replay-flight-recorder-design.md`](../docs/replay-flight-recorder-design.md).
That document is the **design** (why, protocol, acceptance). This document is the
**build order** (which files, which signatures, which tests, in which sequence),
plus the decisions and protocol corrections settled during review.

This is **step 2 of 7** in the unified capture-system roadmap. Steps 3+ (capture
assembly, install id, Worker + R2 + D1, upload triggers, leaderboard projection)
are explicitly out of scope here and are not blocked by anything in this plan.

---

## 1. Goal

Make a completed human replay survive:

1. the next `initGame()`, which currently deletes it; and
2. a WebContent kill during death-clip or full-replay playback.

Method: at game over, serialize the replay, compress it, and write it into the
**existing** diagnostics JSONL store as bounded base64 records — before mounting
any replay-driven UI. Recover it later from a Share Diagnostics export via a
repo-side extractor.

No backend. No network. No new dependencies.

### Why this is step 2

Every later step uploads _an artifact_. Today the artifact evaporates: the run
you most want to inspect is the one where the WebView died, and that is exactly
the run whose replay is destroyed before anyone can tap Share. Building upload
plumbing first would produce a reliable pipe for nothing.

---

## 2. Verified current state

Confirmed by reading the tree on 2026-07-31. The implementing agent should not
re-derive this.

### Already built (the substrate)

| Piece                  | Location                             | Notes                                                                                                    |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Chunked JSONL store    | `src/diagnostics-store.ts`           | `Directory.Data`, 1 MB chunks, 20 MB retention, 10 MB export budget, single ordered promise chain        |
| Store API              | `diagnostics-store.ts:27-37`         | `append(line, flushNow)`, `flush()`, `exportConcatenated()`, `totalBytes()`, `clear()`, `startSession()` |
| Orchestrator           | `src/diagnostics-log.ts`             | `clientLog` sink, boot id, seq counter, session markers, unclean-shutdown recovery, share export         |
| Envelope construction  | `diagnostics-log.ts:114-124`         | `{ seq: seq++, boot: bootId, ...entry }` → `ringPush` if critical → `store.append`                       |
| Emergency ring         | `src/diagnostics-ring.ts`            | localStorage, 50 entries × ≤2048 chars                                                                   |
| Replay recording       | `src/game.ts`                        | `_actionLog`, `_replayCheckpoints`, anchors                                                              |
| Replay assembly        | `game.ts:1436-1454`                  | builds `ReplayData` at the `"gameover"` sim event                                                        |
| Manual replay share    | `src/save-replay.ts`                 | `saveReplayToFile`, `triggerWebDownload`                                                                 |
| Native memory sampling | `src/memory-probe.ts` + Swift plugin | already feeding diagnostics                                                                              |

### Not built (this plan)

- Any archiving of a replay into the diagnostics store.
- `CompressionStream` / `crypto.subtle` / base64 use anywhere in `src/` (grep: zero hits).
- `scripts/extract-diagnostic-replays.ts`.
- A batch-append API on the store.
- Provenance stamping on the in-memory replay (see §3.1 — this is a live bug).

### The evidence-loss path, confirmed

- `game.ts:894-896` — `initGame()` sets `this.lastReplay = null` and `window.__lastReplay = null`.
- `game.ts:736` — `setScreen("gameover")` calls `mountGameOverDeathClip()` **synchronously**.
- `game.ts:665-674` — the clip mounts against `this.lastReplay` with no durable copy anywhere.

---

## 3. Decisions

The design doc left several things open. These are decided. Rationale included so
a reviewer can overturn them on evidence rather than taste.

### 3.1 Stamp provenance at assembly, not at save time — and fix the inversion

**Current behaviour is backwards.** `_buildId` and `_savedAt` are written **only**
by the dev Vite plugin (`vite-replay-plugin.ts:58-59`) when a dev build POSTs to
`/api/save-replay`. The replay object built at `game.ts:1436-1454` sets neither.

Consequence: a replay shared off an iPhone carries **no build id and no
timestamp**. The one path that stamps provenance is the one where you already
have git in the same shell.

This matters more than it looks. `version: 11` tracks the **replay format**. It
does not track **sim behaviour** — balance tweaks and constant changes alter
outcomes without bumping the format version, so a v11 replay recorded on build A
can diverge on build B, both nominally v11, and `src/replay.ts` accepts it
(grep: no `_buildId` check anywhere in the runner or headless runners). Every
divergence investigation currently opens by guessing which build recorded the file.

**Decision:** stamp at assembly so every consumer — share sheet, archive, dev
POST — inherits it. Extend `ReplayData` with an `_env` block covering hardware.

### 3.2 Keep SHA-256 over the **raw** payload (reversing an earlier suggestion)

Hashing the compressed bytes instead was floated to cut peak memory. On
inspection the saving is illusory: `crypto.subtle.digest` has no streaming API,
so you need a contiguous buffer either way — and you need the raw bytes anyway to
feed `CompressionStream`. Peak memory is dominated by the `JSON.stringify` result
(~1.2 MB UTF-16 for a wave-10 run), which exists regardless. Hashing raw costs one
extra ~600 KB `Uint8Array` over hashing compressed, against a peak that is already
larger than that.

**Decision:** keep the design doc's protocol unchanged — `sha256` is over the raw
UTF-8 payload. It is the true replay identity and it stays verifiable end-to-end
after extraction.

### 3.3 Availability probe, with graceful degradation

Neither `CompressionStream` nor `crypto.subtle` has any precedent in this
codebase, and `crypto.subtle` requires a secure context. `capacitor://localhost`
should qualify, but this must be **verified on device before merge**. It does not
block implementation because both degradation paths are already in the schema
and the adapters are injected.

| Missing             | Behaviour                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CompressionStream` | `compression: "none"`, store raw base64. Protocol unchanged — the design already reserves the `compression` field for exactly this. |
| `crypto.subtle`     | `sha256: null`, `integrity: "none"`. Extractor recovers the replay but labels it **unverified**.                                    |
| Both                | Still archive. An unverified replay beats no replay, and gzip's own CRC-32 already catches decompression corruption.                |

### 3.4 Archive asynchronously; do not make `setScreen` async

`setScreen()` is synchronous and called from ~10 sites. Making it async to await
a flush would be a large, risky refactor for a 100 ms wait.

**Decision:** kick the archive off at assembly and hold both its persistence
promise and a shared, bounded UI gate on the `Game` instance. Let
`setScreen("gameover")` render immediately, but route every playback entrypoint
for `lastReplay` through that one gate:

- automatic death-clip mounting;
- Run Recap → Watch Replay;
- Run Recap → Watch From Wave.

The gate resolves when persistence settles or after 5 seconds, whichever comes
first. The persistence operation continues independently after a UI timeout and
is the sole authority for success/failure bookkeeping. Manual Save stays
ungated because it starts no replay workload.

`archiveReplay()` returns `null` **synchronously** when Diagnostics is disabled,
so no handle or microtask-delayed preparing state is created on that path.

Use a neutral placeholder immediately. Show archive-specific preparing copy only
after 150 ms, controlled by one named constant, so fast writes do not flash it.
Retain or remove that delay based on the target-iPhone measurement in step 7.

### 3.5 Batch API on the store rather than `clientLog`

Archive records do not pass through `handleEntry()` because that path is
fire-and-forget and cannot provide one observed, non-interleaved batch. Under the
current critical sets, archive parts would not themselves be ring-mirrored; the
reason for the dedicated API is durability and ordering, not their present
critical classification.

**Decision:** add `appendBatch(lines: string[]): Promise<void>` to
`DiagnosticsStore`, built on the existing `run()` helper. It queues the archive
as one observed operation that **rejects its caller** on adapter failure while
the shared chain absorbs the failure so later diagnostics remain usable.
`archiveReplay()` catches that rejection and resolves `{ ok: false }`; gameplay
never sees a throw.

The archive is contiguous in the operation queue, but it need not occupy one
file. Rotate between bounded records whenever the next record would exceed
`CHUNK_MAX_BYTES`; never split a record and never allow unrelated appends to
interleave. The extractor handles archives spanning chunks because export
concatenates chronologically.

An archive still needs a total-size guard: the export budget is 10 MB and selects
whole chunks, while retention pruning can delete the opening chunks of an archive
larger than the store budget. Before `appendBatch()`, reject an enveloped JSONL
batch larger than
`REPLAY_ARCHIVE_MAX_BYTES = EXPORT_MAX_BYTES - 2 * CHUNK_MAX_BYTES` (currently
8 MB). The two-chunk reserve covers the partially occupied chunk before the
archive and immediate surrounding diagnostics. Report `stage: "size"`; write no
partial archive. This is a safety ceiling, not a retention target—measured
archives should remain orders of magnitude smaller.

### 3.6 Ring mirroring

Only the compact completion envelope goes to the ring. It is the exact serialized
line already present in the successfully persisted batch:
`{ seq, boot, t, channel: "replay-archive", event: "complete", archiveId, partCount }`.

Mirror it directly only after the observed batch write succeeds. Do not add it to
`CRITICAL_EVENTS` or route it through `clientLog()`, which would create a second
store append rather than mirror the committed record. Manifest and part records
remain filesystem-only.

### 3.7 Known limitation, not fixed here

Diagnostics defaults to **off** (`diagnostics-log.ts:54`, gated on
`dmc.diag.enabled.v1`). So acceptance criterion 1 ("with Diagnostics enabled")
means this archives nothing until a user opens Options and flips it. That is
correct for step 2 but will not work for TestFlight troubleshooting later.
Flagged for the capture-system step; **do not change the default in this PR.**

---

## 4. Protocol

This supersedes the companion design's use of `replayId` for archive grouping.
The implementation must update that document to match.

Channel: `replay-archive`. Envelope: standard `{ seq, boot, t }`.

### Manifest (one per archive)

```json
{
  "seq": 410,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000000,
  "channel": "replay-archive",
  "event": "manifest",
  "archiveId": "a1b2c3d4e5f60718",
  "build": "e1a2c53+e2d2b631",
  "replayVersion": 11,
  "compression": "gzip",
  "encoding": "base64",
  "integrity": "sha256",
  "rawBytes": 594246,
  "compressedBytes": 41054,
  "partCount": 2,
  "sha256": "<64 hex chars over raw UTF-8 payload>"
}
```

`archiveId` = first 16 hex chars of `sha256`. When `crypto.subtle` is
unavailable, `integrity: "none"`, `sha256: null`, and `archiveId` uses the
fallback supplied by `archiveReplay()` (`<bootId>-a<archiveOrdinal>`).

`archiveOrdinal` is a module-local counter incremented synchronously at the start
of each enabled archive attempt. It is independent of diagnostic envelope `seq`,
so concurrent attempts cannot reuse an ID or reserve sequence numbers before the
record count is known.

`archiveId` belongs only to manifest/part/complete records, the extraction
report, and the output filename. It is never injected into the archived
`ReplayData`. The existing `ReplayData.replayId` remains untouched because it is
a live, human-meaningful perf-harness label such as `perf-wave1`.

### Part (0..partCount-1)

```json
{
  "seq": 411,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000001,
  "channel": "replay-archive",
  "event": "part",
  "archiveId": "a1b2c3d4e5f60718",
  "index": 0,
  "data": "H4sIA..."
}
```

Base64 payload ≤ **32 KiB (32,768 characters) per part**. Split only at a
multiple of four so every part is independently decodable.

### Completion marker

```json
{
  "seq": 413,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000003,
  "channel": "replay-archive",
  "event": "complete",
  "archiveId": "a1b2c3d4e5f60718",
  "partCount": 2
}
```

### Error record

```json
{
  "seq": 414,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000004,
  "channel": "replay-archive",
  "event": "error",
  "archiveId": "mrr5hhvy-qt89gc-a0",
  "stage": "config" | "serialize" | "hash" | "compress" | "encode" | "size" | "flush",
  "message": "…"
}
```

### Extractor accept rules

Accept an archive as playable only when **all** hold:

- exactly one manifest and one completion marker for the `archiveId`;
- every index `0 … partCount-1` present exactly once;
- concatenated decoded base64 length === `compressedBytes`;
- decompressed length === `rawBytes`;
- `sha256` matches (skipped, and flagged `unverified`, when `integrity: "none"`);
- payload is an object with a numeric `version`, finite `seed`, and `actions`
  array;
- for `CURRENT_REPLAY_VERSION`, the payload also contains `initialState`.

The extraction report has an explicit per-archive `status`. Unsupported replay
versions may be written as recovered artifacts with
`status: "unsupported-version"`, but they are never labelled playable or
initialized. Anything incomplete, corrupt, or structurally invalid is reported
and is not written as a replay artifact.

---

## 5. New and changed types

```ts
// src/types.ts — extend ReplayData (all optional; no migration needed)
export interface ReplayEnvironment {
  platform: string; // Capacitor.getPlatform()
  native: boolean; // Capacitor.isNativePlatform()
  ua: string; // carries iOS + WebKit version
  dpr: number;
  screenW: number;
  screenH: number;
  deviceModel?: string; // not populated in this plan; see §9
}

export interface ReplayData {
  // … existing fields unchanged …
  _buildId?: string; // now stamped at assembly
  _savedAt?: string; // now stamped at assembly
  _env?: ReplayEnvironment; // NEW
}
```

```ts
// src/diagnostics-store.ts — extend DiagnosticsStore
export interface DiagnosticsStore {
  // … existing …
  /** Appends a non-interleaved record batch. Rejects if any record fails to land. */
  appendBatch(lines: string[]): Promise<void>;
}
```

```ts
// src/replay-archive.ts (new)
export interface ArchiveRecord {
  channel: "replay-archive";
  event: "manifest" | "part" | "complete";
  [key: string]: unknown;
}

export interface ArchiveDeps {
  compress?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  /** Base64 characters per part. Must be a multiple of 4. Default 32768. */
  partChars?: number;
}

export type BuildArchiveResult =
  | { ok: true; archiveId: string; records: ArchiveRecord[]; rawBytes: number; compressedBytes: number }
  | { ok: false; stage: string; error: unknown };

export async function buildReplayArchiveRecords(
  replay: ReplayData,
  meta: { build: string; fallbackArchiveId: string },
  deps?: ArchiveDeps,
): Promise<BuildArchiveResult>;
```

`fallbackArchiveId` is minted by the caller, which keeps the builder
envelope-free while still allowing an ID when `crypto.subtle` is absent. Reject
invalid `partChars` at entry. The manifest carries no separate timestamp: `t`
belongs to the envelope and is stamped once per record by `archiveReplay()` at
append time.

Base64 conversion must process the `Uint8Array` in bounded blocks. Do not use
`String.fromCharCode(...bytes)` over the complete replay: the uncompressed
fallback can exceed the JavaScript argument limit precisely when memory pressure
is already least amusing.

```ts
// src/diagnostics-log.ts (new export)
export type ArchiveReplayResult =
  | { ok: true; archiveId: string }
  | { ok: false; archiveId: string; stage: string; error: unknown };
/** Returns null synchronously when diagnostics is disabled — no pending handle. */
export function archiveReplay(replay: ReplayData): Promise<ArchiveReplayResult> | null;
```

```ts
// src/replay-provenance.ts (new)
export function describeEnvironment(): ReplayEnvironment;
/** Returns a decorated shallow copy. Must NOT mutate the live replay. */
export function stampReplayProvenance(replay: ReplayData, build: string): ReplayData;
```

---

## 6. File-by-file changes

### New

| File                                         | Contents                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/replay-archive.ts`                      | serialize → hash → compress → bounded-block base64 → split → build records. Pure except for injected adapters; no filesystem/store/envelope. |
| `src/replay-archive.test.ts`                 | round trip, part splitting, degradation paths, failure paths                                                                                 |
| `src/replay-provenance.ts`                   | `describeEnvironment()`, `stampReplayProvenance()`                                                                                           |
| `src/replay-provenance.test.ts`              | env shape, non-mutation, missing-global fallbacks                                                                                            |
| `vite-replay-plugin.test.ts`                 | existing provenance is preserved; missing provenance is backfilled                                                                           |
| `scripts/extract-diagnostic-replays.ts`      | JSONL → recovered replays + `extraction-report.json`                                                                                         |
| `scripts/extract-diagnostic-replays.test.ts` | accept/reject matrix (§8)                                                                                                                    |

### Changed

| File                                    | Change                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                          | add `ReplayEnvironment`; add `_env?` to `ReplayData`                                                                                                                                                            |
| `src/diagnostics-store.ts`              | add observed, non-interleaved `appendBatch(lines)` with record-boundary chunk rotation                                                                                                                          |
| `src/diagnostics-log.ts`                | add synchronous-disabled `archiveReplay()`; mint `archiveId`; envelope with `seq`/`bootId`/`t`; enforce 8 MB batch ceiling; append observably; mirror completion after success; emit permanent capability event |
| `src/game.ts`                           | stamp provenance at assembly (`:1436-1454`); hold persistence + shared bounded gate; gate death clip, Watch Replay, and Watch From Wave with stale-navigation guards; leave Save ungated                        |
| `vite-replay-plugin.ts`                 | do **not** overwrite `_buildId`/`_savedAt` when already present (`:58-59`)                                                                                                                                      |
| `package.json`                          | add `"diag:extract": "npx tsx scripts/extract-diagnostic-replays.ts"`                                                                                                                                           |
| `docs/replay-flight-recorder-design.md` | align archive ID, observed writes, cross-chunk batches, size ceiling, shared UI gate, and extractor statuses; record v11 size/latency; mark implemented                                                         |

### Sketch — `appendBatch`

```ts
// src/diagnostics-store.ts, inside createDiagnosticsStore's returned object
appendBatch(lines) {
  if (lines.length === 0) return Promise.resolve();
  // Land anything already buffered first so global ordering holds.
  void flush();
  // Observed operation: rejects the caller, chain still absorbs the error.
  return run(async () => {
    await ensureDir();
    for (const line of lines) {
      const bytes = line.length + 1;
      if (currentChunkBytes > 0 && currentChunkBytes + bytes > CHUNK_MAX_BYTES) {
        seq += 1;
        currentChunkBytes = 0;
        await pruneNow();
      }
      await fs.appendFile(`${DIAG_DIR}/${chunkName()}`, line + "\n");
      currentChunkBytes += bytes;
    }
  });
},
```

Rotation happens **between** bounded records, never mid-record, and because the
whole loop is one queued operation no unrelated append can interleave.

### Sketch — game-over integration

```ts
const REPLAY_ARCHIVE_GATE_TIMEOUT_MS = 5_000;
const REPLAY_ARCHIVE_PREPARING_DELAY_MS = 150;

interface ReplayArchiveHandle {
  replay: ReplayData;
  persistence: Promise<ArchiveReplayResult>;
  gate: Promise<void>;
}

function createReplayArchiveGate(persistence: Promise<ArchiveReplayResult>): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, REPLAY_ARCHIVE_GATE_TIMEOUT_MS);
    void persistence.then(finish, finish);
  });
}

// At the "gameover" sim event, replacing the current assembly tail.
const replay = stampReplayProvenance(
  {
    /* existing fields */
  },
  getDiagnosticsBuildId(),
);
this.lastReplay = replay;
window.__lastReplay = replay;

// null when diagnostics is disabled: no handle and no preparing state.
const persistence = archiveReplay(replay);
this.replayArchive = persistence ? { replay, persistence, gate: createReplayArchiveGate(persistence) } : null;

// … existing dev POST to /api/save-replay …
this.setScreen("gameover");
```

```ts
// src/game.ts — the one gate every playback entrypoint goes through
private async awaitReplayArchive(replay: ReplayData): Promise<void> {
  const handle = this.replayArchive;
  if (!handle || handle.replay !== replay) return;
  await handle.gate;
  if (this.replayArchive === handle) this.replayArchive = null;
}
```

`mountGameOverDeathClip()` immediately installs a neutral placeholder. If a
matching handle exists, it schedules the preparing copy after 150 ms and waits
on `handle.gate`; on resolution it clears the timer and re-enters only if the
same handle, screen, replay, and panel state are still current. This identity
guard prevents multiple pending mounts from creating duplicate clips.

The two Run Recap playback callbacks capture `const replay = this.lastReplay`,
await `awaitReplayArchive(replay)`, and then re-check that the same replay is
still current, the screen is still `gameover`, and Run Recap is still open before
calling `startReplay(replay)`. A Retry or Title action during the wait must never
start stale playback afterward. `onSaveReplay` is unchanged and synchronous with
respect to the archive gate.

The completion envelope is ring-mirrored only when the independent persistence
promise truly succeeds. A UI timeout neither cancels that promise nor emits
success/failure bookkeeping. A write that lands later produces exactly one
success result. `archiveReplay()` itself never rejects.

---

## 7. Build order

Each step is independently reviewable. Do not combine.

### Parallel pre-merge gate — on-device capability probe (~30 min)

Before merge, confirm on a real iPhone build that
`typeof CompressionStream !== "undefined"` and `!!crypto?.subtle` under
`capacitor://localhost`. Log both through `clientLog("diag", "capabilities", …)`
and read them back via Share Diagnostics.

This does not block implementation: both degradation paths are already defined
and injected for tests. It blocks merge and device acceptance. The capability
event is permanent telemetry emitted once from `beginSession()`, not temporary
probe code; it explains later `unverified` archives without reconstructing the
device environment after the fact.

### Step 1 — Provenance stamping

`src/replay-provenance.ts`, `types.ts`, `game.ts` assembly,
`vite-replay-plugin.ts` no-overwrite guard. Unit tests.

Independently useful and independently shippable: from this commit on, every
saved replay carries its build and hardware. **This step has no dependency on
the rest of the plan** and can land first even if the archive work stalls.

### Step 2 — `appendBatch` on the store

`diagnostics-store.ts` + tests. Assert ordering against interleaved `append`
calls, observed failure, recovery of the shared chain, and rotation between
bounded records without interleaving.

### Step 3 — `src/replay-archive.ts`

Pure record construction with injected `compress`/`digest`. Full unit coverage
before any wiring. This is where the reviewer should spend their attention.

### Step 4 — `archiveReplay()` in `diagnostics-log.ts`

Envelope construction, synchronous disabled gate, archive ID, observed batch
size ceiling, write, error handling, and post-success ring mirroring.

### Step 5 — `game.ts` wiring

Archive start, shared 5-second UI gate, delayed preparing state, mount-on-gate,
recap playback gating, and stale-navigation guards.

### Step 6 — `scripts/extract-diagnostic-replays.ts`

Full accept/reject matrix. Verify against a real export from a device.

### Step 7 — Measure and document

Record real v11 raw/gzip sizes and end-to-end archive latency on the target
iPhone. Write both into `docs/replay-flight-recorder-design.md`, replacing the
v4–v10 table the design itself flags as stale.

---

## 8. Test plan

### Provenance tests

- `stampReplayProvenance()` returns a new replay object without mutating its input
- `_buildId` and `_savedAt` are stamped once; existing values are preserved
- `_env` contains platform/native/UA/DPR/screen data with safe missing-global fallbacks
- the assembled human replay exposed through `lastReplay` carries all provenance
- the Vite save plugin preserves existing `_buildId`/`_savedAt` and only backfills
  older replay payloads that lack them

### `src/replay-archive.test.ts`

- gzip round trip preserves `ReplayData` byte-for-byte
- multi-part split: `partCount` correct, every part ≤ 32,768 base64 characters
- every part boundary is a multiple of four and each part decodes independently
- invalid `partChars` is rejected without throwing
- a multi-megabyte uncompressed payload base64-encodes without variadic-call overflow
- single-part path for a small replay
- `compression: "none"` when `CompressionStream` is absent, still recoverable
- `integrity: "none"` + `sha256: null` when `crypto.subtle` is absent
- SHA success derives `archiveId`; fallback preserves the caller-supplied ID
- an existing payload `replayId` survives byte-for-byte and is never replaced by `archiveId`
- serialize failure (circular ref) → `{ ok: false, stage: "serialize" }`, no throw
- digest failure → `{ ok: false, stage: "hash" }`, no throw
- compress failure → `{ ok: false, stage: "compress" }`, no throw

### `src/diagnostics-store.test.ts` (extend)

- `appendBatch` writes each line exactly once and in order
- batch interleaved with `append` preserves global ordering
- `appendBatch` resolves only after the write lands
- adapter failure rejects the returned batch promise, and a later
  `append`/`flush` on the same store still succeeds
- an archive exceeding `CHUNK_MAX_BYTES` rotates **between** records, never
  mid-record, and no unrelated event interleaves into the rotation

### `src/diagnostics-log.test.ts` (extend)

- archive records carry incrementing `seq`, the current `boot`, and `t`
- the manifest object carries no competing timestamp
- **payload parts never reach the ring** (assert `ringPush` not called with part data)
- the ring receives the exact persisted completion line, byte-for-byte, only after success
- manifest and part records never reach the ring
- `archiveReplay` resolves `{ ok: false }` — never rejects — when the store throws
- `archiveReplay()` returns `null` synchronously and writes nothing when disabled
- two hashless archive attempts in one boot receive distinct fallback IDs
- `diag:capabilities` is emitted exactly once when a diagnostics session begins
- a delayed write produces no completion ring entry before it lands
- a failed write produces no completion ring entry or success result
- an enveloped batch above `REPLAY_ARCHIVE_MAX_BYTES` writes no archive records
  and resolves `{ ok: false }` with `stage: "size"`

### `scripts/extract-diagnostic-replays.test.ts`

**Reject** (report, write no playable file): missing manifest; duplicate
manifest; missing or duplicate completion marker; missing part index; duplicate
part index; truncated part;
`compressedBytes` mismatch; `rawBytes` mismatch; `sha256` mismatch; and, for a
supported version, missing/non-finite `seed`,
non-array `actions`, or missing current-version `initialState`.

**Accept:** clean single-part; clean multi-part; parts appearing out of order in
the file (sort by `index`);
duplicated whole records de-duplicated by `(boot, seq)`; two archives in one
file; archive spanning a chunk rotation; `integrity: "none"` recovered and
flagged `unverified`; malformed legacy lines tolerated without aborting the parse.

**Recover but mark non-playable:** unsupported replay version → write an artifact
with `status: "unsupported-version"`, exclude it from initialized/playable counts,
and keep `archiveId` in the report and filename rather than injecting it into JSON.

### `src/game.ts` integration (Vitest, mocked archive)

- preparing state renders while the archive promise is pending
- archive-specific preparing copy does not appear before 150 ms
- a fast archive never flashes archive-specific preparing copy
- clip mounts after it settles
- clip mounts normally when diagnostics is disabled (no preparing state)
- archive failure still mounts the clip
- UI timeout mounts the clip while persistence remains in flight
- leaving the gameover screen mid-archive does not mount afterwards
- starting a new run mid-archive does not mount the stale replay
- `onWatchFullReplay` does not call `startReplay()` while the gate is pending
- `onWatchFromWave` does not call `startReplay()` while the gate is pending
- both proceed after the archive succeeds
- both proceed after the archive fails
- both proceed after the bounded UI timeout, even with the write still in flight
- Retry or Title during either wait prevents stale playback from starting later
- `onSaveReplay` works immediately, gate pending or not (it must **not** be gated)
- `archiveReplay()` returning `null` (disabled) leaves all three paths synchronous

### Device verification (manual, iPhone)

1. Enable Diagnostics in Options.
2. Play a run to game over. Note any hitch on the game-over transition.
3. Return to title, start and abandon a second run.
4. Share Diagnostics → AirDrop the `.jsonl` to the Mac.
5. `npm run diag:extract -- dmc-diagnostics-*.jsonl --out recovered-replays/`
6. Confirm the export contains one `diag:capabilities` event with both booleans.
7. Confirm the **first** run's replay is recovered and its hash validates.
8. `npx tsx play-replay.ts recovered-replays/<file>.json` reproduces the run.
9. Repeat with a WebContent kill during the death clip, then during full replay.
   Confirm the completed replay is extractable after each replacement boot.

---

## 9. Explicitly out of scope

- **Screenshots.** Deferred by decision. Reserve nothing here; the capture
  schema handles it at step 3.
- **Upload / Worker / R2 / D1.** Steps 4-7 of the roadmap.
- **`install-id.ts`.** Step 4.
- **Phase 2 partial live-run recovery.** Needs an explicit stop-at-tick condition
  in the replay runner, which does not exist (grep: no `stopAt`/`capturedThrough`
  in `src/`). This includes abandoned/rage-quit runs; separate plan.
- **`deviceModel`.** iOS Safari reports a generic `"iPhone"` UA, so a real model
  string needs `@capacitor/device` or an extension to the existing
  `MemoryProbePlugin.swift`. The field is reserved in `ReplayEnvironment` and
  left `undefined`.
- **Changing the diagnostics-enabled default.** See §3.7.
- **Replay-count retention caps.** The design says rely on existing byte limits
  and measure first. Do that.

---

## 10. Acceptance criteria

Inherited from the design doc, plus provenance:

1. With Diagnostics enabled, completing a run produces exactly one recoverable
   replay archive in the next Share Diagnostics export.
2. Returning to title and starting another run does not remove it.
3. If death-clip or full-replay playback kills WebContent, the prior completed
   replay remains extractable after the replacement boot.
4. Extracted replay JSON matches the archived SHA-256 and initialises on its
   recorded build.
5. Payload parts never enter the emergency ring and never create malformed
   recovery lines.
6. Diagnostics storage stays within its existing total/export byte limits.
7. No observable game-over hitch on the target iPhone; if the preparing state
   appears, it is brief, explicit, and always resolves.
8. Every replay saved via the share sheet carries `_buildId`,
   `_savedAt`, and `_env` — including on a production iOS build.
9. Archiving never throws into gameplay and never traps the player on game over.
10. No `lastReplay` playback path — death clip, Watch Replay, or Watch From Wave —
    starts before the archive gate settles or its bounded UI timeout expires.
    Save Replay is never gated.
11. `archiveReplay()` reports `{ ok: true }` only when the write was actually
    observed to land. A swallowed adapter failure reporting success is a defect,
    not a degraded mode.
12. The archive identifier is `archiveId` and never appears inside the archived
    `ReplayData`; the existing `replayId` field (perf-harness label) is untouched.
13. An archive exceeding `REPLAY_ARCHIVE_MAX_BYTES` is rejected before any of its
    records are written; gameplay and manual Save remain functional.

---

## 11. Verification commands

```bash
npm test                                   # unit
npm run typecheck
npm run lint
npx playwright test e2e/smoke.spec.ts      # game-over path unaffected
npx tsx src/headless/sim-runner.ts 12345   # determinism unchanged
npm run diag:extract -- <export>.jsonl --out recovered-replays/
```

A determinism check matters here: provenance stamping touches the replay object,
and `stampReplayProvenance` returning a copy rather than mutating is what keeps
that safe. Verify `sim-runner` output is byte-identical before and after.
