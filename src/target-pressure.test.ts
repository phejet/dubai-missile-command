import { describe, expect, it } from "vitest";
import {
  choosePressureCategory,
  commitPressure,
  createPressureLedger,
  finishPressure,
  reservePressure,
} from "./target-pressure";
const all = ["tower", "building", "infrastructure"] as const;

describe("terminal pressure ledger", () => {
  it("keeps every uninterrupted ten-unit window at 30/50/20 without tower runs", () => {
    const choices = Array.from({ length: 100 }, (_, i) => choosePressureCategory(i, all, true)!.category);
    for (let start = 0; start <= 90; start++) {
      const window = choices.slice(start, start + 10);
      expect(all.map((c) => window.filter((v) => v === c).length)).toEqual([3, 5, 2]);
      expect(choices[start] === "tower" && choices[start + 1] === "tower").toBe(false);
    }
  });
  it("does not spend a reservation or compensate for an intercepted carrier", () => {
    const ledger = createPressureLedger(5);
    for (let i = 0; i < 5; i++)
      reservePressure(ledger, choosePressureCategory(i, all, true)!, `target:${i}`, "mirv", 20);
    const next = choosePressureCategory(ledger.units.length, all, true);
    finishPressure(ledger, [0, 1, 2, 3, 4], true);
    expect(ledger.units.every((u) => u.state === "cancelled")).toBe(true);
    expect(choosePressureCategory(ledger.units.length, all, true)).toEqual(next);
    expect(ledger.units).toHaveLength(5);
  });
  it("transfers split units exactly once and keeps the original stack unit", () => {
    const ledger = createPressureLedger(6);
    for (let i = 0; i < 3; i++)
      reservePressure(ledger, choosePressureCategory(i, all, true)!, `target:${i}`, "stack3", 0);
    commitPressure(ledger, 0, 0, 90);
    commitPressure(ledger, 1, 30, 80);
    commitPressure(ledger, 2, 30, 85);
    expect(commitPressure(ledger, 0, 30, 90)).toBe(false);
    expect(ledger.invariantFailures).toBe(1);
    expect(ledger.units[0].committedTick).toBe(0);
    expect(ledger.units).toHaveLength(3);
    finishPressure(ledger, [0], true);
    finishPressure(ledger, [1], false);
    expect(ledger.units.map((u) => u.state)).toEqual(["ended", "ended", "committed"]);
  });
  it("redistributes non-tower units without silently choosing the tower", () => {
    expect(choosePressureCategory(0, ["tower", "infrastructure"], true)).toMatchObject({
      category: "infrastructure",
      exception: "non-tower-redistribution",
    });
    expect(choosePressureCategory(0, ["tower"], true)).toBeNull();
    expect(choosePressureCategory(0, [], false)).toBeNull();
    expect(choosePressureCategory(1, ["building"], true)).toMatchObject({
      category: "building",
      exception: "tower-unavailable",
    });
  });
  it("marks every tower-only unit, including a normally tower-assigned slot", () => {
    for (const i of [0, 1, 2])
      expect(choosePressureCategory(i, ["tower"], false)).toMatchObject({ category: "tower", exception: "tower-only" });
  });
  it("starts a fresh wave without carrying old pressure debt and survives structured cloning", () => {
    const ledger = createPressureLedger(1);
    reservePressure(ledger, choosePressureCategory(0, all, true)!, "building:0", "missile", 10);
    const copy = structuredClone(ledger);
    commitPressure(copy, 0, 10, 60);
    expect(ledger.units[0].state).toBe("reserved");
    const nextWave = createPressureLedger(2);
    expect(nextWave.units).toEqual([]);
    expect(choosePressureCategory(0, all, true)?.category).toBe("building");
  });
});
