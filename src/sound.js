// Procedural sound effects via Web Audio API — no audio files needed
let ctx = null;
let master = null;
let noiseBuffer = null;
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

function scheduleRelease(dur) {
  setTimeout(releaseVoice, dur * 1000 + 50);
}

function noise(duration, filterType, filterFreq, filterQ) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || "lowpass";
  filter.frequency.value = filterFreq || 400;
  if (filterQ) filter.Q.value = filterQ;
  const gain = ctx.createGain();
  const t = now();
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t);
  src.stop(t + duration);
  return { gain, filter };
}

function osc(type, freq, duration, volume) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const gain = ctx.createGain();
  const t = now();
  gain.gain.setValueAtTime(volume || 0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(gain);
  gain.connect(master);
  o.start(t);
  o.stop(t + duration);
  return { osc: o, gain };
}

const SFX = {
  init() {
    ensureCtx();
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
    const o = ctx.createOscillator();
    o.type = "square";
    const t = now();
    o.frequency.setValueAtTime(800, t);
    o.frequency.linearRampToValueAtTime(1200, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.1);
    scheduleRelease(0.1);
  },

  explosion(size) {
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
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.freq;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(p.vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(master);
    src.start(t);
    src.stop(t + p.dur);

    // Low sine thud
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = p.sineFreq;
    const og = ctx.createGain();
    og.gain.setValueAtTime(p.vol * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
    o.connect(og);
    og.connect(master);
    o.start(t);
    o.stop(t + p.dur);

    scheduleRelease(p.dur);
  },

  gameStart() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const freqs = [400, 600, 800];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      o.connect(g);
      g.connect(master);
      o.start(start);
      o.stop(start + 0.07);
    });
    scheduleRelease(0.21);
  },

  gameOver() {
    if (!ensureCtx() || !trackVoice()) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    const t = now();
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g);
    g.connect(master);
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
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      const start = t + i * 0.08;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
      o.connect(g);
      g.connect(master);
      o.start(start);
      o.stop(start + 0.09);
    });
    scheduleRelease(0.35);
  },

  buyUpgrade() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    [500, 800].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
      o.connect(g);
      g.connect(master);
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
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 880;
      const g = ctx.createGain();
      const start = t + i * 0.09;
      g.gain.setValueAtTime(0.15, start);
      g.gain.setValueAtTime(0.001, start + 0.06);
      o.connect(g);
      g.connect(master);
      o.start(start);
      o.stop(start + 0.07);
    }
    scheduleRelease(0.25);
  },

  planePass() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 120;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(800, t + 0.5);
    lp.frequency.linearRampToValueAtTime(150, t + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.4);
    g.gain.linearRampToValueAtTime(0.15, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.connect(lp);
    lp.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 1.3);
    scheduleRelease(1.3);
  },

  phalanxBurst() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    for (let i = 0; i < 4; i++) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2000;
      const g = ctx.createGain();
      const start = t + i * 0.035;
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.025);
      src.connect(hp);
      hp.connect(g);
      g.connect(master);
      src.start(start);
      src.stop(start + 0.03);
    }
    scheduleRelease(0.15);
  },

  patriotLaunch() {
    if (!ensureCtx() || !trackVoice()) return;
    const t = now();
    // Noise + bandpass sweep
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.linearRampToValueAtTime(800, t + 0.3);
    bp.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(master);
    src.start(t);
    src.stop(t + 0.3);
    // Low sine
    osc("sine", 150, 0.3, 0.2);
    scheduleRelease(0.3);
  },

  laserBeam() {
    if (!ensureCtx() || !trackVoice()) return null;
    const t = now();
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 1200;
    const o2 = ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = 1205;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    o1.connect(g);
    o2.connect(g);
    g.connect(master);
    o1.start(t);
    o2.start(t);
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        const t2 = now();
        g.gain.setValueAtTime(g.gain.value, t2);
        g.gain.exponentialRampToValueAtTime(0.001, t2 + 0.05);
        setTimeout(() => {
          o1.stop();
          o2.stop();
          releaseVoice();
        }, 80);
      },
    };
  },

  hornetBuzz() {
    if (!ensureCtx()) return;
    // Throttle: max once per 0.5s
    const ms = performance.now();
    if (ms - lastHornetTime < 500) return;
    lastHornetTime = ms;
    if (!trackVoice()) return;
    const t = now();
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 220;
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = 223;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g);
    o2.connect(g);
    g.connect(master);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.15);
    o2.stop(t + 0.15);
    scheduleRelease(0.15);
  },
};

export default SFX;
