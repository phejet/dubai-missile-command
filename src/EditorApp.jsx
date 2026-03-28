import { useRef, useEffect, useState, useCallback } from "react";
import { CANVAS_W, CANVAS_H } from "./game-logic.js";
import { drawGame } from "./game-render.js";
import { createEditorScene } from "./editor-scene.js";
import { PARAM_GROUPS, getDefaults } from "./editor-params.js";
import "./EditorApp.css";

// Expose overrides globally for game-render.js to pick up
window.__editorOverrides = null;

export default function EditorApp() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const rafRef = useRef(null);
  const [values, setValues] = useState(getDefaults);
  const [collapsed, setCollapsed] = useState({});

  // Sync overrides to window
  useEffect(() => {
    window.__editorOverrides = values;
  }, [values]);

  // Create scene once
  useEffect(() => {
    sceneRef.current = createEditorScene();
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
      scene.time += 1;
      drawGame(ctx, scene, { showShop: false, layoutProfile: {} });
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

  return (
    <div className="editor-root">
      <div className="editor-canvas-wrap">
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="editor-canvas" />
      </div>
      <div className="editor-panel">
        <div className="editor-header">
          <h2>Graphics Editor</h2>
          <div className="editor-actions">
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
