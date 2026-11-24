/* E2E dengan Chromium sungguhan: server nyata + klien hasil build. Jalankan: pnpm e2e
 * Bila browser tidak tersedia, skrip menyatakan SKIP dan keluar dengan kode 0 (pasang dengan `pnpm exec playwright install chromium`). */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { startServer, defaultServerConfig, DEFAULT_ECONOMY } from "@gmers/server";
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

/** Mainkan Ludo lewat UI: klik Lempar dadu bila aktif, selain itu ketuk bidak yang menyala. */
async function playLudo(pages: Page[], onProgress?: (actions: number) => Promise<void>): Promise<number> {
  let actions = 0;
  const deadline = Date.now() + 150_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("GAGAL: Ludo tidak selesai dalam 150 detik");
    const states = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => ({
          done: !!document.querySelector('[data-testid="ranking"]'),
          roll: !!document.querySelector<HTMLButtonElement>('[data-testid="roll"]') && !document.querySelector<HTMLButtonElement>('[data-testid="roll"]')?.disabled,
          pawns: document.querySelectorAll(".pawn.ok").length,
        })),
      ),
    );
    if (states.every((x) => x.done)) return actions;
    let acted = false;
    for (let i = 0; i < pages.length && !acted; i++) {
      const st = states[i];
      const page = pages[i] as Page;
      // State bisa berubah antara pengamatan dan klik (giliran pindah): klik singkat, gagal = coba lagi di putaran berikutnya.
      if (st?.roll) {
        acted = await page.locator('[data-testid="roll"]').click({ timeout: 400 }).then(() => true, () => false);
      } else if (st && st.pawns > 0) {
        acted = await page.locator(".pawn.ok").first().dispatchEvent("click", undefined, { timeout: 400 }).then(() => true, () => false);
      }
    }
    if (acted) {
      actions++;
      if (onProgress) await onProgress(actions);
    }
    await sleep(acted ? 5 : 30);
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
  const server = await startServer({ ...defaultServerConfig, port: 0, host: "127.0.0.1", dataDir, staticDir: dist, eventsCsvFile: "events.csv", adminToken: null, passwordCost: 1024, economy: { ...DEFAULT_ECONOMY, queueWaitMs: 1500 } });
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

    // 4. Chat (tab) dan sundulan
    await B.click('[data-testid="tab-chat"]');
    await shot(B, "05a-daftar-chat");
    await B.click('[data-testid="convo"]');
    await B.fill('[data-testid="chat-input"]', "halo <b>semua</b>");
    await B.click('[data-testid="chat-send"]');
    await A.waitForSelector('[data-testid="chat-badge"]');
    check((await A.textContent('[data-testid="chat-badge"]'))?.trim() === "1", "penanda pesan belum dibaca muncul di tab Chat");
    await A.click('[data-testid="tab-chat"]');
    check((await A.textContent('[data-testid="convo-unread"]'))?.trim() === "1", "baris percakapan menampilkan 1 pesan belum dibaca");
    check(((await A.getAttribute('[data-testid="convo"]', "data-kind")) ?? "") === "group", "room 4 pemain tampil sebagai grup");
    await shot(A, "05b-daftar-chat-unread");
    await A.click('[data-testid="convo"]');
    const logText = (await A.textContent('[data-testid="chat-log"]')) ?? "";
    check(logText.includes("halo <b>semua</b>"), "isi chat tampil sebagai teks");
    check((await A.locator('[data-testid="chat-log"] b').count()) === 0, "tidak ada elemen HTML dari chat");
    await noHorizontalOverflow(A, "tab chat");
    await shot(A, "05-chat");
    await A.click('[data-testid="chat-back"]');
    await A.click('[data-testid="tab-room"]');
    await B.click('[data-testid="chat-back"]');
    await B.click('[data-testid="tab-room"]');

    const turnTexts = await Promise.all(pages.map((p) => p.textContent('[data-testid="turn-text"]')));
    const turnIdx = turnTexts.findIndex((t) => t?.trim() === id.table.yourTurn);
    check(turnIdx >= 0, "ada tepat satu pemain yang gilirannya");
    const nudger = pages[(turnIdx + 1) % 4] as Page;
    await nudger.click('[data-testid="nudge"]');
    const target = pages[turnIdx] as Page;
    await target.waitForFunction(() => /menyundulmu/.test(document.querySelector(".toast")?.textContent ?? ""));
    check(true, "pemain yang ditunggu menerima sundulan (toast 'menyundulmu')");
    await nudger.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-testid="nudge"]')?.disabled === true);
    check(true, "tombol Colek masuk jeda tunggu setelah dipakai");

    // Tab lain: Games dan Profil
    await C.click('[data-testid="tab-games"]');
    await noHorizontalOverflow(C, "tab games (di dalam room)");
    await shot(C, "07-games");
    await C.click('[data-testid="tab-profile"]');
    await noHorizontalOverflow(C, "tab profil");
    await shot(C, "08-profil");
    await C.click('[data-testid="tab-room"]');

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

    const extraPage = async (): Promise<Page> => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, locale: "id-ID" });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`pageerror[ludo]: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !/status of 401/.test(m.text())) problems.push(`console.error[ludo]: ${m.text()}`);
      });
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
      });
      return page;
    };
    // 6b. Ludo: dua pemain memainkan satu game penuh lewat UI (lempar dadu, ketuk bidak)
    const L1 = await extraPage();
    const L2 = await extraPage();
    await L1.goto(base);
    await L1.fill("#nama", "Lia");
    await L1.click('[data-testid="create-ludo"]');
    await L1.waitForSelector('[data-testid="share-url"]');
    check(((await L1.textContent('[data-testid="game-pick"]')) ?? "").includes("Ludo"), "room dibuat dengan game Ludo");
    const lCode = (await L1.textContent('[data-testid="group-code"]'))?.trim() ?? "";
    await L2.goto(`${base}/g/${lCode}`);
    await L2.waitForSelector("#nama");
    await L2.fill("#nama", "Lukas");
    await L2.click("button[type=submit]");
    await L2.waitForSelector('[data-testid="share-url"]');
    check(((await L2.textContent('[data-testid="game-label"]')) ?? "").includes("Ludo"), "tamu melihat game terpilih: Ludo");
    await L1.click("button.primary.big");
    for (const p of [L1, L2]) await p.waitForSelector('[data-testid="ludo-board"]');
    check((await L1.locator(".pawn").count()) === 8, "papan Ludo tampil dengan 8 bidak");
    await noHorizontalOverflow(L1, "papan Ludo");
    await shot(L1, "12-ludo-awal");
    let shotMid = false;
    const ludoMoves = await playLudo([L1, L2], async (n) => {
      if (!shotMid && n >= 60) {
        shotMid = true;
        await shot(L1, "13-ludo-tengah");
        await shot(L2, "13-ludo-tengah-p2");
      }
    });
    log(`Ludo selesai dalam ${ludoMoves} aksi`);
    for (const p of [L1, L2]) await p.waitForSelector('[data-testid="ranking"]');
    check((await L1.locator('[data-testid="ranking"] li').count()) === 2, "hasil Ludo: peringkat 1..2");
    check(((await L1.textContent('[data-testid="ranking"]')) ?? "").includes("dari 4 bidak"), "hasil Ludo menampilkan bidak yang sampai rumah");
    await shot(L1, "14-ludo-hasil");
    await L2.click('[data-testid="rematch"]');
    for (const p of [L1, L2]) await p.waitForSelector('[data-testid="ludo-board"]');
    check(true, "rematch Ludo memakai game yang sama");

    // 6c. Ranked lawan acak: dua akun mengantre, dicocokkan, bermain Ludo penuh, Trofi dihitung server
    const regAccount = async (page: Page, user: string, nick: string): Promise<void> => {
      await page.goto(base);
      await page.fill("#nama", nick);
      await page.click('[data-testid="tab-profile"]');
      await page.fill("#akun-user", user);
      await page.fill("#akun-pass", "rahasia-ranked-1");
      await page.click('[data-testid="account-submit"]');
      await page.waitForSelector('[data-testid="account-user"]');
    };
    const R1 = await extraPage();
    const R2 = await extraPage();
    await regAccount(R1, "rani_e2e", "Rani");
    await regAccount(R2, "rudi_e2e", "Rudi");
    await R1.click('[data-testid="tab-games"]');
    check(((await R1.textContent('[data-testid="ranked-card"]')) ?? "").includes("Ranked lawan acak"), "kartu Ranked tampil untuk akun terdaftar");
    await shot(R1, "15-ranked-games");
    await R1.click('[data-testid="find-ludo"]');
    await R1.waitForSelector('[data-testid="queue-waiting"]');
    check(true, "status antrean 'Mencari lawan' tampil");
    await R2.click('[data-testid="tab-games"]');
    await R2.click('[data-testid="find-ludo"]');
    for (const p of [R1, R2]) await p.waitForSelector('[data-testid="ludo-board"]', { timeout: 15_000 });
    check(true, "dua pemain dicocokkan otomatis dan game Ranked Ludo langsung mulai");
    await playLudo([R1, R2]);
    for (const p of [R1, R2]) await p.waitForSelector('[data-testid="my-reward"]');
    const chips = await R1.$$eval('[data-testid="reward-chip"]', (els) => els.map((e) => e.textContent?.trim() ?? ""));
    check(chips.includes("+12 Trofi") && chips.includes("+0 Trofi"), `hadiah Ranked dihitung server: pemenang +12 Trofi (10 + bonus harian 2), yang kalah +0 karena lantai (${chips.join(" / ")})`);
    await shot(R1, "16-ranked-hasil");
    await R1.click('[data-testid="tab-games"]');
    await R1.waitForSelector('[data-testid="leaderboard"] .brow');
    const boardRows = await R1.locator('[data-testid="leaderboard"] .brow').count();
    check(boardRows >= 1, `papan peringkat menampilkan pemain Ranked (${boardRows} baris)`);
    await shot(R1, "17-papan-peringkat");
    await noHorizontalOverflow(R1, "tab games dengan Ranked dan papan");

    // 7. Akun: daftar, tetap masuk setelah muat ulang, masuk dari perangkat lain, room tetap di daftar
    const extra = async (): Promise<Page> => {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, locale: "id-ID" });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => problems.push(`pageerror[akun]: ${e.message}`));
      page.on("console", (m) => {
        // 401 dari percobaan kata sandi salah yang sengaja diuji dicatat Chromium sebagai galat konsol; itu bukan masalah.
        if (m.type() === "error" && !/status of 401/.test(m.text())) problems.push(`console.error[akun]: ${m.text()}`);
      });
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (!["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
      });
      return page;
    };
    const E = await extra();
    await E.goto(base);
    await E.fill("#nama", "Eka");
    await E.click("button[type=submit]");
    await E.waitForSelector('[data-testid="share-url"]');
    const eCode = (await E.textContent('[data-testid="group-code"]'))?.trim() ?? "";
    await E.click('[data-testid="tab-profile"]');
    await noHorizontalOverflow(E, "profil tamu");
    await shot(E, "09-profil-tamu");
    await E.fill("#akun-user", "eka_e2e");
    await E.fill("#akun-pass", "rahasia-e2e-123");
    await E.click('[data-testid="account-submit"]');
    await E.waitForSelector('[data-testid="account-user"]');
    check(((await E.textContent('[data-testid="account-user"]')) ?? "").includes("@eka_e2e"), "daftar akun berhasil: 'Masuk sebagai @eka_e2e'");
    await noHorizontalOverflow(E, "profil dengan akun");
    await shot(E, "10-profil-akun");
    await E.reload();
    await E.click('[data-testid="tab-profile"]');
    await E.waitForSelector('[data-testid="account-user"]');
    check((await E.locator("#akun-user").count()) === 0, "setelah muat ulang tetap masuk (tanpa formulir masuk)");

    const F = await extra(); // perangkat lain
    await F.goto(base);
    await F.click('[data-testid="tab-profile"]');
    await F.click('[data-mode="login"]');
    await F.fill("#akun-user", "eka_e2e");
    await F.fill("#akun-pass", "salah-sekali");
    await F.click('[data-testid="account-submit"]');
    await F.waitForSelector(".hint.bad");
    check(((await F.textContent(".hint.bad")) ?? "").includes("salah"), "kata sandi salah ditolak dengan pesan");
    await F.fill("#akun-pass", "rahasia-e2e-123");
    await Promise.all([F.waitForNavigation({ waitUntil: "load" }).catch(() => undefined), F.click('[data-testid="account-submit"]')]);
    await F.click('[data-testid="tab-profile"]');
    await F.waitForSelector('[data-testid="account-user"]');
    await F.click('[data-testid="tab-chat"]');
    await F.waitForSelector('[data-testid="convo"]');
    check(((await F.getAttribute('[data-testid="convo"]', "data-group")) ?? "") === eCode, "masuk dari perangkat lain: room akun tampil di daftar chat");
    await shot(F, "11-chat-perangkat-lain");

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
