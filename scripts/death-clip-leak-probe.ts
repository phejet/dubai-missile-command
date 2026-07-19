/**
 * Death-clip memory leak probe.
 *
 * Mounts the real run-recap death clip (via Vite dev-server module import) in
 * Chromium, loops it N times, and samples per loop:
 *  - live WebGL resource counts + byte estimates (instrumented GL context)
 *  - live 2d-canvas allocations grouped by creation stack
 *  - JS heap (CDP Performance.getMetrics)
 *  - DOM node / event listener counts
 *
 * A healthy build plateaus after the first loop or two (lazy texture uploads);
 * sustained per-loop growth in canvases or texture bytes is a leak. This is
 * the harness that located the 2026-07 sky-asset rebuild leak (see
 * docs/webcontent-leak-instrumented-findings-2026-07-12.md).
 *
 * Usage:
 *   npm run dev                                        # in another terminal
 *   npx tsx scripts/death-clip-leak-probe.ts [loops]   # default 5 loops
 *
 * Env: GAME_URL to point at a non-default dev server;
 *      PW_EXECUTABLE_PATH to pin the browser binary;
 *      PROBE_BROWSER=webkit to use WebKit instead of Chromium;
 *      PROBE_RECORDED_SEED to generate a current full-run replay (default 114);
 *      PROBE_REPLAY_FILE to use a replay with an explicit finalTick instead;
 *      PROBE_FORCE_GC=0 to observe natural collector/allocator high-water behavior.
 */
import { chromium, webkit } from "@playwright/test";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { runGame } from "../src/headless/sim-runner";
import { createReplayRunner } from "../src/replay";
import type { ReplayData } from "../src/types";

const BASE = process.env.GAME_URL ?? "http://localhost:5173/dubai-missile-command/";
const LOOPS = parseInt(process.argv[2] ?? "5", 10);
const REPO = resolve(import.meta.dirname, "..");
const FORCE_GC = process.env.PROBE_FORCE_GC !== "0";
const BROWSER_ENGINE = process.env.PROBE_BROWSER === "webkit" ? "webkit" : "chromium";

interface GlStats {
  buffers: number;
  textures: number;
  framebuffers: number;
  renderbuffers: number;
  programs: number;
  shaders: number;
  vaos: number;
  queries: number;
  bufferBytes: number;
  textureBytes: number;
  bufferDataCalls: number;
  texImageCalls: number;
  contexts: number;
}

interface AllocationStackInfo {
  count: number;
  bytes: number;
  dims: Record<string, number>;
}

type AllocationStacks = Record<string, AllocationStackInfo>;

interface ProbePixiRenderer {
  constructor: { name: string };
  type?: number | string;
  gl?: unknown;
  context?: { gl?: unknown };
  gpu?: { device?: unknown };
}

interface ProbeWindow extends Window {
  __probeCleanup?: () => void;
  __glStats: () => GlStats;
  __liveTextures: () => AllocationStacks;
  __liveCanvases: () => AllocationStacks;
  __pixiApp?: { renderer?: ProbePixiRenderer };
}

interface BrowserProcessRow {
  pid: number;
  rssKB: number;
  command: string;
}

interface BrowserProcessMemory {
  rssMB: number;
  processes: BrowserProcessRow[];
}

interface ProbeResult {
  label: string;
  heapUsedMB: number;
  heapTotalMB: number;
  nodes: number;
  listeners: number;
  documents: number;
  renderer: {
    clipStatus: string | null;
    clipTick: string | null;
    pixiContext: string | null;
    pixiGameplayStatic: string | null;
    rendererName: string | null;
    rendererType: number | string | null;
    hasGl: boolean;
    hasGpuDevice: boolean;
  };
  osMemory: BrowserProcessMemory;
  liveTextures: AllocationStacks;
  liveCanvases: AllocationStacks;
}

type FullProbeResult = ProbeResult & GlStats;

function browserProcessMemory(): BrowserProcessMemory {
  try {
    const rows = execFileSync("/bin/ps", ["-axo", "pid=,rss=,command="], { encoding: "utf8" })
      .split("\n")
      .filter((line) =>
        BROWSER_ENGINE === "webkit"
          ? line.includes("ms-playwright/webkit-")
          : line.includes("ms-playwright/chromium-") || line.includes("chromium_headless_shell-"),
      )
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), rssKB: Number(match[2]), command: match[3] };
      })
      .filter((row): row is BrowserProcessRow => row !== null);
    return {
      rssMB: +(rows.reduce((sum, row) => sum + row.rssKB, 0) / 1024).toFixed(1),
      processes: rows,
    };
  } catch {
    return { rssMB: 0, processes: [] };
  }
}

const GL_WRAP = `
(() => {
  const stats = {
    buffers: 0, textures: 0, framebuffers: 0, renderbuffers: 0,
    programs: 0, shaders: 0, vaos: 0, queries: 0,
    bufferBytes: 0, textureBytes: 0,
    bufferDataCalls: 0, texImageCalls: 0,
    contexts: 0,
  };
  window.__glStats = () => JSON.parse(JSON.stringify(stats));
  const bufBytes = new WeakMap();
  const texBytes = new WeakMap();
  // live texture registry keyed by creation stack
  const texInfo = new Map();
  let texSeq = 0;
  const texIdOf = new WeakMap();
  window.__liveTextures = () => {
    const byStack = {};
    for (const info of texInfo.values()) {
      const b = (byStack[info.stack] = byStack[info.stack] || { count: 0, bytes: 0, dims: {} });
      b.count++;
      b.bytes += info.bytes;
      const d = info.w + "x" + info.h;
      b.dims[d] = (b.dims[d] || 0) + 1;
    }
    return byStack;
  };
  function shortStack() {
    return (new Error().stack || "")
      .split(String.fromCharCode(10))
      .slice(2, 9)
      .map((l) => l.replace(/^\\s*at\\s+/, "").replace(/https?:\\/\\/[^/ ]+/g, "").replace(/\\?[^:) ]*/g, ""))
      .join(" < ");
  }

  function wrap(gl) {
    stats.contexts++;
    const orig = {};
    for (const name of [
      "createBuffer","deleteBuffer","bufferData",
      "createTexture","deleteTexture","texImage2D","texStorage2D","compressedTexImage2D",
      "createFramebuffer","deleteFramebuffer","createRenderbuffer","deleteRenderbuffer",
      "createProgram","deleteProgram","createShader","deleteShader",
      "createVertexArray","deleteVertexArray","createQuery","deleteQuery",
      "getBufferParameter","getParameter","getTexParameter",
    ]) {
      if (typeof gl[name] === "function") orig[name] = gl[name].bind(gl);
    }
    gl.createBuffer = function() { stats.buffers++; return orig.createBuffer(); };
    gl.deleteBuffer = function(b) { if (b) { stats.buffers--; const sz = bufBytes.get(b) ?? 0; stats.bufferBytes -= sz; bufBytes.delete(b); } return orig.deleteBuffer(b); };
    gl.bufferData = function(target, data, usage, ...rest) {
      stats.bufferDataCalls++;
      const size = typeof data === "number" ? data : (data?.byteLength ?? 0);
      // attribute the size to the currently bound buffer on this target
      const binding = target === gl.ELEMENT_ARRAY_BUFFER ? gl.ELEMENT_ARRAY_BUFFER_BINDING
        : target === gl.ARRAY_BUFFER ? gl.ARRAY_BUFFER_BINDING
        : target === 0x8892 ? 0x8894 : null;
      try {
        const bound = binding ? orig.getParameter(binding) : null;
        if (bound) {
          const prev = bufBytes.get(bound) ?? 0;
          stats.bufferBytes += size - prev;
          bufBytes.set(bound, size);
        } else {
          stats.bufferBytes += size;
        }
      } catch { stats.bufferBytes += size; }
      return orig.bufferData(target, data, usage, ...rest);
    };
    gl.createTexture = function() {
      stats.textures++;
      const t = orig.createTexture();
      const id = ++texSeq;
      texIdOf.set(t, id);
      texInfo.set(id, { stack: shortStack(), bytes: 0, w: 0, h: 0 });
      return t;
    };
    gl.deleteTexture = function(t) {
      if (t) {
        stats.textures--;
        const sz = texBytes.get(t) ?? 0;
        stats.textureBytes -= sz;
        texBytes.delete(t);
        const id = texIdOf.get(t);
        if (id) texInfo.delete(id);
      }
      return orig.deleteTexture(t);
    };
    function noteTex(target, w, h, bpp) {
      stats.texImageCalls++;
      try {
        const bindingEnum = target === gl.TEXTURE_2D || target === 0x0DE1 ? gl.TEXTURE_BINDING_2D : gl.TEXTURE_BINDING_2D;
        const bound = orig.getParameter(bindingEnum);
        if (bound && w && h) {
          const size = w * h * bpp;
          const prev = texBytes.get(bound) ?? 0;
          if (size > prev) { stats.textureBytes += size - prev; texBytes.set(bound, size); }
          const id = texIdOf.get(bound);
          const info = id ? texInfo.get(id) : null;
          if (info && size > info.bytes) { info.bytes = size; info.w = w; info.h = h; }
        }
      } catch {}
    }
    gl.texImage2D = function(...args) {
      // (target, level, internalformat, width, height, border, format, type, pixels) long form
      // (target, level, internalformat, format, type, source) short form
      if (args.length >= 6 && typeof args[3] === "number" && typeof args[4] === "number") {
        noteTex(args[0], args[3], args[4], 4);
      } else {
        const src = args[args.length - 1];
        noteTex(args[0], src?.width ?? 0, src?.height ?? 0, 4);
      }
      return orig.texImage2D(...args);
    };
    if (orig.texStorage2D) gl.texStorage2D = function(target, levels, ifmt, w, h) {
      noteTex(target, w, h, 4);
      return orig.texStorage2D(target, levels, ifmt, w, h);
    };
    gl.createFramebuffer = function() { stats.framebuffers++; return orig.createFramebuffer(); };
    gl.deleteFramebuffer = function(f) { if (f) stats.framebuffers--; return orig.deleteFramebuffer(f); };
    gl.createRenderbuffer = function() { stats.renderbuffers++; return orig.createRenderbuffer(); };
    gl.deleteRenderbuffer = function(r) { if (r) stats.renderbuffers--; return orig.deleteRenderbuffer(r); };
    gl.createProgram = function() { stats.programs++; return orig.createProgram(); };
    gl.deleteProgram = function(p) { if (p) stats.programs--; return orig.deleteProgram(p); };
    gl.createShader = function(t) { stats.shaders++; return orig.createShader(t); };
    gl.deleteShader = function(s) { if (s) stats.shaders--; return orig.deleteShader(s); };
    if (orig.createVertexArray) {
      gl.createVertexArray = function() { stats.vaos++; return orig.createVertexArray(); };
      gl.deleteVertexArray = function(v) { if (v) stats.vaos--; return orig.deleteVertexArray(v); };
    }
    return gl;
  }

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const ctx = getContext.call(this, type, ...args);
    if (ctx && (type === "webgl" || type === "webgl2") && !ctx.__wrapped) {
      ctx.__wrapped = true;
      wrap(ctx);
    }
    return ctx;
  };

  // Track 2d canvas allocations (prebake sprites) with creation stacks.
  const canvasReg = new Map();
  let canvasSeq = 0;
  const fr = new FinalizationRegistry((id) => canvasReg.delete(id));
  function trackCanvas(canvas, kind) {
    const id = ++canvasSeq;
    canvasReg.set(id, { stack: shortStack(), kind, ref: new WeakRef(canvas) });
    fr.register(canvas, id);
  }
  window.__liveCanvases = () => {
    const byStack = {};
    for (const info of canvasReg.values()) {
      const c = info.ref.deref();
      if (!c) continue;
      const b = (byStack[info.stack] = byStack[info.stack] || { count: 0, bytes: 0, dims: {} });
      b.count++;
      b.bytes += (c.width || 0) * (c.height || 0) * 4;
      const d = c.width + "x" + c.height;
      b.dims[d] = (b.dims[d] || 0) + 1;
    }
    return byStack;
  };
  const origCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function(tag, ...args) {
    const el = origCreateElement.call(this, tag, ...args);
    if (String(tag).toLowerCase() === "canvas") trackCanvas(el, "dom");
    return el;
  };
  if (typeof OffscreenCanvas !== "undefined") {
    const OC = OffscreenCanvas;
    window.OffscreenCanvas = function(w, h) {
      const c = new OC(w, h);
      trackCanvas(c, "offscreen");
      return c;
    };
    window.OffscreenCanvas.prototype = OC.prototype;
  }
})();
`;

async function main() {
  const replayFile = process.env.PROBE_REPLAY_FILE;
  const replay: ReplayData = replayFile
    ? JSON.parse(readFileSync(resolve(REPO, replayFile), "utf-8"))
    : (() => {
        const seed = parseInt(process.env.PROBE_RECORDED_SEED ?? "114", 10);
        const result = runGame(null, { seed, record: true, draftMode: true });
        if (!result.version || !result.actions || !result.initialState) {
          throw new Error("Recorded probe run did not return complete replay data");
        }
        const generated: ReplayData = {
          version: result.version,
          seed,
          actions: result.actions,
          initialState: result.initialState,
          draftMode: true,
        };
        // Use the replay runner's own terminal tick. The headless bot's runtime
        // tick is not a safe death-window boundary if replay reconstruction
        // diverges, because the clip would then begin after game over and finish
        // immediately without rendering 300 frames.
        const runner = createReplayRunner(generated);
        runner.init();
        for (let guard = 0; guard < 100_000 && !runner.isFinished(); guard++) {
          if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
          if (runner.isShopPaused()) runner.resumeFromShop();
          runner.step();
        }
        const finalTick = runner.getTick();
        runner.cleanup();
        return { ...generated, finalTick };
      })();

  console.log(`replay seed=${replay.seed} finalTick=${replay.finalTick ?? "derived"} actions=${replay.actions.length}`);

  const browserType = BROWSER_ENGINE === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({
    ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
    ...(BROWSER_ENGINE === "chromium"
      ? { args: ["--enable-precise-memory-info", "--enable-unsafe-swiftshader", "--js-flags=--expose-gc"] }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.addInitScript(GL_WRAP);
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("error") || t.includes("Error")) console.log("[page]", t.slice(0, 200));
  });
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

  const cdp = BROWSER_ENGINE === "chromium" ? await page.context().newCDPSession(page) : null;
  await cdp?.send("Performance.enable");

  async function metrics() {
    if (!cdp) {
      return {
        heapUsedMB: 0,
        heapTotalMB: 0,
        nodes: await page.locator("*").count(),
        listeners: 0,
        documents: 1,
      };
    }
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
    return {
      heapUsedMB: +(get("JSHeapUsedSize") / 1048576).toFixed(1),
      heapTotalMB: +(get("JSHeapTotalSize") / 1048576).toFixed(1),
      nodes: get("Nodes"),
      listeners: get("JSEventListeners"),
      documents: get("Documents"),
    };
  }

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameRef, undefined, { timeout: 30000 });

  // Mount the death clip with the same nearby replay anchor that game.ts passes
  // at game over. Starting a deep replay at tick 0 can hit the clip's 1.5 s seek
  // timeout and sample unrelated static-fallback frames instead of a 300-tick
  // playback loop.
  const modulePath = `${new URL(BASE).pathname}src/run-recap-death-clip.ts`;
  await page.evaluate(
    async ({ replayData, path }) => {
      const mod = await import(path);
      const replayMod = await import(path.replace("run-recap-death-clip.ts", "replay.ts"));
      const anchorMod = await import(path.replace("run-recap-death-clip.ts", "replay-anchor.ts"));
      const finalTick = replayData.finalTick;
      if (typeof finalTick !== "number") throw new Error("Probe replay requires an explicit finalTick");
      const startTick = Math.max(0, finalTick - 300);
      const anchorRunner = replayMod.createReplayRunner(replayData);
      anchorRunner.init();
      for (let guard = 0; guard < 100_000 && anchorRunner.getTick() < startTick; guard++) {
        if (anchorRunner.isBonusPaused()) anchorRunner.resumeFromBonusScreen();
        if (anchorRunner.isShopPaused()) anchorRunner.resumeFromShop();
        if (anchorRunner.isFinished()) break;
        anchorRunner.step();
      }
      if (anchorRunner.getTick() !== startTick || !anchorRunner.getState()) {
        const reached = anchorRunner.getTick();
        anchorRunner.cleanup();
        throw new Error(`Probe replay ended at ${reached} before death-window start ${startTick}`);
      }
      const anchor = anchorMod.createReplayStateAnchor(anchorRunner.getState(), "leakProbeStart");
      anchorRunner.cleanup();
      const host = document.createElement("div");
      host.id = "leak-probe-host";
      host.style.cssText = "position:fixed;top:0;left:0;width:450px;height:800px;z-index:9999;background:#000";
      document.body.appendChild(host);
      // The product clip now auto-loops by default. Keep this diagnostic in
      // explicit/manual-loop mode so each completed loop has a stable sampling
      // boundary before the next runner is allocated.
      (window as unknown as ProbeWindow).__probeCleanup = mod.mountRunRecapDeathClip(host, replayData, {
        anchor,
        autoLoop: false,
      });
    },
    { replayData: replay, path: modulePath },
  );

  const canvas = page.locator("#leak-probe-host canvas");
  const results: FullProbeResult[] = [];

  async function sample(label: string) {
    // Forced-GC samples prove whether allocations remain reachable. Natural-GC
    // mode tests allocator/collector high-water growth that a forced collection
    // would conceal.
    if (FORCE_GC && cdp) {
      await cdp.send("HeapProfiler.enable").catch(() => {});
      await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    }
    await page.waitForTimeout(300);
    const m = await metrics();
    const gl = await page.evaluate(() => (window as unknown as ProbeWindow).__glStats());
    const liveTextures = await page.evaluate(() => (window as unknown as ProbeWindow).__liveTextures());
    const liveCanvases = await page.evaluate(() => (window as unknown as ProbeWindow).__liveCanvases());
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#leak-probe-host canvas");
      const pixiRenderer = (window as unknown as ProbeWindow).__pixiApp?.renderer;
      return {
        clipStatus: canvas?.dataset.clipStatus ?? null,
        clipTick: canvas?.dataset.clipTick ?? null,
        pixiContext: canvas?.dataset.pixiContext ?? null,
        pixiGameplayStatic: canvas?.dataset.pixiGameplayStatic ?? null,
        rendererName: pixiRenderer?.constructor?.name ?? null,
        rendererType: pixiRenderer?.type ?? null,
        hasGl: !!pixiRenderer?.gl || !!pixiRenderer?.context?.gl,
        hasGpuDevice: !!pixiRenderer?.gpu?.device,
      };
    });
    const osMemory = browserProcessMemory();
    const row = { label, ...m, ...gl, renderer, osMemory, liveTextures, liveCanvases };
    results.push(row);
    console.log(
      `${label.padEnd(16)} heap=${m.heapUsedMB}MB nodes=${m.nodes} listeners=${m.listeners} ` +
        `glBuf=${gl.buffers}(${(gl.bufferBytes / 1048576).toFixed(1)}MB) glTex=${gl.textures}(${(gl.textureBytes / 1048576).toFixed(1)}MB) ` +
        `fbo=${gl.framebuffers} prog=${gl.programs} shaders=${gl.shaders} vao=${gl.vaos} ` +
        `rss=${osMemory.rssMB}MB renderer=${renderer.rendererName}/${renderer.rendererType} ` +
        `status=${renderer.clipStatus}@${renderer.clipTick}`,
    );
  }

  await sample("after-mount");

  for (let loop = 1; loop <= LOOPS; loop++) {
    await page.waitForFunction(
      () => document.querySelector<HTMLCanvasElement>("#leak-probe-host canvas")?.dataset.clipStatus === "complete",
      undefined,
      { timeout: 120000 },
    );
    await sample(`loop-${loop}-done`);
    if (loop < LOOPS) {
      await canvas.click({ force: true });
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>("#leak-probe-host canvas")?.dataset.clipStatus !== "complete",
        undefined,
        { timeout: 20000 },
      );
    }
  }

  // Cleanup path check: does destroy() release everything?
  await page.evaluate(() => (window as unknown as ProbeWindow).__probeCleanup?.());
  await page.waitForTimeout(500);
  await sample("after-cleanup");

  const out = resolve(REPO, "leak-probe-results.json");
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("\nresults written to", out);

  // Diff live-texture stacks between first and last completed loop
  const first = results.find((r) => r.label === "loop-1-done")?.liveTextures ?? {};
  const last = [...results].reverse().find((r) => r.label.startsWith("loop-"))?.liveTextures ?? {};
  console.log("\n=== texture stacks that grew between loop 1 and last loop ===");
  for (const [stack, info] of Object.entries(last)) {
    const before = first[stack] ?? { count: 0, bytes: 0 };
    if (info.count > before.count) {
      console.log(
        `+${info.count - before.count} textures, +${((info.bytes - before.bytes) / 1048576).toFixed(1)}MB  dims=${JSON.stringify(info.dims)}\n   ${stack}\n`,
      );
    }
  }

  const firstC = results.find((r) => r.label === "loop-1-done")?.liveCanvases ?? {};
  const lastC = [...results].reverse().find((r) => r.label.startsWith("loop-"))?.liveCanvases ?? {};
  console.log("\n=== live 2d-canvas stacks that grew between loop 1 and last loop ===");
  for (const [stack, info] of Object.entries(lastC)) {
    const before = firstC[stack] ?? { count: 0, bytes: 0 };
    if (info.count > before.count) {
      console.log(
        `+${info.count - before.count} canvases, +${((info.bytes - before.bytes) / 1048576).toFixed(1)}MB  dims=${JSON.stringify(info.dims)}\n   ${stack}\n`,
      );
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
