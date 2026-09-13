import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkoutProblem, nextDriver, releaseRecordFromLog, releaseStatus } from "./staging-deploy.mjs";

describe("quiet Staging release status", () => {
  it("extracts the recovery record without exposing build logs", () => {
    expect(releaseRecordFromLog("noise\nRelease build 5. Resume record: /tmp/release.json\nmore noise")).toBe(
      "/tmp/release.json",
    );
    expect(releaseRecordFromLog("archive not started")).toBeNull();
  });
  it("does not mistake delivery for completed tester assignment", () => {
    const driver = { status: "running", stage: "release", log: "/tmp/release.log" };
    expect(releaseStatus(driver, { number: "5", uploadRequested: true })).toMatchObject({
      status: "running",
      stage: "apple-processing",
      build: "5",
    });
    expect(releaseStatus(driver, { ready: true, number: "5" })).toMatchObject({
      status: "ready",
      stage: "internal-testers",
    });
    expect(releaseStatus({ ...driver, status: "failed" }, { archived: true })).toMatchObject({
      status: "failed",
      stage: "staging-deployment",
    });
  });
});

describe("in-place Staging release driver", () => {
  const now = new Date("2026-09-13T12:34:56.789Z");

  it("starts a release with its log under operator-results", () => {
    expect(nextDriver(null, false, { output: "/repo/operator-results", now, pid: 42 })).toEqual({
      log: "/repo/operator-results/staging-deploy/2026-09-13T12-34-56-789Z/release.log",
      status: "running",
      stage: "prepare",
      pid: 42,
    });
    expect(nextDriver({ status: "ready" }, false, { output: "/o", now, pid: 1 }).status).toBe("running");
  });
  it("resumes an unfinished release instead of starting over it", () => {
    const failed = { status: "failed", stage: "release", log: "/tmp/release.log" };
    expect(() => nextDriver(failed, false)).toThrow("Previous release is unfinished");
    expect(nextDriver(failed, true)).toBe(failed);
  });
  it("has nothing to resume without an unfinished release", () => {
    expect(() => nextDriver(null, true)).toThrow("No unfinished release to resume.");
    expect(() => nextDriver({ status: "ready" }, true)).toThrow("No unfinished release to resume.");
  });
  it("requires a clean checkout at origin/main before replacing dependencies", () => {
    expect(checkoutProblem({ status: "", head: "abc", remote: "abc" })).toBeNull();
    expect(checkoutProblem({ status: " M src/game.ts", head: "abc", remote: "abc" })).toMatch(/clean checkout/);
    expect(checkoutProblem({ status: "", head: "abc", remote: "def" })).toMatch(/origin\/main/);
  });
  it("never prepares a separate checkout", () => {
    const source = readFileSync(new URL("./staging-deploy.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/worktree|mkdtemp|tmpdir/);
  });
});
