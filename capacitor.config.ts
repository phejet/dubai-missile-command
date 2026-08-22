import { IOS_APP_FLAVORS, requireIosAppFlavor } from "./src/ios-flavors";

const capDevServer = process.env.CAP_DEV_SERVER?.trim();
const appFlavor = requireIosAppFlavor(process.env.DMC_APP_FLAVOR);
const appIdentity = IOS_APP_FLAVORS[appFlavor];

function buildServerConfig() {
  if (!capDevServer) return undefined;

  let serverUrl: URL;
  try {
    serverUrl = new URL(capDevServer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CAP_DEV_SERVER must be a valid absolute URL: ${message}`);
  }

  return {
    allowNavigation: [serverUrl.hostname],
    cleartext: true,
    url: serverUrl.toString().replace(/\/$/, ""),
  };
}

const server = buildServerConfig();

const config = {
  appId: appIdentity.appId,
  appName: appIdentity.appName,
  webDir: "dist",
  ...(server ? { server } : {}),
  ios: {
    contentInset: "automatic",
    allowsLinkPreview: false,
    scrollEnabled: false,
    preferredContentMode: "mobile",
    webContentsDebuggingEnabled: true,
  },
};

export default config;
