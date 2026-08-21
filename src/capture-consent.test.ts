import { describe, expect, it } from "vitest";
import { getRemoteCaptureConsent, isRemoteCaptureChannel, setRemoteCaptureConsent } from "./capture-consent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("remote capture consent", () => {
  it("is scoped to an explicit remote channel and persists grant or denial", () => {
    const storage = memoryStorage();
    expect(getRemoteCaptureConsent("staging", storage)).toBe("unknown");
    setRemoteCaptureConsent("staging", "granted", storage);
    expect(getRemoteCaptureConsent("staging", storage)).toBe("granted");
    expect(getRemoteCaptureConsent("production", storage)).toBe("unknown");
    setRemoteCaptureConsent("staging", "denied", storage);
    expect(getRemoteCaptureConsent("staging", storage)).toBe("denied");
  });

  it("keeps off and local builds unknown regardless of stored values", () => {
    const storage = memoryStorage();
    storage.setItem("dmc.capture.remote-consent.v1.local", "granted");
    expect(getRemoteCaptureConsent("off", storage)).toBe("unknown");
    expect(getRemoteCaptureConsent("local", storage)).toBe("unknown");
    expect(isRemoteCaptureChannel("local")).toBe(false);
    expect(isRemoteCaptureChannel("staging")).toBe(true);
  });

  it("fails closed when storage cannot be read", () => {
    expect(
      getRemoteCaptureConsent("staging", {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      }),
    ).toBe("unknown");
  });
});
