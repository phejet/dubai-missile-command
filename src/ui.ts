// Vanilla DOM UI — shop modal, bonus screen, HUD updates
// Replaces ShopUI.tsx and BonusScreen.tsx

import { CANVAS_H, CANVAS_W, COL, cloneDestroyedByTypeStats, normalizeGameStats } from "./game-logic";
import {
  buildUpgradeGraphViewModel,
  clampUpgradeGraphViewport,
  fitUpgradeGraphViewport,
  graphScreenToWorld,
  getDefaultSelectedUpgradeNodeId,
  renderUpgradeGraphDetailMarkup,
  renderUpgradeGraphMarkup,
  zoomUpgradeGraphViewportAtPoint,
} from "./upgrade-graph";
import { getPurchaseDisplayName, getUpgradeObjectiveLabel } from "./game-sim-upgrades";
import {
  DESTROYED_TYPE_KEYS,
  type DestroyedByTypeStats,
  type GameStats,
  type RunRecapData,
  type ShopEntry,
} from "./types";
import type { UpgradeNodeId, UpgradeProgressionState } from "./types";
import SFX from "./sound";
import { BUILDING_SURVIVAL_BONUS_POINTS, getBuildingSurvivalBonus } from "./wave-bonus";

// ─── Types ──────────────────────────────────────────────────────────

export interface ShopData {
  draftMode?: boolean;
  entries: ShopEntry[];
  score: number;
  wave: number;
  burjHealth: number;
}

export interface HudSnapshot {
  score: number;
  combo: number;
  wave: number;
  waveProgress: number;
  burjHealth: number;
  burjAlive: boolean;
  fps: number;
  rafFps: number;
  rafFrameMs: number;
  ammo: number[];
  ammoMax: number;
  launcherHP: number[];
  activeFamily: "emp" | "f15" | "flare" | null;
  activeLabel: string;
  activeReady: boolean;
  activePhase: ActiveButtonPhase;
}

export type ActiveButtonPhase = "ready" | "active" | "complete" | "spent";

export interface RunRecapCallbacks {
  onClose: () => void;
  onSaveReplay: () => void | Promise<void>;
  onWatchFullReplay: () => void;
  onReplayDeathClip?: () => void;
}

export interface TransientOverlaySnapshot {
  titleCopyVisible: boolean;
  mirvWarning: { visible: boolean; alpha: number };
  purchaseToast: { visible: boolean; text: string; alpha: number };
  lowAmmoWarning: { visible: boolean; text: string; alpha: number };
  waveClearedBanner: { visible: boolean; text: string; alpha: number };
  multiKillToast: {
    visible: boolean;
    label: string;
    bonus: number;
    x: number;
    y: number;
    alpha: number;
    scale: number;
    tier: "normal" | "triple" | "mega";
  };
  comboToast: {
    visible: boolean;
    text: string;
    x: number;
    y: number;
    alpha: number;
    scale: number;
    tier: "warm" | "hot" | "critical";
  };
}

// ─── Shop ───────────────────────────────────────────────────────────

let shopCleanup: (() => void) | null = null;

export function showShop(shopData: ShopData, onBuyUpgrade: (key: string) => void, onClose: () => void): void {
  hideShop();
  const container = document.getElementById("shop-container")!;
  const isDraftMode = !!shopData.draftMode;
  let selected: string[] = [];

  function getSelectedCost(): number {
    return selected.reduce((sum, key) => {
      const entry = shopData.entries.find((item) => item.id === key);
      if (!entry || entry.cost === null) return sum;
      return sum + (isDraftMode ? 0 : entry.cost);
    }, 0);
  }

  function render() {
    const remainingBudget = shopData.score - getSelectedCost();

    const cardsHtml = shopData.entries
      .map((entry) => {
        const isSelected = selected.includes(entry.id);
        const cost = isDraftMode ? 0 : entry.cost;
        const canAfford = cost === null || remainingBudget >= cost || isSelected;
        const disabled = entry.disabled || (!canAfford && !isSelected);

        const levelDots = Array.from(
          { length: entry.maxLevel },
          (_, i) =>
            `<span class="shop-card__level-dot ${i < entry.level ? "shop-card__level-dot--filled" : ""}"></span>`,
        ).join("");

        const costHtml = !isDraftMode && cost !== null ? `<span class="shop-card__cost">$${cost}</span>` : "";

        const statLine =
          !isDraftMode && entry.statLine
            ? `<div class="shop-card__statline"><span class="shop-card__statline-label">Effect</span><span>${entry.statLine}</span></div>`
            : "";

        const statusHtml = entry.statusText ? `<div class="shop-card__status">${entry.statusText}</div>` : "";
        const checkHtml = isSelected ? `<div class="shop-card__check">\u2713</div>` : "";
        const badge = entry.active ? `<span class="shop-card__badge">Active</span>` : "";

        return `<article class="shop-card${disabled ? " shop-card--disabled" : ""}${isDraftMode ? " shop-card--draft" : ""}${isSelected ? " shop-card--selected" : ""}"
          style="--shop-accent: ${entry.color}; --shop-panel: ${COL.panelBg}"
          role="button" tabindex="${disabled ? -1 : 0}"
          data-shop-card="${entry.id}" ${isSelected ? 'data-selected="true"' : ""} ${disabled ? 'data-disabled="true"' : ""}>
          <div class="shop-card__topline">
            <span class="shop-card__icon" aria-hidden="true">${entry.icon}</span>
            <div class="shop-card__headline">
              <div class="shop-card__name">${entry.name}${badge}</div>
              <div class="shop-card__levels" aria-label="Level ${entry.level} of ${entry.maxLevel}">${levelDots}</div>
            </div>
            ${costHtml}
          </div>
          <p class="shop-card__description">${entry.desc}</p>
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
      onBuyUpgrade(key);
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

const TICK_MS_BUILDING = 80;

let bonusCleanup: (() => void) | null = null;

const DESTROYED_TYPE_LABELS: Record<keyof DestroyedByTypeStats, string> = {
  ballisticMissile: "Missiles",
  mirv: "MIRVs",
  mirvWarhead: "MIRV warheads",
  stackedMissile: "Stacked missiles",
  bomb: "Bombs",
  shahed136: "Shahed-136",
  shahed238: "Shahed-238",
  other: "Other",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface WaveSummaryData {
  wave: number;
  buildings: number;
  missileKills: number;
  droneKills: number;
  destroyedByType: DestroyedByTypeStats;
  multiShots: number;
  maxCombo: number;
}

function renderDestroyedTypeRows(destroyedByType: Partial<DestroyedByTypeStats>): string {
  const counts = cloneDestroyedByTypeStats(destroyedByType);
  const rows = DESTROYED_TYPE_KEYS.filter((key) => counts[key] > 0);
  const visibleRows = rows.length > 0 ? rows : DESTROYED_TYPE_KEYS.slice(0, 1);
  return visibleRows
    .map(
      (key) => `
              <div class="bonus-screen__kill-row">
                <span class="bonus-screen__kill-type">${DESTROYED_TYPE_LABELS[key]}</span>
                <span class="bonus-screen__kill-count">${counts[key]}</span>
              </div>`,
    )
    .join("");
}

export function showBonusScreen(
  data: WaveSummaryData,
  onScoreAdd: (pts: number) => void,
  onComplete: () => void,
  options: { autoCompleteAfterTotalMs?: number } = {},
): void {
  hideBonusScreen();
  const container = document.getElementById("bonus-container")!;

  let phase = 0;
  let buildingCount = 0;
  let totalVisible = false;
  let flashOn = true;
  let done = false;
  const timers: number[] = [];

  const buildingBonus = getBuildingSurvivalBonus(data);
  const totalBonus = buildingBonus;
  const totalKills = data.missileKills + data.droneKills;

  container.innerHTML = `
    <div class="bonus-screen" aria-live="polite">
      <div class="bonus-screen__scanlines" aria-hidden="true"></div>
      <div class="bonus-screen__panel">
        <div class="bonus-screen__header">
          <div class="bonus-screen__eyebrow" hidden>After Action Report</div>
          <h2 class="bonus-screen__title bonus-screen__flicker" hidden>Wave ${data.wave} Complete</h2>
        </div>
        <div class="bonus-screen__body">
          <div class="bonus-screen__section bonus-screen__section--kills" hidden>
            <div class="bonus-screen__label">Destroyed this wave</div>
            <div class="bonus-screen__kills">
              ${renderDestroyedTypeRows(data.destroyedByType)}
            </div>
            <div class="bonus-screen__stat-grid">
              <div class="bonus-screen__stat">
                <span class="bonus-screen__stat-label">Total kills</span>
                <strong class="bonus-screen__stat-value">${totalKills}</strong>
              </div>
              <div class="bonus-screen__stat">
                <span class="bonus-screen__stat-label">Multi shots</span>
                <strong class="bonus-screen__stat-value">${data.multiShots}</strong>
              </div>
              <div class="bonus-screen__stat">
                <span class="bonus-screen__stat-label">Max combo</span>
                <strong class="bonus-screen__stat-value">${data.maxCombo}x</strong>
              </div>
            </div>
          </div>
          <div class="bonus-screen__divider bonus-screen__divider--kills" hidden></div>
          <div class="bonus-screen__section bonus-screen__section--buildings" hidden>
            <div class="bonus-screen__label">Buildings survived</div>
            <div class="bonus-screen__row">
              <span class="bonus-screen__count bonus-screen__count--buildings">0</span>
              <span class="bonus-screen__pts bonus-screen__pts--buildings"></span>
            </div>
          </div>
          <div class="bonus-screen__total bonus-screen__total--hidden">
            <span class="bonus-screen__total-label">Total bonus</span>
            <span class="bonus-screen__total-value">+ ${totalBonus.toLocaleString()}</span>
          </div>
        </div>
        <div class="bonus-screen__footer"><div class="bonus-screen__hint">Tap to continue</div></div>
      </div>
    </div>`;

  const root = container.firstElementChild as HTMLDivElement;
  const eyebrowEl = container.querySelector(".bonus-screen__eyebrow") as HTMLDivElement;
  const titleEl = container.querySelector(".bonus-screen__title") as HTMLHeadingElement;
  const killsSectionEl = container.querySelector(".bonus-screen__section--kills") as HTMLDivElement;
  const killsDividerEl = container.querySelector(".bonus-screen__divider--kills") as HTMLDivElement;
  const buildingsSectionEl = container.querySelector(".bonus-screen__section--buildings") as HTMLDivElement;
  const buildingsCountEl = container.querySelector(".bonus-screen__count--buildings") as HTMLSpanElement;
  const buildingsPtsEl = container.querySelector(".bonus-screen__pts--buildings") as HTMLSpanElement;
  const totalEl = container.querySelector(".bonus-screen__total") as HTMLDivElement;

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
    if (phase < 5) {
      const remainingBuilding = (data.buildings - buildingCount) * BUILDING_SURVIVAL_BONUS_POINTS * data.wave;
      if (remainingBuilding > 0) onScoreAdd(remainingBuilding);
      phase = 6;
      finish();
    } else if (phase >= 5) {
      finish();
    }
  }

  function render() {
    root.classList.toggle("bonus-screen--visible", phase >= 1);
    eyebrowEl.hidden = phase < 1;
    titleEl.hidden = phase < 1;

    killsSectionEl.hidden = phase < 2;
    killsDividerEl.hidden = phase < 2;

    buildingsSectionEl.hidden = phase < 3;
    buildingsCountEl.textContent = String(phase >= 4 ? buildingCount : 0);
    buildingsPtsEl.textContent =
      phase >= 4 && buildingCount > 0
        ? `+ ${(buildingCount * BUILDING_SURVIVAL_BONUS_POINTS * data.wave).toLocaleString()}`
        : "";

    totalEl.className = `bonus-screen__total ${
      totalVisible ? (flashOn ? "bonus-screen__total--on" : "bonus-screen__total--off") : "bonus-screen__total--hidden"
    }`;
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
                      timers.push(window.setTimeout(() => showTotal(), 300));
                    } else {
                      let count = 0;
                      const iv = window.setInterval(() => {
                        count++;
                        buildingCount = count;
                        SFX.bonusTick();
                        onScoreAdd(BUILDING_SURVIVAL_BONUS_POINTS * data.wave);
                        render();
                        if (count >= data.buildings) {
                          clearInterval(iv);
                          timers.push(window.setTimeout(() => showTotal(), 500));
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

  function showTotal() {
    phase = 5;
    totalVisible = true;
    SFX.bonusTotal();
    render();
    if (options.autoCompleteAfterTotalMs !== undefined) {
      timers.push(window.setTimeout(() => finish(), options.autoCompleteAfterTotalMs));
    }
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
  root.addEventListener("click", handleTap);
  runPhases();

  bonusCleanup = () => {
    clearTimers();
    root.removeEventListener("click", handleTap);
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
  comboPanel: null as HTMLElement | null,
  comboValue: null as HTMLElement | null,
  comboStatus: null as HTMLElement | null,
  activeButton: null as HTMLButtonElement | null,
  activeLabel: null as HTMLElement | null,
  activeMeta: null as HTMLElement | null,
  perfRaf: null as HTMLElement | null,
  perfFrame: null as HTMLElement | null,
  perfHudFps: null as HTMLElement | null,
};

const ACTIVE_COMPLETION_MS = 1050;

const activeButtonVisual = {
  family: null as "emp" | "f15" | "flare" | null,
  previousRawPhase: "spent" as ActiveButtonPhase,
  completionUntil: 0,
  completionFamily: null as "emp" | "f15" | "flare" | null,
};

function resolveActiveButtonPhase(hud: HudSnapshot): ActiveButtonPhase {
  const family = hud.activeFamily;
  if (!family) {
    activeButtonVisual.family = null;
    activeButtonVisual.previousRawPhase = "spent";
    activeButtonVisual.completionUntil = 0;
    activeButtonVisual.completionFamily = null;
    return "spent";
  }

  const now = performance.now();
  const sameFamily = activeButtonVisual.family === family;
  const rawPhase = hud.activePhase;

  if (!sameFamily || rawPhase === "ready") {
    activeButtonVisual.family = family;
    activeButtonVisual.completionUntil = 0;
    activeButtonVisual.completionFamily = null;
  }

  if (rawPhase === "spent" && sameFamily && activeButtonVisual.previousRawPhase === "active") {
    activeButtonVisual.completionUntil = now + ACTIVE_COMPLETION_MS;
    activeButtonVisual.completionFamily = family;
  }

  const visualPhase =
    rawPhase === "spent" && activeButtonVisual.completionFamily === family && now < activeButtonVisual.completionUntil
      ? "complete"
      : rawPhase;

  activeButtonVisual.family = family;
  activeButtonVisual.previousRawPhase = rawPhase;
  return visualPhase;
}

export function cacheHudElements(): void {
  hudElements.progressFill = document.getElementById("hud-progress-fill");
  hudElements.score = document.getElementById("hud-score");
  hudElements.comboPanel = document.getElementById("hud-combo");
  hudElements.comboValue = document.getElementById("hud-combo-value");
  hudElements.comboStatus = document.getElementById("hud-combo-status");
  hudElements.activeButton = document.getElementById("active-button") as HTMLButtonElement;
  hudElements.activeLabel = document.getElementById("active-label");
  hudElements.activeMeta = document.getElementById("active-meta");
  hudElements.perfRaf = document.getElementById("perf-raf");
  hudElements.perfFrame = document.getElementById("perf-frame");
  hudElements.perfHudFps = document.getElementById("perf-hud-fps");
}

export function updateHud(hud: HudSnapshot): void {
  const h = hudElements;
  if (h.progressFill) h.progressFill.style.width = `${hud.waveProgress}%`;
  if (h.score) h.score.textContent = String(hud.score);
  if (h.comboPanel) {
    const combo = Math.max(1, hud.combo);
    const active = combo >= 2;
    const tier = combo >= 8 ? "critical" : combo >= 5 ? "hot" : combo >= 2 ? "warm" : "idle";
    h.comboPanel.dataset.active = String(active);
    h.comboPanel.dataset.tier = tier;
    if (h.comboValue) h.comboValue.textContent = `${combo}\u00d7`;
    if (h.comboStatus) {
      h.comboStatus.textContent =
        combo >= 8 ? "Overdrive" : combo >= 5 ? "Burning" : combo >= 2 ? "Building" : "Standby";
    }
  }
  // Active upgrade button
  if (h.activeButton) {
    if (hud.activeFamily) {
      const visualPhase = resolveActiveButtonPhase(hud);
      h.activeButton.hidden = visualPhase === "spent";
      h.activeButton.dataset.family = hud.activeFamily;
      h.activeButton.dataset.phase = visualPhase;
      h.activeButton.className = `battlefield-active battlefield-active--${visualPhase}`;
      h.activeButton.disabled = visualPhase !== "ready";
      h.activeButton.setAttribute(
        "aria-label",
        visualPhase === "ready"
          ? `Fire ${hud.activeLabel}`
          : visualPhase === "active"
            ? `${hud.activeLabel} active`
            : visualPhase === "complete"
              ? `${hud.activeLabel} complete`
              : `${hud.activeLabel} used this wave`,
      );
    } else {
      resolveActiveButtonPhase(hud);
      h.activeButton.hidden = true;
      delete h.activeButton.dataset.family;
      delete h.activeButton.dataset.phase;
    }
  }
  if (h.activeLabel) {
    h.activeLabel.textContent = hud.activeLabel || "EMP";
  }
  if (h.activeMeta) {
    const visualPhase = h.activeButton?.dataset.phase as ActiveButtonPhase | undefined;
    h.activeMeta.textContent =
      visualPhase === "ready"
        ? "READY"
        : visualPhase === "active"
          ? "ACTIVE"
          : visualPhase === "complete"
            ? "COMPLETE"
            : "USED";
  }
  // Perf overlay
  if (h.perfRaf) h.perfRaf.textContent = hud.rafFps ? `${hud.rafFps.toFixed(1)} fps` : "--";
  if (h.perfFrame) h.perfFrame.textContent = hud.rafFrameMs ? `${hud.rafFrameMs.toFixed(1)} ms` : "--";
  if (h.perfHudFps) h.perfHudFps.textContent = hud.fps ? `${hud.fps} fps` : "--";
}

// ─── Transient Overlays ────────────────────────────────────────────

const transientOverlayElements = {
  title: null as HTMLElement | null,
  mirv: null as HTMLElement | null,
  purchase: null as HTMLElement | null,
  lowAmmo: null as HTMLElement | null,
  waveCleared: null as HTMLElement | null,
  multiKill: null as HTMLElement | null,
  multiKillLabel: null as HTMLElement | null,
  multiKillBonus: null as HTMLElement | null,
  comboToast: null as HTMLElement | null,
};

export function cacheTransientOverlayElements(): void {
  transientOverlayElements.title = document.getElementById("title-overlay");
  transientOverlayElements.mirv = document.getElementById("overlay-mirv");
  transientOverlayElements.purchase = document.getElementById("overlay-purchase");
  transientOverlayElements.lowAmmo = document.getElementById("overlay-low-ammo");
  transientOverlayElements.waveCleared = document.getElementById("overlay-wave-cleared");
  transientOverlayElements.multiKill = document.getElementById("overlay-multi-kill");
  transientOverlayElements.multiKillLabel = document.getElementById("overlay-multi-kill-label");
  transientOverlayElements.multiKillBonus = document.getElementById("overlay-multi-kill-bonus");
  transientOverlayElements.comboToast = document.getElementById("overlay-combo-toast");
}

function setOverlayVisible(
  element: HTMLElement | null,
  visible: boolean,
  alpha = 1,
  transform = "translate(-50%, -50%)",
): void {
  if (!element) return;
  element.hidden = !visible;
  element.style.opacity = visible ? String(Math.max(0, Math.min(1, alpha))) : "0";
  element.style.transform = transform;
}

function setOverlayWorldPosition(element: HTMLElement | null, x: number, y: number): void {
  if (!element) return;
  element.style.left = `${(x / CANVAS_W) * 100}%`;
  element.style.top = `${(y / CANVAS_H) * 100}%`;
}

export function updateTransientOverlays(snapshot: TransientOverlaySnapshot): void {
  const els = transientOverlayElements;

  if (els.title) {
    els.title.hidden = !snapshot.titleCopyVisible;
    els.title.setAttribute("aria-hidden", snapshot.titleCopyVisible ? "false" : "true");
  }

  setOverlayVisible(els.mirv, snapshot.mirvWarning.visible, snapshot.mirvWarning.alpha);

  if (els.purchase) els.purchase.textContent = snapshot.purchaseToast.text;
  setOverlayVisible(els.purchase, snapshot.purchaseToast.visible, snapshot.purchaseToast.alpha);

  if (els.lowAmmo) els.lowAmmo.textContent = snapshot.lowAmmoWarning.text;
  setOverlayVisible(els.lowAmmo, snapshot.lowAmmoWarning.visible, snapshot.lowAmmoWarning.alpha);

  if (els.waveCleared) els.waveCleared.textContent = snapshot.waveClearedBanner.text;
  setOverlayVisible(els.waveCleared, snapshot.waveClearedBanner.visible, snapshot.waveClearedBanner.alpha);

  if (els.multiKillLabel) els.multiKillLabel.textContent = snapshot.multiKillToast.label;
  if (els.multiKillBonus) els.multiKillBonus.textContent = `+${snapshot.multiKillToast.bonus}`;
  if (els.multiKill) {
    els.multiKill.dataset.tier = snapshot.multiKillToast.tier;
    setOverlayWorldPosition(els.multiKill, snapshot.multiKillToast.x, snapshot.multiKillToast.y);
  }
  setOverlayVisible(
    els.multiKill,
    snapshot.multiKillToast.visible,
    snapshot.multiKillToast.alpha,
    `translate(-50%, -50%) scale(${snapshot.multiKillToast.scale})`,
  );

  if (els.comboToast) {
    els.comboToast.textContent = snapshot.comboToast.text;
    els.comboToast.dataset.tier = snapshot.comboToast.tier;
    setOverlayWorldPosition(els.comboToast, snapshot.comboToast.x, snapshot.comboToast.y);
  }
  setOverlayVisible(
    els.comboToast,
    snapshot.comboToast.visible,
    snapshot.comboToast.alpha,
    `translate(-50%, -50%) scale(${snapshot.comboToast.scale})`,
  );
}

// ─── Game Over ──────────────────────────────────────────────────────

export function showGameOver(score: number, wave: number, stats: GameStats): void {
  const normalizedStats = normalizeGameStats(stats);
  const totalKills = normalizedStats.missileKills + normalizedStats.droneKills;
  const hitRatio = normalizedStats.shotsFired > 0 ? Math.round((totalKills / normalizedStats.shotsFired) * 100) : 0;
  const el = (id: string) => document.getElementById(id);
  el("go-score")!.textContent = score.toLocaleString();
  el("go-wave")!.textContent = String(wave);
  const hitRatioEl = el("go-hit-ratio");
  if (hitRatioEl) hitRatioEl.textContent = `${hitRatio}%`;
}

// ─── Run Recap ──────────────────────────────────────────────────────

let runRecapCleanup: (() => void) | null = null;

function renderRunRecapHero(data: RunRecapData): string {
  return `
    <div class="run-recap__summary">
      <span><strong>${data.score.toLocaleString()}</strong> score</span>
      <span><strong>W${data.wave}</strong> reached</span>
      <span><strong>${formatPercent(data.hitRatio)}</strong> hits</span>
      <span><strong>${formatDuration(data.timePlayedMs)}</strong></span>
    </div>`;
}

interface RunRecapWaveStory {
  wave: number;
  scoreEarned: number;
  missileKills: number;
  droneKills: number;
  multiShots: number;
  maxCombo: number;
  buildingsSurviving: number;
  burjHealth: number;
  terminal: boolean;
}

function buildWaveStory(data: RunRecapData): RunRecapWaveStory[] {
  const completedScore = data.waves.reduce((sum, wave) => sum + wave.scoreEarned, 0);
  const completedMissileKills = data.waves.reduce((sum, wave) => sum + wave.missileKills, 0);
  const completedDroneKills = data.waves.reduce((sum, wave) => sum + wave.droneKills, 0);
  const lastCompletedWave = data.waves.length > 0 ? data.waves[data.waves.length - 1].wave : 0;
  const terminalWave =
    data.wave > lastCompletedWave
      ? [
          {
            wave: data.wave,
            scoreEarned: Math.max(0, data.score - completedScore),
            missileKills: Math.max(0, data.totalStats.missileKills - completedMissileKills),
            droneKills: Math.max(0, data.totalStats.droneKills - completedDroneKills),
            multiShots: 0,
            maxCombo: data.totalStats.maxCombo,
            buildingsSurviving: 0,
            burjHealth: data.burjHealth,
            terminal: true,
          },
        ]
      : [];
  return [...data.waves.map((wave) => ({ ...wave, terminal: false })), ...terminalWave];
}

function formatWaveScore(score: number): string {
  return `+${score.toLocaleString()} score`;
}

function formatWaveKills(wave: RunRecapWaveStory): string {
  const totalKills = wave.missileKills + wave.droneKills;
  return `${totalKills} ${totalKills === 1 ? "kill" : "kills"}`;
}

function renderBestWave(data: RunRecapData): string {
  const waves = buildWaveStory(data);
  if (waves.length === 0) return `<div class="run-recap__empty">No wave data recorded.</div>`;
  const bestWave = [...waves].sort((a, b) => b.scoreEarned - a.scoreEarned)[0];
  const upgrades = data.upgrades
    .filter((entry) => entry.wave === bestWave.wave)
    .flatMap((entry) => entry.bought)
    .map((key) => `<span>${escapeHtml(getPurchaseDisplayName(key))}</span>`)
    .join("");
  return `
    <div class="run-recap__best-wave">
      <div>
        <span class="run-recap__label">Best Wave</span>
        <strong>Wave ${bestWave.wave}</strong>
      </div>
      <p>${escapeHtml(formatWaveScore(bestWave.scoreEarned))} · ${escapeHtml(formatWaveKills(bestWave))} · ${bestWave.maxCombo}x max combo</p>
      ${upgrades ? `<div class="run-recap__focus-upgrades">${upgrades}</div>` : ""}
    </div>`;
}

function renderBurjDamageTrack(data: RunRecapData): string {
  const waves = buildWaveStory(data);
  if (waves.length === 0) return `<div class="run-recap__empty">No wave data recorded.</div>`;
  return `
    <div class="run-recap__burj-track" aria-label="Burj health over waves">
      ${waves
        .map((wave) => {
          const health = Math.max(0, Math.min(7, wave.burjHealth));
          const lostPercent = Math.round(((7 - health) / 7) * 100);
          const label = `${wave.terminal ? "Final wave" : `Wave ${wave.wave}`}: Burj ${health}/7 HP`;
          return `
            <div class="run-recap__burj-wave ${wave.terminal ? "run-recap__burj-wave--terminal" : ""}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
              <span>W${wave.wave}</span>
              <strong>${health}/7</strong>
              <i style="--lost-percent: ${lostPercent}%"></i>
            </div>`;
        })
        .join("")}
    </div>`;
}

function renderUpgradeTimeline(data: RunRecapData): string {
  if (data.upgrades.length === 0) {
    return `<div class="run-recap__empty">No upgrades purchased.</div>`;
  }
  return `
    <div class="run-recap__upgrade-list">
      ${data.upgrades
        .map(
          (entry) => `
            <div class="run-recap__upgrade-entry">
              <span class="run-recap__upgrade-wave">Wave ${entry.wave}</span>
              <div class="run-recap__upgrade-chips">
                ${entry.bought
                  .map(
                    (key) => `<span class="run-recap__upgrade-chip">${escapeHtml(getPurchaseDisplayName(key))}</span>`,
                  )
                  .join("")}
              </div>
            </div>`,
        )
        .join("")}
    </div>`;
}

function renderRunRecapActions(data: RunRecapData): string {
  return `
    <div class="portrait-panel__actions portrait-panel__actions--stacked run-recap__actions">
      <button type="button" class="action-button action-button--primary action-button--wide" data-run-recap-watch ${data.hasReplay ? "" : "disabled"}>
        Watch Replay
      </button>
      <button type="button" class="action-button action-button--info action-button--wide" data-run-recap-death-clip>
        Replay Last 5 Seconds
      </button>
      <button type="button" class="action-button action-button--info action-button--wide" data-run-recap-save ${data.hasReplay ? "" : "disabled"}>
        Save Replay
      </button>
      <button type="button" class="action-button action-button--info action-button--wide" data-run-recap-close>
        Back to Results
      </button>
    </div>`;
}

export function showRunRecap(data: RunRecapData, callbacks: RunRecapCallbacks): void {
  hideRunRecap();
  const container = document.getElementById("run-recap-panel")!;
  container.innerHTML = `
    <div class="run-recap">
      <div class="portrait-panel__header">
        <span class="portrait-panel__kicker">Run Recap</span>
        <span class="portrait-panel__subtle">After-action report</span>
      </div>
      ${renderRunRecapHero(data)}
      <section class="run-recap__section">
        <h3 class="run-recap__section-title">Watch How You Died</h3>
        <div class="run-recap__death-clip" data-run-recap-death-clip-stage>
          <span>Ready to replay the final seconds.</span>
        </div>
      </section>
      <section class="run-recap__section">
        <h3 class="run-recap__section-title">Burj Damage</h3>
        ${renderBurjDamageTrack(data)}
      </section>
      <section class="run-recap__section">
        <h3 class="run-recap__section-title">Best Wave</h3>
        ${renderBestWave(data)}
      </section>
      <section class="run-recap__section">
        <h3 class="run-recap__section-title">Upgrade Path</h3>
        ${renderUpgradeTimeline(data)}
      </section>
      ${renderRunRecapActions(data)}
    </div>`;

  const handleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-run-recap-close]")) callbacks.onClose();
    else if (target.closest("[data-run-recap-watch]")) callbacks.onWatchFullReplay();
    else if (target.closest("[data-run-recap-save]")) void callbacks.onSaveReplay();
    else if (target.closest("[data-run-recap-death-clip]")) callbacks.onReplayDeathClip?.();
  };
  container.addEventListener("click", handleClick);
  runRecapCleanup = () => {
    container.removeEventListener("click", handleClick);
    container.innerHTML = "";
  };
}

export function hideRunRecap(): void {
  if (runRecapCleanup) {
    runRecapCleanup();
    runRecapCleanup = null;
  }
}

// ─── Upgrade Progression ───────────────────────────────────────────

export interface UpgradeProgressionViewData {
  progression: UpgradeProgressionState;
  ownedNodes?: Set<UpgradeNodeId>;
}

let progressionCleanup: (() => void) | null = null;

function countGraphStates(markupData: ReturnType<typeof buildUpgradeGraphViewModel>) {
  return markupData.nodes.reduce(
    (counts, node) => {
      counts[node.state]++;
      return counts;
    },
    { owned: 0, available: 0, locked: 0, metaLocked: 0 },
  );
}

function getProgressionPanelRoot(): HTMLElement {
  return document.getElementById("progression-panel")!;
}

export function showUpgradeProgression(data: UpgradeProgressionViewData, onClose: () => void): void {
  hideUpgradeProgression();
  const container = getProgressionPanelRoot();
  const view = buildUpgradeGraphViewModel({
    progression: data.progression,
    ownedNodes: data.ownedNodes,
  });
  let selectedNodeId = getDefaultSelectedUpgradeNodeId(view);
  const counts = countGraphStates(view);
  container.innerHTML = `
    <div class="upgrade-graph-shell upgrade-graph-shell--panel">
      <div class="upgrade-graph-shell__header">
        <div>
          <div class="upgrade-graph-shell__eyebrow">Strategic Progression</div>
          <h2 class="upgrade-graph-shell__title">Upgrade Graph</h2>
          <p class="upgrade-graph-shell__copy">Review the full defense network, see which branches are active, and inspect objective-gated unlocks for later runs.</p>
        </div>
        <div class="upgrade-graph-shell__actions">
          <button type="button" class="action-button action-button--info" data-progression-close>Back</button>
        </div>
      </div>
      <div class="upgrade-graph-shell__stats">
        <div class="upgrade-graph-shell__stat">
          <span class="upgrade-graph-shell__stat-label">Owned This Run</span>
          <strong class="upgrade-graph-shell__stat-value">${counts.owned}</strong>
        </div>
        <div class="upgrade-graph-shell__stat">
          <span class="upgrade-graph-shell__stat-label">Available</span>
          <strong class="upgrade-graph-shell__stat-value">${counts.available}</strong>
        </div>
        <div class="upgrade-graph-shell__stat">
          <span class="upgrade-graph-shell__stat-label">Meta Locked</span>
          <strong class="upgrade-graph-shell__stat-value">${counts.metaLocked}</strong>
        </div>
      </div>
      <div class="upgrade-graph-shell__body">
        <div class="upgrade-graph-shell__stage" data-upgrade-graph-stage>
          <div class="upgrade-graph-shell__controls">
            <button type="button" class="upgrade-graph-shell__control" data-zoom-control="out" aria-label="Zoom out">-</button>
            <button type="button" class="upgrade-graph-shell__control" data-zoom-control="fit" aria-label="Fit graph">Fit</button>
            <button type="button" class="upgrade-graph-shell__control" data-zoom-control="in" aria-label="Zoom in">+</button>
            <span class="upgrade-graph-shell__scale" data-upgrade-graph-scale>100%</span>
          </div>
          <div class="upgrade-graph-shell__canvas" data-upgrade-graph-canvas>${renderUpgradeGraphMarkup(view, { selectedNodeId })}</div>
        </div>
        <div class="upgrade-graph-shell__detail" data-upgrade-graph-detail>${renderUpgradeGraphDetailMarkup(view, selectedNodeId)}</div>
      </div>
    </div>`;

  const stageEl = container.querySelector("[data-upgrade-graph-stage]") as HTMLDivElement;
  const canvasEl = container.querySelector("[data-upgrade-graph-canvas]") as HTMLDivElement;
  const detailEl = container.querySelector("[data-upgrade-graph-detail]") as HTMLDivElement;
  const scaleEl = container.querySelector("[data-upgrade-graph-scale]") as HTMLSpanElement;
  const pointers = new Map<number, { x: number; y: number }>();
  const TAP_SLOP = 8;
  let viewport = fitUpgradeGraphViewport(
    Math.max(stageEl.clientWidth, 760),
    Math.max(stageEl.clientHeight, 420),
    view.width,
    view.height,
  );
  let panStart: {
    viewport: typeof viewport;
    point: { x: number; y: number };
    candidateNodeId: UpgradeNodeId | null;
    moved: boolean;
  } | null = null;
  let pinchStart: {
    viewport: typeof viewport;
    midpoint: { x: number; y: number };
    distance: number;
  } | null = null;

  function getStageSize() {
    return {
      width: Math.max(stageEl.clientWidth, 760),
      height: Math.max(stageEl.clientHeight, 420),
    };
  }

  function getStagePoint(clientX: number, clientY: number) {
    const rect = stageEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function applyViewport() {
    canvasEl.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;
    scaleEl.textContent = `${Math.round(viewport.scale * 100)}%`;
  }

  function fitViewport() {
    const size = getStageSize();
    viewport = fitUpgradeGraphViewport(size.width, size.height, view.width, view.height);
    applyViewport();
  }

  function updateSelection(nextNodeId: UpgradeNodeId | null) {
    selectedNodeId = nextNodeId;
    detailEl.innerHTML = renderUpgradeGraphDetailMarkup(view, selectedNodeId);
    container.querySelectorAll<HTMLElement>("[data-node-id]").forEach((nodeEl) => {
      nodeEl.classList.toggle("upgrade-graph__node--selected", nodeEl.dataset.nodeId === selectedNodeId);
    });
  }

  function zoomAt(point: { x: number; y: number }, targetScale: number) {
    const size = getStageSize();
    viewport = zoomUpgradeGraphViewportAtPoint(
      viewport,
      size.width,
      size.height,
      view.width,
      view.height,
      point,
      targetScale,
    );
    applyViewport();
  }

  function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginPinch() {
    const active = Array.from(pointers.values());
    if (active.length < 2) return;
    pinchStart = {
      viewport,
      midpoint: midpoint(active[0], active[1]),
      distance: Math.max(distance(active[0], active[1]), 1),
    };
    panStart = null;
  }

  const handleClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const closeButton = target.closest("[data-progression-close]");
    if (closeButton) {
      onClose();
      return;
    }
    const nodeButton = target.closest("[data-node-id]") as HTMLElement | null;
    if (nodeButton?.dataset.nodeId) {
      updateSelection(nodeButton.dataset.nodeId);
      return;
    }
    const zoomButton = target.closest("[data-zoom-control]") as HTMLElement | null;
    if (zoomButton?.dataset.zoomControl) {
      const size = getStageSize();
      const center = { x: size.width / 2, y: size.height / 2 };
      if (zoomButton.dataset.zoomControl === "fit") fitViewport();
      if (zoomButton.dataset.zoomControl === "in") zoomAt(center, viewport.scale * 1.18);
      if (zoomButton.dataset.zoomControl === "out") zoomAt(center, viewport.scale / 1.18);
    }
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = getStagePoint(event.clientX, event.clientY);
    zoomAt(point, viewport.scale * Math.exp(-event.deltaY * 0.0014));
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-zoom-control]")) return;
    const point = getStagePoint(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    stageEl.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      panStart = {
        viewport,
        point,
        candidateNodeId: (target.closest("[data-node-id]") as HTMLElement | null)?.dataset.nodeId ?? null,
        moved: false,
      };
      pinchStart = null;
    } else if (pointers.size === 2) {
      beginPinch();
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const point = getStagePoint(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2 && pinchStart) {
      const active = Array.from(pointers.values());
      const currentMidpoint = midpoint(active[0], active[1]);
      const currentDistance = Math.max(distance(active[0], active[1]), 1);
      const targetScale = pinchStart.viewport.scale * (currentDistance / pinchStart.distance);
      const worldPoint = graphScreenToWorld(pinchStart.midpoint, pinchStart.viewport);
      const size = getStageSize();
      viewport = clampUpgradeGraphViewport(
        {
          scale: targetScale,
          panX: currentMidpoint.x - worldPoint.x * targetScale,
          panY: currentMidpoint.y - worldPoint.y * targetScale,
        },
        size.width,
        size.height,
        view.width,
        view.height,
      );
      applyViewport();
      return;
    }

    if (!panStart) return;
    const dx = point.x - panStart.point.x;
    const dy = point.y - panStart.point.y;
    if (!panStart.moved && Math.hypot(dx, dy) > TAP_SLOP) panStart.moved = true;
    if (!panStart.moved) return;
    const size = getStageSize();
    viewport = clampUpgradeGraphViewport(
      {
        scale: panStart.viewport.scale,
        panX: panStart.viewport.panX + dx,
        panY: panStart.viewport.panY + dy,
      },
      size.width,
      size.height,
      view.width,
      view.height,
    );
    applyViewport();
  };

  const handlePointerUp = (event: PointerEvent) => {
    const tapCandidate = pointers.size === 1 ? (panStart?.candidateNodeId ?? null) : null;
    const shouldSelect = !!tapCandidate && !!panStart && !panStart.moved;
    pointers.delete(event.pointerId);
    if (stageEl.hasPointerCapture(event.pointerId)) {
      stageEl.releasePointerCapture(event.pointerId);
    }
    if (shouldSelect) updateSelection(tapCandidate);
    panStart = null;
    pinchStart = null;
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  const handleResize = () => fitViewport();

  applyViewport();
  container.hidden = false;
  container.addEventListener("click", handleClick);
  stageEl.addEventListener("wheel", handleWheel, { passive: false });
  stageEl.addEventListener("pointerdown", handlePointerDown);
  stageEl.addEventListener("pointermove", handlePointerMove);
  stageEl.addEventListener("pointerup", handlePointerUp);
  stageEl.addEventListener("pointercancel", handlePointerUp);
  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", handleKeyDown);
  progressionCleanup = () => {
    container.removeEventListener("click", handleClick);
    stageEl.removeEventListener("wheel", handleWheel);
    stageEl.removeEventListener("pointerdown", handlePointerDown);
    stageEl.removeEventListener("pointermove", handlePointerMove);
    stageEl.removeEventListener("pointerup", handlePointerUp);
    stageEl.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("keydown", handleKeyDown);
    container.hidden = true;
    container.innerHTML = "";
  };
}

export function hideUpgradeProgression(): void {
  if (progressionCleanup) {
    progressionCleanup();
    progressionCleanup = null;
  }
}

export function renderUpgradeObjectiveChips(completedObjectiveIds: string[], allObjectiveIds: string[]): string {
  return allObjectiveIds
    .map((objectiveId) => {
      const active = completedObjectiveIds.includes(objectiveId);
      return `<button type="button" class="upgrade-graph-objective${active ? " upgrade-graph-objective--active" : ""}" data-objective-id="${objectiveId}">
        ${getUpgradeObjectiveLabel(objectiveId)}
      </button>`;
    })
    .join("");
}
