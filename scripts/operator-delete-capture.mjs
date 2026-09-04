#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  findMatchingPrivateCandidateArtifacts,
  removeMatchingPrivateCandidateArtifacts,
} from "./telemetry/private-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function usage() {
  return [
    "Usage:",
    "  npm run operator:delete -- --env staging --scope run|install --reference <id>",
    "  npm run operator:delete -- --env staging --resume <job-id>",
    "  npm run operator:delete -- --env staging --list-jobs",
    "  npm run operator:delete -- --env staging --inspect-job <job-id>",
    "  npm run operator:delete -- --env staging --recover-job <job-id>",
    "  npm run operator:delete -- --env staging --inspect-reservation <request-id>",
    "  npm run operator:delete -- --env staging --recover-reservation <request-id>",
    "  add --production when --env production is intentional",
    "",
    "Set DMC_CAPTURE_BEARER_TOKEN in the environment; it is never printed or written.",
  ].join("\n");
}

export async function request(endpoint, path, body, token, fetchImpl = fetch) {
  const response = await fetchImpl(new URL(path, endpoint), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, message: `Non-JSON response (${response.status})` };
  }
  return { response, payload };
}

export function evidencePayload(environment, payload) {
  return {
    recordedAt: new Date().toISOString(),
    environment,
    ok: payload.ok === true,
    jobId: payload.jobId ?? null,
    planDigest: payload.planDigest ?? null,
    verified: payload.verified === true,
    counts: {
      sessions: Array.isArray(payload.sessions) ? payload.sessions.length : undefined,
      reports: Array.isArray(payload.reports) ? payload.reports.length : undefined,
      sharedRuns: Array.isArray(payload.sharedRuns) ? payload.sharedRuns.length : undefined,
      diagnosticObjects: Array.isArray(payload.diagnosticObjects) ? payload.diagnosticObjects.length : undefined,
      replayObjects: Array.isArray(payload.replayObjects) ? payload.replayObjects.length : undefined,
      preservedReplayObjects: Array.isArray(payload.preservedReplayObjects)
        ? payload.preservedReplayObjects.length
        : undefined,
      telemetryPrivateArtifacts:
        typeof payload.telemetryPrivateArtifactsRemoved === "number"
          ? payload.telemetryPrivateArtifactsRemoved
          : undefined,
    },
  };
}

export async function findDeletionTelemetryArtifacts(previewPayload, resultsRoot = resolve(root, "telemetry-results")) {
  return findMatchingPrivateCandidateArtifacts(
    resultsRoot,
    Array.isArray(previewPayload.sessions) ? previewPayload.sessions : [],
  );
}

export async function removeDeletionTelemetryArtifacts(matches) {
  return removeMatchingPrivateCandidateArtifacts(matches);
}

function writeEvidence(environment, payload) {
  const directory = resolve(root, "operator-results");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const label = typeof payload.jobId === "string" ? basename(payload.jobId) : `failed-${Date.now()}`;
  const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${environment}-${label}.json`);
  writeFileSync(path, `${JSON.stringify(evidencePayload(environment, payload), null, 2)}\n`, { mode: 0o600 });
  console.log(`Redacted evidence: ${path}`);
}

async function main() {
  if (args.includes("--help")) {
    console.log(usage());
    return;
  }
  const environment = option("--env");
  if (environment !== "staging" && environment !== "production") throw new Error("--env must be staging or production");
  if (environment === "production" && !args.includes("--production")) {
    throw new Error("Production deletion requires the separate --production acknowledgement");
  }
  const token = process.env.DMC_CAPTURE_BEARER_TOKEN;
  if (!token) throw new Error("DMC_CAPTURE_BEARER_TOKEN is not set");
  const urls = JSON.parse(readFileSync(resolve(root, "capture-worker-urls.json"), "utf8"));
  const endpoint = urls[environment];
  if (typeof endpoint !== "string" || !endpoint) throw new Error(`${environment} Worker URL is not configured`);

  const inspectJob = option("--inspect-job");
  const recoverJob = option("--recover-job");
  if (args.includes("--list-jobs") || inspectJob || recoverJob) {
    const path = args.includes("--list-jobs")
      ? "/api/operator/deletion/jobs/list"
      : "/api/operator/deletion/jobs/inspect";
    const inspected = await request(
      endpoint,
      path,
      inspectJob || recoverJob ? { jobId: inspectJob ?? recoverJob } : {},
      token,
    );
    console.log(JSON.stringify(inspected.payload, null, 2));
    if (!inspected.response.ok) throw new Error(`Deletion job inspection failed (${inspected.response.status})`);
    if (!recoverJob || args.includes("--list-jobs")) return;
    if (!process.stdin.isTTY) throw new Error("Deletion job recovery requires an interactive terminal");
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const entered = await readline.question("Type the exact confirmation shown above: ");
    readline.close();
    if (entered !== inspected.payload.confirmation) throw new Error("Recovery confirmation did not match");
    const recovered = await request(
      endpoint,
      "/api/operator/deletion/jobs/recover",
      { jobId: recoverJob, planDigest: inspected.payload.planDigest, confirmation: entered },
      token,
    );
    console.log(JSON.stringify(recovered.payload, null, 2));
    writeEvidence(environment, recovered.payload);
    if (!recovered.response.ok) fail(`Deletion job recovery failed (${recovered.response.status})`);
    return;
  }

  const inspectReservation = option("--inspect-reservation");
  const recoverReservation = option("--recover-reservation");
  if (inspectReservation || recoverReservation) {
    const requestId = inspectReservation ?? recoverReservation;
    const inspected = await request(endpoint, "/api/operator/deletion/reservation/inspect", { requestId }, token);
    console.log(JSON.stringify(inspected.payload, null, 2));
    if (!inspected.response.ok) throw new Error(`Reservation inspection failed (${inspected.response.status})`);
    if (inspectReservation) return;
    if (!process.stdin.isTTY) throw new Error("Reservation recovery requires an interactive terminal");
    console.log(
      "Confirm the matching Worker invocation has completed or terminated in structured logs. Age alone is not proof.",
    );
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const entered = await readline.question("Type the exact confirmation shown above: ");
    readline.close();
    if (entered !== inspected.payload.confirmation) {
      throw new Error("Recovery confirmation did not match; nothing was changed");
    }
    const recovered = await request(
      endpoint,
      "/api/operator/deletion/reservation/recover",
      {
        requestId,
        invocationEnded: true,
        planDigest: inspected.payload.planDigest,
        confirmation: entered,
      },
      token,
    );
    console.log(JSON.stringify(recovered.payload, null, 2));
    writeEvidence(environment, recovered.payload);
    if (!recovered.response.ok) fail(`Reservation recovery failed (${recovered.response.status})`);
    return;
  }

  const resume = option("--resume");
  if (resume) {
    const { response, payload } = await request(endpoint, "/api/operator/deletion/resume", { jobId: resume }, token);
    console.log(JSON.stringify(payload, null, 2));
    writeEvidence(environment, payload);
    if (!response.ok) fail(`Resume did not complete (${response.status})`);
    return;
  }

  const scope = option("--scope");
  const reference = option("--reference");
  if ((scope !== "run" && scope !== "install") || !reference) throw new Error(usage());
  const preview = await request(endpoint, "/api/operator/deletion/preview", { scope, reference }, token);
  if (!preview.response.ok) {
    console.error(JSON.stringify(preview.payload, null, 2));
    throw new Error(`Preview failed (${preview.response.status})`);
  }
  console.log(JSON.stringify(preview.payload, null, 2));
  const telemetryMatches = await findDeletionTelemetryArtifacts(preview.payload);
  if (telemetryMatches.length) {
    console.log(
      `Private telemetry artifacts matching this preview: ${telemetryMatches
        .map((match) => `${match.artifactName} (${match.matchedCandidates})`)
        .join(", ")}. They will be removed before remote deletion executes.`,
    );
  }
  if (!process.stdin.isTTY) throw new Error("Confirmation requires an interactive terminal");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const entered = await readline.question("Type the exact confirmation shown above: ");
  readline.close();
  if (entered !== preview.payload.confirmation) throw new Error("Confirmation did not match; nothing was deleted");
  const removedTelemetryArtifacts = await removeDeletionTelemetryArtifacts(telemetryMatches);
  const executed = await request(
    endpoint,
    "/api/operator/deletion/execute",
    {
      scope,
      reference,
      planDigest: preview.payload.planDigest,
      confirmation: entered,
    },
    token,
  );
  console.log(JSON.stringify(executed.payload, null, 2));
  writeEvidence(environment, {
    ...executed.payload,
    telemetryPrivateArtifactsRemoved: removedTelemetryArtifacts.length,
  });
  if (!executed.response.ok) {
    fail(
      executed.payload.jobId
        ? `Deletion paused. Resume job ${executed.payload.jobId} after resolving the reported condition.`
        : `Deletion failed (${executed.response.status})`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
}
