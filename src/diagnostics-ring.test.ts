import { beforeEach, describe, expect, it, vi } from "vitest";
import { ringClear, ringPush, ringReadAll } from "./diagnostics-ring";

describe("diagnostics ring buffer", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("stores pushed lines in order", () => {
    ringPush("a");
    ringPush("b");
    expect(ringReadAll()).toEqual(["a", "b"]);
  });

  it("caps the buffer at 50 entries, dropping the oldest", () => {
    for (let i = 0; i < 60; i++) ringPush(`line-${i}`);
    const entries = ringReadAll();
    expect(entries).toHaveLength(50);
    expect(entries[0]).toBe("line-10");
    expect(entries[49]).toBe("line-59");
  });

  it("truncates long lines to 512 chars", () => {
    ringPush("x".repeat(2000));
    expect(ringReadAll()[0]).toHaveLength(512);
  });

  it("tolerates corrupt stored JSON", () => {
    localStorage.setItem("dmc.diag.ring.v1", "{not json");
    expect(ringReadAll()).toEqual([]);
    ringPush("fresh");
    expect(ringReadAll()).toEqual(["fresh"]);
  });

  it("tolerates non-array stored JSON and non-string members", () => {
    localStorage.setItem("dmc.diag.ring.v1", JSON.stringify({ nope: true }));
    expect(ringReadAll()).toEqual([]);
    localStorage.setItem("dmc.diag.ring.v1", JSON.stringify(["ok", 42, null]));
    expect(ringReadAll()).toEqual(["ok"]);
  });

  it("clears the buffer", () => {
    ringPush("a");
    ringClear();
    expect(ringReadAll()).toEqual([]);
  });
});
