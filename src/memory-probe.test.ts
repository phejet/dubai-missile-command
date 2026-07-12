import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sampleMock = vi.fn<() => Promise<Record<string, number>>>();
let nativePlatform = true;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform },
  registerPlugin: () => ({ sample: sampleMock }),
}));

async function importFresh() {
  vi.resetModules();
  return import("./memory-probe");
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("memory probe", () => {
  beforeEach(() => {
    nativePlatform = true;
    sampleMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null before the first native response, then the cached sample with age", async () => {
    const probe = await importFresh();
    sampleMock.mockResolvedValue({
      appAvailableBytes: 100 * 1048576,
      appFootprintBytes: 50 * 1048576,
      hostFreeBytes: 1000 * 1048576,
      hostInactiveBytes: 500 * 1048576,
      hostCompressedBytes: 200 * 1048576,
    });

    expect(probe.getMemorySample()).toBeNull();
    await flushMicrotasks();

    vi.advanceTimersByTime(1500);
    const sample = probe.getMemorySample();
    expect(sample).toEqual({
      appAvailMB: 100,
      appFootprintMB: 50,
      hostFreeMB: 1000,
      hostInactiveMB: 500,
      hostCompressedMB: 200,
      ageMs: 1500,
    });
  });

  it("maps missing native fields to null", async () => {
    const probe = await importFresh();
    sampleMock.mockResolvedValue({ appAvailableBytes: 10 * 1048576 });

    probe.refreshMemorySample();
    await flushMicrotasks();

    expect(probe.getMemorySample()).toMatchObject({
      appAvailMB: 10,
      appFootprintMB: null,
      hostFreeMB: null,
      hostInactiveMB: null,
      hostCompressedMB: null,
    });
  });

  it("never calls the bridge on web", async () => {
    nativePlatform = false;
    const probe = await importFresh();

    probe.startMemorySampling();
    expect(probe.getMemorySample()).toBeNull();
    vi.advanceTimersByTime(10000);

    expect(sampleMock).not.toHaveBeenCalled();
  });

  it("stops asking after a bridge failure (e.g. plugin missing in an old native build)", async () => {
    const probe = await importFresh();
    sampleMock.mockRejectedValue(new Error("not implemented"));

    probe.refreshMemorySample();
    await flushMicrotasks();
    probe.refreshMemorySample();
    await flushMicrotasks();

    expect(sampleMock).toHaveBeenCalledTimes(1);
    expect(probe.getMemorySample()).toBeNull();
  });

  it("samples on an interval once started, and stops cleanly", async () => {
    const probe = await importFresh();
    sampleMock.mockResolvedValue({ appAvailableBytes: 1048576 });

    probe.startMemorySampling();
    await flushMicrotasks();
    expect(sampleMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sampleMock).toHaveBeenCalledTimes(3);

    probe.stopMemorySampling();
    await vi.advanceTimersByTimeAsync(10000);
    expect(sampleMock).toHaveBeenCalledTimes(3);
  });
});
