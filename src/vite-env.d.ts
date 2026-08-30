/// <reference types="vite/client" />

// Injected by the define block in vite.config.ts (git sha + dirty hash).
declare const __DMC_BUILD_ID__: string;
declare const __DMC_APP_FLAVOR__: "web" | import("./ios-flavors").IosAppFlavor;
declare const __DMC_CAPTURE_CHANNEL__: import("./capture-policy").CaptureChannel;
declare const __DMC_CAPTURE_BASE_URL__: string;
declare const __DMC_SHARE_BASE_URLS__: Readonly<Record<"staging" | "production", string>>;

interface Window {
  __DMC_AUTOMATION__?: boolean;
}
