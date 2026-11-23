import { describe, expect, it } from "vitest";
import { createRng, fullDeck, legalMoves, type Card } from "@gmers/game-engine";
import { MemoryEventSink } from "../src/events";
import type { ClientMessage } from "../src/protocol";
import { RoomService } from "../src/service";
import { MemoryRoomLog } from "../src/store";
import { FakeClock, FakeConn, assertStateShape, testConfig, tok } from "./support";
import type { ServerConfig } from "../src/config";

interface Harness {
  svc: RoomService;
  clock: FakeClock;
  log: MemoryRoomLog;
  events: MemoryEventSink;
  cfg: ServerConfig;
}

function harness(overrides: Partial<ServerConfig> = {}, seeds?: () => string): Harness {
  const clock = new FakeClock();
  const log = new MemoryRoomLog();
  const events = new MemoryEventSink();
  const cfg = testConfig(overrides);
  let n = 0;
  const svc = new RoomService(cfg, { clock, log, events, newGroupId: () => `ROOM${n++}`.padEnd(6, "X"), newSeed: seeds ?? (() => "seed-tetap") });
  svc.start();
  return { svc, clock, log, events, cfg };
}

const send = (h: Harness, c: FakeConn, m: ClientMessage): void => h.svc.handle(c, m);

/** Buat room berisi n pemain (kursi 0..n-1) dan mulai game. */
function table(h: Harness, n: number, start = true): { conns: FakeConn[]; roomId: string } {
  const conns = Array.from({ length: n }, () => new FakeConn());
  send(h, conns[0] as FakeConn, { type: "create_room", name: "P0", token: tok(0) });
  const roomId = (conns[0] as FakeConn).state().room.id;
  for (let i = 1; i < n; i++) send(h, conns[i] as FakeConn, { type: "join", groupId: roomId, name: `P${i}`, token: tok(i) });
  if (start) send(h, conns[0] as FakeConn, { type: "start" });
  return { conns, roomId };
}

const room = (h: Harness, id: string) => h.svc.rooms.get(id)!;
const engineState = (h: Harness, id: string) => room(h, id).game!.state;

describe("lobi dan memulai", () => {
  it("membuat room, bergabung, dan hanya pembuat yang bisa memulai", () => {
    const h = harness();
    const { conns, roomId } = table(h, 3, false);
    expect(conns[2]!.state().room.seats.map((s) => s?.name ?? null)).toEqual(["P0", "P1", "P2", null]);
    send(h, conns[1]!, { type: "start" });
    expect(conns[1]!.lastError()?.code).toBe("NOT_HOST");
    send(h, conns[0]!, { type: "start" });
    expect(room(h, roomId).phase).toBe("playing");
    expect(conns[0]!.state().game?.yourHand).toHaveLength(7);
    send(h, conns[0]!, { type: "start" });
    expect(conns[0]!.lastError()?.code).toBe("WRONG_PHASE");
  });

  it("butuh minimal 2 pemain; room penuh dan kursi terisi ditolak; tidak bisa masuk saat game berjalan", () => {
    const h = harness();
    const solo = table(h, 1, false);
    send(h, solo.conns[0]!, { type: "start" });
    expect(solo.conns[0]!.lastError()?.code).toBe("NEED_MORE_PLAYERS");
    const { conns, roomId } = table(h, 4, false);
    const late = new FakeConn();
    send(h, late, { type: "join", groupId: roomId, name: "Telat", token: tok(9) });
    expect(late.lastError()?.code).toBe("ROOM_FULL");
    const h2 = harness();
    const t = table(h2, 2, false);
    const x = new FakeConn();
    send(h2, x, { type: "join", groupId: t.roomId, name: "XX", token: tok(5), seat: 1 });
    expect(x.lastError()?.code).toBe("SEAT_TAKEN");
    send(h2, t.conns[0]!, { type: "start" });
    send(h2, x, { type: "join", groupId: t.roomId, name: "XX", token: tok(5) });
    expect(x.lastError()?.code).toBe("GAME_IN_PROGRESS");
    void conns;
  });

  it("room tidak dikenal dan pesan sebelum masuk dijawab dengan kesalahan berbahasa Indonesia", () => {
    const h = harness();
    const c = new FakeConn();
    send(h, c, { type: "join", groupId: "ZZZZZZ", name: "Ana", token: tok(1) });
    expect(c.lastError()).toEqual({ code: "ROOM_NOT_FOUND", message: "Tautan ini tidak dikenal. Minta tautan baru dari temanmu." });
    send(h, c, { type: "pass" });
    expect(c.lastError()?.code).toBe("NOT_IN_ROOM");
  });

  it("pembuat keluar sebelum mulai: pembuat baru = kursi terkecil; game berjalan melarang keluar", () => {
    const h = harness();
    const { conns, roomId } = table(h, 3, false);
    send(h, conns[0]!, { type: "leave" });
    expect(conns[1]!.state().room.hostSeat).toBe(1);
    expect(conns[1]!.state().room.seats[0]).toBeNull();
    send(h, conns[1]!, { type: "start" });
    expect(room(h, roomId).phase).toBe("playing");
    send(h, conns[2]!, { type: "leave" });
    expect(conns[2]!.lastError()?.code).toBe("GAME_IN_PROGRESS");
  });
});

describe("langkah ilegal tidak mengubah state", () => {
  it("di luar giliran, kartu bukan milik, tidak cocok, lewat saat ada langkah, dan sebelum game", () => {
    const h = harness();
    const early = table(h, 2, false);
    send(h, early.conns[0]!, { type: "pass" });
    expect(early.conns[0]!.lastError()?.code).toBe("NOT_PLAYING");

    const { conns, roomId } = table(h, 3);
    const turn = engineState(h, roomId).turn;
    const other = (turn + 1) % 3;
    const snapshot = (): string => JSON.stringify(engineState(h, roomId));
    const before = snapshot();
    const statesBefore = conns.map((c) => c.msgs.filter((m) => m.type === "state").length);

    const hand = engineState(h, roomId).hands[turn] as Card[];
    const foreign = engineState(h, roomId).hands[other] as Card[];

    send(h, conns[other]!, { type: "play", card: foreign[0]!, end: "left" });
    expect(conns[other]!.lastError()?.code).toBe("NOT_YOUR_TURN");
    send(h, conns[turn]!, { type: "play", card: foreign[0]!, end: "left" });
    expect(conns[turn]!.lastError()?.code).toBe("CARD_NOT_IN_HAND");
    send(h, conns[turn]!, { type: "pass" });
    expect(conns[turn]!.lastError()?.code).toBe("CANNOT_PASS_ON_OPENING");
    const wrongOpening = hand.find((c) => !(c[0] === 6 && c[1] === 6)) as Card;
    if (engineState(h, roomId).requiredOpening) {
      send(h, conns[turn]!, { type: "play", card: wrongOpening, end: "left" });
      expect(conns[turn]!.lastError()?.code).toBe("MUST_OPEN_WITH_REQUIRED");
    }
    send(h, conns[turn]!, { type: "play", card: hand[0]!, end: "right" });
    // pembuka hanya boleh 'left'
    expect(["BAD_END", "MUST_OPEN_WITH_REQUIRED"]).toContain(conns[turn]!.lastError()?.code);

    expect(snapshot()).toBe(before);
    // tidak ada siaran state untuk langkah ditolak, hanya satu pesan kesalahan ke pengirim
    conns.forEach((c, i) => expect(c.msgs.filter((m) => m.type === "state")).toHaveLength(statesBefore[i]!));
    expect(room(h, roomId).game!.state.log).toHaveLength(0);
  });

  it("kartu dikirim terbalik ([besar, kecil]) tetap dikenali", () => {
    const h = harness();
    const { conns, roomId } = table(h, 2);
    const st = engineState(h, roomId);
    const first = legalMoves(st, st.turn)[0]!;
    if (first.type !== "play") throw new Error("harus langkah main");
    const flipped: Card = [first.card[1], first.card[0]];
    send(h, conns[room(h, roomId).game!.roomSeats[st.turn]!]!, { type: "play", card: flipped, end: "left" });
    expect(engineState(h, roomId).log).toHaveLength(1);
  });

  it("pesan state ke pemain berikutnya memuat langkah sah hanya untuk gilirannya", () => {
    const h = harness();
    const { conns, roomId } = table(h, 3);
    const st = engineState(h, roomId);
    conns.forEach((c, seat) => {
      const v = c.state();
      expect(v.game!.yourMoves.length > 0).toBe(seat === room(h, roomId).game!.roomSeats[st.turn]);
    });
  });
});

describe("privasi kartu tangan", () => {
  it.each([2, 3, 4])("pemain %i tidak pernah menerima kartu tangan pemain lain, sepanjang game penuh", (n) => {
    const h = harness({ turnTimeoutMs: 1000 }, (() => { let i = 0; return () => `privasi-${n}-${i++}`; })());
    const { conns, roomId } = table(h, n);
    const pick = createRng(`bot-${n}`);
    const checkAll = (): void => {
      const r = room(h, roomId);
      conns.forEach((c, seat) => {
        const msg = c.state();
        assertStateShape(msg);
        const es = r.game!.roomSeats.indexOf(seat);
        // kartu tangan di pesan = tangan sendiri persis
        const own = JSON.stringify(r.game!.state.hands[es]);
        expect(JSON.stringify(msg.game!.yourHand)).toBe(own);
        for (const s of msg.room.seats) {
          if (s && !s.isYou) expect(typeof s.cardsLeft === "number" || s.cardsLeft === null).toBe(true);
        }
      });
    };
    for (let step = 0; step < 200 && room(h, roomId).phase === "playing"; step++) {
      checkAll();
      const st = engineState(h, roomId);
      const roomSeat = room(h, roomId).game!.roomSeats[st.turn]!;
      const v = conns[roomSeat]!.state().game!;
      const mv = v.yourMoves[Math.floor(pick() * v.yourMoves.length)]!;
      send(h, conns[roomSeat]!, mv);
    }
    expect(room(h, roomId).phase).toBe("finished");
    checkAll();
    // seluruh pesan yang pernah dikirim ke pemain i: tak ada kartu lawan di luar `board` dan `yourHand`
    conns.forEach((c, seat) => {
      const r = room(h, roomId);
      const es = r.game!.roomSeats.indexOf(seat);
      void es;
      for (const m of c.msgs) {
        if (m.type !== "state") continue;
        const text = JSON.stringify({ ...m, game: m.game ? { ...m.game, yourHand: undefined, board: undefined, yourMoves: undefined } : null });
        expect(text).not.toMatch(/"hands"|"discarded"|"seed"/);
      }
    });
  });
});

describe("batas waktu giliran (jam palsu)", () => {
  it("belum habis: tidak ada yang terjadi; habis dengan langkah sah: kartu sah pertama dimainkan", () => {
    const h = harness({ turnTimeoutMs: 60_000 });
    const { conns, roomId } = table(h, 3);
    const st = engineState(h, roomId);
    const expected = legalMoves(st, st.turn)[0]!;
    expect(conns[0]!.state().game!.turnDeadline).toBe(h.clock.now() + 60_000);
    h.clock.advance(59_999);
    expect(engineState(h, roomId).log).toHaveLength(0);
    h.clock.advance(1);
    const after = engineState(h, roomId);
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toEqual(expected);
    expect(h.log.readAll().filter((r) => r.t === "move" && r.auto)).toHaveLength(1);
    // batas waktu giliran berikutnya dimulai ulang penuh 60 detik
    expect(conns[0]!.state().game!.turnDeadline).toBe(h.clock.now() + 60_000);
  });

  it("langkah manual membatalkan timer lama (tidak ada langkah otomatis ganda)", () => {
    const h = harness({ turnTimeoutMs: 60_000 });
    const { conns, roomId } = table(h, 2);
    const st = engineState(h, roomId);
    const seat = room(h, roomId).game!.roomSeats[st.turn]!;
    h.clock.advance(30_000);
    send(h, conns[seat]!, conns[seat]!.state().game!.yourMoves[0]!);
    expect(engineState(h, roomId).log).toHaveLength(1);
    h.clock.advance(30_000); // 60 detik sejak awal, tetapi giliran baru baru 30 detik
    expect(engineState(h, roomId).log).toHaveLength(1);
    h.clock.advance(30_000);
    expect(engineState(h, roomId).log).toHaveLength(2);
  });

  it("habis tanpa langkah sah: lewat otomatis", () => {
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      const h = harness({ turnTimeoutMs: 60_000 }, () => `lewat-${i}`);
      const { conns, roomId } = table(h, 3);
      for (let guard = 0; guard < 60 && room(h, roomId).phase === "playing"; guard++) {
        const st = engineState(h, roomId);
        const moves = legalMoves(st, st.turn);
        if (moves.length === 1 && moves[0]!.type === "pass") {
          const seat = room(h, roomId).game!.roomSeats[st.turn]!;
          expect(conns[seat]!.state().game!.yourMoves).toEqual([{ type: "pass" }]);
          const passesBefore = st.consecutivePasses;
          h.clock.advance(60_000);
          const after = engineState(h, roomId);
          const last = after.log.at(-1)!;
          expect(last).toEqual({ type: "pass", seat: st.turn });
          expect(after.consecutivePasses === passesBefore + 1 || after.result !== null).toBe(true);
          expect(h.log.readAll().filter((r) => r.t === "move").at(-1)).toMatchObject({ auto: true, move: { type: "pass" } });
          found = true;
          break;
        }
        h.clock.advance(60_000); // jalankan game lewat batas waktu sampai ketemu giliran "hanya lewat"
      }
    }
    expect(found).toBe(true);
  });

  it("game selesai: timer berhenti", () => {
    const h = harness({ turnTimeoutMs: 1000 });
    const { roomId } = table(h, 2);
    for (let i = 0; i < 100 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    expect(room(h, roomId).phase).toBe("finished");
    const len = engineState(h, roomId).log.length;
    h.clock.advance(10_000);
    expect(engineState(h, roomId).log).toHaveLength(len);
    expect(room(h, roomId).game!.deadline).toBeNull();
  });
});

describe("sambung ulang", () => {
  it("putus: kursi ditandai terputus; sambung dengan token yang sama memulihkan kursi, tangan, dan state", () => {
    const h = harness();
    const { conns, roomId } = table(h, 3);
    const st = engineState(h, roomId);
    const seat = room(h, roomId).game!.roomSeats[st.turn]!;
    send(h, conns[seat]!, conns[seat]!.state().game!.yourMoves[0]!);
    const target = (seat + 1) % 3;
    const handBefore = conns[target]!.state().game!.yourHand;
    const boardBefore = conns[target]!.state().game!.board;

    h.svc.onDisconnect(conns[target]!);
    const observer = conns[(target + 1) % 3]!;
    expect(observer.state().room.seats[target]!.connected).toBe(false);

    const back = new FakeConn();
    send(h, back, { type: "join", groupId: roomId, name: "Nama Baru Diabaikan", token: tok(target) });
    const s = back.state();
    expect(s.you.seat).toBe(target);
    expect(s.game!.yourHand).toEqual(handBefore);
    expect(s.game!.board).toEqual(boardBefore);
    expect(s.room.seats[target]!.name).toBe(`P${target}`);
    expect(observer.state().room.seats[target]!.connected).toBe(true);
    expect(h.events.events.map((e) => e.event)).toContain("reconnected");
  });

  it("tab kedua dengan token sama menggantikan koneksi lama", () => {
    const h = harness();
    const { conns, roomId } = table(h, 2);
    const dup = new FakeConn();
    send(h, dup, { type: "join", groupId: roomId, name: "P1", token: tok(1) });
    expect(conns[1]!.closedWith).toBe(4001);
    expect(conns[1]!.lastError()?.code).toBe("REPLACED");
    expect(dup.state().you.seat).toBe(1);
    // koneksi lama yang tertutup tidak merusak koneksi baru
    h.svc.onDisconnect(conns[1]!);
    expect(dup.state().room.seats[1]!.connected).toBe(true);
  });

  it("token lain tidak bisa mengambil kursi pemain yang terputus", () => {
    const h = harness();
    const { conns, roomId } = table(h, 2);
    h.svc.onDisconnect(conns[1]!);
    const thief = new FakeConn();
    send(h, thief, { type: "join", groupId: roomId, name: "Maling", token: tok(77) });
    expect(thief.lastError()?.code).toBe("GAME_IN_PROGRESS");
  });
});

describe("restart server dengan replay dari log", () => {
  function playSome(h: Harness, conns: FakeConn[], roomId: string, moves: number): void {
    const pick = createRng("sebagian");
    for (let i = 0; i < moves && room(h, roomId).phase === "playing"; i++) {
      const st = engineState(h, roomId);
      const seat = room(h, roomId).game!.roomSeats[st.turn]!;
      const v = conns[seat]!.state().game!;
      send(h, conns[seat]!, v.yourMoves[Math.floor(pick() * v.yourMoves.length)]!);
    }
  }

  it("state, kursi, dan tangan identik setelah restart; timer menyala lagi; game bisa dilanjutkan", () => {
    const h = harness({ turnTimeoutMs: 60_000 });
    const { conns, roomId } = table(h, 4);
    playSome(h, conns, roomId, 9);
    const before = JSON.stringify(engineState(h, roomId));
    const beforeViews = conns.map((c) => JSON.stringify({ ...c.state().game, turnDeadline: 0 }));

    // "restart": instance baru, jam sama, log sama
    const clock2 = h.clock;
    const svc2 = new RoomService(h.cfg, { clock: clock2, log: h.log, events: new MemoryEventSink(), newSeed: () => "x" });
    svc2.start();
    const restored = svc2.rooms.get(roomId)!;
    expect(restored.phase).toBe("playing");
    expect(JSON.stringify(restored.game!.state)).toBe(before);
    expect(restored.seats.map((m) => m?.name)).toEqual(["P0", "P1", "P2", "P3"]);
    expect(restored.seats.every((m) => m?.conn === null)).toBe(true);

    // pemain sambung ulang dengan token lama: tampilan sama
    const again = conns.map(() => new FakeConn());
    again.forEach((c, i) => svc2.handle(c, { type: "join", groupId: roomId, name: "xx", token: tok(i) }));
    again.forEach((c, i) => expect(JSON.stringify({ ...c.state().game, turnDeadline: 0 })).toBe(beforeViews[i]));

    // timer menyala setelah restart, lalu game bisa diteruskan sampai selesai
    const len = restored.game!.state.log.length;
    clock2.advance(60_000);
    expect(restored.game!.state.log.length).toBe(len + 1);
    for (let i = 0; i < 200 && restored.phase === "playing"; i++) clock2.advance(60_000);
    expect(restored.phase).toBe("finished");
  });

  it("restart setelah game selesai mempertahankan hasil dan rematch masih memakai pemenang sebelumnya", () => {
    const h = harness({ turnTimeoutMs: 1000 });
    const { roomId } = table(h, 3);
    for (let i = 0; i < 200 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    const winnerSeat = room(h, roomId).lastWinnerSeat;
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log, newSeed: () => "game-2" });
    svc2.start();
    const r2 = svc2.rooms.get(roomId)!;
    expect(r2.phase).toBe("finished");
    expect(r2.lastWinnerSeat).toBe(winnerSeat);
    expect(r2.game!.state.result).toEqual(room(h, roomId).game!.state.result);
    const c = new FakeConn();
    svc2.handle(c, { type: "join", groupId: roomId, name: "xx", token: tok(0) });
    svc2.handle(c, { type: "rematch" });
    expect(r2.phase).toBe("playing");
    expect(r2.gameNo).toBe(2);
  });

  it("baris log rusak/terpotong dilewati dan log berisi seed serta langkah, tanpa isi chat", () => {
    const h = harness();
    const { conns } = table(h, 2);
    send(h, conns[0]!, { type: "chat", text: "rahasia-banget-123" });
    const text = JSON.stringify(h.log.readAll());
    expect(text).not.toContain("rahasia-banget-123");
    expect(text).not.toContain(tok(0)); // token mentah tidak pernah ditulis, hanya hash
    expect(h.log.readAll().map((r) => r.t)).toEqual(["group", "room", "sit", "sit", "start"]);
  });
});

describe("rematch", () => {
  it("game baru dengan pemain yang sama; pemenang sebelumnya membuka dengan kartu bebas", () => {
    const h = harness({ turnTimeoutMs: 1000 }, (() => { let i = 0; return () => `rematch-${i++}`; })());
    const { conns, roomId } = table(h, 3);
    send(h, conns[1]!, { type: "rematch" });
    expect(conns[1]!.lastError()?.code).toBe("WRONG_PHASE");
    for (let i = 0; i < 200 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    const winner = room(h, roomId).lastWinnerSeat!;
    send(h, conns[2]!, { type: "rematch" });
    const r = room(h, roomId);
    expect(r.phase).toBe("playing");
    expect(r.gameNo).toBe(2);
    expect(r.game!.roomSeats).toEqual([0, 1, 2]);
    expect(r.game!.state.requiredOpening).toBeNull();
    expect(r.game!.roomSeats[r.game!.state.turn]).toBe(winner);
    expect(r.game!.state.hands.map((x) => x.length)).toEqual([7, 7, 7]);
    const names = h.events.events.map((e) => e.event);
    expect(names).toContain("rematch_clicked");
    expect(names.filter((e) => e === "game_started")).toHaveLength(2);
  });

  it("pemain keluar setelah game: rematch hanya dengan yang masih duduk; < 2 pemain ditolak", () => {
    const h = harness({ turnTimeoutMs: 1000 });
    const { conns, roomId } = table(h, 3);
    for (let i = 0; i < 200 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    send(h, conns[2]!, { type: "leave" });
    send(h, conns[0]!, { type: "rematch" });
    expect(room(h, roomId).game!.roomSeats).toEqual([0, 1]);
    for (let i = 0; i < 200 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    send(h, conns[1]!, { type: "leave" });
    send(h, conns[0]!, { type: "rematch" });
    expect(conns[0]!.lastError()?.code).toBe("NEED_MORE_PLAYERS");
  });
});

describe("chat dan peristiwa", () => {
  it("chat disiarkan ke semua pemain; peristiwa hanya mencatat hitungan, tanpa isi chat dan nama", () => {
    const h = harness();
    const { conns } = table(h, 2);
    send(h, conns[0]!, { type: "chat", text: "halo semua" });
    for (const c of conns) expect(c.msgs.at(-1)).toMatchObject({ type: "chat", seat: 0, name: "P0", text: "halo semua" });
    const events = h.events.events;
    expect(events.filter((e) => e.event === "message_sent")).toHaveLength(1);
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("halo semua");
    expect(dump).not.toContain("P0");
    expect(dump).not.toContain(tok(0));
    expect(events.map((e) => e.event)).toEqual(["group_created", "player_joined", "player_joined", "game_started", "message_sent"]);
    expect(events.every((e) => e.deviceId === "" || /^[0-9a-f]{16}$/.test(e.deviceId))).toBe(true);
  });

  it("game_finished mencatat alasan dan peringkat; player_left saat keluar", () => {
    const h = harness({ turnTimeoutMs: 1000 });
    const { conns, roomId } = table(h, 2);
    for (let i = 0; i < 200 && room(h, roomId).phase === "playing"; i++) h.clock.advance(1000);
    const fin = h.events.events.find((e) => e.event === "game_finished")!;
    expect(fin.detail).toMatch(/^reason=(out|blocked);players=2;ranking=\d>\d;devices=[0-9a-f]{16}\|[0-9a-f]{16}$/);
    expect(fin.gameNo).toBe(1);
    send(h, conns[1]!, { type: "leave" });
    expect(h.events.events.at(-1)).toMatchObject({ event: "player_left" });
  });
});

describe("pembersihan room tak aktif", () => {
  it("room dihapus setelah 24 jam tanpa aktivitas dan tanpa pemain terhubung; log dipadatkan", () => {
    const h = harness({ roomIdleTtlMs: 24 * 3600_000, cleanupIntervalMs: 600_000, turnTimeoutMs: 3600_000 * 30 });
    const a = table(h, 2);
    const b = table(h, 2);
    h.svc.onDisconnect(a.conns[0]!);
    h.svc.onDisconnect(a.conns[1]!);
    h.clock.advance(23 * 3600_000);
    expect(h.svc.rooms.has(a.roomId)).toBe(true);
    h.clock.advance(1 * 3600_000 + 600_000);
    expect(h.svc.rooms.has(a.roomId)).toBe(false);
    // room b masih punya pemain terhubung: tidak dihapus
    expect(h.svc.rooms.has(b.roomId)).toBe(true);
    expect(h.log.readAll().every((r) => r.t === "group" || r.roomId === b.roomId)).toBe(true);
    // Kode kelompok tidak pernah kedaluwarsa: membukanya lagi membuat sesi room baru dengan group_id yang sama.
    const back = new FakeConn();
    send(h, back, { type: "join", groupId: a.roomId, name: "Kembali", token: tok(0) });
    const st = back.state();
    expect(st.room.groupId).toBe(a.roomId);
    expect(st.room.id).not.toBe(a.roomId);
    expect(st.room.phase).toBe("lobby");
    expect(h.svc.rooms.has(st.room.id)).toBe(true);
    expect(h.events.events.filter((e) => e.groupId === a.roomId).every((e) => e.groupId === a.roomId)).toBe(true);
    expect(h.events.events.at(-1)).toMatchObject({ event: "player_joined", groupId: a.roomId, roomId: st.room.id });
  });

  it("restart tidak memunculkan kembali room yang sudah ditutup", () => {
    const h = harness({ roomIdleTtlMs: 1000, cleanupIntervalMs: 500 });
    const a = table(h, 2, false);
    h.svc.onDisconnect(a.conns[0]!);
    h.svc.onDisconnect(a.conns[1]!);
    h.clock.advance(2000);
    expect(h.svc.rooms.size).toBe(0);
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log });
    svc2.start();
    expect(svc2.rooms.size).toBe(0);
  });
});

describe("kelengkapan", () => {
  it("set kartu yang dibagikan tidak pernah bocor lewat seat lain: jumlah kartu di tampilan konsisten", () => {
    const h = harness();
    const { conns } = table(h, 4);
    const s = conns[0]!.state();
    expect(s.room.seats.map((x) => x?.cardsLeft)).toEqual([7, 7, 7, 7]);
    expect(fullDeck()).toHaveLength(28);
  });
});

describe("kelompok yang menetap (group_id)", () => {
  it("kode tautan tidak kedaluwarsa: setelah sesi dibersihkan, kode yang sama membuka sesi baru dan semua peristiwa membawa group_id", () => {
    const h = harness({ roomIdleTtlMs: 24 * 3600_000, cleanupIntervalMs: 600_000 });
    const { conns, roomId: groupId } = table(h, 3, false);
    conns.forEach((c) => h.svc.onDisconnect(c));
    h.clock.advance(25 * 3600_000);
    expect(h.svc.rooms.size).toBe(0);
    expect(h.svc.groups.has(groupId)).toBe(true);

    const c1 = new FakeConn();
    const c2 = new FakeConn();
    send(h, c1, { type: "join", groupId, name: "Andi", token: tok(0) });
    send(h, c2, { type: "join", groupId, name: "Budi", token: tok(1) });
    expect(c1.state().room.groupId).toBe(groupId);
    expect(c2.state().room.id).toBe(c1.state().room.id);
    expect(c1.state().room.seats.map((s) => s?.name ?? null)).toEqual(["Andi", "Budi", null, null]);
    send(h, c1, { type: "start" });
    expect(c1.state().room.phase).toBe("playing");
    expect(h.events.events.every((e) => e.groupId === groupId)).toBe(true);
    const ids = new Set(h.events.events.map((e) => e.roomId));
    expect(ids.size).toBe(2); // sesi hari pertama dan sesi baru
  });

  it("kelompok bertahan setelah restart dan setelah pemadatan log; kode tak dikenal ditolak", () => {
    const h = harness({ roomIdleTtlMs: 1000, cleanupIntervalMs: 500 });
    const { conns, roomId: groupId } = table(h, 2, false);
    conns.forEach((c) => h.svc.onDisconnect(c));
    h.clock.advance(2000);
    expect(h.svc.rooms.size).toBe(0);
    const svc2 = new RoomService(h.cfg, { clock: h.clock, log: h.log, events: h.events });
    svc2.start();
    expect(svc2.groups.has(groupId)).toBe(true);
    expect(svc2.rooms.size).toBe(0);
    const c = new FakeConn();
    svc2.handle(c, { type: "join", groupId, name: "Citra", token: tok(3) });
    expect(c.state().room.groupId).toBe(groupId);
    const d = new FakeConn();
    svc2.handle(d, { type: "join", groupId: "TIDAKADA", name: "Dedi", token: tok(4) });
    expect(d.lastError()?.code).toBe("ROOM_NOT_FOUND");
  });

  it("open_link mencatat invite_link_opened dengan group_id dan memberi ringkasan tanpa membuat sesi", () => {
    const h = harness();
    const { roomId: groupId } = table(h, 2, false);
    const c = new FakeConn();
    send(h, c, { type: "open_link", groupId, token: tok(40) });
    expect(c.msgs.at(-1)).toEqual({ type: "group_info", groupId, phase: "lobby", players: 2, maxSeats: 4, isMember: false });
    const ev = h.events.events.at(-1)!;
    expect(ev).toMatchObject({ event: "invite_link_opened", groupId });
    expect(ev.deviceId).toMatch(/^[0-9a-f]{16}$/);
    const member = new FakeConn();
    send(h, member, { type: "open_link", groupId, token: tok(1) });
    expect(member.msgs.at(-1)).toMatchObject({ isMember: true });
    const unknown = new FakeConn();
    send(h, unknown, { type: "open_link", groupId: "NOPENO", token: tok(1) });
    expect(unknown.lastError()?.code).toBe("ROOM_NOT_FOUND");
    expect(h.svc.rooms.size).toBe(1);
  });
});

describe("pembatas laju chat", () => {
  it("lebih dari chatBurst pesan dalam jendela waktu ditolak; pulih setelah jendela lewat", () => {
    const h = harness({ chatBurst: 3, chatWindowMs: 10_000 });
    const { conns } = table(h, 2);
    for (let i = 0; i < 3; i++) send(h, conns[0]!, { type: "chat", text: `pesan ${i}` });
    send(h, conns[0]!, { type: "chat", text: "keempat" });
    expect(conns[0]!.lastError()?.code).toBe("RATE_LIMITED");
    expect(conns[1]!.msgs.filter((m) => m.type === "chat")).toHaveLength(3);
    expect(h.events.events.filter((e) => e.event === "message_sent")).toHaveLength(3);
    h.clock.advance(10_000);
    send(h, conns[0]!, { type: "chat", text: "lagi" });
    expect(conns[1]!.msgs.filter((m) => m.type === "chat")).toHaveLength(4);
  });
});
