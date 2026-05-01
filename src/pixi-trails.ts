import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Shader, Texture, type Topology } from "pixi.js";
import type { TrailPoint } from "./types";

const FLOATS_PER_VERTEX = 6; // x, y, r, g, b, a (rgb premultiplied)
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4;
const INDEX_BYTES = 2;

const HEAD_FAN_SEGMENTS = 12;
const TRAIL_MAX_POINTS = 20;

const INITIAL_VERTEX_CAPACITY = 8192;
const INITIAL_INDEX_CAPACITY = INITIAL_VERTEX_CAPACITY * 2;

const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec4 aColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;

out vec4 vColor;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = aColor * uWorldColorAlpha * uColor;
}
`;

const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
void main(void) {
  finalColor = vColor * texture(uTexture, vec2(0.0));
}
`;

interface TrailStyle {
  outerColor: number;
  coreColor: number;
  headColor: number;
  width: number;
  coreWidth: number;
  headRadius: number;
  alpha?: number;
}

const HEAD_GLOW_RADIUS_MULT = 2.6;
const HEAD_GLOW_ALPHA = 0.16;
const HEAD_CORE_ALPHA = 0.76;
const OUTER_STROKE_ALPHA = 0.24;
const CORE_STROKE_ALPHA = 0.52;

export class TrailBatch {
  private positions: Float32Array;
  private indices: Uint16Array;
  private vertexBuffer: Buffer;
  private indexBuffer: Buffer;
  private geometry: Geometry;
  private mesh: Mesh<Geometry> | null = null;

  private vertCursor = 0;
  private indexCursor = 0;
  private prevIndexCursor = 0;
  private vertexCapacity = INITIAL_VERTEX_CAPACITY;
  private indexCapacity = INITIAL_INDEX_CAPACITY;

  constructor() {
    this.positions = new Float32Array(this.vertexCapacity * FLOATS_PER_VERTEX);
    this.indices = new Uint16Array(this.indexCapacity);

    this.vertexBuffer = new Buffer({
      data: this.positions,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
      label: "trail-batch-vertex",
    });
    this.indexBuffer = new Buffer({
      data: this.indices,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
      label: "trail-batch-index",
    });

    this.geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: this.vertexBuffer,
          format: "float32x2",
          stride: BYTES_PER_VERTEX,
          offset: 0,
        },
        aColor: {
          buffer: this.vertexBuffer,
          format: "float32x4",
          stride: BYTES_PER_VERTEX,
          offset: 8,
        },
      },
      indexBuffer: this.indexBuffer,
      topology: "triangle-list" as Topology,
    });
  }

  get displayObject(): Mesh<Geometry> {
    if (this.mesh) return this.mesh;
    const glProgram = GlProgram.from({
      name: "trail-batch",
      vertex: VERTEX_SHADER,
      fragment: FRAGMENT_SHADER,
    });
    const tex = Texture.WHITE;
    const shader = new Shader({
      glProgram,
      resources: {
        uTexture: tex.source,
        uSampler: tex.source.style,
      },
    });
    // Pixi's Mesh pipe reads `shader.texture` during validateRenderable.
    (shader as Shader & { texture: Texture }).texture = tex;
    this.mesh = new Mesh<Geometry>({
      geometry: this.geometry,
      shader: shader as Shader & { texture: Texture },
    });
    this.mesh.label = "trail-batch-mesh";
    return this.mesh;
  }

  beginFrame(): void {
    this.vertCursor = 0;
    this.indexCursor = 0;
  }

  addTrail(trail: readonly TrailPoint[] | undefined, headX: number, headY: number, style: TrailStyle): void {
    const headValid = Number.isFinite(headX) && Number.isFinite(headY);
    const points = trail ?? [];
    const totalPoints = points.length + (headValid ? 1 : 0);
    if (totalPoints === 0) return;

    const alpha = style.alpha ?? 1;

    if (totalPoints >= 2) {
      const startIdx = Math.max(0, totalPoints - TRAIL_MAX_POINTS);
      const usedCount = totalPoints - startIdx;

      this.appendStrip(
        points,
        startIdx,
        usedCount,
        headValid ? headX : Number.NaN,
        headValid ? headY : Number.NaN,
        style.width,
        style.outerColor,
        alpha * OUTER_STROKE_ALPHA,
      );
      this.appendStrip(
        points,
        startIdx,
        usedCount,
        headValid ? headX : Number.NaN,
        headValid ? headY : Number.NaN,
        style.coreWidth,
        style.coreColor,
        alpha * CORE_STROKE_ALPHA,
      );
    }

    if (headValid) {
      this.appendDisk(headX, headY, style.headRadius * HEAD_GLOW_RADIUS_MULT, style.headColor, alpha * HEAD_GLOW_ALPHA);
      this.appendDisk(headX, headY, style.headRadius, style.headColor, alpha * HEAD_CORE_ALPHA);
    }
  }

  endFrame(): void {
    if (this.indexCursor < this.prevIndexCursor) {
      // Pad the trailing slots with degenerate triangles (all indices = 0).
      // Vertex 0 always exists (zero-initialised at worst), so these triangles
      // collapse to zero area and rasterise no pixels.
      this.indices.fill(0, this.indexCursor, this.prevIndexCursor);
    }
    this.prevIndexCursor = this.indexCursor;

    this.vertexBuffer.update(Math.max(this.vertCursor, 1) * BYTES_PER_VERTEX);
    this.indexBuffer.update(this.indices.byteLength);
  }

  destroy(): void {
    this.mesh?.destroy({ children: true });
    this.mesh = null;
    this.geometry.destroy(true);
  }

  reuploadAfterContextRestore(): void {
    this.vertexBuffer.update(this.positions.byteLength);
    this.indexBuffer.update(this.indices.byteLength);
  }

  /**
   * Visible for tests.
   */
  __debugSnapshot(): {
    vertCount: number;
    indexCount: number;
    positions: Float32Array;
    indices: Uint16Array;
  } {
    return {
      vertCount: this.vertCursor,
      indexCount: this.indexCursor,
      positions: this.positions.subarray(0, this.vertCursor * FLOATS_PER_VERTEX),
      indices: this.indices.subarray(0, this.indexCursor),
    };
  }

  private appendStrip(
    points: readonly TrailPoint[],
    startIdx: number,
    usedCount: number,
    headX: number,
    headY: number,
    width: number,
    color: number,
    pmaAlpha: number,
  ): void {
    if (usedCount < 2 || width <= 0 || pmaAlpha <= 0) return;

    this.ensureVertexCapacity(usedCount * 2);
    this.ensureIndexCapacity((usedCount - 1) * 6);

    const halfW = width * 0.5;
    const baseVert = this.vertCursor;
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;

    const px = new Float64Array(usedCount);
    const py = new Float64Array(usedCount);
    for (let i = 0; i < usedCount; i++) {
      const idx = startIdx + i;
      if (idx < points.length) {
        px[i] = points[idx].x;
        py[i] = points[idx].y;
      } else {
        px[i] = headX;
        py[i] = headY;
      }
    }

    for (let i = 0; i < usedCount; i++) {
      let dx: number;
      let dy: number;
      if (i === 0) {
        dx = px[1] - px[0];
        dy = py[1] - py[0];
      } else if (i === usedCount - 1) {
        dx = px[i] - px[i - 1];
        dy = py[i] - py[i - 1];
      } else {
        const dx1 = px[i] - px[i - 1];
        const dy1 = py[i] - py[i - 1];
        const dx2 = px[i + 1] - px[i];
        const dy2 = py[i + 1] - py[i];
        const l1 = Math.hypot(dx1, dy1) || 1;
        const l2 = Math.hypot(dx2, dy2) || 1;
        dx = dx1 / l1 + dx2 / l2;
        dy = dy1 / l1 + dy2 / l2;
      }
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      const offX = nx * halfW;
      const offY = ny * halfW;

      // Per-vertex alpha fade: sqrt curve so the trail stays visible for most
      // of its length and only the very tail tapers to transparent.
      const t = usedCount === 1 ? 1 : i / (usedCount - 1);
      const fade = Math.sqrt(t);
      const a = pmaAlpha * fade;
      const pr = r * a;
      const pg = g * a;
      const pb = b * a;

      this.writeVertex(px[i] + offX, py[i] + offY, pr, pg, pb, a);
      this.writeVertex(px[i] - offX, py[i] - offY, pr, pg, pb, a);
    }

    for (let i = 0; i < usedCount - 1; i++) {
      const a = baseVert + i * 2;
      const b2 = a + 1;
      const c = a + 2;
      const d = a + 3;
      this.writeIndex(a);
      this.writeIndex(b2);
      this.writeIndex(c);
      this.writeIndex(b2);
      this.writeIndex(d);
      this.writeIndex(c);
    }
  }

  private appendDisk(cx: number, cy: number, radius: number, color: number, pmaAlpha: number): void {
    if (radius <= 0 || pmaAlpha <= 0) return;

    const segments = HEAD_FAN_SEGMENTS;
    this.ensureVertexCapacity(segments + 1);
    this.ensureIndexCapacity(segments * 3);

    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    const pr = r * pmaAlpha;
    const pg = g * pmaAlpha;
    const pb = b * pmaAlpha;

    const center = this.vertCursor;
    this.writeVertex(cx, cy, pr, pg, pb, pmaAlpha);

    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      this.writeVertex(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius, pr, pg, pb, pmaAlpha);
    }

    for (let i = 0; i < segments; i++) {
      const a = center + 1 + i;
      const b2 = center + 1 + ((i + 1) % segments);
      this.writeIndex(center);
      this.writeIndex(a);
      this.writeIndex(b2);
    }
  }

  private writeVertex(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const offset = this.vertCursor * FLOATS_PER_VERTEX;
    this.positions[offset] = x;
    this.positions[offset + 1] = y;
    this.positions[offset + 2] = r;
    this.positions[offset + 3] = g;
    this.positions[offset + 4] = b;
    this.positions[offset + 5] = a;
    this.vertCursor++;
  }

  private writeIndex(value: number): void {
    this.indices[this.indexCursor++] = value;
  }

  private ensureVertexCapacity(extra: number): void {
    const needed = this.vertCursor + extra;
    if (needed <= this.vertexCapacity) return;
    let nextCap = this.vertexCapacity;
    while (nextCap < needed) nextCap *= 2;
    const next = new Float32Array(nextCap * FLOATS_PER_VERTEX);
    next.set(this.positions);
    this.positions = next;
    this.vertexCapacity = nextCap;
    this.vertexBuffer.data = this.positions;
  }

  private ensureIndexCapacity(extra: number): void {
    const needed = this.indexCursor + extra;
    if (needed <= this.indexCapacity) return;
    let nextCap = this.indexCapacity;
    while (nextCap < needed) nextCap *= 2;
    if (nextCap > 65535) {
      throw new Error(`TrailBatch index buffer would exceed Uint16 range (${nextCap})`);
    }
    const next = new Uint16Array(nextCap);
    next.set(this.indices);
    this.indices = next;
    this.indexCapacity = nextCap;
    this.indexBuffer.data = this.indices;
    // The grown tail is already zero-filled, so degenerate-triangle padding for
    // unused slots remains valid without any reseed work.
    this.prevIndexCursor = this.indexCursor;
  }
}
