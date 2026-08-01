import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const identifier = process.argv[2];
const endpoint = process.env.DMC_CAPTURE_ENDPOINT ?? "http://127.0.0.1:8787";
const token = process.env.DMC_CAPTURE_TOKEN;

if (!identifier) throw new Error("Usage: npm run diag:pull -- <installId|captureId>");
if (!/^[A-Za-z0-9._+-]{1,64}$/.test(identifier)) throw new Error("Identifier contains unsafe characters");
if (!token) throw new Error("DMC_CAPTURE_TOKEN is required");

const base = new URL(endpoint);
base.pathname = base.pathname.replace(/\/api\/save-capture\/?$/, "/");
const headers = { Authorization: `Bearer ${token}` };

async function request(path) {
  const response = await fetch(new URL(path, base), { headers });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response;
}

async function pullCapture(captureId) {
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(captureId)) throw new Error(`Unsafe captureId from server: ${captureId}`);
  const response = await request(`/api/capture/${encodeURIComponent(captureId)}`);
  if (response.status === 404) return false;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = response.headers.get("x-dmc-sha256");
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!expected || expected !== actual) throw new Error(`SHA-256 mismatch for ${captureId}`);
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  await mkdir(resolve("diag-results"), { recursive: true });
  const path = resolve("diag-results", `${captureId}.json`);
  await writeFile(path, bytes);
  process.stdout.write(`${path}\n`);
  return true;
}

if (!(await pullCapture(identifier))) {
  const response = await request(`/api/captures?install=${encodeURIComponent(identifier)}&limit=200`);
  if (response.status === 404) throw new Error(`No capture or install found for ${identifier}`);
  const body = await response.json();
  const captures = Array.isArray(body.captures) ? body.captures : [];
  if (captures.length === 0) throw new Error(`No captures found for install ${identifier}`);
  for (const capture of captures) await pullCapture(capture.capture_id);
}
