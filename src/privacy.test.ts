import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("app-owned privacy declaration", () => {
  it("declares the collected playtest data, no tracking, and the file-metadata reason", () => {
    const manifest = readFileSync(new URL("ios/App/App/PrivacyInfo.xcprivacy", root), "utf8");
    expect(manifest).toContain("<key>NSPrivacyTracking</key>\n\t<false/>");
    for (const type of [
      "NSPrivacyCollectedDataTypeDeviceID",
      "NSPrivacyCollectedDataTypeGameplayContent",
      "NSPrivacyCollectedDataTypeProductInteraction",
      "NSPrivacyCollectedDataTypeOtherDiagnosticData",
      "NSPrivacyCollectedDataTypeOtherUserContent",
    ]) {
      expect(manifest).toContain(`<string>${type}</string>`);
    }
    expect(manifest).toContain("<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>");
    expect(manifest).toContain("<string>C617.1</string>");
  });

  it("bundles the manifest for every Xcode configuration and publishes the policy in every app build", () => {
    const project = readFileSync(new URL("ios/App/App.xcodeproj/project.pbxproj", root), "utf8");
    expect(project.match(/PrivacyInfo\.xcprivacy in Resources/g)).toHaveLength(2);
    const vite = readFileSync(new URL("vite.config.ts", root), "utf8");
    expect(vite.match(/privacy: resolve\(__dirname, "privacy\.html"\)/g)).toHaveLength(2);
    const policy = readFileSync(new URL("privacy.html", root), "utf8");
    for (const days of ["365 days", "270 days", "90 days"]) expect(policy).toContain(days);
    expect(policy).toContain("revoked key");
    expect(policy).toContain("life of the capture service");
    expect(policy).toContain("mailto:phejet@gmail.com");
  });
});
