import React, { useRef, useEffect, useState, useCallback } from "react";
import { CANVAS_W, CANVAS_H, GROUND_Y, BURJ_X, BURJ_H, COL, createExplosion, ov } from "./game-logic.js";
import { drawGame } from "./game-render.js";
import { createEditorScene } from "./editor-scene.js";
import { PARAM_GROUPS, getDefaults } from "./editor-params.js";
import type { GameState, Explosion, Particle } from "./types";
import "./EditorApp.css";

declare global {
  interface Window {
    __editorOverrides: Record<string, number | boolean | string> | null;
  }
}

const UPGRADE_POSITIONS = {
  "upgrade.ironBeam": { x: BURJ_X, y: 959 },
  "upgrade.phalanx1": { x: 553, y: 1498 },
  "upgrade.phalanx2": { x: 860, y: 1504 },
  "upgrade.phalanx3": { x: 59, y: GROUND_Y - 30 },
  "upgrade.patriot": { x: 334, y: 1511 },
  "upgrade.emp": { x: 462, y: 1047 },
  "upgrade.flares": { x: BURJ_X, y: 837 },
  "upgrade.hornets": { x: 206, y: 1511 },
  "upgrade.roadrunner": { x: 678, y: GROUND_Y - 15 },
  "upgrade.launcherKit": { x: 772, y: 1513 },
};

function getPositionDefaults(): Record<string, number> {
  const defaults: Record<string, number> = {};
  for (const [key, pos] of Object.entries(UPGRADE_POSITIONS)) {
    defaults[`${key}.x`] = pos.x;
    defaults[`${key}.y`] = pos.y;
  }
  return defaults;
}

function canvasToGame(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) * CANVAS_W) / rect.width,
    y: ((clientY - rect.top) * CANVAS_H) / rect.height,
  };
}

const EDITOR_LAYOUT = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: true,
  externalGameOver: true,
  buildingScale: 2,
  burjScale: 2,
  launcherScale: 3,
  enemyScale: 3,
  projectileScale: 2,
  effectScale: 2,
  planeScale: 3,
};

// Expose overrides globally for game-render.js to pick up
window.__editorOverrides = null;

type SceneSnapshot = { explosions: Explosion[]; particles: Particle[]; time: number };

// Snapshot/restore for timeline scrubbing (only explosions + particles matter)
function snapshotScene(scene: GameState): SceneSnapshot {
  return {
    explosions: scene.explosions.map((e) => ({ ...e })),
    particles: scene.particles.map((p) => ({ ...p })),
    time: scene.time,
  };
}
function restoreSnapshot(scene: GameState, snap: SceneSnapshot): void {
  scene.explosions = snap.explosions.map((e) => ({ ...e }));
  scene.particles = snap.particles.map((p) => ({ ...p }));
  scene.time = snap.time;
  scene.shakeTimer = 0;
  scene.shakeIntensity = 0;
}

// Create a scene with fresh explosions spawned from radius 0 (full lifecycle)
function createPlayScene() {
  const scene = createEditorScene();
  scene.explosions = [];
  scene.particles = [];
  createExplosion(scene, 350, 350, 55, COL.explosion, false); // threat
  createExplosion(scene, 700, 550, 74, COL.interceptor, true, 0); // interceptor
  createExplosion(scene, 200, 200, 45, "#ff4400", false, 0, { chain: true }); // chain
  scene.shakeTimer = 0;
  scene.shakeIntensity = 0;
  return scene;
}

// Simulate one tick of explosion + particle physics (extracted from game-sim.js)
// Reads editor overrides live so slider changes affect the running animation.
function simTick(scene: GameState, dt: number): void {
  const ringExpand = ov("explosion.ringExpandRate", 14);
  const ringFade = ov("explosion.ringFadeRate", 0.25);
  const debrisDrag = ov("particle.debrisDrag", 0.96);
  const sparkDrag = ov("particle.sparkDrag", 0.93);
  const debrisGravity = ov("particle.debrisGravity", 0.15);

  scene.explosions.forEach((ex: Explosion) => {
    if (ex.growing) {
      ex.radius += (ex.chain ? 4 : 2) * dt;
      if (ex.radius >= ex.maxRadius) ex.growing = false;
    } else {
      ex.alpha -= ov("explosion.fadeRate", 0.05) * dt;
    }
    if (ex.ringAlpha > 0) {
      ex.ringRadius += ringExpand * dt;
      ex.ringAlpha -= ringFade * dt;
    }
  });
  const dragByType: Record<string, number> = { debris: debrisDrag, spark: sparkDrag };
  scene.particles.forEach((p: Particle) => {
    const drag = (p.type ? dragByType[p.type] : undefined) ?? 1;
    const gravity = p.type === "debris" ? debrisGravity : (p.gravity ?? 0.05);
    if (drag < 1) {
      p.vx *= drag;
      p.vy *= drag;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += gravity * dt;
    if (p.angle !== undefined) p.angle += (p.spin ?? 0) * dt;
    p.life -= dt;
  });
  scene.shakeTimer = 0;
  scene.shakeIntensity = 0;
  scene.explosions = scene.explosions.filter((ex: Explosion) => ex.alpha > 0);
  scene.particles = scene.particles.filter((p: Particle) => p.life > 0);
}

export default function EditorApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GameState | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const snapshotRef = useRef<SceneSnapshot | null>(null);
  const tickRef = useRef(0);
  const scrubbingRef = useRef(false);
  const [values, setValues] = useState<Record<string, number | boolean | string>>(getDefaults);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [maxTick, setMaxTick] = useState(600);
  const [hasPlayed, setHasPlayed] = useState(true);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, number>>(getPositionDefaults);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);

  // Sync overrides to window
  useEffect(() => {
    window.__editorOverrides = { ...values, ...positionOverrides };
  }, [values, positionOverrides]);

  // Create scene once, with snapshot for timeline scrubbing
  useEffect(() => {
    const scene = createPlayScene();
    sceneRef.current = scene;
    snapshotRef.current = snapshotScene(scene);
  }, []);

  // Animation loop — animate time so twinkle/glow effects are visible
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      const scene = sceneRef.current;
      if (!scene) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      // Only auto-advance time when playing and not scrubbing
      if (playingRef.current && !scrubbingRef.current) {
        scene.time += 1;
        tickRef.current += 1;
        simTick(scene, 1);
        // Loop: record max tick, respawn fresh explosions
        if (scene.explosions.length === 0 && scene.particles.length === 0) {
          setMaxTick(tickRef.current);
          const newScene = createPlayScene();
          sceneRef.current = newScene;
          snapshotRef.current = snapshotScene(newScene);
          tickRef.current = 0;
          setTick(0);
        } else if (tickRef.current % 6 === 0) {
          setTick(tickRef.current);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      drawGame(ctx!, sceneRef.current!, { showShop: false, layoutProfile: EDITOR_LAYOUT as any });
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleChange = useCallback((key: string, raw: unknown, paramDef: { type: string }) => {
    const val = paramDef.type === "checkbox" ? raw : paramDef.type === "color" ? raw : Number(raw);
    setValues((prev) => ({ ...prev, [key]: val as number | boolean | string }));
  }, []);

  const resetParam = useCallback((key: string) => {
    const defaults = getDefaults();
    setValues((prev) => ({ ...prev, [key]: defaults[key] }));
  }, []);

  const resetAll = useCallback(() => {
    setValues(getDefaults());
  }, []);

  const exportValues = useCallback(() => {
    const defaults = getDefaults();
    const posDefaults = getPositionDefaults();
    const allValues = { ...values, ...positionOverrides };
    const allDefaults = { ...defaults, ...posDefaults };
    const changed: Record<string, number | boolean | string> = {};
    for (const [k, v] of Object.entries(allValues)) {
      if (v !== allDefaults[k]) changed[k] = v;
    }
    const output = Object.keys(changed).length > 0 ? changed : allValues;
    console.log("=== EDITOR EXPORT ===");
    console.log(JSON.stringify(output, null, 2));
    // Also copy to clipboard
    const json = JSON.stringify(output, null, 2);
    const n = Object.keys(output).length;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(
        () => alert(`Exported ${n} values to console and clipboard`),
        () => alert(`Exported ${n} values to console (clipboard copy failed)`),
      );
    } else {
      alert(`Exported ${n} values to console`);
    }
  }, [values, positionOverrides]);

  const toggleGroup = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const scrubToTick = useCallback((targetTick: number) => {
    const scene = sceneRef.current;
    const snap = snapshotRef.current;
    if (!scene || !snap) return;
    restoreSnapshot(scene, snap);
    for (let i = 0; i < targetTick; i++) {
      simTick(scene, 1);
    }
    scene.time = snap.time + targetTick;
    tickRef.current = targetTick;
    setTick(targetTick);
  }, []);

  const playExplosions = useCallback(() => {
    if (playingRef.current) {
      // Pause: freeze in place, keep current tick
      playingRef.current = false;
      setPlaying(false);
    } else if (snapshotRef.current) {
      // Resume from current tick
      playingRef.current = true;
      setPlaying(true);
    } else {
      // First play: spawn fresh explosions, store snapshot
      const newScene = createPlayScene();
      sceneRef.current = newScene;
      snapshotRef.current = snapshotScene(newScene);
      tickRef.current = 0;
      setTick(0);
      setHasPlayed(true);
      playingRef.current = true;
      setPlaying(true);
    }
  }, []);

  const toggleUpgrades = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const next = !showUpgrades;
    setShowUpgrades(next);
    scene._showUpgradeRanges = next;
    if (next) {
      // Max all upgrades so their visuals render
      const keys = [
        "wildHornets",
        "roadrunner",
        "flare",
        "ironBeam",
        "phalanx",
        "patriot",
        "launcherKit",
        "emp",
      ] as const;
      for (const k of keys) scene.upgrades[k] = 3;
      // Add defense sites so upgrade renderers activate
      const siteDefs = {
        patriot: { x: 334, y: 1511, hw: 38, hh: 24 },
        flare: { x: BURJ_X, y: 837, hw: 8, hh: 10 },
        ironBeam: { x: BURJ_X, y: 959, hw: 10, hh: 15 },
        wildHornets: { x: 206, y: 1511, hw: 30, hh: 24 },
        roadrunner: { x: 678, y: GROUND_Y - 15, hw: 30, hh: 24 },
        launcherKit: { x: 772, y: 1513, hw: 30, hh: 24 },
      };
      scene.defenseSites = [];
      for (const [key, def] of Object.entries(siteDefs)) {
        scene.defenseSites.push({ key, ...def, alive: true, savedLevel: 3 });
      }
      for (const pos of [
        { x: 553, y: 1498 },
        { x: 860, y: 1504 },
      ]) {
        scene.defenseSites.push({ key: "phalanx", ...pos, alive: true, hw: 10, hh: 15, savedLevel: 3 });
      }
      scene.empChargeMax = 720;
      scene.empCharge = 720;
      scene.empReady = true;
      scene.launcherHP = [2, 2, 2];
    } else {
      // Reset upgrades
      const keys = [
        "wildHornets",
        "roadrunner",
        "flare",
        "ironBeam",
        "phalanx",
        "patriot",
        "launcherKit",
        "emp",
      ] as const;
      for (const k of keys) scene.upgrades[k] = 0;
      scene.defenseSites = [];
      scene.empChargeMax = 0;
      scene.empCharge = 0;
      scene.empReady = false;
      scene.launcherHP = [1, 1, 1];
    }
  }, [showUpgrades]);

  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!showUpgrades) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const gp = canvasToGame(canvas, e.clientX, e.clientY);
      let closest = null;
      let closestDist = 30; // max pick distance in game coords
      for (const [key, _def] of Object.entries(UPGRADE_POSITIONS)) {
        const sx = positionOverrides[`${key}.x`];
        const sy = positionOverrides[`${key}.y`];
        const d = Math.hypot(gp.x - sx, gp.y - sy);
        if (d < closestDist) {
          closestDist = d;
          closest = key;
        }
      }
      if (closest) {
        dragRef.current = {
          key: closest,
          offsetX: positionOverrides[`${closest}.x`] - gp.x,
          offsetY: positionOverrides[`${closest}.y`] - gp.y,
        };
        setIsDragging(true);
      }
    },
    [showUpgrades, positionOverrides],
  );

  const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (dragRef.current) {
      const gp = canvasToGame(canvas, e.clientX, e.clientY);
      const { key, offsetX, offsetY } = dragRef.current;
      setPositionOverrides((prev) => ({
        ...prev,
        [`${key}.x`]: Math.round(gp.x + offsetX),
        [`${key}.y`]: Math.round(gp.y + offsetY),
      }));
    }
  }, []);

  const onCanvasMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // "A" key hotkey for play/pause
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "KeyA" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        playExplosions();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playExplosions]);

  const startScrub = useCallback(() => {
    scrubbingRef.current = true;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
    }
  }, []);

  const stopScrub = useCallback(() => {
    scrubbingRef.current = false;
  }, []);

  return (
    <div className="editor-root">
      <div className="editor-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className={`editor-canvas${showUpgrades ? (isDragging ? " editor-canvas--grabbing" : " editor-canvas--grab") : ""}`}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        />
        {hasPlayed && (
          <div className="editor-timeline">
            <span className="timeline-tick">{tick}</span>
            <input
              type="range"
              className="timeline-slider"
              tabIndex={-1}
              min={0}
              max={maxTick}
              value={tick}
              onMouseDown={startScrub}
              onMouseUp={stopScrub}
              onTouchStart={startScrub}
              onTouchEnd={stopScrub}
              onChange={(e) => scrubToTick(Number(e.target.value))}
            />
            <span className="timeline-tick">{maxTick}</span>
          </div>
        )}
      </div>
      <div className="editor-panel">
        <div className="editor-header">
          <h2>Graphics Editor</h2>
          <div className="editor-actions">
            <button onClick={playExplosions} className={playing ? "play-btn play-btn--active" : "play-btn"}>
              {playing ? "\u25A0 Pause" : "\u25B6 Play"}
            </button>
            <button onClick={toggleUpgrades} className={showUpgrades ? "play-btn play-btn--active" : "play-btn"}>
              {showUpgrades ? "Hide Upgrades" : "Show Upgrades"}
            </button>
            <button
              onClick={() => {
                const scene = sceneRef.current;
                if (!scene) return;
                scene._showColliders = !scene._showColliders;
              }}
              className="play-btn"
            >
              Colliders
            </button>
            <button onClick={() => window.open("sprites.html", "_blank")}>Sprite Catalog</button>
            <button onClick={resetAll}>Reset All</button>
            <button onClick={exportValues} className="export-btn">
              Export
            </button>
          </div>
        </div>
        {PARAM_GROUPS.map((group) => (
          <div key={group.name} className="editor-group">
            <div className="editor-group-header" onClick={() => toggleGroup(group.name)}>
              <span>
                {collapsed[group.name] ? "\u25B6" : "\u25BC"} {group.name}
              </span>
            </div>
            {!collapsed[group.name] && (
              <div className="editor-group-body">
                {group.params.map((p) => (
                  <div key={p.key} className="editor-param">
                    <label className="editor-label">{p.label}</label>
                    <div className="editor-control">
                      {p.type === "range" ? (
                        <>
                          <input
                            type="range"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={values[p.key] as number}
                            onChange={(e) => handleChange(p.key, e.target.value, p)}
                          />
                          <span className="editor-value">{values[p.key]}</span>
                        </>
                      ) : p.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={values[p.key] as boolean}
                          onChange={(e) => handleChange(p.key, e.target.checked, p)}
                        />
                      ) : p.type === "color" ? (
                        <input
                          type="color"
                          value={values[p.key] as string}
                          onChange={(e) => handleChange(p.key, e.target.value, p)}
                        />
                      ) : null}
                      <button className="reset-btn" onClick={() => resetParam(p.key)} title="Reset to default">
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
