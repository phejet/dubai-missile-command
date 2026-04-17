# Render Toggle QA Script

## Checklist

- [x] Inspect the existing Playwright/browser-check setup and choose a stable command surface
- [x] Add a dedicated script for the in-game render-toggle verification flow
- [x] Expose the script through `package.json` for future prefix approval
- [x] Run the script against the local dev server
- [x] Document the verification result and future command to reuse

## Review

- Added `scripts/check-render-toggle.mjs` to launch Chromium, start the game from the title screen, open the in-game settings menu, and verify the render toggle cycles `Baked Sharp -> Live -> Baked Sharp`.
- Added `npm run test:render-toggle` so future runs can use a stable, reusable command prefix for escalation approval.
- Verified `npm run test:render-toggle` against `http://127.0.0.1:5173/dubai-missile-command/`; it returned `ok: true` with the expected toggle sequence.
