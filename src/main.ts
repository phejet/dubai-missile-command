import "./index.css";
import "./App.css";
import "./ShopUI.css";
import "./UpgradeGraph.css";
import { Capacitor } from "@capacitor/core";
import { bootGame } from "./boot-game";

const runtime = bootGame();

async function registerNativeUrlHandler(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;

  const { App } = await import("@capacitor/app");
  await App.addListener("appUrlOpen", (event) => {
    if (!event?.url) return;
    void runtime.handleLaunchUrl(event.url);
  });

  const launch = await App.getLaunchUrl();
  if (launch?.url) {
    await runtime.handleLaunchUrl(launch.url);
  }
}

void registerNativeUrlHandler();
