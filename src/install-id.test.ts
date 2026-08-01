import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInstallId, isEphemeralInstallId, resetInstallIdCache } from "./install-id";

const STORAGE_KEY = "dmc.install.id.v1";
const VALID = /^[a-z0-9-]{8,64}$/;

function fakeStorage(storage: Map<string, string>, overrides: Partial<Storage> = {}) {
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    ...overrides,
  };
}

describe("install id", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    resetInstallIdCache();
    vi.stubGlobal("localStorage", fakeStorage(storage));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetInstallIdCache();
  });

  it("mints, persists, and returns the same id on later calls", () => {
    const first = getInstallId();
    expect(first).toMatch(VALID);
    expect(storage.get(STORAGE_KEY)).toBe(first);
    expect(getInstallId()).toBe(first);
  });

  it("survives a reload by reading the stored value", () => {
    const first = getInstallId();
    resetInstallIdCache();
    expect(getInstallId()).toBe(first);
  });

  it("mints a different id once storage is cleared", () => {
    const first = getInstallId();
    storage.clear();
    resetInstallIdCache();
    expect(getInstallId()).not.toBe(first);
  });

  it("mints a path-safe id without a secure context", () => {
    vi.stubGlobal("crypto", {});
    const id = getInstallId();
    expect(id).toMatch(VALID);
    expect(isEphemeralInstallId(id)).toBe(false);
    expect(storage.get(STORAGE_KEY)).toBe(id);
  });

  it("mints distinct ids across installs on the fallback path", () => {
    vi.stubGlobal("crypto", {});
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      storage.clear();
      resetInstallIdCache();
      ids.add(getInstallId());
    }
    expect(ids.size).toBe(200);
  });

  describe("when the value cannot be trusted", () => {
    it.each([
      ["a traversal attempt", "../../etc/passwd"],
      ["a slash", "abc/def/ghi"],
      ["too short", "abc"],
      ["too long", "a".repeat(65)],
      ["uppercase", "ABCDEFGH"],
      ["empty", ""],
    ])("replaces %s with a fresh id", (_label, poisoned) => {
      storage.set(STORAGE_KEY, poisoned);
      const id = getInstallId();
      expect(id).toMatch(VALID);
      expect(id).not.toBe(poisoned);
      expect(storage.get(STORAGE_KEY)).toBe(id);
    });
  });

  describe("when storage is unusable", () => {
    it("marks the id ephemeral when writes throw", () => {
      vi.stubGlobal(
        "localStorage",
        fakeStorage(storage, {
          setItem: () => {
            throw new Error("QuotaExceededError");
          },
        }),
      );
      const id = getInstallId();
      expect(isEphemeralInstallId(id)).toBe(true);
      expect(id).toMatch(VALID);
    });

    it("marks the id ephemeral when a write silently does not stick", () => {
      vi.stubGlobal("localStorage", fakeStorage(storage, { setItem: () => {} }));
      expect(isEphemeralInstallId(getInstallId())).toBe(true);
    });

    it("marks the id ephemeral when there is no localStorage at all", () => {
      vi.stubGlobal("localStorage", undefined);
      expect(isEphemeralInstallId(getInstallId())).toBe(true);
    });

    it("stays stable within a boot even though it cannot persist", () => {
      vi.stubGlobal("localStorage", undefined);
      expect(getInstallId()).toBe(getInstallId());
    });

    it("does not throw when reads throw", () => {
      vi.stubGlobal(
        "localStorage",
        fakeStorage(storage, {
          getItem: () => {
            throw new Error("SecurityError");
          },
        }),
      );
      expect(() => getInstallId()).not.toThrow();
    });
  });

  it("recognizes a persisted id as non-ephemeral", () => {
    expect(isEphemeralInstallId(getInstallId())).toBe(false);
  });
});
