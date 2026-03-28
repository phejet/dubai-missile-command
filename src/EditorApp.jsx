import { useRef, useEffect, useState, useCallback } from "react";
import { CANVAS_W, CANVAS_H, COL, createExplosion } from "./game-logic.js";
import { drawGame, ov } from "./game-render.js";
import { createEditorScene } from "./editor-scene.js";
import { PARAM_GROUPS, getDefaults } from "./editor-params.js";
import "./EditorApp.css";

// Portrait canvas dimensions (9:16 aspect)
const PORTRAIT_H = Math.round((CANVAS_W * 16) / 9);
const WORLD_OFFSET_Y = PORTRAIT_H - CANVAS_H;
const PORTRAIT_LAYOUT = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: true,
  externalGameOver: true,
  renderHeight: PORTRAIT_H,
  worldOffsetY: WORLD_OFFSET_Y,
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

// Snapshot/restore for timeline scrubbing (only explosions + particles matter)
function snapshotScene(scene) {
  return {
    explosions: scene.explosions.map((e) => ({ ...e })),
    particles: scene.particles.map((p) => ({ ...p })),
    time: scene.time,
  };
}
function restoreSnapshot(scene, snap) {
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
  createExplosion(scene, 350, -200, 55, COL.explosion, false); // threat
  createExplosion(scene, 700, 100, 74, COL.interceptor, true, 0); // interceptor
  createExplosion(scene, 200, -50, 45, "#ff4400", false, 0, { chain: true }); // chain
  scene.shakeTimer = 0;
  scene.shakeIntensity = 0;
  return scene;
}

// Simulate one tick of explosion + particle physics (extracted from game-sim.js)
// Reads editor overrides live so slider changes affect the running animation.
function simTick(scene, dt) {
  const ringExpand = ov("explosion.ringExpandRate", 14);
  const ringFade = ov("explosion.ringFadeRate", 0.25);
  const debrisDrag = ov("particle.debrisDrag", 0.96);
  const sparkDrag = ov("particle.sparkDrag", 0.93);
  const debrisGravity = ov("particle.debrisGravity", 0.15);

  scene.explosions.forEach((ex) => {
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
  scene.particles.forEach((p) => {
    // Use live override values based on particle type
    const drag = p.type === "debris" ? debrisDrag : p.type === "spark" ? sparkDrag : 1;
    const gravity = p.type === "debris" ? debrisGravity : (p.gravity ?? 0.05);
    if (drag < 1) {
      p.vx *= drag;
      p.vy *= drag;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += gravity * dt;
    if (p.angle !== undefined) p.angle += p.spin * dt;
    p.life -= dt;
  });
  scene.shakeTimer = 0;
  scene.shakeIntensity = 0;
  scene.explosions = scene.explosions.filter((ex) => ex.alpha > 0);
  scene.particles = scene.particles.filter((p) => p.life > 0);
}

export default function EditorApp() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  const playingRef = useRef(false);
  const snapshotRef = useRef(null);
  const tickRef = useRef(0);
  const scrubbingRef = useRef(false);
  const [values, setValues] = useState(getDefaults);
  const [collapsed, setCollapsed] = useState({});
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [maxTick, setMaxTick] = useState(600);
  const [hasPlayed, setHasPlayed] = useState(true);

  // Sync overrides to window
  useEffect(() => {
    window.__editorOverrides = values;
  }, [values]);

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
      drawGame(ctx, sceneRef.current, { showShop: false, layoutProfile: PORTRAIT_LAYOUT });
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleChange = useCallback((key, raw, paramDef) => {
    const val = paramDef.type === "checkbox" ? raw : Number(raw);
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const resetParam = useCallback((key) => {
    const defaults = getDefaults();
    setValues((prev) => ({ ...prev, [key]: defaults[key] }));
  }, []);

  const resetAll = useCallback(() => {
    setValues(getDefaults());
  }, []);

  const exportValues = useCallback(() => {
    const defaults = getDefaults();
    const changed = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== defaults[k]) changed[k] = v;
    }
    const output = Object.keys(changed).length > 0 ? changed : values;
    console.log("=== EDITOR EXPORT ===");
    console.log(JSON.stringify(output, null, 2));
    // Also copy to clipboard
    navigator.clipboard?.writeText(JSON.stringify(output, null, 2));
    alert(`Exported ${Object.keys(output).length} values to console (and clipboard)`);
  }, [values]);

  const toggleGroup = useCallback((name) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const scrubToTick = useCallback((targetTick) => {
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

  // Spacebar hotkey for play
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === "KeyA" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        playExplosions();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playExplosions]);

  return (
    <div className="editor-root">
      <div className="editor-canvas-wrap">
        <canvas ref={canvasRef} width={CANVAS_W} height={PORTRAIT_H} className="editor-canvas" />
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
              onMouseDown={() => {
                scrubbingRef.current = true;
                if (playingRef.current) {
                  playingRef.current = false;
                  setPlaying(false);
                }
              }}
              onMouseUp={() => {
                scrubbingRef.current = false;
              }}
              onTouchStart={() => {
                scrubbingRef.current = true;
                if (playingRef.current) {
                  playingRef.current = false;
                  setPlaying(false);
                }
              }}
              onTouchEnd={() => {
                scrubbingRef.current = false;
              }}
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
                            value={values[p.key]}
                            onChange={(e) => handleChange(p.key, e.target.value, p)}
                          />
                          <span className="editor-value">{values[p.key]}</span>
                        </>
                      ) : p.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={values[p.key]}
                          onChange={(e) => handleChange(p.key, e.target.checked, p)}
                        />
                      ) : p.type === "color" ? (
                        <input
                          type="color"
                          value={values[p.key]}
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
