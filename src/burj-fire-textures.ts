export interface BurjFireTextureCanvas {
  id: BurjFireTextureVariantId | "smoke";
  label: string;
  canvas: HTMLCanvasElement;
  note: string;
}

export const BURJ_FIRE_FLAME_VARIANTS = [
  { id: "flame-00", label: "Burj fire flame 00", lean: 0, width: 1, height: 1, split: 0.15 },
  { id: "flame-01", label: "Burj fire flame 01", lean: -0.2, width: 0.78, height: 1.16, split: 0.34 },
  { id: "flame-02", label: "Burj fire flame 02", lean: 0.18, width: 1.16, height: 0.86, split: 0.24 },
  { id: "flame-03", label: "Burj fire flame 03", lean: -0.08, width: 0.9, height: 1.34, split: 0.48 },
  { id: "flame-04", label: "Burj fire flame 04", lean: 0.24, width: 0.72, height: 1.02, split: 0.42 },
  { id: "flame-05", label: "Burj fire flame 05", lean: 0.04, width: 1.28, height: 0.74, split: 0.58 },
] as const;

export const BURJ_FIRE_CORE_VARIANTS = [
  { id: "core-00", label: "Burj fire core 00", lean: 0, width: 1, height: 1 },
  { id: "core-01", label: "Burj fire core 01", lean: -0.12, width: 0.72, height: 1.18 },
  { id: "core-02", label: "Burj fire core 02", lean: 0.14, width: 1.16, height: 0.84 },
  { id: "core-03", label: "Burj fire core 03", lean: 0.06, width: 0.88, height: 1.32 },
] as const;

export const BURJ_FIRE_EMBER_VARIANTS = [
  { id: "ember-00", label: "Burj fire ember 00", shape: "dot" },
  { id: "ember-01", label: "Burj fire ember 01", shape: "streak" },
  { id: "ember-02", label: "Burj fire ember 02", shape: "shard" },
  { id: "ember-03", label: "Burj fire ember 03", shape: "cluster" },
  { id: "ember-04", label: "Burj fire ember 04", shape: "needle" },
  { id: "ember-05", label: "Burj fire ember 05", shape: "fleck" },
] as const;

export type BurjFireFlameVariantId = (typeof BURJ_FIRE_FLAME_VARIANTS)[number]["id"];
export type BurjFireCoreVariantId = (typeof BURJ_FIRE_CORE_VARIANTS)[number]["id"];
export type BurjFireEmberVariantId = (typeof BURJ_FIRE_EMBER_VARIANTS)[number]["id"];
export type BurjFireTextureVariantId = BurjFireFlameVariantId | BurjFireCoreVariantId | BurjFireEmberVariantId;

function pickVariantId<T extends { id: string }>(variants: readonly T[], index: number): T["id"] {
  const safeIndex = Math.abs(Math.trunc(index)) % variants.length;
  return variants[safeIndex].id;
}

export function getBurjFireFlameVariantId(index: number): BurjFireFlameVariantId {
  return pickVariantId(BURJ_FIRE_FLAME_VARIANTS, index) as BurjFireFlameVariantId;
}

export function getBurjFireCoreVariantId(index: number): BurjFireCoreVariantId {
  return pickVariantId(BURJ_FIRE_CORE_VARIANTS, index) as BurjFireCoreVariantId;
}

export function getBurjFireEmberVariantId(index: number): BurjFireEmberVariantId {
  return pickVariantId(BURJ_FIRE_EMBER_VARIANTS, index) as BurjFireEmberVariantId;
}

export function getBurjFireCoreVariantIdForFlame(flameVariant: string | undefined): BurjFireCoreVariantId {
  const index = BURJ_FIRE_FLAME_VARIANTS.findIndex((variant) => variant.id === flameVariant);
  return getBurjFireCoreVariantId(index < 0 ? 0 : index);
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Ragged vertical flame tongue. The sprite is intentionally asymmetric; stacked
// particles should read as moving fire, not a single laminated warning icon.
export function createBurjFireParticleCanvas(variantId: BurjFireFlameVariantId = "flame-00"): HTMLCanvasElement | null {
  const variant = BURJ_FIRE_FLAME_VARIANTS.find((item) => item.id === variantId) ?? BURJ_FIRE_FLAME_VARIANTS[0];
  const w = 72;
  const h = 104;
  const cx = w / 2;
  const tipY = 8 + (1.18 - variant.height) * 11;
  const baseY = 92;
  const canvas = createCanvas(w, h);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;

  ctx.globalCompositeOperation = "source-over";
  const halo = ctx.createRadialGradient(cx, baseY - 18, 0, cx, baseY - 24, 34);
  halo.addColorStop(0, "rgba(255,126,34,0.34)");
  halo.addColorStop(0.48, "rgba(255,74,18,0.14)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  const lobes = [
    {
      ox: -9 - variant.split * 8,
      tip: tipY + 18 - variant.split * 10,
      base: baseY,
      w: 16,
      alpha: 0.62,
      hue: "255,78,20",
    },
    { ox: 2 + variant.lean * 14, tip: tipY, base: baseY + 2, w: 22, alpha: 0.74, hue: "255,112,28" },
    {
      ox: 12 + variant.split * 9,
      tip: tipY + 27 - variant.split * 8,
      base: baseY - 4,
      w: 13,
      alpha: 0.48,
      hue: "255,54,16",
    },
  ];
  for (const lobe of lobes) {
    const lobeWidth = lobe.w * variant.width;
    const lobeTip = Math.max(4, cx + lobe.ox + variant.lean * 18);
    ctx.beginPath();
    ctx.moveTo(lobeTip, lobe.tip);
    ctx.bezierCurveTo(
      cx + lobe.ox + lobeWidth * 0.75 + variant.lean * 20,
      lobe.tip + 20,
      cx + lobe.ox + lobeWidth,
      lobe.base - 22,
      cx + lobe.ox + lobeWidth * 0.55,
      lobe.base,
    );
    ctx.quadraticCurveTo(cx + lobe.ox, lobe.base + 8, cx + lobe.ox - lobeWidth * 0.72, lobe.base);
    ctx.bezierCurveTo(
      cx + lobe.ox - lobeWidth,
      lobe.base - 24,
      cx + lobe.ox - lobeWidth * 0.56,
      lobe.tip + 20,
      lobeTip,
      lobe.tip,
    );
    ctx.closePath();
    const body = ctx.createLinearGradient(0, lobe.tip, 0, lobe.base);
    body.addColorStop(0, `rgba(${lobe.hue},0)`);
    body.addColorStop(0.22, `rgba(${lobe.hue},${lobe.alpha * 0.52})`);
    body.addColorStop(0.62, `rgba(255,128,32,${lobe.alpha})`);
    body.addColorStop(1, `rgba(255,188,72,${lobe.alpha * 0.92})`);
    ctx.fillStyle = body;
    ctx.fill();
  }

  // Explosion-style shard edge: tiny hot flecks break up the silhouette so
  // repeated particles read as turbulent fire rather than cloned stickers.
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i += 1) {
    const t = (i + 1) / 6;
    const x = cx + Math.sin((i + 1) * 2.1 + variant.split * 4) * 16 * variant.width + variant.lean * 12 * t;
    const y = baseY - t * 58 * variant.height;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,238,146,0.34)" : "rgba(255,96,26,0.26)";
    ctx.beginPath();
    ctx.ellipse(x, y, 2.4 + variant.split * 1.4, 5.5 - t * 2.5, variant.lean * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

export function createBurjFireCoreCanvas(variantId: BurjFireCoreVariantId = "core-00"): HTMLCanvasElement | null {
  const variant = BURJ_FIRE_CORE_VARIANTS.find((item) => item.id === variantId) ?? BURJ_FIRE_CORE_VARIANTS[0];
  const w = 48;
  const h = 88;
  const cx = w / 2;
  const canvas = createCanvas(w, h);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;

  const core = ctx.createRadialGradient(cx, h * 0.82, 0, cx, h * 0.55, h * 0.48);
  core.addColorStop(0, "rgba(255,255,238,1)");
  core.addColorStop(0.28, "rgba(255,226,110,0.82)");
  core.addColorStop(0.68, "rgba(255,134,34,0.24)");
  core.addColorStop(1, "rgba(255,80,20,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  const tipX = cx + variant.lean * 16;
  ctx.moveTo(tipX - 1, 18);
  ctx.bezierCurveTo(
    cx + 4 * variant.width + variant.lean * 9,
    30,
    cx + 7 * variant.width,
    58 * variant.height,
    cx + 5 * variant.width,
    78,
  );
  ctx.quadraticCurveTo(cx, 84, cx - 6 * variant.width, 78);
  ctx.bezierCurveTo(
    cx - 8 * variant.width,
    56 * variant.height,
    cx - 4 * variant.width + variant.lean * 6,
    31,
    tipX - 1,
    18,
  );
  ctx.closePath();
  ctx.fill();

  return canvas;
}

export function createBurjFireEmberCanvas(variantId: BurjFireEmberVariantId = "ember-00"): HTMLCanvasElement | null {
  const variant = BURJ_FIRE_EMBER_VARIANTS.find((item) => item.id === variantId) ?? BURJ_FIRE_EMBER_VARIANTS[0];
  const size = 24;
  const c = size / 2;
  const canvas = createCanvas(size, size);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;

  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, "rgba(255,255,235,1)");
  glow.addColorStop(0.32, "rgba(255,180,80,0.88)");
  glow.addColorStop(0.7, "rgba(255,110,35,0.34)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(255,246,188,0.9)";
  ctx.strokeStyle = "rgba(255,144,50,0.72)";
  ctx.lineWidth = 2;
  if (variant.shape === "streak" || variant.shape === "needle") {
    ctx.beginPath();
    ctx.moveTo(7, 17);
    ctx.lineTo(variant.shape === "needle" ? 18 : 16, variant.shape === "needle" ? 4 : 7);
    ctx.stroke();
  } else if (variant.shape === "shard" || variant.shape === "fleck") {
    ctx.beginPath();
    ctx.moveTo(8, 7);
    ctx.lineTo(18, variant.shape === "fleck" ? 12 : 10);
    ctx.lineTo(10, 18);
    ctx.closePath();
    ctx.fill();
  } else if (variant.shape === "cluster") {
    for (const [x, y, r] of [
      [9, 10, 2.2],
      [14, 12, 1.8],
      [11, 16, 1.5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(c, c, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

export function createBurjSmokeParticleCanvas(): HTMLCanvasElement | null {
  const size = 96;
  const center = size / 2;
  const canvas = createCanvas(size, size);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;

  const puff = ctx.createRadialGradient(center, center, 0, center, center, center);
  // Softer ceiling and gentler interior so puffs layer translucently instead of
  // stacking as a wall. Threats remain visible through the smoke column.
  puff.addColorStop(0, "rgba(220,220,220,0.6)");
  puff.addColorStop(0.45, "rgba(140,140,142,0.3)");
  puff.addColorStop(0.78, "rgba(60,62,66,0.1)");
  puff.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = puff;
  ctx.fillRect(0, 0, size, size);

  return canvas;
}

export function collectBurjFireTextureCanvases(): BurjFireTextureCanvas[] {
  const textures: Array<Omit<BurjFireTextureCanvas, "canvas"> & { canvas: HTMLCanvasElement | null }> = [
    ...BURJ_FIRE_FLAME_VARIANTS.map((variant) => ({
      id: variant.id,
      label: variant.label,
      canvas: createBurjFireParticleCanvas(variant.id),
      note: "Pixi flame particle variant",
    })),
    ...BURJ_FIRE_CORE_VARIANTS.map((variant) => ({
      id: variant.id,
      label: variant.label,
      canvas: createBurjFireCoreCanvas(variant.id),
      note: "Pixi additive core variant",
    })),
    ...BURJ_FIRE_EMBER_VARIANTS.map((variant) => ({
      id: variant.id,
      label: variant.label,
      canvas: createBurjFireEmberCanvas(variant.id),
      note: "Pixi additive ember variant",
    })),
    {
      id: "smoke",
      label: "Burj fire smoke",
      canvas: createBurjSmokeParticleCanvas(),
      note: "Pixi particle texture",
    },
  ];

  return textures.filter((texture): texture is BurjFireTextureCanvas => texture.canvas !== null);
}
