import { chromium } from "playwright";

const DEFAULT_URL = process.env.GAME_URL || "http://127.0.0.1:5173/dubai-missile-command/";
const DEFAULT_VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headless: true,
    screenshot: null,
  };

  for (const arg of argv) {
    if (arg === "--headful") {
      options.headless = false;
      continue;
    }
    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }
    if (arg.startsWith("--screenshot=")) {
      options.screenshot = arg.slice("--screenshot=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function startGameFromTitle(page) {
  const shell = page.locator('[data-ui-mode="phonePortrait"]');
  const box = await shell.boundingBox();
  if (!box) throw new Error("Could not find the phone shell to start the game");

  await shell.click({
    position: {
      x: Math.max(1, Math.min(box.width - 1, box.width * 0.5)),
      y: Math.max(1, Math.min(box.height - 1, box.height * 0.5)),
    },
  });

  await page.waitForFunction(() => {
    const shellEl = document.getElementById("game-shell");
    return shellEl?.dataset.screen === "playing" && window.__gameRef?.current !== null;
  });
}

async function openOptionsMenu(page) {
  const optionsButton = page.locator("#options-button");
  await optionsButton.click();
  await page.locator("#option-render").waitFor({ state: "visible" });
}

async function readMetaText(page) {
  const text = await page.locator("#option-render-meta").textContent();
  return text?.trim() ?? "";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: options.headless });

  try {
    const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
    await page.goto(options.url, { waitUntil: "domcontentloaded" });
    await page.locator("canvas").waitFor({ state: "visible" });

    await startGameFromTitle(page);
    await openOptionsMenu(page);

    const before = await readMetaText(page);
    if (before !== "Baked Sharp") {
      throw new Error(`Expected initial render mode to be "Baked Sharp", got "${before}"`);
    }

    await page.locator("#option-render").click();
    const after = await readMetaText(page);
    if (after !== "Live") {
      throw new Error(`Expected render mode after first toggle to be "Live", got "${after}"`);
    }

    await page.locator("#option-render").click();
    const restored = await readMetaText(page);
    if (restored !== "Baked Sharp") {
      throw new Error(`Expected render mode after second toggle to be "Baked Sharp", got "${restored}"`);
    }

    if (options.screenshot) {
      await page.screenshot({ path: options.screenshot, fullPage: false });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          url: options.url,
          before,
          after,
          restored,
          screenshot: options.screenshot,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
