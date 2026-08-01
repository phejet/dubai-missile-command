import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex, sha256HexFallback } from "./sha256";

describe("SHA-256 fallback", () => {
  it.each(["", "abc", "Dubai Missile Command 💥"])("matches Node for %j", (value) => {
    const bytes = new TextEncoder().encode(value);
    expect(sha256HexFallback(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("hashes multi-block capture-sized input without WebCrypto", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 17);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    vi.stubGlobal("crypto", undefined);
    await expect(sha256Hex(bytes)).resolves.toBe(createHash("sha256").update(bytes).digest("hex"));
    vi.unstubAllGlobals();
  });
});
