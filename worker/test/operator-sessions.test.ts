import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleOperatorSessions, operatorQuery } from "../src/operator-sessions";
import { parseOperatorFilters } from "../../src/operator-contract";
import { replayFixture, sessionFixture } from "../../test-fixtures/capture";
import { SESSION_RETENTION_MS, REPLAY_RETENTION_MS } from "../src/retention";

const headers = { Authorization: "Bearer test-secret" };
const now = 2100000000000;
async function seed(
  runId: string,
  options: {
    receivedAt?: number;
    score?: number;
    wave?: number;
    feedback?: string | null;
    state?: "omitted" | "expired" | "index" | "object" | "available";
  } = {},
) {
  const summary = sessionFixture().summary;
  const state = options.state ?? "omitted";
  const sha = state === "omitted" ? null : runId.padEnd(64, "a");
  await env.DB.prepare(
    `INSERT INTO sessions (run_id, install_id, build, platform, input_class, created_at, received_at, outcome, wave_reached, score, time_played_ms, burj_health, shots_fired, total_kills, hit_ratio, multi_shots, max_combo, destroyed_by_type_json, upgrades_json, feedback_emoji, source, replay_sha256, display_name, feedback_note, submitter_key_id_hash, apple_bundle_id, app_flavor, apple_environment) VALUES (?, 'private-install', 'build+dirty', 'web', 'mouse', ?, ?, 'burj_destroyed', ?, ?, 12345, 0, 10, 5, 0.5, 4, 8, ?, ?, ?, 'gameover', ?, 'private-name', 'private-note', NULL, 'private-bundle', 'staging', 'production')`,
  )
    .bind(
      runId,
      now,
      options.receivedAt ?? (state === "expired" ? now - REPLAY_RETENTION_MS - 1 : now),
      options.wave ?? 4,
      options.score ?? 900,
      JSON.stringify(summary.destroyedByType),
      JSON.stringify(summary.upgrades),
      options.feedback ?? null,
      sha,
    )
    .run();
  if (sha && state !== "index") {
    const key = `operator-test/${runId}`;
    await env.DB.prepare("INSERT INTO replays VALUES (?, ?, ?, 1, 1, ?)").bind(sha, now, now, key).run();
    if (state === "available") {
      const stream = new Blob([JSON.stringify(replayFixture())]).stream().pipeThrough(new CompressionStream("gzip"));
      await env.CAPTURES.put(key, await new Response(stream).arrayBuffer());
    }
  }
}
async function get(path = "", init: RequestInit = { headers }) {
  return worker.fetch(new Request(`https://worker.test/api/operator/sessions${path}`, init), env);
}
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM replays").run();
  vi.spyOn(Date, "now").mockReturnValue(now);
});

describe("RM-08 operator API", () => {
  it("rejects auth, invalid query and methods before storage; preserves private cache/CORS errors", async () => {
    const prepare = vi.fn(() => {
      throw new Error("storage accessed");
    });
    const scoped = { ...env, DB: { ...env.DB, prepare } };
    expect((await handleOperatorSessions(new Request("https://test/api/operator/sessions"), scoped)).status).toBe(401);
    expect(
      (
        await handleOperatorSessions(
          new Request("https://test/api/operator/sessions?minScore=9&maxScore=1", { headers }),
          scoped,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleOperatorSessions(
          new Request("https://test/api/operator/sessions", { headers, method: "POST" }),
          scoped,
        )
      ).status,
    ).toBe(405);
    expect(prepare).not.toHaveBeenCalled();
    for (const init of [
      { headers: { Origin: "https://evil.example" } },
      {},
      { headers, method: "POST" },
    ] as RequestInit[])
      expect((await get("", init)).headers.get("cache-control")).toBe("private, no-store");
  });
  it("filters exact boundaries and feedback with stable equal-time pagination", async () => {
    for (const [i, feedback] of [null, "🔥", "👍", "😕", "😤"].entries())
      await seed(`run-${i}`, { score: i, wave: i, feedback });
    for (const [i, feedback] of ["none", "🔥", "👍", "😕", "😤"].entries()) {
      const response = await get(
        `?build=build%2Bdirty&minScore=${i}&maxScore=${i}&minWave=${i}&maxWave=${i}&outcome=burj_destroyed&feedback=${encodeURIComponent(feedback)}`,
      );
      expect(await response.json()).toMatchObject({ sessions: [{ runId: `run-${i}` }] });
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const payload = (await (
        await get(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      ).json()) as { sessions: { runId: string }[]; nextCursor: string | null };
      ids.push(...payload.sessions.map((row) => row.runId));
      cursor = payload.nextCursor;
    } while (cursor);
    expect(ids).toEqual(["run-4", "run-3", "run-2", "run-1", "run-0"]);
  });
  it("fills status-filtered pages across skipped objects and bounds HEAD concurrency", async () => {
    for (let i = 0; i < 12; i++)
      await seed(`status-${String(i).padStart(2, "0")}`, { state: i % 3 === 0 ? "available" : "object" });
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const payload = (await (
        await get(`?limit=2&replay=available${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      ).json()) as { sessions: { runId: string }[]; nextCursor: string | null };
      ids.push(...payload.sessions.map((row) => row.runId));
      cursor = payload.nextCursor;
    } while (cursor);
    expect(ids).toEqual(["status-09", "status-06", "status-03", "status-00"]);
    await seed("omitted");
    await seed("expired", { state: "expired" });
    await seed("missing-index", { state: "index" });
    for (const [run, state] of [
      ["omitted", "omitted"],
      ["expired", "expired"],
      ["missing-index", "missing"],
      ["status-11", "missing"],
      ["status-09", "available"],
    ])
      expect(await (await get(`/${run}/replay`)).json()).toMatchObject({ replayStatus: state });
  });
  it("projects detail without R2 reads or private fields and bounds corrupt JSON errors", async () => {
    await seed("detail", { state: "available" });
    const getObject = vi.fn(() => {
        throw new Error("R2 read");
      }),
      head = vi.fn(() => {
        throw new Error("R2 head");
      });
    const response = await handleOperatorSessions(
      new Request("https://test/api/operator/sessions/detail", { headers }),
      { ...env, CAPTURES: { ...env.CAPTURES, get: getObject, head } },
      "detail",
    );
    expect(response.status).toBe(200);
    expect(getObject).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    const text = await response.text();
    for (const value of [
      "private-",
      "install_id",
      "display_name",
      "feedback_note",
      "sha256",
      "r2_key",
      "submitter",
      "apple_bundle_id",
      '"replay":',
    ])
      expect(text).not.toContain(value);
    expect(JSON.parse(text)).toMatchObject({
      session: { runId: "detail", upgrades: [{ bought: ["patriot"] }], appFlavor: "staging" },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const field of ["upgrades_json", "destroyed_by_type_json"]) {
      await env.DB.prepare(`UPDATE sessions SET ${field} = ? WHERE run_id = ?`).bind("{private-secret", "detail").run();
      const failure = await get("/detail");
      expect(failure.status).toBe(500);
      expect(await failure.text()).not.toContain("private-secret");
      await env.DB.prepare(`UPDATE sessions SET ${field} = ? WHERE run_id = ?`)
        .bind(
          JSON.stringify(
            field === "upgrades_json" ? sessionFixture().summary.upgrades : sessionFixture().summary.destroyedByType,
          ),
          "detail",
        )
        .run();
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-secret");
    log.mockRestore();
  });
  it("retains exact inclusive 365/270-day boundaries and retires raw routes", async () => {
    await seed("summary-boundary", { receivedAt: now - SESSION_RETENTION_MS });
    await seed("too-old", { receivedAt: now - SESSION_RETENTION_MS - 1 });
    await seed("replay-boundary", { receivedAt: now - REPLAY_RETENTION_MS, state: "available" });
    expect((await get("/summary-boundary")).status).toBe(200);
    expect((await get("/too-old")).status).toBe(404);
    expect(await (await get("/replay-boundary/replay")).json()).toMatchObject({
      replayStatus: "available",
      replay: expect.any(Object),
    });
    for (const path of ["/api/sessions", "/api/session/summary-boundary"])
      expect((await worker.fetch(new Request(`https://test${path}`, { headers }), env)).status).toBe(404);
    const query = operatorQuery(parseOperatorFilters(new URLSearchParams("minScore=1&build=build%2Bdirty")), now, 50);
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .bind(...query.values)
      .all();
    expect(JSON.stringify(plan.results)).toContain("idx_sessions_recent");
  });
});
