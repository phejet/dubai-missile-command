# Replay Upload Backend — Status And Document Map

Status: orientation note. No implementation exists yet.
Date captured: 2026-07-29
Purpose: a single breadcrumb for "where is the backend plan, what is already
built, and what is still just paper" — so the next session does not have to
re-run the branch sweep below.

Written because the backend design was looked for in `docs/` and is not there:
the three plans that matter live in `.plans/`.

---

## 1. Short version

- The Cloudflare design exists in **three separate documents**, all on `main`.
- **Nothing backend-related is implemented.** No `worker/`, no `wrangler.toml`,
  no upload transport, anywhere in the repo or on any branch.
- What _is_ implemented is the **manual export path**: replay → iOS share sheet,
  and diagnostics JSONL → iOS share sheet.
- The two backend plans **disagree on scope** (D1 + public share links vs.
  R2/KV + private diagnostics). That conflict is unresolved and should be
  settled before any Worker code is written. See §6.

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

## 6. The unresolved conflict — decide this first

The two backend plans describe different systems that happen to share a vendor:

|           | `run-recap-playtest-platform.md` §7/§9      | `mobile-diagnostics-capture.md` §5        |
| --------- | ------------------------------------------- | ----------------------------------------- |
| Storage   | Worker + R2 + **D1**                        | Worker + R2 + **KV**, no D1               |
| Ingest    | `POST /share`                               | `POST /diag/ingest`                       |
| Read      | `GET /r/<id>` public redirect + replay blob | `GET /diag/<id>`, auth-gated, private     |
| Audience  | Players, public, viral                      | Only the developer                        |
| Retention | 1 year shared / 90 days telemetry           | 90 days                                   |
| Justifies | Share links, leaderboard                    | Debugging TestFlight builds off home wifi |

`mobile-diagnostics-capture.md` §1 flags this and offers two options —
diagnostics as a `source: "diagnostics"` row on the same Worker, or a sibling
route — but never picks one. §9 also leaves the R2 lookup strategy open
(KV `id -> r2Key` vs. a self-describing ID), and that one **must** be settled
before `GET /diag/<id>` or `diag:pull <id>` can be implemented.

Pick the destination before writing Worker code. The endpoints, the auth model,
and the storage layer all differ.

---

## 7. Next step

If the goal is **self-troubleshooting** (matches this branch's name and builds
on what already ships), follow `mobile-diagnostics-capture.md` §8:

1. Client buffer + `replay-snapshot` + bundle assembly. No network.
2. `/api/save-diag-bundle` for local dev parity — prove the exact bundle shape
   writes locally before Cloudflare joins the ceremony.
3. `worker/` with R2 + KV + ingest. Validate with `curl` before any client wiring.
4. Wire the sink and the hidden gesture. End-to-end over cellular.
5. TestFlight readiness: privacy manifest, questionnaire, rate caps, labeled
   "Send bug report" button.

If the goal is the **viral share link** instead, that is
`run-recap-playtest-platform.md` §17 Phase 2, and it is a different endpoint
shape. Steps 1–2 above are useful either way.

Independently: the flight recorder can be implemented at any time without a
backend, and makes every later upload more valuable by guaranteeing a completed
replay actually survives to be uploaded.

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
