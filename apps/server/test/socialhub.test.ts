import { describe, expect, it } from "vitest";
import { createRng } from "@gmers/game-engine";
import { AccountService, MemoryAccountLog, isAuthError } from "../src/accounts";
import { MemoryEventSink } from "../src/events";
import { Ledger, MemoryLedgerLog } from "../src/ledger";
import { Progress } from "../src/progress";
import type { ClientMessage, ServerMessage } from "../src/protocol";
import { RoomService } from "../src/service";
import { MemorySocialLog, Social } from "../src/social";
import { SocialHub } from "../src/socialhub";
import { MemoryRoomLog } from "../src/store";
import { FakeClock, FakeConn, testConfig, tok } from "./support";
import type { ServerConfig } from "../src/config";

function world(over: Partial<ServerConfig> = {}) {
  const clock = new FakeClock();
  clock.t = Date.parse("2026-11-24T12:00:00+07:00");
  const cfg = testConfig(over);
  const accounts = new AccountService(cfg, new MemoryAccountLog(), clock);
  const socialLog = new MemorySocialLog();
  const social = new Social(socialLog, clock);
  const roomLog = new MemoryRoomLog();
  const ledger = new Ledger(new MemoryLedgerLog(), () => clock.now());
  const progress = new Progress(ledger, cfg.economy);
// eslint-disable-next-line prefer-const -- dipakai closure sebelum diisi
  let svc!: RoomService;
  const hub = new SocialHub(cfg, clock, social, accounts, (c) => svc.roomOfConn(c as FakeConn));
  let n = 0;
  svc = new RoomService(cfg, {
    clock,
    log: roomLog,
    events: new MemoryEventSink(),
    newGroupId: () => `SOC${n++}`.padEnd(6, "X"),
    newSeed: () => `seed-soc-${n++}`,
    hooks: {
      authenticate: (s) => accounts.identify(s),
      accountIdOf: (h) => accounts.accountIdByTokenHash(h),
      settle: (i) => {
        const r = progress.settle(i);
        hub.recordGame(i.players.flatMap((p) => (p.accountId ? [p.accountId] : [])), i.ts);
        return r;
      },
      social: hub as never,
    },
  });
  svc.start();
  return { clock, cfg, accounts, social, socialLog, hub, svc, roomLog };
}
type W = ReturnType<typeof world>;

interface U {
  conn: FakeConn;
  session: string;
  id: string;
  username: string;
  token: string;
}
async function user(w: W, name: string, i: number, connect = true): Promise<U> {
  const token = tok(`soc-${i}`);
  const r = await w.accounts.register({ username: name.toLowerCase(), password: "rahasia123", name, token });
  if (isAuthError(r)) throw new Error(r.code);
  const conn = new FakeConn();
  const id = w.accounts.byUsername(name)!.id;
  if (connect) w.svc.handle(conn, { type: "auth", session: r.session });
  return { conn, session: r.session, id, username: name.toLowerCase(), token: r.account.token };
}
const makeFriends = (w: W, a: U, b: U): void => {
  w.social.follow(a.id, b.id, true);
  w.social.follow(b.id, a.id, true);
};
const send = (w: W, c: FakeConn, m: ClientMessage): void => w.svc.handle(c, m);
const msgs = <T extends ServerMessage["type"]>(c: FakeConn, type: T): Extract<ServerMessage, { type: T }>[] => c.msgs.filter((m) => m.type === type) as never;

describe("pesan 1-1", () => {
  it("antar teman: penerima daring menerima, pengirim mendapat konfirmasi; isi tidak tertulis di log mana pun", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    makeFriends(w, a, b);
    send(w, a.conn, { type: "dm_send", to: "budi", text: "rahasia-dm-unik-424242" });
    expect(msgs(b.conn, "dm")[0]).toMatchObject({ from: { username: "andi", name: "Andi" }, text: "rahasia-dm-unik-424242" });
    expect(msgs(a.conn, "dm_ack")[0]).toMatchObject({ to: "budi", delivered: true });
    const dump = JSON.stringify([w.socialLog.readAll(), w.roomLog.readAll()]);
    expect(dump).not.toContain("rahasia-dm-unik-424242");
    // notifikasi netral tanpa isi pesan
    expect(msgs(b.conn, "notice").at(-1)).toMatchObject({ kind: "dm", text: "Pesan baru dari Andi" });
  });

  it("ditolak: belum login, bukan teman, pengguna tak ada, diblokir, putus pertemanan di tengah jalan", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    const guest = new FakeConn();
    send(w, guest, { type: "dm_send", to: "andi", text: "halo" });
    expect(guest.lastError()?.code).toBe("NOT_LOGGED_IN");
    send(w, a.conn, { type: "dm_send", to: "budi", text: "halo" });
    expect(a.conn.lastError()?.code).toBe("NOT_FRIENDS");
    send(w, a.conn, { type: "dm_send", to: "hantu", text: "halo" });
    expect(a.conn.lastError()?.code).toBe("NOT_FOUND");
    send(w, a.conn, { type: "dm_send", to: "andi", text: "halo" });
    expect(a.conn.lastError()?.code).toBe("NOT_FOUND"); // tidak bisa kirim ke diri sendiri
    makeFriends(w, a, b);
    send(w, a.conn, { type: "dm_send", to: "budi", text: "halo" });
    expect(msgs(b.conn, "dm")).toHaveLength(1);
    w.social.follow(a.id, b.id, false); // putus
    send(w, a.conn, { type: "dm_send", to: "budi", text: "lagi" });
    expect(a.conn.lastError()?.code).toBe("NOT_FRIENDS");
    makeFriends(w, a, b);
    w.social.block(b.id, a.id, true);
    send(w, a.conn, { type: "dm_send", to: "budi", text: "lagi" });
    expect(a.conn.lastError()?.code).toBe("BLOCKED");
    expect(msgs(b.conn, "dm")).toHaveLength(1);
  });

  it("penerima offline: pesan antre di memori dan dikirim berurutan sekali saat masuk; kedaluwarsa dan batas jumlah berlaku", async () => {
    const w = world({ dmPendingMax: 3, dmPendingTtlMs: 60_000 });
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2, false);
    makeFriends(w, a, b);
    send(w, a.conn, { type: "dm_send", to: "budi", text: "lama" });
    expect(msgs(a.conn, "dm_ack")[0]).toMatchObject({ delivered: false });
    w.clock.advance(61_000);
    for (const t of ["satu", "dua", "tiga", "empat"]) {
      w.clock.advance(1000);
      send(w, a.conn, { type: "dm_send", to: "budi", text: t });
    }
    const conn = new FakeConn();
    send(w, conn, { type: "auth", session: b.session });
    expect(msgs(conn, "dm").map((m) => m.text)).toEqual(["dua", "tiga", "empat"]); // "lama" kedaluwarsa, "satu" terbuang oleh batas 3
    const again = new FakeConn();
    send(w, again, { type: "auth", session: b.session });
    expect(msgs(again, "dm")).toHaveLength(0); // tidak dikirim ulang
  });

  it("Jangan ganggu menahan pesan sampai status berubah; pembatas laju 10 pesan per 10 detik", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    makeFriends(w, a, b);
    w.hub.setStatus(b.id, "dnd");
    send(w, a.conn, { type: "dm_send", to: "budi", text: "tertahan" });
    expect(msgs(b.conn, "dm")).toHaveLength(0);
    expect(msgs(b.conn, "notice")).toHaveLength(0); // tidak ada notifikasi langsung
    expect(w.hub.feed(b.id)).toHaveLength(1); // tetap tercatat di umpan
    w.hub.setStatus(b.id, "siap");
    expect(msgs(b.conn, "dm").map((m) => m.text)).toEqual(["tertahan"]);
    for (let i = 0; i < 9; i++) send(w, a.conn, { type: "dm_send", to: "budi", text: `p${i}` });
    send(w, a.conn, { type: "dm_send", to: "budi", text: "kesebelas" });
    expect(a.conn.lastError()?.code).toBe("RATE_LIMITED");
    w.clock.advance(10_000);
    send(w, a.conn, { type: "dm_send", to: "budi", text: "lagi" });
    expect(msgs(b.conn, "dm").at(-1)?.text).toBe("lagi");
  });
});

describe("ajak main", () => {
  async function lobbyPair(w: W) {
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    makeFriends(w, a, b);
    send(w, a.conn, { type: "create_room", name: "Andi", token: a.token, game: "ludo" });
    return { a, b, groupId: a.conn.state().room.groupId };
  }

  it("undangan dikirim dari ruang tunggu, diterima teman dengan kode room dan masa berlaku; balasan sampai ke pengirim; hanya sekali", async () => {
    const w = world();
    const { a, b, groupId } = await lobbyPair(w);
    send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(msgs(a.conn, "invite_result")[0]).toMatchObject({ reply: "sent", to: { username: "budi" } });
    const inv = msgs(b.conn, "invite")[0]!;
    expect(inv).toMatchObject({ from: { username: "andi", name: "Andi" }, game: "ludo", groupId, silent: false });
    expect(inv.expiresAt).toBe(w.clock.now() + 15 * 60_000);
    send(w, b.conn, { type: "invite_reply", id: inv.id, reply: "join" });
    expect(msgs(a.conn, "invite_result").at(-1)).toMatchObject({ id: inv.id, reply: "join", to: { username: "budi" } });
    send(w, b.conn, { type: "invite_reply", id: inv.id, reply: "later" });
    expect(b.conn.lastError()?.code).toBe("INVITE_EXPIRED");
    send(w, a.conn, { type: "invite_reply", id: inv.id, reply: "join" }); // bukan penerima
    expect(a.conn.lastError()?.code).toBe("NOT_FOUND");
  });

  it("kedaluwarsa setelah 15 menit; harus punya room di ruang tunggu; hanya antar teman", async () => {
    const w = world();
    const { a, b } = await lobbyPair(w);
    send(w, a.conn, { type: "invite_send", to: "budi", game: "gaple" });
    const id = msgs(b.conn, "invite")[0]!.id;
    w.clock.advance(15 * 60_000 + 1);
    send(w, b.conn, { type: "invite_reply", id, reply: "join" });
    expect(b.conn.lastError()?.code).toBe("INVITE_EXPIRED");

    const c = await user(w, "Citra", 3);
    send(w, c.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(c.conn.lastError()?.code).toBe("NOT_FRIENDS");
    makeFriends(w, c, b);
    send(w, c.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(c.conn.lastError()?.code).toBe("NO_ROOM"); // Citra belum punya room
    // room yang sedang bermain tidak bisa dipakai mengajak
    send(w, a.conn, { type: "start" }); // satu pemain: gagal mulai (butuh 2)
    const d = await user(w, "Dedi", 4);
    makeFriends(w, a, d);
    send(w, d.conn, { type: "join", groupId: a.conn.state().room.groupId, name: "Dedi", token: d.token });
    send(w, a.conn, { type: "start" });
    send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(a.conn.lastError()?.code).toBe("NO_ROOM");
  });

  it("status penerima: Sibuk dibalas otomatis; Jangan ganggu ditahan tanpa notifikasi lalu dikirim; Senyap dikirim tanpa bunyi; offline ditahan sampai masuk", async () => {
    const w = world();
    const { a, b } = await lobbyPair(w);
    w.hub.setStatus(b.id, "sibuk");
    send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(msgs(a.conn, "invite_result").at(-1)).toMatchObject({ reply: "auto_busy" });
    expect(msgs(b.conn, "invite")).toHaveLength(0);

    w.hub.setStatus(b.id, "dnd");
    send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(msgs(a.conn, "invite_result").at(-1)).toMatchObject({ reply: "sent" });
    expect(msgs(b.conn, "invite")).toHaveLength(0);
    expect(msgs(b.conn, "notice").filter((n) => n.kind === "invite")).toHaveLength(0);
    w.hub.setStatus(b.id, "senyap"); // kembali: tertahan dikirim, tanpa bunyi
    expect(msgs(b.conn, "invite")).toHaveLength(1);
    expect(msgs(b.conn, "invite")[0]).toMatchObject({ silent: true });

    const c = await user(w, "Citra", 3, false);
    makeFriends(w, a, c);
    send(w, a.conn, { type: "invite_send", to: "citra", game: "ludo" });
    const cc = new FakeConn();
    send(w, cc, { type: "auth", session: c.session });
    expect(msgs(cc, "invite")).toHaveLength(1);
    expect(msgs(cc, "invite")[0]).toMatchObject({ silent: false });
  });
});

describe("notifikasi dalam aplikasi", () => {
  it("jenis yang dimatikan tidak dibuat; umpan dicatat, dibaca, dan dibatasi 50", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    w.hub.notify(a.id, "follow", "Budi mengikutimu");
    w.social.setPrefs(a.id, { follow: false });
    w.hub.notify(a.id, "follow", "Citra mengikutimu");
    expect(w.hub.feed(a.id).map((n) => n.text)).toEqual(["Budi mengikutimu"]);
    expect(msgs(a.conn, "notice")).toHaveLength(1);
    w.hub.markRead(a.id);
    expect(w.hub.feed(a.id).every((n) => n.read)).toBe(true);
    w.social.setPrefs(a.id, { follow: true });
    for (let i = 0; i < 70; i++) w.hub.notify(a.id, "follow", `p${i}`);
    expect(w.hub.feed(a.id)).toHaveLength(50);
  });
});

describe("streak dan pengingat", () => {
  it("game selesai antar teman menaikkan streak mereka (lewat settle); tamu atau bukan teman tidak", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    const c = await user(w, "Citra", 3);
    makeFriends(w, a, b);
    send(w, a.conn, { type: "create_room", name: "Andi", token: a.token, game: "ludo" });
    const groupId = a.conn.state().room.groupId;
    send(w, b.conn, { type: "join", groupId, name: "Budi", token: b.token });
    send(w, c.conn, { type: "join", groupId, name: "Citra", token: c.token });
    send(w, a.conn, { type: "start" });
    const pick = createRng("streak");
    const conns = [a.conn, b.conn, c.conn];
    for (let i = 0; i < 9000 && w.svc.rooms.get(groupId)!.phase === "playing"; i++) {
      const r = w.svc.rooms.get(groupId)!;
      const seat = r.game!.roomSeats[r.game!.adapter.turn(r.game!.state)]!;
      const mv = conns[seat]!.state().game!.yourMoves;
      const m = mv[Math.floor(pick() * mv.length)]!;
      send(w, conns[seat]!, m.type === "roll" ? { type: "roll" } : { type: "pick", pawn: (m as { pawn: number }).pawn });
    }
    expect(w.svc.rooms.get(groupId)!.phase).toBe("finished");
    expect(w.social.streak(a.id, b.id).count).toBe(1);
    expect(w.social.streak(a.id, c.id).count).toBe(0);
    expect(w.social.streak(b.id, c.id).count).toBe(0);
  });

  it("pengingat: hanya 18.00-22.00 WIB, untuk streak >= 2 yang belum main hari ini, maksimal 1 per akun per hari, menghormati preferensi", async () => {
    const w = world();
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    makeFriends(w, a, b);
    const at = (d: string, hm: string): number => Date.parse(`${d}T${hm}:00+07:00`);
    w.social.recordGame([a.id, b.id], at("2026-11-22", "20:00"));
    w.social.recordGame([a.id, b.id], at("2026-11-23", "20:00"));
    expect(w.hub.remindStreaks(at("2026-11-24", "10:00"))).toBe(0); // terlalu pagi
    expect(w.hub.remindStreaks(at("2026-11-24", "22:30"))).toBe(0); // jam tenang
    expect(w.hub.remindStreaks(at("2026-11-24", "19:00"))).toBe(2); // keduanya diingatkan
    expect(msgs(a.conn, "notice").at(-1)).toMatchObject({ kind: "streak", text: "Streak 2 hari dengan Budi hampir putus" });
    expect(w.hub.remindStreaks(at("2026-11-24", "20:00"))).toBe(0); // maksimal 1 per hari
    expect(w.hub.remindStreaks(at("2026-11-25", "19:00"))).toBe(2); // hari berikutnya boleh lagi
    // sudah main hari ini: tidak diingatkan; preferensi dimatikan: tidak dibuat
    w.social.recordGame([a.id, b.id], at("2026-11-26", "12:00"));
    expect(w.hub.remindStreaks(at("2026-11-26", "19:00"))).toBe(0);
    w.social.setPrefs(a.id, { streak: false });
    const before = w.hub.feed(a.id).length;
    w.hub.remindStreaks(at("2026-11-27", "19:00"));
    expect(w.hub.feed(a.id)).toHaveLength(before);
  });
  it("batas ajakan per menit: kelebihan ditolak, lalu pulih setelah semenit", async () => {
    const w = world({ inviteBurst: 2 });
    const a = await user(w, "Andi", 1);
    const b = await user(w, "Budi", 2);
    makeFriends(w, a, b);
    send(w, a.conn, { type: "create_room", name: "Andi", token: a.token, game: "ludo" });
    for (let i = 0; i < 3; i++) send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(a.conn.errors().filter((e) => e.code === "RATE_LIMITED")).toHaveLength(1);
    w.clock.advance(61_000);
    send(w, a.conn, { type: "invite_send", to: "budi", game: "ludo" });
    expect(a.conn.errors().filter((e) => e.code === "RATE_LIMITED")).toHaveLength(1);
  });

});
