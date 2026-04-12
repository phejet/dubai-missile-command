import React, { useRef, useEffect, useState, useCallback } from "react";
import { CANVAS_W, CANVAS_H, GROUND_Y, BURJ_X, BURJ_H, COL, createExplosion, ov } from "./game-logic.js";
import { drawGame } from "./game-render.js";
import { createEditorScene } from "./editor-scene.js";
import { PARAM_GROUPS, getDefaults } from "./editor-params.js";
import { createEmptyUpgradeProgression, getAllUpgradeNodeDefs, getUpgradeObjectiveLabel } from "./game-sim-upgrades";
import {
  buildUpgradeGraphViewModel,
  clampUpgradeGraphViewport,
  fitUpgradeGraphViewport,
  graphScreenToWorld,
  getDefaultSelectedUpgradeNodeId,
  getUpgradeGraphPositionDefaults,
  renderUpgradeGraphDetailMarkup,
  renderUpgradeGraphMarkup,
  zoomUpgradeGraphViewportAtPoint,
} from "./upgrade-graph";
import type { UpgradeGraphViewportState } from "./upgrade-graph";
import type { GameState, Explosion, Particle } from "./types";
import "./EditorApp.css";
import "./UpgradeGraph.css";

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

function getEditorPositionDefaults(): Record<string, number> {
  return {
    ...getPositionDefaults(),
    ...getUpgradeGraphPositionDefaults(),
  };
}

const GRAPH_OBJECTIVE_IDS = Array.from(
  new Set(getAllUpgradeNodeDefs().flatMap((node) => node.objectives ?? [])),
).sort();

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
  const DEFAULT_GRAPH_VIEWPORT: UpgradeGraphViewportState = { scale: 1, panX: 0, panY: 0 };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphStageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameState | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const snapshotRef = useRef<SceneSnapshot | null>(null);
  const tickRef = useRef(0);
  const scrubbingRef = useRef(false);
  const [values, setValues] = useState<Record<string, number | boolean | string>>(getDefaults);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editorView, setEditorView] = useState<"effects" | "graph">("effects");
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [maxTick, setMaxTick] = useState(600);
  const [hasPlayed, setHasPlayed] = useState(true);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [positionOverrides, setPositionOverrides] = useState<Record<string, number>>(getEditorPositionDefaults);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);
  const graphPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const graphViewportRef = useRef<UpgradeGraphViewportState>(DEFAULT_GRAPH_VIEWPORT);
  const graphGestureRef = useRef<
    | {
        mode: "pan";
        viewport: UpgradeGraphViewportState;
        point: { x: number; y: number };
        moved: boolean;
      }
    | {
        mode: "node";
        nodeId: string;
        offsetX: number;
        offsetY: number;
        point: { x: number; y: number };
        moved: boolean;
      }
    | null
  >(null);
  const graphPinchRef = useRef<{
    viewport: UpgradeGraphViewportState;
    midpoint: { x: number; y: number };
    distance: number;
  } | null>(null);
  const [graphOwnedNodes, setGraphOwnedNodes] = useState<string[]>([]);
  const [graphSelection, setGraphSelection] = useState<string | null>(null);
  const [graphProgression, setGraphProgression] = useState(createEmptyUpgradeProgression);
  const [graphViewport, setGraphViewport] = useState<UpgradeGraphViewportState>(DEFAULT_GRAPH_VIEWPORT);
  const graphOwnedSet = new Set(graphOwnedNodes);
  const graphView = buildUpgradeGraphViewModel({
    progression: graphProgression,
    ownedNodes: graphOwnedSet,
    layoutOverrides: positionOverrides,
  });
  const selectedGraphNodeId =
    graphSelection && graphView.nodes.some((node) => node.id === graphSelection)
      ? graphSelection
      : getDefaultSelectedUpgradeNodeId(graphView);

  function getGraphStageSize() {
    const stage = graphStageRef.current;
    return {
      width: Math.max(stage?.clientWidth ?? 0, 760),
      height: Math.max(stage?.clientHeight ?? 0, 420),
    };
  }

  function setClampedGraphViewport(nextViewport: UpgradeGraphViewportState) {
    const size = getGraphStageSize();
    const clamped = clampUpgradeGraphViewport(nextViewport, size.width, size.height, graphView.width, graphView.height);
    graphViewportRef.current = clamped;
    setGraphViewport(clamped);
  }

  function fitGraphViewport() {
    const size = getGraphStageSize();
    const fitted = fitUpgradeGraphViewport(size.width, size.height, graphView.width, graphView.height);
    graphViewportRef.current = fitted;
    setGraphViewport(fitted);
  }

  function getGraphStagePoint(clientX: number, clientY: number) {
    const rect = graphStageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Sync overrides to window
  useEffect(() => {
    window.__editorOverrides = { ...values, ...positionOverrides };
  }, [values, positionOverrides]);

  useEffect(() => {
    if (editorView !== "graph") return;
    const frameId = requestAnimationFrame(() => {
      const size = getGraphStageSize();
      const fitted = fitUpgradeGraphViewport(size.width, size.height, graphView.width, graphView.height);
      graphViewportRef.current = fitted;
      setGraphViewport(fitted);
    });
    return () => cancelAnimationFrame(frameId);
  }, [editorView, graphView.height, graphView.width]);

  useEffect(() => {
    if (editorView !== "graph") return;
    const handleResize = () => {
      const size = getGraphStageSize();
      const fitted = fitUpgradeGraphViewport(size.width, size.height, graphView.width, graphView.height);
      graphViewportRef.current = fitted;
      setGraphViewport(fitted);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [editorView, graphView.height, graphView.width]);

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
    const posDefaults = getEditorPositionDefaults();
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

  function onGraphMouseDown(e: React.PointerEvent<HTMLDivElement>) {
    const stage = graphStageRef.current;
    const nativeEvent = e.nativeEvent;
    const target = e.target as HTMLElement;
    if (!stage || target.closest("[data-zoom-control]")) return;
    const point = getGraphStagePoint(nativeEvent.clientX, nativeEvent.clientY);
    graphPointersRef.current.set(nativeEvent.pointerId, point);
    stage.setPointerCapture(nativeEvent.pointerId);
    if (graphPointersRef.current.size === 2) {
      const active = Array.from(graphPointersRef.current.values());
      graphGestureRef.current = null;
      graphPinchRef.current = {
        viewport: graphViewportRef.current,
        midpoint: { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 },
        distance: Math.max(Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y), 1),
      };
      return;
    }
    const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) {
      const nodeId = nodeEl.dataset.nodeId;
      setGraphSelection(nodeId);
      const worldPoint = graphScreenToWorld(point, graphViewportRef.current);
      graphGestureRef.current = {
        mode: "node",
        nodeId,
        offsetX: positionOverrides[`upgradeGraph.${nodeId}.x`] - worldPoint.x,
        offsetY: positionOverrides[`upgradeGraph.${nodeId}.y`] - worldPoint.y,
        point,
        moved: false,
      };
      return;
    }
    graphPinchRef.current = null;
    graphGestureRef.current = {
      mode: "pan",
      viewport: graphViewportRef.current,
      point,
      moved: false,
    };
  }

  function onGraphMouseMove(e: React.PointerEvent<HTMLDivElement>) {
    const nativeEvent = e.nativeEvent;
    if (!graphPointersRef.current.has(nativeEvent.pointerId)) return;
    const point = getGraphStagePoint(nativeEvent.clientX, nativeEvent.clientY);
    graphPointersRef.current.set(nativeEvent.pointerId, point);

    if (graphPointersRef.current.size >= 2 && graphPinchRef.current) {
      const active = Array.from(graphPointersRef.current.values());
      const currentMidpoint = { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 };
      const currentDistance = Math.max(Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y), 1);
      const pinch = graphPinchRef.current;
      const targetScale = pinch.viewport.scale * (currentDistance / pinch.distance);
      const worldPoint = graphScreenToWorld(pinch.midpoint, pinch.viewport);
      setClampedGraphViewport({
        scale: targetScale,
        panX: currentMidpoint.x - worldPoint.x * targetScale,
        panY: currentMidpoint.y - worldPoint.y * targetScale,
      });
      return;
    }

    const gesture = graphGestureRef.current;
    if (!gesture) return;
    const dx = point.x - gesture.point.x;
    const dy = point.y - gesture.point.y;
    if (!gesture.moved && Math.hypot(dx, dy) > 8) gesture.moved = true;

    if (gesture.mode === "pan") {
      if (!gesture.moved) return;
      setClampedGraphViewport({
        scale: gesture.viewport.scale,
        panX: gesture.viewport.panX + dx,
        panY: gesture.viewport.panY + dy,
      });
      return;
    }

    if (!gesture.moved) return;
    const worldPoint = graphScreenToWorld(point, graphViewportRef.current);
    setPositionOverrides((prev) => ({
      ...prev,
      [`upgradeGraph.${gesture.nodeId}.x`]: Math.round(worldPoint.x + gesture.offsetX),
      [`upgradeGraph.${gesture.nodeId}.y`]: Math.round(worldPoint.y + gesture.offsetY),
    }));
  }

  function onGraphMouseUp(e: React.PointerEvent<HTMLDivElement>) {
    const stage = graphStageRef.current;
    const nativeEvent = e.nativeEvent;
    const gesture = graphGestureRef.current;
    const shouldSelect = gesture?.mode === "node" && !gesture.moved;
    graphPointersRef.current.delete(nativeEvent.pointerId);
    if (stage?.hasPointerCapture(nativeEvent.pointerId)) {
      stage.releasePointerCapture(nativeEvent.pointerId);
    }
    if (shouldSelect) setGraphSelection(gesture.nodeId);
    graphGestureRef.current = null;
    graphPinchRef.current = null;
    setIsDragging(false);
  }

  function onGraphWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const point = getGraphStagePoint(e.clientX, e.clientY);
    const size = getGraphStageSize();
    const nextViewport = zoomUpgradeGraphViewportAtPoint(
      graphViewportRef.current,
      size.width,
      size.height,
      graphView.width,
      graphView.height,
      point,
      graphViewportRef.current.scale * Math.exp(-e.deltaY * 0.0014),
    );
    graphViewportRef.current = nextViewport;
    setGraphViewport(nextViewport);
  }

  function zoomGraphFromCenter(multiplier: number) {
    const size = getGraphStageSize();
    const nextViewport = zoomUpgradeGraphViewportAtPoint(
      graphViewportRef.current,
      size.width,
      size.height,
      graphView.width,
      graphView.height,
      { x: size.width / 2, y: size.height / 2 },
      graphViewportRef.current.scale * multiplier,
    );
    graphViewportRef.current = nextViewport;
    setGraphViewport(nextViewport);
  }

  function fitGraphViewNow() {
    fitGraphViewport();
  }

  function onGraphMouseLeave() {
    graphPointersRef.current.clear();
    graphGestureRef.current = null;
    graphPinchRef.current = null;
    setIsDragging(false);
  }

  const toggleObjective = useCallback((objectiveId: string) => {
    setGraphProgression((prev) => {
      const completed = prev.completedObjectives.includes(objectiveId)
        ? prev.completedObjectives.filter((id) => id !== objectiveId)
        : [...prev.completedObjectives, objectiveId].sort();
      return { ...prev, completedObjectives: completed };
    });
  }, []);

  function toggleSelectedOwned() {
    if (!selectedGraphNodeId) return;
    setGraphOwnedNodes((prev) =>
      prev.includes(selectedGraphNodeId)
        ? prev.filter((id) => id !== selectedGraphNodeId)
        : [...prev, selectedGraphNodeId].sort(),
    );
  }

  function resetGraphPreview() {
    setGraphOwnedNodes([]);
    setGraphProgression(createEmptyUpgradeProgression());
    setPositionOverrides((prev) => {
      const next = { ...prev };
      const defaults = getUpgradeGraphPositionDefaults();
      for (const [key, value] of Object.entries(defaults)) next[key] = value;
      return next;
    });
    requestAnimationFrame(() => fitGraphViewport());
  }

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

  const graphCounts = graphView.nodes.reduce(
    (counts, node) => {
      counts[node.state]++;
      return counts;
    },
    { owned: 0, available: 0, locked: 0, metaLocked: 0 },
  );
  const selectedGraphOwned = selectedGraphNodeId ? graphOwnedNodes.includes(selectedGraphNodeId) : false;

  return (
    <div className="editor-root">
      <div className="editor-canvas-wrap">
        {editorView === "effects" ? (
          <>
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
          </>
        ) : (
          <div className="upgrade-graph-shell upgrade-graph-shell--panel upgrade-graph-editor">
            <div className="upgrade-graph-shell__header">
              <div>
                <div className="upgrade-graph-shell__eyebrow">Editor Layout Preview</div>
                <h2 className="upgrade-graph-shell__title">Full Upgrade Graph</h2>
                <p className="upgrade-graph-shell__copy">
                  Drag nodes to reflow the progression map. The preview uses the authored graph data and the same
                  renderer as the post-run viewer.
                </p>
              </div>
              <div className="upgrade-graph-shell__stats">
                <div className="upgrade-graph-shell__stat">
                  <span className="upgrade-graph-shell__stat-label">Owned</span>
                  <strong className="upgrade-graph-shell__stat-value">{graphCounts.owned}</strong>
                </div>
                <div className="upgrade-graph-shell__stat">
                  <span className="upgrade-graph-shell__stat-label">Available</span>
                  <strong className="upgrade-graph-shell__stat-value">{graphCounts.available}</strong>
                </div>
                <div className="upgrade-graph-shell__stat">
                  <span className="upgrade-graph-shell__stat-label">Meta Locked</span>
                  <strong className="upgrade-graph-shell__stat-value">{graphCounts.metaLocked}</strong>
                </div>
              </div>
            </div>
            <div className="upgrade-graph-shell__body">
              <div
                ref={graphStageRef}
                className="upgrade-graph-shell__stage"
                onPointerDown={onGraphMouseDown}
                onPointerMove={onGraphMouseMove}
                onPointerUp={onGraphMouseUp}
                onPointerCancel={onGraphMouseUp}
                onPointerLeave={onGraphMouseLeave}
                onWheel={onGraphWheel}
              >
                <div className="upgrade-graph-shell__controls">
                  <button
                    type="button"
                    className="upgrade-graph-shell__control"
                    data-zoom-control="out"
                    onClick={() => zoomGraphFromCenter(1 / 1.18)}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="upgrade-graph-shell__control"
                    data-zoom-control="fit"
                    onClick={fitGraphViewNow}
                  >
                    Fit
                  </button>
                  <button
                    type="button"
                    className="upgrade-graph-shell__control"
                    data-zoom-control="in"
                    onClick={() => zoomGraphFromCenter(1.18)}
                  >
                    +
                  </button>
                  <span className="upgrade-graph-shell__scale">{Math.round(graphViewport.scale * 100)}%</span>
                </div>
                <div
                  className="upgrade-graph-shell__canvas"
                  style={{
                    transform: `translate(${graphViewport.panX}px, ${graphViewport.panY}px) scale(${graphViewport.scale})`,
                  }}
                  dangerouslySetInnerHTML={{
                    __html: renderUpgradeGraphMarkup(graphView, { selectedNodeId: selectedGraphNodeId }),
                  }}
                />
              </div>
              <div
                className="upgrade-graph-shell__detail"
                dangerouslySetInnerHTML={{ __html: renderUpgradeGraphDetailMarkup(graphView, selectedGraphNodeId) }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="editor-panel">
        <div className="editor-header">
          <h2>Graphics Editor</h2>
          <div className="editor-actions">
            <button
              onClick={() => setEditorView("effects")}
              className={editorView === "effects" ? "play-btn play-btn--active" : "play-btn"}
            >
              Effects
            </button>
            <button
              onClick={() => setEditorView("graph")}
              className={editorView === "graph" ? "play-btn play-btn--active" : "play-btn"}
            >
              Upgrade Graph
            </button>
            {editorView === "effects" && (
              <>
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
              </>
            )}
            <button onClick={() => window.open("sprites.html", "_blank")}>Sprite Catalog</button>
            <button onClick={resetAll}>Reset All</button>
            <button onClick={exportValues} className="export-btn">
              Export
            </button>
          </div>
        </div>
        {editorView === "effects" ? (
          PARAM_GROUPS.map((group) => (
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
          ))
        ) : (
          <div className="upgrade-graph-editor__toolbar">
            <section className="upgrade-graph-editor__section">
              <h3>Preview State</h3>
              <div className="upgrade-graph-editor__actions">
                <button
                  onClick={toggleSelectedOwned}
                  className={selectedGraphOwned ? "play-btn play-btn--active" : "play-btn"}
                >
                  {selectedGraphOwned ? "Remove Owned Flag" : "Mark Selected Owned"}
                </button>
                <button onClick={() => setGraphOwnedNodes([])}>Clear Owned</button>
                <button onClick={resetGraphPreview}>Reset Graph Layout</button>
              </div>
              <p className="upgrade-graph-editor__hint">
                Selection follows node clicks in the graph. Ownership here is preview-only and does not change gameplay
                data.
              </p>
            </section>
            <section className="upgrade-graph-editor__section">
              <h3>Meta Objectives</h3>
              <div className="upgrade-graph-objectives">
                {GRAPH_OBJECTIVE_IDS.map((objectiveId) => {
                  const active = graphProgression.completedObjectives.includes(objectiveId);
                  return (
                    <button
                      key={objectiveId}
                      type="button"
                      className={`upgrade-graph-objective${active ? " upgrade-graph-objective--active" : ""}`}
                      onClick={() => toggleObjective(objectiveId)}
                    >
                      {getUpgradeObjectiveLabel(objectiveId)}
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="upgrade-graph-editor__section">
              <h3>Graph Summary</h3>
              <p className="upgrade-graph-editor__hint">
                Available nodes unlock when at least one previous branch node is owned. Objective chips simulate
                between-run progression gates.
              </p>
              <div className="upgrade-graph-editor__actions">
                <button onClick={() => setGraphSelection(getDefaultSelectedUpgradeNodeId(graphView) ?? null)}>
                  Jump To Priority Node
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
