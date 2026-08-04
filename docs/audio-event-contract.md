# Audio Event Contract

Audio is driven by a small semantic event bridge rather than by letting the sim call sound code directly.

Relevant files:

- `src/game.ts`
- `src/sound.ts`
- `src/ui.ts`

## Event Bridge

The sim can emit `onEvent(type, data)`.

The runtime controller handles these event types:

- `sfx`
- `gameOver`
- `waveBonusStart`
- `shopOpen`

Only `sfx` is directly about audio, but the other events also trigger audio indirectly through screen/UI flow.

## Supported `sfx` Names

`handleSimEvent()` currently maps these `data.name` values to `SFX` methods:

- `explosion`
- `chainExplosion`
- `mirvIncoming`
- `mirvSplit`
- `planeIncoming`
- `planePass`
- `hornetBuzz`
- `hornetFizzle`
- `patriotLaunch`
- `laserBeam`
- `waveCleared`
- `gameOver`
- `burjHit`
- `launcherDestroyed`
- `empBlast`
- `multiKill`

Some names require extra payload fields:

- `explosion.size`
- `chainExplosion.size`
- `chainExplosion.chainLevel`
- `hornetFizzle.fate` (`fuelOut` or `standDown`)

## Direct Runtime Audio Calls

Not all sound calls come from sim events.

The controller calls audio directly for:

- title theme start/stop in `setScreen()`
- `gameStart()`
- `fire()`
- `emptyClick()`
- `buyUpgrade()`
- mute toggling
- direct EMP fire from the player

The bonus screen in `ui.ts` also calls:

- `bonusTick()`
- `bonusTotal()`

## Laser Special Case

`laserBeam` is not a one-shot effect.

The runtime stores a browser-side handle on:

- `game._browserLaserHandle`

This prevents re-spawning the beam loop every frame and lets the runtime stop it once the laser is no longer active.

## Title Theme Lifecycle

Title music is controlled by screen transitions:

- entering `"title"` -> `playTitleTheme()`
- leaving `"title"` -> `stopTitleTheme()`

The render layer does not control title music.

## Sound System Notes

`src/sound.ts` is a procedural Web Audio system plus one streamed title-theme MP3.

Important behaviors:

- `init()` creates/resumes the audio context
- `prewarm()` silently primes many SFX paths to reduce first-play latency
- polyphony is capped
- explosions and some warnings are throttled
- mute affects both procedural audio and title-theme gain

## Backgrounding And Audio-Session Recovery

Locking the iPhone (or backgrounding the app / switching tabs) interrupts the audio
session. WebKit leaves the `AudioContext` in `suspended`/`interrupted`, so gameplay
keeps rendering while every effect plays into a silent graph. `src/sound.ts` recovers
through three independent paths, because none of them is reliable on its own:

- **Lifecycle events** — `visibilitychange`, `pageshow`, and `focus` trigger recovery.
- **Self-heal on use** — `ensureCtx()` kicks a throttled recovery whenever a sound is
  requested on a context that is not `running`, so audio comes back even if no
  lifecycle event fires.
- **Gesture retry** — when `resume()` is rejected (iOS requires a gesture), one-shot
  `pointerdown`/`touchend`/`keydown` listeners retry on the next interaction.

Recovery does three things:

1. Resets the voice budget (`activeCount`) and transient nodes. A suspended WebView can
   drop the pending `scheduleRelease` timers, which would otherwise pin `activeCount` at
   `MAX_POLY` and mute every later effect even after the context is healthy.
2. Resumes the context, then probes that `currentTime` actually advances.
3. Rebuilds the context (new graph, master gain, noise buffer, title-theme element) when
   the probe fails — WebKit can hand back a context that reports `running` but never
   renders again. The title-theme `<audio>` element is recreated too, since an element
   can only ever back one `MediaElementAudioSourceNode`.

`getResourceStats()` reports `contextState`, `contextGeneration` (rebuild count), and
`gestureResumeArmed` so diagnostics snapshots show why audio is silent.

## Practical Rules

- If the sim needs a new sound, add a semantic `sfx` name instead of importing `sound.ts` into sim code.
- If an event needs parameters, document the expected payload shape near both emitter and handler.
- If you add a looping sound, copy the laser-beam pattern and make shutdown explicit.
