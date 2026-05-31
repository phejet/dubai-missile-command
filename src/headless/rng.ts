import type { StatefulRNG } from "../types";

// Mulberry32 — fast, deterministic 32-bit PRNG
export function mulberry32(seed: number): StatefulRNG {
  let s = seed | 0;
  const rng = function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } as StatefulRNG;
  rng.getState = () => s | 0;
  rng.setState = (state: number) => {
    s = state | 0;
  };
  return rng;
}
