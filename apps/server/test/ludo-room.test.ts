import { describe, expect, it } from "vitest";
import { createRng, ludo } from "@gmers/game-engine";
import { MemoryEventSink } from "../src/events";
import type { ClientMessage, GameView, StateMessage } from "../src/protocol";
import { RoomService } from "../src/service";
import { MemoryRoomLog } from "../src/store";
import { FakeClock, FakeConn, assertStateShape, testConfig, tok } from "./support";
import type { ServerConfig } from "../src/config";

function harness(over: Partial<ServerConfig> = {}, seeds?: () => string) {
  const clock = new FakeClock();
  const log = new MemoryRoomLog();
  const events = new MemoryEventSink();
  const cfg = testConfig(over);
  let n = 0;
  const svc = new RoomService(cfg, { clock, log, events, newGroupId: () => `LUDO${n++}`.padEnd(6, "X"), newSeed: seeds ?? (() => "seed-ludo") });
  svc.start();
  return { svc, clock, log, events, cfg };
}
type H = ReturnType<typeof harness>;

function table(h: H, n: number, game: "gaple" | "ludo" = "ludo", start = true) {
  const conns = Array.from({ length: n }, () => new FakeConn());
  h.svc.handle(conns[0]!, { type: "create_room", name: "P0", token: tok(0), game });
  const groupId = conns[0]!.state().room.groupId;
  for (let i = 1; i < n; i++) h.svc.handle(conns[i]!, { type: "join", groupId, name: `P${i}`, token: tok(i) });
  if (start) h.svc.handle(conns[0]!, { type: "start" });
  return { conns, groupId };
}
const room = (h: H, id: string) => h.svc.rooms.get(id)!;
const gv = (c: FakeConn): GameView => c.state().game!;
const send = (h: H, c: FakeConn, m: ClientMessage): void => h.svc.handle(c, m);

/** Satu langkah acak dari yourMoves milik pemain yang sedang giliran. */
function playOne(h: H, conns: FakeConn[], groupId: string, pick: () => number): void {
  const r = room(h, groupId);
  const seat = r.game!.roomSeats[r.game!.adapter.turn(r.game!.state)]!;
  const v = gv(conns[seat]!);
  const mv = v.yourMoves[Math.floor(pick() * v.yourMoves.length)]!;
  send(h, conns[seat]!, mv.type === "roll" ? { type: "roll" } : { type: "pick", pawn: (mv as { pawn: number }).pawn });
}

describe("room Ludo", () => {
  it("room dibuat dengan game Ludo; tampilan memuat posisi bidak dan dadu; semua pemain melihat papan yang sama", () => {
    const h = harness();
    const { conns, groupId } = table(h, 3);
    expect(room(h, groupId).gameId).toBe("ludo");
    const v0 = gv(conns[0]!);
    expect(v0.kind).toBe("ludo");
    expect(v0.ludo?.players).toEqual([
      { seat: 0, start: 0, pawns: [-1, -1, -1, -1] },
      { seat: 1, start: 13, pawns: [-1, -1, -1, -1] },
      { seat: 2, start: 26, pawns: [-1, -1, -1, -1] },
    ]);
    expect(v0.yourMoves).toEqual([{ type: "roll" }]);
    expect(gv(conns[1]!).yourMoves).toEqual([]);
    expect(gv(conns[1]!).ludo).toEqual(v0.ludo);
    conns.forEach((c) => assertStateShape(c.state()));
    expect(c0Seats(conns[0]!)).toEqual([4, 4, 4]);
  });

  it("server melempar dadu (klien tidak bisa menentukan angka); langkah dan lemparan di luar giliran ditolak tanpa mengubah state", () => {
    const h = harness();
    const { conns, groupId } = table(h, 2);
    const before = JSON.stringify(room(h, groupId).game!.state);
    send(h, conns[1]!, { type: "roll" });
    expect(conns[1]!.lastError()?.code).toBe("NOT_YOUR_TURN");
    send(h, conns[0]!, { type: "pick", pawn: 0 });
    expect(conns[0]!.lastError()?.code).toBe("MUST_ROLL");
    send(h, conns[0]!, { type: "play", card: [6, 6], end: "left" });
    expect(conns[0]!.lastError()?.code).toBe("WRONG_GAME");
    send(h, conns[0]!, { type: "pass" });
    expect(conns[0]!.lastError()?.code).toBe("WRONG_GAME");
    expect(JSON.stringify(room(h, groupId).game!.state)).toBe(before);
    send(h, conns[0]!, { type: "roll" });
    expect(gv(conns[0]!).ludo?.lastRoll?.value).toBe(ludo.diceValue("seed-ludo", 0));
    send(h, conns[0]!, { type: "roll" });
    expect(conns[0]!.lastError()?.code).toMatch(/MUST_MOVE|NOT_YOUR_TURN/);
  });

  it("game penuh 2, 3, dan 4 pemain sampai selesai; peringkat lengkap; hasil sama di semua pemain; peristiwa membawa game=ludo", () => {
    for (const n of [2, 3, 4]) {
      const h = harness({}, () => `penuh-${n}`);
      const { conns, groupId } = table(h, n);
      const pick = createRng(`bot-${n}`);
      for (let i = 0; i < 6000 && room(h, groupId).phase === "playing"; i++) playOne(h, conns, groupId, pick);
      expect(room(h, groupId).phase).toBe("finished");
      const results = conns.map((c) => gv(c).result);
      expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
      expect(results[0]!.reason).toBe("home");
      expect(results[0]!.ranking.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, k) => k + 1));
      const fin = h.events.events.find((e) => e.event === "game_finished")!;
      expect(fin.detail).toMatch(new RegExp(`^reason=home;players=${n};ranking=[\\d>]+;devices=[0-9a-f|]+;game=ludo$`));
      expect(h.events.events.find((e) => e.event === "game_started")!.detail).toContain("game=ludo");
    }
  });

  it("privasi: pesan tidak memuat seed atau state mentah; hanya posisi publik dan langkah sah milik penerima", () => {
    const h = harness();
    const { conns } = table(h, 3);
    for (const c of conns) {
      const text = JSON.stringify(c.state());
      expect(text).not.toContain("seed-ludo");
      expect(text).not.toMatch(/"log"|"seed"|"rolls"|"hands"/);
    }
  });

  it("waktu giliran habis: dadu dilempar otomatis, lalu bidak dipilih otomatis; game tetap berjalan sampai selesai", () => {
    const h = harness({ turnTimeoutMs: 1000 }, () => "timer-ludo");
    const { conns, groupId } = table(h, 2);
    h.clock.advance(1000);
    expect(gv(conns[0]!).moveCount).toBe(1);
    expect(h.log.readAll().some((r) => r.t === "move" && r.auto)).toBe(true);
    for (let i = 0; i < 6000 && room(h, groupId).phase === "playing"; i++) h.clock.advance(1000);
    expect(room(h, groupId).phase).toBe("finished");
  });

  it("restart: room Ludo dibangun ulang dari log (game, seed, langkah) dan dilanjutkan", () => {
    const h = harness({ turnTimeoutMs: 60_000 });
    const { conns, groupId } = table(h, 3);
    const pick = createRng("sebagian");
    for (let i = 0; i < 40; i++) playOne(h, conns, groupId, pick);
    const before = JSON.stringify(room(h, groupId).game!.state);
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log, events: new MemoryEventSink(), newSeed: () => "x" });
    svc2.start();
    const r2 = svc2.rooms.get(groupId)!;
    expect(r2.gameId).toBe("ludo");
    expect(JSON.stringify(r2.game!.state)).toBe(before);
    const again = [0, 1, 2].map(() => new FakeConn());
    again.forEach((c, i) => svc2.handle(c, { type: "join", groupId, name: "x", token: tok(i) }));
    const turnSeat = r2.game!.roomSeats[r2.game!.adapter.turn(r2.game!.state)]!;
    expect(again[turnSeat]!.state().game!.yourMoves.length).toBeGreaterThan(0);
    for (let i = 0; i < 6000 && r2.phase === "playing"; i++) h.clock.advance(60_000);
    expect(r2.phase).toBe("finished");
  });

  it("log lama tanpa field game dibaca sebagai Gaple (kompatibel dengan data yang sudah ada)", () => {
    const h = harness({}, () => "lama");
    const { groupId } = table(h, 2, "gaple");
    const recs = h.log.readAll().map((r) => (r.t === "start" ? { ...r, game: undefined } : r));
    h.log.rewrite(recs.filter((r) => r.t !== "setgame"));
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log });
    svc2.start();
    expect(svc2.rooms.get(groupId)!.gameId).toBe("gaple");
    expect(svc2.rooms.get(groupId)!.game!.adapter.id).toBe("gaple");
  });
});

describe("memilih game", () => {
  it("hanya pembuat room yang bisa memilih game; tidak saat bermain; pilihan tersimpan dan dipakai saat mulai dan rematch", () => {
    const h = harness({ turnTimeoutMs: 1000 });
    const { conns, groupId } = table(h, 2, "gaple", false);
    expect(room(h, groupId).gameId).toBe("gaple");
    send(h, conns[1]!, { type: "set_game", game: "ludo" });
    expect(conns[1]!.lastError()?.code).toBe("NOT_HOST");
    send(h, conns[0]!, { type: "set_game", game: "ludo" });
    expect(conns[0]!.state().room.gameId).toBe("ludo");
    send(h, conns[0]!, { type: "start" });
    expect(gv(conns[1]!).kind).toBe("ludo");
    send(h, conns[0]!, { type: "set_game", game: "gaple" });
    expect(conns[0]!.lastError()?.code).toBe("WRONG_PHASE");
    for (let i = 0; i < 8000 && room(h, groupId).phase === "playing"; i++) h.clock.advance(1000);
    send(h, conns[1]!, { type: "rematch" });
    expect(gv(conns[0]!).kind).toBe("ludo"); // rematch memakai game yang sama
    for (let i = 0; i < 8000 && room(h, groupId).phase === "playing"; i++) h.clock.advance(1000);
    // pindah game setelah selesai: kembali ke ruang tunggu
    send(h, conns[0]!, { type: "set_game", game: "gaple" });
    expect(conns[0]!.state().room.phase).toBe("lobby");
    expect(conns[0]!.state().room.gameId).toBe("gaple");
    expect(conns[0]!.state().game).toBeNull();
    send(h, conns[0]!, { type: "start" });
    expect(gv(conns[0]!).kind).toBe("gaple");
    expect(gv(conns[0]!).yourHand).toHaveLength(7);
  });

  it("pilihan game bertahan setelah restart di lobi", () => {
    const h = harness();
    const { conns, groupId } = table(h, 2, "gaple", false);
    send(h, conns[0]!, { type: "set_game", game: "ludo" });
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log });
    svc2.start();
    expect(svc2.rooms.get(groupId)!.gameId).toBe("ludo");
  });

  it("game tidak dikenal ditolak di batas protokol", () => {
    const h = harness();
    const { conns } = table(h, 2, "gaple", false);
    expect(() => send(h, conns[0]!, { type: "set_game", game: "remi" as unknown as "ludo" })).not.toThrow();
    expect(conns[0]!.lastError()?.code).toBe("BAD_GAME");
  });
});

function c0Seats(c: FakeConn): number[] {
  return (c.state() as StateMessage).room.seats.flatMap((s) => (s ? [s.cardsLeft ?? -1] : []));
}
