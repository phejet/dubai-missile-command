import { COL } from "./game-logic.js";
import { UPGRADES, repairCost } from "./game-sim.js";

export default function ShopUI({ shopData, onBuyUpgrade, onRepairSite, onRepairLauncher, onClose }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: "rgba(8,14,30,0.97)",
          border: "1px solid rgba(0,255,200,0.3)",
          borderRadius: "8px",
          padding: "18px 22px",
          maxWidth: "860px",
          width: "96%",
          boxShadow: "0 0 60px rgba(0,100,200,0.2), inset 0 0 30px rgba(0,20,40,0.5)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "14px" }}>
          <div style={{ color: COL.hud, fontSize: "18px", fontWeight: "bold", letterSpacing: "3px" }}>
            ⬡ DEFENSE SYSTEMS MARKET ⬡
          </div>
          <div style={{ color: "#667788", fontSize: "11px", marginTop: "3px" }}>
            WAVE {shopData.wave} COMPLETE — UPGRADE YOUR DEFENSES
          </div>
          <div
            style={{
              color: COL.gold,
              fontSize: "16px",
              fontWeight: "bold",
              marginTop: "6px",
              textShadow: "0 0 10px rgba(255,215,0,0.5)",
            }}
          >
            BUDGET: $ {shopData.score}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "14px" }}>
          {(() => {
            const deadLaunchers = shopData.launcherHP ? shopData.launcherHP.filter((hp) => hp <= 0).length : 0;
            const launchersNeedRepair = deadLaunchers > 0;
            const rCost = repairCost(shopData.wave);
            const canAffordRepair = shopData.score >= rCost;

            return Object.entries(UPGRADES).map(([key, def]) => {
              const lvl = shopData.upgrades[key];
              const maxed = lvl >= def.maxLevel;
              const cost = maxed ? null : def.costs[lvl];
              const canAfford = cost !== null && shopData.score >= cost;
              const isBurjRepair = key === "burjRepair";
              const burjFull = isBurjRepair && shopData.burjHealth >= 5;
              // Hide burjRepair when maxed AND burj at full HP
              if (isBurjRepair && maxed && burjFull) return null;
              // Check if defense site is destroyed (needs repair first)
              const siteDestroyed =
                shopData.defenseSites && shopData.defenseSites.find((s) => s.key === key && !s.alive);
              // Launcher repair shows on launcherKit tile
              const isLauncherKit = key === "launcherKit";
              const showLauncherRepair = isLauncherKit && launchersNeedRepair;
              // Block all non-repair upgrades when launchers need repair
              const blockedByLauncherRepair = launchersNeedRepair && !isLauncherKit;

              return (
                <div
                  key={key}
                  style={{
                    background: COL.panelBg,
                    border: `1px solid ${maxed ? "rgba(0,255,200,0.3)" : canAfford ? def.color + "66" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: "6px",
                    padding: "11px",
                    opacity: maxed && !isBurjRepair ? 0.7 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                    <span style={{ fontSize: "20px" }}>{def.icon}</span>
                    <div>
                      <div
                        style={{
                          color: def.color,
                          fontSize: "11px",
                          fontWeight: "bold",
                          letterSpacing: "1px",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        {def.name.toUpperCase()}
                        {def.active && (
                          <span
                            style={{
                              fontSize: "7px",
                              padding: "1px 4px",
                              background: def.color + "33",
                              border: `1px solid ${def.color}`,
                              borderRadius: "3px",
                              letterSpacing: "0.5px",
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "3px", marginTop: "2px" }}>
                        {Array.from({ length: def.maxLevel }, (_, i) => (
                          <div
                            key={i}
                            style={{
                              width: "7px",
                              height: "7px",
                              borderRadius: "50%",
                              background: i < lvl ? def.color : "rgba(255,255,255,0.1)",
                              border: `1px solid ${i < lvl ? def.color : "rgba(255,255,255,0.15)"}`,
                              boxShadow: i < lvl ? `0 0 4px ${def.color}` : "none",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      color: "#778899",
                      fontSize: "9.5px",
                      lineHeight: "1.4",
                      marginBottom: "7px",
                      minHeight: "26px",
                    }}
                  >
                    {def.desc}
                  </div>
                  {!maxed && !siteDestroyed && (
                    <div
                      style={{
                        color: def.color,
                        fontSize: "9px",
                        opacity: 0.8,
                        marginBottom: "7px",
                        padding: "3px 5px",
                        background: "rgba(0,0,0,0.3)",
                        borderRadius: "3px",
                      }}
                    >
                      LVL {lvl + 1}: {def.statLines[lvl]}
                    </div>
                  )}
                  {showLauncherRepair ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {shopData.launcherHP.map((hp, i) => {
                        if (hp > 0) return null;
                        return (
                          <button
                            key={i}
                            onClick={() => onRepairLauncher(i)}
                            disabled={!canAffordRepair}
                            style={{
                              width: "100%",
                              padding: "5px 0",
                              background: canAffordRepair ? "rgba(255,100,0,0.15)" : "rgba(255,255,255,0.03)",
                              border: `1px solid ${canAffordRepair ? "#ff6600" : "rgba(255,255,255,0.1)"}`,
                              borderRadius: "4px",
                              color: canAffordRepair ? "#ff6600" : "#444",
                              fontSize: "10px",
                              fontWeight: "bold",
                              fontFamily: "'Courier New', monospace",
                              cursor: canAffordRepair ? "pointer" : "default",
                              letterSpacing: "1px",
                            }}
                            onMouseEnter={(e) => {
                              if (canAffordRepair) {
                                e.target.style.background = "rgba(255,100,0,0.3)";
                                e.target.style.boxShadow = "0 0 12px rgba(255,100,0,0.3)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = canAffordRepair
                                ? "rgba(255,100,0,0.15)"
                                : "rgba(255,255,255,0.03)";
                              e.target.style.boxShadow = "none";
                            }}
                          >
                            {canAffordRepair ? `REPAIR L${i + 1} — $${rCost}` : `L${i + 1} — $${rCost} NEEDED`}
                          </button>
                        );
                      })}
                    </div>
                  ) : siteDestroyed ? (
                    <button
                      onClick={() => onRepairSite(key)}
                      disabled={!canAffordRepair}
                      style={{
                        width: "100%",
                        padding: "5px 0",
                        background: canAffordRepair ? "rgba(255,100,0,0.15)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${canAffordRepair ? "#ff6600" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: "4px",
                        color: canAffordRepair ? "#ff6600" : "#444",
                        fontSize: "10px",
                        fontWeight: "bold",
                        fontFamily: "'Courier New', monospace",
                        cursor: canAffordRepair ? "pointer" : "default",
                        letterSpacing: "1px",
                      }}
                      onMouseEnter={(e) => {
                        if (canAffordRepair) {
                          e.target.style.background = "rgba(255,100,0,0.3)";
                          e.target.style.boxShadow = "0 0 12px rgba(255,100,0,0.3)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = canAffordRepair ? "rgba(255,100,0,0.15)" : "rgba(255,255,255,0.03)";
                        e.target.style.boxShadow = "none";
                      }}
                    >
                      {canAffordRepair ? `REPAIR — $${rCost}` : `$${rCost} NEEDED`}
                    </button>
                  ) : blockedByLauncherRepair ? (
                    <div
                      style={{
                        width: "100%",
                        padding: "5px 0",
                        textAlign: "center",
                        color: "#ff6600",
                        fontSize: "9px",
                        fontWeight: "bold",
                        fontFamily: "'Courier New', monospace",
                        letterSpacing: "1px",
                        opacity: 0.7,
                      }}
                    >
                      ⚠ REPAIR LAUNCHERS FIRST
                    </div>
                  ) : (
                    <button
                      onClick={() => onBuyUpgrade(key)}
                      disabled={(maxed && !isBurjRepair) || burjFull || !canAfford}
                      style={{
                        width: "100%",
                        padding: "5px 0",
                        background:
                          (maxed && !isBurjRepair) || burjFull
                            ? "rgba(0,255,200,0.1)"
                            : canAfford
                              ? `${def.color}22`
                              : "rgba(255,255,255,0.03)",
                        border: `1px solid ${(maxed && !isBurjRepair) || burjFull ? "rgba(0,255,200,0.3)" : canAfford ? def.color : "rgba(255,255,255,0.1)"}`,
                        borderRadius: "4px",
                        color: (maxed && !isBurjRepair) || burjFull ? COL.hud : canAfford ? def.color : "#444",
                        fontSize: "10px",
                        fontWeight: "bold",
                        fontFamily: "'Courier New', monospace",
                        cursor: (maxed && !isBurjRepair) || burjFull || !canAfford ? "default" : "pointer",
                        letterSpacing: "1px",
                      }}
                      onMouseEnter={(e) => {
                        if (!((maxed && !isBurjRepair) || burjFull) && canAfford) {
                          e.target.style.background = `${def.color}44`;
                          e.target.style.boxShadow = `0 0 12px ${def.color}33`;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background =
                          (maxed && !isBurjRepair) || burjFull
                            ? "rgba(0,255,200,0.1)"
                            : canAfford
                              ? `${def.color}22`
                              : "rgba(255,255,255,0.03)";
                        e.target.style.boxShadow = "none";
                      }}
                    >
                      {(maxed && !isBurjRepair) || burjFull
                        ? "\u2713 MAXED"
                        : canAfford
                          ? isBurjRepair
                            ? `HEAL — $${cost}`
                            : `UPGRADE — $${cost}`
                          : `$${cost} NEEDED`}
                    </button>
                  )}
                </div>
              );
            });
          })()}
        </div>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={onClose}
            style={{
              padding: "9px 36px",
              background: "rgba(0,255,200,0.12)",
              border: "1px solid rgba(0,255,200,0.5)",
              borderRadius: "4px",
              color: COL.hud,
              fontSize: "13px",
              fontWeight: "bold",
              fontFamily: "'Courier New', monospace",
              cursor: "pointer",
              letterSpacing: "3px",
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "rgba(0,255,200,0.25)";
              e.target.style.boxShadow = "0 0 20px rgba(0,255,200,0.2)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "rgba(0,255,200,0.12)";
              e.target.style.boxShadow = "none";
            }}
          >
            DEPLOY WAVE {shopData.wave + 1} →
          </button>
        </div>
      </div>
    </div>
  );
}
