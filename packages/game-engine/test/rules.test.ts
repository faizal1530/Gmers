import { describe, expect, it } from "vitest";
import {
  apply,
  cardPips,
  fullDeck,
  handPoints,
  init,
  initWithHands,
  isEngineError,
  legalMoves,
  nextSeat,
  status,
  validateConfig,
  createConfig,
  DEFAULT_CONFIG,
} from "../src";
import type { Card, GapleState, Move } from "../src";
import { cardKeys, cfg, deepFreeze } from "./support";

const c = (a: number, b: number): Card => [Math.min(a, b), Math.max(a, b)];
const play = (state: GapleState, a: number, b: number, end: "left" | "right" = "left"): GapleState => {
  const r = apply(state, { type: "play", seat: state.turn, card: c(a, b), end });
  if (isEngineError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const pass = (state: GapleState): GapleState => {
  const r = apply(state, { type: "pass", seat: state.turn });
  if (isEngineError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const code = (r: GapleState | { code: string }): string => ("code" in r ? r.code : "OK");

describe("set kartu", () => {
  it("berisi 28 kartu unik dengan total 168 titik dan 7 balak", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(28);
    expect(new Set(cardKeys(deck)).size).toBe(28);
    expect(deck.reduce((s, x) => s + cardPips(x), 0)).toBe(168);
    expect(deck.filter((x) => x[0] === x[1])).toHaveLength(7);
  });
});

describe("pembagian", () => {
  it("4 pemain: 7 kartu masing-masing, tanpa sisa, tanpa duplikat", () => {
    const s = init(cfg({ players: 4 }), "bagi-4");
    expect(s.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
    expect(s.discarded).toHaveLength(0);
    expect(new Set(cardKeys(s.hands.flat())).size).toBe(28);
  });
  it.each([2, 3] as const)("%i pemain: 7 kartu masing-masing, sisanya disisihkan", (players) => {
    const s = init(cfg({ players }), `bagi-${players}`);
    expect(s.hands.every((h) => h.length === 7)).toBe(true);
    expect(s.discarded).toHaveLength(28 - players * 7);
    expect(new Set(cardKeys([...s.hands.flat(), ...s.discarded])).size).toBe(28);
  });
  it("handSize 6 membagi 6 kartu", () => {
    const s = init(cfg({ players: 4, handSize: 6 }), "bagi-6");
    expect(s.hands.every((h) => h.length === 6)).toBe(true);
    expect(s.discarded).toHaveLength(4);
  });
  it("seed yang sama menghasilkan pembagian sama; seed beda menghasilkan beda", () => {
    expect(init(cfg(), "x")).toEqual(init(cfg(), "x"));
    expect(init(cfg(), "x").hands).not.toEqual(init(cfg(), "y").hands);
  });
  it("RNG bisa diinjeksi", () => {
    const fixed = () => 0.5;
    expect(init(cfg(), "a", fixed).hands).toEqual(init(cfg(), "b", fixed).hands);
  });
});

describe("konfigurasi", () => {
  it("default valid; varian yang belum dibangun ditolak", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    expect(() => createConfig({ teams: true as unknown as false })).toThrow(/teams/);
    expect(() => createConfig({ players: 5 as unknown as 4 })).toThrow(/players/);
    expect(() => createConfig({ openerSeat: 9 })).toThrow(/openerSeat/);
  });
});

describe("pembukaan ronde pertama", () => {
  const hands = (): Card[][] => [
    [c(6, 6), c(0, 1), c(2, 3)],
    [c(1, 1), c(4, 5), c(2, 2)],
    [c(0, 0), c(3, 5), c(1, 6)],
    [c(0, 2), c(4, 4), c(3, 3)],
  ];
  const rest = (h: Card[][]): Card[] => {
    const used = new Set(cardKeys(h.flat()));
    return fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`));
  };

  it("pemegang 6|6 membuka dan hanya 6|6 yang sah", () => {
    const h = hands();
    const s = initWithHands(cfg({ players: 4 }), "t", h, rest(h));
    expect(s.turn).toBe(0);
    expect(legalMoves(s, 0)).toEqual([{ type: "play", seat: 0, card: c(6, 6), end: "left" }]);
    expect(code(apply(s, { type: "play", seat: 0, card: c(0, 1), end: "left" }))).toBe("MUST_OPEN_WITH_REQUIRED");
    expect(code(apply(s, { type: "play", seat: 1, card: c(1, 1), end: "left" }))).toBe("NOT_YOUR_TURN");
    expect(code(apply(s, { type: "pass", seat: 0 }))).toBe("CANNOT_PASS_ON_OPENING");
  });

  it("opening zeroZero: pemegang 0|0 membuka", () => {
    const h = hands();
    const s = initWithHands(cfg({ opening: "zeroZero" }), "t", h, rest(h));
    expect(s.turn).toBe(2);
    expect(s.requiredOpening).toEqual(c(0, 0));
  });

  it("fallback: 6|6 tidak dibagikan -> balak tertinggi membuka", () => {
    const h = hands();
    h[0] = [c(0, 1), c(2, 3), c(5, 6)];
    h[1] = [c(1, 1), c(4, 5), c(2, 2)];
    const s = initWithHands(cfg({ players: 4 }), "t", h, [c(6, 6), ...rest(h).filter((x) => !(x[0] === 6 && x[1] === 6))]);
    // balak yang ada di tangan: 1|1 (seat 1), 2|2 (seat 1), 0|0 (seat 2), 4|4 (seat 3), 3|3 (seat 3) -> tertinggi 4|4 di seat 3
    expect(s.turn).toBe(3);
    expect(s.requiredOpening).toEqual(c(4, 4));
  });

  it("fallback tanpa balak: jumlah titik tertinggi (seri: sisi tertinggi)", () => {
    const h: Card[][] = [
      [c(1, 2), c(0, 3)],
      [c(5, 4), c(6, 3)],
      [c(0, 1), c(1, 3)],
      [c(2, 4), c(0, 2)],
    ];
    const s = initWithHands(cfg({ players: 4, handSize: 6 }), "t", h, rest(h));
    // 4|5 = 9, 3|6 = 9 -> sisi tertinggi 6 menang
    expect(s.turn).toBe(1);
    expect(s.requiredOpening).toEqual(c(3, 6));
  });

  it("openerSeat (rematch): pemenang sebelumnya membuka dengan kartu bebas", () => {
    const h = hands();
    const s = initWithHands(cfg({ openerSeat: 3 }), "t", h, rest(h));
    expect(s.turn).toBe(3);
    expect(s.requiredOpening).toBeNull();
    expect(legalMoves(s, 3)).toHaveLength(3);
    expect(code(play(s, 4, 4))).toBe("OK");
  });

  it("opening random: kursi acak deterministik dari seed, kartu bebas", () => {
    const a = init(cfg({ opening: "random" }), "rnd");
    const b = init(cfg({ opening: "random" }), "rnd");
    expect(a.turn).toBe(b.turn);
    expect(a.requiredOpening).toBeNull();
  });
});

describe("memasang kartu", () => {
  const setup = (): GapleState => {
    const h: Card[][] = [
      [c(6, 6), c(6, 2), c(3, 4)],
      [c(2, 5), c(2, 2), c(0, 1)],
      [c(6, 1), c(0, 3), c(4, 4)],
      [c(1, 5), c(5, 5), c(0, 0)],
    ];
    const used = new Set(cardKeys(h.flat()));
    return initWithHands(cfg(), "t", h, fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`)));
  };

  it("kartu hanya sah bila cocok dengan ujung kiri atau kanan; orientasi benar", () => {
    let s = play(setup(), 6, 6); // ujung 6 | 6, giliran seat 1
    expect(s.turn).toBe(1);
    expect(code(apply(s, { type: "play", seat: 1, card: c(2, 5), end: "left" }))).toBe("CARD_DOES_NOT_FIT");
    expect(code(apply(s, { type: "play", seat: 1, card: c(2, 5), end: "right" }))).toBe("CARD_DOES_NOT_FIT");
    expect(code(apply(s, { type: "play", seat: 1, card: c(3, 3), end: "left" }))).toBe("CARD_NOT_IN_HAND");
    s = pass(s); // seat 1 tidak punya 6 -> lewat
    expect(s.turn).toBe(2);
    s = play(s, 1, 6, "right"); // 6|1 di kanan -> ujung kanan 1
    expect(s.board).toEqual([[6, 6], [6, 1]]);
    expect(s.turn).toBe(3);
    s = play(s, 1, 5, "right"); // ujung kanan 5
    expect(s.board.at(-1)).toEqual([1, 5]);
    expect(s.turn).toBe(0);
    s = play(s, 6, 2, "left"); // di kiri: 2|6 menghadap 6
    expect(s.board[0]).toEqual([2, 6]);
  });

  it("balak tidak membuka cabang: rantai tetap satu garis dengan dua ujung", () => {
    let s = play(setup(), 6, 6);
    s = pass(s);
    s = play(s, 1, 6, "right"); // [6,6][6,1]
    s = play(s, 1, 5, "right"); // ... [1,5]
    expect(s.board).toHaveLength(3);
    s = play(s, 2, 6, "left"); // seat 0: kiri jadi 2
    s = play(s, 2, 2, "left"); // seat 1: balak 2|2 di kiri, ujung tetap 2
    expect(s.board[0]).toEqual([2, 2]);
    expect(s.board).toHaveLength(5);
    for (let i = 1; i < s.board.length; i++) expect((s.board[i - 1] as Card)[1]).toBe((s.board[i] as Card)[0]);
  });

  it("langkah ditolak tidak mengubah state", () => {
    const s = deepFreeze(play(setup(), 6, 6));
    const before = JSON.stringify(s);
    apply(s, { type: "play", seat: 1, card: c(2, 5), end: "left" });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("lewat", () => {
  const setup = (): GapleState => {
    const h: Card[][] = [
      [c(6, 6), c(0, 1)],
      [c(6, 5), c(2, 3)],
      [c(0, 4), c(1, 2)],
    ];
    const used = new Set(cardKeys(h.flat()));
    return initWithHands(cfg({ players: 3, handSize: 6 }), "t", h, fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`)));
  };

  it("ditolak bila ada kartu cocok, diterima bila tidak ada", () => {
    let s = play(setup(), 6, 6);
    expect(code(apply(s, { type: "pass", seat: 1 }))).toBe("MUST_PLAY");
    s = play(s, 6, 5, "left");
    // ujung 5 dan 6; seat 2 tidak punya 5 atau 6 -> hanya lewat
    expect(legalMoves(s, 2)).toEqual([{ type: "pass", seat: 2 }]);
    expect(code(apply(s, { type: "pass", seat: 2 }))).toBe("OK");
  });

  it("mustPlayIfAble=false mengizinkan lewat walau ada kartu cocok", () => {
    const base = setup();
    const s0 = initWithHands(cfg({ players: 3, handSize: 6, mustPlayIfAble: false }), "t", base.hands, base.discarded);
    const s = play(s0, 6, 6);
    const moves = legalMoves(s, 1);
    expect(moves.some((m) => m.type === "pass")).toBe(true);
    expect(code(apply(s, { type: "pass", seat: 1 }))).toBe("OK");
  });
});

describe("arah putar", () => {
  it("searah dan berlawanan jarum jam", () => {
    expect(nextSeat(cfg({ players: 4 }), 3)).toBe(0);
    expect(nextSeat(cfg({ players: 4, turnDirection: "counterclockwise" }), 0)).toBe(3);
    const h: Card[][] = [[c(6, 6), c(0, 1)], [c(6, 5)], [c(2, 3)]];
    const used = new Set(cardKeys(h.flat()));
    const s = initWithHands(
      cfg({ players: 3, handSize: 6, turnDirection: "counterclockwise" }),
      "t",
      h,
      fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`)),
    );
    expect(play(s, 6, 6).turn).toBe(2);
  });
});

describe("akhir game", () => {
  it("kartu habis: pemain itu juara, sisanya urut titik sisa", () => {
    const h: Card[][] = [
      [c(6, 6)],
      [c(6, 5), c(6, 4)],
      [c(2, 2), c(1, 0)],
    ];
    const used = new Set(cardKeys(h.flat()));
    const s = play(initWithHands(cfg({ players: 3, handSize: 6 }), "t", h, fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`))), 6, 6);
    const st = status(s);
    expect(st.over).toBe(true);
    expect(st.reason).toBe("out");
    expect(st.winner).toBe(0);
    // seat 2: 4+1=5, seat 1: 11+10=21
    expect(st.ranking?.map((r) => [r.seat, r.rank, r.points])).toEqual([[0, 1, 0], [2, 2, 5], [1, 3, 21]]);
    expect(code(apply(s, { type: "pass", seat: s.turn }))).toBe("GAME_OVER");
    expect(legalMoves(s, s.turn)).toEqual([]);
  });

  it("terkunci setelah n lewat berturut-turut; pemenang titik sisa terendah", () => {
    // Rantai 6|6; tak seorang pun punya 6 lagi -> 3 lewat -> terkunci.
    const h: Card[][] = [
      [c(6, 6), c(1, 1)], // sisa 2
      [c(0, 5), c(2, 2)], // sisa 9
      [c(3, 3), c(0, 0)], // sisa 6
    ];
    const used = new Set(cardKeys(h.flat()));
    let s = play(initWithHands(cfg({ players: 3, handSize: 6 }), "t", h, fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`))), 6, 6);
    s = pass(s);
    expect(s.result).toBeNull();
    s = pass(s);
    expect(s.result).toBeNull();
    s = pass(s);
    // tiga lewat berturut-turut (n = 3)
    const st = status(s);
    expect(st.over).toBe(true);
    expect(st.reason).toBe("blocked");
    expect(st.ranking?.map((r) => [r.seat, r.points])).toEqual([[0, 2], [2, 6], [1, 9]]);
  });

  it("main kembali setelah satu lewat: hitungan lewat berturut-turut di-reset oleh langkah", () => {
    const h: Card[][] = [
      [c(6, 6), c(1, 6)],
      [c(0, 5), c(2, 2)],
      [c(3, 3), c(6, 0)],
    ];
    const used = new Set(cardKeys(h.flat()));
    let s = play(initWithHands(cfg({ players: 3, handSize: 6 }), "t", h, fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`))), 6, 6);
    s = pass(s); // seat 1
    s = play(s, 6, 0, "right"); // seat 2
    expect(s.consecutivePasses).toBe(0);
  });
});

describe("skor titik sisa", () => {
  it("contoh dari draf: 6|6 + 0|1 = 13; 2|3 = 5", () => {
    expect(handPoints([c(6, 6), c(0, 1)], DEFAULT_CONFIG)).toBe(13);
    expect(handPoints([c(2, 3)], DEFAULT_CONFIG)).toBe(5);
  });
  it("0|0 bernilai 0 secara default", () => {
    expect(handPoints([c(0, 0), c(1, 1)], DEFAULT_CONFIG)).toBe(2);
  });
  it("zeroZeroPenalty=25: 0|0 = 25 hanya bila tak ada kartu kosong lain di tangan", () => {
    const cf = cfg({ zeroZeroPenalty: 25 });
    expect(handPoints([c(0, 0), c(1, 1)], cf)).toBe(27);
    expect(handPoints([c(0, 0), c(0, 3)], cf)).toBe(3);
  });
});

describe("peringkat seri", () => {
  const blockedGame = (hands: Card[][]): GapleState => {
    // 6|6 dipegang seat 0 (pembuka); tak seorang pun punya angka 6 lagi, jadi semua lewat sampai terkunci.
    const used = new Set(cardKeys(hands.flat()));
    let s = initWithHands(
      cfg({ players: 3, handSize: 6 }),
      "t",
      hands,
      fullDeck().filter((x) => !used.has(`${x[0]}|${x[1]}`)),
    );
    s = play(s, 6, 6);
    while (s.result === null) s = pass(s);
    return s;
  };
  const order = (s: GapleState): number[] => (status(s).ranking ?? []).map((r) => r.seat);

  it("titik sisa terendah menang", () => {
    expect(order(blockedGame([[c(6, 6), c(0, 4)], [c(1, 2), c(3, 3)], [c(0, 5), c(2, 4)]]))).toEqual([0, 1, 2]);
  });

  it("seri titik: kartu tunggal sisa bertitik terendah menang", () => {
    // seat 1: 2|3 + 1|5 = 11 (kartu terendah 5); seat 2: 4|4 + 0|3 = 11 (kartu terendah 3)
    expect(order(blockedGame([[c(6, 6), c(0, 0)], [c(2, 3), c(1, 5)], [c(4, 4), c(0, 3)]]))).toEqual([0, 2, 1]);
  });

  it("seri titik dan titik kartu terendah: ujung terendah menang", () => {
    // seat 1: 1|4 + 3|3 = 11 (terendah 1|4, ujung 1); seat 2: 0|5 + 2|4 = 11 (terendah 0|5, ujung 0)
    expect(order(blockedGame([[c(6, 6), c(0, 0)], [c(1, 4), c(3, 3)], [c(0, 5), c(2, 4)]]))).toEqual([0, 2, 1]);
  });

  it("peringkat selalu lengkap 1..n dan deterministik", () => {
    const hands = (): Card[][] => [[c(6, 6), c(0, 0)], [c(1, 4), c(3, 3)], [c(0, 5), c(2, 4)]];
    const a = status(blockedGame(hands())).ranking;
    expect(a).toEqual(status(blockedGame(hands())).ranking);
    expect(a?.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  // Lapis ketiga (urutan duduk dari pembuka) hanya pengaman: dua kartu berbeda tak pernah punya
  // titik dan ujung terendah yang sama, jadi lapis ini tak terjangkau selama tiap tangan berisi kartu.
});

describe("tipe langkah", () => {
  it("Move bisa diserialisasi JSON dan dimainkan ulang", () => {
    const s0 = init(cfg(), "json");
    const move = legalMoves(s0, s0.turn)[0] as Move;
    const parsed = JSON.parse(JSON.stringify(move)) as Move;
    expect(isEngineError(apply(s0, parsed))).toBe(false);
  });
});
