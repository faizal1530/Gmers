import { describe, expect, it } from "vitest";
import { apply, createRng, init, isEngineError, legalMoves, replay, status } from "../src";
import type { GapleConfig, GapleState, Move } from "../src";
import { cfg, checkChain, checkConservation, deepFreeze, playRandomGame } from "./support";

const configs: GapleConfig[] = [2, 3, 4].map((players) => cfg({ players: players as 2 | 3 | 4 }));

describe("uji properti", () => {
  it.each(configs)("konservasi 28 kartu di setiap langkah ($players pemain)", (config) => {
    for (let i = 0; i < 300; i++) playRandomGame(config, `kons-${config.players}-${i}`, false);
  });

  it.each(configs)("apply murni: state masukan beku tidak berubah dan hasil tidak berbagi dengan masukan ($players pemain)", (config) => {
    for (let i = 0; i < 100; i++) {
      const pick = createRng(`murni-${i}`);
      let state: GapleState = init(config, `murni-${config.players}-${i}`);
      while (state.result === null) {
        const frozen = deepFreeze(state);
        const snapshot = JSON.stringify(frozen);
        const legal = legalMoves(frozen, frozen.turn);
        const move = legal[Math.floor(pick() * legal.length)] as Move;
        const next = apply(frozen, move);
        if (isEngineError(next)) throw new Error(next.code);
        expect(JSON.stringify(frozen)).toBe(snapshot);
        expect(next).not.toBe(frozen);
        state = JSON.parse(JSON.stringify(next)) as GapleState; // state harus serializable JSON
        checkConservation(state);
        checkChain(state);
      }
    }
  });

  it.each(configs)("replay dari seed + log menghasilkan state akhir identik ($players pemain)", (config) => {
    for (let i = 0; i < 200; i++) {
      const seed = `replay-${config.players}-${i}`;
      const final = playRandomGame(config, seed, false);
      const log = JSON.parse(JSON.stringify(final.log)) as Move[];
      const replayed = replay(config, seed, log);
      expect(isEngineError(replayed)).toBe(false);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
    }
  });

  it("replay dengan langkah ilegal mengembalikan error", () => {
    const r = replay(cfg(), "x", [{ type: "pass", seat: 0 }]);
    expect(isEngineError(r)).toBe(true);
  });

  it("langkah apa pun diterima iff ada di legalMoves (semua kartu x ujung x kursi, termasuk di luar rentang)", () => {
    for (const config of configs) {
      for (let i = 0; i < 50; i++) playRandomGame(config, `iff-${config.players}-${i}`, true);
    }
  });

  it("status selalu memberi peringkat 1..n lengkap saat selesai, null saat berjalan", () => {
    const s0 = init(cfg(), "stat");
    expect(status(s0)).toEqual({ over: false, reason: null, winner: null, ranking: null });
    const done = playRandomGame(cfg(), "stat", false);
    const st = status(done);
    expect(st.over).toBe(true);
    expect(st.ranking?.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});
