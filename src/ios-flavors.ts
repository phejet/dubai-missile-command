export const IOS_APP_FLAVORS = {
  dev: {
    appId: "com.phejet.dubaicmd.dev",
    appIcon: "AppIconDev",
    appName: "DMC Dev",
    allowedCaptureChannels: ["off", "staging"],
  },
  staging: {
    appId: "com.phejet.dubaicmd.staging",
    appIcon: "AppIconStaging",
    appName: "Dubai Missile Command Staging",
    allowedCaptureChannels: ["staging"],
  },
  production: {
    appId: "com.phejet.dubaicmd",
    appIcon: "AppIcon",
    appName: "Dubai Missile Command",
    allowedCaptureChannels: ["off", "production"],
  },
} as const;

export type IosAppFlavor = keyof typeof IOS_APP_FLAVORS;
export type NativeCaptureChannel = "off" | "staging" | "production";

export function requireIosAppFlavor(value: string | undefined): IosAppFlavor {
  const normalized = value?.trim();
  if (normalized === "dev" || normalized === "staging" || normalized === "production") return normalized;
  throw new Error("DMC_APP_FLAVOR must be explicitly set to dev, staging, or production");
}

export function assertIosFlavorCaptureChannel(flavor: IosAppFlavor, channel: NativeCaptureChannel): void {
  const allowed = IOS_APP_FLAVORS[flavor].allowedCaptureChannels as readonly NativeCaptureChannel[];
  if (!allowed.includes(channel)) {
    throw new Error(`DMC_APP_FLAVOR=${flavor} cannot use DMC_CAPTURE_CHANNEL=${channel}`);
  }
}
