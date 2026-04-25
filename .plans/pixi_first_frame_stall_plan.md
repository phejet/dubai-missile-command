# Plan: Eliminate first-encounter frame stall in Pixi gameplay

## Context

After Step 5 of the Pixi migration landed, manual play in desktop Chrome shows a visible frame-rate drop on:

- The **first** missile/drone destruction (first explosion + first particle burst).
- The **first** `stack2` missile split (multiple cold `stack_child` sprites in one frame).

Subsequent explosions and splits render smoothly. The problem is first-encounter cost, not steady-state.

## Hypothesis (to be validated, not assumed)

Five suspects, ranked by expected impact in desktop Chrome on Pixi v8:

1. **WebGL pipeline / shader link on first material.** Pixi v8 lazy-compiles+links shader programs on first use. Boot scene exercises only simple `Sprite` paths; first explosion is the first time `Graphics` with stacked alpha-fills + `cap: "round"` strokes hits the GPU, triggering synchronous `gl.compileShader` + `gl.linkProgram`.
2. **V8 JIT tiering.** `updateGameplayExplosions`, `updateGameplayParticles`, `drawPointTrail`, `cleanupEntityMap`, the various `update*Projectiles` functions don't run during boot. First effect-bearing frame forces baseline → optimizing-tier compile.
3. **Pixi `Graphics` tessellation cache miss.** Each unique shape primitive tessellates on first build. Cached afterwards.
4. **GPU texture upload.** `Texture.from(canvas)` defers upload to first draw. `stack_child`, `mirv_warhead`, `bomb`, F-15 interceptor textures don't reach the GPU until first reference. Smaller cost on desktop than iPhone, not zero.
5. **GC from particle allocation burst.** First explosion spawns ~30 particles, each drawing a fresh `Graphics` from an empty pool — bulk allocation triggers young-gen GC.

Expected dominant cost on desktop: **#1 + #4** for stack2 splits, **#1 + #2** for first explosions.

---

## Phase 0 — Confirm the hypothesis (no shipped code)

Before writing a prewarm path, prove which suspects actually dominate. Each test is reversible and takes <10 minutes. **Do not skip to Phase 1 with a guess.**

### Test 0.1 — Chrome Performance trace (baseline)

**Goal:** see which lane the stall lives in.

1. `npm run dev`, open the game, open DevTools → Performance tab.
2. Click Record, start a new game, wait until the first missile is destroyed, stop recording.
3. Find the long frame — visibly wider than its neighbors.
4. Note which markers appear inside the bad frame:

| Marker location                                              | Means                        |
| ------------------------------------------------------------ | ---------------------------- |
| GPU lane: `compileShader` / `linkProgram`                    | Shader/pipeline compile (#1) |
| Main lane: `(optimize)` / `(compile)` next to function names | V8 JIT tiering (#2)          |
| Main lane: `decodeImage` / GPU lane `texImage2D`             | Texture upload (#4)          |
| Yellow `Minor GC` bar                                        | Allocation burst (#5)        |
| Long Pixi `Graphics` tessellation under Scripting            | Tessellation (#3)            |

Save the trace as `tasks/perf-traces/before-prewarm.json` for later diff.

### Test 0.2 — Isolate texture-upload cost

**Goal:** prove (or rule out) that cold-texture upload is a meaningful share.

In `buildGameplayScene`, just before `this.gameplayState = { ... }`:

```ts
// TEMP DIAGNOSTIC — remove before commit
const ghostLayer = new Container();
this.gameplayScene.addChild(ghostLayer);
const allTextureAssets = [
  ...Object.values(dynamic.threatAssets),
  ...Object.values(dynamic.interceptorAssets),
  ...Object.values(dynamic.upgradeProjectileAssets),
  dynamic.planeAssets.f15Airframe,
];
for (const asset of allTextureAssets) {
  const s = new Sprite("staticSprite" in asset ? asset.staticSprite : asset.sprite);
  s.position.set(-9999, -9999);
  ghostLayer.addChild(s);
}
```

Reload, start a game, observe the **first stack2 split**.

| Outcome                                   | Diagnosis                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Split-stall gone, explosion-stall remains | Texture upload was the stack-split culprit (#4 confirmed); explosion stall is shader/JIT |
| Both stalls unchanged                     | Texture upload is not dominant on desktop — focus on shaders/JIT                         |
| Both reduce                               | Mixed — combine ghost-sprite warm with shader warm in the real fix                       |

Revert the diagnostic block whether it helps or not.

### Test 0.3 — Isolate Graphics pipeline cost

**Goal:** prove (or rule out) that Pixi `Graphics` shader-link is the explosion-stall culprit.

Same place in `buildGameplayScene`:

```ts
// TEMP DIAGNOSTIC — remove before commit
const warmupGraphics = new Graphics();
warmupGraphics.circle(-9999, -9999, 10).fill({ color: 0xffffff, alpha: 0.5 });
warmupGraphics.rect(-9999, -9999, 1, 1).fill(0xffffff);
warmupGraphics
  .moveTo(-9999, -9999)
  .lineTo(-9998, -9998)
  .stroke({ width: 2, color: 0xffffff, alpha: 0.8, cap: "round" });
warmupGraphics.circle(-9999, -9999, 10).stroke({ width: 1.5, color: 0xffffff });
this.gameplayScene.addChild(warmupGraphics);
```

| Outcome                                   | Diagnosis                                                          |
| ----------------------------------------- | ------------------------------------------------------------------ |
| First-explosion stall disappears          | Pipeline compile (#1) was dominant                                 |
| First-explosion stall reduces but lingers | Pipeline + JIT both contribute — combine fixes                     |
| Stall unchanged                           | Cost is JIT or GC, not pipeline — drop pipeline warm from real fix |

### Test 0.4 — Isolate JIT warmup

**Goal:** prove whether V8 tiering is a measurable share.

Top of `updateGameplayScene`:

```ts
// TEMP DIAGNOSTIC — remove before commit
if (!this._jitWarmedUp) {
  for (let i = 0; i < 5; i++) {
    this.updateGameplayDynamicEntities(state.dynamic, game, sceneTime);
  }
  this._jitWarmedUp = true;
}
```

(Real arrays at this point are empty/short — the goal is to make V8 tier up while no real frame is at stake.)

| Outcome                      | Diagnosis                                         |
| ---------------------------- | ------------------------------------------------- |
| First-effect frames smoother | JIT tiering is real — keep equivalent in real fix |
| No change                    | JIT not dominant — skip JIT-prewarm work          |

### Test 0.5 — Numerical baseline via existing perf harness

**Goal:** reproducible number for before/after comparison.

```bash
npm run dev:lan -- --port 5173 --strictPort
# in another terminal:
npm run perf:smoke -- perf-wave1 http://127.0.0.1:5173/?renderer=pixi
```

Open `perf-results/runs/<buildId>/<latest>.json` and note:

- `summary.p95`, `summary.p99`
- `summary.longFrameCount33` (frames > 33ms — the "stall" metric)
- The first 5 frames where `frameMs > 16.67` — record their `tick` values

`perf-wave1` is the right replay because it covers exactly the boot → first-wave-engagement window where these stalls appear.

Save as `perf-results/runs/<buildId>/before-prewarm.json` for the final comparison.

### Phase 0 decision gate

After tests 0.1–0.5, you should have a confirmed list of contributors ranked by impact. Possible outcomes:

- **Pipeline compile dominant** → Phase 1 ships ghost-Graphics warmup only
- **Texture upload + pipeline compile** → Phase 1 ships both
- **JIT also non-trivial** → Phase 1 adds an empty-state `updateGameplayDynamicEntities` priming call
- **GC dominant** → different fix entirely (pre-allocate the particle pool to worst-case at boot — change the plan)

The Phase 0 evidence dictates which warmup paths are worth implementing.

---

## Phase 1 — Implement the prewarm

**Files:** `src/pixi-render.ts` (only)
**No changes to:** sim, art-render, types, tests outside the new prewarm test

### 1.1 — Add `prewarmGameplayScene` private method

```ts
private prewarmGameplayScene(state: GameplaySceneState): void {
  const stash = new Container();
  stash.position.set(-99999, -99999);
  this.gameplayScene.addChild(stash);

  // [a] Texture warmup — only the assets confirmed cold in Test 0.2
  const dyn = state.dynamic;
  const coldTextures: Texture[] = [
    dyn.threatAssets.stack_carrier_2.staticSprite,
    dyn.threatAssets.stack_carrier_3.staticSprite,
    dyn.threatAssets.stack_child.staticSprite,
    dyn.threatAssets.mirv.staticSprite,
    dyn.threatAssets.mirv_warhead.staticSprite,
    dyn.threatAssets.bomb.staticSprite,
    dyn.threatAssets.shahed238.staticSprite,
    dyn.interceptorAssets.f15Interceptor.staticSprite,
    dyn.interceptorAssets.playerInterceptor.staticSprite,
    dyn.upgradeProjectileAssets.wildHornet.staticSprite,
    dyn.upgradeProjectileAssets.roadrunner.staticSprite,
    dyn.upgradeProjectileAssets.patriotSam.staticSprite,
    dyn.planeAssets.f15Airframe.sprite,
  ];
  for (const tex of coldTextures) {
    stash.addChild(new Sprite(tex));
  }

  // [b] Graphics pipeline warmup — only the shapes/blends used in gameplay effects
  const g = new Graphics();
  g.circle(0, 0, 10).fill({ color: 0xffffff, alpha: 0.5 });          // explosion bloom
  g.circle(0, 0, 10).fill({ color: 0xffffff, alpha: 0.32 });         // explosion mid
  g.circle(0, 0, 3).fill({ color: 0xfff6dc, alpha: 0.72 });          // explosion core
  g.circle(0, 0, 10).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 }); // EMP ring
  g.moveTo(0, 0).lineTo(1, 1)
   .stroke({ width: 2, color: 0xffffff, alpha: 0.8, cap: "round" }); // laser, trail
  g.rect(0, 0, 2, 2).fill({ color: 0xffffff, alpha: 0.8 });          // phalanx bullet
  stash.addChild(g);

  // [c] Force one render so GPU compiles + uploads happen now
  this.app.render();

  // [d] Tear down — these objects exist purely to walk the cold paths
  stash.destroy({ children: true });
}
```

Call site: end of `buildGameplayScene`, **after** `this.gameplayState = { ... }` is assigned (so the dynamic state exists), **before** the first user-visible render.

### 1.2 — Trim based on Phase 0 evidence

If Test 0.2 showed texture upload doesn't matter, drop block `[a]`. If Test 0.3 showed pipeline compile doesn't matter, drop block `[b]`. **Don't ship code that warms paths the trace says are already free** — that's cargo-culting.

### 1.3 — JIT warmup (only if Test 0.4 said so)

If Test 0.4 showed JIT tiering matters, append to `prewarmGameplayScene`:

```ts
// [e] JIT warmup — exercise hot dynamic-update paths against an empty state
const fakeGame = createEmptyGameStateForWarmup();
for (let i = 0; i < 5; i++) {
  this.updateGameplayDynamicEntities(state.dynamic, fakeGame, 0);
}
```

Empty arrays mean each update function compiles with realistic shapes but does no work. `createEmptyGameStateForWarmup` builds a `GameState` with all entity arrays empty — no sim coupling, just enough fields to satisfy the type.

### 1.4 — Tests

Add to `src/pixi-render.test.ts`:

```ts
it("prewarms cold textures + Graphics paths during boot", async () => {
  const canvas = document.createElement("canvas");
  const renderer = new PixiRenderer(canvas);
  await renderer.readyPromise;

  // Ghost stash should be torn down — no off-screen children left around
  const stage = renderer["app"].stage;
  const offscreenChildren = stage.children.filter((c) => c.x < -9000 || c.y < -9000);
  expect(offscreenChildren).toHaveLength(0);

  renderer.destroy();
});
```

Pull the right private accessor or expose a `__testHook` getter; the goal is "ghosts cleaned up."

---

## Phase 2 — Validate the fix

### 2.1 — Re-run the Chrome trace

Repeat Test 0.1. The "first explosion" frame should now look like its neighbors. Save as `tasks/perf-traces/after-prewarm.json` and diff against the before trace. Compare:

- Total frame duration on the previously-bad frame
- `linkProgram` / `compileShader` markers — should have moved from the first-explosion frame to the boot frame
- `texImage2D` calls — same: moved to boot

### 2.2 — Re-run perf harness

```bash
npm run perf:smoke -- perf-wave1 http://127.0.0.1:5173/?renderer=pixi
```

Compare to the Phase-0 baseline:

| Metric                     | Expected change                                                            |
| -------------------------- | -------------------------------------------------------------------------- |
| `summary.p99`              | down (the stall _was_ the p99)                                             |
| `summary.p95`              | small change or no change                                                  |
| `summary.longFrameCount33` | down to 0 if the stall was the only >33ms frame                            |
| First 5 long-frame ticks   | early-game ones disappear; remaining ones are mid-wave (different problem) |

Run 3 times; take the median. Numerical proof, not vibes.

### 2.3 — Manual play test

1. `npm run dev`, open game, click through to gameplay.
2. Watch the first missile destruction — should feel as smooth as the tenth.
3. Watch the first stack2 split — same.
4. Confirm the boot itself didn't get visibly slower (the prewarm pass adds a one-shot cost we're moving from "first-effect frame" to "boot frame," which is fine because boot is hidden behind the title screen).

### 2.4 — iPhone confirmation

Even though the issue surfaced in browser, the iPhone path benefits more.

```bash
scripts/bench.sh perf-wave1
```

If the migration plan's `perf-wave1` baseline already exists under `perf-results/baselines/`, compare against that. Same `longFrameCount33` reduction should be visible — likely larger, because iPhone texture upload is more expensive.

---

## Phase 3 — Lock it in

### 3.1 — Documentation

Add a comment near `prewarmGameplayScene` explaining _why_ it exists, not what it does. Future-you will want to know which Phase 0 test motivated each block:

```ts
// Renders one off-screen frame at boot to force GPU shader compile and
// cold-texture upload before the first gameplay frame. Without this,
// Pixi v8 lazy-uploads textures and lazy-compiles WebGL pipelines on
// first use, producing a visible stall on the first explosion / first
// stack2 split. Trace evidence: tasks/perf-traces/before-prewarm.json
// (compileShader markers) → after-prewarm.json (gone).
```

### 3.2 — Commit message

```
perf: prewarm pixi gameplay scene to eliminate first-effect stalls

First explosion and first stack2-split frames stalled <N>ms in Chrome
DevTools traces, dominated by [shader linkProgram | texture upload | both].
Renders one off-screen frame at end of buildGameplayScene that touches
every cold texture and every gameplay Graphics shape, forcing the GPU
work onto the boot path where the title screen hides it.

perf-wave1 longFrameCount33: <before> → <after>
perf-wave1 p99: <before>ms → <after>ms
```

### 3.3 — Migration plan checkbox

Phase 2 of `.plans/pixi_migration_plan.md` has the gate:

> `npm run dev` shows ≥60 fps on desktop Chromium with glow always on.

The first-frame stall would have failed that gate. Mention this fix in the PR that closes Phase 5 so the gate is genuinely met, not averaged into compliance.

---

## Risk register

| Risk                                                                                                   | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prewarm shifts cost to boot. If boot becomes >1s longer, players will notice                           | Time the prewarm; if it exceeds ~50ms on desktop, narrow the warmup set                                                                                             |
| Pixi v8 evolves the Graphics pipeline; warmup shapes need to match real shapes 1:1                     | Comment in block `[b]` cross-references the call sites in `updateGameplayExplosions` etc. so they stay in sync                                                      |
| Future entity types added without updating the cold-texture list                                       | Optional dev-mode assertion: warn on first render if a sprite's texture wasn't in the warmup list. Otherwise falls back gracefully to original lazy-upload behavior |
| iPhone WebGL context loss on backgrounding (Step 11 territory) wipes the warmup                        | Re-run prewarm on `webglcontextrestored`. Step 11 is the natural home; thread a `prewarm()` call into that handler                                                  |
| Adding a Sprite for a Texture that turns out to be empty (`Texture.EMPTY` fallback path) wastes a draw | Filter `coldTextures` to `t !== Texture.EMPTY` before constructing Sprites                                                                                          |

---

## Status

- **Created by**: Claude
- **Validated by**: (pending — Phase 0 tests must run before Phase 1 implementation)
- **Consensus**: (pending)
