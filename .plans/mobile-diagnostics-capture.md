# Mobile Diagnostics Capture — Focused Plan

Status: design, ready to implement
Date: 2026-06-03
Branch: `claude/mobile-replay-logging-umN6Z`

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

| Question        | Decision                                              |
| --------------- | ----------------------------------------------------- |
| Deliverable     | Write this focused plan first, implement after review |
| Off-wifi sink   | **Cloud upload backend now** (not share-sheet only)   |
| Log scope       | **Errors + key events** (lifecycle, wave, shop, death)|
| Trigger         | **Hidden dev gesture** (on-demand bundle upload)      |

## 1. How this relates to the existing platform plan

`.plans/run-recap-playtest-platform.md` already designs a Cloudflare
Worker + R2 + D1 backend, but for **virality / telemetry / leaderboards**.
This plan is a **deliberately narrow slice**: a *diagnostics bundle*
upload path for troubleshooting my own builds and TestFlight test plays.

What this plan **reuses** from that design:

- Cloudflare Worker + R2 single-stack recommendation (§7 there).
- Per-install anonymous UUID, size cap, HMAC build token, retention policy.
- Replay-as-source-of-truth seam (replay re-runs headlessly later).

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
- **Build id helper.** `getBuildId()` in `vite-build-id.ts` →
  `<shortSha>` or `<shortSha>+<diffHash>`. Currently stamped
  **server-side** by the Vite plugins, so it is **not present in a prod
  bundle** that has no dev server. We need it baked in at build time.
- **Capacitor plugins installed:** `@capacitor/app`, `core`, `filesystem`,
  `share`. No HTTP plugin needed — `fetch` to the Worker is fine.

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
                                • size cap (256 KB) + per-IP rate limit
                                • gzip → R2  key: diag/<installId>/<ts>-<id>.json.gz
                                • return { id }  (short ref to quote back)
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
  - On boot, load any prior `buffer.json` into a `previousSession` slot so
    the next bundle includes the crash that killed the last run, then
    rotate it aside.
- **Safety**: every path wrapped in try/catch and swallowed, exactly like
  `client-log.ts` — diagnostics must never break the run.
- **Enablement**: buffer is **always on** in native builds (this is the
  whole point of TestFlight troubleshooting). Keep it cheap enough that
  always-on is free. A `localStorage["dmc:diag"]="0"` kill switch exists.

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

### 4.3 `src/diag-bundle.ts` — the artifact (new)

```ts
type DiagBundle = {
  schemaVersion: 1;
  meta: {
    buildId: string;          // baked at build time (see 4.5)
    installId: string;        // anon per-install UUID (4.4)
    displayName?: string;     // optional self-name ("It's Mike")
    platform: string;         // ios / web / ...
    device: { model?; osVersion?; webview? };
    screen: { w; h; dpr; safeArea? };
    appState: { screen; wave?; score? };
    capturedAt: number;
    note?: string;            // optional one-line note from the gesture
  };
  logs: DiagEvent[];          // current session ring buffer
  previousSessionLogs?: DiagEvent[]; // crash from the run that died
  replay?: ReplayData;        // current or last run's deterministic replay
};
```

The replay is the existing `window.__lastReplay` / live action log —
reuse `src/save-replay.ts`'s notion of the current replay. Bundle stays
small (replays are tens of KB; logs a few KB). Gzip on the Worker side.

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
  `/api/save-device-log` style route in dev for parity if desired.
- Headers: `x-dmc-build`, `x-dmc-install`, and an **HMAC token** derived
  from a key embedded in the build over `installId+capturedAt` (raises the
  bar against random abuse; security-by-obscurity, matches platform §7).
- `keepalive: true`, single retry with small backoff, all failures
  swallowed and surfaced only as a toast. Never throws into gameplay.

## 5. Backend implementation (minimal)

A single Cloudflare Worker + one R2 bucket. **No D1 for the MVP** — the
replay+logs blob is enough for troubleshooting; D1 indexing arrives with
the leaderboard/telemetry work.

- Repo location: `worker/` (own `wrangler.toml`; deploy with
  `wrangler deploy`). Keep secrets (HMAC key) in `wrangler secret`.
- **`POST /diag/ingest`**:
  - Verify HMAC token; reject on mismatch.
  - Enforce `Content-Length` ≤ 256 KB; per-IP rate limit (e.g. KV or
    Worker rate-limiting binding) — cap ~50/day/install.
  - `gzip` the body, write to R2 key
    `diag/<installId>/<capturedAt>-<rand>.json.gz`.
  - Return `{ id }` (the `<rand>` short ref).
- **`GET /diag/<id>`** (auth-gated, e.g. a bearer in `wrangler secret`):
  fetch a bundle for inspection. Not public.
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
- Requires (per platform plan §6): `PrivacyInfo.xcprivacy` Privacy
  Manifest, App Privacy questionnaire answers, a privacy policy URL.
- Each upload is an explicit user action (gesture or button) → honest,
  per-action consent. No silent background streaming in this slice.

## 7. File-by-file change list

New:

- `src/diag-buffer.ts` — ring buffer, error/rejection capture, persistence.
- `src/diag-bundle.ts` — bundle assembly + `DiagBundle` type.
- `src/diag-sink.ts` — Worker upload transport + HMAC.
- `src/diag-gesture.ts` — hidden gesture binding + toast.
- `src/install-id.ts` — anon UUID (+ optional displayName).
- `src/build-info.ts` — reads baked `__BUILD_ID__` / endpoint.
- `worker/` — Worker source + `wrangler.toml`.
- `scripts/diag-pull.mjs` — pull bundles from R2 locally.

Changed:

- `vite.config.ts` — `define` for `__BUILD_ID__` and `__DIAG_ENDPOINT__`.
- `src/game.ts` — route the existing `clientLog` seams through `diag()`
  too (or have `clientLog` delegate into the buffer), bind the gesture at
  boot, surface the build stamp.
- `src/run-recap-death-clip.ts` — fold its local error listeners into the
  centralized `diag-buffer` (avoid double-binding).
- `package.json` — `diag:pull` script.
- `ios/App/App/PrivacyInfo.xcprivacy` — privacy manifest (if not present).

Tests:

- Unit: ring-buffer cap/rotation, persistence throttle, bundle assembly,
  HMAC signing, install-id stability. Logger must stay no-throw under a
  failing `fetch`/`Filesystem` (mirror `client-log` test style).

## 8. Build order

1. **Client buffer + bundle, no network.** `diag-buffer`, `diag-bundle`,
   `install-id`, `build-info`, baked build id. Verify a bundle assembles
   with logs + replay. (Useful immediately: bundle can be saved via the
   existing share sheet as a fallback.)
2. **Worker + R2 + ingest.** Deploy, validate with `curl`/`wrangler`
   before any client wiring. `diag:pull` script.
3. **Wire client sink + hidden gesture.** End-to-end from device over
   cellular → R2 → `diag:pull` → replay reproduces the run.
4. **TestFlight hardening.** Privacy manifest, rate caps, labeled
   tester-facing "Send bug report" button on the same pipeline.

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
  parallel sink when on home wifi (cheap parity; probably yes).
- HMAC key rotation story (low priority at this scale).
```
