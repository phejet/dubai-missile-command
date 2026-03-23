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
    const { container } = render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={noop} />);
    expect(container.innerHTML).toBeTruthy();
  });

  it("displays current wave and budget", () => {
    render(<ShopUI shopData={makeShopData({ wave: 5, score: 9999 })} onBuyUpgrade={noop} onClose={noop} />);
    expect(screen.getByText(/WAVE 5 COMPLETE/)).toBeTruthy();
    expect(screen.getByText(/9999/)).toBeTruthy();
  });

  it("renders upgrade cards", () => {
    const { container } = render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={noop} />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onBuyUpgrade when buy button is clicked", () => {
    const onBuy = vi.fn();
    const { container } = render(
      <ShopUI shopData={makeShopData({ score: 100000 })} onBuyUpgrade={onBuy} onClose={noop} />,
    );
    const upgradeBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("UPGRADE"));
    expect(upgradeBtn).toBeTruthy();
    fireEvent.click(upgradeBtn);
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when deploy button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={onClose} />);
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
    const { container } = render(<ShopUI shopData={data} onBuyUpgrade={noop} onClose={noop} />);
    const maxedBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("MAXED"));
    expect(maxedBtn).toBeTruthy();
  });

  it("shows draft mode UI with 3 offered items", () => {
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
      draftPicked: false,
    });
    const { container } = render(<ShopUI shopData={data} onBuyUpgrade={noop} onClose={noop} />);
    expect(container.textContent).toContain("DRAFT MODE");
    const freeButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("FREE"));
    expect(freeButtons.length).toBe(3);
  });

  it("disables draft buttons after picking", () => {
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
      draftPicked: true,
    });
    const { container } = render(<ShopUI shopData={data} onBuyUpgrade={noop} onClose={noop} />);
    expect(container.textContent).toContain("UPGRADE SELECTED");
    const dashButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "—");
    expect(dashButtons.length).toBe(3);
  });
});
