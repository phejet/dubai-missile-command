import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_COMPRESSED_BYTES, MAX_DECODED_BYTES } from "../../src/capture-contract";
import { enrollmentClientData } from "../../src/capture-auth-protocol";
import { replayFixture, reportFixture, sessionFixture } from "../../test-fixtures/capture";
import type { VerifiedAttestation, VerifyAttestationOptions } from "../src/app-attest";
import worker, { runRetention } from "../src/index";
import type { Env } from "../src/bindings";
import { challenge, enroll } from "../src/capture-auth";
import { ingestSession, readBounded } from "../src/ingest";
import {
  addTestCredential,
  captureAuthHeaders,
  currentTestCredential,
  resetTestCredential,
} from "./capture-auth-fixture";

let sequence = 0;
let installId = "12345678-test0";

beforeEach(async () => {
  sequence += 1;
  installId = `12345678-test${sequence}`;
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_session"),
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_report"),
    env.DB.prepare("DROP TRIGGER IF EXISTS ignore_replay"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM diagnostic_reports"),
    env.DB.prepare("DELETE FROM replays"),
  ]);
  await resetTestCredential();
});

async function digest(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function objectBytes(key: string): Promise<Uint8Array> {
  const object = await env.CAPTURES.get(key);
  return new Uint8Array(await new Response(object!.body).arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function enrollmentChallenge(options: { purpose?: "ios-enroll" | "session"; keyId?: string } = {}) {
  const response = await challenge(
    new Request("https://worker.test/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${++sequence}` },
      body: JSON.stringify({
        purpose: options.purpose ?? "ios-enroll",
        buildId: "build+dirty",
        ...(options.keyId ? { keyId: options.keyId } : {}),
      }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { challengeToken: string }).challengeToken;
}

function enrollmentRequest(keyId: string, challengeToken: string): Request {
  return new Request("https://worker.test/api/auth/ios/enroll", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${++sequence}` },
    body: JSON.stringify({
      keyId,
      attestation: base64Url(new Uint8Array([1, 2, 3])),
      challengeToken,
      buildId: "build+dirty",
    }),
  });
}

function syntheticAttestation(
  options: {
    appId?: string;
    publicKeyByte?: number;
    environment?: "development" | "production";
    bundleVersion?: string;
  } = {},
) {
  return vi.fn<(input: VerifyAttestationOptions) => Promise<VerifiedAttestation>>(async () => ({
    appId: options.appId ?? "TESTTEAM1.com.phejet.dubaicmd.dev",
    publicKeySpki: new Uint8Array([options.publicKeyByte ?? 1, 2, 3]),
    publicKeyRaw: new Uint8Array(65),
    appleEnvironment: options.environment ?? ("development" as const),
    assertionCounter: 0 as const,
    validationCategory: 1,
    bundleVersion: options.bundleVersion ?? "1",
  }));
}

async function post(
  kind: "session" | "report",
  body: ReturnType<typeof sessionFixture> | ReturnType<typeof reportFixture>,
  options: {
    gzip?: boolean;
    encoding?: string;
    origin?: string;
    preserveInstall?: boolean;
    sha?: string;
    wire?: Uint8Array;
    authenticated?: boolean;
    authHeaders?: Record<string, string>;
    ip?: string;
    proofSha?: string;
  } = {},
): Promise<Response> {
  if (!options.preserveInstall) body.meta.installId = installId;
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-dmc-build": body.meta.buildId,
    "x-dmc-install": body.meta.installId ?? "",
    "x-dmc-sha256": options.sha ?? (await digest(raw)),
  });
  if (options.authenticated !== false) {
    const authHeaders =
      options.authHeaders ?? (await captureAuthHeaders(kind, options.proofSha ?? (await digest(raw))));
    for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);
  }
  headers.set("cf-connecting-ip", options.ip ?? `203.0.${sequence}.1`);
  if (options.encoding) headers.set("Content-Encoding", options.encoding);
  else if (options.gzip) headers.set("Content-Encoding", "gzip");
  if (options.origin) headers.set("Origin", options.origin);
  return SELF.fetch(`https://worker.test/api/${kind}`, {
    method: "POST",
    headers,
    body: options.wire ?? (options.gzip ? await gzip(raw) : raw),
  });
}

const DELETE_FIELD = Symbol("delete field");

function mutateAtPath(value: unknown, path: string, replacement: unknown): void {
  const parts = path.split(".");
  let cursor = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  const key = parts[parts.length - 1];
  if (replacement === DELETE_FIELD) delete cursor[key];
  else cursor[key] = replacement;
}

describe("capture Worker split", () => {
  it("reports schema 2 health", async () => {
    const response = await SELF.fetch("https://worker.test/api/health");
    expect(await response.json()).toEqual({ ok: true, schema: 2, build: "dev" });
  });

  it("stores a session row and only its content-addressed replay object", async () => {
    const session = sessionFixture();
    const response = await post("session", session, { gzip: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, id: "run", replaySha256: session.meta.replaySha256 });
    expect(await env.DB.prepare("SELECT run_id, replay_verified, app_flavor FROM sessions").first()).toEqual({
      run_id: "run",
      replay_verified: 0,
      app_flavor: "dev",
    });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM diagnostic_reports").first<{ count: number }>())!.count,
    ).toBe(0);
    const replay = await env.CAPTURES.get(`replays/${session.meta.replaySha256}.json.gz`);
    expect(replay).not.toBeNull();
    const decoded = await gunzip(new Uint8Array(await new Response(replay!.body).arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual(session.replay);
    expect(new TextDecoder().decode(decoded)).not.toContain('"events"');
  });

  it("self-heals legacy credential identity and records attested Dev provenance", async () => {
    const current = await currentTestCredential();
    await env.DB.prepare("UPDATE app_attest_credentials SET apple_app_id = NULL WHERE key_id_hash = ?")
      .bind(current.keyIdHash)
      .run();

    expect((await post("session", sessionFixture({ runId: "legacy-provenance" }))).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT apple_app_id FROM app_attest_credentials WHERE key_id_hash = ?")
        .bind(current.keyIdHash)
        .first(),
    ).toEqual({ apple_app_id: "TESTTEAM1.com.phejet.dubaicmd.dev" });
    expect(
      await env.DB.prepare(
        "SELECT app_flavor, apple_bundle_id, apple_environment FROM sessions WHERE run_id = 'legacy-provenance'",
      ).first(),
    ).toEqual({
      app_flavor: "dev",
      apple_bundle_id: "com.phejet.dubaicmd.dev",
      apple_environment: "development",
    });
  });

  it("rejects an assertion whose attested app ID conflicts with the stored credential identity", async () => {
    const current = await currentTestCredential();
    await env.DB.prepare("UPDATE app_attest_credentials SET apple_app_id = ? WHERE key_id_hash = ?")
      .bind("TESTTEAM1.com.phejet.dubaicmd.staging", current.keyIdHash)
      .run();
    const response = await post("session", sessionFixture({ runId: "cross-flavor" }));
    expect(response.status).toBe(401);
    expect(await env.DB.prepare("SELECT run_id FROM sessions WHERE run_id = 'cross-flavor'").first()).toBeNull();
  });

  it("rejects a valid capture without App Attest proof before any D1 or R2 write", async () => {
    const objectsBefore = (await env.CAPTURES.list()).objects.map(({ key }) => key);
    const response = await post("session", sessionFixture(), { authenticated: false });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, stage: "auth", message: "Unauthorized" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM replays").first<{ count: number }>())!.count).toBe(0);
    expect((await env.CAPTURES.list()).objects.map(({ key }) => key)).toEqual(objectsBefore);
  });

  it("rejects proof replay, body substitution, route transfer, and revoked credentials", async () => {
    const session = sessionFixture({ runId: "proof-run" });
    session.meta.installId = installId;
    const sessionRaw = new TextEncoder().encode(JSON.stringify(session));
    const proof = await captureAuthHeaders("session", await digest(sessionRaw));
    expect(
      (await post("session", structuredClone(session), { authHeaders: proof, preserveInstall: true })).status,
    ).toBe(200);
    expect(
      (await post("session", structuredClone(session), { authHeaders: proof, preserveInstall: true })).status,
    ).toBe(401);

    const tampered = sessionFixture({ runId: "tampered-run" });
    tampered.meta.installId = installId;
    const untamperedSha = await digest(new TextEncoder().encode(JSON.stringify(tampered)));
    tampered.summary.score += 1;
    expect((await post("session", tampered, { proofSha: untamperedSha, preserveInstall: true })).status).toBe(401);

    const report = reportFixture({ reportId: "route-transfer" });
    report.meta.installId = installId;
    const reportSha = await digest(new TextEncoder().encode(JSON.stringify(report)));
    const wrongRouteProof = await captureAuthHeaders("session", reportSha);
    expect((await post("report", report, { authHeaders: wrongRouteProof, preserveInstall: true })).status).toBe(401);

    const revokedReport = reportFixture({ reportId: "revoked" });
    revokedReport.meta.installId = installId;
    const revokedProof = await captureAuthHeaders(
      "report",
      await digest(new TextEncoder().encode(JSON.stringify(revokedReport))),
    );
    const { keyIdHash } = await currentTestCredential();
    await env.DB.prepare("UPDATE app_attest_credentials SET status = 'revoked', revoked_at = 1 WHERE key_id_hash = ?")
      .bind(keyIdHash)
      .run();
    expect((await post("report", revokedReport, { authHeaders: revokedProof, preserveInstall: true })).status).toBe(
      401,
    );
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM diagnostic_reports").first<{ count: number }>())!.count,
    ).toBe(0);
  });

  it("rejects an expired proof or a token moved between Worker environments", async () => {
    const session = sessionFixture({ runId: "environment-run" });
    session.meta.installId = installId;
    const raw = new TextEncoder().encode(JSON.stringify(session));
    const bodySha = await digest(raw);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const proof = await captureAuthHeaders("session", bodySha);

    now.mockReturnValue(121_001);
    expect(
      (await post("session", structuredClone(session), { authHeaders: proof, preserveInstall: true })).status,
    ).toBe(401);

    now.mockReturnValue(1_000);
    const environmentProof = await captureAuthHeaders("session", bodySha);
    const response = await ingestSession(
      new Request("https://worker.test/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dmc-build": session.meta.buildId,
          "x-dmc-install": session.meta.installId,
          "x-dmc-sha256": bodySha,
          ...environmentProof,
        },
        body: raw,
      }),
      {
        ...env,
        WORKER_BUILD: "production",
        APPLE_BUNDLE_IDS: "com.phejet.dubaicmd",
        APPLE_ATTEST_ENVIRONMENTS: "production",
      } as unknown as Env,
    );
    expect(response.status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
    now.mockRestore();
  });

  it("keeps enrollment closed by policy and requires operator auth for revocation", async () => {
    const disabledEnrollment = await worker.fetch(
      new Request("https://worker.test/api/auth/ios/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { ...env, ENROLLMENT_ENABLED: "false" } as unknown as Env,
    );
    expect(disabledEnrollment.status).toBe(403);

    const { keyId, keyIdHash } = await currentTestCredential();
    const revokeBody = JSON.stringify({ keyIdHash });
    expect(
      (
        await SELF.fetch("https://worker.test/api/auth/ios/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: revokeBody,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await SELF.fetch("https://worker.test/api/auth/ios/revoke", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
          body: revokeBody,
        })
      ).status,
    ).toBe(200);
    const challengeAfterRevocation = await SELF.fetch("https://worker.test/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "session", keyId, buildId: "build+dirty" }),
    });
    expect(challengeAfterRevocation.status).toBe(401);
  });

  it("enrolls through the HTTP handler with the exact canonical client-data hash and accepts overlapping builds", async () => {
    const keyId = base64(new Uint8Array(32).fill(7));
    const challengeToken = await enrollmentChallenge();
    const verifyAttestation = syntheticAttestation({ bundleVersion: "2" });
    const response = await enroll(enrollmentRequest(keyId, challengeToken), env, { verifyAttestation });

    expect(response.status).toBe(200);
    const input = verifyAttestation.mock.calls[0][0];
    const canonicalClientData = enrollmentClientData(challengeToken);
    const canonicalBuffer = canonicalClientData.buffer.slice(
      canonicalClientData.byteOffset,
      canonicalClientData.byteOffset + canonicalClientData.byteLength,
    ) as ArrayBuffer;
    const expectedHash = new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBuffer));
    expect(input.clientDataHash).toEqual(expectedHash);
    expect(input.allowedBundleVersions).toEqual(new Set(["1", "2"]));
    expect(
      await env.DB.prepare(
        "SELECT apple_environment, apple_app_id, status FROM app_attest_credentials WHERE key_id_hash = ?",
      )
        .bind(((await response.json()) as { keyIdHash: string }).keyIdHash)
        .first(),
    ).toEqual({
      apple_environment: "development",
      apple_app_id: "TESTTEAM1.com.phejet.dubaicmd.dev",
      status: "active",
    });
  });

  it("makes enrollment idempotent but refuses conflicting or revoked credential reuse", async () => {
    const keyId = base64(new Uint8Array(32).fill(8));
    const original = syntheticAttestation();
    const firstResponse = await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, {
      verifyAttestation: original,
    });
    expect(firstResponse.status).toBe(200);
    const { keyIdHash } = (await firstResponse.json()) as { keyIdHash: string };
    expect(
      (await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, { verifyAttestation: original }))
        .status,
    ).toBe(200);
    expect(
      (
        await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, {
          verifyAttestation: syntheticAttestation({ publicKeyByte: 9 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, {
          verifyAttestation: syntheticAttestation({ appId: "TESTTEAM1.com.phejet.dubaicmd.staging" }),
        })
      ).status,
    ).toBe(409);

    await env.DB.prepare("UPDATE app_attest_credentials SET status = 'revoked' WHERE key_id_hash = ?")
      .bind(keyIdHash)
      .run();
    expect(
      (await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, { verifyAttestation: original }))
        .status,
    ).toBe(409);
  });

  it("rejects wrong-purpose, expired, cross-environment, and disallowed-version enrollment", async () => {
    const rowsBefore = (await env.DB.prepare("SELECT COUNT(*) AS count FROM app_attest_credentials").first<{
      count: number;
    }>())!.count;
    const objectsBefore = (await env.CAPTURES.list()).objects.map(({ key }) => key);
    const keyId = base64(new Uint8Array(32).fill(9));
    const existing = await currentTestCredential();
    const wrongPurpose = await enrollmentChallenge({ purpose: "session", keyId: existing.keyId });
    expect(
      (await enroll(enrollmentRequest(keyId, wrongPurpose), env, { verifyAttestation: syntheticAttestation() })).status,
    ).toBe(401);

    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const expired = await enrollmentChallenge();
    clock.mockReturnValue(121_001);
    expect(
      (await enroll(enrollmentRequest(keyId, expired), env, { verifyAttestation: syntheticAttestation() })).status,
    ).toBe(401);
    clock.mockRestore();

    expect(
      (
        await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, {
          verifyAttestation: syntheticAttestation({ environment: "production" }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await enroll(enrollmentRequest(keyId, await enrollmentChallenge()), env, {
          verifyAttestation: syntheticAttestation({ bundleVersion: "3" }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM app_attest_credentials").first<{ count: number }>())!.count,
    ).toBe(rowsBefore);
    expect((await env.CAPTURES.list()).objects.map(({ key }) => key)).toEqual(objectsBefore);
  });

  it("stores a replay-less session and retrieves an explicit null replay", async () => {
    const session = sessionFixture({ replay: null });
    expect((await post("session", session)).status).toBe(200);
    const response = await SELF.fetch("https://worker.test/api/session/run", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      session: { replay_sha256: null, app_flavor: "dev" },
      provenance: {
        appFlavor: "dev",
        bundleId: "com.phejet.dubaicmd.dev",
        appleEnvironment: "development",
      },
      replay: null,
    });
  });

  it("stores report diagnostics separately and semantically reassembles the replay", async () => {
    const report = reportFixture();
    const response = await post("report", report);
    expect(response.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM diagnostic_reports WHERE report_id = ?")
      .bind(report.reportId)
      .first<{ r2_key: string; sha256: string }>();
    expect(row).not.toBeNull();
    const object = await env.CAPTURES.get(row!.r2_key);
    const decoded = await gunzip(new Uint8Array(await new Response(object!.body).arrayBuffer()));
    const stored = JSON.parse(new TextDecoder().decode(decoded)) as Record<string, unknown>;
    expect(stored.events).toEqual(report.events);
    expect(stored).not.toHaveProperty("replay");
    expect(await digest(decoded)).toBe(row!.sha256);

    const retrieved = await SELF.fetch(`https://worker.test/api/report/${report.reportId}`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual({
      ...report,
      provenance: {
        appFlavor: "dev",
        bundleId: "com.phejet.dubaicmd.dev",
        appleEnvironment: "development",
      },
    });
  });

  it("deduplicates a report and session replay while preserving the longer window", async () => {
    const report = reportFixture();
    expect((await post("report", report)).status).toBe(200);
    await env.DB.prepare("UPDATE replays SET last_referenced_at = 1").run();
    const session = sessionFixture();
    session.meta.installId = installId;
    expect((await post("session", session)).status).toBe(200);
    const after = await env.DB.prepare("SELECT last_referenced_at FROM replays").first<{
      last_referenced_at: number;
    }>();
    expect(after!.last_referenced_at).toBeGreaterThan(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM replays").first<{ count: number }>())!.count).toBe(1);
    const stored = await env.CAPTURES.get(`replays/${session.meta.replaySha256}.json.gz`);
    const decoded = await gunzip(new Uint8Array(await new Response(stored!.body).arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decoded))).toMatchObject({
      _buildId: "build+dirty",
      _savedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(JSON.parse(new TextDecoder().decode(decoded))).not.toHaveProperty("_env");
  });

  it("stores identical rows and object bytes for plain and gzipped retries", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      const session = sessionFixture({ runId: "encoding-run" });
      expect((await post("session", session)).status).toBe(200);
      const sessionRow = await env.DB.prepare("SELECT * FROM sessions WHERE run_id = ?")
        .bind(session.meta.runId)
        .first();
      const replayRow = await env.DB.prepare("SELECT * FROM replays WHERE replay_sha256 = ?")
        .bind(session.meta.replaySha256)
        .first();
      const replayKey = `replays/${session.meta.replaySha256}.json.gz`;
      const replayBefore = await objectBytes(replayKey);
      const sessionRetry = await post("session", structuredClone(session), { gzip: true });
      expect(await sessionRetry.json()).toMatchObject({ ok: true, encoding: "gzip" });
      expect(await env.DB.prepare("SELECT * FROM sessions WHERE run_id = ?").bind(session.meta.runId).first()).toEqual(
        sessionRow,
      );
      expect(
        await env.DB.prepare("SELECT * FROM replays WHERE replay_sha256 = ?").bind(session.meta.replaySha256).first(),
      ).toEqual(replayRow);
      expect(await objectBytes(replayKey)).toEqual(replayBefore);

      const report = reportFixture({ reportId: "encoding-report" });
      expect((await post("report", report)).status).toBe(200);
      const reportRow = await env.DB.prepare("SELECT * FROM diagnostic_reports WHERE report_id = ?")
        .bind(report.reportId)
        .first<{ r2_key: string }>();
      const reportBefore = await objectBytes(reportRow!.r2_key);
      const reportRetry = await post("report", structuredClone(report), { gzip: true });
      expect(await reportRetry.json()).toMatchObject({ ok: true, encoding: "gzip" });
      expect(
        await env.DB.prepare("SELECT * FROM diagnostic_reports WHERE report_id = ?").bind(report.reportId).first(),
      ).toEqual(reportRow);
      expect(await objectBytes(reportRow!.r2_key)).toEqual(reportBefore);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects diagnostics keys on sessions without writing anything", async () => {
    const session = sessionFixture() as unknown as ReturnType<typeof sessionFixture> & { events: unknown[] };
    session.events = [];
    const response = await post("session", session);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage: "parse" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM replays").first<{ count: number }>())!.count).toBe(0);
  });

  it.each([
    ["missing platform", "meta.platform", DELETE_FIELD, false],
    ["score string", "summary.score", "900", false],
    ["score NaN", "summary.score", Number.NaN, false],
    ["score Infinity", "summary.score", Infinity, false],
    ["negative score", "summary.score", -1, false],
    ["low hit ratio", "summary.hitRatio", -0.01, false],
    ["high hit ratio", "summary.hitRatio", 1.01, false],
    ["unknown trigger", "meta.trigger", "timer", false],
    ["unknown screen", "meta.appScreen", "paused", false],
    ["unknown replay source", "meta.replaySource", "archive", false],
    ["unknown outcome", "summary.outcome", "escaped", false],
    ["over-cap note", "meta.note", "n".repeat(2_001), false],
    ["unsafe run ID", "meta.runId", "../../run", false],
    ["null install ID", "meta.installId", null, true],
    ["empty install ID", "meta.installId", "", true],
  ] as const)("rejects hostile payload: %s", async (_name, path, replacement, preserveInstall) => {
    const replay = replayFixture();
    replay.seed = 10_000 + sequence;
    const session = sessionFixture({ replay });
    mutateAtPath(session, path, replacement);
    const replayObjectsBefore = (await env.CAPTURES.list({ prefix: "replays/" })).objects.map(({ key }) => key);
    const reportObjectsBefore = (await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map(({ key }) => key);
    const response = await post("session", session, { preserveInstall });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage: "parse" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM replays").first<{ count: number }>())!.count).toBe(0);
    expect((await env.CAPTURES.list({ prefix: "replays/" })).objects.map(({ key }) => key)).toEqual(
      replayObjectsBefore,
    );
    expect((await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map(({ key }) => key)).toEqual(
      reportObjectsBefore,
    );
  });

  it("keeps report IDs immutable across retries and collisions", async () => {
    const report = reportFixture();
    expect((await post("report", report)).status).toBe(200);
    expect((await post("report", structuredClone(report), { gzip: true })).status).toBe(200);
    const original = await env.DB.prepare("SELECT sha256, r2_key FROM diagnostic_reports").first<{
      sha256: string;
      r2_key: string;
    }>();
    const before = await env.CAPTURES.get(original!.r2_key);
    const beforeBytes = new Uint8Array(await new Response(before!.body).arrayBuffer());
    report.meta.note = "different bytes";
    const collision = await post("report", report);
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ stage: "conflict" });
    expect(await env.DB.prepare("SELECT sha256, r2_key FROM diagnostic_reports").first()).toEqual(original);
    const object = await env.CAPTURES.get(original!.r2_key);
    expect(object!.customMetadata?.sha256).toBe(original!.sha256);
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(beforeBytes);
  });

  it("prevents another verified credential from replacing a report or its object", async () => {
    const report = reportFixture({ reportId: "owned-report" });
    expect((await post("report", report)).status).toBe(200);
    const original = await env.DB.prepare(
      "SELECT submitter_key_id_hash, sha256, r2_key FROM diagnostic_reports WHERE report_id = ?",
    )
      .bind(report.reportId)
      .first<{ submitter_key_id_hash: string; sha256: string; r2_key: string }>();
    const originalBytes = await objectBytes(original!.r2_key);
    const objectsBefore = (await env.CAPTURES.list({ prefix: "diagnostics/auth/" })).objects.map(({ key }) => key);

    await addTestCredential();
    report.meta.note = "different owner and bytes";
    const collision = await post("report", report);
    expect(collision.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT submitter_key_id_hash, sha256, r2_key FROM diagnostic_reports WHERE report_id = ?")
        .bind(report.reportId)
        .first(),
    ).toEqual(original);
    expect(await objectBytes(original!.r2_key)).toEqual(originalBytes);
    expect((await env.CAPTURES.list({ prefix: "diagnostics/auth/" })).objects.map(({ key }) => key)).toEqual(
      objectsBefore,
    );
  });

  it("serializes same-counter report retries at the Worker boundary", async () => {
    const report = reportFixture({ reportId: "concurrent-report" });
    const [first, second] = await Promise.all([
      post("report", structuredClone(report)),
      post("report", structuredClone(report), { gzip: true }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 401]);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM diagnostic_reports").first<{ count: number }>())!.count,
    ).toBe(1);
  });

  it("accepts one same-counter session and rejects the racing proof", async () => {
    const first = sessionFixture({ runId: "concurrent-run" });
    const alternateReplay = structuredClone(first.replay!);
    alternateReplay.seed += 1;
    const second = sessionFixture({ runId: "concurrent-run", replay: alternateReplay });
    const responses = await Promise.all([post("session", first), post("session", second, { gzip: true })]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const committed = await env.DB.prepare("SELECT replay_sha256 FROM sessions WHERE run_id = ?")
      .bind("concurrent-run")
      .first<{ replay_sha256: string }>();
    expect([first.meta.replaySha256, second.meta.replaySha256]).toContain(committed!.replay_sha256);
  });

  it("keeps authenticated sessions immutable even when replacement replay insertion is ignored", async () => {
    const original = sessionFixture({ runId: "guarded-run" });
    expect((await post("session", original)).status).toBe(200);
    const alternateReplay = structuredClone(original.replay!);
    alternateReplay.seed += 99;
    const replacement = sessionFixture({ runId: "guarded-run", replay: alternateReplay });
    await env.DB.prepare(
      `CREATE TRIGGER ignore_replay BEFORE INSERT ON replays
       WHEN NEW.replay_sha256 = '${replacement.meta.replaySha256}'
       BEGIN SELECT RAISE(IGNORE); END`,
    ).run();
    const response = await post("session", replacement);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, stage: "conflict" });
    expect(
      await env.DB.prepare("SELECT replay_sha256 FROM sessions WHERE run_id = ?").bind("guarded-run").first(),
    ).toEqual({
      replay_sha256: original.meta.replaySha256,
    });
  });

  it("repairs a missing report object on an exact retry", async () => {
    const report = reportFixture({ reportId: "repair-report" });
    expect((await post("report", report)).status).toBe(200);
    const row = await env.DB.prepare("SELECT r2_key FROM diagnostic_reports WHERE report_id = ?")
      .bind(report.reportId)
      .first<{ r2_key: string }>();
    await env.CAPTURES.delete(row!.r2_key);
    expect(await env.CAPTURES.head(row!.r2_key)).toBeNull();
    expect((await post("report", structuredClone(report), { gzip: true })).status).toBe(200);
    expect((await env.CAPTURES.head(row!.r2_key))?.customMetadata?.reportId).toBe(report.reportId);
  });

  it("unconditionally restores a content-addressed object on a later reference", async () => {
    const session = sessionFixture();
    expect((await post("session", session)).status).toBe(200);
    const key = `replays/${session.meta.replaySha256}.json.gz`;
    await env.CAPTURES.delete(key);
    expect(await env.CAPTURES.head(key)).toBeNull();
    expect((await post("report", reportFixture({ reportId: "second-ref" }))).status).toBe(200);
    expect(await env.CAPTURES.head(key)).not.toBeNull();
  });

  it("collects expired rows without deleting replay or diagnostics objects", async () => {
    const session = sessionFixture();
    expect((await post("session", session)).status).toBe(200);
    const report = reportFixture({ reportId: "retained-object" });
    expect((await post("report", report)).status).toBe(200);
    const replayKey = `replays/${session.meta.replaySha256}.json.gz`;
    const reportKey = (await env.DB.prepare(
      "SELECT r2_key FROM diagnostic_reports WHERE report_id = 'retained-object'",
    ).first<{
      r2_key: string;
    }>())!.r2_key;
    await env.DB.prepare("UPDATE sessions SET received_at = 1").run();
    await env.DB.prepare("UPDATE diagnostic_reports SET received_at = 1").run();
    await runRetention(env, 9_000_000_000_000);
    expect(await env.DB.prepare("SELECT run_id FROM sessions").first()).toBeNull();
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
    expect(await env.CAPTURES.head(replayKey)).not.toBeNull();
    expect(await env.CAPTURES.head(reportKey)).not.toBeNull();
  });

  it("distinguishes expired and missing replay evidence without hiding the session", async () => {
    const expired = sessionFixture({ runId: "expired-run" });
    expect((await post("session", expired)).status).toBe(200);
    await env.DB.prepare("DELETE FROM replays WHERE replay_sha256 = ?").bind(expired.meta.replaySha256).run();
    const expiredResponse = await SELF.fetch("https://worker.test/api/session/expired-run", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(expiredResponse.status).toBe(200);
    expect(await expiredResponse.json()).toMatchObject({ replay: null, replayStatus: "expired" });

    const missing = sessionFixture({ runId: "missing-run" });
    expect((await post("session", missing)).status).toBe(200);
    await env.CAPTURES.delete(`replays/${missing.meta.replaySha256}.json.gz`);
    const missingResponse = await SELF.fetch("https://worker.test/api/session/missing-run", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(missingResponse.status).toBe(200);
    expect(await missingResponse.json()).toMatchObject({ replay: null, replayStatus: "missing" });
  });

  it("keeps the replay bump and referring row atomic on D1 failure", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'forced'); END",
    ).run();
    const response = await post("session", sessionFixture());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ stage: "store" });
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
  });

  it("requires bearer auth for every retrieval/list route", async () => {
    await post("session", sessionFixture());
    await post("report", reportFixture({ reportId: "report-auth" }));
    const sha = sessionFixture().meta.replaySha256;
    for (const path of [
      "/api/sessions",
      "/api/reports",
      "/api/session/run",
      "/api/report/report-auth",
      `/api/replay/${sha}`,
    ]) {
      expect((await SELF.fetch(`https://worker.test${path}`)).status).toBe(401);
      expect(
        (
          await SELF.fetch(`https://worker.test${path}`, {
            headers: { Authorization: "Bearer test-secret", Origin: "https://phejet.github.io" },
          })
        ).status,
      ).toBe(200);
    }
  });

  it("lists and filters capture rows by server-derived app flavor", async () => {
    await post("session", sessionFixture({ runId: "dev-filter" }));
    const headers = { Authorization: "Bearer test-secret" };
    const devResponse = await SELF.fetch("https://worker.test/api/sessions?flavor=dev", { headers });
    expect(devResponse.status).toBe(200);
    expect(await devResponse.json()).toMatchObject({
      sessions: [
        {
          run_id: "dev-filter",
          app_flavor: "dev",
          apple_bundle_id: "com.phejet.dubaicmd.dev",
          apple_environment: "development",
        },
      ],
    });
    const stagingResponse = await SELF.fetch("https://worker.test/api/sessions?flavor=staging", { headers });
    expect(await stagingResponse.json()).toMatchObject({ sessions: [] });
  });

  it("allows only configured origins on both ingest routes", async () => {
    for (const route of ["session", "report"]) {
      const allowed = await SELF.fetch(`https://worker.test/api/${route}`, {
        method: "OPTIONS",
        headers: { Origin: "capacitor://localhost" },
      });
      expect(allowed.status).toBe(204);
      const denied = await SELF.fetch(`https://worker.test/api/${route}`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      });
      expect(denied.status).toBe(403);
    }
  });

  it("rejects methods and each ingest rung without writing state", async () => {
    const replayObjectsBefore = (await env.CAPTURES.list({ prefix: "replays/" })).objects.map(({ key }) => key);
    const reportObjectsBefore = (await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map(({ key }) => key);
    for (const route of ["session", "report"] as const) {
      const response = await SELF.fetch(`https://worker.test/api/${route}`, { method: "GET" });
      expect(response.status).toBe(405);
      expect(await response.json()).toMatchObject({ ok: false, stage: "parse" });
    }

    const unsupported = await post("session", sessionFixture(), { encoding: "br" });
    expect(await unsupported.json()).toMatchObject({ ok: false, stage: "compress" });

    const garbage = new TextEncoder().encode("not gzip");
    const invalidGzip = await post("session", sessionFixture(), { gzip: true, wire: garbage });
    expect(await invalidGzip.json()).toMatchObject({ ok: false, stage: "compress" });

    const wrongHash = await post("session", sessionFixture(), { sha: "0".repeat(64) });
    expect(await wrongHash.json()).toMatchObject({ ok: false, stage: "hash" });

    const invalidJson = new TextEncoder().encode("not json");
    const invalidParse = await post("session", sessionFixture(), {
      wire: invalidJson,
      sha: await digest(invalidJson),
    });
    expect(await invalidParse.json()).toMatchObject({ ok: false, stage: "parse" });

    const oversized = await SELF.fetch("https://worker.test/api/session", {
      method: "POST",
      headers: { "content-length": String(MAX_COMPRESSED_BYTES + 1) },
      body: new Uint8Array(),
    });
    expect(await oversized.json()).toMatchObject({ ok: false, stage: "size" });

    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM diagnostic_reports").first<{ count: number }>())!.count,
    ).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM replays").first<{ count: number }>())!.count).toBe(0);
    expect((await env.CAPTURES.list({ prefix: "replays/" })).objects.map(({ key }) => key)).toEqual(
      replayObjectsBefore,
    );
    expect((await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map(({ key }) => key)).toEqual(
      reportObjectsBefore,
    );
  });

  it("applies the shared unauthenticated IP limit before decompression", async () => {
    const garbage = new TextEncoder().encode("not gzip");
    const ip = `198.51.${sequence}.10`;
    const sessionResponses: Response[] = [];
    for (let index = 0; index < 60; index += 1) {
      sessionResponses.push(
        await post("session", sessionFixture(), {
          gzip: true,
          wire: garbage,
          authenticated: false,
          ip,
        }),
      );
    }
    for (const response of sessionResponses) {
      expect(await response.json()).toMatchObject({ stage: "compress" });
    }
    const blocked = await post("report", reportFixture(), {
      gzip: true,
      wire: garbage,
      authenticated: false,
      ip,
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ stage: "rate" });
  });

  it("cancels decoded input immediately after crossing its cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBounded(source, MAX_DECODED_BYTES, "decoded body")).rejects.toThrow("exceeds");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(10);
  });

  it("runs retention through the scheduled handler", async () => {
    const session = sessionFixture();
    await post("session", session);
    await env.DB.prepare("UPDATE sessions SET received_at = 1").run();
    const controller = createScheduledController({ scheduledTime: 9_000_000_000_000 });
    const context = createExecutionContext();
    worker.scheduled(controller as never, env, context);
    await waitOnExecutionContext(context);
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
    expect(await env.CAPTURES.head(`replays/${session.meta.replaySha256}.json.gz`)).not.toBeNull();
  });
});
