const config = {
  appId: "com.phejet.dubaicmd",
  appName: "Dubai Missile Command",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  ios: {
    contentInset: "automatic",
    allowsLinkPreview: false,
    scrollEnabled: false,
    preferredContentMode: "mobile",
    webContentsDebuggingEnabled: true,
  },
};

export default config;
