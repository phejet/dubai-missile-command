# Plan: Migrate Game Rendering from Canvas2D to Pixi.js

## Goal

Replace the Canvas2D frame compositor in `src/game-render.ts` with a Pixi.js (v8) WebGL renderer while keeping `src/art-render.ts` as the one-shot texture bakery and leaving simulation (`src/game-sim.ts`, `src/game-logic.ts`) untouched. Endpoint: single WebGL renderer, no `live` render-mode toggle, measurable GPU headroom for glow/particles on iOS. A replay-driven perf-measurement harness (local MacBook → iPhone loop, expandable to TestFlight) gates the migration with hard before/after numbers.

## Context

### Current architecture (verified)

- **Sim/render split is already clean.** `game-sim.ts` does not import render modules. The renderer reads a `GameState` and issues draw calls.
- **`art-render.ts` (~2.8k LOC) is a bakery.** All structural art is pre-rasterized at startup via `buildBurjAssets`, `buildLauncherAssets(scale, damaged)`, `buildBuildingAssets(baseY)`, `buildTitleBuildingAssets(baseY)`, `buildThreatSpriteAssets(scale)`, `buildInterceptorSpriteAssets(scale)`, `buildUpgradeProjectileSpriteAssets(scale)`, `buildDefenseSiteAssets()`, `buildPlaneAssets()`, `buildSkyAssets(stars, h, groundY)`. Each returns offscreen `HTMLCanvasElement` atlases via `createSpriteCanvas()`.
- **`game-render.ts` (~3.8k LOC, ~1200 `ctx.*` calls) is the frame compositor.** Key per-frame entry points: `drawGame`, `drawTitle`, `drawGameOver`. Internal draw functions (line numbers from current HEAD): `drawSharedSky:767`, `drawGameplayForegroundBuildings:781`, `drawSharedBurj:888`, `drawSharedWater:1391`, `drawBurjWarningPlate:1430`, `drawDecoyFlares:1597`, `drawPlanes:1643`, `drawLasersAndBullets:1694`, `drawMissiles:1733`, `drawDrones:1856`, `drawInterceptors:1943`, `drawUpgradeProjectiles:2006`, `drawExplosionsAndParticles:2091`, `drawGroundStructures:2388`, `drawHUD:2693`, `drawUpgradeRangeOverlay:3138`, `drawCollisionOverlay:3285`.
- **Dependency layering is still upside down.** `game.ts` imports `buildBuildingAssets` from `art-render.ts`, and `game-render.ts` imports both baked-asset builders and Canvas2D draw helpers from `art-render.ts`. That means the controller and the concrete renderer both know the bakery. Before benchmarking or Pixi work, land a composition-root seam so `game.ts` depends only on a `GameRenderer` interface and concrete renderers depend on typed render resources instead of importing `art-render.ts` directly.
- **PNG assets loaded outside the bakery.** `game-render.ts` also lazily loads standalone bitmaps via `new Image()` at lines 104, 123, 141, 195, 231 (sky nebula + four more). These are not produced by `art-render.ts` and will not be covered by a canvas-only texture adapter — they need their own Pixi asset pipeline.
- **Editor consumes the 2D renderer.** `src/EditorApp.tsx:3` imports `drawGame` from `game-render.ts` and invokes it in the preview loop at `src/EditorApp.tsx:313`. Deleting `game-render.ts` breaks the editor; porting it is a required step, not an optional audit.
- **Composite sprite shapes.** `buildBuildingAssets` returns static sprite + animated light frames; `buildLauncherAssets` returns chassis + rotated turret + muzzle effect pieces; the Burj has baked frames plus live decals/hit-flash overlays. Porting these is "compose a container with several children," not "swap one sprite."
- **Web vs Capacitor build split.** `vite.config.ts:14` sets `base: "/dubai-missile-command/"` for GitHub Pages unless `CAPACITOR=1`. Any dev-server URL used in the perf harness must account for this base path (or run with `CAPACITOR=1` to remove it). The repo ships _both_ targets via `.github/workflows/deploy.yml`; migration acceptance has to cover both.
- **`getBuildId()` already exists.** `vite-replay-plugin.ts:10` produces a build id that is SHA-for-clean, `<sha>+<diffHash>` for dirty. Used in `vite-replay-plugin.ts:54` to stamp replays. Perf plugin must reuse it.
- **`game.ts:868 startRenderLoop`** is the only caller of `drawGame/drawTitle/drawGameOver`. It runs fixed-timestep sim, then `snapshotPositions → applyInterpolation(alpha) → drawGame(ctx, game, opts) → restorePositions`.
- **`live` render-mode toggle is disposable.** Per user: it existed only during the bake-migration; structural art is now fully baked. `drawSharedTower`, `drawSharedLauncher`, `drawLiveThreatSprite`, `drawLiveInterceptorSprite` become asset-bakery inputs only — no runtime call sites required after migration.
- **Perf probe (`game-render.ts:80`)** disables `shadowBlur` if avg FPS < 45 over first 60 frames. This becomes obsolete under Pixi (GPU filters) but the `perfState` object is read by HUD (`buildHudSnapshot` in `game.ts`).
- **In-canvas text:** MIRV warning, purchase toast, low-ammo warning, wave-cleared banner, multi-kill labels, game-over overlays, HUD strings drawn via `ctx.fillText` inside `drawHUD`, `drawBurjWarningPlate`, `drawTitle`, `drawGameOver`. Real DOM HUD already exists (`ui.ts`, `updateHud`, `#battlefield-hud`) — the in-canvas strings are additive.
- **Tests that pin the renderer:** `src/art-render.test.ts`, `src/game-render.test.ts`, `scripts/check-render-toggle.mjs`. jsdom is configured via `vitest`. Art-bakery tests stay valid (offscreen `HTMLCanvasElement` works in jsdom). Render tests need WebGL-less execution.
- **Headless sim path (`src/headless/*`)** does not touch rendering — unaffected.
- **Capacitor iOS ships the same bundle.** WebGL is available in iOS WKWebView; context loss on backgrounding must be handled.
- **Canvas size** `CANVAS_W=900 × CANVAS_H=1600`, fixed. The existing DOM `<canvas id="game-canvas">` is retained; we swap the renderer attached to it.
- **Dependencies:** no Pixi today. React is present but unused on the game canvas (`game.ts` is pure DOM). Adding `pixi.js@^8` is the only new runtime dep.

### Perf-measurement design (replay-driven, A+B+C stack)

Rationale: replays are sim-deterministic (seeded RNG + action log), so identical sim on every device; variance between runs is purely renderer + host. This makes them the right instrument to gate "is Pixi actually faster than `ctx`?" The harness combines three pieces, designed so local matches TestFlight byte-for-byte except for the sink URL.

- **A — HTTP POST sink to Mac dev server.** `PerfRecorder` emits a versioned JSON report to `POST /api/save-perf`, handled by a new Vite middleware that writes `perf-results/runs/<buildId>/<device>-<runId>.json`. Mirrors the existing `fetch("/api/save-replay", ...)` pattern in `game.ts:568`. No phone interaction after launch.
- **B — Capacitor Live Reload.** Dev-mode `capacitor.config.ts` points `server.url` at `http://<mac-hostname>.local:5173` so the installed iOS app is a thin WKWebView client for `npm run dev:lan`. HMR works over LAN. Removes rebuild per iteration. ATS is relaxed via `NSAllowsLocalNetworking = true`; `cleartext: true` permits HTTP to the Mac. Dev config only — production TestFlight build uses static `dist/`.
- **C — Mac CLI harness.** `xcrun devicectl device process launch --device <udid> <bundle-id> --payload-url <deep-link>` launches the installed app and deep-links a replay via a registered URL scheme (`dubaimissile://perf?replay=stress&autoquit=1`). `scripts/bench.sh` wraps: launch → wait for POST → run analyzer → print p50/p95/p99. Single command from Mac, zero phone taps.
- **Core stays constant.** `PerfRecorder` + report schema v1 + `scripts/perf-analyze.mjs` do not change between local and TestFlight. Only the sink URL swaps (dev-server LAN → hosted endpoint) and the trigger (URL scheme → in-app opt-in menu).
- **Report schema v1:** `{ schemaVersion: 1, runId, buildId, replayId, deviceInfo: { ua, dpr, drawingBufferSize, screenSize, isCapacitor }, frames: [{ tick, frameMs, gpuMs?, missiles, drones, interceptors, particles, explosions }], summary: { p50, p95, p99, longFrameCount16, longFrameCount33 } }`. Versioned from day one.
- **Build-id source of truth:** `buildId` reuses the existing `getBuildId()` in `vite-replay-plugin.ts:10`, which already produces `<shortSha>` or `<shortSha>+<diffHash>` (dirty-worktree aware) and is stamped onto saved replays at `vite-replay-plugin.ts:54`. The perf plugin imports and calls the same helper so perf reports and replay files are directly joinable on `buildId`. No `VITE_BUILD_SHA` — do not invent a second scheme.
- **Renderer-ownership rule:** a single `HTMLCanvasElement` can only be bound to one rendering API (`getContext("2d")` _or_ WebGL) for its lifetime. `game.ts:232` currently calls `getContext("2d")` during `Game` construction, which poisons the canvas for Pixi. The migration therefore _cannot_ run "`ctx` alongside Pixi on the same canvas." Resolution: after Step 0, the bootstrap/composition layer owns renderer selection and picks Canvas2D _or_ Pixi _before_ any `getContext` call on the primary canvas. Incremental work during the migration runs Pixi on a second stacked canvas sized identically (`position: absolute`, same rect) only when exercising isolated scenes; the second canvas is removed at cutover.

### Architectural target

```
sim (unchanged) ──► game.ts ──► GameRenderer interface ──► PixiRenderer ──► WebGL
                                           │
                                           ▼
                                render resources ◄── art-render.ts (bake once)
```

- **Bootstrap/composition target (lands before benchmarking):** `src/boot-game.ts` (or equivalent composition root) assembles the runtime. It loads render resources, instantiates `Canvas2DRenderer` or `PixiRenderer`, then passes only a `GameRenderer` interface into `Game`. `game.ts` no longer imports `art-render.ts`, `game-render.ts`, or Pixi directly.
- **Canvas2D baseline target:** `src/game-render.ts` becomes the Canvas2D renderer implementation and consumes a typed `CanvasRenderResources` seam (baked canvases, PNGs, layout metadata, and any renderer-private helpers moved out of `art-render.ts`). It does not import `art-render.ts` directly after the prerequisite refactor.
- `art-render.ts` keeps producing `HTMLCanvasElement` atlases. A new thin adapter (`src/pixi-textures.ts`) wraps each baked canvas in `Texture.from(canvas)` once, and re-uploads on `webglcontextrestored`.
- `src/game-render.ts` is replaced by `src/pixi-render.ts` that owns the Pixi `Application`, a layered scene graph, and `updateScene(state, alpha)` which mutates display objects from `GameState`.
- `game.ts` keeps its fixed-timestep loop and delegates frame output through the injected `GameRenderer` interface (`renderGameplay`, `renderTitle`, `renderGameOver`). The `snapshotPositions/applyInterpolation/restorePositions` seam is _preserved_ through the early migration to minimize blast radius; Step 10 removes it.

## Steps

Numbering: Phase 0 (Step 0) lands the composition-root/render-resource refactor on the existing Canvas2D path _before_ any benchmarking, so the baseline and Pixi branches share the same runtime boundary. Phase 1 (Steps 1.1–1.4) then lands perf infrastructure and captures the post-Step-0 Canvas2D baseline. Phase 2 (Steps 2–13) is the Pixi migration, with Step 13 exercising the Phase 1 harness.

### Step 0: Lift art/resource assembly to the bootstrap layer

- **Files**: new `src/boot-game.ts`, new `src/game-renderer.ts`, new `src/canvas-render-resources.ts` (or equivalently named seam module), `src/main.ts`, `src/game.ts`, `src/game-render.ts`, `src/art-render.ts`, `src/EditorApp.tsx` (if current Canvas2D API wiring changes), tests/docs as needed
- **Changes**:
  - Introduce a narrow `GameRenderer` interface (`renderTitle`, `renderGameplay`, `renderGameOver`, `resize`, `destroy`) and move runtime assembly into `src/boot-game.ts`. The composition root owns selecting and constructing the concrete renderer, then passes only the interface into `Game`.
  - Refactor `game.ts` into a controller-only module. It no longer imports `art-render.ts`, `game-render.ts`, or Pixi directly. It owns the fixed-timestep loop, replay wiring, UI snapshot building, and controller state, then delegates frame output to the injected `GameRenderer`.
  - Move any temporary renderer-selection / render-mode toggle state (`gameplayRenderMode`, `titleRenderMode`, related button wiring) into `src/boot-game.ts` or a Canvas2D-only runtime helper during this refactor. `Game` stays renderer-agnostic after Step 0.
  - Add `src/canvas-render-resources.ts` as the seam for the existing Canvas2D path. This module imports `art-render.ts` plus the standalone PNG loaders, bakes/caches the current 2D resources, and exports a typed `CanvasRenderResources` catalog that `src/game-render.ts` consumes.
  - Move Canvas2D-specific helper surface area out of `art-render.ts`'s public API. Baked asset builders and geometry helpers stay in `art-render.ts`; renderer-facing draw helpers such as `drawBakedProjectileSprite`, `drawBakedStaticSprite`, `drawBakedLauncher`, `drawLiveThreatSprite`, `drawLiveInterceptorSprite`, `drawSharedLauncher`, `drawSharedTower`, and `drawFlickerWindows` move behind the Canvas2D seam (for example into `src/canvas-render-resources.ts` or a sibling `src/canvas-art-runtime.ts`). End state for this step: `src/game-render.ts` no longer imports `art-render.ts` directly.
  - Keep the current Canvas2D visuals byte-for-byte equivalent. This step is dependency inversion, not a renderer rewrite. The desktop/iOS baselines captured in Phase 1 are taken _after_ this refactor so perf numbers compare like with like at the runtime-boundary level.
  - If the Canvas2D renderer API changes, update `src/EditorApp.tsx` to obtain the same baseline resources via a tiny editor bootstrap helper rather than reaching into `art-render.ts` directly. The editor still stays on Canvas2D until Step 8.5; this prerequisite only keeps it compatible with the new assembly boundary.
- **Rationale**: benchmarking before the boundary cleanup would lock the old dependency tangle into the baseline and force the Pixi branch to pay for architecture cleanup "for free." Land the seam first so both renderers are judged through the same controller/bootstrap contract.

### Step 1.1: Perf recorder core + schema + analyzer

- **Files**: new `src/perf-recorder.ts`, new `src/perf-sinks.ts`, new `scripts/perf-analyze.mjs`, `src/boot-game.ts`, `src/game.ts` (only if the controller needs a tiny recorder hook)
- **Changes**:
  - `src/perf-recorder.ts` exports `PerfRecorder` with `start({ replayUrl, autoquit, sink })`, `onReplayFinish()` hook, and the versioned report schema (see Context → Perf-measurement design). Frame sampler subscribes to the existing RAF loop; pushes `{ tick, frameMs, gpuMs?, missiles, drones, interceptors, particles, explosions }` using the counts already present on `GameState`. Metadata (`buildId`, `replayId`, `deviceInfo`, `runId`) is attached to the final report before emission.
  - `src/perf-sinks.ts` declares `interface PerfSink { emit(report: PerfReport): Promise<void> }` and ships `ConsoleSink` (`console.log("PERF_REPORT_V1", JSON.stringify(report))`) and `HttpSink(url)` (POSTs JSON). No native dependencies; works in browser and WKWebView identically.
  - `scripts/perf-analyze.mjs` accepts explicit file/dir inputs (defaulting to `perf-results/runs/`), groups reports by `(replayId, buildId, deviceHash)`, and prints a matrix of p50/p95/p99 frame time, long-frame counts (>16.67 ms, >33 ms), and entity-count correlations. Pure Node, no deps.
  - `buildId` is supplied by the Vite perf middleware (see Step 1.2), which calls the existing `getBuildId()` helper in `vite-replay-plugin.ts:10` and stamps it onto the report server-side — exactly the pattern already used for replays. The client recorder does not compute a build id.
  - Wire the URL-param trigger in the bootstrap layer (`src/boot-game.ts`): `?perf=1&replay=<path>&autoquit=1` is parsed before runtime construction, the replay is fetched via the same boot path that already initializes the game, `PerfRecorder` starts against the constructed runtime, and on `runner.isFinished()` dumps the report and shows a DONE banner. `src/game.ts` only gets a tiny hook if the controller must expose replay-finished or frame-sample timing signals.
- **Rationale**: the fixed core. Every later environment (local URL bookmark, local Capacitor, TestFlight) plugs different triggers and sinks into this module unchanged.

### Step 1.2: Benchmark suite + local exfil (A)

- **Files**: new `vite-perf-plugin.ts` (sibling of `vite-replay-plugin.ts`), `vite.config.ts`, new `public/replays/perf-*.json`, new `perf-results/baselines/.gitkeep`, new `perf-results/pixi/.gitkeep`, `.gitignore`, `package.json`
- **Changes**:
  - Record three reference replays by playing (or bot-driving) the post-Step-0 Canvas2D baseline and saving via the existing `/api/save-replay` path: `perf-stress.json` (many MIRVs, full shop, late wave), `perf-lategame.json` (upgrade-heavy endgame), `perf-particle-spam.json` (explosions/particles worst case). Commit under `public/replays/`. Each replay exposes a stable `replayId = sha256(seed || JSON.stringify(actions))` written into the file.
  - Implement `vite-perf-plugin.ts` mirroring `vite-replay-plugin.ts`: imports `getBuildId()` from the replay plugin (or a shared helper extracted into `vite-build-id.ts`), handles `POST /api/save-perf`, validates `schemaVersion`, stamps `_buildId` + `_savedAt` server-side, writes `perf-results/runs/<buildId>/<deviceHash>-<runId>.json`. Register in `vite.config.ts` alongside the existing replay plugin. Dev-only.
  - **Artifact policy (committed once, stated here):** `perf-results/runs/**/*.json` and `perf-results/latest/**/*.json` are git-ignored (ad-hoc outputs + convenience copies). `perf-results/baselines/**/*.json` and `perf-results/pixi/**/*.json` are _committed_ (curated median-of-3 reports used as comparison artifacts). `.gitignore` uses the explicit `perf-results/runs/` and `perf-results/latest/` prefixes; `baselines/` and `pixi/` dirs each have a `.gitkeep`.
  - Add `npm run dev:lan` = `CAPACITOR=1 vite --host 0.0.0.0` so the dev server binds to the LAN interface _and_ strips the GH-Pages base path. The plain `npm run dev` remains unchanged. All perf URLs documented in the plan assume `dev:lan`.
  - Smoke-test on desktop Chromium: `npm run dev:lan`, then `http://<mac-hostname>.local:5173/?perf=1&replay=/replays/perf-stress.json&autoquit=1` writes a file under `perf-results/runs/`, analyzer reads it, numbers print.
- **Rationale**: closes the desktop-only loop, reuses the existing build-id machinery, and pins the committed-vs-ignored artifact split so Phase 2 doesn't rediscover the contradiction.

### Step 1.3: Capacitor Live Reload + ATS + URL scheme (B+C foundations)

- **Files**: `capacitor.config.ts` (env-driven), new `.env.local.example`, `ios/App/App/Info.plist`, `src/main.ts`, `src/boot-game.ts`, `package.json` (install `@capacitor/app`, add scripts)
- **Changes**:
  - **Capacitor dev vs prod config, env-driven (no separate files):** `capacitor.config.ts` reads `process.env.CAP_DEV_SERVER`. When set (e.g. `http://mac.local:5173`), emits `server: { url: $CAP_DEV_SERVER, cleartext: true, allowNavigation: [new URL($CAP_DEV_SERVER).hostname] }`. When unset (the default), emits no `server` block — prod ships `dist/` unchanged. Rationale: one config file, harder to accidentally ship Live Reload. Prod-safety check in Step 1.4 asserts `server` is absent from the synced iOS bundle.
  - `<mac-hostname>` sourced from `scutil --get LocalHostName` at harness launch time; documented in `.env.local.example`. Fallback to a static LAN IP if mDNS is blocked on the network.
  - `Info.plist` edits (committed):
    - `NSAppTransportSecurity → NSAllowsLocalNetworking = true` (LAN HTTP exemption only; does not weaken prod posture against public HTTP).
    - Register custom URL scheme under `CFBundleURLTypes`: `{ CFBundleURLName: "com.<yourid>.dubaimissile.perf", CFBundleURLSchemes: ["dubaimissile"] }`.
  - Install `@capacitor/app`; in `src/main.ts` add `App.addListener("appUrlOpen", event => { ... })` that parses `dubaimissile://perf?replay=<name>&autoquit=1` and forwards structured boot options into the same bootstrap path in `src/boot-game.ts` that the query-string trigger uses. The two trigger surfaces converge on one runtime-construction path rather than each inventing their own startup ritual.
  - New npm scripts:
    - `dev:lan` → `CAPACITOR=1 vite --host 0.0.0.0` (see Step 1.2).
    - `ios:dev` → `CAP_DEV_SERVER=http://$(scutil --get LocalHostName).local:5173 npm run cap:sync && npm run cap:open` (Live Reload iOS build; does not rebuild the web bundle).
    - `ios:prod` → existing `npm run ios` (unchanged).
  - **`devicectl` invocation syntax is unconfirmed.** Codex claims `launch <bundle-id> --payload-url <deep-link>`; the plan's earlier draft used `launch --device <udid> <url>`. Step 1.4 opens with a verification subtask that runs `xcrun devicectl device process launch --help` against the installed Xcode and records the correct form in `scripts/bench.sh`. Do not commit harness code before that check.
- **Rationale**: enables iteration without rebuild (Live Reload) and Mac-side launch control (URL scheme). One-time iOS-side setup whose prod safety is enforced by the dev-vs-prod env gate.

### Step 1.4: Mac CLI harness + Canvas2D baseline capture

- **Files**: new `scripts/bench.sh`, new `scripts/perf-wait.mjs`, `perf-results/baselines/` (committed), `README.md` / `CLAUDE.md` (document workflow)
- **Changes**:
  - **Pre-work:** run `xcrun devicectl device process launch --help` on the target Xcode and confirm the real invocation shape (Codex's review suggests `launch <bundle-id> --payload-url <deep-link>`, not `launch --device <udid> <url>`). Commit a one-line note with the installed Xcode version next to the script.
  - `scripts/bench.sh <replay-name>`:
    1. Source `.env.local` for `IPHONE_UDID`, `BUNDLE_ID`, `MAC_HOSTNAME`.
    2. Assert `npm run dev:lan` is running (probe `http://$MAC_HOSTNAME.local:5173/api/save-perf` with an OPTIONS or HEAD).
    3. Launch via the verified `devicectl` form, e.g. `xcrun devicectl device process launch --device "$IPHONE_UDID" "$BUNDLE_ID" --payload-url "dubaimissile://perf?replay=${REPLAY}&autoquit=1"`.
    4. `node scripts/perf-wait.mjs` watches `perf-results/runs/<buildId>/` via `fs.watch`, matching on the current `runId` (generated Mac-side and passed through the URL as `&runId=...` to eliminate races). Timeout 120s.
    5. On match, copy the run into `perf-results/latest/<replay>.json` for stable diffing, then invoke `perf-analyze.mjs` against the pinned baseline and print a p50/p95/p99 delta table.
  - `scripts/bench.sh --list-devices` wraps `xcrun devicectl list devices` for discovery. `scripts/bench.sh --loop 3` runs the replay 3× with 60s cooldowns and reports median-of-3 (default for committed artifacts).
  - Capture the post-Step-0 Canvas2D baselines: run each benchmark replay 3× (warmup + 3 recorded) on tethered iPhone _with an installed prod build_ (`npm run ios:prod`) and on desktop Chromium, commit median-of-3 reports under `perf-results/baselines/<buildId>/`. These are the numbers Pixi has to beat.
  - Capture a second baseline set via `ios:dev` (Live Reload) so harness stability is documented — these are _not_ the PR metric but prove the harness itself is deterministic.
  - Document the full loop in `CLAUDE.md` under a new "Perf Benchmarking" section, covering `dev:lan`, `ios:dev` vs `ios:prod`, the `.env.local` contract, and how to re-capture baselines when a benchmark replay must be re-recorded (e.g., after a sim change).
- **Rationale**: one Mac command, zero phone interaction per run. Baselines must exist _before_ any Pixi work so regressions and wins are both attributable.

### Step 2: Add Pixi dependency + asset adapters + bootstrap renderer selection

- **Files**: `package.json`, `package-lock.json`, new `src/pixi-render.ts`, new `src/pixi-textures.ts`, new `src/pixi-assets.ts`, `src/boot-game.ts` (seam only), `index.html` (second canvas)
- **Changes**:
  - `npm install pixi.js@^8`. Also install `@pixi/filter-glow` if Step 5's benchmark ever selects the live-filter path — not by default.
  - **Renderer-ownership seam** now lives in the bootstrap layer introduced by Step 0. In `src/boot-game.ts`, replace the hard-coded Canvas2D construction path with a `RendererMode = "canvas2d" | "pixi"` compile-time constant read at startup. For `canvas2d`, behavior is byte-for-byte identical to the Step 0 baseline. For `pixi`, the bootstrapper skips `getContext("2d")` on the primary canvas and instead hands it to `PixiRenderer`. No `USE_PIXI` "alongside" wording — it is either/or per canvas (enforced by the browser).
  - **Second canvas for isolated Pixi experimentation during Steps 3–8:** add a transparent `<canvas id="game-canvas-pixi">` stacked absolutely over `#game-canvas` with identical CSS rect and `pointer-events: none`. `PixiRenderer` attaches to this second canvas while the old 2D path keeps the primary. Both render; visually they overlay. This is a scaffold, removed at Step 9.
  - `src/pixi-render.ts`: `PixiRenderer` class with constructor `(canvas: HTMLCanvasElement)`, owns a Pixi `Application` (`{ canvas, width: 900, height: 1600, backgroundAlpha: 0, antialias: false, preference: "webgl" }`), placeholder methods `renderTitle()`, `renderGameplay(state)`, `renderGameOver(stats)`, `destroy()`.
  - `src/pixi-textures.ts`: wraps every `art-render.ts` bakery output (`buildBurjAssets`, `buildLauncherAssets`, `buildBuildingAssets`, `buildTitleBuildingAssets`, `buildThreatSpriteAssets`, `buildInterceptorSpriteAssets`, `buildUpgradeProjectileSpriteAssets`, `buildDefenseSiteAssets`, `buildPlaneAssets`, `buildSkyAssets`). Because several of these return _structured_ outputs (atlas + frame arrays, multi-part launchers, building light-frame sequences), the adapter returns a typed record mirroring each bakery's shape — not a flat `Record<string, Texture>`. `reupload()` re-runs `Texture.from(canvas)` against cached `HTMLCanvasElement`s for context-restore.
  - `src/pixi-assets.ts`: a _separate_ adapter for standalone PNGs currently loaded via `new Image()` in `game-render.ts:104, 123, 141, 195, 231` (sky nebula + four more). Uses Pixi's `Assets.load()` with manifest-based bundles so title and gameplay packs can be fetched independently. Cache is addressable by the same keys the old code uses, so call-sites map 1:1.
  - Do **not** wire the Pixi renderer into the main gameplay path yet. Title scene in Step 3 is the first cutover.
- **Rationale**: lands dependency, both asset adapters, and plugs Pixi into the renderer seam introduced by Step 0 before any scene porting. The second-canvas scaffold is the only way to run Pixi alongside `ctx` without the browser refusing one of them on the shared element — and it's temporary, so no long-term cost.

### Step 3: Stand up the layered scene graph and render title screen

- **Files**: `src/pixi-render.ts`, `src/boot-game.ts`, `src/ui.ts`, `index.html`
- **Changes**:
  - In `PixiRenderer`, build containers in z-order: `skyLayer`, `cityLayer`, `waterLayer`, `burjLayer`, `groundStructuresLayer`, `effectsLayer` (below projectiles), `projectileLayer`, `particleLayer` (use `ParticleContainer` with `maxSize: 2000`), `overlayLayer`, `hudLayer`.
  - Implement `renderTitle()`: sky from `pixi-textures.ts`, title skyline from the baked building atlas, sky nebula PNG from `pixi-assets.ts`.
  - **Resolve the title-text ownership immediately:** add a DOM title overlay (`#title-overlay`) in `index.html`, with a tiny `ui.ts` bridge that toggles it on the title screen and off elsewhere. The overlay owns the existing "DUBAI / MISSILE COMMAND / DEFEND THE CITY / PRESS START" copy and its CSS flicker treatment. Result: when `RendererMode === "pixi"` on the primary canvas, there is no lingering dependency on `ctx.fillText`.
  - In the bootstrap layer (`src/boot-game.ts`), when `RendererMode === "pixi"`, skip `getContext("2d")` for the primary canvas and hand it to `PixiRenderer`. When `RendererMode === "canvas2d"` (default), the primary canvas keeps 2D; the Pixi-scaffold canvas introduced in Step 2 is where Pixi title experiments render. Both modes are bootable for the full Phase 2 duration.
  - Title scene rendered on the Pixi canvas (scaffold) is the _first_ demo. Once stable, Step 3 also ports it when `RendererMode === "pixi"` so the primary canvas runs Pixi end-to-end for the title screen, with text already handled by the DOM overlay above.
- **Rationale**: title is the simplest scene (static sprites + sky + text), a safe first cutover. The renderer-ownership seam is exercised from day one.

### Step 4: Port gameplay static layers (sky, water, city, Burj, ground structures)

- **Files**: `src/pixi-render.ts`
- **Changes**:
  - **Sky:** one base `Sprite` from the sky nebula PNG (`pixi-assets.ts`) + a per-frame animated `Sprite` driven by `buildSkyAssets`' frame sequence. Frame chosen from sim time, mirroring current `drawSharedSky`.
  - **Water:** `TilingSprite` using the distorted-water baked canvas; horizontal offset advances per tick as today.
  - **City/scenery:** one `Container` per scenic building, each containing: a static base `Sprite` (baked silhouette) + an `AnimatedSprite` or frame-swapped overlay for the light animation frames `buildBuildingAssets` produces. Placement per `SCENIC_BUILDING_LAYOUT`. Not a flat atlas.
  - **Burj:** a `Container` containing (i) a base `Sprite` per damage state (swap texture when `burjHealth` changes), (ii) an animated light-overlay child driven by baked frames, (iii) a live decal child `Container` whose children mirror `game.burjDecals` with pooled `Sprite`s, (iv) a hit-flash child shown when `burjHitFlashTimer > 0`. Decals and hit-flash stay "live" because the sim owns their state; the base and light frames are baked.
  - **Ground structures / launchers:** a `Container` per launcher containing (i) chassis `Sprite` (baked), (ii) animated overlay (baked frames: fire/reload animation), (iii) rotated turret `Sprite`, (iv) muzzle-flash `Sprite` toggled via `launcherFireTick`. Turret rotation is computed from the same current runtime inputs the 2D renderer uses today: launcher position + `game.crosshairX/Y`, clamped by the same angle formula in `drawGroundStructures`. No new `launcherAimAngle` field is introduced into sim state.
  - **Defense sites:** `Sprite`s from `buildDefenseSiteAssets`, with any existing live overlays (health bars, firing indicators) preserved as child `Graphics` nodes.
  - Static-only subtrees (scenic buildings once their animation range is resolved, launcher chassis for intact launchers) get `cacheAsBitmap = true` after first render; invalidated on damage-state change.
- **Rationale**: the bakery already produces composite shapes (atlas + frame arrays + separable parts). The renderer's job is to assemble them into `Container`s, not to pretend each piece is one sprite.

### Step 5: Port dynamic entity layers (missiles, drones, interceptors, hornets, patriot, planes, flares, projectiles)

- **Files**: `src/pixi-render.ts`
- **Changes**:
  - **Pooling identity rules (explicit):**
    - Long-lived entities that already survive across ticks as stable object references in sim arrays (`missiles`, `drones`, `interceptors`, `hornets`, `roadrunners`, `patriotMissiles`, `planes`, `flares`, `explosions`) are matched to Pixi sprites via renderer-local object-identity maps (`WeakMap<object, Sprite>` or paired `Map<object, Sprite>` + free-list). No ids are added to shared gameplay types just for rendering.
    - Short-lived or dense entities (`particles`, `phalanxBullets`, laser beam segments, trail-puff sprites) are rebuilt each frame: clear the container, emit fresh `Sprite`s from a preallocated pool. Per-frame identity is neither needed nor maintained.
    - Trails that need polyline continuity (gradient trail, shahed exhaust) are rendered as `Graphics` strokes rebuilt each frame from the sim's point buffer — no sprite identity issue.
    - Audit pass during Step 5 records every entity array in `pixi-render.ts` as `{object-identity pooled | rebuild-each-frame}` so the rule is enforced locally in the renderer instead of leaking render bookkeeping into `src/types.ts`.
  - **Container choice:**
    - `ParticleContainer` (with `maxSize` sized to worst-case observed in the benchmark replays) for particles + phalanx bullets + trail-segment sprites. Restrictions: no per-child filters, no tinting if `tint` is disabled on construction — verify before committing.
    - Regular `Container` + `Sprite` for entities that need per-sprite state (rotation, filters, child turret barrels).
  - Each frame, iterate sim entities; mutate `sprite.position.set(e.x, e.y)`, `sprite.rotation`, `sprite.alpha`; choose texture by `e.kind` / state from the `pixi-textures.ts` record.
  - Planes + phalanx turret barrels: rotation via `sprite.rotation` from sim's existing aim fields.
  - Regression guard: a unit test builds a mock `GameState` with one of every entity type, calls `renderer.renderGameplay(state)`, and asserts `(container.children.length, child positions)` match expectation. No WebGL required (use Pixi's test harness).
- **Rationale**: per-frame hot loop. Renderer-local object-identity pools avoid GC and the "reused sprite shows previous entity's filter" class of bug without polluting shared gameplay types; rebuild-each-frame is safer for genuinely identity-less entities.

### Step 6: Port effects (explosions, EMP rings, lasers, bullets, glow) — baked-first, filters as benchmarked upgrade

- **Files**: `src/pixi-render.ts`, `src/art-render.ts` (add glow/EMP bakery if missing)
- **Changes**:
  - **Default path — baked glow sprites.** Extend `art-render.ts` with `buildExplosionGlowAssets()` / `buildEmpRingAssets()` that pre-rasterize radial-gradient frames into canvases (mirroring the Burj/launcher bakery pattern). `pixi-render.ts` renders explosions and EMP rings as `Sprite` swaps with `alpha` + `scale` animated from the sim's timer. This alone removes the `shadowBlur` cost on the CPU path and is the floor we commit to.
  - **Optional upgrade — live filters.** `@pixi/filter-glow` / `BlurFilter` on explosion sprites is an _experiment gated by bench numbers_, not the default. Implement behind a `RenderEffectsMode = "baked" | "filtered"` flag. Run the `perf-particle-spam` benchmark in both modes on the target iPhone; commit `filtered` only if p95 on iPhone does not regress. On older devices it may well lose (filter passes per explosion beat baked alpha-sprite fillrate).
  - **Lasers:** a thin additive-blend `Sprite` along the beam line, `width = beam length`, `height = fixed thickness`. Phalanx bullets: `ParticleContainer` entries (Step 5).
  - Remove all `shadowBlur` code paths and the `perfState` probe. Keep a dummy `perfState` export returning `{ glowEnabled: true, probed: true }` so `buildHudSnapshot` and the HUD are unmodified until Step 9.
- **Rationale**: the `shadowBlur` CPU cost disappears either way. Whether `GlowFilter` is faster than a baked glow sprite is an _empirical_ question the harness exists to answer — the plan defaults to the safer bet.

### Step 7: Port overlays (crosshair, MIRV warning, purchase toast, wave-cleared, multi-kill, upgrade range, collider debug, HUD strings)

- **Files**: `src/pixi-render.ts`, `src/ui.ts`, `src/game.ts`, `index.html`
- **Changes**:
  - **Define the overlay contract explicitly:** add `TransientOverlaySnapshot` in `ui.ts` and build it in `game.ts` from existing runtime state. Fields: `mirvWarning`, `purchaseToast`, `lowAmmoWarning`, `waveClearedBanner`, `multiKillToast`, and `titleCopyVisible`. `updateTransientOverlays(snapshot)` becomes the single bridge from sim/controller state to DOM overlays.
  - Add a dedicated `#transient-overlays` container in `index.html` positioned over the canvas rect. `ui.ts` owns the child elements and their show/hide/animate logic. This makes Step 3's title overlay and Step 7's gameplay transient text part of one overlay system rather than two improvised islands.
  - Move transient text (MIRV warning, purchase toast, low-ammo, wave-cleared, multi-kill labels) into that DOM overlay system. The existing HUD is DOM already, so this extends the same pattern and avoids a font-atlas pipeline.
  - Crosshair + upgrade range overlay + collider debug: `Graphics` objects updated per frame on `overlayLayer`.
  - Burj warning plate (health bar / icon): `Sprite` + `Graphics` bar.
- **Rationale**: DOM text dodges Pixi font loading and scales crisply with DPR. In-canvas text was a vestige of the `ctx` era.

### Step 8: Port `drawGameOver` scene

- **Files**: `src/pixi-render.ts`, `src/ui.ts`
- **Changes**:
  - Game-over panel is already DOM (`#gameover-panel`). The canvas behind it only needs to freeze the last gameplay frame or render a muted static background. Implement `renderGameOver()` to draw the baked sky + city + damaged Burj without animation.
- **Rationale**: minimal; most game-over UX is DOM.

### Step 8.5: Port the editor preview off `game-render.ts`

- **Files**: `src/EditorApp.tsx`, `src/editor-scene.ts`, new `src/editor-render.ts` or `src/pixi-editor-preview.ts`, `editor.html` (if needed)
- **Changes**:
  - Remove the direct `drawGame` import from `src/EditorApp.tsx`.
  - Reuse `PixiRenderer.renderGameplay()` for the editor preview if that is cheap enough; otherwise add a tiny dedicated preview adapter that renders the frozen editor scene via Pixi without pulling in gameplay DOM chrome.
  - Preserve the existing editor-only affordances: effects timeline scrubbing, upgrade graph preview, and parameter overrides.
  - Make this a hard prerequisite for Step 9. `src/game-render.ts` is not deleted while the editor still depends on it.
- **Rationale**: the editor is part of this repo's active tooling. Treating it as an afterthought is how you end up with a “successful” migration that quietly breaks half the art workflow.

### Step 9: Flip the cutover, delete the old path

- **Files**: `src/boot-game.ts`, delete `src/game-render.ts`, update bootstrap imports, update `index.html`/`main.ts` if referenced
- **Changes**:
  - Remove the temporary renderer-selection scaffold and second-canvas experiment path; `PixiRenderer` is the only runtime renderer left.
  - Remove the temporary scaffold canvas introduced in Step 2 and its CSS/layout hooks.
  - Delete `src/game-render.ts` and `src/game-render.test.ts`.
  - Remove `live` render-mode plumbing from the bootstrap/Canvas2D baseline path: `gameplayRenderMode` / `titleRenderMode` state, `toggleGameplayRenderMode`, `toggleTitleRenderMode`, the two render-mode buttons in `index.html`, `renderMode` / `skylineRenderMode` arguments, and `scripts/check-render-toggle.mjs` (plus `test:render-toggle` npm script).
  - In `art-render.ts`, drop `drawSharedTower`, `drawSharedLauncher`, `drawLiveThreatSprite`, `drawLiveInterceptorSprite` if no longer called (verify with grep). Keep everything the bakery still needs.
  - Remove `perfState` + FPS probe; simplify `buildHudSnapshot` fields (`perfGlowEnabled`, `perfProbed`) and corresponding HUD chips in `ui.ts`.
- **Rationale**: single-renderer endpoint. No dead code.

### Step 10: Clean up the interpolation seam

- **Files**: `src/game-sim.ts`, `src/game.ts`, `src/pixi-render.ts`
- **Changes**:
  - Replace the `snapshotPositions → applyInterpolation(alpha) → render → restorePositions` mutate-and-restore dance with a renderer that reads `(prev, current, alpha)` and computes `lerp` inline when writing to `sprite.position`. Sim state is no longer mutated for rendering.
  - Keep `snapshotPositions` as the source of `prev` snapshots; delete `applyInterpolation` and `restorePositions` exports.
- **Rationale**: user docs flagged this as the least pure part of the architecture. Pixi's retained-mode model makes the clean version straightforward.

### Step 11: WebGL context-loss resilience

- **Files**: `src/pixi-render.ts`, `src/pixi-textures.ts`, `src/game.ts`
- **Changes**:
  - Register `webglcontextlost` / `webglcontextrestored` listeners on the Pixi-owned canvas. On lost: `event.preventDefault()` and pause the render loop. On restored: call `bakedTextures.reupload()` (re-runs `Texture.from(canvas)` against the cached `HTMLCanvasElement`s, which survive context loss), re-create filters, resume.
  - Add a `visibilitychange` hook to proactively release unused textures on background if memory pressure becomes an issue (optional).
- **Rationale**: iOS WKWebView regularly drops WebGL contexts when backgrounded. Current `ctx` code is immune; Pixi is not.

### Step 12: Tests

- **Files**: `src/art-render.test.ts` (unchanged), delete `src/game-render.test.ts`, new `src/pixi-render.test.ts`, `vitest.config.ts` (maybe), `playwright/` (optional)
- **Changes**:
  - `art-render.test.ts` keeps testing the bakery; `HTMLCanvasElement` in jsdom is enough.
  - Split old render tests into: (a) "sprite-from-state" unit tests that verify the _scene-graph mutation_ from a given `GameState` (no WebGL — use Pixi's `autoStart: false` + a stub `renderer` or assert on container `children.length` / positions); (b) Playwright smoke test that boots the game in a real browser, runs one wave via the bot, and screenshots for regression.
  - Remove `npm run test:render-toggle` and `scripts/check-render-toggle.mjs`.
  - Vitest env: Pixi construction in jsdom requires a WebGL mock. Either (i) gate Pixi-dependent tests under a real-browser Playwright suite, or (ii) add `@vitest/browser` for a subset. Prefer (i) — simpler.
- **Rationale**: preserve bakery coverage; accept that pixel-level regression checks move to Playwright.

### Step 13: Mobile / Capacitor validation via bench harness

- **Files**: `perf-results/pixi/`, `scripts/bench.sh` (no code changes; re-run)
- **Changes**:
  - Build the Pixi branch for production (`npm run ios:prod`), install on the same iPhone that produced the Step 1.4 baseline, and run `scripts/bench.sh perf-stress`, `perf-lategame`, `perf-particle-spam` three times each. Commit median reports under `perf-results/pixi/<buildId>/`.
  - Compare against `perf-results/baselines/` using `perf-analyze.mjs`. Target: p95 frame time improved or within noise on stress + lategame; particle-spam shows meaningful improvement (the scenario shadowBlur was killing).
  - Manually verify: 60fps with glow always on, backgrounding + foregrounding restores rendering within ~1s (Step 11), no `<canvas>` flashing on orientation change, IPA bundle size delta recorded.
  - Also run the same benchmarks via Live Reload (`npm run ios:dev`) to confirm the harness itself is stable across both build modes — Live Reload numbers will be worse than prod-build and are _not_ the PR metric.
- **Rationale**: the `FPS < 45` probe exists because iOS was the constraint. Migration is only a win if the bench harness proves it with the same replays that produced the baseline.

### Step 14 (future, out of scope): TestFlight expansion

- **Files**: will touch `src/perf-sinks.ts` (URL swap), a new privacy-disclosure copy file, a hosted endpoint outside this repo
- **Changes (not in this PR)**:
  - Point `HttpSink` URL at a hosted `/api/v1/reports` endpoint (Cloudflare Worker or Vercel function appending to object storage). Same schema, same analyzer.
  - Add an opt-in "Run benchmark" item to the options menu; default off, one-submission-per-replay-per-day rate limit.
  - Add TestFlight privacy label covering "performance diagnostics" (frame timings + device class + build SHA, no PII).
  - Deploy the Worker/function; point `scripts/perf-analyze.mjs` at the bucket dump.
- **Rationale**: documented here so the Phase 1 design is not retrofitted later. Nothing in Phase 1 or Phase 2 needs to change to support this — only the sink URL and the trigger surface.

## Risks & Open Questions

- **Bundle size.** Pixi v8 core is ~300 kB min+gz; filter package adds more. Measure before/after; if IPA size is a blocker, consider tree-shaking unused subsystems.
- **In-canvas text strategy.** Step 6 assumes we move transient text to DOM. If any text must stay in the canvas (e.g., so screenshot replays capture it), we need `BitmapText` + a bundled arcade font atlas, which reintroduces a small asset pipeline.
- **Filter cost on older iOS devices.** `GlowFilter` on every explosion may be worse than the current baked explosion sprite on very low-end hardware. Benchmark; fall back to a baked glow sprite if needed.
- **`perfState.glowEnabled` removal is HUD-visible.** The perf chip showing "glow on/off" disappears. Confirm this is acceptable product-wise (user implied yes).
- **Replay determinism.** Replays are sim-driven (action log) and render-independent per `docs/replay-system.md` — migration should not affect determinism. Verify with a checkpoint replay before and after.
- **`checkpoints` hash stability.** `buildReplayCheckpoint` in `replay-debug.ts` hashes sim state, not render state; should be unaffected. Re-run `src/headless/sim-runner.js` with a fixed seed before/after to confirm.
- **Editor scene (`src/editor-scene.ts`, `src/EditorApp.tsx`).** Step 8.5 makes editor migration a hard prerequisite for deleting `src/game-render.ts`; if the full Pixi preview proves too heavy, keep a tiny dedicated preview adapter rather than reviving the old gameplay renderer.
- **Context-loss re-upload timing.** First-frame after restore may show missing textures for ~1 RAF. Acceptable; document it.
- **Tooling fallout.** `play-bot.ts` reads `window.__gameRef` only — unaffected. `play-replay.ts` drives the browser — should keep working.
- **Bonjour / LAN reachability.** `<mac-hostname>.local` relies on mDNS, which some corporate/guest networks block. Home Wi-Fi is fine; if it fails, fall back to static LAN IP in `.env.local`.
- **ATS exemption scope.** `NSAllowsLocalNetworking` permits HTTP to private IPs/`.local` hosts only — safe for dev, does not weaken the prod build's ATS posture. Verify the dev-vs-prod Capacitor config split actually prevents the `server.url` leaking into TestFlight.
- **`xcrun devicectl` availability.** Requires Xcode 15+ and the device paired/trusted. On paired device, no per-launch prompts. First-time pair requires manual trust on the phone.
- **Thermal/variance floor.** Even with the harness automated, iOS throttling means single runs are noisy. `scripts/bench.sh` should default to 3 runs + median, with a 60-second cooldown between, to keep numbers meaningful.
- **GPU timing support.** `EXT_disjoint_timer_query_webgl2` is not universally available; `gpuMs` field is optional in the schema. Wall-clock frameMs is the primary metric; GPU time is a diagnostic bonus when present.
- **Live Reload vs prod measurement.** Numbers quoted in PRs must come from prod builds (`npm run ios:prod`), not Live Reload. Harness records both but `perf-analyze.mjs` should label reports with their build mode to prevent confusion.
- **Replay corpus stability.** If the benchmark replays break due to sim changes unrelated to rendering, they must be re-recorded — voiding comparability with past baselines. Mitigation: tag each replay with the `gameSeed` + action-log SHA; analyzer refuses to compare across differing `replayId`s.

## Acceptance Criteria

### Phase 0 (boundary refactor before benchmarking)

- [ ] `src/boot-game.ts` (or the chosen composition-root module) owns runtime assembly; `src/game.ts` no longer imports `art-render.ts`, `src/game-render.ts`, or Pixi directly.
- [ ] A narrow `GameRenderer` interface exists and is the only render dependency `Game` consumes.
- [ ] `src/game-render.ts` no longer imports `art-render.ts` directly; it consumes a typed Canvas2D seam such as `src/canvas-render-resources.ts`.
- [ ] Current Canvas2D visuals and editor preview still boot after the boundary refactor, so Phase 1 baselines are captured on the refactored architecture rather than the old dependency graph.

### Phase 1 (perf infrastructure — lands before any Pixi code)

- [ ] `src/perf-recorder.ts` + `src/perf-sinks.ts` + `scripts/perf-analyze.mjs` present; `?perf=1&replay=...&autoquit=1` produces a schema-v1 JSON report on desktop Chromium.
- [ ] `POST /api/save-perf` Vite middleware writes `perf-results/runs/<buildId>/<device>-<runId>.json`; only ad-hoc outputs under `perf-results/runs/` and `perf-results/latest/` are git-ignored, while curated artifacts under `perf-results/baselines/` and `perf-results/pixi/` are committed.
- [ ] Three benchmark replays committed under `public/replays/perf-{stress,lategame,particle-spam}.json` with stable `replayId` hashes.
- [ ] Capacitor dev config with Live Reload + `NSAllowsLocalNetworking` + `dubaimissile://` URL scheme functional; prod Capacitor build still ships static `dist/` unchanged.
- [ ] `scripts/bench.sh <replay>` runs end-to-end on tethered iPhone with zero phone taps after initial install: launches app via `xcrun devicectl`, waits for POST, prints p50/p95/p99.
- [ ] `perf-results/baselines/<buildId>/` committed, containing median-of-3 reports for all three replays on both desktop Chromium and iPhone.
- [ ] `CLAUDE.md` documents the bench workflow.

### Phase 2 (Pixi migration)

- [ ] `pixi.js@^8` in `dependencies`; app boots with zero `ctx` draw calls in gameplay, title, and game-over screens.
- [ ] `src/game-render.ts`, `src/game-render.test.ts`, `scripts/check-render-toggle.mjs`, `test:render-toggle` npm script all removed.
- [ ] `src/EditorApp.tsx` no longer imports `drawGame`; `editor.html` still renders the preview scene after `src/game-render.ts` is deleted.
- [ ] `live` render-mode toggle and its DOM buttons removed; `art-render.ts` retains only bakery-facing exports actually used by `pixi-render.ts`.
- [ ] `snapshotPositions` remains; `applyInterpolation` and `restorePositions` removed; renderer reads `(prev, current, alpha)` without mutating sim.
- [ ] `buildHudSnapshot` no longer exposes `perfGlowEnabled` / `perfProbed`; HUD renders correctly.
- [ ] Title screen runs in `RendererMode === "pixi"` without any remaining `ctx.fillText` dependency; title copy comes from the DOM overlay system introduced in Steps 3 and 7.
- [ ] `npm run test` green (jsdom-safe tests only); `npm run typecheck` green; `npm run lint` green.
- [ ] Playwright smoke test boots the game, plays one wave via the existing bot, and passes without visual errors.
- [ ] `npm run dev` shows ≥60 fps on desktop Chromium with glow always on.
- [ ] `npm run ios` runs on simulator at 60 fps; backgrounding + foregrounding restores rendering within one second.
- [ ] Replay recorded before migration (seed fixed) replays to the same `finalTick` and final score after migration (sim-deterministic sanity check).
- [ ] Bundle size delta recorded in the PR description.
- [ ] `perf-results/pixi/<buildId>/` committed with median-of-3 reports for all three benchmark replays on iPhone (prod build); `perf-analyze.mjs` diff vs baseline shows p95 improved or within noise on `perf-stress` and `perf-lategame`, meaningfully improved on `perf-particle-spam`.
- [ ] PR description includes the p50/p95/p99 delta table printed by `perf-analyze.mjs`.

## Status

- **Created by**: Claude
- **Validated by**: (pending)
- **Consensus**: (pending)
