import "./index.css";
import "./App.css";
import "./ShopUI.css";
import "./UpgradeGraph.css";
import { Capacitor } from "@capacitor/core";
import { bootGame } from "./boot-game";
import { clientLog } from "./client-log";
import { initDiagnostics } from "./diagnostics-log";

initDiagnostics();

const runtime = bootGame();

async function registerNativeUrlHandler(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;

  const { App } = await import("@capacitor/app");
  await App.addListener("appStateChange", ({ isActive }) => {
    clientLog("app", "state-change", { isActive });
  });
  await App.addListener("pause", () => {
    clientLog("app", "pause");
  });
  await App.addListener("resume", () => {
    clientLog("app", "resume");
  });
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
