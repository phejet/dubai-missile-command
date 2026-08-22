import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IOS_APP_FLAVORS, assertIosFlavorCaptureChannel, requireIosAppFlavor } from "./ios-flavors";

describe("iOS app flavors", () => {
  it("owns three distinct app identities", () => {
    expect(IOS_APP_FLAVORS).toEqual({
      dev: {
        appId: "com.phejet.dubaicmd.dev",
        appName: "DMC Dev",
        allowedCaptureChannels: ["off"],
      },
      staging: {
        appId: "com.phejet.dubaicmd.staging",
        appName: "DMC Staging",
        allowedCaptureChannels: ["staging"],
      },
      production: {
        appId: "com.phejet.dubaicmd",
        appName: "Dubai Missile Command",
        allowedCaptureChannels: ["off", "production"],
      },
    });
  });

  it("requires explicit flavor selection", () => {
    expect(requireIosAppFlavor(" dev ")).toBe("dev");
    expect(() => requireIosAppFlavor(undefined)).toThrow("DMC_APP_FLAVOR");
    expect(() => requireIosAppFlavor("prod")).toThrow("DMC_APP_FLAVOR");
  });

  it("rejects flavor and capture-channel mismatches", () => {
    expect(() => assertIosFlavorCaptureChannel("dev", "off")).not.toThrow();
    expect(() => assertIosFlavorCaptureChannel("staging", "staging")).not.toThrow();
    expect(() => assertIosFlavorCaptureChannel("production", "off")).not.toThrow();
    expect(() => assertIosFlavorCaptureChannel("production", "production")).not.toThrow();
    expect(() => assertIosFlavorCaptureChannel("dev", "staging")).toThrow("cannot use");
    expect(() => assertIosFlavorCaptureChannel("staging", "off")).toThrow("cannot use");
    expect(() => assertIosFlavorCaptureChannel("production", "staging")).toThrow("cannot use");
  });

  it("keeps Xcode schemes and package scripts pinned to the flavor contract", () => {
    const project = readFileSync(resolve("ios/App/App.xcodeproj/project.pbxproj"), "utf8");
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    for (const [flavor, identity] of Object.entries(IOS_APP_FLAVORS)) {
      expect(project).toContain(`DMC_APP_FLAVOR = ${flavor};`);
      expect(project).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${identity.appId};`);
      expect(packageJson.scripts[`build:ios:${flavor === "production" ? "production" : flavor}`]).toContain(
        `DMC_APP_FLAVOR=${flavor}`,
      );
    }

    const schemes = {
      dev: ["App-Dev.xcscheme", "Debug"],
      staging: ["App-Staging.xcscheme", "Staging"],
      production: ["App-Production.xcscheme", "Release"],
    } as const;
    for (const [fileName, configuration] of Object.values(schemes)) {
      const scheme = readFileSync(resolve("ios/App/App.xcodeproj/xcshareddata/xcschemes", fileName), "utf8");
      expect(scheme).toContain(`buildConfiguration = "${configuration}"`);
    }
  });
});
