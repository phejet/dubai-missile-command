# iOS App via Capacitor — Implementation Plan

## Executive Summary

Wrap the existing Canvas game in Capacitor to produce a native iOS `.ipa` that runs on local iPhones and iPads. iPad uses a scaled-up iPhone view with black letterbox borders. No App Store submission in scope for v1 — just local device deployment via Xcode.

This is the right approach because:

- The game is pure 2D Canvas with Pointer API input — runs identically in WKWebView
- Zero native code required; Capacitor gives us a real Xcode project for signing/deploying
- The codebase already handles touch input, safe areas, and responsive scaling
- Total effort is configuration, not rewriting

## Current Repo Status

Phase 0 from the original migration plan is already complete for the main game runtime.

- The shipped game no longer uses React at runtime
- [`src/main.ts`](../src/main.ts) boots the app directly with `new Game()`
- [`src/game.ts`](../src/game.ts) owns the canvas, input, RAF loop, screen state, replay hooks, and shop flow
- [`src/ui.ts`](../src/ui.ts) owns DOM-driven HUD, shop, bonus, and game-over UI
- [`index.html`](../index.html) contains the static shell markup used by the game

React still exists only for the editor/dev tooling:

- [`src/EditorApp.tsx`](../src/EditorApp.tsx)
- [`src/editor-main.tsx`](../src/editor-main.tsx)
- [`editor.html`](../editor.html)

That means the next implementation step is not "remove React from the game." The next step is Capacitor bootstrap for the main game, while deciding whether the editor should remain React-based and excluded from iOS builds.

## Design Principle: Model-Friendly Codebase

Development on this project is done entirely with AI (Claude Code, Codex). The codebase should be optimized for AI comprehension and modification:

- **Flat, imperative code over framework abstractions** — `element.textContent = score` is unambiguous; React hook dependency arrays and stale closures are common sources of AI-generated bugs
- **Fewer files, fewer indirections** — models lose context jumping between component trees with props drilling. A single `ui.ts` that manages all screens is easier to hold in context than 4 React components
- **No framework lifecycle rules** — React re-render timing, hook ordering constraints, and effect cleanup semantics add cognitive overhead that burns context window tokens for zero gameplay benefit
- **Plain TypeScript everywhere** — no JSX transform, no virtual DOM diffing, no framework-specific patterns to learn. The game logic (9,470 lines) is already plain TS; the UI layer should match
- **Smaller dependency surface** — fewer deps = fewer breaking changes to debug, fewer docs to feed the model, less framework-specific knowledge required

This principle already shaped the current game runtime. The Capacitor port should preserve that runtime structure rather than reintroducing framework complexity.

---

## Phase 0: Completed Baseline

This phase is done for the main game runtime.

Completed outcomes:

- Runtime entrypoint moved to [`src/main.ts`](../src/main.ts)
- Main game controller lives in [`src/game.ts`](../src/game.ts)
- UI overlays are managed imperatively in [`src/ui.ts`](../src/ui.ts)
- Main shell markup lives in [`index.html`](../index.html)

Remaining optional cleanup, not required for iOS v1:

- Remove React from the editor tooling
- Remove `@vitejs/plugin-react` if the editor is also migrated off React
- Remove React-related test and type dependencies once the editor no longer needs them

---

## Phase 1: Capacitor Bootstrap

### 1.1 Install Capacitor

```bash
npm install @capacitor/core @capacitor/ios
npm install -D @capacitor/cli
npx cap init "Dubai Missile Command" "com.phejet.dubaicmd" --web-dir dist
```

This creates `capacitor.config.ts` at project root. The `--web-dir dist` points Capacitor at Vite's build output.

### 1.2 Configure `capacitor.config.ts`

```ts
import type { CapacitorConfig } from "@capacitor/core";

const config: CapacitorConfig = {
  appId: "com.phejet.dubaicmd",
  appName: "Dubai Missile Command",
  webDir: "dist",
  // No live-reload server — bundle everything into the app
  server: {
    // Disable external URL so the app runs fully offline
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  ios: {
    // WKWebView works great for Canvas games
    contentInset: "automatic",
    allowsLinkPreview: false,
    scrollEnabled: false,
    // Prefer full-screen (no browser chrome)
    preferredContentMode: "mobile",
  },
};

export default config;
```

### 1.3 Adjust Vite base path

The current `vite.config.ts` sets `base: "/dubai-missile-command/"` for GitHub Pages. Capacitor loads from local filesystem, so it needs a relative base.

**Strategy**: Use an environment variable to toggle.

```ts
// vite.config.ts
const isCapacitor = process.env.CAPACITOR === "1";

export default defineConfig({
  // ...
  base: isCapacitor ? "./" : "/dubai-missile-command/",
  build: {
    rollupOptions: {
      input: {
        // For Capacitor, only build the main entry point
        // (editor.html and sprites.html are dev tools, not needed in the app)
        ...(isCapacitor
          ? { main: resolve(__dirname, "index.html") }
          : {
              main: resolve(__dirname, "index.html"),
              editor: resolve(__dirname, "editor.html"),
              sprites: resolve(__dirname, "sprites.html"),
            }),
      },
    },
  },
});
```

Add npm scripts:

```json
{
  "scripts": {
    "build:ios": "CAPACITOR=1 vite build",
    "cap:sync": "npx cap sync ios",
    "cap:open": "npx cap open ios",
    "ios": "npm run build:ios && npm run cap:sync && npm run cap:open"
  }
}
```

Note: React and the Vite React plugin may still remain in `package.json` and `vite.config.ts` if `editor.html` continues to use the React-based editor. For iOS v1, that is acceptable as long as the Capacitor build only ships the main game entry.

### 1.4 Add the iOS platform

```bash
npx cap add ios
```

This creates the `ios/` directory with a real Xcode project. Commit this directory — it contains native config that you'll customize.

### 1.5 Build & sync

```bash
npm run build:ios   # Vite builds to dist/ with relative paths
npx cap sync ios    # Copies dist/ into the Xcode project + installs plugins
```

---

## Phase 2: iOS-Specific Fixes

### 2.1 Audio Context Resume on User Gesture

**Current state**: `sound.ts` already handles this correctly. `ensureCtx()` creates the AudioContext, and `resumeCtx()` resumes it. The `SFX.init()` method is called somewhere on user interaction.

**What to verify**: Make sure `SFX.init()` is called inside a user gesture handler (pointerdown/touchstart/click). WKWebView on iOS will only allow AudioContext creation/resumption inside a user gesture event handler. If the game currently calls `SFX.init()` on mount or outside a gesture, move it into the first `handleCanvasPointerDown`.

**Current code in `sound.ts:39-48`** already has the right pattern:

```ts
async function resumeCtx() {
  if (!ctx || ctx.state === "running") return true;
  try {
    await ctx.resume();
    return ctx.state === "running";
  } catch {
    // iPhone/Safari may reject until the next user gesture; we retry on later interactions.
    return false;
  }
}
```

The comment even mentions iPhone/Safari — this was already considered. Just verify `SFX.init()` is called from within a pointer event handler, not from a `useEffect`.

### 2.2 Safe Area Insets

**Current state**: Already handled well.

- `index.html` has `viewport-fit=cover`
- `App.css:33-34` already uses `env(safe-area-inset-*)`:
  ```css
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(18px, calc(env(safe-area-inset-bottom) + 18px)) max(16px, env(safe-area-inset-left));
  ```

**What to verify**: The canvas itself should not be clipped by the notch or Dynamic Island. Since the game renders into a `<canvas>` inside `.battlefield-stage` which is inside `.game-shell__content` (which has the safe area padding), this should be fine. Test on a notched device simulator to confirm.

### 2.3 Disable Bounce/Overscroll

**Current state**: `index.css` already sets `overscroll-behavior: none` on `body`, and the canvas has `touch-action: none`. This should prevent rubber-banding in WKWebView.

**Additional hardening** (add to `capacitor.config.ts`):

```ts
ios: {
  scrollEnabled: false,
}
```

Also add to `index.css` for belt-and-suspenders:

```css
html,
body {
  position: fixed;
  overflow: hidden;
  width: 100%;
  height: 100%;
}
```

This repo already has `overflow: hidden` on `body` and full-height root containers. The extra `position: fixed` hardening is still worth testing on device, but it is a validation step rather than a guaranteed required change.

### 2.4 Status Bar

For an immersive game, hide the status bar. In the Xcode project:

**`ios/App/App/Info.plist`** — add:

```xml
<key>UIStatusBarHidden</key>
<true/>
<key>UIViewControllerBasedStatusBarAppearance</key>
<false/>
```

Alternatively, use Capacitor's StatusBar plugin:

```bash
npm install @capacitor/status-bar
```

```ts
import { StatusBar, Style } from "@capacitor/status-bar";
StatusBar.hide();
```

I'd recommend the `Info.plist` approach — simpler, no plugin dependency, and the game doesn't need dynamic status bar control.

### 2.5 Screen Orientation Lock

Lock to portrait since the game's 900x1600 canvas is designed for portrait.

**`ios/App/App/Info.plist`**:

```xml
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
</array>
<key>UISupportedInterfaceOrientations~ipad</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
  <string>UIInterfaceOrientationPortraitUpsideDown</string>
</array>
```

### 2.6 Disable Text Selection / Callouts in WKWebView

The CSS already has `user-select: none` and `-webkit-user-select: none` on the canvas. Add a global rule to prevent the iOS magnifier and callout menus:

```css
/* Prevent iOS long-press callouts and text selection globally */
* {
  -webkit-touch-callout: none;
}
```

---

## Phase 3: iPad Letterboxing

The requirement is: iPad shows the iPhone view scaled up with black borders.

### 3.1 Approach

Don't provide iPad-specific layouts or storyboards. By default, if you don't provide an iPad-specific launch storyboard and set `UIRequiresFullScreen` appropriately, iPadOS will render the app in an iPhone compatibility mode with black borders.

However, modern Capacitor creates a universal app by default. To get the letterbox behavior:

**Option A — Force iPhone-only target (simplest)**:

In Xcode, set the target's "Targeted Device Families" to iPhone only (`1`). When this runs on iPad, iPadOS automatically renders it at iPhone scale with black borders and a 2x button. This is exactly what was requested.

To do this in `ios/App/App.xcodeproj/project.pbxproj`, set:

```
TARGETED_DEVICE_FAMILY = 1;
```

Or just change it in Xcode: Target > General > Deployment Info > set devices to "iPhone".

**Option B — Universal target with max-width constraint**:

Keep universal target but constrain the web content to iPhone proportions with CSS max-width and center it. This gives more control but is more work for no real benefit at this stage.

**Recommendation**: Option A. It's one checkbox in Xcode, gives exactly the behavior requested, and you can switch to universal later if you want native iPad layouts.

---

## Phase 4: App Icon & Launch Screen

### 4.1 App Icon

Capacitor uses an Xcode asset catalog at `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.

Generate a 1024x1024 PNG icon (the single required size for modern iOS). Xcode will generate all device sizes automatically.

**Quick approach**: Screenshot the title screen from the game, crop to square, or create a simple icon using the Burj Khalifa silhouette from the game's render code. Drop the 1024x1024 PNG into the asset catalog.

### 4.2 Launch Screen

Default Capacitor provides a white `LaunchScreen.storyboard`. Replace with a simple dark background matching the game's sky color (`#04070f`) so there's no white flash.

Edit `ios/App/App/LaunchScreen.storyboard` — change the view's background color to match the game. This is a one-line edit in the storyboard XML (or do it visually in Xcode).

---

## Phase 5: Build & Deploy to Device

### 5.1 Prerequisites

- macOS with Xcode 15+ installed
- Apple Developer account (free works for local deployment)
- iPhone/iPad connected via USB or on same Wi-Fi (for wireless deploy)

### 5.2 Build Flow

```bash
# 1. Build the web app with Capacitor-friendly base path
npm run build:ios

# 2. Sync web assets + native plugins into the Xcode project
npx cap sync ios

# 3. Open Xcode
npx cap open ios
```

### 5.3 Xcode Configuration

1. **Signing**: Select your team under Signing & Capabilities. With a free Apple ID, you can deploy to your own devices (apps expire after 7 days, re-deploy to refresh).
2. **Bundle ID**: `com.phejet.dubaicmd` (set during `cap init`)
3. **Device**: Select your connected iPhone/iPad
4. **Build**: Cmd+R to build and run

### 5.4 Troubleshooting

| Issue                     | Fix                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| White screen on launch    | Check `webDir` in `capacitor.config.ts` matches Vite's output dir (`dist`)                                                           |
| No audio                  | Ensure `SFX.init()` is inside a user gesture handler                                                                                 |
| Rubber-banding            | Add `scrollEnabled: false` in Capacitor config + CSS `position: fixed` on html/body                                                  |
| Slow performance          | The FPS probe in `game-render.ts` should auto-disable glow. Test on real device, not Simulator (Simulator is much slower for Canvas) |
| Canvas not filling screen | Verify `base: "./"` is set for Capacitor builds                                                                                      |

---

## Phase 6: Git & CI Hygiene

### 6.1 `.gitignore` additions

```gitignore
# Capacitor iOS build artifacts
ios/App/Pods/
ios/App/App/public/
ios/App/output/

# Xcode
*.xcworkspace/xcuserdata/
*.xcodeproj/xcuserdata/
DerivedData/
```

Keep `ios/App/App.xcodeproj/` and `ios/App/App/` in version control — they contain your project config, Info.plist customizations, and launch storyboard.

### 6.2 CI

The existing GitHub Actions workflows (lint, test, build, e2e) don't need changes — they run the web build. Optionally add a `ci-ios.yml` that runs `npm run build:ios && npx cap sync ios` on a macOS runner to catch web build regressions that affect the iOS bundle.

---

## File Changes Summary

### Current Repo Reality

| File                  | Status  | Notes                                                    |
| --------------------- | ------- | -------------------------------------------------------- |
| `src/main.ts`         | Present | Main runtime entrypoint                                  |
| `src/game.ts`         | Present | Canvas owner, input, game loop, screen state             |
| `src/ui.ts`           | Present | Imperative DOM UI layer                                  |
| `index.html`          | Present | Static shell markup for the game                         |
| `src/App.css`         | Present | Shared runtime styling, including safe-area-aware layout |
| `src/ShopUI.css`      | Present | Shop modal styling used by `ui.ts`                       |
| `src/EditorApp.tsx`   | Present | React-based editor tooling only                          |
| `src/editor-main.tsx` | Present | React editor entrypoint only                             |
| `vite.config.ts`      | Present | Still uses React plugin because of the editor            |

### Planned Changes For Capacitor

| File                                  | Action      | What                                                                  |
| ------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `package.json`                        | Edit        | Add Capacitor dependencies and iOS helper scripts                     |
| `capacitor.config.ts`                 | Create      | Capacitor configuration                                               |
| `vite.config.ts`                      | Edit        | Conditional `base` path and Capacitor-specific single-entry build     |
| `src/index.css`                       | Verify/Edit | Confirm or add iOS overscroll hardening and touch-callout suppression |
| `index.html`                          | Verify      | Keep viewport and Apple web-app meta tags                             |
| `src/sound.ts`                        | Verify      | Confirm gesture-based audio init                                      |
| `src/game.ts`                         | Verify      | Confirm startup/input path still resumes audio on first interaction   |
| `ios/`                                | Generate    | `npx cap add ios` creates the Xcode project                           |
| `ios/App/App/Info.plist`              | Edit        | Status bar hidden, portrait lock, iPhone-only device family           |
| `ios/App/App/LaunchScreen.storyboard` | Edit        | Dark background color                                                 |
| `ios/App/App/Assets.xcassets/`        | Edit        | App icon                                                              |
| `.gitignore`                          | Edit        | Add iOS build artifacts                                               |

### Optional Follow-Up Cleanup

| File/Area             | Action   | What                                                          |
| --------------------- | -------- | ------------------------------------------------------------- |
| `src/EditorApp.tsx`   | Optional | Migrate editor off React if full framework removal is desired |
| `src/editor-main.tsx` | Optional | Remove React bootstrap after editor migration                 |
| `package.json`        | Optional | Remove React-related deps after editor migration              |
| `vite.config.ts`      | Optional | Remove React plugin after editor migration                    |
| `README.md`           | Edit     | Update stack description to reflect vanilla game runtime      |

---

## Estimated Effort

- **Phase 0** (Completed baseline): Already done for the game runtime
- **Phase 1** (Capacitor bootstrap): Mechanical setup — install, configure, verify build works
- **Phase 2** (iOS fixes): Mostly verification — the codebase already handles most concerns
- **Phase 3** (iPad): One setting in Xcode
- **Phase 4** (Icon/launch): Asset creation
- **Phase 5** (Deploy): Requires macOS + Xcode, mostly following Xcode's signing flow

The heavy lifting was already done in the web game. The port is configuration, not code.

---

## What This Plan Does NOT Cover (Future Considerations)

- **App Store submission**: Requires paid Apple Developer Program ($99/yr), app review compliance, privacy policy, screenshots
- **Haptic feedback**: Could use Capacitor's Haptics plugin for explosions/hits — nice-to-have
- **Native share**: Share high scores via Capacitor's Share plugin
- **Push notifications**: Not relevant for a single-player arcade game
- **Game Center**: Leaderboards — would require `@capacitor/game-center` or a custom plugin
- **IAP**: Not in scope
- **Offline caching**: Already fully offline (no API calls in gameplay), so no work needed
- **Android**: Capacitor supports Android too — same `capacitor.config.ts`, run `npx cap add android` when ready
