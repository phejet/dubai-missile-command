import { build } from "esbuild";
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
const out = "operator-results/building-audit-20260919",
  observer = resolve("scripts/building-audit/observer.mjs");
const editsLog = [];
function instrument(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true),
    edits = [];
  function visit(n) {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.name.text === "alive" &&
      n.right.kind === ts.SyntaxKind.FalseKeyword
    ) {
      const obj = n.left.expression.getText(ast),
        line = ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1;
      let parent = n;
      while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
      const fn = parent?.name?.text;
      const context =
        fn === "updateExplosions"
          ? "{playerCaused:!!ex.playerCaused,chain:!!ex.chain,root:ex.rootExplosionId??null}"
          : obj === "b" && fn === "updateMissiles"
            ? "{actor:m}"
            : obj === "b" && fn === "updateDrones"
              ? "{actor:d}"
              : "{}";
      edits.push({
        a: n.getStart(ast),
        b: n.end,
        text: `(audit.death(${obj}, ${JSON.stringify(file + ":" + line)}, ${context}), ${n.getText(ast)})`,
      });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "push" &&
      /g\.(missiles|drones)$/.test(n.expression.expression.getText(ast))
    ) {
      for (const arg of n.arguments)
        edits.push({
          a: arg.getStart(ast),
          b: arg.end,
          text: `audit.spawn(${arg.getText(ast)}, ${JSON.stringify(file + ":" + (ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1))}, ${/type:\s*"bomb"/.test(arg.getText(ast)) ? "d" : /type:\s*"(mirv_warhead|stack_child)"/.test(arg.getText(ast)) ? "m" : "null"})`,
        });
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  for (const e of edits.sort((a, b) => b.a - a.a)) source = source.slice(0, e.a) + e.text + source.slice(e.b);
  if (file === "game-sim.ts") {
    const marker = "    // Building collisions — match the shared title-style tower geometry";
    if (source.split(marker).length !== 2) throw Error("building collision hook drift");
    source = source.replace(marker, "    audit.contact(m, stepX, stepY);\n" + marker);
    source = source.replace(
      '          boom(g, m.x, m.y, 40, "#ff4400", false, onEvent, 20);',
      '          audit.hit(m, b);\n          boom(g, m.x, m.y, 40, "#ff4400", false, onEvent, 20);',
    );
  }
  if (file === "game-logic.ts") {
    if (source.split("  return alive[pick];").length !== 2) throw Error("building selector hook drift");
    source = source.replace("  return alive[pick];", "  return audit.selected(alive[pick]);");
  }
  editsLog.push({ file, count: edits.length });
  return `import * as audit from ${JSON.stringify(observer)};\n` + source;
}
for (const observed of [false, true])
  await build({
    entryPoints: ["scripts/building-audit/run.ts"],
    outfile: `${out}/${observed ? "observed" : "baseline"}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    define: { OBSERVED: String(observed) },
    plugins: [
      {
        name: "audit",
        setup(b) {
          b.onLoad({ filter: /\/src\/(game-sim[^/]*|game-logic|replay)\.ts$/ }, (args) => {
            let s = readFileSync(args.path, "utf8");
            const file = basename(args.path);
            if (file.endsWith(".test.ts")) return;
            if (file === "replay.ts")
              s = s.replace(
                "    cleanup,",
                "    cleanup,\n    studyMetadata: () => ({actionIdx, verifiedCheckpointIndexes: [...verifiedCheckpointIndexes]}),",
              );
            if (file === "game-sim.ts") s += "\nexport const buildingAuditInternals = {updateMissiles};";
            const originalHash = createHash("sha256").update(readFileSync(args.path)).digest("hex");
            editsLog.push({ file, originalHash, observed });
            return {
              contents: observed && file !== "replay.ts" ? instrument(s, file) : s,
              loader: "ts",
              resolveDir: resolve(args.path, ".."),
            };
          });
        },
      },
    ],
  });
writeFileSync(out + "/instrumentation.json", JSON.stringify(editsLog, null, 2));
