import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const identifier = process.argv[2];
const endpoint = process.env.DMC_CAPTURE_ENDPOINT ?? "http://127.0.0.1:8787";
const token = process.env.DMC_CAPTURE_TOKEN;

if (!identifier) throw new Error("Usage: npm run diag:pull -- <installId|reportId>");
if (!/^[A-Za-z0-9._+-]{1,64}$/.test(identifier)) throw new Error("Identifier contains unsafe characters");
if (!token) throw new Error("DMC_CAPTURE_TOKEN is required");

const base = new URL(endpoint);
base.pathname = base.pathname.replace(/\/api\/(?:session|report)\/?$/, "/");
const headers = { Authorization: `Bearer ${token}` };

async function request(path) {
  const response = await fetch(new URL(path, base), { headers });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response;
}

async function pullReport(reportId) {
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(reportId)) throw new Error(`Unsafe reportId from server: ${reportId}`);
  const response = await request(`/api/report/${encodeURIComponent(reportId)}`);
  if (response.status === 404) return false;
  const report = await response.json();
  if (report.replay) {
    const actual = createHash("sha256").update(JSON.stringify(report.replay)).digest("hex");
    if (actual !== report.meta?.replaySha256) throw new Error(`Replay SHA-256 mismatch for ${reportId}`);
  }
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await mkdir(resolve("diag-results"), { recursive: true });
  const path = resolve("diag-results", `${reportId}.json`);
  await writeFile(path, bytes);
  process.stdout.write(`${path}\n`);
  return true;
}

if (!(await pullReport(identifier))) {
  const response = await request(`/api/reports?install=${encodeURIComponent(identifier)}&limit=200`);
  if (response.status === 404) throw new Error(`No report or install found for ${identifier}`);
  const body = await response.json();
  const reports = Array.isArray(body.reports) ? body.reports : [];
  if (reports.length === 0) throw new Error(`No reports found for install ${identifier}`);
  for (const report of reports) await pullReport(report.report_id);
}
