import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evidencePayload, request } from "./operator-delete-capture.mjs";

describe("operator deletion CLI guards", () => {
  it("prints help without requiring credentials", () => {
    const result = spawnSync(process.execPath, ["scripts/operator-delete-capture.mjs", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--recover-reservation");
    expect(result.stdout).toContain("--list-jobs");
    expect(result.stdout).toContain("--recover-job");
    expect(result.stdout).not.toContain("Bearer test");
  });

  it("rejects Production before reading credentials without a second acknowledgement", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/operator-delete-capture.mjs", "--env", "production", "--scope", "run", "--reference", "run-1"],
      { cwd: process.cwd(), encoding: "utf8", env: {} },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires the separate --production acknowledgement");
  });

  it("sends authenticated job requests without placing the token in the body", async () => {
    const fetch = async (url, init) => {
      expect(String(url)).toBe("https://capture.example/api/operator/deletion/jobs/list");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer operator-secret");
      expect(JSON.parse(init.body)).toEqual({});
      expect(init.body).not.toContain("operator-secret");
      return Response.json({ ok: true, jobs: [] });
    };
    const result = await request(
      "https://capture.example",
      "/api/operator/deletion/jobs/list",
      {},
      "operator-secret",
      fetch,
    );
    expect(result.response.status).toBe(200);
    expect(result.payload).toEqual({ ok: true, jobs: [] });
  });

  it("redacts identifiers and payload material from evidence", () => {
    const evidence = evidencePayload("staging", {
      ok: true,
      verified: true,
      jobId: "job-1",
      planDigest: "a".repeat(64),
      sessions: ["private-run"],
      replayObjects: ["replays/private.json.gz"],
      token: "absolutely-not",
    });
    expect(evidence.counts.sessions).toBe(1);
    expect(JSON.stringify(evidence)).not.toContain("private-run");
    expect(JSON.stringify(evidence)).not.toContain("absolutely-not");
  });
});
