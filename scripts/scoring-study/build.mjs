import { build } from "esbuild";
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(".");
const progression = process.argv.includes("--progression");
const out = resolve("operator-results/scoring-study-20260915/" + (progression ? "progression" : "attribution"));
mkdirSync(out, { recursive: true, mode: 0o700 });
const auditPath = resolve("scripts/scoring-study/observer.mjs");
const changes = [];
function replace(source, file, find, replacement, expected = 1) {
  const count = source.split(find).length - 1;
  if (count !== expected) throw Error(`${file}: expected ${expected} occurrences of ${find}, got ${count}`);
  changes.push({ file, find, replacement, count });
  return source.split(find).join(replacement);
}
function instrument(source, path) {
  const file = basename(path);
  let s = source;
  const r = (a, b, n = 1) => {
    s = replace(s, file, a, b, n);
  };
  if (file === "game-logic.ts") {
    r(
      "  let budget = MAX_PARTICLES - g.particles.length;",
      "  audit.explosion(g, g.explosions[g.explosions.length - 1]);\n  let budget = MAX_PARTICLES - g.particles.length;",
    );
    r(
      "  const typeKey = getDestroyedTypeKey(target);",
      "  const typeKey = getDestroyedTypeKey(target);\n  audit.destroyed(g, target, typeKey);",
    );
    r("    target.health -= damage;", "    audit.damage(g, target, damage);\n    target.health -= damage;");
    r(
      "  } else {\n    target.alive = false;",
      "  } else {\n    audit.damage(g, target, 1);\n    target.alive = false;",
    );
    r(
      "    (target as { health: number }).health -= damage;",
      "    audit.damage(g, target, damage);\n    (target as { health: number }).health -= damage;",
    );
    r(
      "g.score += getKillReward(target) * g.combo;",
      'audit.reward(g, getKillReward(target) * g.combo, "kill", target);',
      3,
    );
  }
  if (file === "game-sim.ts") {
    r(
      "      threat.alive = false;",
      "      audit.damage(state, threat, threat.health ?? 1);\n      threat.alive = false;",
    );
    r(
      "        } else if (dist(m.x, m.y, ex.x, ex.y) < ex.maxRadius) {",
      "        } else if (dist(m.x, m.y, ex.x, ex.y) < ex.maxRadius) {\n          audit.damage(g, m, 1, ex);",
    );
    r(
      "state.score += getKillReward(threat) * state.combo;",
      'audit.reward(state, getKillReward(threat) * state.combo, "kill", threat);',
    );
    r("g.score += getKillReward(m) * g.combo;", 'audit.reward(g, getKillReward(m) * g.combo, "kill", m, ex);', 2);
    r("g.score += getKillReward(d) * g.combo;", 'audit.reward(g, getKillReward(d) * g.combo, "kill", d, ex);');
    r("m.health = (m.health ?? 1) - 1;", "audit.damage(g, m, 1, ex);\n            m.health = (m.health ?? 1) - 1;");
    r("          d.health--;", "          audit.damage(g, d, 1, ex);\n          d.health--;");
    r("g.score += bonus;", 'audit.reward(g, bonus, "multi", null, ex);');
    r("g.score += newBonus - oldBonus;", 'audit.reward(g, newBonus - oldBonus, "multi", null, ex);');
    r("g.score -= 500;", 'audit.reward(g, -500, "friendly_fire", null, null);');
    r(
      'boom(g, p.x, p.y, 40, "#ff0000", false, onEvent);',
      'audit.withSource("friendly_fire", () => boom(g, p.x, p.y, 40, "#ff0000", false, onEvent));',
    );
    r("g.score += 250 * g.wave;", 'audit.reward(g, 250 * g.wave, "wave_clear");');
    r("g.stats.multiShots++;", "g.stats.multiShots++; audit.multiShot(g, ex);");
    r("g.combo = next;", "audit.combo(g, next, ex);");
    r("g.combo = 1;", "audit.combo(g, 1, ex);");
  }
  if (file === "game-sim-shop.ts") {
    r("g.score -= cost;", 'audit.reward(g, -cost, "spending");', 3);
    r("g.score -= node.cost;", 'audit.reward(g, -node.cost, "spending", null, null, node.id);');
  }
  if (file === "replay.ts") {
    r("g.score += pendingHumanBonus;", 'audit.reward(g, pendingHumanBonus, "building_bonus");');
  }
  // Wrap named source functions and per-entity callbacks without changing their returns.
  const ast = ts.createSourceFile(path, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  const sources = {
    updateHornetFlight: "hornets",
    updateDyingHornet: "hornets",
    updateRoadrunnerFlight: "roadrunner",
    updatePatriotFlight: "patriot",
    updateFlares: "flare",
    updateMissiles: "impact",
    updateDrones: "impact",
    updateBurjDamageFx: "impact",
    damageBurj: "impact",
  };
  const wrap = (body, entry) => {
    edits.push(
      { pos: body.getStart(ast) + 1, text: `\n${entry}; try {\n` },
      { pos: body.end - 1, text: "\n} finally { audit.pop(); }\n" },
    );
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.body && node.name) {
      const name = node.name.text;
      if (sources[name]) wrap(node.body, `audit.pushSource(${JSON.stringify(sources[name])})`);
      if (name === "fireInterceptor") {
        const text = s.slice(node.body.pos, node.body.end);
        if (!text.includes("return true;")) throw Error("Missing fire success");
        const pos = s.indexOf("return true;", node.body.pos);
        edits.push({ pos, text: "audit.shot(g, g.interceptors[g.interceptors.length - 1]);\n" });
      }
      if (["fireEmp", "fireF15Pair", "fireFlareSalvo"].includes(name)) {
        const pos = s.indexOf("return true;", node.body.pos);
        if (pos < 0 || pos > node.body.end) throw Error("Missing active success");
        edits.push({
          pos,
          text: `audit.active(g, ${JSON.stringify({ fireEmp: "emp", fireF15Pair: "f15", fireFlareSalvo: "flare" }[name])});\n`,
        });
      }
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (["g.explosions.forEach", "g.interceptors.forEach"].includes(name)) {
        const cb = node.arguments[0];
        if (cb && ts.isArrowFunction(cb) && ts.isBlock(cb.body))
          wrap(cb.body, name.includes("explosions") ? "audit.pushExplosion(g, ex)" : "audit.pushProjectile(g, ic)");
      }
      if (name === "damageTarget") {
        const color = node.arguments[3].getText(ast);
        const source = { "COL.laser": "ironBeam", "COL.phalanx": "phalanx", "COL.emp": "emp" }[color];
        if (!source) throw Error("Unmapped damage source " + color);
        edits.push(
          { pos: node.getStart(ast), text: `audit.withSource("${source}", () => ` },
          { pos: node.end, text: ")" },
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const edit of edits.sort((a, b) => b.pos - a.pos)) s = s.slice(0, edit.pos) + edit.text + s.slice(edit.pos);
  // Reviewable generated patch inventory, plus hashes pinning the exact original files.
  changes.push({
    file,
    astInsertions: edits,
    instrumentationInputSha256: createHash("sha256").update(source).digest("hex"),
  });
  return `import * as audit from ${JSON.stringify(auditPath)};\n` + s;
}
const observedFiles = new Set([
  "game-logic.ts",
  "game-sim.ts",
  "game-sim-shop.ts",
  "game-sim-emp.ts",
  "game-sim-flare.ts",
  "game-sim-patriot.ts",
  "replay.ts",
]);
for (const observed of process.argv.includes("--progression") ? [false] : [false, true]) {
  await build({
    entryPoints: [
      process.argv.includes("--progression")
        ? "scripts/scoring-study/progression-context.ts"
        : "scripts/scoring-study/run.ts",
    ],
    outfile: resolve(
      out,
      process.argv.includes("--progression") ? "progression-context.mjs" : observed ? "observed.mjs" : "baseline.mjs",
    ),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning",
    define: { STUDY_OBSERVED: String(observed) },
    plugins: [
      {
        name: "scoring-observation",
        setup(b) {
          b.onLoad({ filter: /\/src\/.*\.ts$/ }, (args) => {
            if (!observedFiles.has(basename(args.path))) return;
            let source = readFileSync(args.path, "utf8");
            if (basename(args.path) === "replay.ts")
              source = replace(
                source,
                "replay.ts",
                "    cleanup,",
                "    cleanup,\n    studyMetadata: () => ({ actionIdx, verifiedCheckpointIndexes: [...verifiedCheckpointIndexes] }),",
              );
            if (basename(args.path) === "game-sim.ts")
              source += "\nexport const studyInternals = { updateExplosions, processRootExplosionCombo };";
            return {
              contents: observed ? instrument(source, args.path) : source,
              loader: "ts",
              resolveDir: resolve(args.path, ".."),
            };
          });
        },
      },
    ],
  });
}
writeFileSync(resolve(out, "instrumentation.json"), JSON.stringify(changes, null, 2), { mode: 0o600 });
console.log(
  progression ? "Built progression context bundle inside" : "Built baseline and observed replay bundles inside",
  out.replace(root + "/", ""),
);

writeFileSync(
  resolve(out, "source-hashes.json"),
  JSON.stringify(
    Object.fromEntries(
      [...observedFiles].map((file) => [
        "src/" + file,
        createHash("sha256")
          .update(readFileSync(resolve("src", file)))
          .digest("hex"),
      ]),
    ),
    null,
    2,
  ),
  { mode: 0o600 },
);
