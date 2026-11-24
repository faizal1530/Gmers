import { describe, expect, it } from "vitest";
import { RoomService } from "../src/service";
import { MemoryRoomLog } from "../src/store";
import type { ClientMessage, StateMessage } from "../src/protocol";
import { FakeClock, FakeConn, testConfig, tok } from "./support";
import type { ServerConfig } from "../src/config";

function harness(over: Partial<ServerConfig> = {}) {
  const clock = new FakeClock();
  let n = 0;
  const svc = new RoomService(testConfig({ liveDelayMs: 30_000, liveChatMinMs: 1000, ...over }), { clock, log: new MemoryRoomLog(), newGroupId: () => `LIVE${n++}`.padEnd(6, "X"), newSeed: () => "seed-live" });
  svc.start();
  return { svc, clock };
}
const acct = (name: string): FakeConn["account"] => ({ id: `id-${name}`, username: name.toLowerCase(), name, token: `t-${name}` });
const send = (h: ReturnType<typeof harness>, c: FakeConn, m: ClientMessage): void => h.svc.handle(c, m);

function setup(game: "gaple" | "ludo" = "gaple") {
  const h = harness();
  const a = new FakeConn();
  const b = new FakeConn();
  send(h, a, { type: "create_room", name: "Andi", token: tok(1), game });
  const groupId = a.state().room.groupId;
  send(h, b, { type: "join", groupId, name: "Budi", token: tok(2) });
  return { h, a, b, groupId };
}
const watcher = (name = "Citra"): FakeConn => {
  const c = new FakeConn();
  c.account = acct(name);
  return c;
};
const keyOf = (h: ReturnType<typeof harness>): string => h.svc.liveList()[0]!.key;
const states = (c: FakeConn): StateMessage[] => c.msgs.filter((m): m is StateMessage => m.type === "state");

describe("Live: Tonton", () => {
  it("hanya pemilik room yang bisa menyalakan siaran; daftar hanya memuat room yang sedang bermain", () => {
    const { h, a, b } = setup();
    send(h, b, { type: "set_watch", on: true });
    expect(b.lastError()?.code).toBe("NOT_HOST");
    send(h, a, { type: "set_watch", on: true });
    expect(a.state().room.watchable).toBe(true);
    expect(h.svc.liveList()).toEqual([]); // masih di ruang tunggu
    send(h, a, { type: "start" });
    const list = h.svc.liveList();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ game: "gaple", players: ["Andi", "Budi"], spectators: 0 });
    expect(JSON.stringify(list)).not.toContain("LIVE0"); // kode kelompok tidak bocor
    expect(list[0]!.key).toMatch(/^[0-9a-f]{10}$/);
  });

  it("penonton harus punya akun, tidak boleh sedang duduk di room, dan kunci harus benar", () => {
    const { h, a } = setup();
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    const guest = new FakeConn();
    send(h, guest, { type: "watch", key: keyOf(h) });
    expect(guest.lastError()?.code).toBe("NOT_LOGGED_IN");
    const w = watcher();
    send(h, w, { type: "watch", key: "0000000000" });
    expect(w.lastError()?.code).toBe("NOT_FOUND");
    send(h, a, { type: "watch", key: keyOf(h) });
    a.account = acct("Andi");
    send(h, a, { type: "watch", key: keyOf(h) });
    expect(a.lastError()?.code).toBe("IN_ROOM");
  });

  it("penonton menerima siaran tertunda, tanpa kartu tangan atau langkah sah, dan bukan kondisi terkini", () => {
    const { h, a, b } = setup();
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    const w = watcher();
    send(h, w, { type: "watch", key: keyOf(h) });
    expect(w.msgs.find((m) => m.type === "watching")).toMatchObject({ delayMs: 30_000, hasFrame: false });
    expect(states(w)).toHaveLength(0); // game baru mulai: belum ada bingkai yang cukup tua
    h.clock.advance(30_000);
    const first = states(w).at(-1)!;
    expect(first.spectating).toBe(true);
    expect(first.you.seat).toBe(-1);
    expect(first.game?.yourHand).toEqual([]);
    expect(first.game?.yourMoves).toEqual([]);
    expect(first.game?.turnDeadline).toBeNull();
    expect(first.room.seats.every((s) => !s || s.isYou === false)).toBe(true);
    // langkah pemain baru: penonton belum melihatnya sebelum 30 detik
    const turn = a.state().game!.turn;
    const mover = turn === a.state().you.seat ? a : b;
    const mv = mover.state().game!.yourMoves[0]!;
    const before = states(w).length;
    send(h, mover, mv.type === "play" ? { type: "play", card: mv.card, end: mv.end } : { type: "pass" });
    expect(states(w)).toHaveLength(before);
    h.clock.advance(29_000);
    expect(states(w)).toHaveLength(before);
    h.clock.advance(1_000);
    expect(states(w).length).toBeGreaterThan(before);
    // tidak ada kartu pemain di pesan penonton
    expect(JSON.stringify(w.msgs.filter((m) => m.type === "state"))).not.toMatch(/"yourHand":\[\[/);
  });

  it("penonton yang bergabung belakangan menerima bingkai yang sudah melewati penundaan", () => {
    const { h, a } = setup();
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    h.clock.advance(31_000);
    const w = watcher();
    send(h, w, { type: "watch", key: keyOf(h) });
    expect(w.msgs.find((m) => m.type === "watching")).toMatchObject({ hasFrame: true });
    expect(states(w)).toHaveLength(1);
  });

  it("chat penonton hanya ke sesama penonton (tidak ke pemain), dibatasi lajunya", () => {
    const { h, a, b } = setup();
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    const w1 = watcher("Citra");
    const w2 = watcher("Dewi");
    send(h, w1, { type: "watch", key: keyOf(h) });
    send(h, w2, { type: "watch", key: keyOf(h) });
    send(h, w1, { type: "watch_chat", text: "seru!" });
    expect(w2.msgs.some((m) => m.type === "watch_chat" && m.text === "seru!" && m.name === "Citra")).toBe(true);
    expect([a, b].some((c) => c.msgs.some((m) => m.type === "watch_chat"))).toBe(false);
    send(h, w1, { type: "watch_chat", text: "lagi" });
    expect(w1.lastError()?.code).toBe("RATE_LIMIT");
    h.clock.advance(1100);
    send(h, w1, { type: "watch_chat", text: "lagi" });
    expect(w2.msgs.filter((m) => m.type === "watch_chat")).toHaveLength(2);
    const outsider = watcher("Eko");
    send(h, outsider, { type: "watch_chat", text: "halo" });
    expect(outsider.lastError()?.code).toBe("NOT_WATCHING");
  });

  it("jumlah penonton tampil ke pemain; keluar, putus, dan siaran dimatikan membersihkan penonton", () => {
    const { h, a } = setup();
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    const w1 = watcher("Citra");
    const w2 = watcher("Dewi");
    send(h, w1, { type: "watch", key: keyOf(h) });
    send(h, w2, { type: "watch", key: keyOf(h) });
    expect(h.svc.liveList()[0]!.spectators).toBe(2);
    send(h, a, { type: "set_watch", on: true }); // broadcast ulang
    expect(a.state().room.spectators).toBe(2);
    send(h, w1, { type: "unwatch" });
    expect(w1.msgs.at(-1)).toEqual({ type: "watch_end", reason: "left" });
    h.svc.onDisconnect(w2);
    expect(h.svc.liveList()[0]!.spectators).toBe(0);
    const w3 = watcher("Eko");
    send(h, w3, { type: "watch", key: keyOf(h) });
    send(h, a, { type: "set_watch", on: false });
    expect(w3.msgs.at(-1)).toEqual({ type: "watch_end", reason: "off" });
    expect(h.svc.liveList()).toEqual([]);
    const w4 = watcher("Fani");
    send(h, w4, { type: "watch", key: "ffffffffff" });
    expect(w4.lastError()?.code).toBe("NOT_FOUND");
  });

  it("batas penonton per room", () => {
    const h = harness({ liveMaxSpectators: 2 });
    const a = new FakeConn();
    const b = new FakeConn();
    send(h, a, { type: "create_room", name: "Andi", token: tok(1), game: "ludo" });
    send(h, b, { type: "join", groupId: a.state().room.groupId, name: "Budi", token: tok(2) });
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    const ws = [watcher("A1"), watcher("A2"), watcher("A3")];
    for (const w of ws) send(h, w, { type: "watch", key: keyOf(h) });
    expect(ws[2]!.lastError()?.code).toBe("WATCH_FULL");
  });

  it("Ludo: penonton melihat papan yang sama (publik) dengan tertunda", () => {
    const { h, a } = setup("ludo");
    send(h, a, { type: "set_watch", on: true });
    send(h, a, { type: "start" });
    h.clock.advance(31_000);
    const w = watcher();
    send(h, w, { type: "watch", key: keyOf(h) });
    const s = states(w).at(-1)!;
    expect(s.game?.kind).toBe("ludo");
    expect(s.game?.ludo?.players.length).toBe(2);
  });
});
