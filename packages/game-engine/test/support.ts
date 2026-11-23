import { apply, createConfig, createRng, fullDeck, init, isEngineError, legalMoves, status } from "../src";
import type { Card, GapleConfig, GapleState, Move } from "../src";

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

export function cfg(overrides: Partial<GapleConfig> = {}): GapleConfig {
  return createConfig(overrides);
}

export function cardKeys(cards: Card[]): string[] {
  return cards.map((c) => `${c[0]}|${c[1]}`).sort();
}

const ALL_KEYS = cardKeys(fullDeck());

/** Konservasi: tangan + meja + sisihan = 28 kartu unik yang sama dengan set penuh. */
export function checkConservation(state: GapleState): void {
  const all: Card[] = [...state.hands.flat(), ...state.discarded, ...state.board.map((c): Card => (c[0] <= c[1] ? [c[0], c[1]] : [c[1], c[0]]))];
  const keys = cardKeys(all);
  if (keys.length !== 28 || keys.join() !== ALL_KEYS.join()) {
    throw new Error(`Konservasi kartu dilanggar: ${keys.length} kartu`);
  }
}

/** Rantai harus konsisten: sisi bersentuhan sama. */
export function checkChain(state: GapleState): void {
  for (let i = 1; i < state.board.length; i++) {
    const prev = state.board[i - 1] as Card;
    const cur = state.board[i] as Card;
    if (prev[1] !== cur[0]) throw new Error(`Rantai putus di indeks ${i}`);
  }
}

export interface SimStats {
  games: number;
  out: number;
  blocked: number;
  fallbackOpenings: number;
  totalMoves: number;
  maxMoves: number;
}

export interface SimOptions {
  /** Periksa bahwa setiap langkah kandidat (semua kartu x ujung x lewat x semua kursi) diterima iff ada di legalMoves. */
  exhaustiveEvery?: number;
}

function allCandidates(state: GapleState): Move[] {
  const out: Move[] = [];
  for (let seat = -1; seat <= state.config.players; seat++) {
    out.push({ type: "pass", seat });
    for (const card of fullDeck()) {
      out.push({ type: "play", seat, card, end: "left" });
      out.push({ type: "play", seat, card, end: "right" });
    }
  }
  return out;
}

const key = (m: Move): string => JSON.stringify(m);

/** Mainkan satu game dengan pemain acak yang hanya memilih langkah dari legalMoves, sambil memeriksa semua invarian. */
export function playRandomGame(config: GapleConfig, seed: string | number, exhaustive: boolean): GapleState {
  const pick = createRng(`pilih:${seed}`);
  let state = init(config, seed);
  checkConservation(state);
  const cap = 200;
  for (let step = 0; ; step++) {
    if (step > cap) throw new Error(`Kebuntuan: game ${seed} melewati ${cap} langkah`);
    if (state.result !== null) break;
    const legal = legalMoves(state, state.turn);
    if (legal.length === 0) throw new Error(`Kebuntuan: kursi ${state.turn} tanpa langkah sah (game ${seed})`);
    for (let s = 0; s < config.players; s++) {
      if (s !== state.turn && legalMoves(state, s).length !== 0) throw new Error("Kursi di luar giliran punya langkah");
    }
    if (exhaustive) {
      const legalSet = new Set(legal.map(key));
      const before = JSON.stringify(state);
      for (const cand of allCandidates(state)) {
        const r = apply(state, cand);
        const accepted = !isEngineError(r);
        if (accepted !== legalSet.has(key(cand))) {
          throw new Error(`Ketidakcocokan apply/legalMoves untuk ${key(cand)} (game ${seed})`);
        }
      }
      if (JSON.stringify(state) !== before) throw new Error("apply mengubah state masukan");
    }
    const move = legal[Math.floor(pick() * legal.length)] as Move;
    const next = apply(state, move);
    if (isEngineError(next)) throw new Error(`Langkah sah ditolak: ${next.code}`);
    state = next;
    checkConservation(state);
    checkChain(state);
  }
  const st = status(state);
  const n = config.players;
  if (!st.ranking || st.ranking.length !== n) throw new Error("Peringkat tidak lengkap");
  const ranks = st.ranking.map((r) => r.rank).join();
  if (ranks !== Array.from({ length: n }, (_, i) => i + 1).join()) throw new Error(`Peringkat bukan 1..n: ${ranks}`);
  if (new Set(st.ranking.map((r) => r.seat)).size !== n) throw new Error("Kursi ganda di peringkat");
  return state;
}

export function simulate(config: GapleConfig, games: number, prefix: string, opts: SimOptions = {}): SimStats {
  const stats: SimStats = { games: 0, out: 0, blocked: 0, fallbackOpenings: 0, totalMoves: 0, maxMoves: 0 };
  const every = opts.exhaustiveEvery ?? 0;
  for (let i = 0; i < games; i++) {
    const seed = `${prefix}-${config.players}-${i}`;
    const final = playRandomGame(config, seed, every > 0 && i % every === 0);
    stats.games++;
    if (final.result?.reason === "out") stats.out++;
    else stats.blocked++;
    stats.totalMoves += final.log.length;
    stats.maxMoves = Math.max(stats.maxMoves, final.log.length);
    const first = final.log[0];
    if (first && first.type === "play" && config.openerSeat === null && config.opening === "sixSix" && !(first.card[0] === 6 && first.card[1] === 6)) {
      stats.fallbackOpenings++;
    }
  }
  return stats;
}
