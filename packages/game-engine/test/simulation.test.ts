import { describe, expect, it } from "vitest";
import { cfg, simulate } from "./support";
import type { SimStats } from "./support";

const GAMES = 10_000;

function report(label: string, s: SimStats): string {
  return `${label}: ${s.games} game, kartu habis ${s.out} (${((100 * s.out) / s.games).toFixed(1)}%), terkunci ${s.blocked} (${((100 * s.blocked) / s.games).toFixed(1)}%), rata-rata ${(s.totalMoves / s.games).toFixed(1)} langkah, maks ${s.maxMoves}, pembuka cadangan ${s.fallbackOpenings}`;
}

describe(`simulasi ${GAMES} game acak per jumlah pemain (default aturan)`, () => {
  it.each([2, 3, 4] as const)("%i pemain: tanpa pelanggaran aturan, tanpa kebuntuan, peringkat lengkap", (players) => {
    // exhaustiveEvery: tiap 10 game diperiksa semua langkah kandidat terhadap legalMoves.
    const stats = simulate(cfg({ players }), GAMES, "sim", { exhaustiveEvery: 10 });
    console.log(report(`${players} pemain`, stats));
    expect(stats.games).toBe(GAMES);
    expect(stats.out + stats.blocked).toBe(GAMES);
  });
});

describe("simulasi varian parameter (2.000 game per varian)", () => {
  const variants: [string, Parameters<typeof cfg>[0]][] = [
    ["handSize 6, 4 pemain", { players: 4, handSize: 6 }],
    ["handSize 6, 2 pemain", { players: 2, handSize: 6 }],
    ["berlawanan jarum jam", { players: 3, turnDirection: "counterclockwise" }],
    ["opening zeroZero", { players: 4, opening: "zeroZero" }],
    ["opening random", { players: 3, opening: "random" }],
    ["openerSeat 1 (rematch)", { players: 4, openerSeat: 1 }],
    ["mustPlayIfAble false", { players: 4, mustPlayIfAble: false }],
    ["zeroZeroPenalty 25", { players: 4, zeroZeroPenalty: 25 }],
  ];
  it.each(variants)("%s", (label, overrides) => {
    const stats = simulate(cfg(overrides), 2000, `var-${label}`, { exhaustiveEvery: 20 });
    console.log(report(label, stats));
    expect(stats.games).toBe(2000);
  });
});
