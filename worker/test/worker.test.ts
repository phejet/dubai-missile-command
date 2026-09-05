import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_COMPRESSED_BYTES, MAX_DECODED_BYTES } from "../../src/capture-contract";
import { enrollmentClientData } from "../../src/capture-auth-protocol";
import { replayFixture, reportFixture, sessionFixture } from "../../test-fixtures/capture";
import type { VerifiedAttestation, VerifyAttestationOptions } from "../src/app-attest";
import worker, { runRetention } from "../src/index";
import type { Env } from "../src/bindings";
import { challenge, enroll } from "../src/capture-auth";
import { buildDeletionPlan, deletionPlanDigest, executeDeletionJob, handleDeletion } from "../src/deletion";
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
    env.DB.prepare("DELETE FROM replay_deletion_locks"),
    env.DB.prepare("DELETE FROM operator_deletion_scope_locks"),
    env.DB.prepare("DELETE FROM replay_write_reservations"),
    env.DB.prepare("DELETE FROM capture_write_reservations"),
    env.DB.prepare("DELETE FROM operator_deletions"),
    env.DB.prepare("DELETE FROM capture_deletion_tombstones"),
    env.DB.prepare("DELETE FROM shared_runs"),
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

async function postShare(
  runId: string,
  options: { authenticated?: boolean; buildId?: string; origin?: string; proofSha?: string } = {},
): Promise<Response> {
  const body = JSON.stringify({ runId, buildId: options.buildId ?? "build+dirty" });
  const bytes = new TextEncoder().encode(body);
  const bodySha = await digest(bytes);
  const headers = new Headers({
    "content-type": "application/json",
    "x-dmc-build": options.buildId ?? "build+dirty",
    "x-dmc-sha256": bodySha,
    "cf-connecting-ip": `203.0.${sequence}.2`,
  });
  if (options.origin) headers.set("origin", options.origin);
  if (options.authenticated !== false) {
    const proof = await captureAuthHeaders("share", options.proofSha ?? bodySha);
    for (const [name, value] of Object.entries(proof)) headers.set(name, value);
  }
  return SELF.fetch("https://worker.test/api/share", { method: "POST", headers, body: bytes });
}

async function postFeedback(
  runId: string,
  emoji: string,
  options: {
    authenticated?: boolean;
    buildId?: string;
    proofSha?: string;
    extra?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  const body = JSON.stringify({ runId, buildId: options.buildId ?? "build+dirty", emoji, ...options.extra });
  const bytes = new TextEncoder().encode(body);
  const bodySha = await digest(bytes);
  const headers = new Headers({
    "content-type": "application/json",
    "x-dmc-build": options.buildId ?? "build+dirty",
    "x-dmc-sha256": bodySha,
    "cf-connecting-ip": `203.0.${sequence}.3`,
  });
  if (options.authenticated !== false) {
    const proof = await captureAuthHeaders("feedback", options.proofSha ?? bodySha);
    for (const [name, value] of Object.entries(proof)) headers.set(name, value);
  }
  return SELF.fetch("https://worker.test/api/feedback", { method: "POST", headers, body: bytes });
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

  it("publishes only an owner-authorized session and resolves its replay through a stable link", async () => {
    const session = sessionFixture({ runId: "shareable-run" });
    expect((await post("session", session)).status).toBe(200);

    const first = await postShare(session.meta.runId, { origin: "capacitor://localhost" });
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    const shared = (await first.json()) as { shareId: string; shareUrl: string };
    expect(shared.shareId).toMatch(/^[a-f0-9]{16}$/);
    expect(shared.shareUrl).toBe(`https://worker.test/r/${shared.shareId}`);
    expect(
      await env.DB.prepare("SELECT shared FROM sessions WHERE run_id = ?").bind(session.meta.runId).first(),
    ).toEqual({
      shared: 1,
    });

    const publicReplay = await SELF.fetch(`https://worker.test/api/shared/${shared.shareId}`);
    expect(publicReplay.status).toBe(200);
    expect(publicReplay.headers.get("access-control-allow-origin")).toBe("*");
    expect(await publicReplay.json()).toMatchObject({
      ok: true,
      shareId: shared.shareId,
      summary: { score: session.summary.score, wave: session.summary.waveReached, build: session.meta.buildId },
      replay: session.replay,
    });

    const repeated = (await (await postShare(session.meta.runId)).json()) as { shareId: string };
    expect(repeated.shareId).toBe(shared.shareId);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM shared_runs").first<{ count: number }>())!.count).toBe(
      1,
    );

    const redirect = await worker.fetch(
      new Request(`https://worker.test/r/${shared.shareId}`, { redirect: "manual" }),
      { ...env, WORKER_BUILD: "staging" } as unknown as Env,
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(
      `https://phejet.github.io/dubai-missile-command/?r=${shared.shareId}&share=staging`,
    );
  });

  it("returns 410 when an in-policy public mapping loses its replay object", async () => {
    const session = sessionFixture({ runId: "missing-public-replay" });
    expect((await post("session", session)).status).toBe(200);
    const shared = (await (await postShare(session.meta.runId)).json()) as { shareId: string };
    await env.CAPTURES.delete(`replays/${session.meta.replaySha256}.json.gz`);

    expect((await SELF.fetch(`https://worker.test/api/shared/${shared.shareId}`)).status).toBe(410);
    const redirect = await worker.fetch(
      new Request(`https://worker.test/r/${shared.shareId}`, { redirect: "manual" }),
      { ...env, WORKER_BUILD: "staging" } as unknown as Env,
    );
    expect(redirect.status).toBe(410);
  });

  it("keeps unshared, replay-less, foreign-owned, and tampered sessions private", async () => {
    const privateSession = sessionFixture({ runId: "private-run" });
    expect((await post("session", privateSession)).status).toBe(200);
    expect((await SELF.fetch("https://worker.test/api/shared/0000000000000000")).status).toBe(404);

    const replayless = sessionFixture({ runId: "replayless-share", replay: null });
    expect((await post("session", replayless)).status).toBe(200);
    expect((await postShare(replayless.meta.runId)).status).toBe(409);

    const ownerRun = sessionFixture({ runId: "owner-run" });
    expect((await post("session", ownerRun)).status).toBe(200);
    await addTestCredential();
    expect((await postShare(ownerRun.meta.runId)).status).toBe(403);

    const tampered = await postShare(privateSession.meta.runId, { proofSha: "0".repeat(64) });
    expect(tampered.status).toBe(401);
    expect((await postShare(privateSession.meta.runId, { authenticated: false })).status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM shared_runs").first<{ count: number }>())!.count).toBe(
      0,
    );
  });

  it("stores only owner-authorized feedback from the reserved emoji set", async () => {
    const session = sessionFixture({ runId: "feedback-run" });
    expect((await post("session", session)).status).toBe(200);
    const response = await postFeedback(session.meta.runId, "🔥");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "feedback-run", emoji: "🔥" });
    expect(
      await env.DB.prepare("SELECT feedback_emoji, feedback_note FROM sessions WHERE run_id = ?")
        .bind(session.meta.runId)
        .first(),
    ).toEqual({ feedback_emoji: "🔥", feedback_note: "something exploded beautifully" });

    expect((await postFeedback(session.meta.runId, "❤️")).status).toBe(400);
    expect((await postFeedback(session.meta.runId, "👍", { extra: { note: "absolutely not" } })).status).toBe(400);
    await addTestCredential();
    expect((await postFeedback(session.meta.runId, "👍")).status).toBe(403);
    expect(
      await env.DB.prepare("SELECT feedback_emoji FROM sessions WHERE run_id = ?").bind(session.meta.runId).first(),
    ).toEqual({ feedback_emoji: "🔥" });
  });

  it("accepts bounded emoji feedback throughout the retained session window", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 2_200_000_000_000;
    const session = sessionFixture({ runId: "old-feedback-run" });
    expect((await post("session", session)).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET received_at = ? WHERE run_id = ?")
      .bind(now - 364 * day, session.meta.runId)
      .run();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await postFeedback(session.meta.runId, "👍")).status).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects feedback after the 365-day session boundary before cron runs", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 2_200_000_000_000;
    const session = sessionFixture({ runId: "expired-feedback-run" });
    expect((await post("session", session)).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET received_at = ? WHERE run_id = ?")
      .bind(now - 366 * day, session.meta.runId)
      .run();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await postFeedback(session.meta.runId, "👍")).status).toBe(404);
    } finally {
      clock.mockRestore();
    }
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

  it("unconditionally refreshes an already-present replay object on a deduplicated reference", async () => {
    const session = sessionFixture({ runId: "refresh-first" });
    expect((await post("session", session)).status).toBe(200);
    const key = `replays/${session.meta.replaySha256}.json.gz`;
    const before = await env.CAPTURES.head(key);
    expect(before?.version).toBeTruthy();

    const report = reportFixture({ reportId: "refresh-second" });
    expect((await post("report", report)).status).toBe(200);
    const after = await env.CAPTURES.head(key);
    expect(after?.version).toBeTruthy();
    expect(after?.version).not.toBe(before?.version);
  });

  it("uses one reservation per concurrent identical invocation", async () => {
    const session = sessionFixture({ runId: "identical-concurrent-reservations" });
    const bytes = new TextEncoder().encode(JSON.stringify(session));
    const bodySha = await digest(bytes);
    const requests: Request[] = [];
    for (let index = 0; index < 2; index += 1) {
      if (index === 1) await addTestCredential();
      const headers = new Headers({
        "content-type": "application/json",
        "x-dmc-build": session.meta.buildId,
        "x-dmc-install": session.meta.installId!,
        "x-dmc-sha256": bodySha,
        "cf-connecting-ip": `198.51.100.${index + 10}`,
      });
      for (const [name, value] of Object.entries(await captureAuthHeaders("session", bodySha))) {
        headers.set(name, value);
      }
      requests.push(new Request("https://worker.test/api/session", { method: "POST", headers, body: bytes.slice() }));
    }
    let releasePuts!: () => void;
    const putGate = new Promise<void>((resolve) => (releasePuts = resolve));
    const captures = new Proxy(env.CAPTURES, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<typeof target.put>) => {
            await putGate;
            return target.put(...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const gatedEnv = new Proxy(env, {
      get(target, property) {
        return property === "CAPTURES" ? captures : Reflect.get(target, property);
      },
    });
    const pending = requests.map((request) => ingestSession(request, gatedEnv));
    await vi.waitFor(async () => {
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS count FROM replay_write_reservations").first<{ count: number }>())
          ?.count,
      ).toBe(2);
    });
    releasePuts();
    expect((await Promise.all(pending)).map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare("SELECT request_id FROM capture_write_reservations").first()).toBeNull();
    expect(await env.DB.prepare("SELECT request_id FROM replay_write_reservations").first()).toBeNull();
  });

  it("applies 365/270/90-day retention and confirms expired diagnostics are physically gone", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 9_000_000_000_000;
    const session = sessionFixture({ runId: "retention-run" });
    session.meta.note = "short-lived free text";
    expect((await post("session", session)).status).toBe(200);
    const shared = await postShare(session.meta.runId);
    expect(shared.status).toBe(200);
    const shareId = ((await shared.json()) as { shareId: string }).shareId;
    const report = reportFixture({ reportId: "retention-report" });
    expect((await post("report", report)).status).toBe(200);
    const replayKey = `replays/${session.meta.replaySha256}.json.gz`;
    const reportKey = (await env.DB.prepare(
      "SELECT r2_key FROM diagnostic_reports WHERE report_id = 'retention-report'",
    ).first<{ r2_key: string }>())!.r2_key;

    await env.DB.prepare("UPDATE sessions SET received_at = ?")
      .bind(now - 271 * day)
      .run();
    await env.DB.prepare("UPDATE diagnostic_reports SET received_at = ?")
      .bind(now - 91 * day)
      .run();
    await runRetention(env, now);
    await runRetention(env, now);

    expect(await env.DB.prepare("SELECT run_id, feedback_note, replay_sha256 FROM sessions").first()).toEqual({
      run_id: "retention-run",
      feedback_note: null,
      replay_sha256: session.meta.replaySha256,
    });
    expect(await env.DB.prepare("SELECT report_id FROM diagnostic_reports").first()).toBeNull();
    expect(await env.DB.prepare("SELECT share_id FROM shared_runs").first()).toBeNull();
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
    expect((await SELF.fetch(`https://worker.test/api/shared/${shareId}`)).status).toBe(404);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const retainedSummary = await SELF.fetch("https://worker.test/api/session/retention-run", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(await retainedSummary.json()).toMatchObject({ replay: null, replayStatus: "expired" });
    expect(await env.CAPTURES.head(replayKey)).not.toBeNull();
    expect(await env.CAPTURES.head(reportKey)).toBeNull();

    await runRetention(env, now + 95 * day);
    expect(await env.DB.prepare("SELECT run_id FROM sessions").first()).toBeNull();
    clock.mockRestore();
  });

  it("keeps an expired diagnostic locator until R2 deletion succeeds", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 9_000_000_000_000;
    const report = reportFixture({ reportId: "retention-r2-failure", replay: null });
    expect((await post("report", report)).status).toBe(200);
    await env.DB.prepare("UPDATE diagnostic_reports SET received_at = ? WHERE report_id = ?")
      .bind(now - 91 * day, report.reportId)
      .run();
    const failingEnv = new Proxy(env, {
      get(target, property) {
        if (property !== "CAPTURES") return Reflect.get(target, property);
        return new Proxy(target.CAPTURES, {
          get(bucket, bucketProperty) {
            if (bucketProperty === "delete") return async () => Promise.reject(new Error("injected delete failure"));
            const value = Reflect.get(bucket, bucketProperty);
            return typeof value === "function" ? value.bind(bucket) : value;
          },
        });
      },
    });
    await runRetention(failingEnv, now);
    expect(
      await env.DB.prepare("SELECT report_id FROM diagnostic_reports WHERE report_id = ?")
        .bind(report.reportId)
        .first(),
    ).toEqual({ report_id: report.reportId });
    await runRetention(env, now);
    expect(await env.DB.prepare("SELECT report_id FROM diagnostic_reports").first()).toBeNull();
  });

  it("purges only old pre-mutation blocked manifests", async () => {
    const now = 9_000_000_000_000;
    const old = now - 31 * 24 * 60 * 60 * 1_000;
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO operator_deletions (
         job_id, scope, reference_hash, plan_digest, state, blocked_stage, target_counts_json,
         object_manifest_json, created_at, updated_at, last_error
       ) VALUES (?, 'run', ?, ?, 'blocked', 'locking', '{}', '{"target":"private"}', ?, ?, 'blocked')`,
    )
      .bind(jobId, "0".repeat(64), "1".repeat(64), old, old)
      .run();
    await runRetention(env, now);
    expect(
      await env.DB.prepare("SELECT state, object_manifest_json FROM operator_deletions WHERE job_id = ?")
        .bind(jobId)
        .first(),
    ).toEqual({ state: "aborted", object_manifest_json: null });
  });

  it("enforces 365/270/90 logical expiry before cron cleanup runs", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 2_000_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const oldReplay = sessionFixture({ runId: "logical-old-replay" });
      expect((await post("session", oldReplay)).status).toBe(200);
      const shared = await postShare(oldReplay.meta.runId);
      const shareId = ((await shared.json()) as { shareId: string }).shareId;
      await env.DB.prepare("UPDATE sessions SET received_at = ?, display_name = 'Pilot', feedback_note = 'note'")
        .bind(now - 271 * day)
        .run();

      const privateLookup = await SELF.fetch("https://worker.test/api/session/logical-old-replay", {
        headers: { Authorization: "Bearer test-secret" },
      });
      expect(await privateLookup.json()).toMatchObject({
        session: { run_id: "logical-old-replay", display_name: null, feedback_note: null },
        replay: null,
        replayStatus: "expired",
      });
      expect((await SELF.fetch(`https://worker.test/api/shared/${shareId}`)).status).toBe(404);
      expect((await SELF.fetch(new Request(`https://worker.test/r/${shareId}`, { redirect: "manual" }))).status).toBe(
        404,
      );
      expect((await postShare(oldReplay.meta.runId)).status).toBe(404);
      const operatorList = await SELF.fetch("https://worker.test/api/operator/sessions", {
        headers: { Authorization: "Bearer test-secret" },
      });
      expect(await operatorList.json()).toMatchObject({
        sessions: [{ runId: "logical-old-replay", replayStatus: "expired" }],
      });

      const report = reportFixture({ reportId: "logical-old-report", runId: null });
      expect((await post("report", report)).status).toBe(200);
      await env.DB.prepare("UPDATE diagnostic_reports SET received_at = ?")
        .bind(now - 91 * day)
        .run();
      expect(
        (
          await SELF.fetch("https://worker.test/api/report/logical-old-report", {
            headers: { Authorization: "Bearer test-secret" },
          })
        ).status,
      ).toBe(404);

      await env.DB.prepare("UPDATE sessions SET received_at = ?")
        .bind(now - 366 * day)
        .run();
      expect(
        (
          await SELF.fetch("https://worker.test/api/session/logical-old-replay", {
            headers: { Authorization: "Bearer test-secret" },
          })
        ).status,
      ).toBe(404);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps replay and share access at the exact inclusive 270-day boundary", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 2_100_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const session = sessionFixture({ runId: "boundary-run" });
      expect((await post("session", session)).status).toBe(200);
      const shared = await postShare(session.meta.runId);
      const shareId = ((await shared.json()) as { shareId: string }).shareId;
      await env.DB.prepare("UPDATE sessions SET received_at = ?")
        .bind(now - 270 * day)
        .run();
      const retrieved = await SELF.fetch("https://worker.test/api/session/boundary-run", {
        headers: { Authorization: "Bearer test-secret" },
      });
      expect(await retrieved.json()).toMatchObject({ replay: expect.any(Object) });
      expect((await SELF.fetch(`https://worker.test/api/shared/${shareId}`)).status).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it("retains a deduplicated replay while any session reference is inside 270 days", async () => {
    const day = 24 * 60 * 60 * 1_000;
    const now = 9_000_000_000_000;
    const first = sessionFixture({ runId: "old-reference" });
    const second = sessionFixture({ runId: "recent-reference", replay: structuredClone(first.replay!) });
    expect((await post("session", first)).status).toBe(200);
    expect((await post("session", second)).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET received_at = ? WHERE run_id = ?")
      .bind(now - 271 * day, first.meta.runId)
      .run();
    await env.DB.prepare("UPDATE sessions SET received_at = ? WHERE run_id = ?")
      .bind(now - 269 * day, second.meta.runId)
      .run();

    await runRetention(env, now);
    expect(
      await env.DB.prepare("SELECT replay_sha256 FROM replays WHERE replay_sha256 = ?")
        .bind(first.meta.replaySha256)
        .first(),
    ).toEqual({ replay_sha256: first.meta.replaySha256 });
  });

  it("previews and executes a confirmed run deletion across D1 and R2", async () => {
    const session = sessionFixture({ runId: "delete-this-run" });
    const report = reportFixture({ reportId: "delete-this-report", runId: session.meta.runId });
    expect((await post("session", session)).status).toBe(200);
    expect((await post("report", report)).status).toBe(200);
    expect((await postShare(session.meta.runId)).status).toBe(200);
    const reportKey = (await env.DB.prepare("SELECT r2_key FROM diagnostic_reports WHERE report_id = ?")
      .bind(report.reportId)
      .first<{ r2_key: string }>())!.r2_key;
    const replayKey = `replays/${session.meta.replaySha256}.json.gz`;
    const body = { scope: "run", reference: session.meta.runId };

    const unauthorized = await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(unauthorized.status).toBe(401);
    const preview = await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify(body),
    });
    expect(preview.status).toBe(200);
    const previewed = (await preview.json()) as { planDigest: string; confirmation: string };
    expect(previewed).toMatchObject({
      ok: true,
      mode: "preview",
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      confirmation: expect.stringMatching(/^DELETE run:delete-this-run [a-f0-9]{64}$/),
      sessions: ["delete-this-run"],
      reports: ["delete-this-report"],
      sharedRuns: ["delete-this-run"],
      replayObjects: [replayKey],
      diagnosticObjects: [reportKey],
    });

    const unconfirmed = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify(body),
    });
    expect(unconfirmed.status).toBe(409);
    expect(await env.CAPTURES.head(replayKey)).not.toBeNull();

    const executed = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...body, planDigest: previewed.planDigest, confirmation: previewed.confirmation }),
    });
    expect(executed.status).toBe(200);
    expect(await executed.json()).toMatchObject({ ok: true, mode: "executed", verified: true });
    expect(
      await env.DB.prepare("SELECT run_id FROM sessions WHERE run_id = ?").bind(session.meta.runId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT report_id FROM diagnostic_reports WHERE report_id = ?")
        .bind(report.reportId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT run_id FROM shared_runs WHERE run_id = ?").bind(session.meta.runId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT replay_sha256 FROM replays WHERE replay_sha256 = ?")
        .bind(session.meta.replaySha256)
        .first(),
    ).toBeNull();
    expect(await env.CAPTURES.head(replayKey)).toBeNull();
    expect(await env.CAPTURES.head(reportKey)).toBeNull();
    const retried = await post("session", structuredClone(session));
    expect(retried.status).toBe(409);
    expect(await retried.json()).toMatchObject({ message: "Capture was deleted and cannot be retried" });
  });

  it("deletes every exact-install upload while retaining the App Attest security record", async () => {
    const first = sessionFixture({ runId: "install-delete-one" });
    const second = sessionFixture({ runId: "install-delete-two" });
    expect((await post("session", first)).status).toBe(200);
    expect((await post("session", second)).status).toBe(200);
    expect((await post("report", reportFixture({ reportId: "install-delete-report" }))).status).toBe(200);
    const credential = await currentTestCredential();
    const request = { scope: "install", reference: installId };
    const preview = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: JSON.stringify(request),
      })
    ).json()) as { planDigest: string; confirmation: string };
    const executed = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...request, planDigest: preview.planDigest, confirmation: preview.confirmation }),
    });
    expect(executed.status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())?.count).toBe(0);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM diagnostic_reports").first<{ count: number }>())?.count,
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT status FROM app_attest_credentials WHERE key_id_hash = ?")
        .bind(credential.keyIdHash)
        .first(),
    ).toEqual({ status: "active" });
  });

  it("does not delete a replay object still referenced outside the deletion scope", async () => {
    const sharedReplay = replayFixture();
    const removed = sessionFixture({ runId: "remove-one", replay: sharedReplay });
    const survivor = sessionFixture({ runId: "keep-one", replay: sharedReplay });
    expect((await post("session", removed)).status).toBe(200);
    expect((await post("session", survivor)).status).toBe(200);
    const replayKey = `replays/${removed.meta.replaySha256}.json.gz`;
    const request = { scope: "run", reference: removed.meta.runId };
    const preview = await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify(request),
    });
    const plan = (await preview.json()) as {
      planDigest: string;
      confirmation: string;
      preservedReplayObjects: string[];
    };
    expect(plan.preservedReplayObjects).toEqual([replayKey]);

    const response = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...request, planDigest: plan.planDigest, confirmation: plan.confirmation }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayObjects: [] });
    expect(
      await env.DB.prepare("SELECT run_id FROM sessions WHERE run_id = ?").bind(survivor.meta.runId).first(),
    ).toEqual({
      run_id: survivor.meta.runId,
    });
    expect(
      await env.DB.prepare("SELECT replay_sha256 FROM replays WHERE replay_sha256 = ?")
        .bind(removed.meta.replaySha256)
        .first(),
    ).toEqual({
      replay_sha256: removed.meta.replaySha256,
    });
    expect(await env.CAPTURES.head(replayKey)).not.toBeNull();
  });

  it("re-evaluates a preview-preserved replay after another deletion removes its survivor", async () => {
    const sharedReplay = replayFixture();
    const first = sessionFixture({ runId: "shared-delete-first", replay: sharedReplay });
    const second = sessionFixture({ runId: "shared-delete-second", replay: sharedReplay });
    expect((await post("session", first)).status).toBe(200);
    expect((await post("session", second)).status).toBe(200);
    const plans = await Promise.all(
      [first, second].map((session) => buildDeletionPlan(env, { scope: "run", reference: session.meta.runId })),
    );
    expect(plans.every((plan) => plan.replays[0]?.action === "preserve")).toBe(true);
    const jobIds = [crypto.randomUUID(), crypto.randomUUID()];
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      await env.DB.prepare(
        `INSERT INTO operator_deletions (
           job_id, scope, reference_hash, plan_digest, state, target_counts_json,
           object_manifest_json, created_at, updated_at
         ) VALUES (?, 'run', ?, ?, 'locking', '{}', ?, ?, ?)`,
      )
        .bind(
          jobIds[index],
          "0".repeat(64),
          await deletionPlanDigest(plan),
          JSON.stringify(plan),
          Date.now(),
          Date.now(),
        )
        .run();
    }

    expect((await executeDeletionJob(env, jobIds[0])).status).toBe(200);
    expect(await env.CAPTURES.head(`replays/${first.meta.replaySha256}.json.gz`)).not.toBeNull();
    expect((await executeDeletionJob(env, jobIds[1])).status).toBe(200);
    expect(await env.CAPTURES.head(`replays/${first.meta.replaySha256}.json.gz`)).toBeNull();
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
  });

  it("rejects deletion when the target set changes after preview", async () => {
    expect((await post("session", sessionFixture({ runId: "plan-one" }))).status).toBe(200);
    const request = { scope: "install", reference: installId };
    const preview = await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify(request),
    });
    const plan = (await preview.json()) as { planDigest: string; confirmation: string };
    expect((await post("session", sessionFixture({ runId: "plan-two" }))).status).toBe(200);

    const response = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...request, planDigest: plan.planDigest, confirmation: plan.confirmation }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: "Target set changed; request a fresh preview" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(2);
    expect(await env.DB.prepare("SELECT job_id FROM operator_deletions").first()).toBeNull();
  });

  it("blocks replay-less reports while their run deletion scope is locked", async () => {
    const objectsBefore = (await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map((row) => row.key);
    const jobId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operator_deletions (
           job_id, scope, reference_hash, plan_digest, state, target_counts_json,
           object_manifest_json, created_at, updated_at
         ) VALUES (?, 'run', ?, ?, 'objects', '{}', '{}', ?, ?)`,
      ).bind(jobId, "0".repeat(64), "1".repeat(64), now, now),
      env.DB.prepare(
        "INSERT INTO operator_deletion_scope_locks (scope, reference, job_id, acquired_at) VALUES ('run', ?, ?, ?)",
      ).bind("locked-report-run", jobId, now),
    ]);
    const response = await post(
      "report",
      reportFixture({ reportId: "locked-replayless-report", runId: "locked-report-run", replay: null }),
    );
    expect(response.status).toBe(503);
    expect(await env.DB.prepare("SELECT report_id FROM diagnostic_reports").first()).toBeNull();
    expect((await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map((row) => row.key)).toEqual(objectsBefore);
  });

  it("keeps a blocked deletion durable and resumes after the replay writer releases", async () => {
    const session = sessionFixture({ runId: "reserved-run" });
    expect((await post("session", session)).status).toBe(200);
    const request = { scope: "run", reference: session.meta.runId };
    const preview = await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify(request),
    });
    const plan = (await preview.json()) as { planDigest: string; confirmation: string };
    await env.DB.prepare(
      `INSERT INTO replay_write_reservations (request_id, replay_sha256, owner_kind, owner_id, created_at)
       VALUES ('active-writer', ?, 'session', 'other-run', ?)`,
    )
      .bind(session.meta.replaySha256, Date.now())
      .run();

    const blocked = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...request, planDigest: plan.planDigest, confirmation: plan.confirmation }),
    });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { jobId: string };
    expect(blockedBody.jobId).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      await env.DB.prepare("SELECT state FROM operator_deletions WHERE job_id = ?").bind(blockedBody.jobId).first(),
    ).toEqual({
      state: "blocked",
    });
    expect(
      await env.DB.prepare("SELECT run_id FROM sessions WHERE run_id = ?").bind(session.meta.runId).first(),
    ).not.toBeNull();

    await env.DB.prepare("DELETE FROM replay_write_reservations WHERE request_id = 'active-writer'").run();
    const resumed = await SELF.fetch("https://worker.test/api/operator/deletion/resume", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ jobId: blockedBody.jobId }),
    });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ ok: true, verified: true, jobId: blockedBody.jobId });
    expect(
      await env.DB.prepare("SELECT state, object_manifest_json FROM operator_deletions WHERE job_id = ?")
        .bind(blockedBody.jobId)
        .first(),
    ).toEqual({
      state: "complete",
      object_manifest_json: null,
    });
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replay_deletion_locks").first()).toBeNull();
  });

  it("releases partial replay and scope locks and exposes safe blocked-job recovery", async () => {
    const first = sessionFixture({ runId: "partial-lock-one" });
    const secondReplay = replayFixture();
    secondReplay.seed += 1;
    const second = sessionFixture({ runId: "partial-lock-two", replay: secondReplay });
    expect((await post("session", first)).status).toBe(200);
    expect((await post("session", second)).status).toBe(200);
    const request = { scope: "install", reference: installId };
    const preview = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: JSON.stringify(request),
      })
    ).json()) as { planDigest: string; confirmation: string };
    await env.DB.prepare(
      `INSERT INTO replay_write_reservations (request_id, replay_sha256, owner_kind, owner_id, created_at)
       VALUES ('active-second-writer', ?, 'session', 'other-run', ?)`,
    )
      .bind(second.meta.replaySha256, Date.now())
      .run();
    const blocked = await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ ...request, planDigest: preview.planDigest, confirmation: preview.confirmation }),
    });
    const blockedBody = (await blocked.json()) as { jobId: string };
    expect(blocked.status).toBe(409);
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replay_deletion_locks").first()).toBeNull();
    expect(await env.DB.prepare("SELECT scope FROM operator_deletion_scope_locks").first()).toBeNull();

    const listed = await SELF.fetch("https://worker.test/api/operator/deletion/jobs/list", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: "{}",
    });
    expect(await listed.json()).toMatchObject({ jobs: [{ jobId: blockedBody.jobId, recoverAction: "abort" }] });
    const inspected = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/jobs/inspect", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: JSON.stringify({ jobId: blockedBody.jobId }),
      })
    ).json()) as { planDigest: string; confirmation: string };
    const recovered = await SELF.fetch("https://worker.test/api/operator/deletion/jobs/recover", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({
        jobId: blockedBody.jobId,
        planDigest: inspected.planDigest,
        confirmation: inspected.confirmation,
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ mode: "aborted", verified: true });
    expect(
      await env.DB.prepare("SELECT state, object_manifest_json FROM operator_deletions WHERE job_id = ?")
        .bind(blockedBody.jobId)
        .first(),
    ).toEqual({ state: "aborted", object_manifest_json: null });
  });

  it("recovers a stale reservation for a committed owner without deleting its replay", async () => {
    const session = sessionFixture({ runId: "committed-reservation-owner" });
    expect((await post("session", session)).status).toBe(200);
    const requestId = "session:11111111-1111-4111-8111-111111111111";
    await env.DB.prepare(
      `INSERT INTO replay_write_reservations (
         request_id, replay_sha256, owner_kind, owner_id, created_at, updated_at
       ) VALUES (?, ?, 'session', ?, ?, ?)`,
    )
      .bind(requestId, session.meta.replaySha256, session.meta.runId, Date.now(), Date.now())
      .run();
    const headers = { Authorization: "Bearer test-secret" };
    const inspectedResponse = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId }),
    });
    expect(inspectedResponse.status).toBe(200);
    const inspected = (await inspectedResponse.json()) as { planDigest: string; confirmation: string };
    expect(inspected).toMatchObject({ ownerCommitted: true, action: "preserve" });

    const unconfirmed = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/recover", {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId, planDigest: inspected.planDigest, confirmation: inspected.confirmation }),
    });
    expect(unconfirmed.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT request_id FROM replay_write_reservations WHERE request_id = ?")
        .bind(requestId)
        .first(),
    ).not.toBeNull();

    const recovered = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/recover", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId,
        invocationEnded: true,
        planDigest: inspected.planDigest,
        confirmation: inspected.confirmation,
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ ok: true, mode: "recovered", action: "preserve", verified: true });
    expect(await env.CAPTURES.head(`replays/${session.meta.replaySha256}.json.gz`)).not.toBeNull();
    expect(await env.DB.prepare("SELECT request_id FROM replay_write_reservations").first()).toBeNull();
  });

  it("recovers an orphaned reservation under a replay lock and removes its object", async () => {
    const session = sessionFixture({ runId: "orphan-reservation-owner" });
    expect((await post("session", session)).status).toBe(200);
    const requestId = "session:22222222-2222-4222-8222-222222222222";
    await env.DB.prepare("DELETE FROM sessions WHERE run_id = ?").bind(session.meta.runId).run();
    await env.DB.prepare(
      `INSERT INTO replay_write_reservations (
         request_id, replay_sha256, owner_kind, owner_id, created_at, updated_at
       ) VALUES (?, ?, 'session', ?, ?, ?)`,
    )
      .bind(requestId, session.meta.replaySha256, session.meta.runId, Date.now(), Date.now())
      .run();
    const headers = { Authorization: "Bearer test-secret" };
    const inspected = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/reservation/inspect", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId }),
      })
    ).json()) as { planDigest: string; confirmation: string };
    expect(inspected).toMatchObject({ ownerCommitted: false, action: "delete" });

    const recovered = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/recover", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId,
        invocationEnded: true,
        planDigest: inspected.planDigest,
        confirmation: inspected.confirmation,
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ action: "delete", verified: true });
    expect(await env.CAPTURES.head(`replays/${session.meta.replaySha256}.json.gz`)).toBeNull();
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replay_deletion_locks").first()).toBeNull();
  });

  it("does not treat an owner row with a different replay as a committed reservation", async () => {
    const owner = sessionFixture({ runId: "mismatched-reservation-owner" });
    const orphanReplay = replayFixture();
    orphanReplay.seed += 77;
    const orphan = sessionFixture({ runId: "temporary-orphan-source", replay: orphanReplay });
    expect((await post("session", owner)).status).toBe(200);
    expect((await post("session", orphan)).status).toBe(200);
    await env.DB.prepare("DELETE FROM sessions WHERE run_id = ?").bind(orphan.meta.runId).run();
    const requestId = "session:33333333-3333-4333-8333-333333333333";
    await env.DB.prepare(
      `INSERT INTO replay_write_reservations (
         request_id, replay_sha256, owner_kind, owner_id, created_at, updated_at
       ) VALUES (?, ?, 'session', ?, ?, ?)`,
    )
      .bind(requestId, orphan.meta.replaySha256, owner.meta.runId, Date.now() - 1_000, Date.now())
      .run();
    const inspected = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/inspect", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: JSON.stringify({ requestId }),
    });
    expect(await inspected.json()).toMatchObject({
      ownerCommitted: false,
      action: "delete",
      ageMs: expect.any(Number),
      deletionLock: null,
    });
  });

  it("recovers a stale replay-less report reservation and its orphan diagnostic object", async () => {
    const report = reportFixture({ reportId: "replayless-reservation", replay: null });
    expect((await post("report", report)).status).toBe(200);
    const row = await env.DB.prepare("SELECT r2_key FROM diagnostic_reports WHERE report_id = ?")
      .bind(report.reportId)
      .first<{ r2_key: string }>();
    await env.DB.prepare("DELETE FROM diagnostic_reports WHERE report_id = ?").bind(report.reportId).run();
    const requestId = "report:44444444-4444-4444-8444-444444444444";
    await env.DB.prepare(
      `INSERT INTO capture_write_reservations (
         request_id, owner_kind, owner_id, install_id, run_id, request_sha256,
         diagnostic_r2_key, created_at, updated_at
       ) VALUES (?, 'report', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        requestId,
        report.reportId,
        report.meta.installId,
        report.meta.runId,
        "0".repeat(64),
        row!.r2_key,
        Date.now(),
        Date.now(),
      )
      .run();
    const headers = { Authorization: "Bearer test-secret" };
    const inspected = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/reservation/inspect", {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId }),
      })
    ).json()) as { planDigest: string; confirmation: string };
    expect(inspected).toMatchObject({ replaySha256: null, diagnosticObject: row!.r2_key, action: "delete" });
    const recovered = await SELF.fetch("https://worker.test/api/operator/deletion/reservation/recover", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId,
        invocationEnded: true,
        planDigest: inspected.planDigest,
        confirmation: inspected.confirmation,
      }),
    });
    expect(recovered.status).toBe(200);
    expect(await env.CAPTURES.head(row!.r2_key)).toBeNull();
    expect(await env.DB.prepare("SELECT request_id FROM capture_write_reservations").first()).toBeNull();
  });

  it("resumes a durable job after an R2 deletion failure", async () => {
    const session = sessionFixture({ runId: "r2-retry-run" });
    const report = reportFixture({ reportId: "r2-retry-report", runId: session.meta.runId });
    expect((await post("session", session)).status).toBe(200);
    expect((await post("report", report)).status).toBe(200);
    const request = { scope: "run", reference: session.meta.runId };
    const previewResponse = await handleDeletion(
      new Request("https://worker.test/preview", { method: "POST", body: JSON.stringify(request) }),
      env,
      "preview",
    );
    const plan = (await previewResponse.json()) as { planDigest: string; confirmation: string };
    let failDelete = true;
    const captures = new Proxy(env.CAPTURES, {
      get(target, property) {
        if (property === "delete") {
          return async (key: string) => {
            if (failDelete) {
              failDelete = false;
              throw new Error("injected R2 failure");
            }
            return target.delete(key);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failingEnv = new Proxy(env, {
      get(target, property) {
        return property === "CAPTURES" ? captures : Reflect.get(target, property);
      },
    });
    const failed = await handleDeletion(
      new Request("https://worker.test/execute", {
        method: "POST",
        body: JSON.stringify({ ...request, planDigest: plan.planDigest, confirmation: plan.confirmation }),
      }),
      failingEnv,
      "execute",
    );
    expect(failed.status).toBe(500);
    const failedBody = (await failed.json()) as { jobId: string };
    expect(
      await env.DB.prepare("SELECT state, blocked_stage, object_manifest_json FROM operator_deletions WHERE job_id = ?")
        .bind(failedBody.jobId)
        .first(),
    ).toMatchObject({ state: "blocked", blocked_stage: "objects", object_manifest_json: expect.any(String) });
    expect(
      await env.DB.prepare("SELECT scope FROM operator_deletion_scope_locks WHERE job_id = ?")
        .bind(failedBody.jobId)
        .first(),
    ).toEqual({ scope: "run" });
    expect(
      await env.DB.prepare("SELECT run_id FROM sessions WHERE run_id = ?").bind(session.meta.runId).first(),
    ).not.toBeNull();

    const resumed = await handleDeletion(
      new Request("https://worker.test/resume", {
        method: "POST",
        body: JSON.stringify({ jobId: failedBody.jobId }),
      }),
      env,
      "resume",
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ ok: true, verified: true });
  });

  it("distinguishes missing replay evidence without hiding the session", async () => {
    const missingIndex = sessionFixture({ runId: "missing-index-run" });
    expect((await post("session", missingIndex)).status).toBe(200);
    await env.DB.prepare("DELETE FROM replays WHERE replay_sha256 = ?").bind(missingIndex.meta.replaySha256).run();
    const missingIndexResponse = await SELF.fetch("https://worker.test/api/session/missing-index-run", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(missingIndexResponse.status).toBe(200);
    expect(await missingIndexResponse.json()).toMatchObject({ replay: null, replayStatus: "missing" });
    const operatorList = await SELF.fetch("https://worker.test/api/operator/sessions", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(await operatorList.json()).toMatchObject({
      sessions: [expect.objectContaining({ runId: "missing-index-run", replayStatus: "missing" })],
    });

    const deleteRequest = { scope: "run", reference: missingIndex.meta.runId };
    const preview = (await (
      await SELF.fetch("https://worker.test/api/operator/deletion/preview", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret" },
        body: JSON.stringify(deleteRequest),
      })
    ).json()) as { planDigest: string; confirmation: string; replayObjects: string[] };
    expect(preview.replayObjects).toEqual([`replays/${missingIndex.meta.replaySha256}.json.gz`]);
    expect(
      (
        await SELF.fetch("https://worker.test/api/operator/deletion/execute", {
          method: "POST",
          headers: { Authorization: "Bearer test-secret" },
          body: JSON.stringify({
            ...deleteRequest,
            planDigest: preview.planDigest,
            confirmation: preview.confirmation,
          }),
        })
      ).status,
    ).toBe(200);
    expect(await env.CAPTURES.head(`replays/${missingIndex.meta.replaySha256}.json.gz`)).toBeNull();

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
    const session = sessionFixture();
    await env.DB.prepare(
      "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'forced'); END",
    ).run();
    const response = await post("session", session);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ stage: "store" });
    expect(await env.DB.prepare("SELECT replay_sha256 FROM replays").first()).toBeNull();
    expect(await env.CAPTURES.head(`replays/${session.meta.replaySha256}.json.gz`)).toBeNull();
  });

  it("removes an uncommitted diagnostic object after D1 failure", async () => {
    const before = (await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map((row) => row.key).sort();
    await env.DB.prepare(
      "CREATE TRIGGER fail_report BEFORE INSERT ON diagnostic_reports BEGIN SELECT RAISE(FAIL, 'forced'); END",
    ).run();
    const response = await post("report", reportFixture({ reportId: "failed-report-object", replay: null }));
    expect(response.status).toBe(500);
    expect(await env.DB.prepare("SELECT report_id FROM diagnostic_reports").first()).toBeNull();
    expect((await env.CAPTURES.list({ prefix: "diagnostics/" })).objects.map((row) => row.key).sort()).toEqual(before);
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

  it("serves a minimal replay-aware operator list with restricted browser CORS", async () => {
    const session = sessionFixture({ runId: "operator-run" });
    expect((await post("session", session)).status).toBe(200);
    const headers = {
      Authorization: "Bearer test-secret",
      Origin: "https://phejet.github.io",
    };
    const response = await SELF.fetch("https://worker.test/api/operator/sessions", { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://phejet.github.io");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const available = (await response.json()) as Record<string, unknown>;
    expect(available).toMatchObject({
      sessions: [
        {
          runId: "operator-run",
          build: "build+dirty",
          score: 900,
          wave: 4,
          outcome: "burj_destroyed",
          replayStatus: "available",
        },
      ],
    });
    expect(JSON.stringify(available)).not.toContain("install_id");

    await env.CAPTURES.delete(`replays/${session.meta.replaySha256}.json.gz`);
    const missing = await SELF.fetch("https://worker.test/api/operator/sessions", { headers });
    expect(await missing.json()).toMatchObject({ sessions: [{ replayStatus: "missing" }] });

    const preflight = await SELF.fetch("https://worker.test/api/operator/sessions", {
      method: "OPTIONS",
      headers: { Origin: "https://phejet.github.io" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("Authorization");
    expect(
      (
        await SELF.fetch("https://worker.test/api/operator/sessions", {
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("allows browser preflight and authenticated retrieval of an operator replay", async () => {
    const session = sessionFixture({ runId: "operator-replay-cors" });
    expect((await post("session", session)).status).toBe(200);
    const url = `https://worker.test/api/session/${session.meta.runId}`;
    const origin = "https://phejet.github.io";
    const preflight = await SELF.fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("Authorization");

    const unauthorized = await SELF.fetch(url, { headers: { Origin: origin } });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("access-control-allow-origin")).toBe(origin);
    const replay = await SELF.fetch(url, {
      headers: { Origin: origin, Authorization: "Bearer test-secret" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("access-control-allow-origin")).toBe(origin);
    expect(replay.headers.get("cache-control")).toBe("private, no-store");
    expect(await replay.json()).toMatchObject({ ok: true, replay: session.replay });

    for (const method of ["OPTIONS", "GET"]) {
      const denied = await SELF.fetch(url, {
        method,
        headers: { Origin: "https://evil.example", Authorization: "Bearer test-secret" },
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect((await SELF.fetch(url, { method: "OPTIONS" })).status).toBe(400);
    expect((await SELF.fetch(url, { method: "POST", headers: { Authorization: "Bearer test-secret" } })).status).toBe(
      404,
    );
  });

  it("allows only configured origins on both ingest routes", async () => {
    for (const route of ["session", "report", "share", "feedback"]) {
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
