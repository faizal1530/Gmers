import { describe, expect, it } from "vitest";
import { createRng, ludo } from "../src";

const { init, apply, legalMoves, status, replay, fromPawns, diceValue, absCell, startCell, isLudoError, createLudoConfig, autoMove, SAFE_CELLS, FINISH } = ludo;
type S = ludo.LudoState;

const cfg = (o: Partial<ludo.LudoConfig> = {}) => createLudoConfig(o);
const ok = (r: S | { code: string; message: string }): S => {
  if (isLudoError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r as S;
};
/** Cari seed yang menghasilkan angka dadu tertentu pada lemparan ke-n. */
const seedFor = (value: number, n = 0): string => {
  for (let i = 0; i < 5000; i++) if (diceValue(`s${i}`, n) === value) return `s${i}`;
  throw new Error("seed tidak ditemukan");
};
const pawns4 = (over: Record<number, number[]> = {}): number[][] => [0, 1, 2, 3].map((s) => over[s] ?? [-1, -1, -1, -1]);

describe("Ludo: dasar", () => {
  it("awal: semua bidak di kandang, giliran kursi 0, hanya bisa melempar", () => {
    const s = init(cfg(), "x");
    expect(s.pawns).toEqual([[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]);
    expect(s.turn).toBe(0);
    expect(legalMoves(s, 0)).toEqual([{ type: "roll", seat: 0 }]);
    expect(legalMoves(s, 1)).toEqual([]);
  });

  it("openerSeat menentukan yang jalan dulu; jumlah pemain menentukan jumlah kursi", () => {
    expect(init(cfg({ players: 3, openerSeat: 2 }), "x").turn).toBe(2);
    expect(init(cfg({ players: 2 }), "x").pawns).toHaveLength(2);
    expect(() => createLudoConfig({ players: 5 as unknown as 4 })).toThrow();
    expect(() => createLudoConfig({ openerSeat: 9 })).toThrow();
  });

  it("dadu deterministik dari seed dan nomor lemparan, selalu 1..6, dan tersebar", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const v = diceValue("seed", i);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(diceValue("seed", i)).toBe(v);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
    expect(diceValue("a", 0) === diceValue("b", 0) && diceValue("a", 1) === diceValue("b", 1) && diceValue("a", 2) === diceValue("b", 2)).toBe(false);
  });

  it("jalur: petak awal tiap kursi dan petak aman", () => {
    expect([0, 1, 2, 3].map((s) => startCell({ players: 4 }, s))).toEqual([0, 13, 26, 39]);
    expect([0, 1].map((s) => startCell({ players: 2 }, s))).toEqual([0, 26]);
    expect([...SAFE_CELLS].sort((a, b) => a - b)).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
    expect(absCell({ players: 4 }, 1, 0)).toBe(13);
    expect(absCell({ players: 4 }, 1, 45)).toBe(6); // melewati petak 51 kembali ke 0
    expect(absCell({ players: 4 }, 0, 51)).toBeNull(); // lorong rumah bukan jalur bersama
    expect(absCell({ players: 4 }, 0, -1)).toBeNull();
  });
});

describe("Ludo: aturan langkah", () => {
  it("lempar dadu: tanpa angka 6 dan semua bidak di kandang, giliran lewat otomatis ke kursi berikutnya", () => {
    const seed = [...Array(5000).keys()].map((i) => `n${i}`).find((x) => diceValue(x, 0) !== 6) as string;
    const s = ok(apply(init(cfg(), seed), { type: "roll", seat: 0 }));
    expect(s.dice).toBeNull();
    expect(s.turn).toBe(1);
    expect(s.lastRoll).toEqual({ seat: 0, value: diceValue(seed, 0) });
    expect(s.pawns[0]).toEqual([-1, -1, -1, -1]);
  });

  it("angka 6: bisa mengeluarkan bidak ke petak awal; setelah itu giliran tambahan", () => {
    const seed = seedFor(6);
    let s = ok(apply(init(cfg(), seed), { type: "roll", seat: 0 }));
    expect(s.dice).toBe(6);
    // bidak kandang setara: hanya satu yang ditawarkan
    expect(legalMoves(s, 0)).toEqual([{ type: "move", seat: 0, pawn: 0 }]);
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.pawns[0]).toEqual([0, -1, -1, -1]);
    expect(s.turn).toBe(0); // 6 = giliran tambahan
    expect(s.dice).toBeNull();
  });

  it("angka selain 6: bidak di jalur maju sejauh angka, lalu giliran berpindah", () => {
    const seed = seedFor(3);
    let s = fromPawns(cfg(), seed, pawns4({ 0: [10, -1, -1, -1] }), 0);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    expect(s.dice).toBe(3);
    expect(legalMoves(s, 0)).toEqual([{ type: "move", seat: 0, pawn: 0 }]); // bidak kandang tak bisa keluar
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.pawns[0]![0]).toBe(13);
    expect(s.turn).toBe(1);
  });

  it("memakan bidak lawan di petak biasa: lawan kembali ke kandang dan pemakan dapat giliran tambahan", () => {
    const seed = seedFor(2);
    // kursi 0 di kemajuan 5 (petak 5); kursi 1 (start 13) di kemajuan 44 => petak (13+44)%52 = 5? 57%52=5 ya
    let s = fromPawns(cfg(), seed, pawns4({ 0: [3, -1, -1, -1], 1: [44, -1, -1, -1] }), 0);
    expect(absCell(s.config, 1, 44)).toBe(5);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.pawns[0]![0]).toBe(5);
    expect(s.pawns[1]![0]).toBe(-1);
    expect(s.lastCapture).toEqual([{ seat: 1, pawn: 0 }]);
    expect(s.turn).toBe(0);
  });

  it("petak aman: tidak bisa dimakan; kedua bidak berbagi petak", () => {
    const seed = seedFor(2);
    // petak 8 aman. kursi 0 maju dari 6 ke 8; kursi 1 berada di petak 8 (kemajuan 47: (13+47)%52=8).
    let s = fromPawns(cfg(), seed, pawns4({ 0: [6, -1, -1, -1], 1: [47, -1, -1, -1] }), 0);
    expect(absCell(s.config, 1, 47)).toBe(8);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.pawns[0]![0]).toBe(8);
    expect(s.pawns[1]![0]).toBe(47);
    expect(s.lastCapture).toEqual([]);
    expect(s.turn).toBe(1);
  });

  it("bidak di lorong rumah atau finish tidak bisa dimakan; petak awal lawan aman", () => {
    const seed = seedFor(1);
    // kursi 1 start di 13 (aman). kursi 0 mendarat di petak 13 (kemajuan 13) dengan lawan di kemajuan 0.
    let s = fromPawns(cfg(), seed, pawns4({ 0: [12, -1, -1, -1], 1: [0, -1, -1, -1] }), 0);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.pawns[0]![0]).toBe(13);
    expect(s.pawns[1]![0]).toBe(0);
    expect(s.lastCapture).toEqual([]);
  });

  it("finish tepat di 56: lemparan berlebih tidak sah dan bidak lain bisa dipilih; pas = finish", () => {
    const six = seedFor(6);
    let s = fromPawns(cfg(), six, pawns4({ 0: [52, 20, -1, -1] }), 0);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    expect(s.dice).toBe(6);
    // 52+6=58 > 56: bidak 0 tidak sah; bidak 1 (20) dan bidak kandang sah
    expect(legalMoves(s, 0).map((m) => (m.type === "move" ? m.pawn : -1)).sort()).toEqual([1, 2]);
    expect(apply(s, { type: "move", seat: 0, pawn: 0 })).toMatchObject({ code: "ILLEGAL_MOVE" });

    const four = seedFor(4);
    let t = fromPawns(cfg(), four, pawns4({ 0: [52, -1, -1, -1] }), 0);
    t = ok(apply(t, { type: "roll", seat: 0 }));
    t = ok(apply(t, { type: "move", seat: 0, pawn: 0 }));
    expect(t.pawns[0]![0]).toBe(FINISH);
  });

  it("tidak ada langkah sah setelah lemparan: giliran lewat otomatis tanpa giliran tambahan", () => {
    const three = seedFor(3);
    const s = ok(apply(fromPawns(cfg(), three, pawns4({ 0: [55, 56, 56, 56] }), 0), { type: "roll", seat: 0 }));
    expect(s.dice).toBeNull(); // 55+3 melebihi 56
    expect(s.turn).toBe(1);
  });

  it("menang bila keempat bidak finish; peringkat lengkap 1..n berdasar kemajuan", () => {
    const three = seedFor(3);
    let s = fromPawns(cfg(), three, pawns4({ 0: [56, 56, 56, 53], 1: [30, 20, -1, -1], 2: [40, 40, 40, 1], 3: [5, -1, -1, -1] }), 0);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 3 }));
    const st = status(s);
    expect(st.over).toBe(true);
    expect(st.winner).toBe(0);
    expect(st.ranking?.map((r) => [r.seat, r.rank])).toEqual([[0, 1], [2, 2], [1, 3], [3, 4]]);
    expect(legalMoves(s, s.turn)).toEqual([]);
    expect(apply(s, { type: "roll", seat: s.turn })).toMatchObject({ code: "GAME_OVER" });
  });

  it("2 pemain: kursi berhadapan, petak awal 0 dan 26", () => {
    const seed = seedFor(6);
    let s = init(cfg({ players: 2 }), seed);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    s = ok(apply(s, { type: "roll", seat: 0 })); // 6 = giliran tambahan, lemparan ke-2
    expect(startCell(s.config, 1)).toBe(26);
  });

  it("aturan bisa dimatikan lewat konfigurasi: tanpa giliran tambahan untuk 6", () => {
    const seed = seedFor(6);
    let s = init(cfg({ extraTurnOnSix: false }), seed);
    s = ok(apply(s, { type: "roll", seat: 0 }));
    s = ok(apply(s, { type: "move", seat: 0, pawn: 0 }));
    expect(s.turn).toBe(1);
  });
});

describe("Ludo: penolakan dan kemurnian", () => {
  it("di luar giliran, urutan salah, pawn tidak dikenal, kursi tidak dikenal", () => {
    const seed = seedFor(6);
    const s0 = init(cfg(), seed);
    expect(apply(s0, { type: "roll", seat: 1 })).toMatchObject({ code: "NOT_YOUR_TURN" });
    expect(apply(s0, { type: "move", seat: 0, pawn: 0 })).toMatchObject({ code: "MUST_ROLL" });
    expect(apply(s0, { type: "roll", seat: 9 })).toMatchObject({ code: "BAD_SEAT" });
    const s1 = ok(apply(s0, { type: "roll", seat: 0 }));
    expect(apply(s1, { type: "roll", seat: 0 })).toMatchObject({ code: "MUST_MOVE" });
    expect(apply(s1, { type: "move", seat: 0, pawn: 7 })).toMatchObject({ code: "BAD_PAWN" });
    expect(apply(s1, { type: "move", seat: 0, pawn: 1 })).toMatchObject({ code: "ILLEGAL_MOVE" }); // bidak kandang kembar tidak ditawarkan
  });

  it("apply murni: state lama tidak berubah dan state serializable JSON", () => {
    const s0 = init(cfg(), "murni");
    const before = JSON.stringify(s0);
    const s1 = ok(apply(s0, { type: "roll", seat: 0 }));
    expect(JSON.stringify(s0)).toBe(before);
    expect(JSON.parse(JSON.stringify(s1))).toEqual(s1);
  });

  it("autoMove memilih lempar, lalu langkah yang memakan atau paling maju", () => {
    const seed = seedFor(2);
    const s0 = fromPawns(cfg(), seed, pawns4({ 0: [3, 30, -1, -1], 1: [44, -1, -1, -1] }), 0);
    expect(autoMove(s0, 0)).toEqual({ type: "roll", seat: 0 });
    const s1 = ok(apply(s0, { type: "roll", seat: 0 }));
    expect(autoMove(s1, 0)).toEqual({ type: "move", seat: 0, pawn: 0 }); // memakan bidak kursi 1 di petak 5
    expect(autoMove(s1, 1)).toBeNull();
  });
});

describe("Ludo: simulasi dan properti", () => {
  const candidates = (s: S): ludo.LudoMove[] => {
    const out: ludo.LudoMove[] = [];
    for (let seat = -1; seat <= s.config.players; seat++) {
      out.push({ type: "roll", seat });
      for (let pawn = -1; pawn <= 4; pawn++) out.push({ type: "move", seat, pawn });
    }
    return out;
  };

  function play(players: 2 | 3 | 4, seed: string, exhaustive: boolean): S {
    const pick = createRng(`pilih:${seed}`);
    let s = init(cfg({ players }), seed);
    for (let step = 0; step < 6000; step++) {
      if (s.result) break;
      const legal = legalMoves(s, s.turn);
      if (legal.length === 0) throw new Error(`kebuntuan: ${seed}`);
      for (let q = 0; q < players; q++) if (q !== s.turn && legalMoves(s, q).length !== 0) throw new Error("kursi lain punya langkah");
      if (exhaustive) {
        const set = new Set(legal.map((m) => JSON.stringify(m)));
        const before = JSON.stringify(s);
        for (const c of candidates(s)) {
          if (!isLudoError(apply(s, c)) !== set.has(JSON.stringify(c))) throw new Error(`apply dan legalMoves tidak cocok: ${JSON.stringify(c)}`);
        }
        if (JSON.stringify(s) !== before) throw new Error("apply mengubah masukan");
      }
      s = ok(apply(s, legal[Math.floor(pick() * legal.length)] as ludo.LudoMove));
      // invarian: tiap kursi tepat 4 bidak, kemajuan -1..56, dadu hanya bila menunggu pilihan
      for (const ps of s.pawns) {
        if (ps.length !== 4 || ps.some((p) => p < -1 || p > FINISH)) throw new Error("bidak di luar rentang");
      }
      // dua bidak lawan tidak pernah berbagi petak jalur biasa (non-aman) setelah langkah selesai
      const seen = new Map<number, number>();
      s.pawns.forEach((ps, seat) => ps.forEach((p) => {
        const cell = absCell(s.config, seat, p);
        if (cell === null || SAFE_CELLS.includes(cell)) return;
        if (seen.has(cell) && seen.get(cell) !== seat) throw new Error("bidak lawan berbagi petak biasa");
        seen.set(cell, seat);
      }));
    }
    if (!s.result) throw new Error(`game tidak selesai: ${seed}`);
    const ranks = (s.result.ranking.map((r) => r.rank)).join();
    if (ranks !== Array.from({ length: players }, (_, i) => i + 1).join()) throw new Error("peringkat tidak lengkap");
    if (new Set(s.result.ranking.map((r) => r.seat)).size !== players) throw new Error("kursi ganda");
    return s;
  }

  it.each([2, 3, 4] as const)("simulasi 10.000 game acak %i pemain: tanpa pelanggaran, selalu selesai, peringkat lengkap", (players) => {
    let moves = 0;
    let max = 0;
    for (let i = 0; i < 10_000; i++) {
      const s = play(players, `sim-${players}-${i}`, i % 25 === 0);
      moves += s.log.length;
      max = Math.max(max, s.log.length);
    }
    console.log(`Ludo ${players} pemain: 10000 game, rata-rata ${(moves / 10_000).toFixed(0)} langkah, maks ${max}`);
  });

  it.each([2, 3, 4] as const)("replay dari seed dan log menghasilkan state identik (%i pemain)", (players) => {
    for (let i = 0; i < 200; i++) {
      const seed = `rep-${players}-${i}`;
      const final = play(players, seed, false);
      const r = replay(cfg({ players }), seed, JSON.parse(JSON.stringify(final.log)) as ludo.LudoMove[]);
      expect(JSON.stringify(r)).toBe(JSON.stringify(final));
    }
  });
});
