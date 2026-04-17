# Build Targets

This repo ships more than one browser target and one native wrapper.

Relevant files:

- `vite.config.ts`
- `vite-replay-plugin.ts`
- `src/main.ts`
- `src/editor-main.tsx`
- `package.json`
- `.github/workflows/*`

## Vite Targets

### Default web build

Non-Capacitor builds include:

- `index.html` -> main game
- `editor.html` -> internal editor
- `sprites.html` -> sprite/art helper page

The base path is:

- `/dubai-missile-command/`

That matches GitHub Pages deployment.

### Capacitor build

When `CAPACITOR=1`:

- Vite base becomes `./`
- only `index.html` is included as a build input

This keeps the native wrapper using relative asset paths and avoids shipping the extra editor pages into the iOS app bundle.

## Runtime Entrypoints

- `src/main.ts` boots the game
- `src/editor-main.tsx` boots the editor

The React plugin stays enabled because the editor needs it, even though the main game runtime is vanilla TypeScript.

## Replay Save Dev Endpoint

`vite-replay-plugin.ts` adds `/api/save-replay` to the Vite dev server only.

Behavior:

- computes a build id from git SHA plus diff hash
- saves replay JSON under `replays/`
- injects `_buildId` and `_savedAt`
- prunes older replay files

Important limitation:

- this endpoint does not exist in `vite preview`, GitHub Pages, or Capacitor builds

## NPM Scripts

Core scripts from `package.json`:

- `npm run dev`
- `npm run build`
- `npm run build:ios`
- `npm run preview`
- `npm run test`
- `npm run test:coverage`
- `npm run test:e2e`
- `npm run typecheck`
- `npm run ios` -> build, sync, open

## CI And Deploy

### Unit / coverage CI

- runs `npm run test:coverage`
- posts a coverage summary artifact/comment

### E2E CI

- installs Playwright Chromium
- runs `npm run test:e2e`
- Playwright uses `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`

### Deploy

- GitHub Pages deploys `dist/` on pushes to `main`

## Practical Rules

- If you add a new HTML entrypoint, decide whether it belongs in web builds only or also in Capacitor.
- If you rely on `/api/save-replay`, use `npm run dev`, not preview.
- If E2E depends on dev-only middleware, it will fail in CI because Playwright uses preview, not the dev server.
