# Dubai Missile Command — iOS iPhone Migration Plan

> Prepared by: Studio Technical Art Lead, Senior Graphics Programmer, 2D Artist
> Target: iPhone (iOS 16+), landscape orientation
> Current state: PC/laptop canvas game at fixed 900x640, mouse-only input

---

## Executive Summary

The game runs on a fixed 900x640 canvas with mouse input, 12px HUD fonts, and pixel-sized sprites. On an iPhone screen everything is unplayably small — the crosshair, HUD text, missiles, and shop UI all need to scale up significantly. Touch replaces mouse entirely, which means redesigning the control scheme from scratch. This plan covers the full migration in five phases.

---

## Phase 1: Resolution & Scaling System

**Problem:** The 900x640 canvas maps poorly to iPhone screens (logical sizes 375x667 through 430x932 in portrait, flipped in landscape). On a 3x Retina display the canvas is drawn at CSS pixels, not device pixels, causing blur.

### 1.1 Virtual Canvas + Device Pixel Ratio

Replace the fixed canvas with a resolution-independent rendering pipeline:

```
Design resolution:  900 x 640 (keep as virtual coordinate space)
Render resolution:  900*dpr x 640*dpr (crisp on Retina)
CSS size:           fitted to viewport with letterboxing
```

**Changes required:**

| File | What to change |
|------|---------------|
| `src/App.jsx` | Canvas creation — set `canvas.width = CANVAS_W * dpr`, `canvas.height = CANVAS_H * dpr`, then `ctx.scale(dpr, dpr)`. CSS size stays at logical pixels. |
| `src/App.jsx` | Add `useLayoutEffect` that measures `window.innerWidth/Height` and fits the 900x640 rect with uniform scale + letterbox bars. Listen to `resize` and `orientationchange`. |
| `src/game-logic.js` | No changes — all game math stays in 900x640 virtual space. |
| `src/game-sim.js` | No changes — simulation is resolution-independent already. |

**Scaling fit algorithm:**
```js
const scaleX = viewportW / CANVAS_W;
const scaleY = viewportH / CANVAS_H;
const scale  = Math.min(scaleX, scaleY);
// CSS: canvas.style.width  = CANVAS_W * scale + 'px'
//      canvas.style.height = CANVAS_H * scale + 'px'
```

**Safe area handling:**
- Read CSS `env(safe-area-inset-*)` via `getComputedStyle` on a probe div.
- Subtract safe-area insets from available viewport before computing scale.
- On notch/Dynamic Island devices this prevents the HUD from being occluded.

**Estimated scope:** ~80 lines changed in App.jsx, new `src/scaling.js` utility (~40 lines).

---

## Phase 2: Touch Input System

**Problem:** The game uses `onClick`, `onMouseMove`, and `keydown` — none of which work well on touch. There is no hover state on mobile. The crosshair must follow the finger, and tapping must fire. EMP (spacebar) needs a dedicated button.

### 2.1 Touch Event Handlers

Replace mouse events with a unified pointer system:

| Current (mouse) | Mobile replacement |
|------------------|--------------------|
| `onMouseMove` → crosshair tracking | `onTouchMove` → crosshair follows finger |
| `onClick` → fire interceptor | `onTouchEnd` → fire at last touch position |
| `keydown(space)` → EMP | On-screen EMP button (bottom-right) |
| `keydown(any)` → fire at crosshair | Remove — touch-to-fire replaces this |
| Drag-and-drop replay | Remove on mobile — use file picker button instead |

**Implementation in `src/App.jsx`:**

```js
// Add to canvas element:
onTouchStart={handleTouchStart}
onTouchMove={handleTouchMove}
onTouchEnd={handleTouchEnd}

// Touch handlers scale coordinates same as mouse:
function handleTouchMove(e) {
  e.preventDefault();              // prevent scroll
  const touch = e.touches[0];
  const rect = canvasRef.current.getBoundingClientRect();
  game.crosshairX = (touch.clientX - rect.left) * (CANVAS_W / rect.width);
  game.crosshairY = (touch.clientY - rect.top)  * (CANVAS_H / rect.height);
}
```

Key behaviors:
- **Touch-and-drag:** Finger down → crosshair appears and tracks → finger up → fire.
- **Quick tap:** Interpreted as fire-at-point (touchstart position used if no movement).
- **Multi-touch:** Second finger tap triggers EMP (alternative to on-screen button).
- **`touch-action: none`** on canvas CSS to prevent browser gestures.

### 2.2 Crosshair Redesign

The current crosshair (18px outer, 12px inner circle + cross lines) is fine for mouse but problematic for touch because the finger occludes it.

**Solution:** Offset crosshair — render the targeting reticle 60px above the touch point so it's always visible above the finger. Add a thin line from touch point to reticle so the player knows where they're aiming.

```
Crosshair offset:     60px above touch Y
Reticle outer radius: 24px (up from 18px)
Reticle inner radius: 16px (up from 12px)
Connecting line:      1px dashed, 50% alpha
```

### 2.3 On-Screen Controls Overlay

New React component `src/MobileControls.jsx`:

| Control | Position | Size | Action |
|---------|----------|------|--------|
| EMP button | Bottom-right, 20px from edge | 56x56px touch target | Fire EMP shockwave |
| Pause button | Top-right, inside safe area | 44x44px | Pause game |
| Ammo indicators | Bottom-center | 3 circular gauges, 40px each | Visual only (replaces HUD text) |

All buttons must meet Apple's 44pt minimum touch target guideline.

**Estimated scope:** New `src/MobileControls.jsx` (~120 lines), ~60 lines changed in App.jsx touch handling.

---

## Phase 3: HUD & UI Scaling

**Problem:** Every text element is too small. The 12px HUD is ~3mm tall on an iPhone — unreadable at arm's length. The shop UI (React component) has small buttons and text. Game-over stats are cramped.

### 3.1 HUD Overhaul

All HUD rendering lives in `drawHUD()` inside `src/App.jsx`. Scale factors:

| Element | Current size | Mobile size | Notes |
|---------|-------------|-------------|-------|
| HUD bar height | 36px | 52px | More vertical space for fat fingers |
| HUD font | bold 12px | bold 18px | ~50% larger |
| Score/wave/ammo text | y=23 | y=34 | Centered in taller bar |
| Wave progress bar | 120x8px at (650,14) | 140x12px at (640,20) | Wider + taller |
| Active upgrade icons | ~12px | ~20px | Larger with spacing |
| FPS counter | 10px | 12px | Subtle increase |
| Warning text (MIRV) | bold 14px | bold 22px | Must be visible |
| LOW AMMO text | bold 28px | bold 36px | Already large, bump further |
| Multi-kill toast | bold 22px | bold 28px | |
| Wave cleared | bold 22px | bold 28px | |

**Implementation approach:** Introduce a `UI_SCALE` multiplier (default 1.0 on desktop, 1.5 on mobile) and multiply all font sizes and HUD positions by it. This keeps desktop unchanged.

```js
// src/game-logic.js
export const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
export const UI_SCALE  = IS_MOBILE ? 1.5 : 1.0;
```

### 3.2 Shop UI Redesign

The shop (`ShopUI.jsx` or inline in App.jsx) needs major touch-friendly changes:

- **Card size:** Minimum 80px tall per upgrade card (current is ~50px)
- **Touch targets:** 44pt minimum on buy buttons
- **Layout:** Single-column scrollable list instead of grid (iPhone width is limited even in landscape)
- **Font sizes:** Item names 16px → 20px, descriptions 12px → 16px, prices 14px → 18px
- **Between-wave timing:** Extend shop display from 2s to 4s on mobile (more time to read and tap)

### 3.3 Title Screen & Game Over

| Screen | Current | Mobile |
|--------|---------|--------|
| Title "DUBAI" | 48px font | 48px (already large enough) |
| Subtitle "MISSILE COMMAND" | 36px font | 36px (fine) |
| "Click to start" | 14px | 20px, change to "Tap to start" |
| Game over title | 48px | 48px |
| Stats text | 20px | 24px |
| Retry/Share buttons | HTML buttons | 56px tall, full-width touch targets |

**Estimated scope:** ~150 lines changed across App.jsx draw functions, ~80 lines in shop component.

---

## Phase 4: Sprite & Visual Element Scaling

**Problem:** Game objects are drawn with hardcoded pixel sizes tuned for a desktop monitor viewed at 60cm. On a 6.1" iPhone held at 30cm, sprites need to be physically larger to remain playable.

### 4.1 Sprite Scale Matrix

Introduce `SPRITE_SCALE` (1.0 desktop, 1.3 mobile) applied to all drawable entities:

| Entity | Current size | Mobile size (x1.3) | Drawing location |
|--------|-------------|---------------------|-----------------|
| Regular missile body | 8px long, 2.5px half-h | 10.4px, 3.25px | `drawMissile()` in App.jsx |
| MIRV body | 14px long, 4.5px half-h | 18.2px, 5.85px | `drawMissile()` |
| MIRV warhead | 7px, 2px half-h | 9.1px, 2.6px | `drawMissile()` |
| Missile trail | 1.5-2.5px radius | 2-3.25px | `drawMissile()` |
| Interceptor | 3px radius | 4px | `drawInterceptor()` |
| Shahed-238 drone | 16px fuselage | 20.8px | `drawDrone()` |
| Shahed-136 drone | 12px long | 15.6px | `drawDrone()` |
| Bomb | 2.5px radius | 3.25px | draw function |
| Wild Hornet | 5px long, 3.5px wings | 6.5px, 4.55px | `drawHornet()` |
| Roadrunner | 10px cone | 13px | `drawRoadrunner()` |
| Patriot missile | 6px body | 7.8px | `drawPatriot()` |
| Phalanx turret | 12px base | 15.6px | `drawPhalanx()` |
| Launcher barrel | 12px wide, 8px tall | 15.6px, 10.4px | `drawLaunchers()` |
| Explosions | radius unchanged | radius unchanged | Physics-driven, already correct |
| Particles | 1-3px | 1.5-4px | `drawParticles()` |

**Implementation:** Each draw function wraps its local coordinates with `* SPRITE_SCALE`. Since game physics (collision, blast radii, speeds) remain in virtual 900x640 space, only the visual representation scales — no gameplay changes.

```js
// Example in drawMissile():
const S = SPRITE_SCALE;
ctx.moveTo(-8*S,  0);        // was -8, 0
ctx.lineTo( 0,   -2.5*S);    // was 0, -2.5
ctx.lineTo( 4*S,  0);        // was 4, 0
// ...
```

### 4.2 Burj Khalifa

The Burj drawing uses `BURJ_SHAPE` (a tapered width profile). Scale the widths by `SPRITE_SCALE`:

```js
// Current BURJ_SHAPE half-widths: [3, 7, 11, 13, 15]
// Mobile (x1.3):                  [4, 9, 14, 17, 20]
```

This makes the Burj slightly chunkier on mobile — appropriate for the smaller screen.

### 4.3 Buildings & Defense Sites

The cityscape buildings (`BUILDINGS_LEFT`, `BUILDINGS_RIGHT`) use hardcoded `[x, width, height, windowCols]`. Scale width and height by `SPRITE_SCALE`, keep x positions in virtual space.

### 4.4 Glow & Shadow Effects

Mobile GPUs handle `shadowBlur` poorly. The existing FPS probe (disable glow if <45 FPS) will likely trigger on older iPhones. Additionally:

- Cap `shadowBlur` at 15px on mobile (currently goes up to 40px)
- Reduce particle pool from 500 → 300 on mobile
- Consider replacing canvas `shadowBlur` with pre-rendered glow sprites for hot paths (explosions, interceptors)

**Estimated scope:** ~200 lines changed across all draw functions in App.jsx.

---

## Phase 5: Platform Integration & Deployment

### 5.1 Packaging: Capacitor (Recommended)

Use [Capacitor](https://capacitorjs.com/) to wrap the Vite-built web app in a native iOS shell:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Dubai Missile Command" com.studio.dubaimissilecommand
npx cap add ios
```

**Why Capacitor over alternatives:**
- Vite build output (`dist/`) drops directly into Capacitor
- Full WKWebView (hardware-accelerated canvas)
- Access to native APIs (haptics, audio session, status bar)
- No code rewrite — same JS/React codebase
- Hot reload during development via `npx cap run ios --livereload`

### 5.2 Capacitor Configuration

`capacitor.config.ts`:
```ts
const config: CapacitorConfig = {
  appId: 'com.studio.dubaimissilecommand',
  appName: 'Dubai Missile Command',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    allowsLinkPreview: false,
    scrollEnabled: false,
  },
  plugins: {
    StatusBar: { style: 'dark', overlaysWebView: true },
    ScreenOrientation: { defaultOrientation: 'landscape' },
  }
};
```

### 5.3 iOS-Specific Integrations

| Feature | Plugin / API | Purpose |
|---------|-------------|---------|
| Haptic feedback | `@capacitor/haptics` | Vibrate on fire, explosion, Burj hit |
| Lock landscape | `@capacitor/screen-orientation` | Force landscape-right/left |
| Keep awake | `@capacitor/keep-awake` | Prevent screen sleep during gameplay |
| Audio session | Native config (Info.plist) | Mix with silent mode, proper audio focus |
| Status bar | `@capacitor/status-bar` | Hide during gameplay |
| Safe area | CSS `env()` + Capacitor viewport-fit | Handle notch/Dynamic Island |

### 5.4 Performance Budget

Target: **Consistent 60 FPS on iPhone 12 and newer, 30+ FPS on iPhone SE 3rd gen.**

| Metric | Budget |
|--------|--------|
| Draw calls per frame | <200 |
| Particle pool | 300 (mobile) / 500 (desktop) |
| Shadow blur usage | Capped at 15px or disabled |
| Canvas resolution | 2x DPR max (cap 3x devices at 2x) |
| JS heap | <50MB |
| Bundle size | <500KB gzipped |

### 5.5 Viewport & Meta Tags

Add to `index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0,
  maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

### 5.6 Audio on iOS

iOS Safari / WKWebView requires a user gesture to unlock audio. The game already has a "click/tap to start" gate — ensure `AudioContext.resume()` is called inside that handler.

---

## Implementation Order & Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
Scaling      Touch       HUD/UI      Sprites     Packaging
(foundation) (playable)  (readable)  (polished)  (shippable)
   │                                                 │
   └── can test in mobile Safari throughout ─────────┘
```

**Phase 1** must land first — without proper scaling, nothing else can be tested on device. **Phase 2** makes it playable. **Phases 3-4** are parallelizable by the graphics programmer (Phase 4 sprites) and 2D artist (Phase 3 UI). **Phase 5** can start in parallel after Phase 1.

---

## Files Changed Summary

| File | Phases | Type of changes |
|------|--------|----------------|
| `src/App.jsx` | 1,2,3,4 | Canvas sizing, touch events, HUD scaling, sprite scaling |
| `src/game-logic.js` | 1,3,4 | `IS_MOBILE`, `UI_SCALE`, `SPRITE_SCALE` constants |
| `src/scaling.js` (new) | 1 | Viewport fitting, DPR handling, safe area utility |
| `src/MobileControls.jsx` (new) | 2 | EMP button, pause button, ammo gauges |
| `src/ShopUI.jsx` or shop code | 3 | Touch-friendly card layout, larger fonts |
| `index.html` | 5 | Viewport meta, apple-mobile-web-app tags |
| `capacitor.config.ts` (new) | 5 | Capacitor iOS configuration |
| `package.json` | 5 | Capacitor dependencies |

**Total estimated lines changed/added:** ~700-900 lines

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Canvas `shadowBlur` tanks FPS on A15 | High | Medium | FPS probe already exists; cap blur on mobile |
| Touch-drag feels laggy at 60Hz | Medium | High | Use `requestAnimationFrame` for crosshair, not touch event rate |
| Finger occludes targets | High | High | Offset crosshair design (Phase 2.2) |
| WKWebView audio quirks | Medium | Medium | Unlock AudioContext on first tap; test on real device early |
| Safe area math wrong on new devices | Low | Medium | Use CSS `env()` not hardcoded insets |
| Shop too cramped in landscape | Medium | Medium | Scrollable single-column with larger cards |

---

## Testing Strategy

1. **Phase 1-2:** Test in Chrome DevTools mobile emulation + real iPhone via Safari remote inspector
2. **Phase 3-4:** Visual QA on iPhone SE (smallest screen) and iPhone 15 Pro Max (largest)
3. **Phase 5:** TestFlight builds, test on physical devices across iOS 16/17/18
4. **Automated:** Adapt `play-bot.mjs` to inject touch events; headless sim unchanged (no rendering)

---

## What We Are NOT Changing

- **Game physics, speeds, blast radii, spawn rates** — all stay identical. The game plays the same.
- **Simulation code (`game-sim.js`)** — untouched. Mobile is a rendering/input concern only.
- **Replay system** — replays remain deterministic; mobile just renders them differently.
- **Headless simulation** — no rendering, no mobile concerns.
- **Desktop experience** — all changes gated behind `IS_MOBILE`; desktop is unchanged.
