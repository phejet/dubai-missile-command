# Capture Worker Backend (R2 + D1) — Build Plan

Status: implemented and locally verified; Cloudflare provisioning/deployment pending.
Roadmap step 5 of 7 in the unified capture-system sequence.
Date: 2026-08-01

> **Superseded contract:** The session/report wire shape, storage schema, routes, and
> retention protocol in this document were replaced by
> [`capture-session-report-split-plan.md`](./capture-session-report-split-plan.md). The
> validation ladder, abuse controls, deployment boundary, and verification layering
> still carry forward as described there.

Implementation note: the checked-in Wrangler configuration intentionally contains
placeholder account and D1 resource IDs. Local workerd/D1/R2 tests and the curl gate
pass; acceptance criterion 12's deployed-Worker and applied-lifecycle proof remains
blocked until the Cloudflare account and resources exist.

Companion documents:

- [`replay-capture-assembly-plan.md`](./replay-capture-assembly-plan.md) — step 3. §2.4 and §4 are this plan's inputs
- [`replay-flight-recorder-design.md`](./replay-flight-recorder-design.md) — step 2, the local durability substrate
- [`../.plans/replay-upload-backend-status.md`](../.plans/replay-upload-backend-status.md) — §6 destination decision, §7 build order and what step 4 handed this step
- [`../.plans/run-recap-playtest-platform.md`](../.plans/run-recap-playtest-platform.md) — §7 stack rationale, §9 the schema this is designed from, §17 phase order

---

## 1. Context

Steps 1–4 produced a complete, self-describing artifact and proved it writes
correctly against a local endpoint. `POST /api/save-capture` already exists as Vite dev
middleware (`vite-capture-plugin.ts`), already has a client that speaks it
(`src/capture-sink.ts`), and already has browser tests that exercise both wire encodings.

Step 5 puts that same endpoint on the internet, backed by R2 for blobs and D1 for
structure. **It ships no client change.** Ordinary production builds keep capture
channel `off` until step 6 wires reviewed remote channels. The entire step is validated with
`curl` against `wrangler dev` and then against a deployed Worker.

The temptation to "just also add the share link while we're in there" should be
resisted; that is brain dump §17 Phase 3 and it needs UI, OG cards, and a public
retrieval story that this step deliberately does not build.

### Decisions locked

| Decision       | Choice                                                  | Why                                                                                                  |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Stack          | One Worker, one R2 bucket, one D1 database              | Settled in backend-status §6; private diagnostics is a second table, not a second service            |
| Ingest route   | `POST /api/save-capture`, unchanged from step 3         | A client, a contract, and tests already exist. Renaming it would invalidate all three for no gain    |
| Two tables     | `captures` (every upload) + `sessions` (completed runs) | Retrieval and leaderboard have different keys, different lifetimes, and different audiences          |
| Stored bytes   | Decoded JSON, re-gzipped by the Worker                  | Uniform retrieval; the recorded `sha256` still verifies after gunzip, so integrity survives storage  |
| Write order    | R2 first, then D1                                       | An orphan blob is recoverable; a D1 row pointing at nothing is a lie that queries will repeat        |
| Ingest auth    | None. Rate limits, size caps, and schema validation     | The endpoint must accept anonymous players. §9 already ruled embedded-key HMAC is not authentication |
| Retrieval auth | Bearer secret, constant-time compare                    | Captures contain diagnostics and player notes. This is the developer's door, not a public one        |
| Contract drift | One shared validator module, two runtime adapters       | "Diffable against the dev middleware" decays. Shared code cannot                                     |

---

## 2. Storage design

### 2.1 R2 layout

```
captures/<installId>/<captureId>.json.gz
```

**The key derives only from immutable identity.** An earlier draft included
`capturedAt`, which is client-supplied and can differ between two posts carrying the
same `captureId` — producing a second blob while D1's conflict handling kept the first
row, so the row's `r2_key` and `sha256` described an object that was no longer the only
one. Ordering comes from `captures.captured_at` and `received_at`, which is what indexes
are for. `installId` is also client-supplied, so §3.1's conflict rule pins it: a
`captureId` that reappears under a different install is a conflict, not a new key.

One object per upload, holding the **decoded** envelope bytes re-gzipped by the Worker.
The client's wire encoding is a transport detail and does not survive into storage; a
capture sent uncompressed from an insecure iPhone origin lands identically to a gzipped
one. Because the object is the decoded payload, `gunzip | sha256sum` still matches the
`sha256` recorded at ingest, so integrity is verifiable at rest and after download.

`installId` leads the key so `diag:pull <installId>` is a prefix list rather than a scan.
Both path segments are validated before use (§4.2).

### 2.2 `captures` — every upload

The object index. This is what replaces the KV lookup the old plan proposed, and it is
the only table retrieval needs.

```sql
CREATE TABLE captures (
  capture_id     TEXT PRIMARY KEY,          -- meta-supplied, unique per capture
  run_id         TEXT,                      -- null for a capture with no run
  install_id     TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0, -- 1 when the id could not be persisted
  boot_id        TEXT NOT NULL,
  build          TEXT NOT NULL,
  platform       TEXT NOT NULL,
  input_class    TEXT NOT NULL,
  captured_at    INTEGER NOT NULL,          -- meta.capturedAt, epoch ms
  received_at    INTEGER NOT NULL,          -- server clock; client clocks lie
  trigger        TEXT NOT NULL,             -- gameover | manual | agent
  app_screen     TEXT NOT NULL,
  replay_source  TEXT NOT NULL,             -- live | last-completed | playback | none
  partial        INTEGER NOT NULL,
  captured_through_tick INTEGER,
  note           TEXT,
  replay_sha256  TEXT,
  replay_complete INTEGER NOT NULL,
  replay_omitted_reason TEXT,               -- size | unavailable | null
  events_count   INTEGER NOT NULL,
  events_truncated INTEGER NOT NULL,
  sha256         TEXT NOT NULL,             -- of the decoded envelope bytes
  raw_bytes      INTEGER NOT NULL,
  stored_bytes   INTEGER NOT NULL,          -- size of the R2 object
  r2_key         TEXT NOT NULL
);

-- Ordering uses received_at, not captured_at: a spoofed client clock should not be
-- able to pin a capture to the top of a listing, any more than it can evade retention.
CREATE INDEX idx_captures_install ON captures(install_id, received_at DESC);
CREATE INDEX idx_captures_run ON captures(run_id);
CREATE INDEX idx_captures_received ON captures(received_at DESC);
```

### 2.3 `sessions` — completed runs only

§9's schema, with the amendments step 3 already committed to in its §2.4 mapping. One
row per **run**, not per capture.

```sql
CREATE TABLE sessions (
  run_id        TEXT PRIMARY KEY,           -- the upsert key; §2.3 of the step 3 plan
  capture_id    TEXT NOT NULL,              -- the capture this projection came from
  install_id    TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0,
  display_name  TEXT,
  build         TEXT NOT NULL,
  platform      TEXT NOT NULL,
  input_class   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,           -- CLIENT CLAIM. meta.capturedAt. Display only.
  received_at   INTEGER NOT NULL,           -- SERVER FACT. Retention and ordering key.

  outcome       TEXT NOT NULL,              -- burj_destroyed | survived | abandoned
  death_cause   TEXT,
  wave_reached  INTEGER NOT NULL,
  score         INTEGER NOT NULL,
  time_played_ms INTEGER NOT NULL,
  burj_health   INTEGER NOT NULL,

  shots_fired   INTEGER NOT NULL,
  total_kills   INTEGER NOT NULL,
  hit_ratio     REAL NOT NULL,
  multi_shots   INTEGER NOT NULL,
  max_combo     INTEGER NOT NULL,
  destroyed_by_type_json TEXT NOT NULL,
  upgrades_json TEXT NOT NULL,

  feedback_emoji TEXT,                      -- step 6 fills this
  feedback_note  TEXT,                      -- meta.note

  replay_sha256 TEXT,
  -- Serialized byte length of envelope.replay alone, measured at ingest.
  -- NOT the R2 object size, which is the whole gzipped envelope (that is
  -- captures.stored_bytes). Null when the capture carried no replay.
  replay_size   INTEGER,
  -- CLIENT CLAIM. meta.replayComplete, forgeable. Never a trust signal.
  replay_complete_claimed INTEGER NOT NULL DEFAULT 0,
  -- SERVER FACT. 1 only after re-simulation reproduced this score. Always 0 at step 5.
  replay_verified INTEGER NOT NULL DEFAULT 0,
  verified_at   INTEGER,
  shared        INTEGER NOT NULL DEFAULT 0, -- reserved for step 6/7
  source        TEXT NOT NULL               -- meta.trigger
);

CREATE INDEX idx_sessions_install ON sessions(install_id, received_at DESC);
CREATE INDEX idx_sessions_leaderboard ON sessions(build, score DESC)
  WHERE replay_verified = 1 AND install_ephemeral = 0;
CREATE INDEX idx_sessions_recent ON sessions(received_at DESC);
```

Deviations from §9, all inherited from step 3 rather than invented here:

- `run_id` is the primary key, not a server-assigned `id`. §9 predates run identity; a
  server id would need a unique index on `run_id` anyway to stop one run producing
  several leaderboard rows, at which point the extra column earns nothing.
- `outcome` uses the enum `deriveOutcomeCause()` actually emits. `in_progress` cannot
  reach this table by construction (§2.4).
- `source` carries `meta.trigger`, superseding §9's `"share" | "auto-stream"` guess.
- `burj_health`, `replay_sha256`, `input_class`, and `install_ephemeral` are added.
  The first three were flagged as "cheap and worth adding" in step 3 §2.4.
- §9's single `replay_valid` is **split in two**. It was defined as "0 if
  re-derivation failed", which quietly implies a server that re-derives. No such server
  exists, and setting one column from `meta.replayComplete` would launder a client
  claim into a name that reads like a server guarantee. `replay_complete_claimed` is
  what the client said; `replay_verified` is what the server proved. See §5.5.

- `received_at` is added and is the **only** column retention and "recent" ordering may
  use. §2.2 already annotates `captures.received_at` with "client clocks lie" — then an
  earlier draft aged `sessions` rows by `created_at`, which is `meta.capturedAt`, which
  is the lying clock. A capture stamped five years in the future would have outlived
  every retention sweep. `created_at` survives as the client's claim, for display.

The leaderboard index keys on `replay_verified`, which is **always 0 at step 5**. That
is deliberate: the leaderboard is empty until something actually verifies a run, so
step 7 has to confront the problem rather than inherit a fake guarantee from a column
name.

### 2.4 The one predicate that decides a `sessions` row

Written once, in one function, tested directly:

```ts
const isSessionRow = meta.partial === false && summary !== null && meta.runId !== null;
```

A partial capture describes a run that has not finished, so it has no business in a
leaderboard. A capture with no run (title screen, before playing) has nothing to
project. Everything else upserts by `run_id`, so three gameover captures of one run
produce one row — the last one wins.

This is enforced structurally rather than by a `WHERE` clause every future query has to
remember, which is step 3 §2.3's stated reason for the split.

### 2.5 Ephemeral installs are stored, not counted

Step 4 marks ids it could not persist with an `eph-` prefix. Those uploads are real and
worth keeping — they are disproportionately likely to come from the private-mode and
storage-restricted browsers where bugs hide — but each one is a fresh identity every
boot, so counting them as installs would quietly inflate step 7's "20+ installs" gate.

`install_ephemeral` is computed at ingest and carried on both tables, so exclusion is a
column comparison rather than a `LIKE 'eph-%'` that someone will eventually forget. The
leaderboard index bakes the exclusion in.

---

## 3. Routes

### 3.1 `POST /api/save-capture` — ingest (public)

Byte-for-byte the step 3 contract (`replay-capture-assembly-plan.md` §4). The client
already sends this; nothing about it changes.

```
Content-Type: application/json
Content-Encoding: gzip          # omitted when CompressionStream is unavailable
x-dmc-build:   <buildId>
x-dmc-install: <installId | "">
x-dmc-sha256:  <sha256 of the UNCOMPRESSED envelope bytes>
```

Validation order, and it must be this order — each rung protects the next:

1. method and content length; abort the read past `MAX_COMPRESSED_BYTES` (8 MB);
2. rate limit (§5.1), before any decompression work;
3. decompress when `Content-Encoding: gzip`, else take the body as-is —
   **counting output bytes as they stream and aborting at the cap** (see below);
4. decoded byte cap (8 MB);
5. SHA-256 of the decoded bytes must equal `x-dmc-sha256`;
6. JSON parse; `captureSchema === 1`;
7. **full runtime validation of every projected field** (see below);
8. ID allowlists (§4.2) **before** any value reaches an R2 key;
9. header/body agreement for build and install;
10. conflict check on `captureId` (see below);
11. R2 conditional put; then a single transactional D1 `batch()`.

> **`CaptureEnvelope` is a compile-time fiction at the boundary.** TypeScript types
> validate nothing about hostile JSON, and §2.2/§2.3 project this object straight into
> `NOT NULL` columns. Checking only `captureSchema`, `captureId`, and `buildId` — as an
> earlier draft did — means a capture omitting `meta.platform` or sending
> `summary.score: "banana"` reaches an insert and produces either a 500 or a garbage row.
>
> Every field that lands in a column is validated at ingest: presence, type, and where
> applicable bounds and enum membership (`trigger`, `appScreen`, `replaySource`,
> `outcome`, `inputClass`). Numbers must be finite; `score`, `waveReached`,
> `timePlayedMs`, and the counters are non-negative; `hitRatio` is within `[0, 1]`;
> `destroyedByType` and `upgrades` must serialize. Strings that become columns get length
> caps — `note` especially, since a player types it.
>
> **`installId` must be non-empty and valid.** The wire contract permits
> `x-dmc-install: ""` and `src/capture.ts:32` types `installId` as `string | null`, but
> `captures.install_id` is `NOT NULL` and the value becomes an R2 key segment. Step 4
> made the client always send one; a hostile client is under no such obligation. A null
> or empty install is **rejected** at `stage: "parse"` rather than silently normalized to
> a shared bucket that would merge unrelated uploads under one identity.

> **Decompression bomb — the adapters differ and the shared validator does not cover
> this.** The Vite plugin gets a bounded decompression for free:
> `gunzipSync(wire, { maxOutputLength: MAX_DECODED_BYTES + 1 })` refuses to allocate
> past the cap. `DecompressionStream` in the Worker has **no equivalent option**. A
> naive `new Response(stream).arrayBuffer()` buffers the entire expansion before rung 4
> ever runs, so a few hundred KB of crafted gzip becomes an out-of-memory kill that
> costs the attacker one request. The Worker must read the decompression stream chunk by
> chunk, accumulate a running byte count, and abort the moment it exceeds
> `MAX_DECODED_BYTES` — cap enforced _during_ decompression, not after it. This is a
> required test in §7, not an optimization.

**CORS.** The game runs from `capacitor://localhost` (iOS) and the GitHub Pages origin,
so ingest needs explicit CORS with an origin allowlist and a preflight response — the
same class of problem that already broke iPhone perf uploads once when Vite's default
CORS middleware rejected the Capacitor origin. Retrieval and listing (§3.2, §3.3) send
**no** permissive CORS headers: they are `curl`-and-script surfaces, and a browser has
no business reaching them cross-origin with a bearer token in play.

Responses reuse the stage vocabulary the dev middleware and `archiveReplay` already
speak, so there is one diagnosis language across the whole system:

```
200 { ok: true, captureId, encoding, rawBytes, storedBytes, r2Key, sessionProjected }
400 { ok: false, stage: serialize|hash|compress|size|parse, message }
409 { ok: false, stage: "conflict", message }
429 { ok: false, stage: "rate", message }
500 { ok: false, stage: "store", message }
```

`sessionProjected` reports only whether §2.4's predicate produced a `sessions` row. It
deliberately does **not** claim leaderboard eligibility: every step 5 row has
`replay_verified = 0`, so nothing is eligible yet (§5.6). The unchanged client discards
this field anyway — `src/capture-sink.ts:58` reads only `captureId`, `encoding`, and
`file` — so it exists for `curl` and for step 6, not for today.

**Idempotency and conflict.** A retry must not duplicate; a _collision_ must not
silently corrupt. Those are different cases and the earlier draft conflated them, with
`ON CONFLICT DO NOTHING` quietly keeping a row whose `sha256` and `r2_key` no longer
described the stored object.

| Case                                 | Meaning                | Response                                     |
| ------------------------------------ | ---------------------- | -------------------------------------------- |
| Same `captureId`, same `sha256`      | A genuine retry        | `200`, existing row's values, no rewrite     |
| Same `captureId`, different `sha256` | Collision or tampering | `409 { stage: "conflict" }`, nothing written |

The stored `sha256` is what makes this decidable, which is the second reason it is a
column and not just a header. The R2 write uses a conditional put so a concurrent
double-post cannot interleave into a torn state, and the D1 insert reads back on
conflict rather than ignoring it.

**Atomicity.** The `captures` insert and the `sessions` upsert are **one transactional
`DB.batch()`**, not two statements. §7 asserts that a failing session write leaves no
capture row, and that only holds inside a batch. R2 is written first and is not part of
the transaction, so the surviving failure mode is a blob with no row — recoverable by a
reconcile pass, and the deliberate choice over a row pointing at nothing (§1).

### 3.2 `GET /api/capture/:captureId` — retrieval (bearer)

Returns the stored envelope, gunzipped, as `application/json`. `?raw=1` streams the
gzip object untouched for byte-exact integrity checking.

### 3.3 `GET /api/captures` — listing (bearer)

Query params: `install`, `build`, `run`, `since`, `limit` (default 50, max 200).
Returns `captures` rows without blobs, newest first. This is what `diag:pull` drives.

### 3.4 `GET /api/health` — liveness (public)

Returns `{ ok: true, schema: 1, build: <worker build> }`. Trivial, but it makes the
first `curl` of the verification gate a check of deployment rather than of ingest.

### 3.5 Deliberately absent

`GET /r/<id>`, `GET /api/replay/<id>` public, OG cards, and any leaderboard query.
Those are steps 6–7 and brain dump §17 Phase 3. Adding a public route now means
answering the abuse and privacy questions for a feature nothing calls yet.

---

## 4. Contract parity — the part most likely to rot

### 4.1 One validator, two adapters

Step 3's plan asked for a Worker "diffable against `vite-capture-plugin.ts`". Diffable
is a property that survives exactly one refactor. Instead, extract the rules into a
runtime-agnostic module both sides import:

```ts
// src/capture-contract.ts — no node:, no Workers globals
export const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;
export const SAFE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
export const SAFE_INSTALL_ID = /^(eph-)?[a-z0-9-]{8,64}$/;

export type ContractStage = "serialize" | "hash" | "compress" | "size" | "parse";
export type ContractResult =
  | { ok: true; capture: CaptureEnvelope; installId: string; ephemeral: boolean }
  | { ok: false; stage: ContractStage; message: string };

export function validateCaptureBody(
  decoded: Uint8Array,
  headers: { build: string; install: string; sha256: string },
  actualSha256: string,
): ContractResult;
```

Compression, hashing, and I/O stay in the adapters — `node:zlib` and `node:crypto` in
the Vite plugin, `DecompressionStream` and `crypto.subtle` in the Worker. The _rules_
live in one place. A change to the accepted schema version or an ID pattern lands on
both sides or neither.

**Scope note, stated plainly:** this refactors shipped step 3 code. It is the smallest
change that makes drift structurally impossible, and the alternative is two
implementations of the same seven checks maintained by vigilance. The dev middleware's
existing endpoint cases must remain and pass afterward; their fixture must satisfy the
full shared boundary contract.

### 4.2 What the Worker must re-validate

Step 4 validates the install id in the browser before storing it. That protects an
honest client from a corrupted `localStorage` and protects the server from nothing.
A hostile caller posts whatever it likes.

- `captureId` and `buildId` against `SAFE_ID` — already in the dev middleware.
- `installId` against `SAFE_INSTALL_ID` — **new here**, because step 5 is the first
  place it becomes a storage path segment.
- An empty `x-dmc-install` with a non-null `meta.installId` (or the reverse) is a
  header/body disagreement and is rejected, exactly as build already is.

---

## 5. Abuse controls — named honestly

§9 of the brain dump proposed an HMAC token signed by a key embedded in the build. The
review folded into `mobile-diagnostics-capture.md` already ruled on this: an embedded
client key is not authentication, because the key ships to every attacker. It may stay
as nuisance friction. It must never be described as the control.

The actual controls:

### 5.1 Rate limiting

Cloudflare's rate-limit binding, two namespaces:

```jsonc
{
  "ratelimits": [
    // period MUST be 10 or 60. No other value is accepted by the binding.
    { "name": "INGEST_IP", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } },
    { "name": "INGEST_INSTALL", "namespace_id": "1002", "simple": { "limit": 5, "period": 60 } },
  ],
}
```

Per-IP guards the endpoint; per-install guards the corpus from one looping client. Both
are checked before decompression, so a flood costs the Worker a key lookup rather than
8 MB of gunzip.

Two constraints of this binding that the numbers above have to live inside, rather than
wish away:

- **`period` accepts only `10` or `60` seconds.** `mobile-diagnostics-capture.md` §5's
  "~50/day/install" is therefore not expressible here. A 60-second window is the
  enforceable approximation, and it is a _burst_ control, not a daily quota. If a real
  daily cap is wanted later it needs a different primitive — a D1 counter keyed by
  `(install_id, day)` checked in the same batch as the insert, or a Durable Object.
  Do not pretend the binding does it.
- **Limits are counted per Cloudflare location, not globally.** A distributed client
  gets roughly `limit × colos`. That is fine for containing an honest looping client and
  useless against a distributed flood, which §5.5 already says out loud.

### 5.2 Size caps

8 MB compressed, 8 MB decoded, enforced on the parsed body and not on `Content-Length`,
which a client controls. The brain dump's 256 KB cap predates the diagnostics event tail
and the 4 MB client ladder; the step 3 numbers are the current truth.

### 5.3 Build allowlist

Optional, off by default: an `ALLOWED_BUILDS` secret rejecting builds that are not
recognized. Useful once TestFlight builds are in the wild and someone is replaying old
captures at the endpoint. Not needed on day one, but the check belongs in the validation
ladder from the start so enabling it is a config change, not a code change.

### 5.4 Retention

- `captures` objects and rows: **90 days** by `received_at`, matching §7 telemetry
  retention.
- `sessions` rows: **1 year** by `received_at`, matching shared-replay retention.

Both windows use the server clock (§2.3). Ageing rows by a client timestamp would let a
capture stamped in the future outlive every sweep.

Two separate mechanisms, and only one of them lives in `wrangler.jsonc`:

- **R2 objects** expire via a bucket **lifecycle rule**, which is bucket configuration,
  not Worker config. It is applied with `wrangler r2 bucket lifecycle` (or the
  dashboard) as an explicit provisioning step, and it must be verified after deployment
  — an unapplied lifecycle rule fails silently and forever. Deletion is asynchronous, so
  the check is "the rule exists with the right prefix and age", not "the object vanished
  on cue".
- **D1 rows** are deleted by the scheduled (`cron`) handler declared in the Worker
  config.

A `sessions` row outliving its blob is fine and expected — the summary is the
leaderboard, the blob is the evidence.

### 5.5 The trust boundary — what the client can lie about

**Everything.** The endpoint is public and unauthenticated by necessity, the game ships
to the player's device, and `curl` is free. Every field in every capture is a _claim_.
The design is sound only if nothing important is derived from an unverified claim.

| Claim                          | Consequence of a lie                                   | Control                                                    |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| `summary.score`, `waveReached` | Forged leaderboard entry                               | **None at step 5.** `replay_verified` gates it (§5.6)      |
| `meta.replayComplete`          | Would forge a "verified" flag if trusted               | Stored as `replay_complete_claimed`, never as verification |
| `meta.installId`               | Per-install rate limit bypass; pollute another install | Format-validated only; see below                           |
| `meta.runId`                   | Overwrite another run's `sessions` row via upsert      | Accepted; impact is bounded to forged rows                 |
| `meta.buildId`                 | Attribute a run to a build that never produced it      | Optional `ALLOWED_BUILDS` (§5.3)                           |
| `x-dmc-sha256`                 | Nothing — the attacker hashes their own forgery        | Integrity against corruption, **not** authenticity         |
| `eph-` prefix                  | Inflate or hide from install counts                    | Accepted; the 20+ gate is a heuristic, not an audit        |

Two consequences worth stating in the open:

- **`x-dmc-sha256` is not a security control.** It proves the body survived the wire
  intact. Anyone forging a payload simply computes the correct hash for it. Treating it
  as authentication would be security theatre with an extra header.
- **Per-install rate limiting is bug containment, not defence.** `installId` is
  client-supplied, so an attacker sends a fresh one per request. It stops a looping
  honest client from filling the bucket; it stops a deliberate attacker for exactly as
  long as it takes them to notice. **Per-IP is the only limiter with teeth**, and it is
  bypassable at the cost of proxies. Size the corpus and the budget for the assumption
  that someone eventually floods it.

None of this is fatal, because step 5 stores anonymous telemetry whose worst-case
corruption is a polluted diagnostics corpus. It becomes fatal the moment a
**leaderboard** reads these rows.

### 5.6 Leaderboard integrity is a step 7 problem that must be decided now

Brain dump §10 names "replay-verified scores" as the killer property. It is also the
only thing standing between a public leaderboard and a single `curl` posting
`score: 999999999`. The schema in §2.3 reserves `replay_verified` for it, defaulted to
0 and never set at step 5.

Verification means **re-simulating the replay server-side and reproducing the claimed
score**. The repo already owns that logic (`src/headless/sim-runner.ts`,
`src/headless/validate-replay.ts`), so the algorithm is not the hard part. The placement
is:

- **Not inline in the ingest request.** Re-simulating a wave-12 run is far past a
  Worker's per-request CPU budget, and putting it in the ingest path hands an attacker a
  CPU-exhaustion lever that costs them one HTTP request.
- **Asynchronously**, after the blob lands: a queue consumer or scheduled job that
  pulls unverified `sessions` rows, re-simulates, and sets `replay_verified` plus
  `verified_at` only on an exact score match. A mismatch is itself a useful signal —
  either a cheat or a determinism bug, and this project has shipped the latter before.
- Re-simulation is only valid **on the build that produced the replay**, since the
  replay runner rejects foreign versions. Cross-build leaderboards need per-build
  segmentation regardless (brain dump §10).

This is out of scope to _build_ here, and in scope to _not foreclose_: the columns
exist, the index depends on them, and nothing in step 5 sets them.

---

## 6. Files

| File                                  | Change                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/capture-contract.ts`             | **New.** Shared limits, ID patterns, stage vocabulary, and `validateCaptureBody`. No runtime imports                                                                       |
| `test-fixtures/capture.ts`            | **New.** One complete capture fixture shared by contract, Vite-adapter, Worker, and real-HTTP tests                                                                        |
| `vite-capture-plugin.ts`              | Refactor to consume the shared validator; preserve existing endpoint cases while enforcing the full boundary contract                                                      |
| `worker/wrangler.jsonc`               | **New.** Worker name, compatibility date, D1 + R2 + rate-limit bindings, cron trigger                                                                                      |
| `worker/src/index.ts`                 | **New.** Router: ingest, retrieval, listing, health, scheduled retention                                                                                                   |
| `worker/src/ingest.ts`                | **New.** The §3.1 ladder, R2 put, D1 writes, `isSessionRow`                                                                                                                |
| `worker/src/projection.ts`            | **New.** Envelope → `captures` row and `sessions` row. Pure                                                                                                                |
| `worker/src/auth.ts`                  | **New.** Constant-time bearer comparison                                                                                                                                   |
| `worker/migrations/0001_init.sql`     | **New.** Both tables and indexes from §2                                                                                                                                   |
| `worker/vitest.config.ts`             | **New.** `@cloudflare/vitest-pool-workers`, migrations loaded via `readD1Migrations`                                                                                       |
| `worker/vitest.http.config.ts`        | **New.** Node-side real-socket regression project that launches temporary `wrangler dev`                                                                                   |
| `worker/test/*.test.ts`               | **New.** §7                                                                                                                                                                |
| `scripts/diag-pull.mjs`               | **New.** `npm run diag:pull <installId\|captureId>` → `diag-results/<captureId>.json`, verified                                                                            |
| `package.json`                        | `test:worker`, `worker:dev`, `worker:deploy`, `diag:pull`                                                                                                                  |
| `.github/workflows/ci-worker.yml`     | **New.** Runs `npm run test:worker`. Matches the repo's one-workflow-per-check convention (`ci-build`, `ci-e2e`, `ci-format`, `ci-lint`, `ci-test`) — there is no `ci.yml` |
| `.github/workflows/deploy-worker.yml` | **New.** Staging on push, production behind a GitHub Environment with required reviewers (§14.1). The only job holding `CLOUDFLARE_API_TOKEN`                              |
| `worker/lifecycle.json`               | **New.** R2 lifecycle rule applied by `wrangler r2 bucket lifecycle` as an explicit provisioning step; not part of `wrangler.jsonc` (§5.4)                                 |
| `.gitignore`                          | `/diag-results/`, `worker/.wrangler/`                                                                                                                                      |

New dev dependencies: `wrangler`, `@cloudflare/vitest-pool-workers`. Both are worker-only
and must not reach the game bundle.

---

## 7. Tests

Run under `@cloudflare/vitest-pool-workers` with real Miniflare D1 and R2, migrations
applied from `worker/migrations` via `readD1Migrations`. Vitest 4 is already the repo's
version, so the pool is a config addition rather than a toolchain change.

**Ingest ladder** — one case per rung, each asserting the `stage` as well as the status:
oversized compressed body; oversized decoded body; SHA mismatch; non-gzip garbage under
a gzip header; wrong `captureSchema`; missing `captureId`; traversal-shaped `captureId`
(`../../etc/x`); traversal-shaped `installId`; header/body build disagreement;
header/body install disagreement; `GET` on the ingest route.

**Storage semantics**

- a gzip upload and an uncompressed upload of the same envelope produce **identical**
  R2 objects and identical `sha256` — the wire encoding does not survive storage;
- the stored object gunzips to bytes whose SHA-256 matches the recorded `sha256`;
- the same `captureId` posted twice yields one R2 object, one `captures` row, and two
  `200`s;
- a D1 failure after a successful R2 put returns `500 { stage: "store" }` and does not
  leave a `captures` row — the orphan blob is acceptable, the phantom row is not.

**Session projection** — the §2.4 predicate, one case per branch: partial capture writes
no `sessions` row; title-screen capture with no run writes none; three gameover captures
of one `runId` produce exactly one row with the last one's values;
`replay_complete_claimed` mirrors `meta.replayComplete` while `replay_verified` stays 0
even when the client claims completeness — asserted explicitly, because that pairing is
the whole point of the split; `in_progress` never appears in `sessions.outcome`;
`install_ephemeral` is 1 for an `eph-` id on both tables.

**Every §2.4 column** of the step 3 mapping is populated from the envelope, asserted
field by field against a fixture capture — the claim "the Worker computes none of them"
is worth exactly as much as its test.

**Auth** — retrieval and listing reject a missing, wrong, and empty bearer; ingest
requires none.

**Hostile payloads** — one case per projected field: missing `meta.platform`;
`summary.score` as a string, as `NaN`, as `Infinity`, as negative; `hitRatio` outside
`[0, 1]`; an unknown `trigger` / `appScreen` / `replaySource` / `outcome`; a `note` past
its length cap; `installId` null and `installId` empty. Each rejects at `stage: "parse"`
and writes **nothing** to R2 or D1.

**Conflict and race** — same `captureId` with the same `sha256` returns `200` and does
not rewrite the object; same `captureId` with different bytes returns
`409 { stage: "conflict" }` and leaves the original blob and row untouched; the same
`captureId` posted under a different `installId` conflicts rather than creating a second
key. Two concurrent posts of the same capture resolve to one object and one row.

**Atomicity** — a forced failure in the `sessions` upsert leaves no `captures` row,
proving the two writes share one `batch()`.

**Rate limiting** — the per-install limiter returns `429 { stage: "rate" }` and does so
_before_ decompression, proven by sending a body that would fail decompression and
asserting the rate stage, not the compress stage.

**Decompression bomb** — a small gzip payload whose expansion exceeds
`MAX_DECODED_BYTES` is rejected at `stage: "size"`, and the test asserts the Worker did
not buffer the full expansion — bounded peak allocation, not merely a correct status
code. Build the fixture from highly compressible filler; a few hundred KB of gzip
expanding to hundreds of MB is the shape being defended against.

**CORS** — ingest answers a preflight from the Capacitor and Pages origins and refuses
an unknown one; retrieval and listing return no `Access-Control-Allow-Origin` at all.

**Trust boundary** — a capture claiming `replayComplete: true` still produces
`replay_verified = 0`, and a capture claiming an absurd `score` is stored without
becoming leaderboard-eligible. These are the §5.5 assertions, and they are the tests
most likely to be deleted by someone who thinks they are redundant.

**Contract parity** — the shared validator is exercised through both adapters against
the same fixture. The existing Vite endpoint cases remain; their minimal fixture was
expanded to the complete boundary contract now required by both adapters.

**HTTP wire parity** — `worker/test/http-wire.test.ts` starts `wrangler dev` with
temporary local D1/R2 persistence and reads `?raw=1` through Node's bare HTTP client.
It asserts that the response has no `Content-Encoding`, gunzips exactly once to the
decoded envelope, and reproduces the recorded SHA-256. This test exists because
`SELF.fetch` does not reproduce workerd's response-encoding behavior across a socket.
The same test sends a small gzip stream representing 192 MB of decoded output, asserts
`stage: "size"`, and confirms the Worker remains healthy afterward.

> **CI wiring.** Follow what step 3 already did: `e2e/capture.spec.ts` is excluded from
> the default Playwright project via `testIgnore` because it needs its own config, and
> `ci-e2e.yml` then runs `npm run test:capture-e2e` as a separate step so it is not
> invisible. Do the same here — `test:worker` gets its own workflow in the same commit
> that adds the tests. A suite nothing runs is decorative.

---

## 8. Local development — what is emulated and what is a lie

The stack is cloud-hosted, but almost none of the development loop needs the cloud.
Wrangler runs the real Workers runtime (`workerd`) locally, with D1 backed by a local
SQLite file and R2 backed by a local directory. That is a genuinely faithful simulation
of the runtime — and a much less faithful simulation of the _platform_. The layers below
are ordered by speed, and the honest boundary is §8.5.

### 8.1 Layer 1 — pure logic, in the existing suite

`src/capture-contract.ts` (§4.1) and `worker/src/projection.ts` have no bindings and no
runtime imports. The validation ladder, the ID allowlists, the `isSessionRow` predicate,
and every envelope→row projection are testable in the repo's normal `npm test` with no
Cloudflare tooling at all. Most of §7's assertions belong here. Anything that _can_ live
in this layer should, because it runs in milliseconds and never breaks for
infrastructure reasons.

### 8.2 Layer 2 — `@cloudflare/vitest-pool-workers` (the CI gate)

Tests run **inside `workerd`** with Miniflare-backed D1 and R2, so bindings, SQL, and
object storage are exercised for real. Storage is isolated per test file automatically,
so tests do not leak rows into each other.

```ts
// worker/vitest.config.ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, "migrations")) } },
    })),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
```

Migrations are read from `worker/migrations` and applied in a setup file, so the schema
under test is the schema that will be deployed — not a hand-written fixture that drifts.

Integration-style tests drive the Worker's own `fetch` handler and then assert against
the bindings directly: post a capture, then read the R2 object and query D1 in the same
test. That is the shape that proves §7's storage semantics.

The `scheduled()` retention handler is tested with `createScheduledController` rather
than by waiting for a cron.

> Confirm the exact test-helper import paths against the installed package version. The
> Cloudflare docs currently show helpers across both `cloudflare:test` and
> `cloudflare:workers` while that surface is in transition; pin what the installed
> version actually exports rather than what a snippet says.

**This layer is `npm run test:worker` and it must be in CI** (§7's note).

#### No Cloudflare credentials are required

`workerd` is the open-source Workers runtime, delivered as a platform-specific npm
binary; Miniflare drives it with D1 on a local SQLite file and R2 on a local directory.
After `npm ci` the suite runs entirely offline. No account, no API token, no
`wrangler login`.

| Needs credentials                                            | Does not                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `wrangler deploy`, `wrangler secret put`                     | `vitest-pool-workers` — any Miniflare-backed test         |
| `wrangler d1 execute --remote`, migrations without `--local` | `wrangler d1 execute --local`, `migrations apply --local` |
| Any binding marked `"remote": true` (§8.4)                   | `wrangler dev` with all-local bindings                    |

So the Worker suite is an ordinary CI job with no repository secrets, which also lets it
run on pull requests from forks:

```yaml
worker-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: npm }
    - run: npm ci
    - run: npm run test:worker # no secrets, no network
```

Three CI-specific traps:

- **`"remote": true` leaking into the tested environment.** It turns an offline suite
  into one that needs `CLOUDFLARE_API_TOKEN`, and the failure reads as a binding error
  rather than an auth error. Keep remote bindings in a named environment the tests never
  load.
- **`workerd` needs glibc.** `ubuntu-latest` is fine; Alpine/musl containers are not.
  Pin the runner rather than discovering this during an unrelated CI change.
- **Real resource IDs in `wrangler.jsonc` are harmless.** Local mode never contacts
  them; the binding only has to be declared. A config full of production identifiers
  does not give the test suite a route to production data.

Deploy and remote-migration jobs are the only ones needing `CLOUDFLARE_API_TOKEN`, and
they belong on a manual or tag trigger, never on every push.

### 8.3 Layer 3 — `wrangler dev` and the curl loop

For hands-on work and the §9 gate:

```bash
npx wrangler d1 migrations apply dmc-captures-local --local --config worker/wrangler.jsonc
npx wrangler dev                    # workerd on :8787, local D1 + R2
```

State persists to `.wrangler/state` between runs, so a capture posted yesterday is still
there today. Inspect it with the same tooling that will inspect production:

```bash
npx wrangler d1 execute dmc-captures-local --local --config worker/wrangler.jsonc --command "SELECT capture_id, partial FROM captures"
npx wrangler r2 object get dmc-captures/<key> --local --file /tmp/out.json.gz
```

Secrets come from `.dev.vars` locally (gitignored) and `wrangler secret put` remotely.
The retrieval bearer token lives in both.

> **The persistence footgun.** `wrangler dev` and the `d1 execute` / `r2 object`
> commands must agree on the persistence directory. If one uses `--persist-to` and the
> other does not, you will query an empty database, conclude the Worker never wrote, and
> spend an hour debugging an ingest path that was working perfectly. Either pass
> `--persist-to` consistently or never pass it at all.

`.wrangler/state` and any custom persistence directory go in `.gitignore`.

### 8.4 Layer 4 — remote bindings (local code, real infrastructure)

This is the layer that matters most given the intent to run on cloud infra, and it is
newer than most tutorials. Individual bindings can be marked `"remote": true` in the
Wrangler config, so the Worker still runs locally with instant reload while R2 and D1
calls hit the **real** cloud resources:

```jsonc
{
  "r2_buckets": [{ "binding": "CAPTURES", "bucket_name": "dmc-captures-staging", "remote": true }],
}
```

Use it against **staging** resources, never production. It is the cheapest way to find
out whether real D1 disagrees with local SQLite about a query, and whether the R2 key
layout behaves under a real bucket.

### 8.5 What local emulation does not catch

The point of listing these is that every one of them is a bug that passes locally and
fails in the cloud:

| Concern                                                               | Why local cannot prove it                                               | Where it gets proven                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| **Edge handling of `Content-Encoding: gzip`** — see the warning below | There is no edge in front of `wrangler dev`                             | Deployed staging, first                                 |
| Per-IP rate limiting (acceptance criterion 8)                         | One client, one IP, one isolate. The limiter has nothing to distinguish | Deployed staging, with a scripted burst                 |
| R2 lifecycle retention rules (§5.4)                                   | Not emulated at all; and real deletion is asynchronous, up to ~24h      | Assert the rule's existence and shape, not the deletion |
| Cron scheduling                                                       | `scheduled()` can be invoked, but nothing schedules it locally          | Deployed; verify the trigger fired                      |
| D1 limits — query duration, rows read/written, batch behavior         | Local SQLite has no quotas and different performance characteristics    | Layer 4 or staging, with a realistic row count          |
| Request body size behavior at the edge                                | Plan-dependent limits sit in front of the Worker, not in it             | Deployed staging, with an 8 MB capture                  |
| Free-tier request/row quotas                                          | Unlimited locally                                                       | Watch the dashboard after real traffic                  |

> ### Validate this before writing anything else
>
> Cloudflare's edge may decompress a gzipped request body before the Worker sees it, or
> alter `Content-Encoding` in transit. If it does, the Worker's decompression rung and
> the `x-dmc-sha256` check — which hashes the **decoded** bytes — would still work, but
> the `Content-Encoding` branch would be dead code and any assumption that the Worker
> receives exactly the client's wire bytes is wrong.
>
> This is cheap to settle and expensive to discover late: deploy a five-line Worker that
> echoes `request.headers.get("content-encoding")` and the received byte length, post
> one gzipped capture at it, and read the answer. Do this **before** implementing §3.1,
> because it decides whether the ingest ladder has two encoding paths or one.

### 8.6 Environments

`wrangler.jsonc` defines `staging` and `production` environments with **separate** D1
databases and R2 buckets. D1's `preview_database_id` keeps `wrangler dev` off the
production database even when someone forgets a flag. Nothing in the development loop
should be capable of writing to the production dataset; the safest way to guarantee that
is for the production binding to require an explicit `--env production`.

---

## 9. Verification — the curl gate

The roadmap's requirement is "`curl`-validated before any client wiring". Concretely,
using a real capture already on disk from step 3:

```bash
# 0. Local Worker with local D1 + R2
npx wrangler d1 migrations apply dmc-captures-local --local --config worker/wrangler.jsonc
npm run worker:dev            # wrangler dev, prints http://127.0.0.1:8787

# 1. Liveness
curl -s http://127.0.0.1:8787/api/health | jq

# 2. Real capture, uncompressed path (the insecure-iPhone shape)
CAP=$(ls -t captures/*.json | head -1)
BUILD=$(jq -r .meta.buildId "$CAP")
INSTALL=$(jq -r '.meta.installId // ""' "$CAP")
SHA=$(shasum -a 256 "$CAP" | cut -d' ' -f1)
curl -s -X POST http://127.0.0.1:8787/api/save-capture \
  -H "Content-Type: application/json" \
  -H "x-dmc-build: $BUILD" -H "x-dmc-install: $INSTALL" -H "x-dmc-sha256: $SHA" \
  --data-binary "@$CAP" | jq

# 2b. Post it again unchanged — a retry, must be 200 with no second object
curl -s -X POST http://127.0.0.1:8787/api/save-capture \
  -H "Content-Type: application/json" \
  -H "x-dmc-build: $BUILD" -H "x-dmc-install: $INSTALL" -H "x-dmc-sha256: $SHA" \
  --data-binary "@$CAP" | jq

# 2c. Same captureId, one byte different — must be 409, nothing overwritten
jq '.meta.note = "collision probe"' "$CAP" > /tmp/collide.json
COLLIDE_SHA=$(shasum -a 256 /tmp/collide.json | cut -d' ' -f1)
curl -s -X POST http://127.0.0.1:8787/api/save-capture \
  -H "Content-Type: application/json" \
  -H "x-dmc-build: $BUILD" -H "x-dmc-install: $INSTALL" -H "x-dmc-sha256: $COLLIDE_SHA" \
  --data-binary "@/tmp/collide.json" | jq   # stage: "conflict"

# 3. Same capture, gzip path — must produce an identical stored object
gzip -c "$CAP" > /tmp/cap.json.gz
curl -s -X POST http://127.0.0.1:8787/api/save-capture \
  -H "Content-Type: application/json" -H "Content-Encoding: gzip" \
  -H "x-dmc-build: $BUILD" -H "x-dmc-install: $INSTALL" -H "x-dmc-sha256: $SHA" \
  --data-binary "@/tmp/cap.json.gz" | jq

# 4. Rejections — each must name the right stage
curl -s -X POST ... -H "x-dmc-sha256: deadbeef" ...          # hash
curl -s -X POST ... (captureId "../../etc/x")                # parse
curl -s -X POST ... -H "x-dmc-build: not-the-build" ...      # parse

# 5. Retrieval and integrity round trip
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8787/api/capture/<captureId>?raw=1" | gunzip | shasum -a 256
# must equal $SHA

# 6. Structure
npx wrangler d1 execute dmc-captures-local --local --config worker/wrangler.jsonc \
  --command "SELECT capture_id, partial, install_ephemeral FROM captures"
npx wrangler d1 execute dmc-captures-local --local --config worker/wrangler.jsonc \
  --command "SELECT run_id, outcome, score, replay_complete_claimed, replay_verified FROM sessions"
```

Then the proof that matters, the same one step 3 used: the artifact is only worth
storing if it still plays.

```bash
npm run diag:pull <captureId>
jq .replay diag-results/<captureId>.json > recovered.json
npx tsx src/headless/validate-replay.ts --file recovered.json   # zero divergences
npx tsx play-replay.ts recovered.json
```

Repeat steps 1–6 against the deployed Worker before step 6 begins. A backend that works
only on `wrangler dev` has validated the SDK, not the deployment.

---

## 10. Acceptance criteria

1. A capture posted with `Content-Encoding: gzip` and the same capture posted
   uncompressed produce identical R2 objects, identical `sha256`, and identical rows.
2. The stored object, gunzipped, matches the `sha256` recorded at ingest, and its
   `replay` field passes `validateReplay()` with zero divergences.
3. Every §2.4 column has exactly one declared source, proven column by column against a
   fixture. Four are server-owned by design and the Worker does compute those:
   `received_at`, `replay_verified`, `stored_bytes`, and `replay_size` (§2.3's
   definition — the replay's own serialized length, not the R2 object's).
4. A partial capture never produces a `sessions` row; several completed captures of one
   `runId` produce exactly one.
5. Every rejection names the correct stage. A request rejected at **validation** — any
   `400`, `409`, or `429` — writes nothing to R2 or D1. A failure _after_ the R2 put may
   leave an orphan blob and no row; that is the accepted direction (§1) and never the
   reverse.
6. A retried upload of the same `captureId` and `sha256` produces one object, one row,
   and a success. The same `captureId` with different bytes produces `409` and changes
   nothing.
   6a. A failure in the `sessions` upsert leaves no `captures` row, proving both writes
   share one transactional `batch()`.
   6b. Every field projected into a `NOT NULL` column is validated at ingest; a capture
   missing one, or carrying a wrong type, out-of-range number, unknown enum value, or a
   null/empty `installId`, is rejected rather than inserted.
7. Retrieval and listing are unreachable without the bearer secret; ingest needs none.
8. Rate limits trigger before decompression.
9. `install_ephemeral` is set for `eph-` ids and excluded from the leaderboard index.
10. The production game bundle makes zero requests to the Worker — step 5 ships no
    client change, and its capture channel remains `off`.
11. `npm run test:worker` runs in CI in the same commit that introduces it.
12. The full curl gate passes against a deployed Worker, not only `wrangler dev`, and
    the R2 lifecycle rule is confirmed applied to the real bucket.
    12a. Retention ages rows by `received_at`; a capture claiming a far-future
    `capturedAt` is still swept on schedule.
13. A crafted gzip body that expands past `MAX_DECODED_BYTES` is rejected at
    `stage: "size"` **without** the Worker buffering the full expansion.
14. `replay_verified` is 0 for every row step 5 writes, including rows whose capture
    claimed `replayComplete: true`. No code path in this step sets it.
15. Retrieval and listing return no permissive CORS headers; ingest accepts only the
    allowlisted game origins.

---

## 11. Out of scope (and where it goes)

- Triggers, the "Report a bug" button, feedback emoji, and turning the endpoint on in
  production — step 6. This step ships no client change at all.
- Leaderboard queries and the 20+ install gate — step 7. §2.3's indexes are the
  groundwork; the query is not written here.
- Share links, `GET /r/<id>`, OG preview cards, public retrieval — brain dump §17
  Phase 3.
- Auto-stream consent tier — brain dump §5. This step has no consent surface because it
  has no client caller.
- Screenshots — `attachments` is still reserved and still empty.
- Stop-at-tick truncation for partial replays — flight recorder phase 2.

---

## 12. Provisioning values and resolved defaults

The implementation uses the proposed defaults below. Only the real Cloudflare resource
identifiers remain pending.

1. **Cloudflare account, Worker name, and custom domain.** Pending account and resource
   IDs. The configuration uses `dmc-captures` and `workers.dev`, with conspicuous
   placeholder IDs until the resources are provisioned.
2. **Retention numbers.** Resolved: 90 days for captures and 1 year for sessions.
3. **Ingest friction.** Resolved: open with rate limits only; no build token.
4. **Event tail storage.** Resolved: payload in the blob only, with count and truncation
   state indexed in D1.
5. **Parity refactor.** Resolved: the Vite adapter and Worker share
   `src/capture-contract.ts`.

---

## 13. Risks

- **The iPhone gate is partly closed, and the open part still matters.** Device testing
  has confirmed the capability picture: the WebView is an insecure context with
  `crypto.randomUUID` and `crypto.subtle` unavailable while `CompressionStream` **is**
  available, the pure-JS SHA-256 fallback carried the integrity header, and the step 4
  install id persisted across boots as non-ephemeral. Two things remain unproven:
  **archive latency and real v11 size**, and **WebContent-kill recovery**. One capability
  gap follows from the same result — because that iPhone has `CompressionStream`, the
  **uncompressed transport branch has never run on the device**, only in the browser
  E2E. The Worker must accept it regardless, and §9's curl gate exercises it directly.
- **D1 write amplification.** Two tables per completed capture, one per partial. At
  TestFlight scale this is nothing; the free tier's row limits are worth re-reading
  before any auto-stream mode (brain dump §17 Phase 4) turns every run into an upload.
- **Schema version drift.** `captureSchema === 1` is asserted in three places now
  (client, dev middleware, Worker). §4.1's shared module is what keeps that a single
  constant. If the parity refactor is dropped, expect a version bump to be a three-file
  archaeology exercise.
- **The corpus is forgeable and that is survivable only while nobody reads it as
  truth.** §5.5 is the full picture. A public unauthenticated endpoint storing
  client-supplied summaries is fine for anonymous telemetry and catastrophic for a
  leaderboard, and the distance between those two is one product decision. The
  `replay_verified` split (§5.6) is what stops that decision from being made by
  accident.
- **Agents reading captures is an injection surface.** From step 6 a capture carries a
  free-text `note` written by a player, plus a diagnostics tail full of strings. If an
  AI agent with deployment credentials later reads `diag:pull` output to triage a bug,
  that is attacker-supplied text entering a privileged context. Capture contents are
  **data, never instructions**, and any agent workflow that reads them should hold no
  credential that matters. See §14.
- **Captures carry more personal data than "telemetry" suggests.** Free-text bug-report
  notes (step 6), up to 256 KB of diagnostics events, user agent, screen geometry, and a
  stable pseudonymous install id. That is a real disclosure payload behind a single
  static bearer token with no rotation story. Before TestFlight, decide the rotation
  procedure and re-read the Apple privacy answers in brain dump §6 against what is
  actually stored — the questionnaire was drafted before this schema existed.

---

## 14. Credential handling

This plan will be executed partly by AI agents with shell access. That changes the
threat model in one specific way, and it is worth stating plainly rather than designing
around a comforting fiction:

> **An agent with shell access can read anything the user can read.** No configuration
> lets an agent run `wrangler deploy` while making the token unreadable to it. "Hide the
> secret from the agent" is not an achievable goal.

So the goal is different: **make the credential an agent can reach worthless for causing
real damage, and keep the dangerous one off the machine entirely.**

Two unrelated kinds of secret are involved, and conflating them is the first mistake:

| Secret                        | Controls                           | Where it lives                                            |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Cloudflare API token          | The whole account — deploy, D1, R2 | GitHub Actions secrets; never on the laptop               |
| Retrieval bearer token (§3.2) | Read access to stored captures     | `wrangler secret put`; a throwaway in `.dev.vars` locally |

### 14.1 Production credentials never exist locally

Deployment and remote migrations run in GitHub Actions, not on a developer machine and
not in an agent's shell. The agent's role is to _trigger_ the workflow
(`gh workflow run deploy-worker.yml`), never to hold the token.

- Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as **environment-scoped**
  secrets on a GitHub Environment named `production`, with **required reviewers**. A job
  targeting that environment pauses for an approval click; the secret is not injected
  into any job that has not been approved.
- Staging gets its own environment and its own token, auto-approved.
- Actions masks secret values in logs. Do not defeat that by echoing them.

**The attack path this leaves open**, because pretending otherwise would be useless: an
agent can edit `.github/workflows/*` to add a step that exfiltrates the secret. Close it
with branch protection on `main` requiring review, `CODEOWNERS` covering
`.github/workflows/`, and the habit of reading workflow diffs specifically rather than
skimming them as config noise.

### 14.2 The credential an agent may hold is staging-only and scoped

When an agent genuinely needs layer 4 (§8.4) or a remote staging migration, it gets a
token that is deliberately boring to steal:

- least privilege — Workers Scripts / D1 / R2 edit, on **one** account, scoped to
  staging resources;
- an **expiry date**, short enough that a forgotten leak dies on its own;
- an IP allowlist where the network makes that practical;
- no production resources in scope, at all.

Worst case for a leak: someone deploys nonsense to a staging Worker and reads a staging
capture corpus. Annoying, recoverable, and not the production dataset.

### 14.3 Inject per command; do not persist in the shell

Keep the value out of the repo tree, out of dotfiles the agent greps, and out of a
long-lived exported environment variable:

```bash
# 1Password CLI — the value never touches disk
op run --env-file=.op.env -- npx wrangler d1 migrations apply dmc-captures --env staging --remote

# or macOS Keychain, read at call time by a wrapper script
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s dmc-cf-staging -w)" npx wrangler ...
```

`wrangler login` (OAuth, stored under `~/.wrangler/`) is also acceptable for interactive
human use and is preferable to a long-lived API token in a file. It is still readable by
a shell agent, which is exactly why §14.1 exists.

### 14.4 Harness guardrails

Cheap, and they convert a plausible accident into a blocked tool call:

- Deny reads of credential material in `.claude/settings.json` — `.dev.vars`, `.env*`,
  `~/.wrangler/**`, `~/.config/op/**`.
- Require explicit approval for `wrangler deploy`, `wrangler secret put`, and any
  command carrying `--env production` or `--remote`.
- A `PreToolUse` hook rejecting commands that pipe credential-shaped files into `curl`,
  `nc`, `gh`, or a commit.

These stop mistakes. They do not stop a determined process, and they are not the control
that matters — §14.1 is.

### 14.5 Detection, because rotation is inevitable

- `.gitignore` covers `.env*`, `.dev.vars*`, and `.wrangler/` **before** those files
  first appear. The accident is a new secret file landing in a repo whose ignore rule
  was going to be added right after this one commit.
- Enable GitHub secret scanning **with push protection**; Cloudflare tokens are a
  recognized pattern and the push is refused rather than reported after the fact.
- Add a `gitleaks` scan to the existing `.githooks/pre-commit`, which already runs
  Prettier and ESLint on staged files.
- Write the rotation runbook before the first deploy, not during the first incident:
  revoke in the dashboard, mint, update the GitHub Environment secret, redeploy. It is a
  five-minute procedure that feels impossible to reconstruct under pressure.

### 14.6 Never let a credentialed agent act on capture contents

From step 6, captures carry player-written notes and arbitrary diagnostics strings. An
agent triaging `diag:pull` output is reading attacker-influenced text. Treat that content
as **data, not instructions**, and keep triage workflows credential-free. The system's
own inputs should not be able to talk to the thing that can deploy it.
