/* Uji sistem menyeluruh: server nyata + klien WebSocket otomatis dari beberapa kelompok selama beberapa "hari"
 * simulasi (jam palsu), ekspor CSV lewat /admin/events.csv, skrip penghitung, lalu periksa hasilnya. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ManualClock, defaultServerConfig, startServer, type GmersServer, type ServerMessage, type StateMessage } from "@gmers/server";
import { computeReport, parseCsv, parseEvents } from "../lib/metrics";

const ADMIN = randomBytes(24).toString("hex");
const SECRET_CHAT = "RAHASIA-CHAT-QWERTY-12345";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class Bot {
  ws!: WebSocket;
  state: StateMessage | null = null;
  errors: string[] = [];
  private lastMove = -1;
  private seed: number;
  constructor(
    readonly port: number,
    readonly token: string,
    readonly name: string,
  ) {
    this.seed = [...token].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  }
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 2 ** 32;
  }
  async connect(): Promise<this> {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    await new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.type === "state") {
        this.state = m;
        this.act();
      } else if (m.type === "error") this.errors.push(m.code);
    });
    return this;
  }
  send(m: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }
  private act(): void {
    const s = this.state;
    if (!s?.game || s.room.phase !== "playing" || s.game.turn !== s.you.seat || s.game.yourMoves.length === 0) return;
    if (this.lastMove === s.game.moveCount) return;
    this.lastMove = s.game.moveCount;
    const mv = s.game.yourMoves[Math.floor(this.rand() * s.game.yourMoves.length)];
    this.send(mv as Record<string, unknown>);
  }
  async until(pred: (s: StateMessage) => boolean, ms = 15_000): Promise<StateMessage> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.state && pred(this.state)) return this.state;
      await sleep(15);
    }
    throw new Error(`${this.name}: menunggu kondisi melewati batas waktu (fase: ${this.state?.room.phase})`);
  }
  close(): void {
    this.ws.terminate();
  }
}

let server: GmersServer;
let clock: ManualClock;
let dataDir: string;
const groups: Record<string, string> = {};
const live = new Map<string, Bot[]>();

const tokenOf = (g: string, i: number): string => `${g.toLowerCase()}-perangkat-${i}-`.padEnd(30, "x");
const names = ["Andi", "Budi", "Citra", "Dewi"];

async function newBots(g: string, n: number): Promise<Bot[]> {
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) bots.push(await new Bot(server.port, tokenOf(g, i), names[i] as string).connect());
  live.set(g, bots);
  return bots;
}

/** Hari pertama kelompok: pemilik membuat kelompok, yang lain membuka tautan lalu duduk. */
async function createGroup(g: string, n: number): Promise<Bot[]> {
  const bots = await newBots(g, n);
  bots[0]!.send({ type: "create_room", name: bots[0]!.name, token: bots[0]!.token });
  const code = (await bots[0]!.until((s) => !!s.room.groupId)).room.groupId;
  groups[g] = code;
  for (let i = 1; i < n; i++) {
    const b = bots[i]!;
    b.send({ type: "open_link", groupId: code, token: b.token });
    await sleep(20);
    b.send({ type: "join", groupId: code, name: b.name, token: b.token });
    await b.until((s) => s.room.seats.filter(Boolean).length === i + 1);
  }
  return bots;
}

/** Hari berikutnya: perangkat yang sama membuka kembali kode kelompok (sesi lama sudah dibersihkan). */
async function returnToGroup(g: string, n: number): Promise<Bot[]> {
  live.get(g)?.forEach((b) => b.close());
  await sleep(50);
  const bots = await newBots(g, n);
  for (let i = 0; i < n; i++) {
    const b = bots[i]!;
    b.send({ type: "open_link", groupId: groups[g], token: b.token });
    await sleep(15);
    b.send({ type: "join", groupId: groups[g], name: b.name, token: b.token });
  }
  await bots[n - 1]!.until((s) => s.room.seats.filter(Boolean).length === n);
  return bots;
}

async function playGame(bots: Bot[], opts: { rematch?: boolean } = {}): Promise<void> {
  const host = bots[0]!;
  // Game bisa selesai lebih cepat daripada selang polling, jadi tunggu nomor game berikutnya selesai, bukan fase "playing".
  const target = (host.state?.room.gameNo ?? 0) + 1;
  if (opts.rematch) bots[bots.length - 1]!.send({ type: "rematch" });
  else host.send({ type: "start" });
  await Promise.all(bots.map((b) => b.until((s) => s.room.phase === "finished" && s.room.gameNo >= target, 30_000)));
}

const advanceTo = (iso: string): void => clock.setTime(Date.parse(iso));

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "gmers-sistem-"));
  clock = new ManualClock(Date.parse("2026-11-23T03:00:00Z")); // Senin 10.00 WIB
  server = await startServer(
    { ...defaultServerConfig, port: 0, host: "127.0.0.1", dataDir, eventsCsvFile: "events.csv", staticDir: null, adminToken: ADMIN, hashSalt: "garam-uji-sistem" },
    { clock },
  );
});

afterAll(async () => {
  live.forEach((bots) => bots.forEach((b) => b.close()));
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("uji sistem: beberapa kelompok, beberapa hari simulasi", () => {
  let csv = "";

  it("memainkan semua skenario dan mengekspor CSV lewat endpoint admin", async () => {
    // Hari 1, 10.00 WIB
    const g1 = await createGroup("G1", 3);
    const spare = await new Bot(server.port, tokenOf("G1", 9), "Eko").connect();
    spare.send({ type: "join", groupId: groups.G1, name: "Eko", token: spare.token });
    await spare.until((s) => s.room.seats.filter(Boolean).length === 4);
    spare.send({ type: "leave" }); // peristiwa player_left
    await g1[0]!.until((s) => s.room.seats.filter(Boolean).length === 3);
    spare.close();
    g1[1]!.send({ type: "chat", text: SECRET_CHAT });
    await playGame(g1);

    const g2 = await createGroup("G2", 4);
    // Putus dan sambung ulang sebelum game (peristiwa reconnected)
    g2[2]!.close();
    await sleep(40);
    const back = await new Bot(server.port, tokenOf("G2", 2), "Citra").connect();
    back.send({ type: "join", groupId: groups.G2, name: "Citra", token: back.token });
    await back.until((s) => s.you.seat === 2);
    g2[2] = back;
    await playGame(g2);
    advanceTo("2026-11-23T04:00:00Z"); // rematch sejam kemudian, hari WIB yang sama
    await playGame(g2, { rematch: true });

    const g3 = await createGroup("G3", 2);
    await playGame(g3);
    const g4 = await createGroup("G4", 3);
    await playGame(g4);

    // Hari 1, 23.50 WIB: G5 bermain, lalu rematch 20 menit kemudian (00.10 WIB, hari berikutnya)
    advanceTo("2026-11-23T16:50:00Z");
    const g5 = await createGroup("G5", 4);
    await playGame(g5);
    advanceTo("2026-11-23T17:10:00Z");
    await playGame(g5, { rematch: true });

    // Hari 2, 10.00 WIB: G3 (2 pemain) kembali
    advanceTo("2026-11-24T03:00:00Z");
    live.get("G1")!.forEach((b) => b.close());
    live.get("G2")!.forEach((b) => b.close());
    live.get("G4")!.forEach((b) => b.close());
    // Sesi G3 baru idle 17 jam, jadi mereka sambung kembali ke sesi yang sama (reconnected) dan rematch.
    const g3b = await returnToGroup("G3", 2);
    await playGame(g3b, { rematch: true });

    // Hari 3: G1 kembali (sesi lama sudah lewat 24 jam, kode kelompok yang sama membuka sesi baru)
    advanceTo("2026-11-25T04:00:00Z"); // 11.00 WIB; sesi yang terputus sejak hari 2 sudah idle > 24 jam
    expect(server.service.rooms.size).toBe(2); // hanya G3 dan G5 yang masih punya pemain terhubung
    const g1b = await returnToGroup("G1", 3);
    expect(g1b[0]!.state!.room.groupId).toBe(groups.G1);
    await playGame(g1b);

    // Hari 16: G4 kembali setelah jendela 14 hari terlewat
    advanceTo("2026-12-08T03:00:00Z");
    const g4b = await returnToGroup("G4", 3);
    await playGame(g4b);

    // Ekspor: tanpa token ditolak, dengan token berhasil
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/admin/events.csv`)).status).toBe(401);
    expect((await fetch(`${base}/admin/events.csv?token=salah`)).status).toBe(401);
    const r = await fetch(`${base}/admin/events.csv`, { headers: { authorization: `Bearer ${ADMIN}` } });
    expect(r.status).toBe(200);
    csv = await r.text();
    expect(csv.split("\n").length).toBeGreaterThan(30);
    for (const bots of live.values()) for (const b of bots) expect(b.errors).toEqual([]);
  });

  it("CSV memuat semua jenis peristiwa dan tiap baris benar bentuknya", () => {
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["ts_utc", "ts_wib", "group_id", "room_id", "device_id", "event", "game_no", "detail"]);
    const events = new Set(rows.slice(1).map((r) => r[5]));
    for (const e of ["group_created", "invite_link_opened", "player_joined", "player_left", "reconnected", "game_started", "game_finished", "rematch_clicked", "message_sent"]) {
      expect(events.has(e), `peristiwa ${e} harus ada`).toBe(true);
    }
    for (const r of rows.slice(1)) {
      expect(r).toHaveLength(8);
      expect(Number.isNaN(Date.parse(r[0] as string))).toBe(false);
      expect(r[1]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+07:00$/);
      expect(r[2]).toMatch(/^[A-Z0-9]{6}$/);
      expect(r[4]).toMatch(/^([0-9a-f]{16})?$/);
      expect(r[7]).toMatch(/^([a-z_]+=[0-9a-f>|a-z]*(;[a-z_]+=[0-9a-f>|a-z]*)*)?$/);
    }
    // waktu WIB konsisten dengan UTC (+7 jam)
    const first = rows[1] as string[];
    expect(Date.parse((first[1] as string).replace("+07:00", "Z")) - Date.parse(first[0] as string)).toBe(7 * 3600_000);
  });

  it("CSV tidak memuat isi chat, nama panggilan, token mentah, alamat IP, atau nomor HP", () => {
    expect(csv).not.toContain(SECRET_CHAT);
    for (const n of names) expect(csv).not.toContain(n);
    expect(csv).not.toMatch(/-perangkat-/);
    expect(csv).not.toMatch(/127\.0\.0\.1|localhost|::1|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(csv).not.toMatch(/(\+62|\b08)\d{8,}/);
    expect(csv).not.toContain(ADMIN);
    const log = readFileSync(join(dataDir, "rooms.jsonl"), "utf8");
    expect(log).not.toContain(SECRET_CHAT);
    expect(log).not.toMatch(/-perangkat-/);
  });

  it("penghitung memberi hasil yang sesuai skenario: hanya G1 dan G5 yang aktif", () => {
    const report = computeReport(parseEvents(csv));
    const byCode = (g: string) => report.results.find((r) => r.groupId === groups[g])!;
    expect(report.summary.groups).toBe(5);
    expect(byCode("G1")).toMatchObject({ active: true, gamesFinished: 2, qualifyingDays: ["2026-11-23", "2026-11-25"], finishedFirstSession: true });
    expect(byCode("G2")).toMatchObject({ active: false, gamesFinished: 2, qualifyingDays: ["2026-11-23"] }); // rematch hari yang sama
    expect(byCode("G3")).toMatchObject({ active: false, gamesFinished: 2, qualifyingDays: [] }); // hanya 2 pemain
    expect(byCode("G4")).toMatchObject({ active: false, gamesFinished: 2, qualifyingDays: ["2026-11-23", "2026-12-08"] }); // jendela terlewat
    expect(byCode("G5")).toMatchObject({ active: true, gamesFinished: 2, qualifyingDays: ["2026-11-23", "2026-11-24"] }); // lewat tengah malam WIB
    expect(report.summary.active).toBe(2);
    expect(report.summary.finishedFirstSession).toBe(5);
    expect(byCode("G1").playedAgainWithin7d).toBe(true); // hari 1 -> hari 3
    expect(byCode("G2").playedAgainWithin7d).toBe(false);
    expect(byCode("G5").playedAgainWithin7d).toBe(true);
    expect(byCode("G4").playedAgainWithin7d).toBe(false);
    expect(report.summary.linksOpened).toBeGreaterThan(0);
    expect(report.summary.linkConversion).toBe(1);
  });

  it("CLI `pnpm hitung` membaca CSV, mencetak tabel, dan menulis CSV hasil", () => {
    const file = join(dataDir, "ekspor.csv");
    const out = join(dataDir, "hasil.csv");
    writeFileSync(file, csv);
    const stdout = execFileSync("node_modules/.bin/tsx", ["hitung-kelompok-aktif.ts", file, "--out", out], { cwd: join(__dirname, ".."), encoding: "utf8" });
    expect(stdout).toContain("Kelompok AKTIF");
    expect(stdout).toContain("2 dari 5");
    expect(stdout).toContain("Konversi tautan");
    const result = readFileSync(out, "utf8").trim().split("\n");
    expect(result).toHaveLength(6);
    expect(result.filter((l) => l.split(",")[3] === "ya")).toHaveLength(2);
    expect(() => execFileSync("node_modules/.bin/tsx", ["hitung-kelompok-aktif.ts", join(dataDir, "tidak-ada.csv")], { cwd: join(__dirname, ".."), stdio: "pipe" })).toThrow();
  });

  it("restart server dari log: kelompok tetap ada dan bisa dibuka lagi", async () => {
    const clock2 = new ManualClock(clock.now() + 1000);
    const s2 = await startServer(
      { ...defaultServerConfig, port: 0, host: "127.0.0.1", dataDir, eventsCsvFile: "events.csv", staticDir: null, adminToken: ADMIN, hashSalt: "garam-uji-sistem" },
      { clock: clock2 },
    );
    try {
      expect([...s2.service.groups.keys()].sort()).toEqual(Object.values(groups).sort());
    } finally {
      await s2.close();
    }
  });
});
