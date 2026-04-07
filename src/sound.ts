// Procedural sound effects via Web Audio API — no audio files needed

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let _muted = false;
let activeCount = 0;
const MAX_POLY = 16;

// Throttle state
let lastExplosionTime = 0;
let explosionCount = 0;
let lastWarningTime = 0;
let lastHornetTime = 0;

function ensureCtx() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // Pre-generate 1s white noise buffer
    const sr = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, sr, sr);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < sr; i++) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    return false;
  }
}

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

function now() {
  return ctx ? ctx.currentTime : 0;
}

function trackVoice() {
  if (activeCount >= MAX_POLY) return false;
  activeCount++;
  return true;
}

function releaseVoice() {
  activeCount = Math.max(0, activeCount - 1);
}

function scheduleRelease(dur: number) {
  setTimeout(releaseVoice, dur * 1000 + 50);
}

// Non-null accessors — only called after ensureCtx() has confirmed ctx/master are set
function getCtx(): AudioContext {
  return ctx!;
}
function getMaster(): GainNode {
  return master!;
}

function noise(duration: number, filterType: BiquadFilterType, filterFreq: number, filterQ?: number) {
  const src = getCtx().createBufferSource();
  src.buffer = noiseBuffer;
  const filter = getCtx().createBiquadFilter();
  filter.type = filterType || "lowpass";
  filter.frequency.value = filterFreq || 400;
  if (filterQ) filter.Q.value = filterQ;
  const gain = getCtx().createGain();
  const t = now();
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(getMaster());
  src.start(t);
  src.stop(t + duration);
  return { gain, filter };
}

function osc(type: OscillatorType, freq: number, duration: number, volume: number) {
  const o = getCtx().createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const gain = getCtx().createGain();
  const t = now();
  gain.gain.setValueAtTime(volume || 0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(gain);
  gain.connect(getMaster());
  o.start(t);
  o.stop(t + duration);
  return { osc: o, gain };
}

const SFX = {
  async init() {
    if (!ensureCtx()) return false;
    return resumeCtx();
  },

  mute() {
    _muted = !_muted;
    if (master) master.gain.value = _muted ? 0 : 1;
  },

  isMuted() {
    return _muted;
  },

  fire() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Ignition pop — short noise burst
    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const bp = getCtx().createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200;
    bp.Q.value = 2;
    const ng = getCtx().createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(getMaster());
    src.start(t);
    src.stop(t + 0.07);
    // Rising whoosh — noise through sweeping bandpass
    const src2 = getCtx().createBufferSource();
    src2.buffer = noiseBuffer;
    const bp2 = getCtx().createBiquadFilter();
    bp2.type = "bandpass";
    bp2.frequency.setValueAtTime(600, t + 0.03);
    bp2.frequency.linearRampToValueAtTime(3000, t + 0.25);
    bp2.Q.value = 1.5;
    const ng2 = getCtx().createGain();
    ng2.gain.setValueAtTime(0.001, t);
    ng2.gain.linearRampToValueAtTime(0.22, t + 0.06);
    ng2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src2.connect(bp2);
    bp2.connect(ng2);
    ng2.connect(getMaster());
    src2.start(t);
    src2.stop(t + 0.25);
    // Low thud from motor ignition
    const o = getCtx().createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.15);
    const og = getCtx().createGain();
    og.gain.setValueAtTime(0.18, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(og);
    og.connect(getMaster());
    o.start(t);
    o.stop(t + 0.15);
    scheduleRelease(0.25);
  },

  emptyClick() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Short dry click — highpass noise snap
    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const hp = getCtx().createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(hp);
    hp.connect(g);
    g.connect(getMaster());
    src.start(t);
    src.stop(t + 0.04);
    scheduleRelease(0.04);
  },

  explosion(size: "small" | "medium" | "large") {
    if (!ensureCtx()) return;
    // Throttle: max 3 per 100ms
    const ms = performance.now();
    if (ms - lastExplosionTime < 100) {
      explosionCount++;
      if (explosionCount > 3) return;
    } else {
      lastExplosionTime = ms;
      explosionCount = 1;
    }
    if (!trackVoice()) return;

    const params = {
      small: { dur: 0.15, vol: 0.15, freq: 400, sineFreq: 70 },
      medium: { dur: 0.25, vol: 0.25, freq: 500, sineFreq: 60 },
      large: { dur: 0.4, vol: 0.35, freq: 600, sineFreq: 50 },
    };
    const p = params[size] || params.medium;
    const t = now();

    // Noise burst through lowpass
    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const lp = getCtx().createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.freq;
    const ng = getCtx().createGain();
    ng.gain.setValueAtTime(p.vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(getMaster());
    src.start(t);
    src.stop(t + p.dur);

    // Low sine thud
    const o = getCtx().createOscillator();
    o.type = "sine";
    o.frequency.value = p.sineFreq;
    const og = getCtx().createGain();
    og.gain.setValueAtTime(p.vol * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    o.connect(og);
    og.connect(getMaster());
    o.start(t);
    o.stop(t + p.dur);

    scheduleRelease(p.dur);
  },

  chainExplosion(size: "small" | "medium" | "large", chainLevel = 1) {
    if (!ensureCtx()) return;
    const ms = performance.now();
    if (ms - lastExplosionTime < 80) {
      explosionCount++;
      if (explosionCount > 4) return;
    } else {
      lastExplosionTime = ms;
      explosionCount = 1;
    }
    if (!trackVoice()) return;

    const level = Math.max(1, Math.min(4, chainLevel));
    const params = {
      small: { dur: 0.12, vol: 0.07, freq: 2200, tailFreq: 780 },
      medium: { dur: 0.14, vol: 0.085, freq: 2000, tailFreq: 700 },
      large: { dur: 0.16, vol: 0.1, freq: 1800, tailFreq: 620 },
    };
    const p = params[size] || params.medium;
    const t = now();

    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const bp = getCtx().createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(p.freq + level * 140, t);
    bp.Q.value = 2.2 + level * 0.35;
    const ng = getCtx().createGain();
    ng.gain.setValueAtTime(p.vol * (1 + level * 0.08), t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(getMaster());
    src.start(t);
    src.stop(t + p.dur);

    const sting = getCtx().createOscillator();
    sting.type = "triangle";
    const stingStart = t + 0.015;
    sting.frequency.setValueAtTime(p.tailFreq + level * 70, stingStart);
    sting.frequency.exponentialRampToValueAtTime(p.tailFreq * 0.7 + level * 30, stingStart + 0.09);
    const sg = getCtx().createGain();
    sg.gain.setValueAtTime(0.001, stingStart);
    sg.gain.linearRampToValueAtTime(0.03 + level * 0.008, stingStart + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.001, stingStart + 0.09);
    sting.connect(sg);
    sg.connect(getMaster());
    sting.start(stingStart);
    sting.stop(stingStart + 0.09);

    scheduleRelease(p.dur);
  },

  gameStart() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const freqs = [400, 600, 800];
    freqs.forEach((f, i) => {
      const o = getCtx().createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = getCtx().createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      o.connect(g);
      g.connect(getMaster());
      o.start(start);
      o.stop(start + 0.07);
    });
    scheduleRelease(0.21);
  },

  gameOver() {
    if (!ensureCtx() || !trackVoice()) return;
    const o = getCtx().createOscillator();
    o.type = "sine";
    const t = now();
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.8);
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g);
    g.connect(getMaster());
    o.start(t);
    o.stop(t + 0.8);
    scheduleRelease(0.8);
  },

  waveCleared() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // C5-E5-G5-C6 arpeggio
    const freqs = [523, 659, 784, 1047];
    freqs.forEach((f, i) => {
      const o = getCtx().createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = getCtx().createGain();
      const start = t + i * 0.08;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      o.connect(g);
      g.connect(getMaster());
      o.start(start);
      o.stop(start + 0.09);
    });
    scheduleRelease(0.35);
  },

  buyUpgrade() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    [500, 800].forEach((f, i) => {
      const o = getCtx().createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = getCtx().createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
      o.connect(g);
      g.connect(getMaster());
      o.start(start);
      o.stop(start + 0.08);
    });
    scheduleRelease(0.15);
  },

  burjHit() {
    if (!ensureCtx() || !trackVoice()) return;
    // Noise burst + bandpass 200Hz
    noise(0.2, "bandpass", 200, 5);
    // Low sine thud
    osc("sine", 100, 0.2, 0.3);
    scheduleRelease(0.2);
  },

  launcherDestroyed() {
    if (!ensureCtx() || !trackVoice()) return;
    // Large explosion sound
    noise(0.3, "lowpass", 500);
    // Extra low sine
    osc("sine", 50, 0.3, 0.35);
    osc("sine", 80, 0.25, 0.2);
    scheduleRelease(0.3);
  },

  warning() {
    if (!ensureCtx()) return;
    // Throttle: max once per 3s
    const ms = performance.now();
    if (ms - lastWarningTime < 3000) return;
    lastWarningTime = ms;
    if (!trackVoice()) return;
    const t = now();
    // Square 880Hz on-off-on
    for (let i = 0; i < 3; i++) {
      const o = getCtx().createOscillator();
      o.type = "square";
      o.frequency.value = 880;
      const g = getCtx().createGain();
      const start = t + i * 0.09;
      g.gain.setValueAtTime(0.15, start);
      g.gain.setValueAtTime(0.001, start + 0.06);
      o.connect(g);
      g.connect(getMaster());
      o.start(start);
      o.stop(start + 0.07);
    }
    scheduleRelease(0.25);
  },

  mirvIncoming() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Deep rumbling descent
    const o = getCtx().createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(200, t);
    o.frequency.linearRampToValueAtTime(80, t + 1.0);
    const lp = getCtx().createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.3);
    g.gain.linearRampToValueAtTime(0.08, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(lp);
    lp.connect(g);
    g.connect(getMaster());
    o.start(t);
    o.stop(t + 1.0);
    scheduleRelease(1.0);
  },

  mirvSplit() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Deep crack + metallic burst
    const o = getCtx().createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const g1 = getCtx().createGain();
    g1.gain.setValueAtTime(0.15, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g1);
    g1.connect(getMaster());
    o.start(t);
    o.stop(t + 0.3);
    // Metallic burst
    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const bp = getCtx().createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2000;
    bp.Q.value = 3;
    const g2 = getCtx().createGain();
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(bp);
    bp.connect(g2);
    g2.connect(getMaster());
    src.start(t);
    src.stop(t + 0.4);
    scheduleRelease(0.4);
  },

  planeIncoming() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Distant jet engine spool-up
    const o = getCtx().createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(60, t);
    o.frequency.linearRampToValueAtTime(110, t + 1.5);
    const lp = getCtx().createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(150, t);
    lp.frequency.linearRampToValueAtTime(400, t + 1.5);
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(lp);
    lp.connect(g);
    g.connect(getMaster());
    o.start(t);
    o.stop(t + 1.5);
    scheduleRelease(1.5);
  },

  planePass() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const o = getCtx().createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 120;
    const lp = getCtx().createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(800, t + 0.5);
    lp.frequency.linearRampToValueAtTime(150, t + 1.3);
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.4);
    g.gain.linearRampToValueAtTime(0.15, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(lp);
    lp.connect(g);
    g.connect(getMaster());
    o.start(t);
    o.stop(t + 1.3);
    scheduleRelease(1.3);
  },

  phalanxBurst() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    for (let i = 0; i < 4; i++) {
      const src = getCtx().createBufferSource();
      src.buffer = noiseBuffer;
      const hp = getCtx().createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2000;
      const g = getCtx().createGain();
      const start = t + i * 0.035;
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.025);
      src.connect(hp);
      hp.connect(g);
      g.connect(getMaster());
      src.start(start);
      src.stop(start + 0.03);
    }
    scheduleRelease(0.15);
  },

  patriotLaunch() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Noise + bandpass sweep
    const src = getCtx().createBufferSource();
    src.buffer = noiseBuffer;
    const bp = getCtx().createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.linearRampToValueAtTime(800, t + 0.3);
    bp.Q.value = 3;
    const ng = getCtx().createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(getMaster());
    src.start(t);
    src.stop(t + 0.3);
    // Low sine
    osc("sine", 150, 0.3, 0.2);
    scheduleRelease(0.3);
  },

  laserBeam() {
    if (!ensureCtx() || !trackVoice()) return null;
    const t = now();
    // Star Wars style — sharp descending "pew" with buzzy harmonics
    // Main tone: sharp sine pitch drop
    const o1 = getCtx().createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(1800, t);
    o1.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    o1.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    // Buzzy harmonic layer
    const o2 = getCtx().createOscillator();
    o2.type = "square";
    o2.frequency.setValueAtTime(900, t);
    o2.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    o2.frequency.exponentialRampToValueAtTime(100, t + 0.4);
    // Envelope
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.setValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    // Slight distortion via waveshaper for that crunchy edge
    const ws = getCtx().createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128 - 1) * 1.5;
      curve[i] = Math.tanh(x);
    }
    ws.curve = curve;
    o1.connect(ws);
    o2.connect(g);
    ws.connect(g);
    g.connect(getMaster());
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.4);
    o2.stop(t + 0.4);
    let stopped = false;
    scheduleRelease(0.4);
    return {
      stop() {
        if (stopped) return;
        stopped = true;
      },
    };
  },

  multiKill() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Rising power chord — two detuned sines + bright shimmer
    const o1 = getCtx().createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(400, t);
    o1.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    const o2 = getCtx().createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(600, t);
    o2.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o1.connect(g);
    o2.connect(g);
    g.connect(getMaster());
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.3);
    o2.stop(t + 0.3);
    // High shimmer
    const o3 = getCtx().createOscillator();
    o3.type = "triangle";
    o3.frequency.value = 1600;
    const g2 = getCtx().createGain();
    g2.gain.setValueAtTime(0.1, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o3.connect(g2);
    g2.connect(getMaster());
    o3.start(t + 0.05);
    o3.stop(t + 0.25);
    scheduleRelease(0.3);
  },

  empBlast() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Charge release chirp
    const o1 = getCtx().createOscillator();
    o1.type = "sine";
    o1.frequency.setValueAtTime(200, t);
    o1.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
    o1.frequency.exponentialRampToValueAtTime(80, t + 0.5);
    const g1 = getCtx().createGain();
    g1.gain.setValueAtTime(0.25, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o1.connect(g1);
    g1.connect(getMaster());
    o1.start(t);
    o1.stop(t + 0.5);
    // Buzzy electric crackle
    const o2 = getCtx().createOscillator();
    o2.type = "sawtooth";
    o2.frequency.setValueAtTime(600, t);
    o2.frequency.exponentialRampToValueAtTime(100, t + 0.4);
    const g2 = getCtx().createGain();
    g2.gain.setValueAtTime(0.12, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o2.connect(g2);
    g2.connect(getMaster());
    o2.start(t);
    o2.stop(t + 0.4);
    // Low thump
    osc("sine", 60, 0.3, 0.3);
    scheduleRelease(0.5);
  },

  hornetBuzz() {
    if (!ensureCtx()) return;
    // Throttle: max once per 0.5s
    const ms = performance.now();
    if (ms - lastHornetTime < 500) return;
    lastHornetTime = ms;
    if (!trackVoice()) return;
    const t = now();
    const o1 = getCtx().createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 220;
    const o2 = getCtx().createOscillator();
    o2.type = "square";
    o2.frequency.value = 223;
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g);
    o2.connect(g);
    g.connect(getMaster());
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.15);
    o2.stop(t + 0.15);
    scheduleRelease(0.15);
  },

  // Short electronic blip for bonus screen counting ticks
  bonusTick() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const o = getCtx().createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.04);
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g);
    g.connect(getMaster());
    o.start(t);
    o.stop(t + 0.04);
    scheduleRelease(0.04);
  },

  // Fanfare sting for bonus total reveal
  bonusTotal() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const freqs = [523, 659, 784, 1047]; // C5 E5 G5 C6
    freqs.forEach((freq, i) => {
      const o = getCtx().createOscillator();
      o.type = "square";
      o.frequency.value = freq;
      const g = getCtx().createGain();
      const onset = t + i * 0.07;
      g.gain.setValueAtTime(0, onset);
      g.gain.linearRampToValueAtTime(0.1, onset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, onset + 0.25);
      o.connect(g);
      g.connect(getMaster());
      o.start(onset);
      o.stop(onset + 0.25);
    });
    scheduleRelease(0.6);
  },
};

export default SFX;
