import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { COL } from "./game-logic";
import { UPGRADES } from "./game-sim";
import "./ShopUI.css";
import type { UpgradeKey, Upgrades } from "./types";

// UPGRADES entries may have optional `disabled` and `active` fields
type UpgradeDef = (typeof UPGRADES)[keyof typeof UPGRADES] & {
  disabled?: boolean;
  active?: boolean;
};

// CSS custom properties used by shop cards
interface ShopCardStyle extends CSSProperties {
  "--shop-accent": string;
  "--shop-panel": string;
}

export interface ShopData {
  draftMode?: boolean;
  draftOffers?: string[];
  upgrades: Upgrades;
  score: number;
  wave: number;
  burjHealth: number;
}

export interface ShopUIProps {
  shopData: ShopData;
  onBuyUpgrade: (key: UpgradeKey) => void;
  onClose: () => void;
  mode?: string;
}

function getEntries(shopData: ShopData): [string, UpgradeDef][] {
  const allEntries = (Object.entries(UPGRADES) as [string, UpgradeDef][]).filter(([, def]) => !def.disabled);
  return shopData.draftMode ? allEntries.filter(([key]) => shopData.draftOffers?.includes(key)) : allEntries;
}

export default function ShopUI({ shopData, onBuyUpgrade, onClose, mode = "phonePortrait" }: ShopUIProps) {
  const entries = getEntries(shopData);
  const isDraftMode = !!shopData.draftMode;
  const isPhonePortrait = mode === "phonePortrait";
  const [selected, setSelected] = useState<string[]>([]);

  const selectedCost = useMemo(() => {
    return selected.reduce((sum, key) => {
      const def = UPGRADES[key as UpgradeKey] as UpgradeDef | undefined;
      if (!def) return sum;
      const level = shopData.upgrades[key as UpgradeKey];
      return sum + (isDraftMode ? 0 : def.costs[level] || 0);
    }, 0);
  }, [selected, shopData, isDraftMode]);

  const remainingBudget = shopData.score - selectedCost;

  function toggleSelect(key: string) {
    if (isDraftMode) {
      setSelected((prev) => (prev.includes(key) ? [] : [key]));
    } else {
      setSelected((prev) => {
        if (prev.includes(key)) return prev.filter((k) => k !== key);
        return [...prev, key];
      });
    }
  }

  function handleConfirm() {
    for (const key of selected) {
      onBuyUpgrade(key as UpgradeKey);
    }
    onClose();
  }

  return (
    <div className={`shop-modal shop-modal--${mode}`} role="dialog" aria-modal="true">
      <div className="shop-modal__backdrop" />
      <div className={`shop-modal__panel ${isDraftMode ? "shop-modal__panel--draft" : ""}`} data-shop-mode={mode}>
        <header className="shop-modal__header">
          <div>
            <div className="shop-modal__eyebrow">Defense Systems Market</div>
            <h2 className="shop-modal__title">Wave {shopData.wave} Complete</h2>
            {!(isDraftMode && isPhonePortrait) && (
              <p className="shop-modal__subtitle">
                {isDraftMode ? "Pick one free upgrade and confirm." : "Select upgrades, then confirm to deploy."}
              </p>
            )}
          </div>
          <div className="shop-modal__budget">
            {isDraftMode ? (
              <strong className="shop-modal__budget-value">{selected.length > 0 ? "1 Selected" : "Choose 1"}</strong>
            ) : (
              <>
                <span className="shop-modal__budget-label">Budget</span>
                <strong className="shop-modal__budget-value">$ {remainingBudget}</strong>
              </>
            )}
          </div>
        </header>

        <div className="shop-modal__scroll">
          <div className={`shop-grid shop-grid--${mode}`}>
            {entries.map(([key, def]) => {
              const level = shopData.upgrades[key as UpgradeKey];
              const maxed = level >= def.maxLevel;
              const cost = maxed ? null : isDraftMode ? 0 : def.costs[level];
              const isBurjRepair = key === "burjRepair";
              const burjFull = isBurjRepair && shopData.burjHealth >= 5;
              if (isBurjRepair && maxed && burjFull) return null;

              const isSelected = selected.includes(key);
              const canAfford = cost !== null && (isDraftMode || remainingBudget >= cost || isSelected);
              const isMaxedOut = (maxed && !isBurjRepair) || burjFull;
              const disabled = isMaxedOut || (!canAfford && !isSelected);

              const cardStyle: ShopCardStyle = { "--shop-accent": def.color, "--shop-panel": COL.panelBg };

              return (
                <article
                  key={key}
                  className={`shop-card${disabled ? " shop-card--disabled" : ""}${isDraftMode ? " shop-card--draft" : ""}${isSelected ? " shop-card--selected" : ""}`}
                  style={cardStyle}
                  onClick={() => !disabled && toggleSelect(key)}
                  onKeyDown={(e) => {
                    if (!disabled && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggleSelect(key);
                    }
                  }}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  data-shop-card={key}
                  data-selected={isSelected || undefined}
                  data-disabled={disabled || undefined}
                >
                  <div className="shop-card__topline">
                    <span className="shop-card__icon" aria-hidden="true">
                      {def.icon}
                    </span>
                    <div className="shop-card__headline">
                      <div className="shop-card__name">
                        {def.name}
                        {def.active && <span className="shop-card__badge">Active</span>}
                      </div>
                      <div className="shop-card__levels" aria-label={`Level ${level} of ${def.maxLevel}`}>
                        {Array.from({ length: def.maxLevel }, (_, index) => (
                          <span
                            key={`${key}-level-${index}`}
                            className={`shop-card__level-dot ${index < level ? "shop-card__level-dot--filled" : ""}`}
                          />
                        ))}
                      </div>
                    </div>
                    {!isDraftMode && cost !== null && (
                      <span className="shop-card__cost">{isBurjRepair ? `HEAL $${cost}` : `$${cost}`}</span>
                    )}
                  </div>

                  <p className="shop-card__description">{def.desc}</p>

                  {!maxed && !isDraftMode && def.statLines[level] && (
                    <div className="shop-card__statline">
                      <span className="shop-card__statline-label">Next</span>
                      <span>{def.statLines[level]}</span>
                    </div>
                  )}

                  {isMaxedOut && <div className="shop-card__status">{"\u2713"} MAXED</div>}
                  {isSelected && <div className="shop-card__check">{"\u2713"}</div>}
                </article>
              );
            })}
          </div>
        </div>

        <footer className="shop-modal__footer">
          <button
            type="button"
            className={`shop-modal__deploy${selected.length === 0 ? " shop-modal__deploy--disabled" : ""}`}
            onClick={selected.length > 0 ? handleConfirm : undefined}
            disabled={selected.length === 0}
          >
            {isDraftMode
              ? `Confirm & Deploy Wave ${shopData.wave + 1}`
              : selected.length > 0
                ? `Confirm (${selected.length}) & Deploy Wave ${shopData.wave + 1}`
                : `Confirm & Deploy Wave ${shopData.wave + 1}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
