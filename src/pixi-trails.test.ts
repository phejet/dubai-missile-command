import { describe, expect, it } from "vitest";
import { TrailBatch } from "./pixi-trails";

const STYLE = {
  outerColor: 0xff8c3a,
  coreColor: 0xeee4d8,
  headColor: 0xffd694,
  width: 4,
  coreWidth: 1.6,
  headRadius: 1.7,
};

describe("TrailBatch geometry", () => {
  it("emits no geometry for empty trail", () => {
    const batch = new TrailBatch();
    batch.beginFrame();
    batch.addTrail([], Number.NaN, Number.NaN, STYLE);
    const snap = batch.__debugSnapshot();
    expect(snap.vertCount).toBe(0);
    expect(snap.indexCount).toBe(0);
    batch.destroy();
  });

  it("emits a strip per stroke and two head fans for a multi-point trail", () => {
    const batch = new TrailBatch();
    batch.beginFrame();
    const trail = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    batch.addTrail(trail, 30, 0, STYLE);
    const { vertCount, indexCount } = batch.__debugSnapshot();
    // 4 points (3 trail + 1 head) → 2 strips × 8 verts = 16
    // 2 head fans × (1 center + 12 perimeter) = 26
    expect(vertCount).toBe(16 + 26);
    // 2 strips × 3 quads × 6 indices = 36
    // 2 fans × 12 triangles × 3 indices = 72
    expect(indexCount).toBe(36 + 72);
    batch.destroy();
  });

  it("clamps to TRAIL_MAX_POINTS=20 by skipping the oldest points", () => {
    const batch = new TrailBatch();
    batch.beginFrame();
    const trail = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0 }));
    batch.addTrail(trail, 31, 0, STYLE);
    const { vertCount, positions } = batch.__debugSnapshot();
    // 20 points used → 2 strips × 40 = 80 strip verts + 26 fan verts = 106
    expect(vertCount).toBe(80 + 26);
    // First strip vertex should be at the 11th trail point (x=11), not x=0.
    expect(positions[0]).toBe(11);
    batch.destroy();
  });

  it("fades alpha along the strip — oldest=0, newest=full premultiplied", () => {
    const batch = new TrailBatch();
    batch.beginFrame();
    batch.addTrail(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      20,
      0,
      { ...STYLE, outerColor: 0xff0000 },
    );
    const { positions } = batch.__debugSnapshot();
    const stride = 6;
    // Outer stroke vertices: usedCount = 3 (2 trail + head). Pairs at i=0/1/2.
    // i=0 → fade=0 → premultiplied red 0, alpha 0.
    expect(positions[2]).toBe(0);
    expect(positions[5]).toBe(0);
    // i=2 (vertex index 4 in pair-pair-pair layout) → fade=1, base alpha 0.24.
    const headVertOffset = 4 * stride;
    expect(positions[headVertOffset + 2]).toBeCloseTo(0.24, 5);
    expect(positions[headVertOffset + 3]).toBe(0);
    expect(positions[headVertOffset + 4]).toBe(0);
    expect(positions[headVertOffset + 5]).toBeCloseTo(0.24, 5);
    batch.destroy();
  });

  it("resets cursors on beginFrame", () => {
    const batch = new TrailBatch();
    batch.beginFrame();
    batch.addTrail(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      20,
      0,
      STYLE,
    );
    const first = batch.__debugSnapshot().vertCount;
    expect(first).toBeGreaterThan(0);
    batch.beginFrame();
    expect(batch.__debugSnapshot().vertCount).toBe(0);
    batch.destroy();
  });
});
