/** Shared terminal-body accounting for missiles, drones and bombs. */
export type PressureCategory = "tower" | "building" | "infrastructure";
export const TARGET_PRESSURE = {
  sequence: [
    "building",
    "tower",
    "infrastructure",
    "building",
    "building",
    "tower",
    "building",
    "infrastructure",
    "tower",
    "building",
  ] as readonly PressureCategory[],
  warningTicks: 60,
  retryTicks: 30,
  sideY: [20, 722] as const,
  entrySamples: 9,
  horizonTicks: 1200,
  geometryEpsilon: 1e-7,
  /**
   * Entry legibility. A route that is on screen is not the same as a route the player
   * can read: a near-vertical drop beside the bezel scores the most visible ticks of
   * any candidate and reads as nothing. Routes are ranked by these instead.
   *
   * `readableSlope` is horizontal travel per unit of vertical travel that counts as
   * fully readable (0.42 was the pre-RM-10 floor). It is a preference, not a floor —
   * a dense skyline genuinely forces steep approaches onto some targets, and demanding
   * 0.42 everywhere would make roughly 40% of targets unreachable.
   * `edgeBandFrac` is the outer fraction of screen width, per side, that reads poorly.
   */
  readableSlope: 0.42,
  edgeBandFrac: 0.12,
  /** How much legibility to trade for entry variety, so repeats do not fly one identical line. */
  legibilitySlack: 0.35,
  drone: {
    tellTicks: 52,
    tellInset: 40,
    cruiseClearance: 40,
    diveOffsets: [120, 60, 0, -60] as readonly number[],
    turnHandle: 60,
    terminalHandle: 100,
    propCruiseSpeed: 1.08,
    propDiveSpeed: 1.34,
    jetDiveSpeed: 1.2,
    propRamp: 1.06,
    propMaxRamp: 4,
    bombVy: [2.4, 4] as const,
    propBombCruiseFraction: 0.5,
    jetFirstBombFraction: 0.35,
    jetBombSeparationFraction: 0.3,
    jetBombSeparationTicks: 90,
  },
};

export interface PressureUnit {
  id: number;
  requested: PressureCategory;
  category: PressureCategory;
  destination: string;
  family: string;
  reservedTick: number;
  committedTick?: number;
  warningTicks?: number;
  warningShortfall?: number;
  state: "reserved" | "committed" | "cancelled" | "ended";
  exception?: "non-tower-redistribution" | "tower-unavailable" | "tower-only" | "empty-flank-tower";
  outcome?: "intercepted" | "removed" | "carrier-lost" | "no-route" | "target-lost";
}
export interface PressureLedger {
  wave: number;
  units: PressureUnit[];
  deferredAttempts: number;
  lastConflict?: string;
  invariantFailures?: number;
  lastInvariantFailure?: string;
}
export function createPressureLedger(wave: number): PressureLedger {
  return { wave, units: [], deferredAttempts: 0 };
}

/** Pure choice; a failed route transaction spends no unit and accrues no debt. */
export function choosePressureCategory(
  index: number,
  available: readonly PressureCategory[],
  livingNonTower: boolean,
  emptyFlankFallback = false,
): Pick<PressureUnit, "requested" | "category" | "exception"> | null {
  const requested = TARGET_PRESSURE.sequence[index % TARGET_PRESSURE.sequence.length];
  if (!livingNonTower && available.includes("tower")) return { requested, category: "tower", exception: "tower-only" };
  if (emptyFlankFallback && available.includes("tower") && !available.some((c) => c !== "tower")) {
    return { requested, category: "tower", exception: "empty-flank-tower" };
  }
  if (available.includes(requested)) return { requested, category: requested };
  const alternative = (["building", "infrastructure"] as const).find((c) => available.includes(c));
  if (alternative)
    return {
      requested,
      category: alternative,
      exception: requested === "tower" ? "tower-unavailable" : "non-tower-redistribution",
    };
  return null;
}

export function reservePressure(
  ledger: PressureLedger,
  choice: Pick<PressureUnit, "requested" | "category" | "exception">,
  destination: string,
  family: string,
  tick: number,
): number {
  const id = ledger.units.length;
  ledger.units.push({ id, ...choice, destination, family, reservedTick: tick, state: "reserved" });
  return id;
}
export function recordPressureInvariantFailure(ledger: PressureLedger, reason: string): void {
  ledger.invariantFailures = (ledger.invariantFailures ?? 0) + 1;
  ledger.lastInvariantFailure = reason;
}

/** Refuse corrupt ownership without terminating the live simulation loop. */
export function commitPressure(ledger: PressureLedger, id: number, tick: number, warningTicks: number): boolean {
  const unit = ledger.units[id];
  if (!unit || unit.state !== "reserved") {
    recordPressureInvariantFailure(ledger, `Pressure unit ${id} is not reserved`);
    return false;
  }
  unit.state = "committed";
  unit.committedTick = tick;
  unit.warningTicks = warningTicks;
  unit.warningShortfall = Math.max(0, TARGET_PRESSURE.warningTicks - warningTicks);
  return true;
}
export function finishPressure(ledger: PressureLedger, ids: readonly number[], intercepted: boolean): void {
  for (const id of ids) {
    const unit = ledger.units[id];
    if (unit?.state === "reserved") {
      unit.state = "cancelled";
      unit.outcome = "carrier-lost";
    } else if (unit?.state === "committed") {
      unit.state = "ended";
      unit.outcome = intercepted ? "intercepted" : "removed";
    }
  }
}
