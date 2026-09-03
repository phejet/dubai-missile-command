// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheHudElements, showRunRecap, type HudSnapshot, updateHud } from "./ui";
import { createEmptyGameStats } from "./game-logic";
import type { RunRecapData } from "./types";

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
    ammo: [0, 0],
    ammoMax: 0,
    launcherHP: [0, 0],
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

describe("run recap feedback", () => {
  it("renders only the reserved emoji choices and reports the saved selection accessibly", async () => {
    document.body.innerHTML = '<section id="run-recap-panel"></section>';
    const data: RunRecapData = {
      score: 1200,
      wave: 2,
      timePlayedMs: 30_000,
      hitRatio: 0.5,
      burjHealth: 0,
      outcome: "burj_destroyed",
      totalStats: createEmptyGameStats(),
      waves: [],
      waveCards: [],
      upgrades: [],
      hasReplay: true,
    };
    const onFeedback = vi.fn(async () => ({ ok: true, message: "Feedback saved" }));
    showRunRecap(data, {
      onClose: vi.fn(),
      onSaveReplay: vi.fn(),
      onWatchFullReplay: vi.fn(),
      onFeedback,
    });
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-run-recap-feedback]"));
    expect(buttons.map((button) => button.textContent)).toEqual(["🔥", "👍", "😕", "😤"]);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Intense",
      "Fun",
      "Confusing",
      "Frustrating",
    ]);
    buttons[0].click();
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledWith("🔥"));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-run-recap-feedback-status]")?.textContent).toBe("Feedback saved"),
    );
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  });
});
