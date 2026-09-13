import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseOperatorFilters } from "./operator-contract";
import { operatorFragment, parseOperatorFragment, parseList, RequestSlot } from "./operator-api";

describe("operator contracts", () => {
  it.each([
    "limit=0",
    "limit=101",
    "limit=1.1",
    "minWave=-1",
    "minScore=9&maxScore=8",
    "minWave=2&maxWave=1",
    "build=x%27",
    "outcome=anything",
    "feedback=hello",
    "replay=unknown",
    "cursor=bad",
    "limit=1&limit=2",
    "token=secret",
  ])("rejects invalid query %s", (query) => expect(() => parseOperatorFilters(new URLSearchParams(query))).toThrow());
  it("accepts inclusive zero ranges and reserved feedback", () => {
    expect(parseOperatorFilters(new URLSearchParams("minScore=0&maxScore=0&minWave=0&maxWave=0"))).toMatchObject({
      minScore: 0,
      maxScore: 0,
      minWave: 0,
      maxWave: 0,
    });
    for (const feedback of ["none", "🔥", "👍", "😕", "😤"])
      expect(parseOperatorFilters(new URLSearchParams({ feedback })).feedback).toBe(feedback);
  });
  it("round-trips a strict tie-break cursor", () => {
    const cursor = { receivedAt: 123, runId: "run+a" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor(btoa(JSON.stringify({ ...cursor, token: "secret" })))).toThrow();
  });
  it("uses fragments for exact Staging candidates and rejects extra/token fields", () => {
    expect(operatorFragment("older+run")).toBe("#environment=staging&run=older%2Brun");
    expect(parseOperatorFragment(operatorFragment("older+run"))).toBe("older+run");
    for (const value of [
      "#environment=production&run=run",
      "#environment=staging&run=../run",
      "#environment=staging&run=run&token=secret",
      "#environment=staging&environment=staging",
    ])
      expect(() => parseOperatorFragment(value)).toThrow();
  });
  it("aborts all stale generations, including work after response parsing", () => {
    const slot = new RequestSlot();
    const old = slot.begin();
    const current = slot.begin();
    expect(old.aborted).toBe(true);
    expect(slot.current(old)).toBe(false);
    expect(slot.current(current)).toBe(true);
    slot.cancel();
    expect(slot.current(current)).toBe(false);
  });
  it("rejects hostile response shapes and removes unexpected fields", () => {
    expect(() => parseList({ sessions: [{}] })).toThrow();
    const list = parseList({
      ok: true,
      sessions: [
        {
          runId: "run",
          receivedAt: 0,
          build: "build",
          score: 0,
          wave: 1,
          outcome: "abandoned",
          feedbackEmoji: null,
          replayStatus: "omitted",
          install_id: "secret",
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(list)).not.toContain("secret");
  });
});
