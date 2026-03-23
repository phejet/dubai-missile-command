import { COL } from "./game-logic.js";
import { UPGRADES } from "./game-sim.js";
import "./ShopUI.css";

function getEntries(shopData) {
  const allEntries = Object.entries(UPGRADES).filter(([, def]) => !def.disabled);
  return shopData.draftMode ? allEntries.filter(([key]) => shopData.draftOffers?.includes(key)) : allEntries;
}

function getButtonLabel({ maxed, isBurjRepair, burjFull, isDraft, draftPicked, canAfford, cost }) {
  if ((maxed && !isBurjRepair) || burjFull) return "\u2713 MAXED";
  if (isDraft) {
    if (draftPicked) return "\u2014";
    return isBurjRepair ? "HEAL - FREE" : "UPGRADE - FREE";
  }
  if (canAfford) return isBurjRepair ? `HEAL - $${cost}` : `UPGRADE - $${cost}`;
  return `$${cost} NEEDED`;
}

export default function ShopUI({ shopData, onBuyUpgrade, onClose, mode = "desktop" }) {
  const entries = getEntries(shopData);

  return (
    <div className={`shop-modal shop-modal--${mode}`} role="dialog" aria-modal="true">
      <div className="shop-modal__backdrop" />
      <div className="shop-modal__panel" data-shop-mode={mode}>
        <header className="shop-modal__header">
          <div>
            <div className="shop-modal__eyebrow">Defense Systems Market</div>
            <h2 className="shop-modal__title">Wave {shopData.wave} Complete</h2>
            <p className="shop-modal__subtitle">
              {shopData.draftMode
                ? "Pick one free upgrade and redeploy."
                : "Reinforce the skyline before the next strike."}
            </p>
          </div>
          <div className="shop-modal__budget">
            {shopData.draftMode ? (
              <>
                <span className="shop-modal__budget-label">Draft</span>
                <strong className="shop-modal__budget-value">{shopData.draftPicked ? "Selected" : "Choose 1"}</strong>
              </>
            ) : (
              <>
                <span className="shop-modal__budget-label">Budget</span>
                <strong className="shop-modal__budget-value">$ {shopData.score}</strong>
              </>
            )}
          </div>
        </header>

        <div className="shop-modal__scroll">
          <div className={`shop-grid shop-grid--${mode}`}>
            {entries.map(([key, def]) => {
              const level = shopData.upgrades[key];
              const maxed = level >= def.maxLevel;
              const isDraft = shopData.draftMode;
              const cost = maxed ? null : isDraft ? 0 : def.costs[level];
              const canAfford = cost !== null && (isDraft ? !shopData.draftPicked : shopData.score >= cost);
              const isBurjRepair = key === "burjRepair";
              const burjFull = isBurjRepair && shopData.burjHealth >= 5;
              if (isBurjRepair && maxed && burjFull) return null;

              const disabled = (maxed && !isBurjRepair) || burjFull || !canAfford;

              return (
                <article
                  key={key}
                  className={`shop-card ${disabled ? "shop-card--disabled" : ""}`}
                  style={{ "--shop-accent": def.color, "--shop-panel": COL.panelBg }}
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
                  </div>

                  <p className="shop-card__description">{def.desc}</p>

                  {!maxed && (
                    <div className="shop-card__statline">
                      <span className="shop-card__statline-label">Next</span>
                      <span>{def.statLines[level]}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`shop-card__button ${disabled ? "shop-card__button--disabled" : ""}`}
                    disabled={disabled}
                    onClick={() => onBuyUpgrade(key)}
                  >
                    {getButtonLabel({
                      maxed,
                      isBurjRepair,
                      burjFull,
                      isDraft,
                      draftPicked: shopData.draftPicked,
                      canAfford,
                      cost,
                    })}
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="shop-modal__footer">
          <button type="button" className="shop-modal__deploy" onClick={onClose}>
            Deploy Wave {shopData.wave + 1}
          </button>
        </footer>
      </div>
    </div>
  );
}
