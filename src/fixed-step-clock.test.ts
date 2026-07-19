import { describe, expect, it } from "vitest";
import { accumulateFixedTicks } from "./fixed-step-clock";

function simulateOneSecond(refreshRate: number): { remainder: number; steps: number } {
  let accumulator = 0;
  let steps = 0;
  for (let frame = 0; frame < refreshRate; frame++) {
    accumulator = accumulateFixedTicks(accumulator, 1000 / refreshRate);
    while (accumulator >= 1) {
      accumulator -= 1;
      steps++;
    }
  }
  return { remainder: accumulator, steps };
}

describe("fixed step clock", () => {
  it.each([30, 60, 120])("produces 60 simulation ticks at %i Hz", (refreshRate) => {
    const result = simulateOneSecond(refreshRate);

    expect(result.steps).toBe(60);
    expect(result.remainder).toBeCloseTo(0, 8);
  });

  it("caps a single stalled frame instead of replaying an unbounded backlog", () => {
    expect(accumulateFixedTicks(0, 1000)).toBe(3);
  });
});
