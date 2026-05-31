# Performance Notes

This file tracks known performance cliffs that are not worth changing until a
benchmark shows they matter. Gameplay determinism and replay stability outrank
tidying an allocation that is not yet hot.

## End-Of-Tick Entity Cleanup

`src/game-sim.ts` currently filters missiles, drones, interceptors, explosions,
particles, and planes into fresh arrays at the end of every tick. That is simple
and preserves entity order, but it allocates six arrays per tick. If entity counts
or mobile profiling show this becoming hot, replace it with a mark-and-sweep pass
using reusable buffers. The replacement must preserve iteration order, cleanup
timing, and replay hashes for fixed seeds before it is accepted; otherwise it is
just performance theatre with a desync invoice attached.
