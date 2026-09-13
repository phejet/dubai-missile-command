#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules/.bin/wrangler");
const resultsRoot = resolve(root, "operator-results");
const CONFIRMATION_HEADER = "confirm-staging-r2-clock-proof";
export const PROBE_KEY_PATTERN = /^replays\/retention-clock-proof-[0-9a-f-]{36}\.json$/;
export const STAGING_R2_CLOCK_TARGET = Object.freeze({
  environment: "staging",
  bucket: "dmc-captures-staging",
  accountId: "e4be64eb24a69dd38935826bef35816a",
});

export function assertStagingProbeTarget(target, confirmed) {
  if (
    !confirmed ||
    target.environment !== STAGING_R2_CLOCK_TARGET.environment ||
    target.bucket !== STAGING_R2_CLOCK_TARGET.bucket ||
    target.accountId !== STAGING_R2_CLOCK_TARGET.accountId
  ) {
    throw new Error("R2 upload-clock proof may target only the explicit Staging bucket");
  }
  return target;
}

export function validateProbeResult(result) {
  if (
    result?.ok !== true ||
    !Number.isFinite(result.firstUploadedMs) ||
    !Number.isFinite(result.secondUploadedMs) ||
    result.secondUploadedMs <= result.firstUploadedMs ||
    result.versionChanged !== true ||
    result.samePayloadSize !== true ||
    result.deleted !== true
  ) {
    throw new Error("R2 same-key upload clock did not advance cleanly");
  }
  return {
    firstUploadedMs: result.firstUploadedMs,
    secondUploadedMs: result.secondUploadedMs,
    uploadAdvancedMs: result.secondUploadedMs - result.firstUploadedMs,
    versionChanged: true,
    samePayloadSize: true,
    deleted: true,
  };
}

function option(args, name) {
  const prefix = `${name}=`;
  const match = args.find((argument) => argument.startsWith(prefix));
  return match?.slice(prefix.length);
}

export function parseArgs(args) {
  if (args[0] !== "run" || !args.includes("--confirm-staging")) {
    throw new Error(
      "Usage: node scripts/probe-r2-upload-clock.mjs run --confirm-staging [--out=operator-results/file.json]",
    );
  }
  assertStagingProbeTarget(STAGING_R2_CLOCK_TARGET, true);
  const stamp = new Date().toISOString().slice(0, 10);
  const output = resolve(root, option(args, "--out") ?? `operator-results/rm04-r2-upload-clock-${stamp}.json`);
  if (!output.startsWith(`${resultsRoot}${sep}`)) throw new Error("Evidence output must be under operator-results/");
  if (existsSync(output)) throw new Error("Evidence output already exists");
  return { output };
}

function workerSource() {
  return `
const HEADER = ${JSON.stringify(CONFIRMATION_HEADER)};
const KEY_PATTERN = ${PROBE_KEY_PATTERN.toString()};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  async fetch(request, env) {
    if (request.method !== "POST" || request.headers.get("x-dmc-r2-clock-probe") !== HEADER) {
      return json({ ok: false }, 403);
    }
    let input;
    try { input = await request.json(); } catch { return json({ ok: false }, 400); }
    if (!KEY_PATTERN.test(input?.key ?? "")) return json({ ok: false }, 400);
    const key = input.key;
    const path = new URL(request.url).pathname;
    if (path === "/cleanup") {
      await env.CAPTURES.delete(key);
      return json({ ok: (await env.CAPTURES.head(key)) === null });
    }
    if (path !== "/probe") return json({ ok: false }, 404);
    if (await env.CAPTURES.head(key)) return json({ ok: false, collision: true }, 409);

    const bytes = new TextEncoder().encode('{"purpose":"dmc-r2-upload-clock-proof-v1"}');
    let result = null;
    let created = false;
    try {
      await env.CAPTURES.put(key, bytes, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { purpose: "retention-clock-proof" },
      });
      created = true;
      const first = await env.CAPTURES.head(key);
      await sleep(1500);
      await env.CAPTURES.put(key, bytes, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { purpose: "retention-clock-proof" },
      });
      const second = await env.CAPTURES.head(key);
      if (!first || !second) throw new Error("missing object metadata");
      result = {
        ok: true,
        firstUploadedMs: first.uploaded.getTime(),
        secondUploadedMs: second.uploaded.getTime(),
        versionChanged: first.version !== second.version,
        samePayloadSize: first.size === second.size && second.size === bytes.byteLength,
      };
    } catch {
      result = { ok: false };
    }

    let deleted = !created;
    if (created) {
      try {
        await env.CAPTURES.delete(key);
        deleted = (await env.CAPTURES.head(key)) === null;
      } catch {
        deleted = false;
      }
    }
    return json({ ...result, deleted }, result?.ok && deleted ? 200 : 500);
  },
};
`;
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || port === null ? reject(error ?? new Error("No port")) : resolvePort(port)));
    });
  });
}

async function startPreview(directory, port) {
  const child = spawn(
    wrangler,
    [
      "dev",
      "--config",
      resolve(directory, "wrangler.jsonc"),
      "--remote",
      "--port",
      String(port),
      "--show-interactive-dev-session",
      "false",
    ],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let transcript = "";
  const collect = (chunk) => {
    transcript = `${transcript}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out starting guarded Wrangler preview")), 60_000);
    const inspect = () => {
      if (!transcript.includes("Ready on")) return;
      clearTimeout(timeout);
      resolveReady();
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Guarded Wrangler preview exited before ready (${code ?? "unknown"})`));
    });
  });
  return child;
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGTERM");
}

async function post(port, path, key) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dmc-r2-clock-probe": CONFIRMATION_HEADER },
    body: JSON.stringify({ key }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Guarded R2 probe failed (${response.status})`);
  return payload;
}

async function main() {
  const { output } = parseArgs(process.argv.slice(2));
  mkdirSync(resultsRoot, { recursive: true, mode: 0o700 });
  chmodSync(resultsRoot, 0o700);
  const temporary = mkdtempSync(resolve(tmpdir(), "dmc-r2-clock-proof-"));
  chmodSync(temporary, 0o700);
  const key = `replays/retention-clock-proof-${randomUUID()}.json`;
  const recoveryPath = resolve(resultsRoot, `.rm04-r2-clock-active-${randomUUID()}.json`);
  writeFileSync(recoveryPath, `${JSON.stringify({ version: 1, target: STAGING_R2_CLOCK_TARGET, key }, null, 2)}\n`, {
    mode: 0o600,
  });

  let child;
  let port;
  let cleanupVerified = false;
  try {
    writeFileSync(resolve(temporary, "worker.mjs"), workerSource(), { mode: 0o600 });
    writeFileSync(
      resolve(temporary, "wrangler.jsonc"),
      `${JSON.stringify(
        {
          name: "dmc-r2-upload-clock-proof",
          main: "worker.mjs",
          account_id: STAGING_R2_CLOCK_TARGET.accountId,
          compatibility_date: "2026-08-01",
          r2_buckets: [{ binding: "CAPTURES", bucket_name: STAGING_R2_CLOCK_TARGET.bucket }],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    port = await availablePort();
    child = await startPreview(temporary, port);
    const result = validateProbeResult(await post(port, "/probe", key));
    const cleanup = await post(port, "/cleanup", key);
    cleanupVerified = cleanup?.ok === true;
    if (!cleanupVerified) throw new Error("R2 canary cleanup did not verify absence");
    const evidence = {
      version: 1,
      environment: "staging",
      bucket: STAGING_R2_CLOCK_TARGET.bucket,
      workerSourceSha: readFileSync(resolve(root, ".git/refs/heads/main"), "utf8").trim(),
      observedAt: new Date().toISOString(),
      ...result,
      cleanupRechecked: true,
      productionTouched: false,
    };
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      `${JSON.stringify({ ok: true, uploadAdvancedMs: result.uploadAdvancedMs, versionChanged: true, deleted: true, evidence: output.replace(`${root}/`, "") })}\n`,
    );
  } finally {
    if (child && port && !cleanupVerified) {
      try {
        cleanupVerified = (await post(port, "/cleanup", key))?.ok === true;
      } catch {
        cleanupVerified = false;
      }
    }
    await stopPreview(child);
    rmSync(temporary, { recursive: true, force: true });
    if (cleanupVerified) rmSync(recoveryPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
