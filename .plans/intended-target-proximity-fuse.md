# Plan: Intended-Target Proximity Fuse

## Design intent

Player-fired interceptors currently detonate at the tapped point, with a
near-tap proximity fuse that only checks live threats while the interceptor is
still close to that original tap. That works for stationary-ish targets and
clusters. It fails the most infuriating case: the player taps a fast target,
does not lead enough, the interceptor visibly passes through or beside the
intended threat, and then detonates behind it like it has chosen slapstick as a
guidance doctrine.

Goal: preserve manual aiming and blast placement, but give the fuse enough
knowledge of player intent to detonate when the interceptor gets close to a
threat that was plausibly under the tap at fire time.

The assist is fuse-only. Do not retarget interceptor guidance, bend its path,
or snap the blast to the threat.

## Implementation

### 1. Extend interceptor state

- Add optional `intendedTargets?: Threat[]` to `Interceptor` in `src/types.ts`.
- Keep `fireInterceptor(g, targetX, targetY, tick)` signature unchanged.
- Store transient object references only; replay actions remain `{ tick, type:
"fire", x, y }` and recompute intended targets deterministically during replay.
- Export one shared radius constant, `INTERCEPTOR_TAP_FUSE_RADIUS = 72`, from
  `src/game-logic.ts` and use it for:
  - intended-target collection at fire time,
  - tagged-target in-flight fuse checks,
  - the existing near-tap proximity fuse radius in `src/game-sim.ts`.

Do not leave duplicate local `72` literals. These values are one feel knob, not
three unrelated offerings to the tuning gods.

### 2. Mark intended targets at fire time

- In `src/game-logic.ts`, add a small helper used by `fireInterceptor`.
- The helper collects all live missiles and drones within
  `INTERCEPTOR_TAP_FUSE_RADIUS` of the tap point.
- Use threat center distance for missiles.
- Use `distance <= INTERCEPTOR_TAP_FUSE_RADIUS + collisionRadius` for drones so
  larger drone bodies are treated like the target the player visibly tapped.
- Attach the resulting array to the newly pushed player interceptor only when
  non-empty.

### 3. Add tagged-target fuse logic

- In `src/game-sim.ts`, keep existing tap-point detonation:
  `didPlayerInterceptorReachTarget`.
- Keep existing near-tap proximity fuse as fallback behavior.
- Add a tagged-target fuse path before the fallback proximity fuse:
  - Applies only to non-F-15 interceptors.
  - Iterates `ic.intendedTargets ?? []`.
  - Skips dead threats and threats already doomed by an active explosion.
  - Uses segment distance from previous interceptor position to current
    interceptor position, so high-speed ticks cannot tunnel through the target.
  - Missile threshold: `INTERCEPTOR_TAP_FUSE_RADIUS`.
  - Drone threshold: `INTERCEPTOR_TAP_FUSE_RADIUS + collisionRadius`.
  - Detonates at the interceptor position.

Feel-check polish item: segment-distance detection can find a closest approach
mid-segment while detonating at the segment end. If this looks visually late at
high speed, detonate at the closest point on the interceptor segment for tagged
fuse triggers only. Start with interceptor-position detonation unless playtest
shows the blast still feels downrange.

### 4. Cleanup rules

- No special cleanup is required for normal gameplay because interceptors are
  removed after detonation and dead threat references are skipped.
- Do not serialize or log intended target IDs in replay data.
- Do not make MIRV children inherit intended-target status after a split; only
  threats present inside the tap area at fire time are eligible.

## Tests

Add focused unit coverage in `src/game-sim.test.ts`:

- Under-led fast-target case: a threat starts inside the tap area, moves away
  from the original tap, and the interceptor detonates when its segment passes
  close to that tagged threat.
- Untagged pass-by case: a threat outside the original
  `INTERCEPTOR_TAP_FUSE_RADIUS` tap area does not gain the longer fuse merely
  because it is near the interceptor path.
- Lead-error-too-large case: a threat outside the tap radius remains untagged
  even if later path geometry would be convenient, pinning the assist boundary
  against accidental auto-aim creep.
- Multiple intended targets: more than one threat inside the tap area is
  eligible, but a target already doomed by an active explosion is ignored.
- Doomed tagged target case: a tagged threat already inside an active explosion
  radius does not trigger the tagged fuse, protecting same-threat double-spend
  behavior.
- Existing same-tick blast de-duplication behavior still holds.

Run:

```bash
npx vitest run src/game-sim.test.ts src/game-logic.test.ts
npx playwright test e2e/smoke.spec.ts
```

## Acceptance criteria

- A visibly under-led shot against a fast intended target no longer looks like it
  ghosts through the target before exploding behind it.
- Nearby unrelated threats do not become global auto-aim bait unless they were
  also inside the original tap area.
- Replay action shape remains unchanged.
- Existing interceptor, F-15, and explosion-chain behavior remains intact.
