// Generates a procedural Milky Way nebula sky texture as a PNG
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const W = 900;
const H = 960; // taller for portrait headroom

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: W, height: H });

  const dataUrl = await page.evaluate(
    ({ W, H }) => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      // Base dark sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, "#050510");
      skyGrad.addColorStop(0.3, "#0a0e1a");
      skyGrad.addColorStop(0.55, "#1a1040");
      skyGrad.addColorStop(0.75, "#2a1050");
      skyGrad.addColorStop(1, "#1a1a2e");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Seeded random
      function mulberry32(a) {
        return function () {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          var t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const rng = mulberry32(42);

      // Milky Way band — diagonal nebula glow
      ctx.save();
      ctx.translate(W * 0.5, H * 0.35);
      ctx.rotate(-0.4);

      // Main milky way band
      for (let i = 0; i < 8; i++) {
        const spread = 60 + i * 30;
        const alpha = 0.04 - i * 0.004;
        const grad = ctx.createRadialGradient(
          (rng() - 0.5) * 200,
          (rng() - 0.5) * 40,
          10,
          (rng() - 0.5) * 100,
          (rng() - 0.5) * 30,
          spread + rng() * 100,
        );
        grad.addColorStop(0, `rgba(200, 180, 220, ${alpha + 0.03})`);
        grad.addColorStop(0.3, `rgba(160, 140, 200, ${alpha})`);
        grad.addColorStop(0.6, `rgba(100, 80, 140, ${alpha * 0.5})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-400, -200, 800, 400);
      }

      // Brighter core of milky way
      for (let i = 0; i < 5; i++) {
        const cx = (rng() - 0.5) * 300;
        const cy = (rng() - 0.5) * 40;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 80 + rng() * 60);
        grad.addColorStop(0, `rgba(220, 200, 240, 0.06)`);
        grad.addColorStop(0.4, `rgba(180, 160, 210, 0.03)`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-400, -200, 800, 400);
      }
      ctx.restore();

      // Nebula color patches
      const nebulaColors = [
        [180, 120, 200], // purple
        [120, 100, 180], // blue-purple
        [200, 150, 180], // pink
        [100, 140, 200], // blue
        [160, 100, 140], // mauve
      ];
      for (let i = 0; i < 12; i++) {
        const cx = rng() * W;
        const cy = rng() * H * 0.7;
        const r = 80 + rng() * 180;
        const [cr, cg, cb] = nebulaColors[Math.floor(rng() * nebulaColors.length)];
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.035)`);
        grad.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, 0.015)`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // Dense star field — thousands of tiny dots
      for (let i = 0; i < 3000; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const size = rng() < 0.95 ? 0.3 + rng() * 0.7 : 1 + rng() * 1.5;
        const brightness = 0.3 + rng() * 0.7;

        // Stars near milky way band are denser/brighter
        const bandDist = Math.abs((y - H * 0.35) * Math.cos(0.4) + (x - W * 0.5) * Math.sin(0.4));
        const inBand = bandDist < 120;

        if (!inBand && rng() > 0.4) continue; // thin out stars outside band

        const alpha = brightness * (inBand ? 1 : 0.6);
        // Slight color variation
        const temp = rng();
        let r, g, b;
        if (temp < 0.1) {
          r = 255;
          g = 200;
          b = 150;
        } // warm
        else if (temp < 0.2) {
          r = 180;
          g = 200;
          b = 255;
        } // cool blue
        else {
          r = 255;
          g = 255;
          b = 255;
        } // white

        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // A few bright stars with diffraction spikes
      for (let i = 0; i < 8; i++) {
        const x = rng() * W;
        const y = rng() * H * 0.65;
        const size = 1.5 + rng() * 2;
        const brightness = 0.7 + rng() * 0.3;

        // Glow
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
        grad.addColorStop(0, `rgba(255,255,255,${brightness * 0.4})`);
        grad.addColorStop(0.3, `rgba(200,220,255,${brightness * 0.15})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x - size * 6, y - size * 6, size * 12, size * 12);

        // Core
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = brightness;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        // Cross spikes
        ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.3})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x - size * 4, y);
        ctx.lineTo(x + size * 4, y);
        ctx.moveTo(x, y - size * 4);
        ctx.lineTo(x, y + size * 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Warm horizon glow (city light pollution)
      const horizonGlow = ctx.createLinearGradient(0, H * 0.6, 0, H);
      horizonGlow.addColorStop(0, "rgba(0,0,0,0)");
      horizonGlow.addColorStop(0.5, "rgba(60, 40, 30, 0.08)");
      horizonGlow.addColorStop(0.8, "rgba(80, 50, 30, 0.15)");
      horizonGlow.addColorStop(1, "rgba(40, 25, 20, 0.2)");
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, 0, W, H);

      return canvas.toDataURL("image/png");
    },
    { W, H },
  );

  // Convert data URL to buffer and save
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  writeFileSync("public/sky-nebula.png", Buffer.from(base64, "base64"));
  console.log(`Sky texture saved: ${W}x${H}`);

  await browser.close();
}

main().catch(console.error);
