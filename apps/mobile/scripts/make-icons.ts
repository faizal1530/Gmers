// Membuat assets/icon-only.png, icon-foreground.png, icon-background.png, splash.png dari icon.svg lewat Chromium (Playwright).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
async function shot(html: string, name: string, size = 1024, transparent = false): Promise<void> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${html}</body>`);
  writeFileSync(join(dir, name), await page.screenshot({ type: "png", omitBackground: transparent }));
}
await shot(svg, "icon-only.png");
await shot(svg.replace(/<rect width="1024"[^>]*\/>/, ""), "icon-foreground.png", 1024, true);
await shot('<div style="width:1024px;height:1024px;background:#0f6b63"></div>', "icon-background.png");
await shot(`<div style="width:2732px;height:2732px;background:#f7f2ea;display:grid;place-items:center"><div style="width:900px">${svg}</div></div>`, "splash.png", 2732);
await browser.close();
