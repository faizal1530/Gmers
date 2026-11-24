/**
 * Mesin Ludo (spesifikasi 7.4): jalur 52 petak, 4 bidak per pemain, keluar kandang dengan angka 6,
 * angka 6 dan memakan bidak memberi giliran tambahan, petak aman tidak bisa dimakan, finish tepat di 56.
 * TypeScript murni dan deterministik: dadu berasal dari seed + nomor lemparan, jadi seed + log cukup untuk replay.
 */
import { createRng } from "./rng";
import type { EngineError, Seat } from "./types";

export interface LudoConfig {
  players: 2 | 3 | 4;
  /** Kursi yang jalan pertama; null = kursi 0. */
  openerSeat: Seat | null;
  /** Angka 6 memberi giliran tambahan setelah bidak digerakkan. */
  extraTurnOnSix: boolean;
  /** Memakan bidak lawan memberi giliran tambahan. */
  extraTurnOnCapture: boolean;
  /** Finish harus tepat di 56 (lemparan berlebih tidak sah). */
  exactFinish: boolean;
}

export const DEFAULT_LUDO_CONFIG: LudoConfig = {
  players: 4,
  openerSeat: null,
  extraTurnOnSix: true,
  extraTurnOnCapture: true,
  exactFinish: true,
};

export type LudoMove = { type: "roll"; seat: Seat } | { type: "move"; seat: Seat; pawn: number };

export interface LudoRank {
  seat: Seat;
  /** 1..n, selalu unik. */
  rank: number;
  /** Jumlah kemajuan bidak (kandang dihitung 0); dipakai urutan setelah pemenang. */
  score: number;
  finished: number;
}

export interface LudoResult {
  winner: Seat;
  ranking: LudoRank[];
}

/** State serializable JSON. Perlakukan sebagai tidak berubah; `apply` selalu mengembalikan objek baru. */
export interface LudoState {
  version: 1;
  config: LudoConfig;
  seed: string | number;
  /** pawns[kursi][bidak] = kemajuan: -1 kandang, 0..50 jalur bersama, 51..55 lorong rumah, 56 finish. */
  pawns: number[][];
  turn: Seat;
  /** Angka dadu yang sudah dilempar giliran ini dan menunggu pilihan bidak; null = belum melempar. */
  dice: number | null;
  /** Jumlah lemparan sejauh ini (indeks RNG dadu). */
  rolls: number;
  lastRoll: { seat: Seat; value: number } | null;
  /** Bidak yang dimakan pada langkah terakhir: [kursi, bidak] (untuk animasi dan pesan). */
  lastCapture: { seat: Seat; pawn: number }[];
  log: LudoMove[];
  result: LudoResult | null;
}

export const TRACK = 52;
export const FINISH = 56;
export const LAST_SHARED = 50;
export const SAFE_CELLS: readonly number[] = [0, 13, 26, 39, 8, 21, 34, 47];

export function isLudoError(x: unknown): x is EngineError {
  return typeof x === "object" && x !== null && "code" in x && "message" in x;
}

const fail = (code: EngineError["code"] | string, message: string): EngineError => ({ code: code as EngineError["code"], message });

/** Petak awal tiap kursi: 4 pemain di 0, 13, 26, 39; 2 pemain berhadapan di 0 dan 26. */
export function startCell(config: Pick<LudoConfig, "players">, seat: Seat): number {
  return config.players === 2 ? seat * 26 : seat * 13;
}

/** Petak absolut di jalur bersama (0..51) untuk kemajuan 0..50; null bila di kandang, lorong rumah, atau finish. */
export function absCell(config: Pick<LudoConfig, "players">, seat: Seat, progress: number): number | null {
  if (progress < 0 || progress > LAST_SHARED) return null;
  return (startCell(config, seat) + progress) % TRACK;
}

const nextSeat = (config: LudoConfig, seat: Seat): Seat => (seat + 1) % config.players;

export function validateLudoConfig(c: LudoConfig): string[] {
  const errors: string[] = [];
  if (![2, 3, 4].includes(c.players)) errors.push("players harus 2, 3, atau 4");
  if (c.openerSeat !== null && !(Number.isInteger(c.openerSeat) && c.openerSeat >= 0 && c.openerSeat < c.players)) errors.push("openerSeat di luar rentang");
  return errors;
}

export function createLudoConfig(overrides: Partial<LudoConfig> = {}): LudoConfig {
  const config = { ...DEFAULT_LUDO_CONFIG, ...overrides };
  const errors = validateLudoConfig(config);
  if (errors.length > 0) throw new RangeError(`Konfigurasi Ludo tidak valid: ${errors.join("; ")}`);
  return config;
}

/** Bangun state dari posisi bidak tertentu (dipakai `init` dan uji). */
export function fromPawns(configInput: LudoConfig, seed: string | number, pawns: number[][], turn: Seat, dice: number | null = null, rolls = 0): LudoState {
  const config = createLudoConfig(configInput);
  return { version: 1, config, seed, pawns: pawns.map((p) => p.slice()), turn, dice, rolls, lastRoll: null, lastCapture: [], log: [], result: null };
}

export function init(configInput: LudoConfig, seed: string | number): LudoState {
  const config = createLudoConfig(configInput);
  const pawns = Array.from({ length: config.players }, () => [-1, -1, -1, -1]);
  return fromPawns(config, seed, pawns, config.openerSeat ?? 0);
}

/** Angka dadu ke-n, deterministik dari seed. */
export function diceValue(seed: string | number, n: number): number {
  return Math.floor(createRng(`${seed}:dadu:${n}`)() * 6) + 1;
}

/** Kemajuan baru bila bidak digerakkan sejauh d; null bila tidak sah. */
function advance(config: LudoConfig, progress: number, d: number): number | null {
  if (progress === -1) return d === 6 ? 0 : null;
  if (progress >= FINISH) return null;
  const np = progress + d;
  if (np > FINISH) return config.exactFinish ? null : FINISH;
  return np;
}

function movesFor(state: LudoState, seat: Seat, d: number): LudoMove[] {
  const moves: LudoMove[] = [];
  let yardOffered = false;
  (state.pawns[seat] as number[]).forEach((p, pawn) => {
    if (advance(state.config, p, d) === null) return;
    if (p === -1) {
      if (yardOffered) return; // bidak kandang setara; tawarkan satu saja
      yardOffered = true;
    }
    moves.push({ type: "move", seat, pawn });
  });
  return moves;
}

/** Langkah sah untuk `seat`: melempar dadu, atau memilih bidak setelah lemparan. Kosong bila bukan giliran atau game selesai. */
export function legalMoves(state: LudoState, seat: Seat): LudoMove[] {
  if (state.result !== null || seat !== state.turn) return [];
  if (state.dice === null) return [{ type: "roll", seat }];
  return movesFor(state, seat, state.dice);
}

function rankResult(state: LudoState, winner: Seat): LudoResult {
  const rows = state.pawns.map((ps, seat) => ({
    seat,
    score: ps.reduce((s, p) => s + Math.max(0, p), 0),
    finished: ps.filter((p) => p === FINISH).length,
  }));
  const others = rows.filter((r) => r.seat !== winner).sort((a, b) => b.score - a.score || b.finished - a.finished || a.seat - b.seat);
  const ordered = [rows[winner] as (typeof rows)[number], ...others];
  const ranking: LudoRank[] = ordered.map((r, i) => ({ seat: r.seat, rank: i + 1, score: r.score, finished: r.finished }));
  return { winner, ranking };
}

/** Terapkan langkah. Murni: `state` tidak diubah. Dadu dilempar oleh mesin, bukan oleh klien. */
export function apply(state: LudoState, move: LudoMove): LudoState | EngineError {
  if (state.result !== null) return fail("GAME_OVER", "Game sudah selesai.");
  if (!Number.isInteger(move.seat) || move.seat < 0 || move.seat >= state.config.players) return fail("BAD_SEAT", "Kursi tidak dikenal.");
  if (move.seat !== state.turn) return fail("NOT_YOUR_TURN", "Belum giliranmu.");

  if (move.type === "roll") {
    if (state.dice !== null) return fail("MUST_MOVE", "Pilih bidak yang digerakkan dulu.");
    const value = diceValue(state.seed, state.rolls);
    const base: LudoState = { ...state, rolls: state.rolls + 1, lastRoll: { seat: move.seat, value }, lastCapture: [], log: [...state.log, move] };
    if (movesFor(base, move.seat, value).length === 0) {
      // Tidak ada langkah sah: giliran lewat otomatis.
      return { ...base, dice: null, turn: nextSeat(state.config, move.seat) };
    }
    return { ...base, dice: value };
  }

  if (move.type !== "move") return fail("BAD_MOVE", "Langkah tidak dikenal.");
  if (state.dice === null) return fail("MUST_ROLL", "Lempar dadu dulu.");
  if (!Number.isInteger(move.pawn) || move.pawn < 0 || move.pawn > 3) return fail("BAD_PAWN", "Bidak tidak dikenal.");
  if (!movesFor(state, move.seat, state.dice).some((m) => m.type === "move" && m.pawn === move.pawn)) {
    return fail("ILLEGAL_MOVE", "Bidak itu tidak bisa digerakkan dengan angka ini.");
  }
  const pawn = move.pawn;
  const mine = state.pawns[move.seat] as number[];
  const np = advance(state.config, mine[pawn] as number, state.dice) as number;

  const pawns = state.pawns.map((ps) => ps.slice());
  (pawns[move.seat] as number[])[pawn] = np;
  const captured: { seat: Seat; pawn: number }[] = [];
  const cell = absCell(state.config, move.seat, np);
  if (cell !== null && !SAFE_CELLS.includes(cell)) {
    pawns.forEach((ps, seat) => {
      if (seat === move.seat) return;
      ps.forEach((p, i) => {
        if (absCell(state.config, seat, p) === cell) {
          ps[i] = -1;
          captured.push({ seat, pawn: i });
        }
      });
    });
  }

  const next: LudoState = { ...state, pawns, dice: null, lastCapture: captured, log: [...state.log, { type: "move", seat: move.seat, pawn }] };
  if ((pawns[move.seat] as number[]).every((p) => p === FINISH)) return { ...next, result: rankResult(next, move.seat) };
  const extra = (state.dice === 6 && state.config.extraTurnOnSix) || (captured.length > 0 && state.config.extraTurnOnCapture);
  return { ...next, turn: extra ? move.seat : nextSeat(state.config, move.seat) };
}

export interface LudoStatus {
  over: boolean;
  winner: Seat | null;
  ranking: LudoRank[] | null;
}

export function status(state: LudoState): LudoStatus {
  return state.result === null ? { over: false, winner: null, ranking: null } : { over: true, winner: state.result.winner, ranking: state.result.ranking };
}

/** Putar ulang log langkah dari seed. */
export function replay(config: LudoConfig, seed: string | number, moves: readonly LudoMove[]): LudoState | EngineError {
  let state = init(config, seed);
  for (const m of moves) {
    const r = apply(state, m);
    if (isLudoError(r)) return r;
    state = r;
  }
  return state;
}

/** Pilihan otomatis saat waktu giliran habis: lempar dadu; atau bidak yang memakan, finish, atau paling maju. */
export function autoMove(state: LudoState, seat: Seat): LudoMove | null {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return null;
  const first = moves[0] as LudoMove;
  if (first.type === "roll" || state.dice === null) return first;
  const d = state.dice;
  let best = first;
  let bestScore = -Infinity;
  for (const m of moves) {
    if (m.type !== "move") continue;
    const p = (state.pawns[seat] as number[])[m.pawn] as number;
    const np = advance(state.config, p, d) as number;
    const r = apply(state, m);
    const captured = !isLudoError(r) && r.lastCapture.length > 0;
    const score = (np === FINISH ? 1000 : 0) + (captured ? 500 : 0) + (p === -1 ? 100 : 0) + np;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
