import { describe, expect, it } from "vitest";
import { createRng } from "@gmers/game-engine";
import { AccountService, MemoryAccountLog, isAuthError } from "../src/accounts";
import { Ledger, MemoryLedgerLog } from "../src/ledger";
import { MemoryEventSink } from "../src/events";
import { Progress, type SettleInput } from "../src/progress";
import type { ClientMessage, GameView } from "../src/protocol";
import { RoomService, hashToken } from "../src/service";
import { MemoryRoomLog } from "../src/store";
import type { ServerConfig } from "../src/config";
import { DEFAULT_ECONOMY } from "../src/economy";
import { FakeClock, FakeConn, assertStateShape, testConfig, tok } from "./support";

function world(over: Partial<ServerConfig> = {}) {
  const clock = new FakeClock();
  const cfg = testConfig({ turnTimeoutMs: 1000, ...over });
  const accounts = new AccountService(cfg, new MemoryAccountLog(), clock);
  const ledger = new Ledger(new MemoryLedgerLog(), () => clock.now());
  const progress = new Progress(ledger, cfg.economy);
  const settled: SettleInput[] = [];
  const roomLog = new MemoryRoomLog();
  let n = 0;
  const mk = (log = roomLog) =>
    new RoomService(cfg, {
      clock,
      log,
      events: new MemoryEventSink(),
      newGroupId: () => `RANK${n++}`.padEnd(6, "X"),
      newSeed: () => `seed-ranked-${n++}`,
      hooks: {
        authenticate: (s) => accounts.identify(s),
        accountIdOf: (h) => accounts.accountIdByTokenHash(h),
        settle: (i) => {
          settled.push(i);
          return progress.settle(i);
        },
      },
    });
  const svc = mk();
  svc.start();
  return { clock, cfg, accounts, ledger, progress, settled, svc, mk, roomLog };
}
type W = ReturnType<typeof world>;

async function user(w: W, name: string, i: number): Promise<{ conn: FakeConn; session: string; token: string; id: string }> {
  const token = tok(`akun-${i}`);
  const r = await w.accounts.register({ username: name.toLowerCase(), password: "rahasia123", name, token });
  if (isAuthError(r)) throw new Error(r.code);
  const conn = new FakeConn();
  w.svc.handle(conn, { type: "auth", session: r.session });
  return { conn, session: r.session, token: r.account.token, id: w.accounts.accountIdByTokenHash(hashToken(token, w.cfg.hashSalt)) as string };
}

const gv = (c: FakeConn): GameView => c.state().game!;
const send = (w: W, c: FakeConn, m: ClientMessage): void => w.svc.handle(c, m);

/** Satu langkah acak untuk pemain yang sedang giliran. */
function step(w: W, conns: FakeConn[], groupId: string, pick: () => number): void {
  const r = w.svc.rooms.get(groupId)!;
  const seat = r.game!.roomSeats[r.game!.adapter.turn(r.game!.state)]!;
  const v = gv(conns[seat]!);
  const mv = v.yourMoves[Math.floor(pick() * v.yourMoves.length)]!;
  const msg: ClientMessage = mv.type === "roll" ? { type: "roll" } : mv.type === "pick" ? { type: "pick", pawn: mv.pawn } : mv.type === "pass" ? { type: "pass" } : { type: "play", card: mv.card, end: mv.end };
  send(w, conns[seat]!, msg);
}

/** Room dengan dua akun terdaftar, game dipilih, Ranked dinyalakan, dimulai. */
async function rankedRoom(w: W, game: "gaple" | "ludo" = "ludo") {
  const a = await user(w, "Andi", 1);
  const b = await user(w, "Budi", 2);
  send(w, a.conn, { type: "create_room", name: "Andi", token: a.token, game });
  const groupId = a.conn.state().room.groupId;
  send(w, b.conn, { type: "join", groupId, name: "Budi", token: b.token });
  send(w, a.conn, { type: "set_ranked", on: true });
  send(w, a.conn, { type: "start" });
  return { a, b, groupId, conns: [a.conn, b.conn] };
}

describe("autentikasi WebSocket", () => {
  it("sesi sah: auth_ok dengan nama; sesi tak dikenal: galat dan tetap tamu", async () => {
    const w = world();
    const u = await user(w, "Andi", 1);
    expect(u.conn.msgs.find((m) => m.type === "auth_ok")).toEqual({ type: "auth_ok", username: "andi", name: "Andi" });
    expect(u.conn.account?.username).toBe("andi");
    const x = new FakeConn();
    send(w, x, { type: "auth", session: "0".repeat(64) });
    expect(x.lastError()?.code).toBe("UNAUTHORIZED");
    expect(x.account).toBeNull();
  });
});

describe("room Ranked", () => {
  it("hanya pemilik yang mengatur; wajib semua pemain punya akun; tamu yang duduk mematikan Ranked", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    send(w, a.conn, { type: "create_room", name: "Andi", token: a.token });
    const groupId = a.conn.state().room.groupId;
    send(w, b.conn, { type: "join", groupId, name: "Budi", token: b.token });
    send(w, b.conn, { type: "set_ranked", on: true });
    expect(b.conn.lastError()?.code).toBe("NOT_HOST");
    send(w, a.conn, { type: "set_ranked", on: true });
    expect(a.conn.state().room.ranked).toBe(true);
    expect(a.conn.state().room.seats.filter(Boolean).map((s) => s!.registered)).toEqual([true, true]);
    const guest = new FakeConn();
    send(w, guest, { type: "join", groupId, name: "Tamu", token: tok("tamu") });
    expect(a.conn.state().room.ranked).toBe(false); // tamu duduk: Ranked dimatikan
    send(w, a.conn, { type: "set_ranked", on: true });
    expect(a.conn.lastError()?.code).toBe("NOT_ALL_REGISTERED");
    expect(a.conn.state().room.seats.find((s) => s?.name === "Tamu")?.registered).toBe(false);
  });

  it("game Ranked selesai: Trofi dan Bintang dihitung server, masuk ke buku besar, dan dikirim ke kedua pemain", async () => {
    const w = world();
    const { a, b, groupId, conns } = await rankedRoom(w, "ludo");
    expect(a.conn.state().room.ranked).toBe(true);
    const pick = createRng("ranked-1");
    for (let i = 0; i < 8000 && w.svc.rooms.get(groupId)!.phase === "playing"; i++) step(w, conns, groupId, pick);
    expect(w.svc.rooms.get(groupId)!.phase).toBe("finished");
    const res = gv(a.conn).result!;
    expect(res.rewards).toHaveLength(2);
    const winnerSeat = res.winner;
    const rw = Object.fromEntries(res.rewards!.map((r) => [r.seat, r]));
    expect(rw[winnerSeat]).toMatchObject({ trofi: 12, bintang: 5, trofiTotal: 12, kelas: "Pemula" }); // +10 +2 bonus harian
    expect(rw[1 - winnerSeat]).toMatchObject({ trofi: 0, bintang: 5, trofiTotal: 0 }); // -5 +2 tertahan lantai 0
    expect(w.progress.wallet(winnerSeat === 0 ? a.id : b.id).trofi).toBe(12);
    expect(w.ledger.balance(a.id, "bintang")).toBe(5);
    // kedua pemain melihat hadiah yang sama, dan bentuk pesan tetap sesuai daftar kunci
    expect(gv(b.conn).result!.rewards).toEqual(res.rewards);
    conns.forEach((c) => assertStateShape(c.state()));
    // penyelesaian hanya sekali per game
    expect(w.settled.filter((x) => x.ref === `${groupId}:1`)).toHaveLength(1);
  });

  it("room santai: hanya Bintang, tanpa Trofi; tamu tidak mendapat apa pun", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    send(w, a.conn, { type: "create_room", name: "Andi", token: a.token, game: "ludo" });
    const groupId = a.conn.state().room.groupId;
    const guest = new FakeConn();
    send(w, guest, { type: "join", groupId, name: "Tamu", token: tok("tamu") });
    send(w, a.conn, { type: "start" });
    const pick = createRng("santai");
    for (let i = 0; i < 8000 && w.svc.rooms.get(groupId)!.phase === "playing"; i++) step(w, [a.conn, guest], groupId, pick);
    const rewards = gv(a.conn).result!.rewards!;
    expect(rewards).toEqual([expect.objectContaining({ seat: 0, trofi: 0, bintang: 5 })]);
    expect(w.progress.wallet(a.id)).toMatchObject({ trofi: 0, bintang: 5 });
  });

  it("pemain yang gilirannya dimainkan otomatis 3 kali berturut-turut ditandai meninggalkan game saat hasil dicatat", async () => {
    const w = world();
    const { a, b, groupId } = await rankedRoom(w, "ludo");
    const pick = createRng("abandon");
    // hanya kursi 0 (Andi) yang bermain; Budi tidak pernah bertindak, jadi waktu habis memainkan gilirannya
    for (let i = 0; i < 20000 && w.svc.rooms.get(groupId)!.phase === "playing"; i++) {
      const r = w.svc.rooms.get(groupId)!;
      const seat = r.game!.roomSeats[r.game!.adapter.turn(r.game!.state)]!;
      if (seat === 0) step(w, [a.conn, b.conn], groupId, pick);
      else w.clock.advance(1000);
    }
    expect(w.svc.rooms.get(groupId)!.phase).toBe("finished");
    const input = w.settled.at(-1)!;
    const byAccount = Object.fromEntries(input.players.map((p) => [p.accountId, p]));
    expect(byAccount[a.id]!.abandoned).toBe(false);
    expect(byAccount[b.id]!.abandoned).toBe(true);
  });

  it("restart: Ranked dan hitungan giliran otomatis dipulihkan dari log; hasil tidak dicatat dua kali", async () => {
    const w = world();
    const { groupId, conns } = await rankedRoom(w, "ludo");
    const pick = createRng("restart");
    for (let i = 0; i < 30; i++) step(w, conns, groupId, pick);
    w.clock.advance(1000); // satu langkah otomatis
    const svc2 = w.mk(w.roomLog);
    svc2.start();
    const r2 = svc2.rooms.get(groupId)!;
    expect(r2.ranked).toBe(true);
    expect(r2.game!.ranked).toBe(true);
    expect([...r2.autoStreak.values()].some((n) => n === 1)).toBe(true);
  });
});

describe("antrean Ranked lawan acak", () => {
  it("harus masuk dulu; tamu ditolak", async () => {
    const w = world();
    const guest = new FakeConn();
    send(w, guest, { type: "queue_ranked", game: "ludo" });
    expect(guest.lastError()?.code).toBe("NOT_LOGGED_IN");
  });

  it("dua pemain: menunggu waktu antrean lalu dicocokkan; room Ranked langsung dimulai, keduanya tahu lewat match_found", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    send(w, a.conn, { type: "queue_ranked", game: "ludo" });
    expect(a.conn.msgs.at(-1)).toMatchObject({ type: "queue", state: "waiting", game: "ludo" });
    send(w, b.conn, { type: "queue_ranked", game: "ludo" });
    expect(w.svc.rooms.size).toBe(0); // belum cukup lama: menunggu pemain lain
    w.clock.advance(DEFAULT_ECONOMY.queueWaitMs);
    const found = a.conn.msgs.find((m) => m.type === "match_found");
    expect(found).toBeTruthy();
    const groupId = (found as { groupId: string }).groupId;
    const r = w.svc.rooms.get(groupId)!;
    expect(r).toMatchObject({ gameId: "ludo", ranked: true, phase: "playing" });
    expect(a.conn.state().room.groupId).toBe(groupId);
    expect(b.conn.state().room.groupId).toBe(groupId);
    expect(gv(a.conn).kind).toBe("ludo");
    expect(a.conn.state().room.seats.filter(Boolean).map((s) => s!.name)).toEqual(["Andi", "Budi"]);
  });

  it("empat pemain langsung dimulai tanpa menunggu; game berbeda tidak dicampur", async () => {
    const w = world();
    const us = await Promise.all([1, 2, 3, 4, 5].map((i) => user(w, `Pemain${i}`, i)));
    for (const u of us.slice(0, 3)) send(w, u.conn, { type: "queue_ranked", game: "gaple" });
    send(w, us[4]!.conn, { type: "queue_ranked", game: "ludo" });
    expect(w.svc.rooms.size).toBe(0);
    send(w, us[3]!.conn, { type: "queue_ranked", game: "gaple" });
    expect(w.svc.rooms.size).toBe(1);
    const room = [...w.svc.rooms.values()][0]!;
    expect(room).toMatchObject({ gameId: "gaple", ranked: true, phase: "playing" });
    expect(room.seats.filter(Boolean)).toHaveLength(4);
    expect(us[4]!.conn.msgs.some((m) => m.type === "match_found")).toBe(false); // pemain Ludo tetap menunggu
  });

  it("batal, putus koneksi, dan sesi yang sedang bermain", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    send(w, a.conn, { type: "queue_ranked", game: "ludo" });
    send(w, a.conn, { type: "cancel_queue" });
    expect(a.conn.msgs.at(-1)).toMatchObject({ type: "queue", state: "idle" });
    send(w, a.conn, { type: "queue_ranked", game: "ludo" });
    send(w, b.conn, { type: "queue_ranked", game: "ludo" });
    w.svc.onDisconnect(b.conn); // Budi putus sebelum cocok
    w.clock.advance(DEFAULT_ECONOMY.queueWaitMs * 2);
    expect(w.svc.rooms.size).toBe(0); // sendirian: tidak dicocokkan dengan siapa pun, dan tidak ada lawan komputer
    // pemain yang sedang bermain tidak bisa mengantre
    const c = await user(w, "Citra", 3);
    const d = await user(w, "Dedi", 4);
    send(w, c.conn, { type: "create_room", name: "Citra", token: c.token });
    send(w, d.conn, { type: "join", groupId: c.conn.state().room.groupId, name: "Dedi", token: d.token });
    send(w, c.conn, { type: "start" });
    send(w, c.conn, { type: "queue_ranked", game: "ludo" });
    expect(c.conn.lastError()?.code).toBe("ALREADY_PLAYING");
  });

  it("status antrean dikirim saat masuk ulang (auth) agar klien tahu masih mengantre", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    send(w, a.conn, { type: "queue_ranked", game: "ludo" });
    const again = new FakeConn();
    // koneksi kedua milik akun yang sama
    send(w, again, { type: "auth", session: a.session });
    expect(again.msgs.at(-1)).toMatchObject({ type: "queue", state: "waiting", game: "ludo" });
  });
});
