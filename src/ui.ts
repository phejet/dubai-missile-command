// Vanilla DOM UI — shop modal, bonus screen, HUD updates
// Replaces ShopUI.tsx and BonusScreen.tsx

import { COL } from "./game-logic";
import { UPGRADES } from "./game-sim";
import type { UpgradeKey, Upgrades } from "./types";
import SFX from "./sound";

// ─── Types ──────────────────────────────────────────────────────────

export interface ShopData {
  draftMode?: boolean;
  draftOffers?: string[];
  upgrades: Upgrades;
  score: number;
  wave: number;
  burjHealth: number;
}

type UpgradeDef = (typeof UPGRADES)[keyof typeof UPGRADES] & {
  disabled?: boolean;
  active?: boolean;
};

export interface HudSnapshot {
  score: number;
  wave: number;
  waveProgress: number;
  burjHealth: number;
  burjAlive: boolean;
  fps: number;
  rafFps: number;
  rafFrameMs: number;
  perfGlowEnabled: boolean;
  perfProbed: boolean;
  ammo: number[];
  ammoMax: number;
  launcherHP: number[];
  empCharge: number;
  empChargeMax: number;
  empReady: boolean;
}

// ─── Shop ───────────────────────────────────────────────────────────

let shopCleanup: (() => void) | null = null;

function getEntries(shopData: ShopData): [string, UpgradeDef][] {
  const allEntries = (Object.entries(UPGRADES) as [string, UpgradeDef][]).filter(([, def]) => !def.disabled);
  return shopData.draftMode ? allEntries.filter(([key]) => shopData.draftOffers?.includes(key)) : allEntries;
}

export function showShop(shopData: ShopData, onBuyUpgrade: (key: UpgradeKey) => void, onClose: () => void): void {
  hideShop();
  const container = document.getElementById("shop-container")!;
  const isDraftMode = !!shopData.draftMode;
  const entries = getEntries(shopData);
  let selected: string[] = [];

  function getSelectedCost(): number {
    return selected.reduce((sum, key) => {
      const def = UPGRADES[key as UpgradeKey] as UpgradeDef | undefined;
      if (!def) return sum;
      const level = shopData.upgrades[key as UpgradeKey];
      return sum + (isDraftMode ? 0 : def.costs[level] || 0);
    }, 0);
  }

  function render() {
    const remainingBudget = shopData.score - getSelectedCost();

    const cardsHtml = entries
      .map(([key, def]) => {
        const level = shopData.upgrades[key as UpgradeKey];
        const maxed = level >= def.maxLevel;
        const cost = maxed ? null : isDraftMode ? 0 : def.costs[level];
        const isBurjRepair = key === "burjRepair";
        const burjFull = isBurjRepair && shopData.burjHealth >= 5;
        if (isBurjRepair && maxed && burjFull) return "";

        const isSelected = selected.includes(key);
        const canAfford = cost !== null && (isDraftMode || remainingBudget >= cost || isSelected);
        const isMaxedOut = (maxed && !isBurjRepair) || burjFull;
        const disabled = isMaxedOut || (!canAfford && !isSelected);

        const levelDots = Array.from(
          { length: def.maxLevel },
          (_, i) => `<span class="shop-card__level-dot ${i < level ? "shop-card__level-dot--filled" : ""}"></span>`,
        ).join("");

        const costHtml =
          !isDraftMode && cost !== null
            ? `<span class="shop-card__cost">${isBurjRepair ? `HEAL $${cost}` : `$${cost}`}</span>`
            : "";

        const statLine =
          !maxed && !isDraftMode && def.statLines[level]
            ? `<div class="shop-card__statline"><span class="shop-card__statline-label">Next</span><span>${def.statLines[level]}</span></div>`
            : "";

        const statusHtml = isMaxedOut ? `<div class="shop-card__status">\u2713 MAXED</div>` : "";
        const checkHtml = isSelected ? `<div class="shop-card__check">\u2713</div>` : "";
        const badge = def.active ? `<span class="shop-card__badge">Active</span>` : "";

        return `<article class="shop-card${disabled ? " shop-card--disabled" : ""}${isDraftMode ? " shop-card--draft" : ""}${isSelected ? " shop-card--selected" : ""}"
          style="--shop-accent: ${def.color}; --shop-panel: ${COL.panelBg}"
          role="button" tabindex="${disabled ? -1 : 0}"
          data-shop-card="${key}" ${isSelected ? 'data-selected="true"' : ""} ${disabled ? 'data-disabled="true"' : ""}>
          <div class="shop-card__topline">
            <span class="shop-card__icon" aria-hidden="true">${def.icon}</span>
            <div class="shop-card__headline">
              <div class="shop-card__name">${def.name}${badge}</div>
              <div class="shop-card__levels" aria-label="Level ${level} of ${def.maxLevel}">${levelDots}</div>
            </div>
            ${costHtml}
          </div>
          <p class="shop-card__description">${def.desc}</p>
          ${statLine}${statusHtml}${checkHtml}
        </article>`;
      })
      .join("");

    const budgetHtml = isDraftMode
      ? `<strong class="shop-modal__budget-value">${selected.length > 0 ? "1 Selected" : "Choose 1"}</strong>`
      : `<span class="shop-modal__budget-label">Budget</span><strong class="shop-modal__budget-value">$ ${remainingBudget}</strong>`;

    const subtitleHtml = isDraftMode
      ? `<p class="shop-modal__subtitle">Pick one free upgrade and confirm.</p>`
      : `<p class="shop-modal__subtitle">Select upgrades, then confirm to deploy.</p>`;

    const deployLabel = isDraftMode
      ? "Confirm &amp; Deploy"
      : selected.length > 0
        ? `Confirm (${selected.length}) &amp; Deploy Wave ${shopData.wave + 1}`
        : `Confirm &amp; Deploy Wave ${shopData.wave + 1}`;

    container.innerHTML = `
      <div class="shop-modal shop-modal--phonePortrait" role="dialog" aria-modal="true">
        <div class="shop-modal__backdrop"></div>
        <div class="shop-modal__panel ${isDraftMode ? "shop-modal__panel--draft" : ""}" data-shop-mode="phonePortrait">
          <header class="shop-modal__header">
            <div>
              <div class="shop-modal__eyebrow">Defense Systems Market</div>
              <h2 class="shop-modal__title">Wave ${shopData.wave} Complete</h2>
              ${subtitleHtml}
            </div>
            <div class="shop-modal__budget">${budgetHtml}</div>
          </header>
          <div class="shop-modal__scroll">
            <div class="shop-grid shop-grid--phonePortrait">${cardsHtml}</div>
          </div>
          <footer class="shop-modal__footer">
            <button type="button" class="shop-modal__deploy${selected.length === 0 ? " shop-modal__deploy--disabled" : ""}" id="shop-deploy-btn" ${selected.length === 0 ? "disabled" : ""}>${deployLabel}</button>
          </footer>
        </div>
      </div>`;
  }

  function toggleSelect(key: string) {
    if (isDraftMode) {
      selected = selected.includes(key) ? [] : [key];
    } else {
      selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    }
    render();
  }

  function handleConfirm() {
    for (const key of selected) {
      onBuyUpgrade(key as UpgradeKey);
    }
    onClose();
  }

  function handleClick(e: Event) {
    const target = e.target as HTMLElement;
    const card = target.closest("[data-shop-card]") as HTMLElement | null;
    if (card && !card.dataset.disabled) {
      toggleSelect(card.dataset.shopCard!);
      return;
    }
    const deployBtn = target.closest("#shop-deploy-btn") as HTMLButtonElement | null;
    if (deployBtn && !deployBtn.disabled) {
      handleConfirm();
      return;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const card = target.closest("[data-shop-card]") as HTMLElement | null;
    if (card && !card.dataset.disabled && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggleSelect(card.dataset.shopCard!);
    }
  }

  render();
  container.addEventListener("click", handleClick);
  container.addEventListener("keydown", handleKeyDown);

  shopCleanup = () => {
    container.removeEventListener("click", handleClick);
    container.removeEventListener("keydown", handleKeyDown);
    container.innerHTML = "";
  };
}

export function hideShop(): void {
  if (shopCleanup) {
    shopCleanup();
    shopCleanup = null;
  }
}

// ─── Bonus Screen ───────────────────────────────────────────────────

const BUILDING_PTS_EACH = 100;
const AMMO_PTS_EACH = 50;
const TICK_MS_BUILDING = 80;
const TICK_MS_AMMO = 55;

let bonusCleanup: (() => void) | null = null;

export function showBonusScreen(
  data: { wave: number; buildings: number; savedAmmo: number; missileKills: number; droneKills: number },
  onScoreAdd: (pts: number) => void,
  onComplete: () => void,
): void {
  hideBonusScreen();
  const container = document.getElementById("bonus-container")!;

  let phase = 0;
  let buildingCount = 0;
  let ammoCount = 0;
  let totalVisible = false;
  let flashOn = true;
  let done = false;
  const timers: number[] = [];

  const buildingBonus = data.buildings * BUILDING_PTS_EACH * data.wave;
  const ammoBonus = data.savedAmmo * AMMO_PTS_EACH;
  const totalBonus = buildingBonus + ammoBonus;

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  }

  function finish() {
    if (done) return;
    done = true;
    clearTimers();
    onComplete();
  }

  function handleTap() {
    if (phase < 2) return;
    if (phase < 7) {
      const remainingBuilding = (data.buildings - buildingCount) * BUILDING_PTS_EACH * data.wave;
      const remainingAmmo = (data.savedAmmo - ammoCount) * AMMO_PTS_EACH;
      if (remainingBuilding > 0) onScoreAdd(remainingBuilding);
      if (remainingAmmo > 0) onScoreAdd(remainingAmmo);
      phase = 8;
      finish();
    } else if (phase >= 7) {
      finish();
    }
  }

  function render() {
    const visible = phase >= 1 ? " bonus-screen--visible" : "";
    const killsHtml =
      phase >= 2
        ? `<div class="bonus-screen__section bonus-screen__section--kills">
          <div class="bonus-screen__label">Destroyed this wave</div>
          <div class="bonus-screen__kills">
            <div class="bonus-screen__kill-row"><span class="bonus-screen__kill-type">Missiles</span><span class="bonus-screen__kill-count">${data.missileKills}</span></div>
            <div class="bonus-screen__kill-row"><span class="bonus-screen__kill-type">Drones</span><span class="bonus-screen__kill-count">${data.droneKills}</span></div>
          </div>
        </div><div class="bonus-screen__divider"></div>`
        : "";

    const buildingHtml =
      phase >= 3
        ? `<div class="bonus-screen__section">
          <div class="bonus-screen__label">Buildings survived</div>
          <div class="bonus-screen__row">
            <span class="bonus-screen__count">${phase >= 4 ? buildingCount : 0}</span>
            <span class="bonus-screen__pts">${phase >= 4 && buildingCount > 0 ? `+ ${(buildingCount * BUILDING_PTS_EACH * data.wave).toLocaleString()}` : ""}</span>
          </div>
        </div>`
        : "";

    const ammoHtml =
      phase >= 5
        ? `<div class="bonus-screen__section">
          <div class="bonus-screen__label">Missiles saved</div>
          <div class="bonus-screen__row">
            <span class="bonus-screen__count">${phase >= 6 ? ammoCount : 0}</span>
            <span class="bonus-screen__pts">${phase >= 6 && ammoCount > 0 ? `+ ${(ammoCount * AMMO_PTS_EACH).toLocaleString()}` : ""}</span>
          </div>
        </div>`
        : "";

    const divider2 = phase >= 3 ? `<div class="bonus-screen__divider"></div>` : "";

    const totalClass = totalVisible
      ? flashOn
        ? "bonus-screen__total--on"
        : "bonus-screen__total--off"
      : "bonus-screen__total--hidden";

    container.innerHTML = `
      <div class="bonus-screen${visible}" aria-live="polite">
        <div class="bonus-screen__scanlines" aria-hidden="true"></div>
        <div class="bonus-screen__panel">
          <div class="bonus-screen__header">
            ${phase >= 1 ? `<div class="bonus-screen__eyebrow">After Action Report</div><h2 class="bonus-screen__title bonus-screen__flicker">Wave ${data.wave} Complete</h2>` : ""}
          </div>
          <div class="bonus-screen__body">
            ${killsHtml}${buildingHtml}${ammoHtml}${divider2}
            <div class="bonus-screen__total ${totalClass}">
              <span class="bonus-screen__total-label">Total bonus</span>
              <span class="bonus-screen__total-value">+ ${totalBonus.toLocaleString()}</span>
            </div>
          </div>
          <div class="bonus-screen__footer"><div class="bonus-screen__hint">Tap to continue</div></div>
        </div>
      </div>`;
  }

  function advancePhase(nextPhase: number) {
    phase = nextPhase;
    render();
  }

  function runPhases() {
    // Phase 0 → 1
    timers.push(
      window.setTimeout(() => {
        advancePhase(1);
        // Phase 1 → 2
        timers.push(
          window.setTimeout(() => {
            advancePhase(2);
            // Phase 2 → 3
            timers.push(
              window.setTimeout(() => {
                advancePhase(3);
                // Phase 3 → 4
                timers.push(
                  window.setTimeout(() => {
                    advancePhase(4);
                    // Count buildings
                    if (data.buildings === 0) {
                      timers.push(window.setTimeout(() => startAmmoPhase(), 300));
                    } else {
                      let count = 0;
                      const iv = window.setInterval(() => {
                        count++;
                        buildingCount = count;
                        SFX.bonusTick();
                        onScoreAdd(BUILDING_PTS_EACH * data.wave);
                        render();
                        if (count >= data.buildings) {
                          clearInterval(iv);
                          timers.push(window.setTimeout(() => startAmmoPhase(), 500));
                        }
                      }, TICK_MS_BUILDING);
                      timers.push(iv as unknown as number);
                    }
                  }, 100),
                );
              }, 150),
            );
          }, 250),
        );
      }, 50),
    );
  }

  function startAmmoPhase() {
    advancePhase(5);
    timers.push(
      window.setTimeout(() => {
        advancePhase(6);
        if (data.savedAmmo === 0) {
          timers.push(window.setTimeout(() => showTotal(), 300));
        } else {
          let count = 0;
          const iv = window.setInterval(() => {
            count++;
            ammoCount = count;
            SFX.bonusTick();
            onScoreAdd(AMMO_PTS_EACH);
            render();
            if (count >= data.savedAmmo) {
              clearInterval(iv);
              timers.push(window.setTimeout(() => showTotal(), 500));
            }
          }, TICK_MS_AMMO);
          timers.push(iv as unknown as number);
        }
      }, 150),
    );
  }

  function showTotal() {
    phase = 7;
    totalVisible = true;
    SFX.bonusTotal();
    render();
    let flashes = 0;
    const iv = window.setInterval(() => {
      flashes++;
      flashOn = !flashOn;
      render();
      if (flashes >= 8) {
        clearInterval(iv);
        flashOn = true;
        render();
      }
    }, 140);
    timers.push(iv as unknown as number);
  }

  render();
  container.addEventListener("click", handleTap);
  runPhases();

  bonusCleanup = () => {
    clearTimers();
    container.removeEventListener("click", handleTap);
    container.innerHTML = "";
  };
}

export function hideBonusScreen(): void {
  if (bonusCleanup) {
    bonusCleanup();
    bonusCleanup = null;
  }
}

// ─── HUD Updates ────────────────────────────────────────────────────

const hudElements = {
  progressFill: null as HTMLElement | null,
  score: null as HTMLElement | null,
  ammoCells: null as HTMLElement[] | null,
  empButton: null as HTMLButtonElement | null,
  empMeta: null as HTMLElement | null,
  perfRaf: null as HTMLElement | null,
  perfFrame: null as HTMLElement | null,
  perfHudFps: null as HTMLElement | null,
  perfGlow: null as HTMLElement | null,
};

export function cacheHudElements(): void {
  hudElements.progressFill = document.getElementById("hud-progress-fill");
  hudElements.score = document.getElementById("hud-score");
  hudElements.ammoCells = [0, 1, 2].map((i) => document.getElementById(`hud-ammo-${i}`)!);
  hudElements.empButton = document.getElementById("emp-button") as HTMLButtonElement;
  hudElements.empMeta = document.getElementById("emp-meta");
  hudElements.perfRaf = document.getElementById("perf-raf");
  hudElements.perfFrame = document.getElementById("perf-frame");
  hudElements.perfHudFps = document.getElementById("perf-hud-fps");
  hudElements.perfGlow = document.getElementById("perf-glow");
}

export function updateHud(hud: HudSnapshot): void {
  const h = hudElements;
  if (h.progressFill) h.progressFill.style.width = `${hud.waveProgress}%`;
  if (h.score) h.score.textContent = String(hud.score);
  if (h.ammoCells) {
    for (let i = 0; i < 3; i++) {
      const cell = h.ammoCells[i];
      if (!cell) continue;
      const alive = hud.launcherHP[i] > 0;
      const count = hud.ammo[i];
      cell.className = `battlefield-ammo__cell${alive ? "" : " battlefield-ammo__cell--down"}`;
      const stateEl = cell.querySelector(".battlefield-ammo__state") as HTMLElement;
      if (stateEl) stateEl.textContent = alive ? "Online" : "Down";
      const countEl = cell.querySelector(".battlefield-ammo__count") as HTMLElement;
      if (countEl) countEl.textContent = String(count);
      const maxEl = cell.querySelector(".battlefield-ammo__max") as HTMLElement;
      if (maxEl) maxEl.textContent = `/${hud.ammoMax}`;
      const meterFill = cell.querySelector(".battlefield-ammo__meter-fill") as HTMLElement;
      if (meterFill) {
        const pct = alive ? Math.max(0, Math.min(100, (count / Math.max(1, hud.ammoMax)) * 100)) : 0;
        meterFill.style.width = `${pct}%`;
      }
    }
  }
  // EMP button
  if (h.empButton) {
    if (hud.empChargeMax > 0) {
      h.empButton.hidden = false;
      h.empButton.className = `battlefield-emp${hud.empReady ? " battlefield-emp--ready" : ""}`;
      h.empButton.disabled = !hud.empReady;
      h.empButton.setAttribute("aria-label", hud.empReady ? "Fire EMP" : "EMP charging");
    } else {
      h.empButton.hidden = true;
    }
  }
  if (h.empMeta) {
    const pct =
      hud.empChargeMax > 0 ? Math.max(0, Math.min(100, Math.round((hud.empCharge / hud.empChargeMax) * 100))) : 0;
    h.empMeta.textContent = hud.empReady ? "READY" : `${pct}%`;
  }
  // Perf overlay
  if (h.perfRaf) h.perfRaf.textContent = hud.rafFps ? `${hud.rafFps.toFixed(1)} fps` : "--";
  if (h.perfFrame) h.perfFrame.textContent = hud.rafFrameMs ? `${hud.rafFrameMs.toFixed(1)} ms` : "--";
  if (h.perfHudFps) h.perfHudFps.textContent = hud.fps ? `${hud.fps} fps` : "--";
  if (h.perfGlow) h.perfGlow.textContent = hud.perfProbed ? (hud.perfGlowEnabled ? "on" : "off") : "probing";
}

// ─── Game Over ──────────────────────────────────────────────────────

export function showGameOver(
  score: number,
  wave: number,
  stats: { missileKills: number; droneKills: number; shotsFired: number },
): void {
  const totalKills = stats.missileKills + stats.droneKills;
  const hitRatio = stats.shotsFired > 0 ? Math.round((totalKills / stats.shotsFired) * 100) : 0;
  const el = (id: string) => document.getElementById(id);
  el("go-score")!.textContent = String(score);
  el("go-wave")!.textContent = String(wave);
  el("go-ratio")!.textContent = `${hitRatio}%`;
  el("go-missiles")!.textContent = String(stats.missileKills);
}
