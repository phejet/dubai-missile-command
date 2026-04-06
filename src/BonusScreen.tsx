import { useCallback, useEffect, useRef, useState } from "react";
import SFX from "./sound";

interface BonusScreenProps {
  wave: number;
  buildings: number;
  savedAmmo: number;
  missileKills: number;
  droneKills: number;
  onScoreAdd: (pts: number) => void;
  onComplete: () => void;
}

const BUILDING_PTS_EACH = 100;
const AMMO_PTS_EACH = 50;
const TICK_MS_BUILDING = 80;
const TICK_MS_AMMO = 55;

// Phases:
// 0 entering  1 header  2 kills  3 buildings-label  4 buildings-count
// 5 ammo-label  6 ammo-count  7 total  8 done
export default function BonusScreen({
  wave,
  buildings,
  savedAmmo,
  missileKills,
  droneKills,
  onScoreAdd,
  onComplete,
}: BonusScreenProps) {
  const [phase, setPhase] = useState(0);
  const onScoreAddRef = useRef(onScoreAdd);
  useEffect(() => {
    onScoreAddRef.current = onScoreAdd;
  });
  const [buildingCount, setBuildingCount] = useState(0);
  const [ammoCount, setAmmoCount] = useState(0);
  const [totalVisible, setTotalVisible] = useState(false);
  const [flashOn, setFlashOn] = useState(true);
  const doneRef = useRef(false);

  const buildingBonus = buildings * BUILDING_PTS_EACH * wave;
  const ammoBonus = savedAmmo * AMMO_PTS_EACH;
  const totalBonus = buildingBonus + ammoBonus;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  }, [onComplete]);

  // Skip remaining animation on tap — ignore taps until screen is actually visible
  const handleTap = useCallback(() => {
    if (phase < 2) return;
    if (phase < 7) {
      // Add remaining points instantly
      const remainingBuilding = (buildings - buildingCount) * BUILDING_PTS_EACH * wave;
      const remainingAmmo = (savedAmmo - ammoCount) * AMMO_PTS_EACH;
      if (remainingBuilding > 0) onScoreAddRef.current(remainingBuilding);
      if (remainingAmmo > 0) onScoreAddRef.current(remainingAmmo);
      setPhase(8);
      finish();
    } else if (phase >= 7) {
      finish();
    }
  }, [phase, buildings, buildingCount, savedAmmo, ammoCount, wave, finish]);

  useEffect(() => {
    if (phase === 0) {
      const t = setTimeout(() => setPhase(1), 50);
      return () => clearTimeout(t);
    }
    if (phase === 1) {
      const t = setTimeout(() => setPhase(2), 250);
      return () => clearTimeout(t);
    }
    if (phase === 2) {
      const t = setTimeout(() => setPhase(3), 150);
      return () => clearTimeout(t);
    }
    if (phase === 3) {
      const t = setTimeout(() => setPhase(4), 100);
      return () => clearTimeout(t);
    }
    if (phase === 4) {
      if (buildings === 0) {
        const t = setTimeout(() => setPhase(5), 300);
        return () => clearTimeout(t);
      }
      let count = 0;
      const iv = setInterval(() => {
        count++;
        setBuildingCount(count);
        SFX.bonusTick();
        onScoreAddRef.current(BUILDING_PTS_EACH * wave);
        if (count >= buildings) {
          clearInterval(iv);
          setTimeout(() => setPhase(5), 500);
        }
      }, TICK_MS_BUILDING);
      return () => clearInterval(iv);
    }
    if (phase === 5) {
      const t = setTimeout(() => setPhase(6), 150);
      return () => clearTimeout(t);
    }
    if (phase === 6) {
      if (savedAmmo === 0) {
        const t = setTimeout(() => setPhase(7), 300);
        return () => clearTimeout(t);
      }
      let count = 0;
      const iv = setInterval(() => {
        count++;
        setAmmoCount(count);
        SFX.bonusTick();
        onScoreAddRef.current(AMMO_PTS_EACH);
        if (count >= savedAmmo) {
          clearInterval(iv);
          setTimeout(() => setPhase(7), 500);
        }
      }, TICK_MS_AMMO);
      return () => clearInterval(iv);
    }
    if (phase === 7) {
      setTotalVisible(true);
      SFX.bonusTotal();
      let flashes = 0;
      const iv = setInterval(() => {
        flashes++;
        setFlashOn((v) => !v);
        if (flashes >= 8) {
          clearInterval(iv);
          setFlashOn(true);
        }
      }, 140);
      return () => clearInterval(iv);
    }
  }, [phase, buildings, savedAmmo, wave]);

  return (
    <div className={`bonus-screen ${phase >= 1 ? "bonus-screen--visible" : ""}`} onClick={handleTap} aria-live="polite">
      <div className="bonus-screen__scanlines" aria-hidden="true" />

      <div className="bonus-screen__panel">
        <div className="bonus-screen__header">
          {phase >= 1 && (
            <>
              <div className="bonus-screen__eyebrow">After Action Report</div>
              <h2 className="bonus-screen__title bonus-screen__flicker">Wave {wave} Complete</h2>
            </>
          )}
        </div>

        <div className="bonus-screen__body">
          {phase >= 2 && (
            <div className="bonus-screen__section bonus-screen__section--kills">
              <div className="bonus-screen__label">Destroyed this wave</div>
              <div className="bonus-screen__kills">
                <div className="bonus-screen__kill-row">
                  <span className="bonus-screen__kill-type">Missiles</span>
                  <span className="bonus-screen__kill-count">{missileKills}</span>
                </div>
                <div className="bonus-screen__kill-row">
                  <span className="bonus-screen__kill-type">Drones</span>
                  <span className="bonus-screen__kill-count">{droneKills}</span>
                </div>
              </div>
            </div>
          )}

          {phase >= 2 && <div className="bonus-screen__divider" />}

          {phase >= 3 && (
            <div className="bonus-screen__section">
              <div className="bonus-screen__label">Buildings survived</div>
              <div className="bonus-screen__row">
                <span className="bonus-screen__count">{phase >= 4 ? buildingCount : 0}</span>
                <span className="bonus-screen__pts">
                  {phase >= 4 && buildingCount > 0
                    ? `+ ${(buildingCount * BUILDING_PTS_EACH * wave).toLocaleString()}`
                    : ""}
                </span>
              </div>
            </div>
          )}

          {phase >= 5 && (
            <div className="bonus-screen__section">
              <div className="bonus-screen__label">Missiles saved</div>
              <div className="bonus-screen__row">
                <span className="bonus-screen__count">{phase >= 6 ? ammoCount : 0}</span>
                <span className="bonus-screen__pts">
                  {phase >= 6 && ammoCount > 0 ? `+ ${(ammoCount * AMMO_PTS_EACH).toLocaleString()}` : ""}
                </span>
              </div>
            </div>
          )}

          {phase >= 3 && <div className="bonus-screen__divider" />}

          <div
            className={`bonus-screen__total ${totalVisible ? (flashOn ? "bonus-screen__total--on" : "bonus-screen__total--off") : "bonus-screen__total--hidden"}`}
          >
            <span className="bonus-screen__total-label">Total bonus</span>
            <span className="bonus-screen__total-value">+ {totalBonus.toLocaleString()}</span>
          </div>
        </div>

        <div className="bonus-screen__footer">
          <div className="bonus-screen__hint">Tap to continue</div>
        </div>
      </div>
    </div>
  );
}
