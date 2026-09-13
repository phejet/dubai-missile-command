---
name: staging-release
description: Release Dubai Missile Command Staging through TestFlight without a cable. Use for Staging deployment, release status, and interrupted release recovery; not for direct developer installs or Production.
---

# Staging release

Use the maintained command; do not reconstruct its Apple, GitHub, Xcode, or tester-group
steps through individual tool calls. It runs in this shared checkout, which must be clean
and equal to `origin/main`; it never creates a worktree or temporary checkout. It fetches,
runs `npm ci` in place (restart a running dev server afterwards), saves verbose output to
disk, deploys Staging, uploads, waits, and verifies internal-group assignment.
If the checkout is dirty or not at `origin/main`, stop and ask the user, then do what they
decide; don't work around the guard yourself.

```bash
npm run ios:release:staging
```

Run with normal network/signing permissions. Keep the command alive through completion.
Its success output is the handoff: build, source, ready status, and log/recovery locations.
The user only taps Update in TestFlight. Do not replace their TestFlight app with a direct install.

For a status request or interruption:

```bash
npm run ios:release:staging -- --status
npm run ios:release:staging -- --resume
```

Read the small JSON status, not the build log, on the successful path. Poll the running
tool at a reasonable interval; avoid repeated API/CLI checks the script already performs.
Report concise stage updates and finish with the build number and Update instruction.
Read the named log only on failure. Do not blindly retry an ambiguous upload, clear a
live lock, or edit the recovery record without establishing which external step completed.

## Testing budget

Routine deployment does not trigger extra local unit, browser, bot, typecheck, or native
signing experiments. The protected deployment already checks types and Worker behavior;
the script verifies archive identity, compliance, source, deployment, processing and group.
For code changes, run only relevant maintained checks before normal CI. Reuse passing
evidence for unchanged code. Full browser CI took 6.2 minutes in the initial rollout;
that is not a reason to rerun it locally for a status badge or a release-only change.
Physical gameplay, privacy-link, and feedback observations remain distinct from upload success.

Only if credentials or recovery require intervention, read
[the release runbook](../../../docs/staging-testflight-release.md).
Use `--check` for credential setup/troubleshooting, not before every release: the command
already preflights. Never print the private key or API token. Staging authorization does
not authorize Production, policy weakening, or publishing unrelated working changes.
