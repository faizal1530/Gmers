/* E2E dengan Chromium sungguhan: server nyata + klien hasil build. Jalankan: pnpm e2e
 * Bila browser tidak tersedia, skrip menyatakan SKIP dan keluar dengan kode 0 (pasang dengan `pnpm exec playwright install chromium`). */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { startServer, defaultServerConfig } from "@gmers/server";
import { id } from "../src/i18n/id";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");
const outDir = process.env.E2E_OUT ?? join(here, "out");

function log(msg: string): void {
  process.stdout.write(`[e2e] ${msg}\n`);
}

async function launch(): Promise<Browser | null> {
  const attempts: (() => Promise<Browser>)[] = [
    () => chromium.launch({ args: ["--no-sandbox"] }),
    () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }),
  ];
  for (const a of attempts) {
    try {
      return await a();
    } catch {
      // coba berikutnya
    }
  }
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`GAGAL: ${msg}`);
  log(`ok: ${msg}`);
}

async function noHorizontalOverflow(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(r.sw <= r.cw, `tanpa overflow horizontal di 360 px (${label}: scrollWidth ${r.sw} <= ${r.cw})`);
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
}

interface Snap {
  mine: boolean;
  okCards: number;
  passEnabled: boolean;
  ranking: boolean;
  table: boolean;
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate((yourTurn) => {
    const turn = document.querySelector('[data-testid="turn-text"]')?.textContent ?? "";
    const pass = document.querySelector<HTMLButtonElement>('[data-testid="pass"]');
    return {
      mine: turn === yourTurn,
      okCards: document.querySelectorAll(".card-btn.ok:not(:disabled)").length,
      passEnabled: !!pass && !pass.disabled,
      ranking: !!document.querySelector('[data-testid="ranking"]'),
      table: !!document.querySelector('[data-testid="hand"]'),
    };
  }, id.table.yourTurn);

async function handKeys(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="hand"] [data-card]', (els) => els.map((e) => e.getAttribute("data-card") ?? ""));
}

/** Mainkan langkah pertama yang sah di setiap halaman yang sedang gilirannya, sampai muncul peringkat. */
async function playUntilDone(pages: Page[], onProgress?: (moves: number) => Promise<void>): Promise<number> {
  let moves = 0;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("GAGAL: game tidak selesai dalam 90 detik");
    const snaps = await Promise.all(pages.map(snap));
    if (snaps.every((s) => s.ranking)) return moves;
    let acted = false;
    for (let i = 0; i < pages.length; i++) {
      const s = snaps[i] as Snap;
      const page = pages[i] as Page;
      if (!s.table || !s.mine) continue;
      if (s.okCards > 0) {
        await page.locator(".card-btn.ok:not(:disabled)").first().click();
        const picker = page.locator('[data-testid="end-picker"] [data-end="left"]');
        if (await picker.isVisible()) await picker.click();
        acted = true;
        moves++;
      } else if (s.passEnabled) {
        await page.locator('[data-testid="pass"]').click();
        acted = true;
        moves++;
      }
      if (acted) break;
    }
    if (acted && onProgress) await onProgress(moves);
    await sleep(acted ? 40 : 80);
  }
}

async function main(): Promise<void> {
  const browser = await launch();
  if (!browser) {
    log("SKIP: Chromium tidak bisa dijalankan di lingkungan ini. Pasang dengan `pnpm exec playwright-core install chromium` atau set CHROMIUM_PATH, lalu jalankan `pnpm e2e` lagi.");
    return;
  }
  log("membangun klien web");
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], { cwd: webDir, stdio: "inherit" });
  const dist = join(webDir, "dist");
  check(existsSync(join(dist, "index.html")), "hasil build ada");

  const dataDir = mkdtempSync(join(tmpdir(), "gmers-e2e-"));
  const server = await startServer({ ...defaultServerConfig, port: 0, host: "127.0.0.1", dataDir, staticDir: dist, eventsCsvFile: "events.csv", adminToken: null });
  const base = `http://127.0.0.1:${server.port}`;
  log(`server di ${base}`);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const problems: string[] = [];
  const external: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, colorScheme: i === 3 ? "dark" : "light", locale: "id-ID" });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`pageerror[${i}]: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console.error[${i}]: ${m.text()}`);
      });
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
      });
      contexts.push(ctx);
      pages.push(page);
    }
    const [A, B, C, D] = pages as [Page, Page, Page, Page];
    const names = ["Andi", "Budi", "Citra", "Dewi"];

    // 1. Beranda dan buat room
    await A.goto(base);
    await noHorizontalOverflow(A, "beranda");
    await shot(A, "01-beranda");
    await A.fill("#nama", "A");
    await A.click("button[type=submit]");
    check(await A.locator("#nama-bantuan.bad").isVisible(), "nama 1 karakter ditolak dengan pesan");
    await A.fill("#nama", names[0] as string);
    await A.click("button[type=submit]");
    await A.waitForSelector('[data-testid="share-url"]');
    const code = (await A.textContent('[data-testid="group-code"]'))?.trim() ?? "";
    check(/^[A-Z0-9]{6}$/.test(code), `kode kelompok dibuat (${code})`);
    check(A.url().endsWith(`/g/${code}`), "URL berubah ke tautan kelompok");
    await noHorizontalOverflow(A, "ruang tunggu");
    const waHref = await A.getAttribute("a.wa", "href");
    check(waHref?.startsWith("https://wa.me/?text=") && decodeURIComponent(waHref).includes(`/g/${code}`), "tombol WhatsApp memuat tautan");

    // 2. Tiga teman masuk lewat tautan
    for (let i = 1; i < 4; i++) {
      const p = pages[i] as Page;
      await p.goto(`${base}/g/${code}`);
      await p.waitForSelector("#nama");
      if (i === 1) {
        await noHorizontalOverflow(p, "formulir masuk");
        await shot(p, "02-masuk");
      }
      await p.fill("#nama", names[i] as string);
      await p.click("button[type=submit]");
      await p.waitForSelector('[data-testid="share-url"]');
    }
    await A.waitForFunction(() => document.querySelectorAll("li.seat:not(.empty)").length === 4);
    check(true, "4 pemain duduk");
    await shot(A, "03-ruang-tunggu");
    const dewiOnA = await A.locator("li.seat").nth(3).textContent();
    check(dewiOnA?.includes("Dewi") && dewiOnA.includes(id.lobby.ready), "kursi 4 menampilkan Dewi dan status Siap");

    // 3. Mulai
    check(await B.locator("button.primary.big").count() === 0, "bukan pemilik tidak melihat tombol Mulai");
    await A.click("button.primary.big");
    for (const p of pages) await p.waitForSelector('[data-testid="hand"] [data-card]');
    check((await Promise.all(pages.map(handKeys))).every((h) => h.length === 7), "tiap pemain menerima 7 kartu");
    await noHorizontalOverflow(A, "meja");
    await shot(A, "04-meja");
    await shot(D, "04-meja-gelap");

    // 4. Chat
    await B.click('[data-testid="chat-toggle"]');
    await B.fill('[data-testid="chat-input"]', "halo <b>semua</b>");
    await B.click('[data-testid="chat-send"]');
    await A.waitForSelector(".badge:not([hidden])");
    check((await A.textContent(".badge"))?.trim() === "1", "penanda pesan belum dibaca muncul");
    await A.click('[data-testid="chat-toggle"]');
    const logText = (await A.textContent('[data-testid="chat-log"]')) ?? "";
    check(logText.includes("Budi: halo <b>semua</b>"), "isi chat tampil sebagai teks");
    check((await A.locator('[data-testid="chat-log"] b').count()) === 0, "tidak ada elemen HTML dari chat");
    await noHorizontalOverflow(A, "chat terbuka");
    await shot(A, "05-chat");
    await A.click(".chat-head button");
    await B.click(".chat-head button");

    // 5. Main; Dewi refresh di tengah game dan kembali dengan kartu yang sama
    let refreshed = false;
    const total = await playUntilDone(pages, async (moves) => {
      if (!refreshed && moves >= 6) {
        refreshed = true;
        await shot(A, "04b-tengah-game");
        const before = (await handKeys(D)).join(",");
        await D.reload();
        await D.waitForSelector('[data-testid="hand"] [data-card]');
        const after = (await handKeys(D)).join(",");
        check(before === after, `refresh di tengah game: kartu tangan sama (${after})`);
        check(D.url().endsWith(`/g/${code}`) && (await D.locator("#nama").count()) === 0, "kembali ke kursi tanpa mengisi nama lagi");
      }
    });
    check(refreshed, "uji refresh dijalankan");
    log(`game 1 selesai dalam ${total} langkah`);

    // 6. Hasil dan rematch
    for (const p of pages) await p.waitForSelector('[data-testid="ranking"]');
    const rows = await A.locator('[data-testid="ranking"] li').count();
    check(rows === 4, "peringkat 1..4 tampil");
    const ranks = await A.$$eval('[data-testid="ranking"] li', (els) => els.map((e) => e.getAttribute("data-rank")));
    check(ranks.join() === "1,2,3,4", "peringkat berurutan 1..4");
    await noHorizontalOverflow(A, "hasil");
    await shot(A, "06-hasil");
    await C.click('[data-testid="rematch"]');
    for (const p of pages) await p.waitForSelector('[data-testid="hand"] [data-card]');
    check((await Promise.all(pages.map(handKeys))).every((h) => h.length === 7), "rematch: game 2 dimulai, tiap pemain 7 kartu");
    const total2 = await playUntilDone(pages);
    log(`game 2 selesai dalam ${total2} langkah`);

    // 7. Tidak ada galat konsol, tidak ada permintaan ke pihak ketiga
    check(problems.length === 0, `tanpa galat konsol/halaman${problems.length ? `: ${problems.join(" | ")}` : ""}`);
    check(external.length === 0, `tanpa permintaan ke pihak ketiga${external.length ? `: ${external.join(", ")}` : ""}`);
    log(`tangkapan layar di ${outDir}`);
    log("SEMUA LULUS");
  } finally {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
