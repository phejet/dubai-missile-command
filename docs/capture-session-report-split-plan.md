# Capture Split — Session Upload vs Problem Report

Status: implemented and locally verified; Cloudflare provisioning/deployment pending. Revises [`capture-worker-backend-plan.md`](./capture-worker-backend-plan.md)
(step 5 of the §17 roadmap) before any Cloudflare resource exists.
Date: 2026-08-03

**This is a schema edit, not a migration.** `worker/wrangler.jsonc` still carries
placeholder account and database IDs, `0001_init.sql` has never run against a real D1,
and `vite.config.ts:57` pins `__DMC_CAPTURE_ENDPOINT__` to `null` in production builds.
The only callers of the shipped ingest path are the dev middleware and the test suite.
Every change below is free today and expensive the day after provisioning.

Sections of the parent plan this **supersedes**: §2.1, §2.2, §2.4, §3.1–§3.3, §5.4,
§6, §10 (criteria 1, 3, 4, 6, 6a, 12a), §12.2, §12.4. Everything else in that document
carries forward unchanged and is listed explicitly in §8 so it does not get
re-litigated.

---

## 1. Why this revision exists

The shipped design stores one `CaptureEnvelope` per upload — summary, replay, and
diagnostics event tail in a single blob under one `captures` table. That shape has three
defects. Only the first is about privacy, which is why "just don't put events in the
gameover capture" is not a fix.

### 1.1 Privacy is enforced by convention, in the wrong place

`src/game.ts:1436` calls `readRecentEvents(EVENT_TAIL_MAX_BYTES)` **unconditionally**,
before the code knows what kind of capture it is building. Every envelope carries up to
256 KB of diagnostics.

This is currently harmless for two reasons that both expire on schedule. Production has
no endpoint (step 6 wires it). And diagnostics logging is opt-in — `diagnostics-log.ts:63`
defaults `enabled = false`, so the tail is empty for players who never opened the
options menu.

What survives both caveats: the population that _has_ enabled diagnostics is precisely
the TestFlight and QA population whose runs you most want streaming automatically. For
them, §17 Phase 4's auto-stream toggle turns one deliberate act ("help me debug this
crash") into a standing grant ("ship my log with every game over, forever"). Nothing in
the type system, the wire contract, or the storage layout distinguishes those two
things. A comment in a plan document is the only thing that ever did.

### 1.2 Retention contradicts itself

§5.4 retains `sessions` rows for **1 year**. `worker/lifecycle.json` deletes everything
under `captures/` at **90 days** — and the replay lives inside that object. A leaderboard
row therefore outlives its own evidence by nine months, and §17 Phase 5's "tap entry →
watch replay" 404s on anything older than a quarter.

The parent plan blesses this outcome: _"A `sessions` row outliving its blob is fine and
expected — the summary is the leaderboard, the blob is the evidence."_ That is correct
for a diagnostic capture and wrong for a replay you have promised to serve. One blob
holding both kinds of thing cannot express two retention policies, so it expresses the
shorter one and calls the result intentional.

### 1.3 `captureId` is a client-supplied name for content

The R2 key is `captures/<installId>/<captureId>.json.gz` and both segments are client
claims, pinned into consistency by a conflict rule (§3.1's `captureId`-collision check)
that exists only because the name carries no relationship to the bytes. Step 7's
`replay_verified` column would then certify a row pointing at a mutable name.

Content addressing removes the conflict rule rather than defending it, and gives
verification a stable subject. Deduplication between a session upload and a later
problem report of the same run is a side effect, not the motivation. Client assembly
makes that side effect real for production-shaped replays by removing `_env` from the
replay on both paths before hashing. A report preserves that recorder context separately
as `meta.replayEnv`. §5.3 still bounds how much deduplication to expect, since two
semantically-equal replays with different key order hash differently and simply produce
two objects.

The mutable-name problem does not vanish from the system, it just stops applying to
replays: `reportId` is still a client-supplied name for a diagnostics object, and §6.3
gives it the conflict protocol that implies.

### 1.4 What this revision explicitly does not build

No diagnostic deltas, event cursors, base-capture chains, diagnostic segments,
automatic ring-buffer transmission, or reconstruction across several uploads. None of
that exists in the repo today — it was a proposal, not code, so nothing has to be
un-built.

Repeated problem reports from one install will re-send overlapping tails. At
human-report frequency that is a rounding error against a 256 KB cap, and the machinery
to avoid it is a small log-structured filesystem with its own consistency bugs. The
overlap is accepted, deliberately, and this paragraph is the record of that decision.

---

## 2. Two products, two contracts

|                     | **Session upload**                                   | **Problem report**                           |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Trigger             | Automatic at game over (step 6), or the share button | A human presses "Report a problem"           |
| Frequency           | Every completed run                                  | Rare, deliberate                             |
| Carries diagnostics | **Never — the field does not exist on the type**     | Yes, latest ≤256 KB tail                     |
| Carries a replay    | The completed run's replay                           | Whatever replay is current, possibly partial |
| Carries free text   | Feedback note (step 6)                               | Bug note                                     |
| Route               | `POST /api/session`                                  | `POST /api/report`                           |
| Client function     | `uploadSession()`                                    | `reportProblem()`                            |
| D1 destination      | `sessions` (+ `replays`)                             | `diagnostic_reports` (+ `replays`)           |
| R2 objects written  | **None of its own** — only the shared replay         | `diagnostics/<installId>/<reportId>.json.gz` |
| Retention           | 1 year                                               | 90 days                                      |

The last row of storage is the point worth dwelling on. Once the replay is extracted to
its own content-addressed object and the summary is projected into columns, a session
upload has **nothing left over to store as a blob**. There is no container into which an
events array could be smuggled, because there is no container. Privacy stops being a
property of the code that fills the envelope and becomes a property of the storage
layout.

### 2.1 Enforcement is two-sided, because a type is not a wire

`SessionUpload` omitting `events` prevents an honest client from sending them. It does
nothing about a wider object passed to `JSON.stringify`, and nothing at all about
`curl`. So the Worker's session validator **rejects a body carrying an `events`,
`eventsUnparsed`, `eventsTruncated`, or `attachments` key** at `stage: "parse"` — not
ignore, not strip. Rejecting rather than stripping means a client that regresses fails
loudly in CI instead of silently uploading and having the server quietly launder it.

The type stops the accident; the rejection stops the regression; together they are the
"privacy enforced by types and code paths" this revision is for.

---

## 3. Storage design

### 3.1 R2 layout

```
replays/<sha256>.json.gz                        # content-addressed, shared
diagnostics/<installId>/<reportId>.json.gz      # one owner, never shared
```

Two prefixes, two lifetimes, two ownership models — and the layout says so without a
lookup. `installId` still leads the diagnostics key so `diag:pull <installId>` stays a
prefix list. Replays are enumerated through D1, which is what the indexes are for; there
is no second key format for replays and there must never be one.

Both path segments are validated against `SAFE_INSTALL_ID` / `SAFE_ID` before use, and
`<sha256>` against `/^[a-f0-9]{64}$/` — unchanged from parent §4.2, now with one more
segment to check.

### 3.2 `replays` — content facts only

```sql
CREATE TABLE replays (
  replay_sha256 TEXT PRIMARY KEY,   -- of the serialized replay JSON, not the request body
  first_seen_at INTEGER NOT NULL,   -- server clock, first reference
  last_referenced_at INTEGER NOT NULL, -- server clock, most recent reference
  raw_bytes     INTEGER NOT NULL,   -- serialized replay length
  stored_bytes  INTEGER NOT NULL,   -- gzipped object size
  r2_key        TEXT NOT NULL
);
```

There is no retention column and no index on one. Row lifetime is decided by whether a
referrer still exists (§4.4); object lifetime is decided by object age (§4.2).
`last_referenced_at` stores no policy — it exists so the §4.2 invariant is checkable
from D1 (`now − last_referenced_at` should track object age), which is what makes a
silently misapplied lifecycle rule detectable instead of merely regrettable.

**This table holds nothing the Worker did not compute from the bytes.** No `build`, no
`complete_claimed`, no `final_tick`. Those are properties of a _claim about_ a replay,
they differ between referrers, and two referrers of identical bytes could assert
different values — so they live on the referring row (`sessions.replay_complete_claimed`
already exists for exactly this reason, parent §2.3). A content-addressed table that
stores claims re-invents the conflict rule §1.3 just deleted.

Step 7 gets the build it must re-simulate under from `sessions.build`.

### 3.3 `sessions` — completed runs

Parent §2.3's schema, with four edits:

- **`capture_id` is dropped.** There is no `captures` table. `run_id` remains the primary
  key and the upsert key.
- **`replay_sha256` becomes a real reference** into `replays.replay_sha256` rather than a
  recorded string. `replay_size` keeps parent §2.3's definition — the replay's own
  serialized length — and is now simply `replays.raw_bytes`, so the column is redundant
  and is dropped in favour of a join.
- **`env_json` is deliberately not added.** The session upload carries `platform` and
  `inputClass`, which already have columns, and nothing else about the device. The full
  `ReplayEnvironment` block — user agent, screen geometry, capability flags — travels
  only on the report path, where it is diagnostically necessary and separately consented
  to. This is the last reason a session upload would need a blob, and removing it is what
  makes §2's "no object of its own" true. Because `ReplayData` also has an optional
  `_env`, both assemblers remove that field before hashing and both validators reject it
  on the wire; otherwise the environment would simply sneak through inside the shared
  replay object. Report assembly hoists the removed value to `meta.replayEnv`, keeping
  the original recorder's environment distinct from `meta.env`, which describes the
  environment sending the report (not necessarily the same device during playback).
- **`replay_omitted_reason` is added.** A replay-less retrieval must distinguish a replay
  intentionally omitted by the client (`size` / `unavailable`) from a referenced replay
  whose row has expired or whose object is unexpectedly missing (§6.1). With no session
  blob, that reason has to survive in the projected row.

Everything else carries: `received_at` as the only server-clock retention and ordering
key, `install_ephemeral` computed at ingest rather than by `LIKE 'eph-%'`,
`replay_complete_claimed` vs `replay_verified` split, the three indexes, and
`replay_verified = 0` for every row this step writes.

### 3.4 `diagnostic_reports` — human-triggered, self-contained

```sql
CREATE TABLE diagnostic_reports (
  report_id     TEXT PRIMARY KEY,
  install_id    TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0,
  run_id        TEXT,                        -- null when reported from the title screen
  boot_id       TEXT NOT NULL,
  build         TEXT NOT NULL,
  platform      TEXT NOT NULL,
  input_class   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,            -- CLIENT CLAIM. Display only.
  received_at   INTEGER NOT NULL,            -- SERVER FACT. Retention and ordering key.
  app_screen    TEXT NOT NULL,
  trigger       TEXT NOT NULL,               -- manual | agent. "gameover" cannot reach here.
  note          TEXT,                        -- the human's description
  partial       INTEGER NOT NULL,
  captured_through_tick INTEGER,
  replay_sha256 TEXT,                        -- reference into replays; null when none
  replay_source TEXT NOT NULL,               -- live | last-completed | playback | none
  replay_omitted_reason TEXT,
  events_count  INTEGER NOT NULL,
  events_truncated INTEGER NOT NULL,
  sha256        TEXT NOT NULL,               -- of the stored report body (replay excluded)
  raw_bytes     INTEGER NOT NULL,
  stored_bytes  INTEGER NOT NULL,
  r2_key        TEXT NOT NULL
);

CREATE INDEX idx_reports_install ON diagnostic_reports(install_id, received_at DESC);
CREATE INDEX idx_reports_run ON diagnostic_reports(run_id);
CREATE INDEX idx_reports_received ON diagnostic_reports(received_at DESC);
```

`trigger` accepts only `manual` and `agent`. A body claiming `gameover` on this route is
rejected — the enum is the second place the two products are held apart, after the type.

**`sha256` is of the stored body, not the request body.** The Worker removes `replay`
before storing, so the hash the client sent covers bytes that no longer exist as a unit.
See §5.3 for how integrity is preserved across that split; it is the one genuinely
delicate part of this design.

### 3.5 The predicates

Two, each written once and tested directly:

```ts
// A session upload is rejected outright if this does not hold.
const isSession = kind === "session" && meta.partial === false && summary !== null && meta.runId !== null;

// A report accepts anything; partial, run-less, and replay-less are all valid.
```

Parent §2.4 made the session predicate a _filter_ — a capture that failed it simply
produced no `sessions` row. Now it is a **precondition**: a caller posting a partial run
to `/api/session` gets a `400`, because it is using the wrong product, and silently
accepting-then-discarding is how an upload path acquires a second undocumented meaning.

---

## 4. Retention — the part that needs the most care

### 4.1 Windows

| Object or row             | Window                             | Mechanism         |
| ------------------------- | ---------------------------------- | ----------------- |
| `sessions` rows           | 365 d by `received_at`             | cron              |
| `diagnostic_reports` rows | 90 d by `received_at`              | cron              |
| `diagnostics/` objects    | 90 d by object age                 | R2 lifecycle rule |
| `replays` rows            | when no referrer remains           | cron (§4.4)       |
| `replays/` objects        | 400 d since the **last reference** | R2 lifecycle rule |

The last row is the whole design. §4.2 explains why the object window is 400 days rather
than 365, and why "since the last reference" is a property the storage layer maintains
for free rather than something a column has to track.

### 4.2 The rule: nothing deletes a replay object except its own age

An earlier draft of this plan had cron delete replay objects on a `retain_until`
timestamp, with a `head()` on the dedup path to repair references. **That was wrong and
it is worth recording why**, because the failure is one step past where the reasoning
usually stops.

D1 and R2 cannot be committed together. So this interleaving exists no matter how the
statements are ordered: cron's `DELETE ... RETURNING r2_key` matches a row whose
concurrent bump has not yet committed, cron deletes the object, and the ingest then
commits a row referencing the key cron just removed. A `head()` before the commit does
not help — it observes a world that the sweep invalidates a millisecond later. Closing
this properly needs a real protocol: a deletion state ingest must observe and retry
against, generation-suffixed keys, or per-hash serialization through a Durable Object.

All three are more machinery than the problem deserves, because the problem is
self-inflicted. It exists only because cron deletes objects at all.

**So cron does not delete replay objects. Ever.** The GC responsibilities split cleanly:

| Actor             | Deletes                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| cron              | D1 rows only — `sessions`, `diagnostic_reports`, and unreferenced `replays` |
| R2 lifecycle rule | `diagnostics/` objects at 90 d, `replays/` objects at **400 d** of age      |
| anything else     | nothing                                                                     |

And ingest **always puts the replay object, unconditionally**, on every reference —
including a dedup hit.

### 4.3 Why the unconditional put makes the race disappear

Two properties do the work.

**An unconditional put is safe here, where it would not be elsewhere.** The key is the
hash of the content and the Worker _recomputes_ that hash (§5.3), so a put to key `K`
can only ever carry bytes that hash to `K`. There is no "same name, different bytes"
case to defend against — that was the entire job of `ingest.ts:276`'s
`onlyIf: { etagDoesNotMatch: "*" }`, and content addressing retires it. Two concurrent
puts of the same key write identical content; last-writer-wins is a no-op. Even a
non-deterministic gzip encoder is harmless: a differing compressed encoding of identical
replay JSON still gunzips to bytes matching the key.

**An unconditional put resets the object's lifecycle clock.** R2 ages an object from its
most recent upload, so after this change:

```
object age  ==  time since the most recent reference
```

which is exactly the quantity the original design was trying to track in a column.

The invariant follows in one line. A `replays` row is live only while some referrer row
is live; a referrer is live for at most 365 days past its own `received_at`; and the
object was re-put at every referrer's ingest, so its age is at most
`now − max(received_at)` over referrers. Therefore **while any referrer is live, the
object's age is under 365 days** — comfortably inside a 400-day lifecycle rule, with 35
days of slack absorbing clock skew and sweep latency.

No coordination, no protocol, no `retain_until` column, no bump, and therefore no bump
to race with. The cost is re-uploading ~25 KB of gzip on the rare dedup hit, and orphan
objects lingering up to 400 days at R2's $0.015/GB-month. That is the correct trade
against a Durable Object and a retry loop.

### 4.4 Row GC is referential, not temporal

With `retain_until` gone, `replays` rows expire when nothing points at them:

```sql
DELETE FROM sessions           WHERE received_at < :now - 365d;
DELETE FROM diagnostic_reports WHERE received_at < :now - 90d;
DELETE FROM replays
 WHERE NOT EXISTS (SELECT 1 FROM sessions           WHERE replay_sha256 = replays.replay_sha256)
   AND NOT EXISTS (SELECT 1 FROM diagnostic_reports WHERE replay_sha256 = replays.replay_sha256);
```

Run in that order, in one `batch()`. This is exact rather than approximate — a replay
referenced only by a report is collected when the report goes, and one referenced by a
session survives to the session's window, with no per-referrer window arithmetic and no
`kind` column deciding which rule applies. The `replay_sha256` indexes on both referring
tables are what keep the `NOT EXISTS` pair cheap.

An orphan `replays` row surviving one extra sweep is harmless; an orphan object is
collected by age. Neither can produce a live row pointing at a missing object, which is
the only failure that was ever worth engineering against.

---

## 5. Client contracts

### 5.1 Two envelopes, one schema version

`captureSchema` goes to **2** and 1 is rejected. There is no deployed producer to keep
compatible, and a shape this different sharing a version number is how a validator ends
up with an `if` in it.

```ts
// src/capture.ts

interface SessionUpload {
  captureSchema: 2;
  kind: "session";
  meta: SessionMeta; // runId is the identity; no `env`; platform + inputClass only
  summary: CaptureSummary; // never null — that is what makes it a session
  replay: ReplayData | null;
  replayOmitted?: { reason: "size" | "unavailable"; checkpointsDropped?: boolean };
  // No events. No eventsUnparsed. No eventsTruncated. No attachments.
}

interface ProblemReport {
  captureSchema: 2;
  kind: "report";
  reportId: string;
  meta: ReportMeta; // env is the reporter; replayEnv optionally preserves the recorder
  summary: CaptureSummary | null;
  replay: ReplayData | null;
  replayOmitted?: { reason: "size" | "unavailable"; checkpointsDropped?: boolean };
  events: Record<string, unknown>[];
  eventsUnparsed: number;
  eventsTruncated: boolean;
  attachments: []; // reserved; a non-empty array is rejected until attachments ship
}
```

`CaptureEnvelope` is deleted rather than aliased. A union type both paths accept would
restore the exact ambiguity this revision removes.

**A session upload has exactly one identity, and it is `meta.runId`.** An earlier draft
carried a `sessionId` inherited from `captureId`, which was never stored, never
constrained against `runId`, and would have been a second authority over which row a
retry updates. `sessions.run_id` is the primary key and the upsert key; there is nothing
else to name. Reports keep `reportId` because there they _are_ the primary key — a
report is not a run and several can describe one.

**`attachments` is typed as `[]` and validated as empty.** Parent §11 reserves the field
and this plan keeps it reserved; accepting an arbitrary `CaptureAttachment[]` while
documenting that it stays empty is how a reserved field quietly becomes a shipped one. A
non-empty array is rejected at `stage: "parse"` until attachments have a design, a size
cap, and a retention answer of their own.

### 5.2 Two transports

`uploadCapture()` becomes `uploadSession()` and `reportProblem()` in
`src/capture-sink.ts`. They share the header construction, gzip, and hashing helpers —
the duplication worth avoiding is the transport, not the call site. What they must not
share is a parameter that decides which product this is at runtime.

`src/game.ts:1436`'s unconditional `readRecentEvents` moves inside `reportProblem`'s
assembly path. The session path cannot reach it.

Dispatch follows capture state, not the trigger string: a complete, non-partial run with
a `runId` and summary is a session when shared manually as well as at game over.
`trigger` remains a label inside the chosen product. Partial, run-less, playback, and
agent captures remain reports, and only those paths read the diagnostics tail.

### 5.3 Hashing across the replay split — the delicate part

The client hashes the whole body and sends `x-dmc-sha256`. The Worker then _splits_ that
body, so the client's hash covers a unit that is never stored. Getting this wrong
produces a system where integrity is asserted everywhere and verifiable nowhere.

The rule, stated once:

- **`x-dmc-sha256` covers the decoded request body, exactly as today.** It is checked at
  rung 5 of the ladder, before anything is split, and it proves wire integrity. It is
  never stored as any row's `sha256`.
- **`meta.replaySha256`** is the client's claim about the replay alone. The Worker
  **recomputes** it from `JSON.stringify(body.replay)` and rejects a mismatch at
  `stage: "hash"`. The recomputed value — never the claimed one — becomes the R2 key and
  the `replays` primary key.
- **`diagnostic_reports.sha256`** is computed by the Worker over the report body _after_
  the replay is removed, so `gunzip | sha256sum` on the stored object still verifies, and
  parent acceptance criterion 2 survives in a modified form (§10).

The recomputation is what makes the key trustworthy as a key. It does **not** make it
authentication: an attacker uploads whatever bytes they like and gets a correct hash of
their forgery. Parent §5.5's table gains one row saying so, because "content-addressed"
reads like a security property to anyone who has not thought about it for a minute.

**What the split can and cannot promise, stated exactly.** JSON is not a canonical
encoding — whitespace and key order are free variables — so a parse/serialize round trip
does not reproduce input bytes. Three consequences follow, and pretending otherwise is
how a byte-exactness claim becomes a flaky test:

- **Integrity at rest is byte-exact.** Every stored object's hash is computed by the
  Worker over the bytes it actually stores. `gunzip | sha256sum` verifies against
  `diagnostic_reports.sha256` or against the `replays/<sha256>` key. This is the property
  that matters and it survives untouched.
- **Integrity over the wire is byte-exact.** `x-dmc-sha256` covers what the client sent.
- **Reassembly on retrieval is _semantic_, not byte-exact.** A downloaded report equals
  the original report body as a JSON value — same keys, same values, replay re-inlined —
  and may differ in whitespace and key order. §9's test asserts deep equality after
  parsing, never byte equality.

The alternative — defining a canonical JSON encoding and applying it before hashing,
splitting, and reassembly — would have to be implemented identically in the client, the
Vite adapter, and the Worker, and would make every hash depend on three implementations
of a sorting rule agreeing forever. That is a large new drift surface bought to make a
test assertion prettier. Semantic equality is the honest contract.

The same reasoning bounds the dedup claim in §1.3: two clients whose serializers emit
semantically-equal replays with different key order produce different hashes and
therefore two objects. Dedup is opportunistic, not guaranteed, and nothing in §4 depends
on it firing.

### 5.4 The size ladder splits in two

`assembleCapture`'s ladder (`src/capture.ts:159-197`) — drop checkpoints → halve events →
drop events → drop replay, all against one 4 MB budget — describes a payload that will
no longer exist. It becomes:

```
assembleSession:  full replay → drop checkpoints → drop replay entirely
assembleReport:   full → drop checkpoints → halve event tail → drop events → drop replay
```

The session ladder is shorter because there is nothing to trade the replay against,
which is the correct behaviour: a session upload whose replay does not fit should shed
replay fidelity, never quietly become a summary-only row that looks identical to a
successful one. `replayOmitted` is what distinguishes them and it must survive both
ladders.

> **Open question, flagged not decided.** The measured archive in `tasks/todo.md`:
> 351,969 raw bytes, 25,493 gzipped, of which **checkpoints are 260,421 bytes and
> 186,006 of those are duplicated diagnostic state**. Checkpoints exist for divergence
> detection, not for step 7 re-simulation, which replays the action log. Whether session
> uploads should drop checkpoints unconditionally rather than only under size pressure is
> a real question with a real 70%-payload answer attached. It is not settled here because
> it trades away the divergence signal this project has needed before.

---

## 6. Worker routes

| Route                       | Auth               | Purpose                                              |
| --------------------------- | ------------------ | ---------------------------------------------------- |
| `POST /api/session`         | none (rate limits) | Session upload                                       |
| `POST /api/report`          | none (rate limits) | Problem report                                       |
| `GET /api/session/:runId`   | bearer             | Row + referenced replay, assembled                   |
| `GET /api/report/:reportId` | bearer             | Report + referenced replay, assembled                |
| `GET /api/replay/:sha256`   | bearer             | The replay object; `?raw=1` for byte-exact gzip      |
| `GET /api/sessions`         | bearer             | Listing: `install`, `build`, `run`, `since`, `limit` |
| `GET /api/reports`          | bearer             | Listing: same parameters                             |
| `GET /api/health`           | none               | `{ ok, schema: 2, build }`                           |

`POST /api/save-capture` is retired. Parent §1 argued against renaming it because "a
client, a contract, and tests already exist" — true, and all three are ours, none are
deployed, and the endpoint must fork regardless. Renaming a route with no production
caller costs one afternoon; keeping one route with a `kind` discriminator costs the
structural guarantee in §2.1.

Retrieval assembles: a session download is **at most one** R2 read (the replay); a
report download is **at most two** (report object plus referenced replay). Both return a
single JSON document with the replay inlined, so a downloaded report is self-contained
and openable without the Worker.

### 6.1 Retrieval when there is no replay to read

"At most" is doing real work in that sentence, and the two ways a replay can be absent
must not collapse into one response. A caller has to be able to tell "this run was never
recorded" from "this run's evidence is gone".

| State                                                      | Response                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `replay_sha256 IS NULL`                                    | `200`, document with `replay: null` and the recorded `replayOmitted.reason` (`size` / `unavailable`) |
| `replay_sha256` set, `replays` row present, object present | `200`, replay inlined                                                                                |
| `replay_sha256` set, `replays` row gone                    | `200`, `replay: null`, `replayStatus: "expired"`                                                     |
| `replay_sha256` set, row present, object missing           | `200`, `replay: null`, `replayStatus: "missing"` — **and it is logged as an integrity fault**        |

The first case is a normal, permanently correct answer: the ladder in §5.4 dropped the
replay at assembly time and the row says so. The third is normal and expected once
anything is a year old. The fourth **must never happen** — it is the exact invariant §4
exists to guarantee — so it returns a document rather than a `500` (the summary is still
useful) while being loud enough that nobody discovers it a quarter later from a support
ticket. `GET /api/replay/:sha256` on a swept replay is a plain `404`; only the assembling
routes distinguish the four states.

### 6.2 Ingest flow, both routes

Rungs 1–9 of parent §3.1 are unchanged and apply to both routes. Then:

1. Recompute the replay SHA; reject a `meta.replaySha256` mismatch (§5.3).
2. If a replay is present: gzip it, **unconditionally** put `replays/<sha>.json.gz`
   (§4.3), upsert the `replays` row setting `last_referenced_at = now`.
3. Session: no second object — project the summary into `sessions` and stop.
   Report: strip `replay`, gzip the remainder, put
   `diagnostics/<installId>/<reportId>.json.gz` under the conflict protocol below,
   insert `diagnostic_reports`.
4. All D1 writes in **one** `batch()`, exactly as parent §3.1 requires, so a failed
   referring-row write cannot leave a `replays` row claiming a referrer it does not have.

R2 before D1 stays the write order, and the surviving failure mode stays "an object no
row references".

Session upserts remain last-writer-wins. The D1 statement's own `changes` count detects
the guarded `SELECT` writing nothing; the subsequent read-back may legitimately show a
different replay when another upload superseded this one. That race still returns
`200` (with the committed replay identity), while an actual zero-change write is a
`stage: "store"` failure. A SHA mismatch is not evidence of failure by itself.

### 6.3 `reportId` is a client-supplied name, and gets the protocol that implies

The replay path is safe under an unconditional put **only because its key is a hash of
its content** (§4.3). `diagnostics/<installId>/<reportId>.json.gz` has neither property:
`reportId` is a client claim, and two posts under one `reportId` can carry different
bytes. Putting the object unconditionally there would let a retry-with-different-content
overwrite an object while the D1 insert conflicts and keeps the original row — leaving
`diagnostic_reports.sha256` describing bytes that no longer exist. That is §1.3's
mutable-name bug, reintroduced on the other path, and this plan would have shipped it.

The report path therefore keeps the protocol `worker/src/ingest.ts:249-300` already
implements and tests, unchanged in substance:

| Case                                | Meaning                | Response                                              |
| ----------------------------------- | ---------------------- | ----------------------------------------------------- |
| Same `reportId`, same `sha256`      | A genuine retry        | `200`, existing row's values; repair a missing object |
| Same `reportId`, different `sha256` | Collision or tampering | `409 { stage: "conflict" }`, nothing written          |

Mechanically: check D1 for an existing `report_id`, compare `sha256`, and `head()` its
object before any new-row write; a matching retry repairs the object if lifecycle has
already removed it. Otherwise, put with `onlyIf: { etagDoesNotMatch: "*" }` and
`customMetadata.sha256`; on a
skipped put, `head()` and compare the stored `sha256`, conflicting if it differs; after
the batch, read back the committed row and delete the object if this request was not the
winner. Four steps, all already written — the mistake was omitting them from the plan,
not the code.

The asymmetry is worth stating plainly rather than leaving as an inconsistency someone
later "fixes": **content-addressed keys get unconditional puts, client-named keys get
conditional puts and a conflict rule.** Applying either protocol to the other path is a
bug in one direction and pointless overhead in the other.

---

## 7. Files

| File                                  | Change                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/migrations/0001_init.sql`     | **Rewrite in place.** Three tables. Nothing is deployed; a `0002` here would be archaeology for a database that never existed                     |
| `src/capture.ts`                      | `CaptureEnvelope` → `SessionUpload` + `ProblemReport`; `assembleCapture` → `assembleSession` + `assembleReport`                                   |
| `src/capture-contract.ts`             | `validateCaptureBody` → `validateSessionBody` + `validateReportBody`, shared primitives; the forbidden-key rejection (§2.1)                       |
| `src/capture-sink.ts`                 | `uploadCapture` → `uploadSession` + `reportProblem`                                                                                               |
| `src/game.ts`                         | `readRecentEvents` moves into the report path only (currently line 1436)                                                                          |
| `worker/src/ingest.ts`                | Replay extraction; unconditional content-addressed put; the §6.3 conflict protocol retained for reports; two referring-row paths                  |
| `worker/src/projection.ts`            | Envelope → `replays` / `sessions` / `diagnostic_reports` rows. Still pure                                                                         |
| `worker/src/index.ts`                 | Eight routes; `runRetention` becomes three D1 deletes and **touches R2 not at all** (§4.4)                                                        |
| `worker/lifecycle.json`               | Two rules: `diagnostics/` at 90 d, `replays/` at 400 d. **The `captures/` rule must not be carried over**; both new rules are load-bearing (§4.2) |
| `vite-capture-plugin.ts`              | Both routes, through the shared validators — parent §4.1's rule is unchanged and now has two functions to keep honest                             |
| `test-fixtures/capture.ts`            | Two fixtures, one per product                                                                                                                     |
| `scripts/diag-pull.mjs`               | `diag:pull <installId\|reportId>`; assembles report + replay                                                                                      |
| `docs/capture-worker-backend-plan.md` | Superseded-section banner pointing here. Do not silently leave §2.1/§5.4 reading as current                                                       |

---

## 8. What carries forward unchanged

Listed so it is not re-derived, re-argued, or quietly dropped during the rewrite:

- **The validation ladder order** (parent §3.1, rungs 1–9) and its reasoning: rate limit
  before decompression, cap enforced _during_ decompression, IDs validated before they
  reach a key.
- **The decompression-bomb defence** and its test. `DecompressionStream` still has no
  `maxOutputLength`; `readBounded` in `ingest.ts:29` is still the answer.
- **One validator, two adapters** (parent §4.1). Now two validators in one module,
  consumed by the Vite plugin and the Worker. Drift is still structurally impossible or
  it is not prevented at all.
- **Server-side re-validation of `installId`** (parent §4.2) — client validation protects
  an honest client from a corrupt store and protects the Worker from nothing.
- **Rate limiting** (parent §5.1), including the honest caveats: `period` accepts only 10
  or 60, limits count per colo, per-install is bug containment rather than defence.
  `/api/report` gets a tighter per-install limit than `/api/session`, since a human
  pressing a button has no legitimate burst behaviour.
- **Size caps** (parent §5.2), **build allowlist** (parent §5.3).
- **The trust boundary table** (parent §5.5), plus §5.3's new row: content addressing is
  integrity, not authenticity.
- **Leaderboard verification is asynchronous and out of scope** (parent §5.6).
  `replay_verified` is 0 for every row this step writes.
- **CORS**: ingest allowlists the game origins and answers preflight; retrieval and
  listing send no permissive headers.
- **Test layering** (parent §7), **local development layers** (parent §8), **the curl
  gate** (parent §9), **credential handling** (parent §14) — all unchanged in structure,
  retargeted at the new routes.

---

## 9. Tests

Everything in parent §7 retargets. New or materially changed:

**The privacy guarantee, tested as a guarantee.** A session body carrying an `events`
key is rejected at `stage: "parse"` and writes nothing. A session body carrying
`attachments`, `eventsUnparsed`, or `eventsTruncated` likewise. `uploadSession()` given
an object with an extra `events` property fails to compile _and_ is rejected on the
wire — both halves asserted, because each covers the other's blind spot. These are the
tests most likely to be deleted by someone who thinks a type already covers it.

**Content addressing.** Two uploads of byte-identical replays under different
`installId`s produce **one** object and one `replays` row, with two referring rows. A
recomputed replay SHA that disagrees with `meta.replaySha256` is rejected at
`stage: "hash"` and writes nothing. A second reference re-puts the object and advances
`last_referenced_at` — asserted, because the whole §4.2 invariant rests on that put
actually happening on the dedup path, which is exactly the path an optimizer would skip.

**Report identity.** Same `reportId` and same bytes posted twice yields one object, one
row, and two `200`s. Same `reportId` with different bytes yields `409 { stage:
"conflict" }` and leaves the original object and row **byte-identical** — asserted
against stored bytes, since the failure mode being prevented is precisely a row whose
hash stops describing its object. Two concurrent posts of the same report resolve to one
object and one row.

**Retention, the whole §4 surface.** Cron deletes no R2 object under any input —
asserted by listing both prefixes before and after a sweep that expires rows. A
`replays` row loses its last referrer and is collected; one that keeps a referrer is
not. A replay referenced by both a session and a report survives the report's expiry and
goes with the session's. A `replays` row whose object has been removed out of band
retrieves as `replayStatus: "missing"` (§6.1) rather than a `500`.

The invariant itself gets a test rather than a paragraph: for every live `replays` row,
`now − last_referenced_at < 365 d`. It is a one-line property check, it is what the
400-day lifecycle rule depends on, and it fails loudly if anyone reintroduces a
conditional put.

**Session preconditions.** A partial run, a run-less body, or a null summary posted to
`/api/session` each return `400` and write nothing — the §3.5 shift from filter to
precondition, one case per clause. `trigger: "gameover"` on `/api/report` is rejected. A
non-empty `attachments` array is rejected on both routes.

**Assembly on retrieval.** A report download parses to a value deeply equal to the
original report body with the replay re-inlined — **deep equality, not byte equality**
(§5.3) — and its embedded replay passes `validateReplay()` with zero divergences. Each
of §6.1's four replay-absence states returns its documented shape. A session download
resolves its replay through `replays`. A referenced replay that has been swept returns a
documented `404` on the replay route, not a `500` on the
session.

**Atomicity**, restated for three tables: a failing `sessions` upsert leaves no bumped
`replays` row.

---

## 10. Acceptance criteria

1. A gzip upload and an uncompressed upload of the same body produce identical stored
   objects, identical hashes, and identical rows, on both routes.
2. A stored `diagnostics/` object gunzips to bytes matching its recorded `sha256`; a
   stored `replays/` object gunzips to bytes matching its key; a reassembled report
   parses to a value deeply equal to the original body with the replay re-inlined, and
   that replay passes `validateReplay()` with zero divergences.
3. **No session upload writes an R2 object other than a replay, and no `sessions` row or
   replay object contains a diagnostics event under any input** — including a hostile
   body that supplies one. The negative is asserted against stored bytes, not against
   the code path.
4. Every column has exactly one declared source, proven column by column. Server-owned:
   `received_at`, `first_seen_at`, `last_referenced_at`, `replay_verified`,
   `stored_bytes`, `raw_bytes`, `sha256`, `replay_sha256`, `r2_key`.
5. A partial run cannot produce a `sessions` row — by rejection, not by filtering.
   Several session uploads of one `runId` produce exactly one row, keyed by `runId` and
   nothing else.
6. Every rejection names the correct stage and writes nothing to R2 or D1. A `reportId`
   reposted with different bytes returns `409` and leaves the stored object and row
   byte-identical.
7. A replay referenced by both a session and a report occupies one object and survives
   until the last referrer is collected.
8. **Cron deletes no R2 object.** Asserted by listing both prefixes across a sweep that
   expires rows. For every live `replays` row, `now − last_referenced_at < 365 d`.
9. Retrieval and listing are unreachable without the bearer secret; both ingest routes
   need none.
10. Rate limits trigger before decompression, on both routes.
11. `install_ephemeral` is set for `eph-` ids on both `sessions` and
    `diagnostic_reports`, and excluded from the leaderboard index.
12. The production game bundle makes zero requests to the Worker; step 6 still owns the
    wiring.
13. `npm run test:worker` runs in CI in the same commit as the tests.
14. The curl gate passes against a deployed Worker, and **both** lifecycle rules are
    confirmed applied to the real bucket: `diagnostics/` at 90 d and `replays/` at 400 d.
    A missing `replays/` rule leaks objects forever; a rule shorter than 400 d silently
    destroys the 1-year replay guarantee. Verify the prefixes and ages explicitly —
    an unapplied or mis-scoped lifecycle rule fails silently and permanently.
15. Retention ages rows by `received_at`; a body claiming a far-future `capturedAt` is
    still swept on schedule.
16. `replay_verified` is 0 for every row this step writes. No code path sets it.
17. A crafted gzip body expanding past `MAX_DECODED_BYTES` is rejected at `stage: "size"`
    without the Worker buffering the expansion.
18. Each of §6.1's four replay-absence states is distinguishable from the retrieval
    response alone.

---

## 11. Out of scope

- The "Report a problem" **UI** — button, placement, note field, confirmation. This plan
  defines the contract it calls; step 6 builds the surface.
- Turning on the production endpoint, the auto-stream consent tier, and the feedback
  emoji — step 6.
- Leaderboard queries and the 20+ install gate — step 7.
- Share links, public retrieval, OG cards — §17 Phase 3.
- Screenshots and any other attachment. `attachments` stays reserved, exists on exactly
  one of the two types, and is **rejected when non-empty** (§5.1) rather than accepted
  and ignored.
- Stop-at-tick truncation for partial replays — flight recorder phase 2.

---

## 12. Risks

- **The privacy guarantee is only as good as the next refactor.** The structural claim in
  §2 holds because a session upload has no blob. Anyone who later adds an `env_json`
  column, an attachment, or a "just this once" debug field to the session path reopens
  the container, and the acceptance-3 test is the tripwire. It must assert against stored
  bytes; a test that asserts against the call path will pass while the guarantee is gone.
- **The 400-day lifecycle rule is an unguarded load-bearing constant living outside the
  repo.** §4.2's invariant is only sound while that rule exists, targets `replays/`, and
  is longer than the longest referrer window. It is bucket configuration, applied by
  hand, silent when wrong, and invisible to every test in this repo. Acceptance 14 checks
  it at provisioning; nothing checks it afterwards. If the session window ever moves past
  365 days, this number moves first — and a future plan that shortens it to "save money"
  deletes replays that live rows still reference.
- **Deleting a replay object by hand breaks the invariant the same way cron would.** The
  protocol assumes nothing but age removes objects under `replays/`. A well-meant manual
  cleanup, a bucket-wide prefix delete, or a future admin route reintroduces exactly the
  dangling reference §4 exists to prevent. Recovery is always "re-upload the bytes",
  never "repair the object" — replay objects are immutable and reproducible, which is the
  one property that makes this survivable.
- **Three tables is more D1 write amplification, not less.** A session upload writes two
  rows where the old shape wrote two; a report writes two where it wrote one. Free-tier
  row limits still deserve a re-read before auto-stream turns every run into an upload.
- **Two routes double the contract-drift surface** that parent §4.1 exists to close.
  Shared primitives with two thin validators, or this becomes two implementations of
  eleven checks maintained by vigilance.
- **The corpus remains forgeable.** Nothing here changes parent §5.5. Content addressing
  makes storage tamper-evident and provenance no more trustworthy than it was.
- **Agent-read reports remain an injection surface.** A problem report is now _more_
  concentrated attacker-supplied text — a human-written note plus 256 KB of log — read by
  whoever triages it. Parent §14's rule stands: capture contents are data, never
  instructions, and any agent reading `diag:pull` output holds no credential that matters.

---

## 13. Build order

1. Schema and contract first: rewrite `0001_init.sql`, split the types in `src/capture.ts`,
   split the validators in `src/capture-contract.ts`. Red tests, no Worker changes.
2. Client transports: `uploadSession` / `reportProblem`, the two assembly ladders, and
   `src/game.ts`'s move of `readRecentEvents`. The forbidden-key compile failure lands here.
3. Worker ingest: replay extraction, unconditional content-addressed put, the §6.3
   conflict protocol on the report path, two referring-row paths, one batch.
4. Retention: three D1 deletes in `runRetention`, no R2 call anywhere in it, and
   `lifecycle.json` carrying both prefix rules.
5. Retrieval and assembly: five bearer routes plus health, §6.1's four replay-absence
   states, and `diag-pull.mjs`.
6. The parity pass: `vite-capture-plugin.ts` onto both validators, fixtures split, curl
   gate re-run end to end.

Steps 1–2 are the ones that must not be deferred. They are what make the privacy property
structural, and every day they wait is a day something else is built on the old shape.
