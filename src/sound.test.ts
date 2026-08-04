// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudioParam {
  value = 0;
  setValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

class FakeAudioNode {
  gain = new FakeAudioParam();
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  type = "";
  buffer: unknown = null;
  curve: unknown = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

const SAMPLE_RATE = 64;

class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = "suspended";
  sampleRate = SAMPLE_RATE;
  destination = new FakeAudioNode();
  /** Simulates WebKit handing back a "running" context whose renderer never restarts. */
  clockFrozen = false;
  oscillators = 0;
  resume = vi.fn(async () => {
    this.setState("running");
  });
  close = vi.fn(async () => {
    this.setState("closed");
  });

  private frozenAt = 0;

  constructor() {
    super();
    FakeAudioContext.instances.push(this);
  }

  get currentTime() {
    if (this.state !== "running" || this.clockFrozen) return this.frozenAt;
    return performance.now() / 1000;
  }

  setState(state: AudioContextState) {
    if (this.state === state) return;
    if (state !== "running") this.frozenAt = performance.now() / 1000;
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }

  createGain() {
    return new FakeAudioNode();
  }
  createBiquadFilter() {
    return new FakeAudioNode();
  }
  createBufferSource() {
    return new FakeAudioNode();
  }
  createWaveShaper() {
    return new FakeAudioNode();
  }
  createOscillator() {
    this.oscillators++;
    return new FakeAudioNode();
  }
  createMediaElementSource() {
    return new FakeAudioNode();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(SAMPLE_RATE) };
  }
}

async function loadSfx() {
  vi.resetModules();
  const module = await import("./sound");
  const sfx = module.default;
  await sfx.init();
  return sfx;
}

function liveContext() {
  return FakeAudioContext.instances[FakeAudioContext.instances.length - 1];
}

/** Locking the iPhone puts the audio session into WebKit's "interrupted" state. */
function interrupt(ctx: FakeAudioContext) {
  ctx.resume.mockClear();
  ctx.state = "interrupted";
}

async function foreground() {
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1000);
}

describe("sound lifecycle after backgrounding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resumes an interrupted context when the app returns to the foreground", async () => {
    const sfx = await loadSfx();
    const ctx = liveContext();
    interrupt(ctx);

    await foreground();

    expect(ctx.resume).toHaveBeenCalled();
    expect(sfx.getResourceStats().contextState).toBe("running");
  });

  it("plays effects on a running context again after an interruption", async () => {
    const sfx = await loadSfx();
    const ctx = liveContext();
    interrupt(ctx);
    await foreground();

    ctx.oscillators = 0;
    sfx.explosion("large");

    expect(ctx.state).toBe("running");
    expect(ctx.oscillators).toBeGreaterThan(0);
  });

  it("frees the voice budget when the release timers are lost while backgrounded", async () => {
    const sfx = await loadSfx();
    const ctx = liveContext();
    // Voices are only released by setTimeout; a suspended WebView can drop those, which
    // would otherwise pin activeCount at MAX_POLY and mute every later effect.
    for (let i = 0; i < 20; i++) sfx.fire();
    expect(sfx.getResourceStats().activeVoices).toBeGreaterThan(0);

    interrupt(ctx);
    vi.clearAllTimers();
    await foreground();

    expect(sfx.getResourceStats().activeVoices).toBe(0);
    ctx.oscillators = 0;
    sfx.fire();
    expect(ctx.oscillators).toBeGreaterThan(0);
  });

  it("replaces a context that reports running but never renders", async () => {
    const sfx = await loadSfx();
    const wedged = liveContext();
    wedged.clockFrozen = true;

    await foreground();

    expect(wedged.close).toHaveBeenCalled();
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(sfx.getResourceStats().contextGeneration).toBe(2);
    expect(liveContext().state).toBe("running");
  });

  it("keeps effects working on the replacement context", async () => {
    const sfx = await loadSfx();
    const wedged = liveContext();
    wedged.clockFrozen = true;
    await foreground();

    const fresh = liveContext();
    expect(fresh).not.toBe(wedged);
    fresh.oscillators = 0;
    sfx.explosion("small");

    expect(fresh.oscillators).toBeGreaterThan(0);
  });

  it("retries on the next user gesture when resume is rejected in the background", async () => {
    const sfx = await loadSfx();
    const ctx = liveContext();
    interrupt(ctx);
    ctx.resume.mockRejectedValueOnce(new Error("not allowed"));

    await foreground();
    expect(sfx.getResourceStats().gestureResumeArmed).toBe(true);

    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(sfx.getResourceStats().contextState).toBe("running");
    expect(sfx.getResourceStats().gestureResumeArmed).toBe(false);
  });

  it("self-heals when a sound is triggered without any lifecycle event", async () => {
    const sfx = await loadSfx();
    const ctx = liveContext();
    interrupt(ctx);

    sfx.explosion("medium");
    await vi.advanceTimersByTimeAsync(1000);

    expect(ctx.resume).toHaveBeenCalled();
    expect(sfx.getResourceStats().contextState).toBe("running");
  });
});
