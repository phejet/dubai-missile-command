// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyUpgradeProgression } from "./game-sim-upgrades";
import { hideUpgradeProgression, showUpgradeProgression } from "./ui";

describe("Upgrade progression UI", () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="progression-panel" hidden></section>';
    hideUpgradeProgression();
  });

  it("renders the full graph panel and responds to node selection", () => {
    showUpgradeProgression(
      {
        progression: createEmptyUpgradeProgression(),
        ownedNodes: new Set(["wildHornets"]),
      },
      vi.fn(),
    );

    const panel = document.getElementById("progression-panel")!;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toMatch(/Upgrade Graph/);
    expect(panel.querySelector('[data-node-id="patriotRapidBattery"]')).toBeTruthy();

    (panel.querySelector('[data-node-id="patriotRapidBattery"]') as HTMLButtonElement).click();
    expect(panel.textContent).toMatch(/Patriot Rapid Battery/);
    expect(panel.textContent).toMatch(/Reach wave 4 in a previous run/);
  });

  it("calls onClose from the back button", () => {
    const onClose = vi.fn();
    showUpgradeProgression(
      {
        progression: createEmptyUpgradeProgression(),
        ownedNodes: new Set(),
      },
      onClose,
    );

    (document.querySelector("[data-progression-close]") as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalled();
  });
});
