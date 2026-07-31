# Replay Flight Recorder Design

Status: implemented locally; target-iPhone capability, latency, and recovery validation pending.

## Objective

Persist each completed human replay inside the existing diagnostics export before any
replay-driven UI runs.

This solves two evidence-loss paths:

1. The in-memory replay becomes inaccessible from the title flow and is cleared when the
   next game initializes.
2. Watching the death clip or full replay can terminate WebContent before the player has
   manually shared the replay.

The diagnostics export should therefore contain both sides of the incident:

- the replay needed to reproduce it;
- the event and resource chronology showing what happened while it was played.

The first implementation archives completed replays at game over. Recovering a partial
replay from a crash during live gameplay is a separate second phase because partial
playback needs an explicit stop-at-capture boundary.

## Existing Behavior

Human play records an action log and deterministic checkpoints in `src/game.ts`.

At game over, the runtime assembles `ReplayData` from:

- replay format version;
- RNG seed;
- deterministic initial progression and debug state;
- ordered actions;
- deterministic checkpoints;
- final tick, wave, score, draft mode, and human-run marker.

The object is retained in `Game.lastReplay` and `window.__lastReplay`. The run recap can
play or manually share it. A development build also posts it to Vite's
`/api/save-replay` endpoint.

Production has no automatic durable replay copy. Starting the next game calls
`initGame()`, which clears `lastReplay` and `window.__lastReplay`.

The diagnostics store already provides the required durable substrate:

- persistent Capacitor `Directory.Data` storage;
- ordered filesystem operations;
- approximately 1 MB JSONL chunks;
- 20 MB total retention;
- a 10 MB export budget;
- chronological concatenation during export;
- an emergency `localStorage` ring for small critical events.

## Measured Replay Size

The pre-implementation baseline below was taken from 12 saved replay files on
2026-07-29. It is retained as historical sizing evidence; target-iPhone v11
size and archive-latency measurements remain part of the pre-merge device gate.

The sample spans replay formats v4 through v10. The current format is v11.

| Measurement     | Raw JSON |    Gzip |
| --------------- | -------: | ------: |
| Smallest replay |   117 KB |  9.6 KB |
| Median replay   |   368 KB | 24.9 KB |
| Largest replay  |   656 KB | 44.9 KB |
| All 12 combined |  4.51 MB |  326 KB |

The weighted gzip size is 7.0% of the source JSON, approximately 14× compression.

The four wave-10 captures measured:

| Replay version | Raw JSON |    Gzip |
| -------------- | -------: | ------: |
| v6             |   533 KB | 37.3 KB |
| v8             |   580 KB | 40.1 KB |
| v9             |   580 KB | 40.4 KB |
| v10            |   656 KB | 44.9 KB |

Base64 adds approximately 33%, so a complete embedded wave-10 replay should occupy about
50–61 KB in JSONL.

### Payload composition

In the measured wave-10 captures:

- actions occupy 141–175 KB raw and approximately 15–19 KB gzip;
- checkpoints occupy 392–481 KB raw and approximately 21–25 KB gzip;
- top-level metadata occupies less than 300 bytes.

Checkpoints dominate the raw payload, but their repeated schema and similar signatures
compress extremely well. They should remain in the archive: playback does not require
them, but replay divergence diagnosis does.

## Design Decisions

### Archive the canonical replay once

The first version archives one complete replay at game over. It must not append a complete
growing snapshot every few seconds; that would turn a linear recording into quadratic
storage churn with remarkable efficiency.

### Keep the diagnostics export self-contained

The compressed replay is embedded as base64 JSONL records. A companion binary file would
be smaller, but the current Share Diagnostics flow exports only concatenated JSONL. A
sidecar would recreate the same "where did the useful file go?" problem one directory
over.

### Use gzip

Gzip already reduces measured replays to 6–12% of their original size, is broadly
interoperable, and can be streamed by standard browser tooling. The compression adapter
should use `CompressionStream("gzip")` when available and retain an explicit
`compression` field so a tested fallback can store uncompressed bytes without changing
the archive protocol.

Brotli can reduce the payload further, but the additional implementation and CPU
tradeoffs are unnecessary at these sizes.

### Preserve provenance

The archived copy must include:

- `_buildId`;
- `_savedAt`;
- `_env` (platform, native flag, user agent, DPR, and screen dimensions);
- replay format `version`.

`replayId` remains an optional human/perf-harness label inside `ReplayData` and is
never repurposed for archive grouping. The archive protocol uses `archiveId`, derived
from the raw-payload SHA-256 when available or from a boot-local ordinal otherwise.

Replay playback depends on game-code behavior, and the current runner rejects replay
versions other than the current version. A replay without its originating build is an
interesting historical artifact, not a reliable reproduction.

### Do not put payload parts in the emergency ring

The crash-recovery ring retains 50 entries of at most 2,048 characters. Replay parts are
far larger. Sending them through the existing critical-event path would truncate them
into malformed JSON.

The archive needs durable filesystem flushing without synchronous ring mirroring. This
requires separating these two concepts in the diagnostics implementation:

- flush immediately to `Directory.Data`;
- mirror a small event into the emergency ring.

Only the exact completion envelope is mirrored after the batch write succeeds. The
manifest and base64 payload parts are filesystem-only.

## Archive Protocol

Use the standard diagnostics envelope (`seq`, `boot`, `t`) with a dedicated
`replay-archive` channel.

### Manifest

```json
{
  "seq": 410,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000000,
  "channel": "replay-archive",
  "event": "manifest",
  "archiveId": "sha256-prefix",
  "build": "e1a2c53+e2d2b631",
  "replayVersion": 11,
  "compression": "gzip",
  "encoding": "base64",
  "integrity": "sha256",
  "rawBytes": 594246,
  "compressedBytes": 41054,
  "partCount": 2,
  "sha256": "full-raw-payload-sha256"
}
```

### Parts

```json
{
  "seq": 411,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000001,
  "channel": "replay-archive",
  "event": "part",
  "archiveId": "sha256-prefix",
  "index": 0,
  "data": "H4sIA..."
}
```

Use base64 payload parts of at most 32 KB. Current large replays will normally use two
parts. Bounded records are easier to validate, inspect, recover, and pass through future
export tooling than one arbitrarily large JSON line.

### Commit marker

```json
{
  "seq": 413,
  "boot": "mrr5hhvy-qt89gc",
  "t": 1784445000003,
  "channel": "replay-archive",
  "event": "complete",
  "archiveId": "sha256-prefix",
  "partCount": 2
}
```

An extractor accepts an archive only when:

- exactly one manifest exists;
- every index from zero through `partCount - 1` exists exactly once;
- exactly one completion marker exists and its `partCount` matches;
- compressed and raw byte counts match;
- the decoded raw payload matches `sha256`;
- the decoded payload is valid `ReplayData`.

An interrupted archive remains useful evidence that persistence was attempted, but it is
not presented as a playable replay.

## Write Path

At game over:

1. Assemble the canonical `ReplayData`.
2. Stamp replay provenance on a shallow copy without changing `replayId`.
3. Keep the object in `lastReplay` for immediate UI use.
4. If Diagnostics is enabled:
   1. serialize the archived copy once;
   2. compute SHA-256 over the raw UTF-8 bytes;
   3. gzip the bytes;
   4. base64-encode and split the compressed bytes;
   5. enqueue manifest, parts, and completion marker as one archive batch;
   6. explicitly await the diagnostics store flush.
5. Gate death-clip and recap replay startup until persistence settles or a shared
   five-second UI timeout expires. The persistence promise continues independently.

The game-over result UI may appear while the archive is being written. Replay-driven
controls should show a brief preparing state until the flush settles.

If compression or persistence fails:

- log a small `replay-archive:error` record;
- keep gameplay and manual replay sharing functional;
- do not claim the replay was archived;
- do not let diagnostics failure trap the player on game over.

The store exposes `appendBatch(lines)`, an observed, non-interleaved operation on the
existing ordered promise chain. It rotates only between records and rejects its caller
on adapter failure while leaving the shared chain usable. An enveloped archive above
8 MB is rejected before any archive record is written. Only the exact, successfully
persisted completion line is mirrored into the emergency ring.

## Read And Extraction Path

Add a repository tool that accepts a diagnostics JSONL export and writes recovered
replays:

```bash
npx tsx scripts/extract-diagnostic-replays.ts dmc-diagnostics-....jsonl --out recovered-replays/
```

The extractor must:

1. parse JSONL one line at a time and tolerate malformed legacy recovery lines;
2. group archive records by `archiveId`;
3. de-duplicate records by `(boot, seq)`;
4. validate manifest, part sequence, sizes, hash, and replay schema;
5. decode and decompress complete archives;
6. preserve `_buildId`, `_savedAt`, `_env`, and any existing `replayId`;
7. report incomplete or corrupt archives without writing plausible-looking output.

Suggested output:

```text
recovered-replays/
  <build>-w<wave>-s<score>-<archiveId>.json
  extraction-report.json
```

The report assigns each archive an explicit `playable`, `unverified`,
`unsupported-version`, `incomplete`, `corrupt`, or `invalid` status. Hashless archives
remain recoverable but are labelled `unverified`; unsupported versions are written as
artifacts but are never counted as playable.

## Retention Impact

At approximately 60 KB per large embedded replay:

- 20 wave-10 replays occupy about 1.2 MB;
- 100 occupy about 6 MB;
- the existing 20 MB diagnostics cap can hold hundreds in isolation.

Normal diagnostics events share that budget, so old replays will naturally disappear as
old JSONL chunks are pruned. The 10 MB export budget still has ample room for recent
replays plus their surrounding event chronology.

The first implementation should rely on the existing byte limits and measure real v11
usage. Add a separate replay-count cap only if field exports show that replay archives
crowd out useful diagnostic history. Deleting individual archives from mixed JSONL chunks
would require rewriting files, so speculative retention machinery is not free.

## Phase 2: Partial Live-Run Recovery

Recovering a replay when WebContent dies during live gameplay requires an incremental
journal rather than repeated full snapshots.

Proposed journal:

1. `recording-start`: version, build, seed, initial state, and draft mode.
2. Periodic batches containing only actions and checkpoints added since the previous
   flush.
3. `recording-progress`: the last fully persisted simulation tick.
4. `recording-complete`: final tick, wave, score, counts, and payload hash.

Recovery must expose `capturedThroughTick`. The replay runner needs an explicit diagnostic
stop-at-tick condition; otherwise a partial action stream continues simulating after its
last recorded input and manufactures an ending that never happened.

Phase 2 should not block the completed-replay archive. They solve different failure
windows.

## Implementation Surface

Expected production changes:

- `src/diagnostics-log.ts`
  - construct archive envelopes with the current boot/sequence identity;
  - archive a completed replay;
  - separate immediate filesystem durability from ring mirroring.
- `src/diagnostics-store.ts`
  - add an ordered archive-batch write or equivalent explicit batch flush.
- `src/game.ts`
  - archive the completed replay before mounting replay-driven game-over UI;
  - expose a bounded preparing/error state.
- `src/replay-provenance.ts`
  - centralize provenance decoration without mutating the live replay.
- `scripts/extract-diagnostic-replays.ts`
  - recover and validate embedded replays.

Expected tests:

- compression/decompression round trip preserves `ReplayData`;
- multipart archives reassemble in order;
- duplicate recovered records do not duplicate parts;
- missing, duplicated, reordered, corrupt, or truncated parts are rejected;
- checksum and byte-count mismatches are rejected;
- archive payload parts never enter the emergency ring;
- archive flush completes before death-clip or full-replay startup;
- filesystem or compression failure does not break game-over UI;
- diagnostics export contains and recovers multiple replays across chunk rotation;
- measured v11 replay sizes and archive latency are recorded.

## Acceptance Criteria

1. With Diagnostics enabled, completing a run produces one recoverable replay archive in
   the next Share Diagnostics export.
2. Returning to title and starting another run do not remove that archived replay.
3. If death-clip or full-replay playback terminates WebContent, the prior completed replay
   remains extractable after the replacement boot.
4. Extracted replay JSON matches the archived SHA-256 and initializes successfully on its
   recorded build.
5. Large payload records never enter the emergency ring and never create malformed
   recovery lines.
6. Diagnostics storage remains bounded by its existing total/export byte limits.
7. Archiving introduces no observable game-over hitch on the target iPhone; archive-specific
   preparing copy appears only after 150 ms and the UI gate always resolves within five seconds.

## Non-Goals

- Preserving rendered video or screenshots.
- Making old replay versions forward-compatible.
- Treating checkpoints as the playback source of truth.
- Uploading replay data to a remote service.
- Solving partial live-run recovery in the first implementation.
