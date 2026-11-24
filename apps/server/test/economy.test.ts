import { describe, expect, it } from "vitest";
import { DEFAULT_ECONOMY, classIndex, className, wibDay, type EconomyConfig } from "../src/economy";
import { Ledger, MemoryLedgerLog } from "../src/ledger";
import { Progress, type SettlePlayer } from "../src/progress";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-24T03:00:00Z"); // 10.00 WIB

function make(econ: Partial<EconomyConfig> = {}) {
  const log = new MemoryLedgerLog();
  let t = T0;
  const clock = { get: () => t, set: (x: number) => (t = x), advance: (ms: number) => (t += ms) };
  const ledger = new Ledger(log, () => t);
  const e = { ...DEFAULT_ECONOMY, ...econ };
  const progress = new Progress(ledger, e);
  return { log, ledger, progress, clock, e, reopen: () => { const l = new Ledger(log, () => t); return { ledger: l, progress: new Progress(l, e) }; } };
}

const players = (...specs: [string | null, number, boolean?][]): SettlePlayer[] => specs.map(([accountId, rank, abandoned]) => ({ accountId, rank, abandoned: abandoned ?? false }));
let refN = 0;
const ref = (): string => `room:${refN++}`;
const ranked4 = (ids: string[]): SettlePlayer[] => players(...ids.map((id, i) => [id, i + 1] as [string, number]));

describe("ledger", () => {
  it("menulis baris dengan saldo sesudahnya dan menurunkan saldo dari baris", () => {
    const { ledger } = make();
    const r = ledger.post([{ accountId: "a", currency: "koin", delta: 50, reason: "bonus", ref: "x1" }, { accountId: "a", currency: "bintang", delta: 5, reason: "game", ref: "x1" }]);
    expect(r.ok && r.rows.map((x) => [x.currency, x.delta, x.balance])).toEqual([["koin", 50, 50], ["bintang", 5, 5]]);
    expect(ledger.balance("a", "koin")).toBe(50);
    expect(ledger.balance("b", "koin")).toBe(0);
  });

  it("atomik: bila satu baris membuat saldo negatif, tidak ada baris yang tertulis", () => {
    const { ledger, log } = make();
    ledger.post([{ accountId: "a", currency: "koin", delta: 10, reason: "bonus", ref: "r0" }]);
    const bad = ledger.post([
      { accountId: "a", currency: "bintang", delta: 5, reason: "game", ref: "r1" },
      { accountId: "a", currency: "koin", delta: -11, reason: "beli", ref: "r1" },
    ]);
    expect(bad).toMatchObject({ ok: false, code: "INSUFFICIENT" });
    expect(ledger.balance("a", "bintang")).toBe(0);
    expect(ledger.balance("a", "koin")).toBe(10);
    expect(log.readAll()).toHaveLength(1);
  });

  it("idempoten: kunci yang sama diabaikan; sebaliknya reason atau ref berbeda diterima", () => {
    const { ledger } = make();
    const e = { accountId: "a", currency: "bintang" as const, delta: 5, reason: "game", ref: "g1" };
    expect(ledger.post([e])).toMatchObject({ ok: true, duplicate: false });
    expect(ledger.post([e])).toMatchObject({ ok: true, duplicate: true, rows: [] });
    expect(ledger.balance("a", "bintang")).toBe(5);
    expect(ledger.post([{ ...e, ref: "g2" }])).toMatchObject({ duplicate: false });
    expect(ledger.balance("a", "bintang")).toBe(10);
  });

  it("jumlah bukan bilangan bulat ditolak; saldo pulih penuh setelah dibuka ulang dari log", () => {
    const { ledger, reopen } = make();
    expect(ledger.post([{ accountId: "a", currency: "koin", delta: 1.5, reason: "x", ref: "z" }]).ok).toBe(false);
    ledger.post([{ accountId: "a", currency: "trofi", delta: 12, reason: "ranked", ref: "q" }]);
    expect(reopen().ledger.balance("a", "trofi")).toBe(12);
    expect(reopen().ledger.post([{ accountId: "a", currency: "trofi", delta: 12, reason: "ranked", ref: "q" }])).toMatchObject({ duplicate: true });
  });
});

describe("kelas", () => {
  it("batas kelas dari spesifikasi: 0, 100, 300, 600, 1000", () => {
    const e = DEFAULT_ECONOMY;
    expect([0, 99, 100, 299, 300, 599, 600, 999, 1000, 5000].map((t) => className(e, t))).toEqual(["Pemula", "Pemula", "Jago", "Jago", "Pro", "Pro", "Master", "Master", "Raja", "Raja"]);
    expect(classIndex(e, -5)).toBe(0);
  });
  it("hari kalender WIB", () => {
    expect(wibDay(Date.parse("2026-11-24T16:59:00Z"))).toBe(wibDay(Date.parse("2026-11-24T00:00:00Z")));
    expect(wibDay(Date.parse("2026-11-24T17:00:00Z"))).toBe(wibDay(Date.parse("2026-11-24T00:00:00Z")) + 1);
  });
});

describe("Trofi dan Bintang (spek 7.5)", () => {
  it("Ranked 4 pemain: +10, +4, -2, -5, dan bonus game Ranked pertama hari itu +2 (dari 0 yang negatif tertahan lantai)", () => {
    const { progress } = make();
    const r = progress.settle({ ref: ref(), ts: T0, ranked: true, players: ranked4(["a", "b", "c", "d"]) });
    expect(r.map((x) => [x.accountId, x.trofi])).toEqual([["a", 12], ["b", 6], ["c", 0], ["d", 0]]);
    // peringkat 3 dan 4 turun dari 0: -2+2=0 dan -5+2=-3 tetapi lantai kelas Pemula = 0
    expect(progress.wallet("a").trofi).toBe(12);
    expect(progress.wallet("d").trofi).toBe(0);
  });

  it("game Ranked kedua pada hari yang sama tidak mendapat bonus; hari WIB berikutnya mendapat bonus lagi (23.59 vs 00.01 WIB)", () => {
    const { progress, clock } = make();
    progress.settle({ ref: ref(), ts: T0, ranked: true, players: ranked4(["a", "b", "c", "d"]) });
    const second = progress.settle({ ref: ref(), ts: T0 + 1000, ranked: true, players: ranked4(["a", "b", "c", "d"]) });
    expect(second.slice(0, 2).map((x) => x.trofi)).toEqual([10, 4]); // tanpa bonus kedua kalinya
    clock.set(Date.parse("2026-11-24T16:59:00Z")); // 23.59 WIB, masih hari yang sama
    const same = progress.settle({ ref: ref(), ts: Date.parse("2026-11-24T16:59:00Z"), ranked: true, players: ranked4(["a", "b", "c", "d"]) });
    expect(same[0]!.trofi).toBe(10);
    const next = progress.settle({ ref: ref(), ts: Date.parse("2026-11-24T17:01:00Z"), ranked: true, players: ranked4(["a", "b", "c", "d"]) });
    expect(next[0]!.trofi).toBe(12); // 00.01 WIB: hari baru, bonus +2 lagi
  });

  it("2 pemain: menang +10, kalah -5; 3 pemain memakai tabel turunan", () => {
    const { progress } = make({ pairDailyCap: 100 });
    progress.settle({ ref: ref(), ts: T0, ranked: true, players: ranked4(["a", "b"]) });
    // setelah bonus hari itu: a=12, b=0 (lantai); game kedua tanpa bonus
    const r2 = progress.settle({ ref: ref(), ts: T0 + 1, ranked: true, players: ranked4(["a", "b"]) });
    expect(r2.map((x) => x.trofi)).toEqual([10, 0]);
    const r3 = progress.settle({ ref: ref(), ts: T0 + 2, ranked: true, players: ranked4(["a", "b", "c"]) });
    expect(r3[0]!.trofi).toBe(10);
    expect(r3[1]!.trofi).toBe(2);
  });

  it("lantai kelas: Trofi tidak turun di bawah batas kelas yang sudah dicapai, dan naik kelas ditandai", () => {
    const { progress, ledger } = make({ pairDailyCap: 1000 });
    ledger.post([{ accountId: "a", currency: "trofi", delta: 99, reason: "ranked", ref: "seed" }]);
    const up = progress.settle({ ref: ref(), ts: T0, ranked: true, players: ranked4(["a", "b"]) });
    expect(up[0]).toMatchObject({ trofiTotal: 111, kelas: "Jago", kelasUp: "Jago" }); // 99 + 10 + bonus 2
    // kalah berulang: tidak pernah di bawah 100 (lantai Jago)
    for (let i = 0; i < 10; i++) progress.settle({ ref: ref(), ts: T0 + 10 + i, ranked: true, players: ranked4(["b", "a"]) });
    expect(progress.wallet("a").trofi).toBe(100);
    expect(progress.wallet("a").kelas).toBe("Jago");
    expect(progress.wallet("a").next).toEqual({ name: "Pro", min: 300 });
  });

  it("peringkat terakhir pemain yang meninggalkan game: dihitung kalah walau menang di papan", () => {
    const { progress } = make();
    const r = progress.settle({ ref: ref(), ts: T0, ranked: true, players: players(["a", 1, true], ["b", 2], ["c", 3], ["d", 4]) });
    const by = Object.fromEntries(r.map((x) => [x.accountId, x.trofi]));
    // urutan akhir: b, c, d, a (a menang di papan tetapi meninggalkan game, jadi dihitung terakhir)
    expect(by.b).toBe(12); // peringkat 1: +10 +2 bonus
    expect(by.c).toBe(6); // peringkat 2: +4 +2
    expect(by.d).toBe(0); // peringkat 3: -2 +2 = 0
    expect(by.a).toBe(0); // peringkat 4: -5 +2 = -3, tertahan lantai Pemula 0
  });

  it("tamu: tidak mendapat Trofi maupun Bintang; Ranked dengan tamu tidak mengubah Trofi siapa pun", () => {
    const { progress } = make();
    expect(progress.settle({ ref: ref(), ts: T0, ranked: true, players: players([null, 1], [null, 2]) })).toEqual([]);
    const mixed = progress.settle({ ref: ref(), ts: T0, ranked: true, players: players(["a", 1], [null, 2]) });
    expect(mixed).toEqual([expect.objectContaining({ accountId: "a", trofi: 0, bintang: 5 })]);
    expect(progress.wallet("a").trofi).toBe(0);
  });

  it("game santai: Bintang +5 tanpa Trofi; Bintang harian dibatasi dan reset di hari baru", () => {
    const { progress } = make();
    for (let i = 0; i < 12; i++) progress.settle({ ref: ref(), ts: T0 + i, ranked: false, players: ranked4(["a", "b"]) });
    expect(progress.wallet("a")).toMatchObject({ trofi: 0, bintang: 50 }); // batas harian 50 (10 game)
    const next = progress.settle({ ref: ref(), ts: T0 + DAY, ranked: false, players: ranked4(["a", "b"]) });
    expect(next[0]!.bintang).toBe(5);
    expect(progress.wallet("a").bintang).toBe(55);
  });

  it("batas pasangan harian: lewat batas, game Ranked tetap dimainkan tetapi Trofi tidak berubah (anti win-trading)", () => {
    const { progress } = make({ pairDailyCap: 3 });
    for (let i = 0; i < 3; i++) progress.settle({ ref: ref(), ts: T0 + i, ranked: true, players: ranked4(["a", "b"]) });
    const before = progress.wallet("a").trofi;
    const capped = progress.settle({ ref: ref(), ts: T0 + 10, ranked: true, players: ranked4(["a", "b"]) });
    expect(capped[0]!.trofi).toBe(0);
    expect(progress.wallet("a").trofi).toBe(before);
    // lawan lain tidak terkena batas
    expect(progress.settle({ ref: ref(), ts: T0 + 11, ranked: true, players: ranked4(["a", "c"]) })[0]!.trofi).toBe(10);
  });

  it("idempoten: hasil game yang sama dicatat sekali", () => {
    const { progress } = make();
    const r = "room:tetap:1";
    expect(progress.settle({ ref: r, ts: T0, ranked: true, players: ranked4(["a", "b"]) })).toHaveLength(2);
    expect(progress.settle({ ref: r, ts: T0, ranked: true, players: ranked4(["a", "b"]) })).toEqual([]);
    expect(progress.wallet("a").trofi).toBe(12);
  });

  it("papan peringkat terurut; seluruh keadaan turunan (lantai, bonus harian, batas) pulih setelah restart dari log", () => {
    const { progress, ledger, reopen } = make({ pairDailyCap: 1000 });
    ledger.post([{ accountId: "a", currency: "trofi", delta: 99, reason: "ranked", ref: "seed" }]);
    progress.settle({ ref: ref(), ts: T0, ranked: true, players: ranked4(["a", "b"]) });
    for (let i = 0; i < 5; i++) progress.settle({ ref: ref(), ts: T0 + 5 + i, ranked: true, players: ranked4(["b", "a"]) });
    expect(progress.leaderboard(10).map((x) => x.accountId)).toEqual(["a", "b"]);
    const again = reopen();
    expect(again.progress.wallet("a")).toEqual(progress.wallet("a"));
    expect(again.progress.wallet("a").trofi).toBe(100); // lantai Jago tetap berlaku
    const noBonus = again.progress.settle({ ref: ref(), ts: T0 + 100, ranked: true, players: ranked4(["b", "a"]) });
    expect(noBonus.find((x) => x.accountId === "b")!.trofi).toBe(10); // bonus hari ini sudah terpakai sebelum restart
  });
});
