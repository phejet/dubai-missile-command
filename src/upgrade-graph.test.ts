import { describe, expect, it } from "vitest";
import { createEmptyUpgradeProgression } from "./game-sim-upgrades";
import { buildUpgradeGraphViewModel, getDefaultSelectedUpgradeNodeId } from "./upgrade-graph";

describe("upgrade graph view model", () => {
  it("maps owned, available, locked, and meta-locked node states", () => {
    const emptyView = buildUpgradeGraphViewModel({
      progression: createEmptyUpgradeProgression(),
      ownedNodes: new Set(),
    });

    expect(emptyView.nodes.find((node) => node.id === "wildHornets")?.state).toBe("available");
    expect(emptyView.nodes.find((node) => node.id === "tridentFpvCell")?.state).toBe("locked");
    expect(emptyView.nodes.find((node) => node.id === "patriotRapidBattery")?.state).toBe("metaLocked");

    const progressedView = buildUpgradeGraphViewModel({
      progression: { version: 1, completedObjectives: ["reach_wave_4"] },
      ownedNodes: new Set(["wildHornets", "patriot"]),
    });

    expect(progressedView.nodes.find((node) => node.id === "wildHornets")?.state).toBe("owned");
    expect(progressedView.nodes.find((node) => node.id === "tridentFpvCell")?.state).toBe("available");
    expect(progressedView.nodes.find((node) => node.id === "patriotRapidBattery")?.state).toBe("available");
  });

  it("prefers available nodes for default selection", () => {
    const view = buildUpgradeGraphViewModel({
      progression: createEmptyUpgradeProgression(),
      ownedNodes: new Set(["wildHornets"]),
    });

    const selectedNodeId = getDefaultSelectedUpgradeNodeId(view);
    expect(view.nodes.find((node) => node.id === selectedNodeId)?.state).toBe("available");
  });
});
