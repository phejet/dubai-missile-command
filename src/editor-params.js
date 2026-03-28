// Graphics editor parameter definitions
// Each parameter maps to a hardcoded value in game-render.js or game-logic.js

export const PARAM_GROUPS = [
  {
    name: "Explosions",
    params: [
      {
        key: "explosion.lightIntensity",
        label: "Light Intensity",
        type: "range",
        min: 0,
        max: 0.5,
        step: 0.01,
        default: 0.12,
      },
      {
        key: "explosion.lightRadiusMul",
        label: "Light Radius (x explosion)",
        type: "range",
        min: 1,
        max: 8,
        step: 0.5,
        default: 4,
      },
      {
        key: "explosion.ringFadeRate",
        label: "Ring Fade Rate",
        type: "range",
        min: 0.05,
        max: 1,
        step: 0.01,
        default: 0.25,
      },
      {
        key: "explosion.ringExpandRate",
        label: "Ring Expand Rate",
        type: "range",
        min: 2,
        max: 30,
        step: 1,
        default: 14,
      },
      {
        key: "explosion.flashThreshold",
        label: "Flash Alpha Threshold",
        type: "range",
        min: 0.5,
        max: 0.99,
        step: 0.01,
        default: 0.85,
      },
      {
        key: "explosion.fireballWarmStop",
        label: "Fireball Warm Band",
        type: "range",
        min: 0.01,
        max: 0.5,
        step: 0.01,
        default: 0.15,
      },
      {
        key: "explosion.fireballColorStop",
        label: "Fireball Color Band",
        type: "range",
        min: 0.1,
        max: 0.8,
        step: 0.01,
        default: 0.4,
      },
      {
        key: "explosion.fireballFadeStop",
        label: "Fireball Fade Edge",
        type: "range",
        min: 0.4,
        max: 1,
        step: 0.01,
        default: 0.75,
      },
      {
        key: "explosion.fadeRate",
        label: "Fireball Fade Rate",
        type: "range",
        min: 0.01,
        max: 0.2,
        step: 0.005,
        default: 0.05,
      },
      {
        key: "explosion.ringWidth",
        label: "Ring Width",
        type: "range",
        min: 0.5,
        max: 10,
        step: 0.5,
        default: 3,
      },
    ],
  },
  {
    name: "Particles",
    params: [
      {
        key: "particle.dotCountLight",
        label: "Dot Count (light)",
        type: "range",
        min: 1,
        max: 20,
        step: 1,
        default: 6,
      },
      {
        key: "particle.dotCountHeavy",
        label: "Dot Count (heavy)",
        type: "range",
        min: 1,
        max: 30,
        step: 1,
        default: 10,
      },
      { key: "particle.debrisCount", label: "Debris Count", type: "range", min: 0, max: 30, step: 1, default: 16 },
      {
        key: "particle.sparkCountLight",
        label: "Spark Count (light)",
        type: "range",
        min: 1,
        max: 25,
        step: 1,
        default: 8,
      },
      {
        key: "particle.sparkCountHeavy",
        label: "Spark Count (heavy)",
        type: "range",
        min: 1,
        max: 30,
        step: 1,
        default: 14,
      },
      {
        key: "particle.debrisGravity",
        label: "Debris Gravity",
        type: "range",
        min: 0,
        max: 0.5,
        step: 0.01,
        default: 0.15,
      },
      {
        key: "particle.debrisDrag",
        label: "Debris Drag",
        type: "range",
        min: 0.85,
        max: 1,
        step: 0.005,
        default: 0.96,
      },
      { key: "particle.sparkDrag", label: "Spark Drag", type: "range", min: 0.85, max: 1, step: 0.005, default: 0.93 },
    ],
  },
  {
    name: "Burj",
    params: [
      { key: "burj.coronaAlpha", label: "Corona Alpha", type: "range", min: 0, max: 0.5, step: 0.01, default: 0.1 },
      { key: "burj.uplightAlpha", label: "Uplight Alpha", type: "range", min: 0, max: 0.3, step: 0.005, default: 0.08 },
      {
        key: "burj.outlineGlowRadius",
        label: "Outline Glow Radius",
        type: "range",
        min: 5,
        max: 60,
        step: 1,
        default: 25,
      },
      {
        key: "burj.basePoolRadius",
        label: "Base Pool Radius",
        type: "range",
        min: 30,
        max: 300,
        step: 5,
        default: 150,
      },
      {
        key: "burj.basePoolAlpha",
        label: "Base Pool Alpha",
        type: "range",
        min: 0,
        max: 0.3,
        step: 0.005,
        default: 0.08,
      },
    ],
  },
  {
    name: "Sky",
    params: [
      { key: "sky.nebulaOpacity", label: "Nebula Opacity", type: "range", min: 0, max: 1, step: 0.05, default: 0.4 },
      {
        key: "sky.starTwinkleSpeed",
        label: "Star Twinkle Speed",
        type: "range",
        min: 0.005,
        max: 0.1,
        step: 0.005,
        default: 0.02,
      },
      { key: "sky.vignetteAlpha", label: "Vignette Alpha", type: "range", min: 0, max: 0.8, step: 0.02, default: 0.42 },
    ],
  },
  {
    name: "Glow",
    params: [
      { key: "glow.scale", label: "Glow Scale", type: "range", min: 0, max: 1.5, step: 0.05, default: 0.45 },
      { key: "glow.enabled", label: "Glow Enabled", type: "checkbox", default: true },
    ],
  },
];

// Build a flat map of defaults
export function getDefaults() {
  const defaults = {};
  for (const group of PARAM_GROUPS) {
    for (const p of group.params) {
      defaults[p.key] = p.default;
    }
  }
  return defaults;
}
