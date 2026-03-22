// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ShopUI from "./ShopUI.jsx";

function makeShopData(overrides = {}) {
  return {
    score: 5000,
    wave: 3,
    upgrades: {
      wildHornets: 0,
      roadrunner: 0,
      flare: 0,
      ironBeam: 0,
      phalanx: 0,
      patriot: 0,
      burjRepair: 0,
      launcherKit: 0,
      emp: 0,
    },
    burjHealth: 5,
    launcherHP: [1, 1, 1],
    defenseSites: [],
    ...overrides,
  };
}

const noop = () => {};

describe("ShopUI", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <ShopUI
        shopData={makeShopData()}
        onBuyUpgrade={noop}
        onRepairSite={noop}
        onRepairLauncher={noop}
        onClose={noop}
      />,
    );
    expect(container.innerHTML).toBeTruthy();
  });

  it("displays current wave and budget", () => {
    render(
      <ShopUI
        shopData={makeShopData({ wave: 5, score: 9999 })}
        onBuyUpgrade={noop}
        onRepairSite={noop}
        onRepairLauncher={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText(/WAVE 5 COMPLETE/)).toBeTruthy();
    expect(screen.getByText(/9999/)).toBeTruthy();
  });

  it("renders upgrade cards", () => {
    const { container } = render(
      <ShopUI
        shopData={makeShopData()}
        onBuyUpgrade={noop}
        onRepairSite={noop}
        onRepairLauncher={noop}
        onClose={noop}
      />,
    );
    // Should have multiple upgrade buttons
    const buttons = container.querySelectorAll("button");
    // At least the deploy button + some upgrade buttons
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onBuyUpgrade when buy button is clicked", () => {
    const onBuy = vi.fn();
    const { container } = render(
      <ShopUI
        shopData={makeShopData({ score: 100000 })}
        onBuyUpgrade={onBuy}
        onRepairSite={noop}
        onRepairLauncher={noop}
        onClose={noop}
      />,
    );
    // Find an UPGRADE button and click it
    const upgradeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("UPGRADE"));
    expect(upgradeBtn).toBeTruthy();
    fireEvent.click(upgradeBtn);
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when deploy button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ShopUI
        shopData={makeShopData()}
        onBuyUpgrade={noop}
        onRepairSite={noop}
        onRepairLauncher={noop}
        onClose={onClose}
      />,
    );
    const deployBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("DEPLOY WAVE"));
    fireEvent.click(deployBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows MAXED for max-level upgrades", () => {
    const data = makeShopData({
      upgrades: {
        wildHornets: 3,
        roadrunner: 0,
        flare: 0,
        ironBeam: 0,
        phalanx: 0,
        patriot: 0,
        burjRepair: 0,
        launcherKit: 0,
        emp: 0,
      },
    });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={noop} onRepairLauncher={noop} onClose={noop} />,
    );
    const maxedBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("MAXED"));
    expect(maxedBtn).toBeTruthy();
  });

  it("shows repair launcher buttons when launchers are destroyed", () => {
    const data = makeShopData({ launcherHP: [0, 1, 0] });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={noop} onRepairLauncher={noop} onClose={noop} />,
    );
    const repairBtns = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("REPAIR L"));
    expect(repairBtns.length).toBe(2); // L1 and L3
  });

  it("calls onRepairLauncher when repair button is clicked", () => {
    const onRepair = vi.fn();
    const data = makeShopData({ launcherHP: [0, 1, 1], score: 100000 });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={noop} onRepairLauncher={onRepair} onClose={noop} />,
    );
    const repairBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("REPAIR L1"));
    expect(repairBtn).toBeTruthy();
    fireEvent.click(repairBtn);
    expect(onRepair).toHaveBeenCalledWith(0);
  });

  it("shows repair site button when defense site is destroyed", () => {
    const data = makeShopData({
      upgrades: {
        wildHornets: 1,
        roadrunner: 0,
        flare: 0,
        ironBeam: 0,
        phalanx: 0,
        patriot: 0,
        burjRepair: 0,
        launcherKit: 0,
        emp: 0,
      },
      defenseSites: [{ key: "wildHornets", alive: false }],
    });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={noop} onRepairLauncher={noop} onClose={noop} />,
    );
    const repairBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("REPAIR"));
    expect(repairBtn).toBeTruthy();
  });

  it("calls onRepairSite when site repair button is clicked", () => {
    const onRepairSite = vi.fn();
    const data = makeShopData({
      score: 100000,
      upgrades: {
        wildHornets: 1,
        roadrunner: 0,
        flare: 0,
        ironBeam: 0,
        phalanx: 0,
        patriot: 0,
        burjRepair: 0,
        launcherKit: 0,
        emp: 0,
      },
      defenseSites: [{ key: "wildHornets", alive: false }],
    });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={onRepairSite} onRepairLauncher={noop} onClose={noop} />,
    );
    const repairBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("REPAIR"));
    fireEvent.click(repairBtn);
    expect(onRepairSite).toHaveBeenCalledWith("wildHornets");
  });

  it("shows 'REPAIR LAUNCHERS FIRST' for non-launcher upgrades when launchers are destroyed", () => {
    const data = makeShopData({ launcherHP: [0, 1, 1] });
    const { container } = render(
      <ShopUI shopData={data} onBuyUpgrade={noop} onRepairSite={noop} onRepairLauncher={noop} onClose={noop} />,
    );
    expect(container.textContent).toContain("REPAIR LAUNCHERS FIRST");
  });
});
