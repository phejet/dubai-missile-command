export interface SmokeParticleAsset {
  id: string;
  label: string;
  src: string;
  width: number;
  height: number;
}

export const BURJ_SMOKE_PARTICLE_ASSETS = [
  {
    id: "blackSmoke00",
    label: "Black smoke 00",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke00.png", import.meta.url).href,
    width: 362,
    height: 336,
  },
  {
    id: "blackSmoke01",
    label: "Black smoke 01",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke01.png", import.meta.url).href,
    width: 398,
    height: 364,
  },
  {
    id: "blackSmoke02",
    label: "Black smoke 02",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke02.png", import.meta.url).href,
    width: 386,
    height: 342,
  },
  {
    id: "blackSmoke03",
    label: "Black smoke 03",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke03.png", import.meta.url).href,
    width: 351,
    height: 367,
  },
  {
    id: "blackSmoke04",
    label: "Black smoke 04",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke04.png", import.meta.url).href,
    width: 386,
    height: 364,
  },
  {
    id: "blackSmoke05",
    label: "Black smoke 05",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke05.png", import.meta.url).href,
    width: 377,
    height: 348,
  },
  {
    id: "blackSmoke06",
    label: "Black smoke 06",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke06.png", import.meta.url).href,
    width: 368,
    height: 407,
  },
  {
    id: "blackSmoke07",
    label: "Black smoke 07",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke07.png", import.meta.url).href,
    width: 395,
    height: 397,
  },
  {
    id: "blackSmoke08",
    label: "Black smoke 08",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke08.png", import.meta.url).href,
    width: 378,
    height: 415,
  },
  {
    id: "blackSmoke09",
    label: "Black smoke 09",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke09.png", import.meta.url).href,
    width: 338,
    height: 360,
  },
  {
    id: "blackSmoke10",
    label: "Black smoke 10",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke10.png", import.meta.url).href,
    width: 372,
    height: 370,
  },
  {
    id: "blackSmoke11",
    label: "Black smoke 11",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke11.png", import.meta.url).href,
    width: 393,
    height: 327,
  },
  {
    id: "blackSmoke12",
    label: "Black smoke 12",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke12.png", import.meta.url).href,
    width: 373,
    height: 364,
  },
  {
    id: "blackSmoke13",
    label: "Black smoke 13",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke13.png", import.meta.url).href,
    width: 371,
    height: 388,
  },
  {
    id: "blackSmoke14",
    label: "Black smoke 14",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke14.png", import.meta.url).href,
    width: 378,
    height: 404,
  },
  {
    id: "blackSmoke15",
    label: "Black smoke 15",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke15.png", import.meta.url).href,
    width: 378,
    height: 371,
  },
  {
    id: "blackSmoke16",
    label: "Black smoke 16",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke16.png", import.meta.url).href,
    width: 360,
    height: 371,
  },
  {
    id: "blackSmoke17",
    label: "Black smoke 17",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke17.png", import.meta.url).href,
    width: 350,
    height: 398,
  },
  {
    id: "blackSmoke18",
    label: "Black smoke 18",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke18.png", import.meta.url).href,
    width: 382,
    height: 359,
  },
  {
    id: "blackSmoke19",
    label: "Black smoke 19",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke19.png", import.meta.url).href,
    width: 356,
    height: 382,
  },
  {
    id: "blackSmoke20",
    label: "Black smoke 20",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke20.png", import.meta.url).href,
    width: 369,
    height: 350,
  },
  {
    id: "blackSmoke21",
    label: "Black smoke 21",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke21.png", import.meta.url).href,
    width: 386,
    height: 394,
  },
  {
    id: "blackSmoke22",
    label: "Black smoke 22",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke22.png", import.meta.url).href,
    width: 366,
    height: 385,
  },
  {
    id: "blackSmoke23",
    label: "Black smoke 23",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke23.png", import.meta.url).href,
    width: 367,
    height: 402,
  },
  {
    id: "blackSmoke24",
    label: "Black smoke 24",
    src: new URL("../smokeParticleAssets/PNG/Black smoke/blackSmoke24.png", import.meta.url).href,
    width: 393,
    height: 371,
  },
] as const satisfies readonly SmokeParticleAsset[];

export type BurjSmokeParticleVariantId = (typeof BURJ_SMOKE_PARTICLE_ASSETS)[number]["id"];

export const WHITE_SMOKE_PARTICLE_ASSETS = [
  {
    id: "whitePuff00",
    label: "White puff 00",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff00.png", import.meta.url).href,
    width: 381,
    height: 346,
  },
  {
    id: "whitePuff01",
    label: "White puff 01",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff01.png", import.meta.url).href,
    width: 345,
    height: 374,
  },
  {
    id: "whitePuff02",
    label: "White puff 02",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff02.png", import.meta.url).href,
    width: 382,
    height: 360,
  },
  {
    id: "whitePuff03",
    label: "White puff 03",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff03.png", import.meta.url).href,
    width: 353,
    height: 383,
  },
  {
    id: "whitePuff04",
    label: "White puff 04",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff04.png", import.meta.url).href,
    width: 375,
    height: 378,
  },
  {
    id: "whitePuff05",
    label: "White puff 05",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff05.png", import.meta.url).href,
    width: 337,
    height: 378,
  },
  {
    id: "whitePuff06",
    label: "White puff 06",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff06.png", import.meta.url).href,
    width: 400,
    height: 383,
  },
  {
    id: "whitePuff07",
    label: "White puff 07",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff07.png", import.meta.url).href,
    width: 367,
    height: 362,
  },
  {
    id: "whitePuff08",
    label: "White puff 08",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff08.png", import.meta.url).href,
    width: 419,
    height: 384,
  },
  {
    id: "whitePuff09",
    label: "White puff 09",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff09.png", import.meta.url).href,
    width: 368,
    height: 405,
  },
  {
    id: "whitePuff10",
    label: "White puff 10",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff10.png", import.meta.url).href,
    width: 349,
    height: 417,
  },
  {
    id: "whitePuff11",
    label: "White puff 11",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff11.png", import.meta.url).href,
    width: 406,
    height: 370,
  },
  {
    id: "whitePuff12",
    label: "White puff 12",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff12.png", import.meta.url).href,
    width: 348,
    height: 385,
  },
  {
    id: "whitePuff13",
    label: "White puff 13",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff13.png", import.meta.url).href,
    width: 367,
    height: 401,
  },
  {
    id: "whitePuff14",
    label: "White puff 14",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff14.png", import.meta.url).href,
    width: 392,
    height: 350,
  },
  {
    id: "whitePuff15",
    label: "White puff 15",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff15.png", import.meta.url).href,
    width: 394,
    height: 377,
  },
  {
    id: "whitePuff16",
    label: "White puff 16",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff16.png", import.meta.url).href,
    width: 361,
    height: 384,
  },
  {
    id: "whitePuff17",
    label: "White puff 17",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff17.png", import.meta.url).href,
    width: 385,
    height: 345,
  },
  {
    id: "whitePuff18",
    label: "White puff 18",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff18.png", import.meta.url).href,
    width: 360,
    height: 364,
  },
  {
    id: "whitePuff19",
    label: "White puff 19",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff19.png", import.meta.url).href,
    width: 377,
    height: 411,
  },
  {
    id: "whitePuff20",
    label: "White puff 20",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff20.png", import.meta.url).href,
    width: 379,
    height: 384,
  },
  {
    id: "whitePuff21",
    label: "White puff 21",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff21.png", import.meta.url).href,
    width: 371,
    height: 376,
  },
  {
    id: "whitePuff22",
    label: "White puff 22",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff22.png", import.meta.url).href,
    width: 361,
    height: 391,
  },
  {
    id: "whitePuff23",
    label: "White puff 23",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff23.png", import.meta.url).href,
    width: 381,
    height: 409,
  },
  {
    id: "whitePuff24",
    label: "White puff 24",
    src: new URL("../smokeParticleAssets/PNG/White puff/whitePuff24.png", import.meta.url).href,
    width: 370,
    height: 362,
  },
] as const satisfies readonly SmokeParticleAsset[];

export type WhiteSmokeParticleVariantId = (typeof WHITE_SMOKE_PARTICLE_ASSETS)[number]["id"];

export const EXPLOSION_PARTICLE_ASSETS = [
  {
    id: "explosion00",
    label: "Explosion 00",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion00.png", import.meta.url).href,
    width: 583,
    height: 536,
  },
  {
    id: "explosion01",
    label: "Explosion 01",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion01.png", import.meta.url).href,
    width: 634,
    height: 585,
  },
  {
    id: "explosion02",
    label: "Explosion 02",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion02.png", import.meta.url).href,
    width: 620,
    height: 526,
  },
  {
    id: "explosion03",
    label: "Explosion 03",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion03.png", import.meta.url).href,
    width: 574,
    height: 636,
  },
  {
    id: "explosion04",
    label: "Explosion 04",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion04.png", import.meta.url).href,
    width: 600,
    height: 618,
  },
  {
    id: "explosion05",
    label: "Explosion 05",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion05.png", import.meta.url).href,
    width: 572,
    height: 545,
  },
  {
    id: "explosion06",
    label: "Explosion 06",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion06.png", import.meta.url).href,
    width: 583,
    height: 590,
  },
  {
    id: "explosion07",
    label: "Explosion 07",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion07.png", import.meta.url).href,
    width: 634,
    height: 521,
  },
  {
    id: "explosion08",
    label: "Explosion 08",
    src: new URL("../smokeParticleAssets/PNG/Explosion/explosion08.png", import.meta.url).href,
    width: 603,
    height: 590,
  },
] as const satisfies readonly SmokeParticleAsset[];

export type ExplosionParticleVariantId = (typeof EXPLOSION_PARTICLE_ASSETS)[number]["id"];
export type SmokeParticleVariantId = BurjSmokeParticleVariantId | WhiteSmokeParticleVariantId;
export type TexturedParticleVariantId = SmokeParticleVariantId | ExplosionParticleVariantId;

export const SMOKE_PARTICLE_ASSETS = [...BURJ_SMOKE_PARTICLE_ASSETS, ...WHITE_SMOKE_PARTICLE_ASSETS] as const;
export const TEXTURED_PARTICLE_ASSETS = [...SMOKE_PARTICLE_ASSETS, ...EXPLOSION_PARTICLE_ASSETS] as const;

const BURJ_SMOKE_PARTICLE_ASSET_BY_ID = new Map<string, SmokeParticleAsset>(
  BURJ_SMOKE_PARTICLE_ASSETS.map((asset) => [asset.id, asset]),
);
const SMOKE_PARTICLE_ASSET_BY_ID = new Map<string, SmokeParticleAsset>(
  SMOKE_PARTICLE_ASSETS.map((asset) => [asset.id, asset]),
);
const TEXTURED_PARTICLE_ASSET_BY_ID = new Map<string, SmokeParticleAsset>(
  TEXTURED_PARTICLE_ASSETS.map((asset) => [asset.id, asset]),
);

export function getBurjSmokeParticleAsset(id: string | undefined): SmokeParticleAsset {
  return BURJ_SMOKE_PARTICLE_ASSET_BY_ID.get(id ?? "") ?? BURJ_SMOKE_PARTICLE_ASSETS[0];
}

export function getSmokeParticleAsset(id: string | undefined): SmokeParticleAsset {
  return SMOKE_PARTICLE_ASSET_BY_ID.get(id ?? "") ?? BURJ_SMOKE_PARTICLE_ASSETS[0];
}

export function getTexturedParticleAsset(id: string | undefined): SmokeParticleAsset {
  return TEXTURED_PARTICLE_ASSET_BY_ID.get(id ?? "") ?? BURJ_SMOKE_PARTICLE_ASSETS[0];
}

export function getBurjSmokeParticleVariantId(index: number): BurjSmokeParticleVariantId {
  const safeIndex = Math.abs(Math.trunc(index)) % BURJ_SMOKE_PARTICLE_ASSETS.length;
  return BURJ_SMOKE_PARTICLE_ASSETS[safeIndex].id;
}

export function getWhiteSmokeParticleVariantId(index: number): WhiteSmokeParticleVariantId {
  const safeIndex = Math.abs(Math.trunc(index)) % WHITE_SMOKE_PARTICLE_ASSETS.length;
  return WHITE_SMOKE_PARTICLE_ASSETS[safeIndex].id;
}

export function getExplosionParticleVariantId(index: number): ExplosionParticleVariantId {
  const safeIndex = Math.abs(Math.trunc(index)) % EXPLOSION_PARTICLE_ASSETS.length;
  return EXPLOSION_PARTICLE_ASSETS[safeIndex].id;
}

export function createSmokeParticleAssetCanvas(asset: SmokeParticleAsset): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = asset.width;
  canvas.height = asset.height;
  const image = new Image();
  image.onload = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.dispatchEvent(new Event("sprite-catalog-source-updated"));
  };
  image.src = asset.src;
  return canvas;
}
