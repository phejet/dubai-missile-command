// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { showShop, hideShop } from "./ui";

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
  beforeEach(() => {
    // Set up shop container in DOM
    document.body.innerHTML = '<div id="shop-container"></div>';
    hideShop();
  });

  it("renders without crashing", () => {
    showShop(makeShopData(), noop, noop);
    const container = document.getElementById("shop-container")!;
    expect(container.innerHTML).toBeTruthy();
    hideShop();
  });

  it("displays current wave and budget", () => {
    showShop(makeShopData({ wave: 5, score: 9999 }), noop, noop);
    const text = document.getElementById("shop-container")!.textContent!;
    expect(text).toMatch(/Wave 5 Complete/);
    expect(text).toMatch(/9999/);
    hideShop();
  });

  it("renders upgrade cards as clickable articles", () => {
    showShop(makeShopData(), noop, noop);
    const cards = document.querySelectorAll("[data-shop-card]");
    expect(cards.length).toBeGreaterThanOrEqual(2);
    hideShop();
  });

  it("selects a card on click and confirms to buy", () => {
    const onBuy = vi.fn();
    const onClose = vi.fn();
    showShop(makeShopData({ score: 100000 }), onBuy, onClose);
    const card = document.querySelector("[data-shop-card]") as HTMLElement;
    card.click();
    // After click, the shop re-renders — find the card again
    const updatedCard = document.querySelector("[data-shop-card]") as HTMLElement;
    expect(updatedCard.dataset.selected).toBeTruthy();
    const deployBtn = document.querySelector("#shop-deploy-btn") as HTMLButtonElement;
    expect(deployBtn.disabled).toBe(false);
    deployBtn.click();
    expect(onBuy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("deploy button is disabled when nothing selected", () => {
    const onClose = vi.fn();
    showShop(makeShopData(), noop, onClose);
    const deployBtn = document.querySelector("#shop-deploy-btn") as HTMLButtonElement;
    expect(deployBtn.disabled).toBe(true);
    deployBtn.click();
    expect(onClose).not.toHaveBeenCalled();
    hideShop();
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
    showShop(data, noop, noop);
    expect(document.getElementById("shop-container")!.textContent).toMatch(/MAXED/);
    hideShop();
  });

  it("shows draft mode UI with 3 offered cards", () => {
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
    });
    showShop(data, noop, noop);
    expect(document.getElementById("shop-container")!.textContent).toMatch(/Choose 1/);
    const cards = document.querySelectorAll("[data-shop-card]");
    expect(cards.length).toBe(3);
    hideShop();
  });

  it("allows changing draft selection before confirming", () => {
    const onBuy = vi.fn();
    const onClose = vi.fn();
    const data = makeShopData({
      draftMode: true,
      draftOffers: ["wildHornets", "ironBeam", "phalanx"],
    });
    showShop(data, onBuy, onClose);
    // Select first card
    let cards = document.querySelectorAll("[data-shop-card]") as NodeListOf<HTMLElement>;
    cards[0].click();
    cards = document.querySelectorAll("[data-shop-card]") as NodeListOf<HTMLElement>;
    expect(cards[0].dataset.selected).toBeTruthy();
    // Change to second card
    cards[1].click();
    cards = document.querySelectorAll("[data-shop-card]") as NodeListOf<HTMLElement>;
    expect(cards[1].dataset.selected).toBeTruthy();
    expect(cards[0].dataset.selected).toBeFalsy();
    // Confirm
    const deployBtn = document.querySelector("#shop-deploy-btn") as HTMLButtonElement;
    deployBtn.click();
    expect(onBuy).toHaveBeenCalledWith("ironBeam");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders with phonePortrait layout", () => {
    showShop(makeShopData(), noop, noop);
    expect(document.querySelector('[data-shop-mode="phonePortrait"]')).toBeTruthy();
    expect(document.querySelector(".shop-grid--phonePortrait")).toBeTruthy();
    hideShop();
  });
});
