# Capture Assembly + `/api/save-capture` — Build Plan

Status: implemented and locally verified; real-iPhone confirmation remains (see §6 and `tasks/todo.md`).
Roadmap step 3 of 7 in the unified capture-system sequence.
Date: 2026-08-01

Companion documents:

- [`replay-flight-recorder-design.md`](./replay-flight-recorder-design.md) — step 2 design (shipped in `a5dc06b`)
- [`../.plans/replay-flight-recorder-build-plan.md`](../.plans/replay-flight-recorder-build-plan.md) — step 2 build order
- [`../.plans/run-recap-playtest-platform.md`](../.plans/run-recap-playtest-platform.md) — the brain dump; §9 is the D1 schema this plan is designed backwards from
- [`../.plans/replay-upload-backend-status.md`](../.plans/replay-upload-backend-status.md) — what is and is not implemented

---

## 1. Context

Step 2 landed the replay flight recorder: a completed replay is gzipped, base64-chunked,
and written into the diagnostics JSONL store, and `scripts/extract-diagnostic-replays.ts`
gets it back out. That made the artifact **survive**. It did not make it **uploadable**.

Step 3 defines the thing that will eventually cross the wire — the **capture**: one
self-contained envelope holding the run's identity, its D1-shaped summary, its replay,
and the diagnostics events around it. And it proves that exact artifact writes correctly
against a local endpoint before Cloudflare is invited to the ceremony. Nothing here
touches the network in production; the only sink is a Vite dev middleware.

Two later steps are load-bearing on the schema chosen here, so it is designed backwards
from them:

- **Step 5 (Worker + R2 + D1):** every `sessions` column in
  `run-recap-playtest-platform.md` §9 must have exactly one declared source — a `summary`
  field, a `meta` field, or an explicitly server-owned value. §2.4 is that mapping.
- **Step 7 (leaderboard):** "a query over data you already have" is only true if
  `score`, `waveReached`, `outcome`, `hitRatio`, and build are already in that row.

### Decisions locked

| Decision      | Choice                                                | Why                                                                                                  |
| ------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Wire format   | Gzip when available; truthful raw fallback            | Insecure iPhone live-reload origins may lack `CompressionStream`; the extension records the encoding |
| Replay source | Shared snapshot builder, mid-run capable, atomic      | Without it a mid-run trigger uploads the _previous_ run — the failure the diagnostics review flagged |
| Event tail    | Embedded, `replay-archive` lines stripped             | The replay is embedded whole; re-shipping its base64 parts doubles the payload for zero information  |
| Identity      | `runId` (per run) and `captureId` (per capture), both | One run can produce several captures; conflating them duplicates leaderboard rows                    |
| Orchestration | `Game.captureNow()`, not `diagnostics-log.ts`         | Only `Game` can see `replayInitialState`, screen, shop state, and playback status                    |
| `installId`   | Reserved as `null`                                    | Step 4 owns it; keeps that step a real, testable unit                                                |

---

## 2. The artifact

### 2.1 Envelope

`src/capture.ts` — schema and pure assembly, no I/O.

```ts
export const CAPTURE_SCHEMA_VERSION = 1;

interface CaptureEnvelope {
  captureSchema: 1;
  captureId: string; // `${bootId}-c${ordinal}` — unique per capture
  meta: CaptureMeta;
  summary: CaptureSummary | null; // null only when there is no run to describe
  replay: ReplayData | null;
  replayOmitted?: { reason: "size" | "unavailable"; checkpointsDropped?: boolean };
  events: Record<string, unknown>[];
  eventsUnparsed: number; // malformed diagnostics lines, counted not guessed
  eventsTruncated: boolean;
  attachments: CaptureAttachment[]; // reserved, always [] at step 3 (screenshots later)
}

interface CaptureMeta {
  buildId: string; // getDiagnosticsBuildId()
  installId: string | null; // step 4 fills this
  displayName: string | null; // reserved
  bootId: string; // getBootId() — joins this capture to the diagnostics export
  runId: string | null; // minted in initGame(); null for a capture with no run
  capturedAt: number;
  trigger: "gameover" | "manual" | "agent";
  note: string | null; // step 6 "Report a bug" free text
  appScreen: "title" | "playing" | "shop" | "gameover";
  replaySource: "live" | "last-completed" | "playback" | "none"; // see §2.5
  partial: boolean; // true when the run had not ended
  capturedThroughTick: number | null; // last simulated tick when partial
  replaySha256: string | null; // SHA-256 of the embedded replay bytes
  replayComplete: boolean; // true only for an intact last-completed replay
  platform: string; // Capacitor: ios | android | web
  inputClass: "touch" | "mouse" | "unknown"; // §9's web-touch/web-mouse split, honestly sourced
  env: ReplayEnvironment; // reuse describeEnvironment() — src/replay-provenance.ts:4
}
```

**Identity.** `runId` is minted in `initGame()` (`src/game.ts:948`) as
`${Date.now().toString(36)}-${seed.toString(36)}` and held on the controller. It is
**not** added to `ReplayData` — that would bump the replay format version for a field
playback does not use. For an intact `last-completed` replay, `replaySha256` equals the
archive manifest's `sha256` when that manifest exists. Live and playback captures set
`replayComplete: false`: their embedded replay is still hashed, but no local archive
manifest is promised for that exact object.

### 2.2 Summary

`CaptureSummary` is the §9 projection, camelCased, built from the existing
`buildRunRecapData(game, replay)` (`src/run-recap.ts:149`) — no new stat derivation:

`outcome`, `deathCause`, `waveReached`, `score`, `timePlayedMs`, `burjHealth`,
`shotsFired`, `totalKills`, `hitRatio`, `multiShots`, `maxCombo`, `destroyedByType`,
`upgrades[]`.

Deliberately **not** carried: `waves` / `waveCards`. Both are recoverable from the replay
and would triple the summary to serve columns D1 does not have.

**Outcome enum.** `deriveOutcomeCause()` emits `burj_destroyed | survived | abandoned`;
§9 of the brain dump guessed `died | completed | abandoned` before run-recap existed.
The capture ships the enum the code actually produces, plus one addition:

```
burj_destroyed | survived | abandoned | in_progress
```

A `partial: true` capture is normalized to `in_progress` at the capture layer.
`deriveOutcomeCause()` returns `abandoned` for any live run, which would label every
mid-run bug report as a rage-quit. `deathCause` is `"burj_destroyed"` for that outcome
and `null` otherwise. §9's enum is superseded rather than translated — a translation
layer between two enums is where information goes to die.

### 2.3 Partial captures are not sessions rows

A partial capture describes a run that has not happened yet. Step 5 therefore:

- inserts or upserts a `sessions` row **only** for `partial: false` captures, keyed by a
  unique index on `run_id`, so three gameover captures of one run update one row;
- stores `partial: true` captures in R2 as diagnostic objects with no `sessions` row.

This keeps the leaderboard free of half-runs without a `WHERE` clause anyone can forget.

### 2.4 D1 column sources (the rename-only claim, made explicit)

| §9 column                | Source                                       |
| ------------------------ | -------------------------------------------- |
| `id`                     | server-assigned short id (step 5)            |
| `run_id` _(new column)_  | `meta.runId` — unique index, upsert key      |
| `install_id`             | `meta.installId` (step 4)                    |
| `display_name`           | `meta.displayName` (reserved, step 6)        |
| `build`                  | `meta.buildId`                               |
| `platform`               | `meta.platform` (+ `meta.inputClass`)        |
| `created_at`             | `meta.capturedAt`                            |
| `outcome`                | `summary.outcome`                            |
| `death_cause`            | `summary.deathCause`                         |
| `wave_reached`           | `summary.waveReached`                        |
| `score`                  | `summary.score`                              |
| `time_played_ms`         | `summary.timePlayedMs`                       |
| `shots_fired`            | `summary.shotsFired`                         |
| `total_kills`            | `summary.totalKills`                         |
| `hit_ratio`              | `summary.hitRatio`                           |
| `multi_shots`            | `summary.multiShots`                         |
| `max_combo`              | `summary.maxCombo`                           |
| `destroyed_by_type_json` | `summary.destroyedByType`                    |
| `upgrades_json`          | `summary.upgrades`                           |
| `feedback_emoji`         | step 6 trigger UI; `null` at step 3          |
| `feedback_note`          | `meta.note`                                  |
| `replay_size`            | server-measured from the stored blob         |
| `replay_valid`           | server-set; `0` unless `meta.replayComplete` |
| `shared`                 | server state                                 |
| `source`                 | `meta.trigger`                               |

Nothing is left for the Worker to compute. `burjHealth` and `replaySha256` have no §9
column yet; both are cheap and worth adding when the schema is written.

### 2.5 Which replay a capture carries

Capture orchestration lives in `Game`, which is the only object that can see
`replayInitialState`, `this.screen`, shop state, and `this.replayActive`. `gameRef`
survives a return to title and is **replaced** during replay playback, so reading it
blind produces confident nonsense.

| State             | `replaySource`   | Replay                     | `summary`               | `partial` |
| ----------------- | ---------------- | -------------------------- | ----------------------- | --------- |
| Title, before run | `none`           | `null`                     | `null`                  | `false`   |
| Playing           | `live`           | atomic snapshot            | live recap              | `true`    |
| Shop              | `live`           | atomic snapshot            | live recap              | `true`    |
| Game over         | `last-completed` | `lastReplay`               | `lastRunRecapData`      | `false`   |
| Title, after run  | `last-completed` | `lastReplay` if still held | `lastRunRecapData`      | `false`   |
| Replay playback   | `playback`       | the replay under playback  | `null` — never from sim | `false`   |

During playback the simulated state belongs to a recording, not to the player. Building a
summary from it would invent a run that nobody played.

### 2.6 Atomicity

`buildReplaySnapshot()` reads the tick once and **synchronously deep-clones** actions,
checkpoints, and initial state before returning — no `await` between reading the live
`_actionLog` and owning a copy of it. `assembleCapture()` is pure: the degradation ladder
drops checkpoints from a **copy**, never from the live `lastReplay` object it was handed.
Both are asserted by tests that deep-equal the inputs after assembly.

Without this, a capture taken mid-run keeps live references, and the game keeps pushing
actions into the array while the sink awaits gzip and diagnostics I/O — producing a
replay whose action log ends after its own `finalTick`.

### 2.7 Known limitation, recorded not hidden

A `partial: true` capture replays correctly up to its last recorded action, then keeps
simulating unattended — the replay runner has no stop-at-tick support (confirmed: no
`stopAt` / `capturedThrough` anywhere in `src/`). `capturedThroughTick` is recorded so a
consumer can say so out loud. Actually honouring it is phase 2 of the flight recorder,
not this step.

---

## 3. Files

| File                     | Change                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/replay-snapshot.ts` | **New.** `buildReplaySnapshot(game, initialState, opts)` — lifts the inline `ReplayData` assembly at `game.ts:1495-1514`, adding the synchronous deep clone of §2.6. Callers: gameover and mid-run capture |
| `src/capture.ts`         | **New.** Types, `assembleCapture(input)` (pure), `projectCaptureSummary(recap, partial)`, and the size-degradation ladder                                                                                  |
| `src/capture-sink.ts`    | **New.** The single `uploadCapture(envelope)` all three step-6 triggers will sit on. Serialize → gzip when available → POST. Never throws                                                                  |
| `src/sha256.ts`          | **New.** WebCrypto SHA-256 with a deterministic pure-JS fallback for insecure LAN-IP WebViews                                                                                                              |
| `src/diagnostics-log.ts` | Add `readRecentEvents(maxBytes)` only — no capture orchestration                                                                                                                                           |
| `src/game.ts`            | Mint `runId`; snapshot replay and recap eagerly at gameover; add state-aware `Game.captureNow(trigger, note?)`; expose it as `window.__captureNow()` (no UI — triggers are step 6)                         |
| `vite-capture-plugin.ts` | **New.** `/api/save-capture` dev middleware                                                                                                                                                                |
| `vite.config.ts`         | Register the plugin; add `__DMC_CAPTURE_ENDPOINT__` define (dev `"/api/save-capture"`, prod `null`)                                                                                                        |
| `src/vite-env.d.ts`      | Declare `__DMC_CAPTURE_ENDPOINT__`                                                                                                                                                                         |
| `.gitignore`             | `/captures/`                                                                                                                                                                                               |

No new dependencies.

The eager `lastRunRecapData` assignment at gameover is deliberate. After replay playback,
`gameRef.current` belongs to the recording; rebuilding the recap lazily at that point can
summarize the replay instead of the player's run. Death-time caching preserves the owner.

### `readRecentEvents` — the one non-obvious detail

```ts
readRecentEvents(maxBytes): Promise<{ events: Record<string, unknown>[]; unparsed: number; truncated: boolean }>;
```

`exportConcatenated(maxBytes)` selects **whole chunks** and skips any chunk larger than
the remaining budget, so asking it for 256 KB against 1 MB chunks returns nothing but a
truncation marker. Read at `EVENT_READ_BUDGET = 2 × CHUNK_MAX_BYTES`, then filter and trim
lines from the tail down to `EVENT_TAIL_MAX_BYTES = 256 KB`, measured in **UTF-8 bytes**,
not string length. The read is bounded deliberately: pulling the full 10 MB export to
build a 256 KB tail is hostile to the memory-pressure scenario this system exists to
diagnose.

`truncated` is true when `exportConcatenated` dropped whole chunks, when tail trimming
dropped lines, or when the ladder later removed events — the caller ORs its own rung into
the returned flag. Filter drops `channel === "replay-archive"`; unparseable lines are
counted into `unparsed` rather than aborting the parse.

### Degradation ladder

`CAPTURE_MAX_RAW_BYTES = 4 MB` on the serialized envelope, applied in order, each rung
recorded in the envelope rather than silently applied:

1. full
2. drop `replay.checkpoints` → `replayOmitted.checkpointsDropped = true`, `meta.replayComplete = false`
3. halve the event tail → `eventsTruncated = true` only when at least one event is removed
4. drop events entirely → `eventsTruncated = true`
5. drop the replay → `replayOmitted.reason = "size"`

Actions are the deterministic source of truth; checkpoints are acceleration. They go
first, exactly as the diagnostics-plan review demanded. Every rung operates on a copy
(§2.6).

---

## 4. Transport contract (what step 5's Worker must accept)

```
POST /api/save-capture
Content-Type: application/json
Content-Encoding: gzip          # omitted when CompressionStream is unavailable
x-dmc-build:   <buildId>
x-dmc-install: <installId | "">
x-dmc-sha256:  <sha256 of the UNCOMPRESSED envelope bytes>
body: gzip bytes, or plain JSON when the header is absent
```

Integrity lives in the **header**, not in `meta` — a hash inside the object it hashes is
a circular definition with extra steps. The client uses WebCrypto where available and a
tested pure-JS SHA-256 fallback otherwise, so insecure `http://<LAN-IP>:5173` iPhone dev
shells keep the integrity contract rather than silently skipping capture.

The endpoint mirrors what the Worker will do, and rejects rather than papers over:

1. abort the read past `MAX_COMPRESSED_BYTES = 8 MB` — bounded, and large enough for the
   4 MB raw ladder plus either wire encoding;
2. gunzip if `Content-Encoding: gzip`, else take the body as-is;
3. decoded byte cap 8 MB;
4. SHA-256 header match against the decoded bytes;
5. JSON parse, `captureSchema === 1`, `meta.buildId` and `captureId` present;
6. reject when `x-dmc-build` / `x-dmc-install` disagree with the envelope — a mismatch
   means one of them is lying and neither is trustworthy;
7. reject `buildId` or `captureId` failing `/^[A-Za-z0-9._+-]{1,64}$/` **before** either
   touches a path. `getBuildId()` emits `<sha>` or `<sha>+<md5>`, so `+` is allowed and
   nothing else exotic is.

Then it writes a wire file whose extension states its encoding, plus a pretty copy:

```
captures/<buildId>-w<wave>-s<score>-<captureId>.json.gz    # gzip requests
captures/<buildId>-w<wave>-s<score>-<captureId>.json.raw   # uncompressed fallback
captures/<buildId>-w<wave>-s<score>-<captureId>.json       # pretty, for eyeballing
```

Naming an uncompressed body `.json.gz` would produce a file `gunzip` rejects, which is a
lie told in a file extension. Pruning removes the newest-50 **by capture**, deleting the
whole file group — the existing `.json`-only prune (`vite-replay-plugin.ts:10`) would
retain every wire file forever.

Reply `{ ok: true, captureId, encoding, file, rawBytes, wireBytes }`. Failures reply
`400 { ok: false, stage, message }` using the same stage vocabulary `archiveReplay`
already speaks (`serialize` / `hash` / `compress` / `size` / `parse`), so step 5 inherits
a diagnosis language instead of inventing a second one.

---

## 5. Tests

- `src/replay-snapshot.test.ts` — gameover output is **deep-equal to what `game.ts` builds
  today** (the regression guard for the extraction); mutating the live `_actionLog` and
  `_replayCheckpoints` after a snapshot does not change the snapshot; a mid-run snapshot
  passes `validateReplay()` from `src/headless/validate-replay.ts` with zero divergences —
  that re-simulates and compares checkpoint hashes, so it proves coherence rather than
  counting actions.
- `src/capture.test.ts` — envelope shape and schema version; every §2.4 row has a
  non-`undefined` source; `outcome` is `in_progress` for a partial capture and never
  `abandoned` for a live run; each ladder rung fires at the right size and is recorded;
  assembly and every rung leave their inputs deep-equal to before; `attachments` is always
  `[]`; null replay and null summary do not throw.
- `src/game-capture.test.ts` — the §2.5 table, one case per
  row, including: a capture during playback carries `replaySource: "playback"` and a null
  summary; a capture on title after a run does not report the run as live; `runId` is
  stable across a run and changes on `initGame()`.
- `src/diagnostics-log.test.ts` (extend) — `readRecentEvents` strips every
  `replay-archive` line, tolerates and counts malformed lines, honours a UTF-8 byte
  budget, sets `truncated` for both the whole-chunk and line-trim cases, returns empty
  when diagnostics is disabled, and does **not** return an empty tail for a budget below
  `CHUNK_MAX_BYTES`.
- `src/capture-sink.test.ts` — gzip path sets `Content-Encoding` and a correct
  `x-dmc-sha256`; the no-`CompressionStream` path sends plain JSON, omits
  `Content-Encoding`, and still validates; missing WebCrypto uses the pure-JS hash;
  no endpoint define → `{ ok: false, reason: "no-endpoint" }` with **zero** fetches;
  network failure is swallowed.
- `vite-capture-plugin.test.ts` — exported handler tested directly (pattern:
  `vite-replay-plugin.test.ts`): gzip request writes `.json.gz` + `.json`; uncompressed
  request writes `.json.raw` + `.json`; rejects bad SHA, header/body mismatch,
  compressed-body overflow, decoded-size overflow, traversal-shaped `captureId`
  (`../../etc/x`), non-gzip garbage under a gzip header, wrong schema version, and `GET`;
  a plain capture above the old 2 MB ceiling succeeds; pruning deletes file groups,
  leaving no orphan wire files.
- `e2e/capture.spec.ts` — invokes the real `window.__captureNow()` through a Vite dev
  server for a live raw capture with WebCrypto and `CompressionStream` removed, plus a
  gzip gameover capture; inspects the middleware-written wire and pretty files.

---

## 6. Verification

```bash
npm test && npm run typecheck && npm run lint
npm run dev
# browser console — one capture per row of the §2.5 table:
await window.__captureNow("manual")

ls -la captures/
jq '.meta, .summary, (.events | length)' captures/<newest>.json
# integrity check, conditional on the recorded encoding:
gunzip -c captures/<newest>.json.gz | shasum -a 256   # gzip case
shasum -a 256 captures/<newest>.json.raw              # fallback case

npx playwright test e2e/smoke.spec.ts    # gameover path unaffected
npm run test:capture-e2e                 # real window global → dev middleware, gzip + raw
npx tsx src/headless/sim-runner.ts 12345 # determinism unchanged
```

Then the end-to-end proof this step exists to provide: pull the `replay` field out of a
written capture, save it as its own JSON, and verify plus play it:

```bash
npx tsx src/headless/validate-replay.ts --file recovered.json   # zero divergences
npx tsx play-replay.ts recovered.json
```

If the capture's replay does not play, the artifact is decorative.

---

## 7. Acceptance criteria

1. A capture assembled at game over and one assembled mid-run both write successfully
   through `/api/save-capture`, and the wire file on disk is byte-identical to the request
   body under an extension that matches its encoding.
2. The `replay` field from a written capture passes `validateReplay()` with zero
   divergences and plays in `play-replay.ts`.
3. Every `sessions` column in §2.4 has exactly one declared source, and the Worker
   computes none of them.
4. No `replay-archive` record ever appears in `events`.
5. Oversize captures degrade down the ladder and record which rung they stopped at; they
   are never silently truncated.
6. Assembling or degrading a capture leaves the live game state, `lastReplay`, and their
   nested arrays deep-equal to what they were before.
7. A mid-run capture reports `outcome: "in_progress"`, and no partial capture can become a
   `sessions` row at step 5.
8. One run produces at most one `sessions` row regardless of how many captures it emits,
   enforced by a unique index on `run_id`.
9. A capture attempt on a production build makes zero network requests and never throws
   into gameplay.
10. The gameover `ReplayData` is unchanged by the snapshot-builder extraction, proven by a
    deep-equality test and an unchanged determinism check.

---

## 8. Out of scope (and where it goes)

- `src/install-id.ts` — step 4. Field reserved as `null`.
- Worker, R2, D1, real network — step 5. §2.3, §2.4, and §4 are its inputs.
- Hidden gesture, "Report a bug" button, agent trigger, feedback emoji — step 6. This step
  ships only `window.__captureNow()` and the single `uploadCapture()` beneath it.
- Leaderboard — step 7.
- Screenshots — `attachments` is reserved and stays empty.
- Stop-at-tick replay truncation for partial captures — flight recorder phase 2.

---

## 9. Review resolutions

| #   | Comment                                  | Resolution                                                                                                                                                 |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Run identity vs capture identity         | `runId` added (§2.1); partial captures never become sessions rows and completed ones upsert by `run_id` (§2.3); `in_progress` outcome (§2.2)               |
| 2   | Rename-only D1 claim needs a mapping     | Full 24-row table (§2.4); outcome enum reconciled by superseding §9's guess (§2.2); `inputClass` added for the touch/mouse split (§2.1)                    |
| 3   | Mid-run snapshot must be atomic          | Synchronous deep clone before any await, pure assembly, no-mutation tests (§2.6); mid-run test upgraded to `validateReplay()` checkpoint verification (§5) |
| 4   | Who owns `captureNow()`                  | `Game` owns it; `diagnostics-log.ts` exposes only `readRecentEvents`; six-state source table with `replaySource` in meta (§2.5)                            |
| 5   | `readRecentEvents` truncation metadata   | Returns `{ events, unparsed, truncated }`, UTF-8 byte budget, bounded 2 MB read (§3)                                                                       |
| 6   | Fallback cannot be written as `.json.gz` | `.json.raw` for uncompressed wire bytes, `encoding` in the response, conditional verification command (§4, §6)                                             |
| 7   | Harden the local contract                | ID allowlist before path use, header/body agreement check, compressed-read cap, decoded cap, group pruning, tests for each (§4, §5)                        |
| 8   | Insecure iPhone dev lacks WebCrypto      | Mandatory integrity retained through a tested pure-JS SHA-256 fallback; browser E2E removes `crypto.subtle` (§4–§6)                                        |
| 9   | Raw ladder exceeded wire cap             | Wire cap raised to 8 MB; a plain payload above the former 2 MB ceiling is accepted (§4–§5)                                                                 |
| 10  | Event-halving rung could be a no-op      | `eventsTruncated` changes only when the rung actually removes an event (§3)                                                                                |
| 11  | Live replay overstated completeness      | `replayComplete` is true only for intact `last-completed` captures; live and playback replays remain hashed but false (§2.1)                               |
| 12  | Capture tests were misfiled              | Six-state controller coverage moved to focused `src/game-capture.test.ts` (§5)                                                                             |
| 13  | Browser evidence was synthetic-only      | Dev-server E2E invokes the real window global and inspects gzip and raw middleware artifacts (§5–§6)                                                       |
| 14  | Eager recap cache was unexplained        | Death-time recap ownership is now documented in §3                                                                                                         |
