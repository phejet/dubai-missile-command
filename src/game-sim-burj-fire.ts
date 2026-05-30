import { BURJ_MAX_HEALTH, BURJ_X, GAMEPLAY_SCENIC_BASE_Y, MAX_PARTICLES, ov, rand } from "./game-logic.js";
import { getBurjDamageFireLayout } from "./art-render.js";
import { getBurjFireEmberVariantId, getBurjFireFlameVariantId } from "./burj-fire-textures.js";
import { getBurjSmokeParticleVariantId } from "./smoke-particle-assets.js";
import type { GameState } from "./types.js";

const BURJ_FIRE_TOWER_BASE_Y = GAMEPLAY_SCENIC_BASE_Y;

function pickBurjParticleVariantIndex(x: number, y: number, life: number, size: number, salt = 0): number {
  const value = Math.sin(x * 0.173 + y * 0.097 + life * 0.231 + size * 0.419 + salt * 2.113) * 10000;
  return Math.floor(Math.abs(value));
}

function pickBurjSmokeParticleVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjSmokeParticleVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

function pickBurjFireFlameVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjFireFlameVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

function pickBurjFireEmberVariant(x: number, y: number, life: number, size: number, salt = 0): string {
  return getBurjFireEmberVariantId(pickBurjParticleVariantIndex(x, y, life, size, salt));
}

export function updateBurjFireParticles(g: GameState, dt: number): void {
  if (!g.burjAlive) return;
  const rawHealth = Math.max(0, Math.min(BURJ_MAX_HEALTH, Math.round(g.burjHealth)));
  const layout = getBurjDamageFireLayout(BURJ_FIRE_TOWER_BASE_Y, rawHealth, {
    maxHealth: BURJ_MAX_HEALTH,
    gameSeed: g._gameSeed ?? 0,
  });
  if (layout.fireSites.length === 0 || layout.tier === "pristine") return;

  const damageRatio = layout.lostCount / BURJ_MAX_HEALTH;
  const tierMul =
    layout.tier === "critical" ? 1.7 : layout.tier === "burning" ? 1.15 + damageRatio * 0.4 : 0.45 + damageRatio * 0.36;
  const tierSizeMul = layout.tier === "critical" ? 1.12 : layout.tier === "burning" ? 0.96 : 0.68;
  const smokeDamageMul = ov("burjFire.smokeDamageMul", 2.4);
  const flameRate = Math.min(8.5, ov("burjFire.flameRate", 0.9) * tierMul);
  const emberRate = Math.min(8.2, ov("burjFire.emberRate", 1.25) * (0.78 + tierMul * 0.7));
  const smokeRate = Math.min(
    2.2,
    ov("burjFire.smokeRate", 0.75) * (0.4 + tierMul * 0.55 + damageRatio * smokeDamageMul * 0.16),
  );
  const flameLife = ov("burjFire.flameLife", 51);
  const emberLife = ov("burjFire.emberLife", 100);
  const smokeLife = ov("burjFire.smokeLife", 155);
  const smokeRise = ov("burjFire.smokeRise", 1.35);
  const smokeDrift = ov("burjFire.smokeDrift", 0.44);
  const flameSize = ov("burjFire.flameSize", 7.5);
  const smokeSize = ov("burjFire.smokeSize", 7.5);
  const emberSize = ov("burjFire.emberSize", 2.5);
  const hotspotSpread = ov("burjFire.hotspotSpread", 0.62);
  const smokeRiseDamageBoost = ov("burjFire.smokeRiseDamageBoost", 0.5);
  const smokeBase = ov("burjFire.smokeBase", 0.35);
  const smokeYOffset = ov("burjFire.smokeYOffset", 17);
  const hitFlashFlameMul = ov("burjFire.hitFlashFlameMul", 3.4);
  const hitFlashSmokeMul = ov("burjFire.hitFlashSmokeMul", 2.4);
  const ignite = g.burjHitFlashMax > 0 ? Math.max(0, Math.min(1, g.burjHitFlashTimer / g.burjHitFlashMax)) : 0;
  const flameKick = 1 + ignite * Math.max(0, hitFlashFlameMul - 1);
  const smokeKick = 1 + ignite * Math.max(0, hitFlashSmokeMul - 1);
  const flameSizeKick = 1 + ignite * 0.5;
  const totalFlameAnchors = Math.max(
    1,
    layout.fireSites.reduce((sum, site) => sum + site.flameAnchors.length, 0),
  );
  const totalSmokeSites = Math.max(1, layout.fireSites.length);

  for (const site of layout.fireSites) {
    const band = site.band;
    const halfW = Math.max(4, band.halfW);

    for (const anchor of site.flameAnchors) {
      const anchorT = Math.max(0, Math.min(1, 0.5 + (anchor.x - BURJ_X) / Math.max(1, halfW * 1.6)));
      const anchorSizeMul = 0.78 + 0.22 * Math.sin(anchor.seed);
      spawnPoisson(g, (flameRate * dt * flameKick) / totalFlameAnchors, () => {
        const lean = (anchorT - 0.5) * 0.28 + rand(-0.12, 0.12);
        const x = anchor.x + rand(-halfW * hotspotSpread * 0.2, halfW * hotspotSpread * 0.2);
        const y = anchor.y + rand(-band.h * 0.1, band.h * 1.25);
        const life = rand(flameLife * 0.65, flameLife);
        const size = rand(flameSize * 0.78, flameSize * 1.45) * anchorSizeMul * tierSizeMul * flameSizeKick;
        g.particles.push({
          x,
          y,
          vx: rand(-0.16, 0.16) + (anchorT - 0.5) * 0.05,
          vy: -rand(0.52, 1.08),
          life,
          maxLife: flameLife,
          color: layout.tier === "wounded" ? "#ff7a24" : "#ff8f32",
          size,
          type: "fireFlame",
          textureVariant: pickBurjFireFlameVariant(x, y, life, size, anchor.seed),
          angle: lean,
          spin: rand(-0.018, 0.018),
          gravity: 0,
          drag: 0.955,
        });
      });

      spawnPoisson(g, (emberRate * dt * flameKick) / totalFlameAnchors, () => {
        const ang = rand(-Math.PI * 0.75, -Math.PI * 0.25);
        const sp = rand(0.55, layout.tier === "critical" ? 2.1 : 1.55);
        const x = anchor.x + rand(-halfW * 0.18, halfW * 0.18);
        const y = anchor.y + rand(-band.h * 0.2, band.h * 0.95);
        const life = rand(emberLife * 0.55, emberLife);
        const size = rand(emberSize * 0.7, emberSize * 1.3);
        g.particles.push({
          x,
          y,
          vx: Math.cos(ang) * sp * 0.6,
          vy: Math.sin(ang) * sp,
          life,
          maxLife: emberLife,
          color: layout.tier === "wounded" ? "#ff9d48" : "#ffc06a",
          size,
          type: "fireEmber",
          textureVariant: pickBurjFireEmberVariant(x, y, life, size, anchor.seed),
          angle: ang + Math.PI / 2,
          spin: rand(-0.09, 0.09),
          gravity: 0.012,
          drag: 0.965,
        });
      });
    }

    const smokeAnchor = site.smokeAnchor;
    const smokeVyBoost = 1 + damageRatio * smokeRiseDamageBoost;
    const narrowSmokeW = halfW * 0.2;
    spawnPoisson(g, (smokeRate * dt * smokeKick * smokeBase) / totalSmokeSites, () => {
      const x = smokeAnchor.x + rand(-narrowSmokeW, narrowSmokeW);
      const y = smokeAnchor.y + smokeYOffset + rand(-4, 5);
      const life = rand(smokeLife * 0.7, smokeLife);
      const size = rand(smokeSize, smokeSize * 1.55);
      g.particles.push({
        x,
        y,
        vx: 0.035 + rand(smokeDrift * 0.35, smokeDrift),
        vy: -rand(smokeRise * 0.6, smokeRise) * smokeVyBoost,
        life,
        maxLife: smokeLife,
        color: layout.tier === "critical" ? "#8f969a" : layout.tier === "burning" ? "#9da1a3" : "#aeb0ae",
        size,
        type: "fireSmoke",
        textureVariant: pickBurjSmokeParticleVariant(x, y, life, size),
        angle: rand(-Math.PI, Math.PI),
        gravity: -0.004,
        drag: 0.992,
      });
    });

    spawnPoisson(g, (smokeRate * dt * smokeKick * 0.28) / totalSmokeSites, () => {
      const x = smokeAnchor.x + rand(-narrowSmokeW * 0.7, narrowSmokeW * 0.7);
      const y = smokeAnchor.y + smokeYOffset + rand(-2, 6);
      const life = rand(smokeLife * 0.18, smokeLife * 0.34);
      const size = rand(smokeSize * 0.7, smokeSize * 1.05);
      g.particles.push({
        x,
        y,
        vx: rand(smokeDrift * 0.12, smokeDrift * 0.45),
        vy: -rand(smokeRise * 0.35, smokeRise * 0.65) * smokeVyBoost,
        life,
        maxLife: smokeLife * 0.34,
        color: "#6c6260",
        size,
        type: "fireSmoke",
        textureVariant: pickBurjSmokeParticleVariant(x, y, life, size, 1),
        angle: rand(-Math.PI, Math.PI),
        gravity: -0.003,
        drag: 0.99,
      });
    });
  }
}

function spawnPoisson(g: GameState, expected: number, spawn: () => void): void {
  if (g.particles.length >= MAX_PARTICLES) return;
  let count = Math.floor(expected);
  if (rand(0, 1) < expected - count) count += 1;
  for (let i = 0; i < count; i += 1) {
    if (g.particles.length >= MAX_PARTICLES) return;
    spawn();
  }
}
