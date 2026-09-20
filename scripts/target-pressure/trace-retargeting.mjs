// Observe the archived simulator without modifying runtime code or historical artifacts.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const archive = "operator-results/building-audit-20260919/observed.mjs";
let source = readFileSync(archive, "utf8");
const hash = createHash("sha256").update(source).digest("hex");
const marker = "var inventory = JSON.parse";
assert.equal(source.split(marker).length, 2);
source = source
  .slice(0, source.indexOf(marker))
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(process.cwd() + "/" + archive).href));
const roll = "if (g.burjAlive && _rng() < 0.3) return getBurjBodyAimPoint();";
assert.equal(source.split(roll).length, 2);
source = source.replace(roll, "if (g.burjAlive && (traceRoll = _rng()) < 0.3) return getBurjBodyAimPoint();");
source += `
var traceRoll=null, selection=null, candidates=null, pending=null, runLabel=null;
const traces=[];
const originalPick=pickTarget,originalCandidates=missileTargetCandidates,originalResolve=resolveMissileApproach,originalSpawn=spawn;
function assetName(g,p){
 if(!p)return 'none';
 if(p.x===BURJ_X && isBurjImpactTarget(p.x,p.y))return 'Burj';
 const site=g.defenseSites.find(s=>s.alive&&s.x===p.x&&s.y===p.y);if(site)return 'site:'+site.key;
 const i=LAUNCHERS.findIndex((_,i)=>{const q=getGameplayLauncherPosition(i);return q.x===p.x&&q.y===p.y;});
 return i>=0?'launcher:'+i:'unknown';
}
pickTarget=function(g,x){traceRoll=null;const target=originalPick(g,x);selection={roll:traceRoll,initialTarget:target?{...target}:null,initialAsset:assetName(g,target),liveMilitaryTargets:g.defenseSites.filter(s=>s.alive).length+g.launcherHP.filter(h=>h>0).length};return target;};
missileTargetCandidates=function(g){const out=originalCandidates(g);candidates=out.map(p=>({...p,asset:assetName(g,p)}));return out;};
resolveMissileApproach=function(g,x,y,target){
 candidates=null;
 const before={...selection},result=originalResolve(g,x,y,target);
 const slope=p=>Math.abs(p.x-x)/Math.max(1,p.y-y);
 pending={run:runLabel,tick,wave:g.wave,...before,startBefore:{x,y},startAfter:{x:result.startX,y},initialSlope:slope(target),threshold:MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE,finalTarget:{...result.target},finalAsset:assetName(g,result.target),candidates:candidates?.map(p=>({...p,slope:slope(p),eligible:slope(p)>=MIN_INCOMING_MISSILE_HORIZONTAL_SLOPE,horizontalDistance:Math.abs(p.x-x)}))??[]};
 return result;
};
spawn=function(t,src,parent=null){
 const result=originalSpawn(t,src,parent);
 if(pending&&['missile','mirv','stack2','stack3'].includes(t.type)){
  traces.push({...pending,type:t.type,id:refs.get(t).id});pending=null;
 }
 return result;
};
const old=JSON.parse(readFileSync(out+'/observed-results.json','utf8')).filter(r=>r.status==='verified'&&r.cohort==='human-study');
const inventory=JSON.parse(readFileSync(out+'/inventory.json','utf8'));
let checkpoints=0;
for(const prev of old){
 runLabel=prev.studyLabel;pending=null;
 const replay=inventory.rows.find(r=>r.label===prev.label).replay;
 const runner=createReplayRunner(replay,null,(type,data)=>{if(type==='replay_divergence')throw Error('divergence '+data.tick);});
 const g=runner.init();start(g,getGameplayBuildingBounds);let loops=0;
 while(runner.getTick()<replay.finalTick){assert(++loops<replay.finalTick*3+100);assert(!runner.isFinished());clock(runner.getTick());if(runner.isBonusPaused())runner.resumeFromBonusScreen();else if(runner.isShopPaused())runner.resumeFromShop();else runner.step();}
 assert.equal(g.score,prev.score);assert.equal(g.wave,prev.wave);
 assert.equal(runner.studyMetadata().verifiedCheckpointIndexes.length,replay.checkpoints.length);checkpoints+=replay.checkpoints.length;
 assert.equal(runner.studyMetadata().actionIdx,replay.actions.length);
 const audit=finish(g);assert.deepEqual(audit,prev.audit);
 for(const t of traces.filter(t=>t.run===runLabel)){const record=audit.records.find(r=>r.id===t.id);t.outcome=record.outcome;t.end=record.end;}
 runner.cleanup();
}
return {runs:old.length,checkpoints,traces};
`;
const data = new Function("readFileSync", "writeFileSync", "createHash", "assert", source)(
  readFileSync,
  () => {
    throw Error("Historical writes forbidden");
  },
  createHash,
  assert,
);
const missiles = data.traces.filter((t) => t.type === "missile");
const tower = (t) => t.finalAsset === "Burj";
const totals = {
  ordinaryMissiles: missiles.length,
  initialTower: missiles.filter((t) => t.initialAsset === "Burj").length,
  initialTowerFromRoll: missiles.filter((t) => t.initialAsset === "Burj" && t.roll < 0.3).length,
  initialTowerFallback: missiles.filter((t) => t.initialAsset === "Burj" && t.roll >= 0.3).length,
  retargetedToTower: missiles.filter((t) => t.initialAsset !== "Burj" && tower(t)).length,
  retargetedAway: missiles.filter((t) => t.initialAsset === "Burj" && !tower(t)).length,
  finalTower: missiles.filter(tower).length,
  topRetargetedToTower: missiles.filter((t) => t.startBefore.y < 0 && t.initialAsset !== "Burj" && tower(t)).length,
};
assert.equal(totals.ordinaryMissiles, 2079);
assert.equal(totals.finalTower, 1196);
assert.equal(totals.initialTower + totals.retargetedToTower - totals.retargetedAway, totals.finalTower);
const example = missiles.find(
  (t) => t.initialAsset !== "Burj" && tower(t) && t.outcome === "game-sim.ts:1786" && t.candidates.length >= 3,
);
assert(example);
assert(example.roll >= 0.3);
assert(example.initialSlope < example.threshold);
const eligible = example.candidates
  .filter((c) => c.eligible)
  .sort((a, b) => a.horizontalDistance - b.horizontalDistance);
assert.equal(eligible[0].asset, "Burj");
const result = {
  archive,
  archiveSha256: hash,
  runs: data.runs,
  checkpoints: data.checkpoints,
  totals,
  example,
  traces: data.traces,
};
writeFileSync("operator-results/target-pressure-20260920/retarget-trace.json", JSON.stringify(result, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify({ ...result, traces: undefined }, null, 2));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rows = example.candidates
  .map(
    (c) =>
      `<tr><td>${esc(c.asset)}</td><td>${c.slope.toFixed(3)}</td><td>${c.eligible ? "Yes" : "No"}</td><td>${c.horizontalDistance.toFixed(0)} px</td></tr>`,
  )
  .join("");
writeFileSync(
  "docs/target-pressure-retarget-trace.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Why 30% becomes 57.5% — replay trace</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#203248;background:#f3f1eb;margin:0}main{max-width:900px;margin:auto;padding:35px 22px}h1{font-size:clamp(30px,5vw,46px);line-height:1.15}h2{margin-top:40px}a{color:#23577b}figure{margin:25px 0;background:white;padding:24px;border:1px solid #d9dfe5;border-radius:8px}.flow{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.flow b{padding:13px;background:#edf2f7;border-radius:5px}figcaption,footer{font-size:13px;color:#526173;margin-top:16px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:10px 6px;border-bottom:1px solid #cbd4dd}.table{overflow:auto}code{overflow-wrap:anywhere;font-size:.85em}.note{border-left:3px solid #ad402d;padding:12px 16px;background:white}li{margin:10px 0}</style></head><body><main><p><a href="target-pressure-review-plan.html">← Illustrated review plan</a> · Replay evidence · 20 September 2026</p><h1>Why a 30% roll becomes<br>57.5% tower targeting.</h1><p>The initial roll works. A later approach correction replaces many side-spawned missiles’ destinations with the Burj, before the missiles appear.</p><figure><div class="flow"><b>635 initially select tower</b><span>+</span><b>567 redirected toward it</b><span>−</span><b>6 redirected away</b><span>=</span><b>1,196 tower aims</b></div><figcaption>2,079 ordinary missiles across 26 historical human replays. Initial tower selection: 30.5%; final tower aims: 57.5%. No initial tower fallback was used for these ordinary missiles. Accidental path crossings are excluded.</figcaption></figure><h2>One recorded missile, step by step</h2><p><strong>${esc(example.run)}, wave ${example.wave}, threat ${example.id}.</strong> Spawn observation tick ${example.tick}; actual tower impact observation tick ${example.end.tick}. These are the historical audit’s tick labels.</p><ol><li>It spawns from the left edge at approximately <strong>(−10, 40)</strong>.</li><li>The tower roll is <strong>${example.roll.toFixed(6)}</strong>, above 0.3. The initial selector chooses the <strong>left launcher at (60, 1392)</strong>.</li><li>The approach check requires horizontal travel / vertical travel ≥ <strong>0.42</strong>. This path has only 70 px horizontal travel over roughly 1,352 px vertical travel: <strong>0.052</strong>. Rejected as too vertical.</li><li>The correction checks living alternatives and sorts the eligible ones by horizontal distance from the spawn. It does <strong>not</strong> repeat the 30% roll.</li><li>The Burj and right launcher both qualify. The <strong>Burj is closer horizontally</strong>, so it wins.</li><li>The missile appears with its final aim at approximately <strong>(460, 1052)</strong>. It later hits the tower near <strong>(443, 1016)</strong>.</li></ol><div class="table"><table><thead><tr><th>Candidate</th><th>Horizontal / vertical</th><th>Eligible?</th><th>Horizontal distance</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Why the bias repeats</h2><p>Initial selection favors nearby defenses. From a side entry, those targets often require a steep downward path and fail the slope rule. The Burj is farther inward and its aim point is higher, making it more likely to pass. The correction then favors it over an eligible launcher on the opposite edge.</p><p class="note"><strong>Side spawn is the key distinction.</strong> Top spawns preserve the target and move the spawn horizontally when needed. In this corpus, zero ordinary missiles changed from another target to the Burj through the top-spawn correction.</p><h2>Verification and limits</h2><p>The observer records the original RNG draw without adding draws, captures the actual candidate list without recomputing it, and associates each correction with the spawned body. All 26 replays matched their saved full threat traces, final scores, final waves and action consumption; all ${data.checkpoints.toLocaleString("en-US")} checkpoints were verified.</p><p>This proves what happened in the historical corpus. It is not a newly captured current-build playtest. The same selector and approach-correction branches remain in the inspected current code.</p><footer>Reproduce with <code>node scripts/target-pressure/trace-retargeting.mjs</code>.<br>Private detailed trace: <code>operator-results/target-pressure-20260920/retarget-trace.json</code>.<br>Archived simulator SHA-256: <code>${hash}</code>.<br>No gameplay files or historical artifacts were modified.</footer></main></body></html>`,
);
