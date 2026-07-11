# Mobile Diagnostics Capture — Focused Plan

Status: reviewed, needs revision before implementation
Date: 2026-06-03
Review date: 2026-06-07
Original branch: `claude/mobile-replay-logging-umN6Z`

> Review finding: the original branch is stale relative to current `main`.
> Do **not** merge or apply it wholesale. As of review, it was 1 commit ahead
> and 5 commits behind `main`, so a raw branch merge would undo unrelated main
> work: deterministic iOS deploy script, death-clip loop fix, run-recap
> redesign, `.gitignore` cleanup, and lesson updates. Cherry-pick this plan or
> rebase before implementation. Git can keep the ship flying, but only after
> it has tried to set fire to the chart table.

## 0. Why this exists (the narrow goal)

I build and play on my iPhone, **usually away from home wifi**, so my
MacBook (and the LAN dev server) is unreachable. When I hit a bug or a
weird moment I currently have no way to get a reproducible artifact off
the phone. I want to:

- Capture a **deterministic replay** of the run plus **detailed logs**
  (errors + key gameplay events) on the device.
- Get that artifact **off the phone with no Mac involved**, over whatever
  internet the phone has (cellular / foreign wifi).
- Trigger it on demand with a **hidden dev gesture**.
- Have the same mechanism **extend to TestFlight testers** later without
  reworking it.

"Off home wifi" does **not** mean offline — the phone has internet, just
not my Mac. So the correct sink is a **cloud endpoint** the phone can
always reach, which is reachable exactly when the LAN dev server is not.

### Decisions locked (from the kickoff Q&A)

| Question      | Decision                                               |
| ------------- | ------------------------------------------------------ |
| Deliverable   | Write this focused plan first, implement after review  |
| Off-wifi sink | **Cloud upload backend now** (not share-sheet only)    |
| Log scope     | **Errors + key events** (lifecycle, wave, shop, death) |
| Trigger       | **Hidden dev gesture** (on-demand bundle upload)       |

## 1. How this relates to the existing platform plan

`.plans/run-recap-playtest-platform.md` already designs a Cloudflare
Worker + R2 + D1 backend, but for **virality / telemetry / leaderboards**.
This plan is a **deliberately narrow slice**: a _diagnostics bundle_
upload path for troubleshooting my own builds and TestFlight test plays.

What this plan **reuses** from that design:

- Cloudflare Worker + R2 single-stack recommendation (§7 there).
- Per-install anonymous UUID, size cap, HMAC build token, retention policy.
- Replay-as-source-of-truth seam (replay re-runs headlessly later).

> Review finding: this reuse is sound, but diagnostics needs one extra piece
> that the plan currently hand-waves: an explicit lookup/index for uploaded
> bundles. R2 object keys alone are not enough to fetch by short diagnostic ID.

What this plan **deliberately omits** for now (stays in the bigger plan):

- Share links / `dmc.gg/r/<id>` viral loop, OG cards.
- D1 schema, leaderboards, replay-verified scores.
- Auto-stream "share all sessions" settings toggle + offline queue.
- Run Recap UI work (separate Phase 1 effort already on this branch).

When the platform work lands, the diagnostics endpoint either becomes a
`source: "diagnostics"` row on the same Worker, or stays a sibling route.
Nothing here blocks or contradicts it.

## 2. What we already have (verified in code)

- **Deterministic replays, recorded live on device.** `game._actionLog`
  in `src/game.ts`; Mulberry32 seeded RNG (`src/headless/rng.ts`). A
  replay reproduces a bug exactly. Schema/version is current (v4).
- **Replay export to iOS share sheet.** `src/save-replay.ts` writes to
  `Directory.Cache` and calls `@capacitor/share`. No network needed — but
  it's a manual share, not a structured bug report.
- **A device logger that only works on home wifi.** `src/client-log.ts`
  POSTs each event to `/api/save-device-log` on the LAN dev server
  (`vite-perf-plugin.ts`). DEV-only; dead off-wifi and absent in prod.
- **Global error listeners already exist in one place.**
  `src/run-recap-death-clip.ts:343-344` attaches `error` +
  `unhandledrejection` listeners and routes them through `clientLog()`.
  No app-wide, persisted crash capture yet.

  > Review finding: on current `main`, these listeners are local to the
  > death-clip path and gated by `clientLogEnabled()`. Centralizing them is
  > still the right move, but it must be done through explicit app bootstrap
  > (`initDiagnostics(...)` from `bootGame()` / `Game` construction), not by
  > import side effect. Bind once, expose cleanup for tests, avoid duplicate
  > listeners.

- **Build id helper.** `getBuildId()` in `vite-build-id.ts` →
  `<shortSha>` or `<shortSha>+<diffHash>`. Currently stamped
  **server-side** by the Vite plugins, so it is **not present in a prod
  bundle** that has no dev server. We need it baked in at build time.

  > Review finding: the helper is useful but not sufficient for reproducing a
  > dirty build. It hashes `git diff --stat`, not the actual patch, and ignores
  > untracked files. Bundle `commitSha`, `dirty`, and `diffStat` separately.
  > Treat `sha+diffHash` as an identifier, not a time machine.

- **Capacitor plugins installed:** `@capacitor/app`, `core`, `filesystem`,
  `share`. No HTTP plugin needed — `fetch` to the Worker is fine.

  > Review finding: the plan's later `device.model` / `osVersion` fields need
  > either `@capacitor/device` or a best-effort browser-only implementation
  > based on `navigator.userAgent`, platform, screen, and WebView hints. Decide
  > this before promising rich device metadata.

**The gap:** replays already leave the phone offline; **logs do not**, and
there is no single structured artifact, no on-device buffer that survives
a crash, and no prod-safe sink that works off home wifi.

## 3. Architecture overview

```
                    iPhone (Capacitor WebView, TestFlight or dev)
  ┌──────────────────────────────────────────────────────────────┐
  │  diag-buffer.ts                                                │
  │   • ring buffer (in-memory, last ~1000 events)                │
  │   • captures: window error, unhandledrejection, key events    │
  │   • persisted to Filesystem on error + pagehide/visibilitychange│
  │   • survives crash/relaunch (reload prior buffer at boot)      │
  │                                                                │
  │  diag-bundle.ts                                                │
  │   • assembles { meta, logs, replay } bundle                   │
  │   • meta: buildId, installId, platform, device, screen, ts    │
  │   • replay = current/last run's action log (deterministic)    │
  │                                                                │
  │  diag-gesture.ts  ── hidden dev gesture ──► assemble + upload  │
  │  diag-sink.ts     ── POST bundle ─────────────────────────────┼──► cellular / any internet
  └──────────────────────────────────────────────────────────────┘
                                                                    │
                                                                    ▼
                              Cloudflare Worker  (POST /diag/ingest)
                                • verify HMAC build token
                                • size cap + per-IP/install rate limit
                                • gzip → R2  key: diag/<installId>/<ts>-<id>.json.gz
                                • return { id }  (short ref backed by lookup)
                                          │
                                          ▼
                              R2 bucket  (private)
                                          │
                       wrangler / `npm run diag:pull <id|installId>`
                                          ▼
                              local JSON bundle → inspect / replay / re-sim
```

Reachability is the whole point: the Worker is on the public internet, so
the phone reaches it on cellular precisely when the Mac/LAN is gone.

## 4. Client implementation

### 4.1 `src/diag-buffer.ts` — always-on capture (new)

A small, prod-safe diagnostics buffer. Independent of the DEV-only LAN
POST in `client-log.ts`.

- **Ring buffer**: array of `{ t, channel, event, data? }`, cap ~1000
  entries (drop oldest). Memory only; cheap.
- **Capture sources**:
  - `window.addEventListener("error", …)` → `{ message, source, line, col,
stack }`. (Move/centralize the listeners currently living only in
    `run-recap-death-clip.ts`.)
  - `window.addEventListener("unhandledrejection", …)` → reason + stack.
  - A `diag(channel, event, data?)` call used at key gameplay seams
    (see 4.2).
- **Persistence** (so a crash isn't lost):
  - Flush the buffer to `Filesystem` (`Directory.Data`,
    `diag/buffer.json`) on: any captured error, `pagehide`,
    `visibilitychange → hidden`. Throttle to ≤1 write/sec.
    Fatal/error events must bypass the throttle and force an immediate
    best-effort flush. On WebView suspension, async `Filesystem.writeFile`
    may not complete; keep a tiny synchronous `localStorage` emergency record
    for the last uncaught error/rejection. Otherwise this becomes a beautiful
    crash logger that logs everything except the crash, which is performance
    art, not diagnostics.
  - On boot, load any prior `buffer.json` into a `previousSession` slot so
    the next bundle includes the crash that killed the last run, then
    rotate it aside.
- **Safety**: every path wrapped in try/catch and swallowed, exactly like
  `client-log.ts` — diagnostics must never break the run.
- **Enablement**: buffer is **always on** in native builds (this is the
  whole point of TestFlight troubleshooting). Keep it cheap enough that
  always-on is free. A `localStorage["dmc:diag"]="0"` kill switch exists.

> Review finding: for TestFlight, "always-on buffer, explicit upload" needs to
> be stated plainly in the privacy copy. The upload is user-triggered, but
> collection happens before the gesture.

### 4.2 Key events to capture (the "errors + key events" scope)

Wire `diag()` calls at existing seams (most already emit `clientLog`):

- App lifecycle: `pagehide`, `pageshow`, `visibilitychange` (already in
  `game.ts:548`), app foreground/background via `@capacitor/app`.
- Run lifecycle: game start (`game.ts:859`), wave start, shop open/close +
  purchases, game over (cause, wave, score).
- Screen changes (`game.ts:629`).
- Renderer/asset failures, replay load failures, perf stalls (reuse the
  death-clip instrumentation signals).
- Every uncaught error / rejection (4.1).

Each event is tiny; the ring buffer keeps the last ~1000, which easily
covers a full run's worth of context leading to a bug.

> Review finding: cap both entry count and serialized event size. Error stacks,
> replay-load failures, and renderer payloads can bloat quickly. Truncate deep
> objects and stack strings at capture time, before the bundle builder has to
> play coroner.

### 4.3 `src/diag-bundle.ts` — the artifact (new)

```ts
type DiagBundle = {
  schemaVersion: 1;
  meta: {
    buildId: string; // baked at build time (see 4.5)
    commitSha?: string;
    dirty?: boolean;
    diffStat?: string;
    installId: string; // anon per-install UUID (4.4)
    displayName?: string; // optional self-name ("It's Mike")
    platform: string; // ios / web / ...
    device: { model?; osVersion?; webview? };
    screen: { w; h; dpr; safeArea? };
    appState: { screen; wave?; score? };
    capturedAt: number;
    note?: string; // optional one-line note from the gesture
  };
  logs: DiagEvent[]; // current session ring buffer
  previousSessionLogs?: DiagEvent[]; // crash from the run that died
  replay?: ReplayData; // current or last run's deterministic replay
  replayOmittedReason?: string;
};
```

The replay is the existing `window.__lastReplay` / live action log —
reuse `src/save-replay.ts`'s notion of the current replay. Bundle stays
small (replays are tens of KB; logs a few KB). Gzip on the Worker side.

> Review finding: this is the biggest implementation gap. `window.__lastReplay`
> only exists after game over. During a live run, the usable replay is not a
> ready object; it is seed + `_actionLog` + `_replayCheckpoints` + current tick
>
> - draft mode + current score/wave. Add `src/replay-snapshot.ts` with a
>   `buildCurrentReplaySnapshot(game, lastReplay)` helper and use it everywhere:
>   save replay, diagnostics bundle, and any future share/export path. If the
>   hidden gesture fires during the actual weird moment, uploading the previous
>   run would be a tiny museum of uselessness.

> Review finding: checkpoints can make the bundle large. Actions are the
> deterministic source of truth; checkpoints are acceleration. If the bundle
> crosses the cap, drop checkpoints first and record `replayOmittedReason` or
> `checkpointsOmitted: true` instead of dropping the whole replay silently.

### 4.4 `src/install-id.ts` — anonymous per-install id (new)

- Generate a random UUID once, persist it. **localStorage** for the MVP;
  upgrade to iOS Keychain later (noted in the platform plan §5). No Apple
  ID, no device fingerprint, not reversible to identity.
- Optional `displayName` editable later (settings surface is out of scope
  here; the field exists in the bundle for when it lands).

### 4.5 Build id baked at build time (change)

Today `getBuildId()` is only stamped server-side, so a prod/TestFlight
bundle has no build id. Add a Vite `define` so the client knows its own
build:

- In `vite.config.ts`, `define: { __BUILD_ID__: JSON.stringify(getBuildId()) }`
  (import the existing helper from `vite-build-id.ts`).
- Expose via a tiny `src/build-info.ts` reading `__BUILD_ID__` with a
  `"unknown"` fallback. Used by `diag-bundle.ts` and worth surfacing on
  the title/recap screen so I can see which build a bug came from.

This is the single source of truth for build id across replays, perf, and
diagnostics — do not invent a second scheme.

> Review finding: add TypeScript global declarations for every Vite define:
> `__BUILD_ID__`, `__COMMIT_SHA__`, `__BUILD_DIRTY__`,
> `__BUILD_DIFF_STAT__`, `__DIAG_ENDPOINT__`, and any public build token.
> Also make sure diagnostic upload defines are absent or inert for GitHub
> Pages/web builds unless intentionally enabled.

### 4.6 `src/diag-gesture.ts` — hidden trigger (new)

- Bind a **hidden gesture** that fires the upload from anywhere:
  e.g. a **5-tap or long-press on a fixed dead-zone** (a corner of the
  title screen / the version stamp from 4.5). Deliberately undiscoverable
  in normal play; reliable for me.
- On fire: assemble bundle → call `diag-sink.upload()` → show a brief
  toast with the returned short `id` (so I can quote "diag a1b2c3" when I
  go back to my Mac) and a success/fail state. No blocking UI.
- TestFlight extension (later, same plumbing): add a **labeled** entry
  point — a "Send bug report" item with an optional one-line note +
  emoji — that calls the exact same `upload()`. The hidden gesture stays
  for me; the labeled button is the tester-facing surface. Because each
  upload is an explicit user action, consent is per-action and Apple-clean
  (matches the wider-tier consent model in the platform plan §5).

### 4.7 `src/diag-sink.ts` — upload transport (new)

- `POST <DIAG_ENDPOINT>/diag/ingest` with the bundle JSON.
- `DIAG_ENDPOINT` baked via Vite `define` / env at build time
  (e.g. `https://dmc-diag.<acct>.workers.dev`). Falls back to the LAN
  `/api/save-diag-bundle` route in dev for parity if desired.
- Headers: `x-dmc-build`, `x-dmc-install`, and an **HMAC token** derived
  from a key embedded in the build over `installId+capturedAt` (raises the
  bar against random abuse; security-by-obscurity, matches platform §7).
- `keepalive: true`, single retry with small backoff, all failures
  swallowed and surfaced only as a toast. Never throws into gameplay.

> Review finding: do not reuse `/api/save-device-log` for full bundles. That
> endpoint accepts single log events today. Add `/api/save-diag-bundle` that
> writes the exact `DiagBundle` JSON locally, so the dev path validates the same
> shape as production. No suitcase-toaster adapter.

> Review finding: HMAC with an embedded client key is not real authentication.
> Keep it as nuisance friction if useful, but call the actual controls what
> they are: request size caps, per-IP/per-install quotas, allowed build IDs,
> Worker/WAF rate limits, and private retrieval auth.

## 5. Backend implementation (minimal)

A single Cloudflare Worker + one R2 bucket. **No D1 for the MVP** — the
replay+logs blob is enough for troubleshooting; D1 indexing arrives with
the leaderboard/telemetry work.

- Repo location: `worker/` (own `wrangler.toml`; deploy with
  `wrangler deploy`). Keep secrets (HMAC key) in `wrangler secret`.
- **`POST /diag/ingest`**:
  - Verify the build token/HMAC as abuse friction; reject known-bad or stale
    build IDs.
  - Enforce a hard parsed-body byte cap, not just `Content-Length`. Start
    around 512 KB unless measured bundles prove 256 KB is enough. Cap logs,
    stacks, and optional replay checkpoints on the client before upload.
  - Enforce per-IP and per-install rate limits (e.g. KV or Worker
    rate-limiting binding) — cap ~50/day/install.
  - `gzip` the body, write to R2 key
    `diag/<installId>/<capturedAt>-<rand>.json.gz`.
  - Store a KV lookup `diag-id:<id> -> r2Key` (or make the returned ID encode
    enough path information to find the object without listing all R2 keys).
  - Return `{ id }` (the short ref backed by that lookup).
- **`GET /diag/<id>`** (auth-gated, e.g. a bearer in `wrangler secret`):
  fetch a bundle through the KV lookup for inspection. Not public.
- Retention: lifecycle rule auto-deletes diag objects after **90 days**
  (cheap; matches platform §7 telemetry retention).

### Local tooling

- `npm run diag:pull <installId|id>` — small Node/`wrangler r2` script
  that downloads matching bundles into `diag-results/<id>.json`, unzipped,
  ready to inspect.
- Re-running a pulled replay: feed `bundle.replay` to the existing
  headless runner (`src/headless/sim-runner.ts`) or
  `window.__loadReplay()` in the browser — instant reproduction.

## 6. Privacy & TestFlight readiness

- **Per-install random UUID**, not linked to identity → "Data not linked
  to user."
- Collected types: **Diagnostics** (logs + session metadata + replay),
  optionally **User Content** (note/emoji if the labeled tester button
  lands). **No tracking**, no third-party sharing → no ATT prompt.
- Requires before TestFlight upload path ships (per platform plan §6):
  `PrivacyInfo.xcprivacy` Privacy Manifest, App Privacy questionnaire
  answers, and a privacy policy URL. Do not leave this as "hardening later"
  once data can leave a tester's device.
- Each upload is an explicit user action (gesture or button) → honest,
  per-action consent. No silent background streaming in this slice.

> Review finding: if the buffer is always on in native builds, the tester copy
> should say diagnostics are kept locally and sent only when they choose "Send
> bug report." That distinction matters; Apple paperwork loves ambiguity the
> way a swamp loves shoes.

## 7. File-by-file change list

New:

- `src/diag-buffer.ts` — ring buffer, error/rejection capture, persistence.
- `src/diag-bundle.ts` — bundle assembly + `DiagBundle` type.
- `src/diag-sink.ts` — Worker upload transport + HMAC.
- `src/diag-gesture.ts` — hidden gesture binding + toast.
- `src/install-id.ts` — anon UUID (+ optional displayName).
- `src/build-info.ts` — reads baked `__BUILD_ID__` / endpoint.
- `src/replay-snapshot.ts` — builds a current or last `ReplayData` snapshot
  from live game state.
- `worker/` — Worker source + `wrangler.toml`.
- `scripts/diag-pull.mjs` — pull bundles from R2 locally.

Changed:

- `vite.config.ts` — `define` for `__BUILD_ID__` and `__DIAG_ENDPOINT__`.
- `src/game.ts` — route the existing `clientLog` seams through `diag()`
  too (or have `clientLog` delegate into the buffer), bind the gesture at
  boot, surface the build stamp.
- `src/run-recap-death-clip.ts` — fold its local error listeners into the
  centralized `diag-buffer` (avoid double-binding).
- `vite-perf-plugin.ts` — add `/api/save-diag-bundle` for local dev parity.
- `package.json` — `diag:pull` script.
- `ios/App/App/PrivacyInfo.xcprivacy` — privacy manifest (if not present).

Tests:

- Unit: ring-buffer cap/rotation, persistence throttle, bundle assembly,
  HMAC signing, install-id stability. Logger must stay no-throw under a
  failing `fetch`/`Filesystem` (mirror `client-log` test style).
- Unit: current replay snapshot during live play vs last replay after game
  over; checkpoint omission under size cap; KV ID lookup behavior in Worker.
- Integration/manual: hidden gesture from title, playing, shop, and gameover;
  cellular upload from iPhone; `diag:pull <id>` retrieves the exact bundle;
  `window.__loadReplay(bundle.replay)` or headless replay reproduces the run.

## 8. Build order

0. **Rebase/cherry-pick the plan onto current `main`.** Do not merge the
   stale branch as-is.
1. **Client buffer + replay snapshot + bundle, no network.** `diag-buffer`,
   `replay-snapshot`, `diag-bundle`, `install-id`, `build-info`, baked build
   metadata. Verify a bundle assembles with logs + current/last replay.
   Useful immediately: bundle can be saved via the existing share sheet as a
   fallback.
2. **Local dev parity.** Add `/api/save-diag-bundle`; prove the exact bundle
   shape writes locally before pointing an iPhone at the cloud. This catches
   schema nonsense cheaply, before Cloudflare joins the ceremony.
3. **Worker + R2 + KV lookup + ingest.** Deploy, validate with `curl`/`wrangler`
   before any client wiring. `diag:pull` script.
4. **Wire client sink + hidden gesture.** End-to-end from device over
   cellular → R2 → `diag:pull` → replay reproduces the run.
5. **TestFlight readiness.** Privacy manifest, questionnaire/policy text,
   rate caps, and labeled tester-facing "Send bug report" button on the same
   pipeline.

Each step is independently useful; stop after any step and still have a
working improvement over today.

## 9. Open questions to resolve at implementation

- Worker domain: start on `dmc-diag.<acct>.workers.dev`; custom domain
  only if it ever matters.
- Where to keep `worker/` and `wrangler.toml` — in-repo (convenient) vs
  private. Leaning in-repo with secrets in `wrangler secret`, not files.
- Exact hidden gesture (5-tap dead-zone vs long-press on version stamp) —
  decide during UI wiring; must be undiscoverable in normal play.
- Whether to also keep the dev LAN `/api/save-device-log` path as a
  parallel event stream when on home wifi. For full bundles, use
  `/api/save-diag-bundle` instead.
- HMAC key rotation story (low priority at this scale).
- R2 lookup strategy: KV `id -> r2Key` vs self-describing ID. This must be
  resolved before implementing `GET /diag/<id>` or `diag:pull <id>`.
- Bundle cap target: measure real replay + 1000-log bundles before locking
  256 KB. Start with a stricter client pruning policy and a slightly roomier
  backend cap.
- Device metadata: install `@capacitor/device` or explicitly accept
  browser/WebView best-effort fields only.
