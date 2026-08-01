# Replay Upload Backend — Status And Document Map

Status: orientation note. Client-side steps 1–3 shipped; no server exists yet.
Date captured: 2026-07-29 · destination settled 2026-08-01 (§6) · client state
refreshed 2026-08-01
Purpose: a single breadcrumb for "where is the backend plan, what is already
built, and what is still just paper" — so the next session does not have to
re-run the branch sweep below.

Written because the backend design was looked for in `docs/` and is not there:
the three plans that matter live in `.plans/`.

---

## 1. Short version

- The Cloudflare design exists in **three separate documents**, all on `main`.
- **No server exists.** No `worker/`, no `wrangler.toml`, no production upload
  transport, anywhere in the repo or on any branch.
- The **client side is further along than the §3 sweep below suggests** — that
  sweep predates `a5dc06b` and `6ce2fc2`. `src/replay-snapshot.ts`,
  `src/capture.ts`, `src/capture-sink.ts`, `src/sha256.ts`,
  `vite-capture-plugin.ts`, and `scripts/extract-diagnostic-replays.ts` all
  exist on `main` now. `capture-sink.ts` posts only to a dev-only endpoint
  define, which is `null` in production.
- What is implemented for evidence today: the **manual export path** (replay →
  iOS share sheet, diagnostics JSONL → iOS share sheet), plus durable local
  replay archiving inside the diagnostics store.
- The two backend plans described different systems (D1 + public share links
  vs. R2/KV + private diagnostics). **Settled 2026-08-01: Worker + R2 + D1,
  one backend.** Private diagnostics is a second D1 table, not a second
  service. See §6.

---

## 2. Document map

| Document                                                                               | Lines | Added                                | What it decides                                                                                                          |
| -------------------------------------------------------------------------------------- | ----: | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`run-recap-playtest-platform.md`](./run-recap-playtest-platform.md)                   |  1094 | `bdfdc6c` (2026-05-24)               | The canonical brain dump. Cloudflare Worker + R2 + **D1**; D1 `sessions` schema; share links; leaderboard; 7-phase order |
| [`mvp-execution-plan.md`](./mvp-execution-plan.md)                                     |   773 | pre-dates this clone's shallow depth | Phase 1 Run Recap only. Explicitly "no backend code, no uploads"                                                         |
| [`mobile-diagnostics-capture.md`](./mobile-diagnostics-capture.md)                     |   460 | `d2f8d16` (2026-07-11)               | Narrow troubleshooting slice. Worker + R2 + **KV, no D1**; `POST /diag/ingest`; hidden gesture; `diag:pull`              |
| [`../docs/replay-flight-recorder-design.md`](../docs/replay-flight-recorder-design.md) |   371 | `8a634d0` (2026-07-29)               | Gzip + base64 + JSONL-part archiving of completed replays **into the diagnostics export**. Local durability, not upload  |

### Section pointers worth keeping

- Cloudflare-vs-CloudKit decision and its contingency:
  `run-recap-playtest-platform.md` §7 and Appendix A Fork 7. The decision hinges
  entirely on the web-first share link; if that feature is ever dropped,
  CloudKit becomes the correct answer again.
- D1 `sessions` schema: `run-recap-playtest-platform.md` §9.
- Phase order for the viral path: `run-recap-playtest-platform.md` §17.
- Minimal diagnostics backend spec: `mobile-diagnostics-capture.md` §5.
- Diagnostics build order (the live one): `mobile-diagnostics-capture.md` §8.
- Archive record protocol (manifest / part / complete):
  `docs/replay-flight-recorder-design.md` "Archive Protocol".

### Relationship between the flight recorder and the upload work

`docs/replay-flight-recorder-design.md` lists **"Uploading replay data to a
remote service"** as an explicit non-goal. It is the durable _local_ substrate —
it makes a completed replay survive the next `initGame()` and survive a
WebContent kill during death-clip playback. The upload path later draws from
that substrate. The two are complementary, not alternatives, and the flight
recorder is independently useful without any backend.

Measured there: gzip takes a median replay from 368 KB to 24.9 KB (~14x); a
wave-10 replay lands around 50–61 KB once base64-encoded into JSONL.

---

## 3. Branch and PR findings

A sweep of all 28 remote branches (2026-07-29) for `wrangler`, `worker/`,
`diag-sink`, `diag-bundle`, `diag-buffer`, `diag-gesture`, `install-id`,
`replay-snapshot`, `extract-diagnostic`, `diag-pull`, `build-info` returned
**zero hits on every branch**. No backend implementation has ever been
committed to this repository.

> Stale as of 2026-08-01 for the client-side names only: `replay-snapshot` and
> `extract-diagnostic` now hit on `main` (`a5dc06b`, `6ce2fc2`). The
> server-side names — `wrangler`, `worker/`, `diag-sink`, `diag-pull` — still
> return zero everywhere. Re-run §8 rather than trusting this paragraph.

### PR #17 is superseded — safe to close

<https://github.com/phejet/dubai-missile-command/pull/17> ·
branch `claude/mobile-replay-logging-umN6Z` · commit `0fdb38e` (2026-06-03)

It adds a **343-line** draft of `.plans/mobile-diagnostics-capture.md`. The same
plan was separately landed on `main` as `d2f8d16` (2026-07-11) at **460 lines**.
Diffing the two: identical section structure, +154 lines of folded-in review
findings, including

- the `replay-snapshot.ts` gap — `window.__lastReplay` only exists _after_ game
  over, so a mid-run gesture would upload the previous run;
- drop checkpoints before dropping the replay when the bundle exceeds its cap;
- "HMAC with an embedded client key is not real authentication" — name the real
  controls (size caps, quotas, allowed build IDs, WAF limits);
- enforce a parsed-body byte cap, not `Content-Length`;
- TestFlight privacy copy must state that collection is always-on even though
  upload is user-triggered.

The copy on `main` strictly supersedes the branch. This is exactly what
`mobile-diagnostics-capture.md` §8 step 0 means by _"Rebase/cherry-pick the plan
onto current main. Do not merge the stale branch as-is."_

### The only unmerged plan document in the repo

`docs/replay-convergence-guard-plan.md` — 400 lines, `2b2a7eb` (2026-07-10), on
`claude/replay-divergence-validation-8ca7s2`. A pre-commit/pre-push
replay-convergence guard spec. Unrelated to the upload backend, but it is
branch-only and will be lost if that branch is pruned.

---

## 4. What is implemented today (the manual path)

| Surface                          | Code                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Replay → file → share sheet      | `src/save-replay.ts:27` (`saveReplayToFile`), called from `src/game.ts:1613`                                 |
| Diagnostics ring buffer          | `src/diagnostics-ring.ts`                                                                                    |
| Diagnostics chunked JSONL store  | `src/diagnostics-store.ts`                                                                                   |
| Diagnostics export → share sheet | `src/diagnostics-log.ts:221` (`shareDiagnostics`), wired at `src/game.ts:570`, handler at `src/game.ts:1912` |

Dev-only LAN endpoints that already exist (Vite middleware, not production):

- `/api/save-replay` — `vite-replay-plugin.ts:47`
- `/api/save-device-log` — `vite-perf-plugin.ts:224` (single log events only)
- `/api/save-perf`, `/api/perf-command` — `vite-perf-plugin.ts:131`, `:75`

`src/client-log.ts` POSTs to the Mac's LAN dev server only, which is why it is
dead off home wifi and absent in TestFlight builds. That gap is the entire
motivation for `mobile-diagnostics-capture.md`.

---

## 5. What is not implemented

Every file in `mobile-diagnostics-capture.md` §7 is still unwritten:

`src/diag-buffer.ts`, `src/diag-bundle.ts`, `src/diag-sink.ts`,
`src/diag-gesture.ts`, `src/install-id.ts`, `src/build-info.ts`,
`src/replay-snapshot.ts`, `worker/` (+ `wrangler.toml`), `scripts/diag-pull.mjs`.

Also unwritten, from the flight recorder design: any use of
`CompressionStream("gzip")`, the `replay-archive` diagnostics channel, and
`scripts/extract-diagnostic-replays.ts`. Verified absent by grep over `src/`
and `scripts/`.

---

## 6. The scope conflict — RESOLVED (2026-08-01)

**Decision: a single Cloudflare Worker + one R2 bucket + one D1 database serves
both audiences. Private diagnostics is another D1 table, not another backend.**

The two plans described different systems that happen to share a vendor:

|           | `run-recap-playtest-platform.md` §7/§9      | `mobile-diagnostics-capture.md` §5        |
| --------- | ------------------------------------------- | ----------------------------------------- |
| Storage   | Worker + R2 + **D1**                        | Worker + R2 + **KV**, no D1               |
| Ingest    | `POST /share`                               | `POST /diag/ingest`                       |
| Read      | `GET /r/<id>` public redirect + replay blob | `GET /diag/<id>`, auth-gated, private     |
| Audience  | Players, public, viral                      | Only the developer                        |
| Retention | 1 year shared / 90 days telemetry           | 90 days                                   |
| Justifies | Share links, leaderboard                    | Debugging TestFlight builds off home wifi |

The D1 column wins. What it means concretely:

- **One ingest endpoint**, not two. `POST /api/save-capture` — the contract
  already specified and locally proven in
  [`../docs/replay-capture-assembly-plan.md`](../docs/replay-capture-assembly-plan.md)
  §4. There is no `/share` and no `/diag/ingest`; one `uploadCapture()` sits
  beneath every trigger.
- **Two D1 tables**, split by what the row is _for_:
  - `sessions` — completed runs. The §9 schema, leaderboard-eligible, publicly
    shareable. Written only for `partial: false` captures, upserted on a unique
    index over `run_id`.
  - a diagnostics table — everything else: partial captures, crash evidence,
    bug reports. Auth-gated, never surfaced publicly, never in a leaderboard
    query.
- This mapping **already exists in the shipped code**. Capture assembly §2.3
  routes `partial: true` captures away from `sessions` precisely because they
  describe a run that has not happened yet. Those rows are the diagnostics
  table. The split was designed before it had a name.
- **The R2 lookup question is settled by the same decision.** §9 of
  `mobile-diagnostics-capture.md` left `KV id -> r2Key` vs. a self-describing
  ID open; with D1 present, the row _is_ the lookup — `id` is the primary key
  and the R2 key prefix, so `GET /diag/<id>` and `diag:pull <id>` resolve
  through a D1 `SELECT`. **No KV binding is needed for resolution.** KV or the
  Worker rate-limiting binding may still earn its place for per-install
  quotas; that is a separate call, made when rate limiting is written.

### Superseded by this decision

- `mobile-diagnostics-capture.md` §5 "**No D1 for the MVP**" — no longer true.
  Its client-side sections (§4.4 install id, §4.5 baked build id, §4.6 hidden
  gesture) are unaffected and still the reference.
- `mobile-diagnostics-capture.md` §1's two unpicked options — option A
  (diagnostics on the same Worker) is the answer, refined: the discriminator is
  the existing `meta.trigger` / `partial` fields, not a bolted-on
  `source: "diagnostics"` tag.
- This document's own §7 build order, which recommended the KV path. Replaced
  below.

---

## 7. The unified build order

One sequence now serves both audiences, because §6 collapsed them into one
backend. Steps 1–3 required no backend at all, which is why they went first.

| #   | Step                                                                                        | State                                  |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Run recap — the summary a capture projects from                                             | shipped                                |
| 2   | Replay flight recorder — completed replays survive `initGame()` and WebContent kills        | shipped `a5dc06b`                      |
| 3   | Capture assembly + `/api/save-capture` dev parity — prove the exact artifact writes locally | shipped `6ce2fc2`; iPhone gate pending |
| 4   | `src/install-id.ts` — ~20 lines, needed by every producer                                   | **next**                               |
| 5   | `worker/` + R2 + D1 (both tables) — `curl`-validated before any client wiring               | not started                            |
| 6   | Triggers: hidden gesture (dev), labeled "Report a bug" (player/QA), programmatic (agent)    | not started                            |
| 7   | Leaderboard projection — a query over data step 3 already populates; gated on 20+ installs  | not started                            |

Step 6 ships three triggers over **one** `uploadCapture()`. Three call sites,
one transport, one envelope — the moment that becomes three transports, the
diagnosis vocabulary forks and step 5 inherits two of everything.

Step 3's local endpoint is the specification step 5 implements against: same
headers, same integrity contract, same rejection stages
(`serialize` / `hash` / `compress` / `size` / `parse`). The Worker should be
diffable against `vite-capture-plugin.ts`, not a fresh invention.

Still outstanding independently of this sequence: the **real-iPhone gate** for
steps 2–3 — capability booleans (`CompressionStream`, `crypto.subtle` on an
insecure LAN origin), v11 archive size and latency, Share Diagnostics
extraction, and WebContent-kill recovery. Everything above builds on the
assumption that those hold on device, and nothing has yet confirmed them on
device.

---

## 8. How to reproduce this sweep

```bash
git fetch origin --prune

# Any backend implementation on any branch? (expected: no output)
for b in $(git branch -r | grep -v HEAD); do
  git ls-tree -r --name-only "$b" \
    | grep -iE "wrangler|^worker/|diag-sink|diag-bundle|diag-buffer|diag-gesture|install-id|replay-snapshot|extract-diagnostic|diag-pull|build-info" \
    | sed "s|^|$b: |"
done

# Which branches carry plan docs, and how far from main are they?
for b in $(git branch -r | grep -v HEAD); do
  printf "%-52s %s\n" "$b" "$(git rev-list --count origin/main..$b)"
done

# Plan-doc history across all refs
git log --all --oneline --date=short --format="%h %ad %d %s" -- .plans/

# Stale branch draft vs the copy on main
git diff --stat \
  origin/claude/mobile-replay-logging-umN6Z:.plans/mobile-diagnostics-capture.md \
  origin/main:.plans/mobile-diagnostics-capture.md
```

Caveat: this clone is shallow (`.git/shallow` present, graft at `69e2151`), so
path-limited history for files added before 2026-05-31 collapses onto the graft
boundary. That is why `mvp-execution-plan.md` has no add-commit SHA in §2. Use
`git log --all` and read commit subjects rather than trusting `--diff-filter=A`
in this clone.
