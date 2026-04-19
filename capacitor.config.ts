const capDevServer = process.env.CAP_DEV_SERVER?.trim();

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
  appId: "com.phejet.dubaicmd",
  appName: "Dubai Missile Command",
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
