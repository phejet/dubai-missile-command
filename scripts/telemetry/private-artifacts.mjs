import { access, readFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { SAFE_ARTIFACT_NAME, SAFE_CAPTURE_ID } from "./constants.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function candidatePath(resultsRoot, artifactName) {
  if (!SAFE_ARTIFACT_NAME.test(artifactName)) throw new Error("Telemetry artifact name is unsafe");
  return resolve(resultsRoot, artifactName, "candidates.private.json");
}

async function artifactDirectories(resultsRoot) {
  if (!(await exists(resultsRoot))) return [];
  return (await readdir(resultsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && SAFE_ARTIFACT_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function parsePrivateCandidates(text, artifactName) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Telemetry artifact ${artifactName} contains invalid JSON`);
  }
  if (!value || typeof value !== "object" || value.schema !== 1 || !Array.isArray(value.candidates)) {
    throw new Error(`Telemetry artifact ${artifactName} has an unsupported private-candidate schema`);
  }
  for (const [index, candidate] of value.candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || !SAFE_CAPTURE_ID.test(candidate.runId ?? "")) {
      throw new Error(`Telemetry artifact ${artifactName} has an invalid candidate at index ${index}`);
    }
  }
  if (value.selectionAudit !== undefined) {
    if (!Array.isArray(value.selectionAudit)) {
      throw new Error(`Telemetry artifact ${artifactName} has an invalid selection audit`);
    }
    for (const [index, audit] of value.selectionAudit.entries()) {
      if (!audit || typeof audit !== "object" || (audit.runId !== undefined && !SAFE_CAPTURE_ID.test(audit.runId))) {
        throw new Error(`Telemetry artifact ${artifactName} has an invalid selection audit at index ${index}`);
      }
    }
  }
  return value;
}

export async function cleanupPrivate(resultsRoot, artifactName) {
  const path = candidatePath(resultsRoot, artifactName);
  if (!(await exists(path))) return false;
  await unlink(path);
  return true;
}

export async function cleanupExpiredPrivate(resultsRoot, now = Date.now()) {
  const removed = [];
  for (const artifactName of await artifactDirectories(resultsRoot)) {
    const verificationPath = resolve(resultsRoot, artifactName, "verification.json");
    const privatePath = candidatePath(resultsRoot, artifactName);
    if (!(await exists(verificationPath)) || !(await exists(privatePath))) continue;
    let verification;
    try {
      verification = JSON.parse(await readFile(verificationPath, "utf8"));
    } catch {
      continue;
    }
    const due = Date.parse(verification.cleanupDueAt);
    if (Number.isFinite(due) && due <= now) {
      await unlink(privatePath);
      removed.push(artifactName);
    }
  }
  return removed;
}

export async function findMatchingPrivateCandidateArtifacts(resultsRoot, runIds) {
  const targets = new Set(runIds);
  if (targets.size === 0) return [];
  const matches = [];
  for (const artifactName of await artifactDirectories(resultsRoot)) {
    const path = candidatePath(resultsRoot, artifactName);
    if (!(await exists(path))) continue;
    const artifact = parsePrivateCandidates(await readFile(path, "utf8"), artifactName);
    const artifactRunIds = new Set([
      ...artifact.candidates.map((candidate) => candidate.runId),
      ...(artifact.selectionAudit ?? []).map((audit) => audit.runId).filter(Boolean),
    ]);
    const matchedCandidates = [...artifactRunIds].filter((runId) => targets.has(runId)).length;
    if (matchedCandidates > 0) matches.push({ artifactName, path, matchedCandidates });
  }
  return matches;
}

export async function removeMatchingPrivateCandidateArtifacts(matches) {
  const removed = [];
  for (const match of matches) {
    await unlink(match.path);
    removed.push({ artifactName: match.artifactName, matchedCandidates: match.matchedCandidates });
  }
  return removed;
}
