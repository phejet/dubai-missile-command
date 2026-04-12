import { describe, expect, it } from "vitest";
import { createEmptyUpgradeProgression } from "./game-sim-upgrades";
import {
  buildUpgradeGraphViewModel,
  fitUpgradeGraphViewport,
  getDefaultSelectedUpgradeNodeId,
  zoomUpgradeGraphViewportAtPoint,
} from "./upgrade-graph";

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

  it("fits the widened graph into a viewport and zooms around a point", () => {
    const view = buildUpgradeGraphViewModel({
      progression: createEmptyUpgradeProgression(),
      ownedNodes: new Set(),
    });

    const fitted = fitUpgradeGraphViewport(900, 520, view.width, view.height);
    expect(fitted.scale).toBeLessThanOrEqual(1);
    expect(fitted.scale).toBeGreaterThan(0.3);

    const zoomed = zoomUpgradeGraphViewportAtPoint(
      fitted,
      900,
      520,
      view.width,
      view.height,
      { x: 450, y: 260 },
      fitted.scale * 1.5,
    );

    expect(zoomed.scale).toBeGreaterThan(fitted.scale);
  });
});
