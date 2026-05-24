// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDebugUpgradeFamilyOptions,
  loadDebugOptions,
  saveDebugOptions,
  setForceShowUpgradeFamily,
} from "./debug-options";

describe("debug options", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("loads an empty force-show list by default", () => {
    expect(loadDebugOptions()).toEqual({ forceShowUpgradeFamilies: [] });
  });

  it("persists force-show families and filters invalid stored values", () => {
    saveDebugOptions({ forceShowUpgradeFamilies: ["roadrunner", "wildHornets"] });
    expect(loadDebugOptions().forceShowUpgradeFamilies).toEqual(["roadrunner", "wildHornets"]);

    localStorage.setItem(
      "dubai-missile-command.debug-options.v1",
      JSON.stringify({ forceShowUpgradeFamilies: ["roadrunner", "bogus", "roadrunner", 42] }),
    );
    expect(loadDebugOptions().forceShowUpgradeFamilies).toEqual(["roadrunner"]);
  });

  it("toggles a family without duplicating it", () => {
    const enabled = setForceShowUpgradeFamily({ forceShowUpgradeFamilies: [] }, "roadrunner", true);
    const enabledAgain = setForceShowUpgradeFamily(enabled, "roadrunner", true);
    const disabled = setForceShowUpgradeFamily(enabledAgain, "roadrunner", false);

    expect(enabledAgain.forceShowUpgradeFamilies).toEqual(["roadrunner"]);
    expect(disabled.forceShowUpgradeFamilies).toEqual([]);
  });

  it("marks Burj Repair as not draftable in the title debug table data", () => {
    const burjRepair = getDebugUpgradeFamilyOptions().find((option) => option.key === "burjRepair");
    expect(burjRepair).toMatchObject({ name: "Burj Repair Kit", draftable: false });
  });

  it("marks Phalanx CIWS as not draftable while it is hidden from shop offers", () => {
    const phalanx = getDebugUpgradeFamilyOptions().find((option) => option.key === "phalanx");
    expect(phalanx).toMatchObject({ name: "Phalanx CIWS", draftable: false });
  });
});
