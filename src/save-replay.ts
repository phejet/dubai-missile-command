import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { ReplayData } from "./types";

export type SaveReplayResult = { ok: true } | { ok: false; error: unknown };

function buildReplayFilename(replay: ReplayData): string {
  const wave = replay.wave ?? "?";
  const score = replay.score ?? 0;
  return `dmc-w${wave}-s${score}-${Date.now()}.json`;
}

export function triggerWebDownload(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function saveReplayToFile(replay: ReplayData): Promise<SaveReplayResult> {
  try {
    const json = JSON.stringify(replay);
    const filename = buildReplayFilename(replay);
    if (Capacitor.isNativePlatform()) {
      const written = await Filesystem.writeFile({
        path: filename,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: "Dubai Missile Command replay",
        text: `Wave ${replay.wave ?? "?"} - Score ${replay.score?.toLocaleString() ?? "?"}`,
        url: written.uri,
        dialogTitle: "Share replay",
      });
      return { ok: true };
    }
    triggerWebDownload(json, filename);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
