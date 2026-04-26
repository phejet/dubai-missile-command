import { describe, expect, it, vi } from "vitest";
import { Container, Texture } from "pixi.js";
import { initGame } from "./game-sim";
import {
  PixiRenderer,
  __createPixiWaterSurfaceForTest,
  __updatePixiWaterSurfaceForTest,
  createBurjBeaconGlow,
  getPixiBurjBeaconLayout,
  getPixiWaterBandTransform,
  summarizePixiDynamicEntities,
} from "./pixi-render";

function projectileAsset() {
  return {
    staticSprite: Texture.EMPTY,
    animFrames: [Texture.EMPTY],
    offset: { x: -2, y: -3 },
    frameCount: 1,
    period: 1,
    resolutionScale: 1,
    scale: 1,
  };
}

function staticAsset() {
  return {
    sprite: Texture.EMPTY,
    offset: { x: -4, y: -5 },
    width: 8,
    height: 10,
    resolutionScale: 1,
    scale: 1,
  };
}

function dynamicState() {
  const threat = projectileAsset();
  const interceptor = projectileAsset();
  const upgrade = projectileAsset();
  const effect = staticAsset();
  return {
    threatAssets: {
      missile: threat,
      mirv: threat,
      mirv_warhead: threat,
      bomb: threat,
      stack_carrier_2: threat,
      stack_carrier_3: threat,
      stack_child: threat,
      shahed136: threat,
      shahed238: threat,
    },
    interceptorAssets: {
      playerInterceptor: interceptor,
      f15Interceptor: interceptor,
    },
    upgradeProjectileAssets: {
      wildHornet: upgrade,
      roadrunner: upgrade,
      patriotSam: upgrade,
    },
    planeAssets: {
      f15Airframe: staticAsset(),
    },
    effectAssets: {
      explosion: {
        light: effect,
        splash: effect,
        fireball: effect,
        core: effect,
        ring: effect,
      },
      emp: {
        wash: effect,
        ring: effect,
      },
      laserBeam: effect,
      phalanxBullet: effect,
    },
    missiles: new Map(),
    drones: new Map(),
    interceptors: new Map(),
    hornets: new Map(),
    roadrunners: new Map(),
    patriotMissiles: new Map(),
    planes: new Map(),
    flares: new Map(),
    explosions: new Map(),
    empRingPool: [],
    laserPool: [],
    phalanxPool: [],
    particlePool: [],
  };
}

function rendererInternals() {
  const methods = PixiRenderer.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  return {
    methods,
    self: {
      gameplayProjectileLayer: new Container(),
      gameplayEffectsLayer: new Container(),
      gameplayParticleLayer: new Container(),
    },
  };
}

describe("summarizePixiDynamicEntities", () => {
  it("reports representative dynamic entity counts and positions", () => {
    const game = initGame();

    game.missiles.push({
      x: 100,
      y: 120,
      vx: 1,
      vy: 2,
      accel: 0,
      trail: [{ x: 90, y: 110 }],
      alive: true,
      type: "missile",
    });
    game.drones.push({
      x: 140,
      y: 160,
      vx: -1,
      vy: 0.5,
      trail: [{ x: 150, y: 155 }],
      wobble: 0,
      alive: true,
      type: "drone",
      subtype: "shahed136",
      health: 1,
      collisionRadius: 10,
    });
    game.interceptors.push({
      x: 180,
      y: 200,
      vx: 0,
      vy: -1,
      targetX: 180,
      targetY: 60,
      trail: [{ x: 180, y: 210 }],
      alive: true,
    });
    game.hornets.push({
      x: 220,
      y: 240,
      targetRef: null,
      speed: 1,
      trail: [{ x: 210, y: 250 }],
      alive: true,
      blastRadius: 20,
      wobble: 0,
      life: 10,
    });
    game.roadrunners.push({
      x: 260,
      y: 280,
      heading: 0,
      speed: 1,
      targetRef: null,
      phase: "track",
      blastRadius: 20,
      trail: [{ x: 260, y: 300 }],
      alive: true,
      life: 10,
    });
    game.patriotMissiles.push({
      x: 300,
      y: 320,
      speed: 1,
      targetRef: null,
      blastRadius: 30,
      trail: [{ x: 300, y: 340 }],
      alive: true,
      life: 10,
    });
    game.planes.push(
      { x: 340, y: 360, vx: 1, vy: 0, blinkTimer: 0, alive: true, fireTimer: 0, fireInterval: 30, evadeTimer: 0 },
      { x: 1, y: 1, vx: 1, vy: 0, blinkTimer: 0, alive: false, fireTimer: 0, fireInterval: 30, evadeTimer: 0 },
    );
    game.flares.push(
      {
        id: 1,
        x: 380,
        y: 400,
        vx: 0,
        vy: -1,
        anchorX: 380,
        drag: 0,
        life: 12,
        maxLife: 30,
        alive: true,
        luresLeft: 1,
        hotRadius: 100,
        trail: [{ x: 380, y: 410 }],
      },
      {
        id: 2,
        x: 1,
        y: 1,
        vx: 0,
        vy: -1,
        anchorX: 1,
        drag: 0,
        life: 0,
        maxLife: 30,
        alive: false,
        luresLeft: 0,
        hotRadius: 100,
        trail: [],
      },
    );
    game.explosions.push({
      id: 1,
      x: 420,
      y: 440,
      radius: 10,
      maxRadius: 30,
      growing: true,
      alpha: 1,
      color: "#ffaa44",
      playerCaused: true,
      harmless: false,
      chain: false,
      rootExplosionId: null,
      ringRadius: 12,
      ringAlpha: 1,
    });
    game.particles.push({
      x: 460,
      y: 480,
      vx: 1,
      vy: 1,
      life: 10,
      maxLife: 20,
      color: "#ffcc00",
      size: 3,
    });
    game.phalanxBullets.push(
      { x: 500, y: 520, cx: 505, cy: 515, alive: true, life: 5 },
      { x: 1, y: 1, alive: true, life: 5 },
    );
    game.laserBeams.push(
      { x1: 540, y1: 560, x2: 580, y2: 590, targetRef: null, life: 3, maxLife: 5 },
      { x1: 1, y1: 1, targetRef: null },
    );

    const snapshot = summarizePixiDynamicEntities(game);

    expect(snapshot.counts).toMatchObject({
      missiles: 1,
      drones: 1,
      interceptors: 1,
      hornets: 1,
      roadrunners: 1,
      patriotMissiles: 1,
      planes: 1,
      flares: 1,
      explosions: 1,
      empRings: 0,
      particles: 1,
      phalanxBullets: 1,
      laserBeams: 1,
    });
    expect(snapshot.firstPositions).toMatchObject({
      missile: { x: 100, y: 120 },
      drone: { x: 140, y: 160 },
      interceptor: { x: 180, y: 200 },
      hornet: { x: 220, y: 240 },
      roadrunner: { x: 260, y: 280 },
      patriotMissile: { x: 300, y: 320 },
      plane: { x: 340, y: 360 },
      flare: { x: 380, y: 400 },
    });
    expect(snapshot.summary).toContain("missiles:1");
    expect(snapshot.summary).toContain("laserBeams:1");
  });
});

describe("createBurjBeaconGlow", () => {
  it("anchors pulse scaling at the beacon position instead of world origin", () => {
    const glow = createBurjBeaconGlow(460, 698);

    glow.scale.set(1.3);

    expect(glow.position).toMatchObject({ x: 460, y: 698 });
    expect(glow.alpha).toBe(0);
  });
});

describe("getPixiBurjBeaconLayout", () => {
  it("matches the Canvas anchor-scaled beacon position", () => {
    const towerBaseY = 1424;

    const layout = getPixiBurjBeaconLayout(towerBaseY, 2);

    expect(layout).toMatchObject({
      stemX: 458.6,
      stemY: 644,
      stemWidth: 2.8,
      stemHeight: 20,
      glowX: 460,
      glowY: 652,
    });
  });
});

describe("Pixi water distortion", () => {
  it("animates horizontal band distortion without vertical sprite scrolling", () => {
    const surface = __createPixiWaterSurfaceForTest(Texture.WHITE, 120, 36);

    const startY = surface.bands.map((band) => band.sprite.position.y);
    const startX = surface.bands.map((band) => band.sprite.position.x);
    __updatePixiWaterSurfaceForTest(surface, 4, 0.9);
    const afterY = surface.bands.map((band) => band.sprite.position.y);
    const afterX = surface.bands.map((band) => band.sprite.position.x);

    expect(afterY).toEqual(startY);
    expect(afterX.some((x, index) => Math.abs(x - startX[index]) > 0.01)).toBe(true);
  });

  it("keeps the water transform horizontal-only", () => {
    const transform = getPixiWaterBandTransform(3.5, 4);

    expect(transform.wave).not.toBe(0);
    expect(transform.stretch).toBeGreaterThan(0.98);
    expect(transform.stretch).toBeLessThan(1.02);
    expect(transform).not.toHaveProperty("y");
  });
});

describe("PixiRenderer dynamic entity updates", () => {
  it("mutates pooled scene nodes from GameState and cleans removed entities", () => {
    const game = initGame();
    const missile = {
      x: 100,
      y: 120,
      vx: 1,
      vy: 2,
      accel: 0,
      trail: [{ x: 90, y: 110 }],
      alive: true,
      type: "missile" as const,
    };
    const drone = {
      x: 140,
      y: 160,
      vx: -1,
      vy: 0.5,
      trail: [{ x: 150, y: 155 }],
      wobble: 0,
      alive: true,
      type: "drone" as const,
      subtype: "shahed136" as const,
      health: 1,
      collisionRadius: 10,
    };
    const interceptor = {
      x: 180,
      y: 200,
      vx: 0,
      vy: -1,
      targetX: 180,
      targetY: 60,
      trail: [{ x: 180, y: 210 }],
      alive: true,
    };
    const hornet = {
      x: 220,
      y: 240,
      targetRef: null,
      speed: 1,
      trail: [{ x: 210, y: 250 }],
      alive: true,
      blastRadius: 20,
      wobble: 0,
      life: 10,
    };
    const roadrunner = {
      x: 260,
      y: 280,
      heading: 0,
      speed: 1,
      targetRef: null,
      phase: "track" as const,
      blastRadius: 20,
      trail: [{ x: 260, y: 300 }],
      alive: true,
      life: 10,
    };
    const patriot = {
      x: 300,
      y: 320,
      speed: 1,
      targetRef: null,
      blastRadius: 30,
      trail: [{ x: 300, y: 340 }],
      alive: true,
      life: 10,
    };
    const plane = {
      x: 340,
      y: 360,
      vx: 1,
      vy: 0,
      blinkTimer: 10,
      alive: true,
      fireTimer: 0,
      fireInterval: 30,
      evadeTimer: 0,
    };
    const flare = {
      id: 1,
      x: 380,
      y: 400,
      vx: 0,
      vy: -1,
      anchorX: 380,
      drag: 0,
      life: 12,
      maxLife: 30,
      alive: true,
      luresLeft: 1,
      hotRadius: 100,
      trail: [{ x: 380, y: 410 }],
    };

    game.missiles.push(missile);
    game.drones.push(drone);
    game.interceptors.push(interceptor);
    game.hornets.push(hornet);
    game.roadrunners.push(roadrunner);
    game.patriotMissiles.push(patriot);
    game.planes.push(plane);
    game.flares.push(flare);
    game.explosions.push({
      id: 1,
      x: 420,
      y: 440,
      radius: 10,
      maxRadius: 30,
      growing: true,
      alpha: 1,
      color: "#ffaa44",
      playerCaused: true,
      harmless: false,
      chain: false,
      rootExplosionId: null,
      ringRadius: 12,
      ringAlpha: 1,
    });
    game.empRings.push({
      x: 430,
      y: 450,
      radius: 30,
      maxRadius: 100,
      alpha: 0.7,
      alive: true,
    });
    game.particles.push({
      x: 460,
      y: 480,
      vx: 1,
      vy: 1,
      life: 10,
      maxLife: 20,
      color: "#ffcc00",
      size: 3,
    });
    game.phalanxBullets.push({ x: 500, y: 520, cx: 505, cy: 515, alive: true, life: 5 });
    game.laserBeams.push({ x1: 540, y1: 560, x2: 580, y2: 590, targetRef: null, life: 3, maxLife: 5 });

    const state = dynamicState();
    const { methods, self } = rendererInternals();

    methods.updateGameplayFlares.call(self, state, game, 1);
    methods.updateGameplayPlanes.call(self, state, game, 1);
    methods.updateGameplayLasers.call(self, state, game);
    methods.updateGameplayEmpRings.call(self, state, game);
    methods.updateGameplayPhalanxBullets.call(self, state, game);
    methods.updateGameplayMissiles.call(self, state, game, 1);
    methods.updateGameplayDrones.call(self, state, game, 1);
    methods.updateGameplayInterceptors.call(self, state, game, 1);
    methods.updateGameplayUpgradeProjectiles.call(self, state, game, 1);
    methods.updateGameplayExplosions.call(self, state, game);
    methods.updateGameplayParticles.call(self, state, game);

    expect(state.missiles.size).toBe(1);
    expect(state.drones.size).toBe(1);
    expect(state.interceptors.size).toBe(1);
    expect(state.hornets.size).toBe(1);
    expect(state.roadrunners.size).toBe(1);
    expect(state.patriotMissiles.size).toBe(1);
    expect(state.planes.size).toBe(1);
    expect(state.flares.size).toBe(1);
    expect(state.explosions.size).toBe(1);
    expect((state.empRingPool as Array<{ container: Container }>)[0].container.visible).toBe(true);
    expect(self.gameplayProjectileLayer.children.length).toBe(6);
    expect(self.gameplayEffectsLayer.children.length).toBe(4);
    expect(self.gameplayParticleLayer.children.length).toBe(3);
    expect(state.missiles.get(missile)!.spriteRoot.position).toMatchObject({ x: 100, y: 120 });
    expect(state.planes.get(plane)!.container.position).toMatchObject({ x: 340, y: 360 });
    expect(state.flares.get(flare)!.glow.visible).toBe(true);

    game.missiles.length = 0;
    methods.updateGameplayMissiles.call(self, state, game, 2);
    expect(state.missiles.size).toBe(0);
    expect(self.gameplayProjectileLayer.children.length).toBe(5);
  });

  it("interpolates from previous snapshots without mutating GameState", () => {
    const game = initGame();
    const missile = {
      x: 110,
      y: 220,
      _px: 10,
      _py: 20,
      vx: 1,
      vy: 0,
      accel: 0,
      trail: [{ x: 10, y: 20 }],
      alive: true,
      type: "missile" as const,
    };
    game.missiles.push(missile);
    game.phalanxBullets.push({
      x: 500,
      y: 520,
      cx: 700,
      cy: 620,
      _pcx: 600,
      _pcy: 540,
      alive: true,
      life: 5,
    });

    const state = dynamicState();
    const { methods, self } = rendererInternals();

    methods.updateGameplayMissiles.call(self, state, game, 1, 0.25);
    methods.updateGameplayPhalanxBullets.call(self, state, game, 0.5);

    expect(state.missiles.get(missile)!.spriteRoot.position).toMatchObject({ x: 35, y: 70 });
    expect(game.missiles[0]).toMatchObject({ x: 110, y: 220 });
    expect(game.phalanxBullets[0]).toMatchObject({ cx: 700, cy: 620 });
    expect((state.phalanxPool as Array<{ width: number }>)[0].width).toBeCloseTo(Math.hypot(150, 60) + 16);
  });
});

describe("PixiRenderer WebGL context resilience", () => {
  it("marks rendering paused and prevents default browser context-loss handling", () => {
    const { methods } = rendererInternals();
    const preventDefault = vi.fn();
    const self = {
      destroyed: false,
      contextLost: false,
      canvas: { dataset: {} },
    };

    methods.handleWebGlContextLost.call(self, { preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(self.contextLost).toBe(true);
    expect(self.canvas.dataset).toMatchObject({ pixiContext: "lost" });
    expect(methods.isRenderPaused.call(self)).toBe(true);
  });

  it("reuploads baked textures, rebuilds scenes, and resumes after context restore", () => {
    const { methods } = rendererInternals();
    const self = {
      destroyed: false,
      contextLost: true,
      initialized: true,
      initError: null,
      canvas: { dataset: {} },
      textures: { reupload: vi.fn() },
      rebuildScenesAfterContextRestore: vi.fn(),
      renderIfReady: vi.fn(),
    };

    methods.handleWebGlContextRestored.call(self);

    expect(self.contextLost).toBe(false);
    expect(self.textures.reupload).toHaveBeenCalledOnce();
    expect(self.rebuildScenesAfterContextRestore).toHaveBeenCalledOnce();
    expect(self.renderIfReady).toHaveBeenCalledOnce();
    expect(self.canvas.dataset).toMatchObject({ pixiContext: "active" });
  });
});

describe("PixiRenderer game-over routing", () => {
  it("switches to a dedicated game-over scene and hides live gameplay layers", () => {
    const { methods } = rendererInternals();
    let rendered = false;
    const self = {
      initialized: true,
      destroyed: false,
      initError: null,
      titleState: {},
      gameplayState: {},
      gameOverState: {},
      screen: "gameover",
      canvas: { dataset: {} as Record<string, string> },
      titleScene: new Container(),
      gameplayScene: new Container(),
      gameOverScene: new Container(),
      latestGame: null,
      app: { render: () => (rendered = true) },
      updateTitleScene: () => undefined,
      updateGameplayScene: () => undefined,
    };

    methods.renderIfReady.call(self);

    expect(rendered).toBe(true);
    expect(self.canvas.dataset.pixiScreen).toBe("gameover");
    expect(self.titleScene.visible).toBe(false);
    expect(self.gameplayScene.visible).toBe(false);
    expect(self.gameOverScene.visible).toBe(true);
  });

  it("clears live game state when renderGameOver is requested", () => {
    const { methods } = rendererInternals();
    let renderCalls = 0;
    const self = {
      screen: "playing",
      latestGame: initGame(),
      latestShowShop: true,
      renderIfReady: () => {
        renderCalls += 1;
      },
    };

    methods.renderGameOver.call(self, {
      score: 1200,
      wave: 3,
      stats: { missileKills: 4, droneKills: 2, shotsFired: 9 },
    });

    expect(self.screen).toBe("gameover");
    expect(self.latestGame).toBeNull();
    expect(self.latestShowShop).toBe(false);
    expect(renderCalls).toBe(1);
  });

  it("does not call Pixi Application.destroy before initialization completes", () => {
    const { methods } = rendererInternals();
    const destroyApp = vi.fn();
    const self = {
      initialized: false,
      destroyed: false,
      latestGame: initGame(),
      canvas: {
        dataset: {} as Record<string, string>,
        removeEventListener: vi.fn(),
      },
      destroyApp,
    };

    methods.destroy.call(self);

    expect(self.destroyed).toBe(true);
    expect(self.latestGame).toBeNull();
    expect(self.canvas.dataset.pixiTitle).toBe("destroyed");
    expect(destroyApp).not.toHaveBeenCalled();
  });
});
