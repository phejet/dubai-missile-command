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
    expect(screen.getByText(/wave 5 complete/i)).toBeTruthy();
    expect(screen.getByText(/9999/)).toBeTruthy();
  });

  it("renders upgrade cards as clickable articles", () => {
    const { container } = render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={noop} />);
    const cards = container.querySelectorAll("[data-shop-card]");
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("selects a card on click and confirms to buy", () => {
    const onBuy = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ShopUI shopData={makeShopData({ score: 100000 })} onBuyUpgrade={onBuy} onClose={onClose} />,
    );
    const card = container.querySelector("[data-shop-card]");
    fireEvent.click(card);
    expect(card.dataset.selected).toBeTruthy();
    const deployBtn = container.querySelector(".shop-modal__deploy");
    expect(deployBtn.disabled).toBe(false);
    fireEvent.click(deployBtn);
    expect(onBuy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("deploy button is disabled when nothing selected", () => {
    const onClose = vi.fn();
    const { container } = render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={onClose} />);
    const deployBtn = container.querySelector(".shop-modal__deploy");
    expect(deployBtn.disabled).toBe(true);
    fireEvent.click(deployBtn);
    expect(onClose).not.toHaveBeenCalled();
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
    expect(container.textContent).toMatch(/MAXED/);
  });

  it("shows draft mode UI with 3 offered cards", () => {
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
    });
    const { container } = render(<ShopUI shopData={data} onBuyUpgrade={noop} onClose={noop} />);
    expect(container.textContent).toMatch(/choose 1/i);
    const cards = container.querySelectorAll("[data-shop-card]");
    expect(cards.length).toBe(3);
  });

  it("allows changing draft selection before confirming", () => {
    const onBuy = vi.fn();
    const onClose = vi.fn();
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
    });
    const { container } = render(<ShopUI shopData={data} onBuyUpgrade={onBuy} onClose={onClose} />);
    const cards = container.querySelectorAll("[data-shop-card]");
    // Select first card
    fireEvent.click(cards[0]);
    expect(cards[0].dataset.selected).toBeTruthy();
    // Change to second card
    fireEvent.click(cards[1]);
    expect(cards[1].dataset.selected).toBeTruthy();
    expect(cards[0].dataset.selected).toBeFalsy();
    // Confirm
    const deployBtn = container.querySelector(".shop-modal__deploy");
    fireEvent.click(deployBtn);
    expect(onBuy).toHaveBeenCalledWith("ironBeam");
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to a one-column portrait layout when requested", () => {
    render(<ShopUI shopData={makeShopData()} onBuyUpgrade={noop} onClose={noop} mode="phonePortrait" />);
    expect(document.querySelector('[data-shop-mode="phonePortrait"]')).toBeTruthy();
    expect(document.querySelector(".shop-grid--phonePortrait")).toBeTruthy();
  });
});
