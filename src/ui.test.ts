// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheHudElements, type HudSnapshot, updateHud } from "./ui";

function makeHud(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    score: 0,
    combo: 1,
    wave: 1,
    waveProgress: 0,
    burjHealth: 7,
    burjAlive: true,
    fps: 0,
    rafFps: 0,
    rafFrameMs: 0,
    ammo: [0, 0, 0],
    ammoMax: 0,
    launcherHP: [0, 0, 0],
    activeFamily: "emp",
    activeLabel: "EMP",
    activeReady: true,
    activePhase: "ready",
    ...overrides,
  };
}

describe("HUD active button", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = `
      <span id="hud-progress-fill"></span>
      <span id="hud-score"></span>
      <div id="hud-combo"><span id="hud-combo-value"></span><span id="hud-combo-status"></span></div>
      <button id="active-button"><span id="active-label"></span><span id="active-meta"></span></button>
      <span id="perf-raf"></span>
      <span id="perf-frame"></span>
      <span id="perf-hud-fps"></span>
    `;
    nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
    cacheHudElements();
    updateHud(makeHud({ activeFamily: null, activeReady: false, activePhase: "spent" }));
  });

  afterEach(() => {
    nowSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("marks a ready active upgrade as clickable", () => {
    updateHud(makeHud());

    const button = document.getElementById("active-button") as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.dataset).toMatchObject({ family: "emp", phase: "ready" });
    expect(button.className).toContain("battlefield-active--ready");
    expect(document.getElementById("active-meta")?.textContent).toBe("READY");
  });

  it("shows the active phase while the ability is in use", () => {
    updateHud(makeHud({ activeReady: false, activePhase: "active" }));

    const button = document.getElementById("active-button") as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.dataset.phase).toBe("active");
    expect(button.className).toContain("battlefield-active--active");
    expect(document.getElementById("active-meta")?.textContent).toBe("ACTIVE");
  });

  it("plays a completion phase after active use, then hides the spent button", () => {
    updateHud(makeHud({ activeReady: false, activePhase: "active" }));

    nowSpy.mockReturnValue(1200);
    updateHud(makeHud({ activeReady: false, activePhase: "spent" }));

    const button = document.getElementById("active-button") as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.dataset.phase).toBe("complete");
    expect(button.className).toContain("battlefield-active--complete");
    expect(document.getElementById("active-meta")?.textContent).toBe("COMPLETE");

    nowSpy.mockReturnValue(2300);
    updateHud(makeHud({ activeReady: false, activePhase: "spent" }));

    expect(button.hidden).toBe(true);
    expect(button.dataset.phase).toBe("spent");
    expect(document.getElementById("active-meta")?.textContent).toBe("USED");
  });
});
