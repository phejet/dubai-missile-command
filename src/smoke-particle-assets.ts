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

const BURJ_SMOKE_PARTICLE_ASSET_BY_ID = new Map<string, SmokeParticleAsset>(
  BURJ_SMOKE_PARTICLE_ASSETS.map((asset) => [asset.id, asset]),
);

export function getBurjSmokeParticleAsset(id: string | undefined): SmokeParticleAsset {
  return BURJ_SMOKE_PARTICLE_ASSET_BY_ID.get(id ?? "") ?? BURJ_SMOKE_PARTICLE_ASSETS[0];
}

export function getBurjSmokeParticleVariantId(index: number): BurjSmokeParticleVariantId {
  const safeIndex = Math.abs(Math.trunc(index)) % BURJ_SMOKE_PARTICLE_ASSETS.length;
  return BURJ_SMOKE_PARTICLE_ASSETS[safeIndex].id;
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
