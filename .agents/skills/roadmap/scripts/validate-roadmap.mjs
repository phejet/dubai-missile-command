#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roadmapPath = resolve(process.argv[2] ?? "ROADMAP.html");
const root = dirname(roadmapPath);
const errors = [];
const allowedStatuses = new Set(["planned", "gated", "in_progress", "shipped", "deferred", "cancelled"]);
const requiredSections = ["now", "roadmap", "gates", "decisions", "references", "changes"];

if (!existsSync(roadmapPath)) {
  console.error("Roadmap not found: " + roadmapPath);
  process.exit(1);
}

const html = readFileSync(roadmapPath, "utf8");

function error(message) {
  errors.push(message);
}

if (!/<meta\s+name="roadmap-source"\s+content="v1"\s*\/>/.test(html)) {
  error('Missing <meta name="roadmap-source" content="v1" />');
}
if (!/<!--\s*roadmap-source:v1\s*-->/.test(html)) {
  error("Missing roadmap-source:v1 comment marker");
}

for (const id of requiredSections) {
  if (!new RegExp('<section\\b[^>]*\\bid="' + id + '"').test(html)) {
    error("Missing required section #" + id);
  }
}

if (!/Updated\s+(\d{4}-\d{2}-\d{2})/.test(html)) {
  error("Missing absolute Updated YYYY-MM-DD date");
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

const phases = [];
for (const match of html.matchAll(/<details\b([^>]*)>/g)) {
  const attrs = attributes(match[1]);
  if (!(attrs.class ?? "").split(/\s+/).includes("phase")) continue;
  phases.push(attrs);
}

if (phases.length === 0) error("No details.phase initiatives found");

const ids = new Set();
for (const phase of phases) {
  const id = phase["data-roadmap-id"];
  const status = phase["data-status"];
  if (!id || !/^RM-\d{2,}$/.test(id)) {
    error("Invalid or missing roadmap ID: " + (id ?? "(missing)"));
    continue;
  }
  if (ids.has(id)) error("Duplicate roadmap ID: " + id);
  ids.add(id);
  if (phase.id !== id.toLowerCase()) error(id + ' must use id="' + id.toLowerCase() + '"');
  if (!allowedStatuses.has(status)) error(id + " has invalid status: " + (status ?? "(missing)"));
}

const dependencies = new Map();
for (const phase of phases) {
  const id = phase["data-roadmap-id"];
  if (!id || !ids.has(id)) continue;
  const values = (phase["data-depends-on"] ?? "").split(/\s+/).filter(Boolean);
  dependencies.set(id, values);
  for (const dependency of values) {
    if (!ids.has(dependency)) error(id + " depends on unknown initiative " + dependency);
    if (dependency === id) error(id + " cannot depend on itself");
  }
}

const visiting = new Set();
const visited = new Set();
function visit(id, trail = []) {
  if (visiting.has(id)) {
    error("Dependency cycle: " + [...trail, id].join(" -> "));
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...trail, id]);
  visiting.delete(id);
  visited.add(id);
}
for (const id of ids) visit(id);

const nowSection = /<section\b[^>]*\bid="now"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
for (const phase of phases.filter((item) => item["data-status"] === "in_progress")) {
  if (!nowSection.includes(phase["data-roadmap-id"])) {
    error("Now section does not name active initiative " + phase["data-roadmap-id"]);
  }
}

const roadmapDir = dirname(roadmapPath);
for (const match of html.matchAll(/href="([^"]+)"/g)) {
  const href = match[1];
  if (/^(?:#|https?:|mailto:|tel:)/.test(href)) continue;
  const local = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  if (!existsSync(resolve(roadmapDir, local))) error("Broken local link: " + href);
}

const tracked = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.html"], {
  cwd: root,
  encoding: "utf8",
});
if (tracked.status === 0) {
  const marked = tracked.stdout
    .split("\n")
    .filter(Boolean)
    .filter((file) => {
      const path = resolve(root, file);
      return existsSync(path) && /<meta\s+name="roadmap-source"\s+content="v1"/.test(readFileSync(path, "utf8"));
    });
  if (marked.length !== 1 || resolve(root, marked[0]) !== roadmapPath) {
    error("Expected exactly one canonical roadmap marker, found: " + (marked.join(", ") || "none"));
  }
}

if (errors.length > 0) {
  for (const message of errors) console.error("ERROR: " + message);
  process.exit(1);
}

console.log("Roadmap valid: " + phases.length + " initiatives, " + ids.size + " stable IDs");
