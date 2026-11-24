import {
  apply as gapleApply,
  canonical,
  createConfig as createGapleConfig,
  ends,
  init as gapleInit,
  isEngineError,
  legalMoves as gapleLegal,
  ludo,
  type EngineError,
  type GapleConfig,
  type GapleState,
  type Move as GapleMove,
} from "@gmers/game-engine";
import type { ServerConfig } from "./config";
import type { ClientMessage, GameId, GameKindView, MoveView } from "./protocol";

/** Hasil akhir yang dipahami room, apa pun gamenya. Kursi = kursi mesin (0..n-1). */
export interface Outcome {
  reason: string;
  winner: number;
  ranking: { seat: number; rank: number; points: number; cardsLeft: number }[];
}

/**
 * Antarmuka game untuk room. Room tidak tahu aturan: semua keputusan sah lewat adapter ke `packages/game-engine`.
 * Status dan langkah bertipe `unknown` di batas ini; tiap adapter menjaga tipenya sendiri.
 */
export interface GameAdapter {
  id: GameId;
  create(players: number, seed: string, openerEngineSeat: number | null, cfg: ServerConfig): { state: unknown; config: unknown };
  restore(config: unknown, seed: string): unknown;
  turn(state: unknown): number;
  moveCount(state: unknown): number;
  legal(state: unknown, seat: number): unknown[];
  apply(state: unknown, move: unknown): unknown | EngineError;
  /** Langkah otomatis saat waktu giliran habis. */
  auto(state: unknown, seat: number): unknown | null;
  outcome(state: unknown): Outcome | null;
  /** Bagian tampilan khusus game untuk satu pemain (tangan sendiri, posisi bidak, dst.). */
  view(state: unknown, mineEngineSeat: number, roomSeats: number[]): GameKindView;
  /** Tampilan langkah sah milik pemain. */
  moveViews(state: unknown, mineEngineSeat: number): MoveView[];
  /** Jumlah kartu atau bidak yang masih main untuk satu kursi (ditampilkan di kursi). */
  remaining(state: unknown, engineSeat: number): number;
  /** Ubah pesan klien menjadi langkah mesin (tanpa kursi); null bila pesan bukan untuk game ini. */
  fromClient(msg: ClientMessage): Record<string, unknown> | null;
}

export const gapleAdapter: GameAdapter = {
  id: "gaple",
  create(players, seed, opener, cfg) {
    const config: GapleConfig = createGapleConfig({ ...cfg.game, players: players as 2 | 3 | 4, openerSeat: opener });
    return { state: gapleInit(config, seed), config };
  },
  restore: (config, seed) => gapleInit(config as GapleConfig, seed),
  turn: (s) => (s as GapleState).turn,
  moveCount: (s) => (s as GapleState).log.length,
  legal: (s, seat) => gapleLegal(s as GapleState, seat),
  apply: (s, m) => gapleApply(s as GapleState, m as GapleMove),
  auto: (s, seat) => gapleLegal(s as GapleState, seat)[0] ?? null,
  outcome(s) {
    const r = (s as GapleState).result;
    return r ? { reason: r.reason, winner: r.winner, ranking: r.ranking.map((x) => ({ seat: x.seat, rank: x.rank, points: x.points, cardsLeft: x.cardsLeft })) } : null;
  },
  view(s, mine) {
    const st = s as GapleState;
    return { board: st.board, ends: ends(st), yourHand: mine >= 0 ? (st.hands[mine] ?? []) : [], ludo: null };
  },
  moveViews(s, mine) {
    if (mine < 0) return [];
    return gapleLegal(s as GapleState, mine).map((m) => (m.type === "pass" ? { type: "pass" as const } : { type: "play" as const, card: m.card, end: m.end }));
  },
  remaining: (s, seat) => (s as GapleState).hands[seat]?.length ?? 0,
  fromClient(msg) {
    if (msg.type === "play") return { type: "play", card: canonical(msg.card), end: msg.end };
    if (msg.type === "pass") return { type: "pass" };
    return null;
  },
};

export const ludoAdapter: GameAdapter = {
  id: "ludo",
  create(players, seed, opener, cfg) {
    const config = ludo.createLudoConfig({ ...cfg.ludo, players: players as 2 | 3 | 4, openerSeat: opener });
    return { state: ludo.init(config, seed), config };
  },
  restore: (config, seed) => ludo.init(config as ludo.LudoConfig, seed),
  turn: (s) => (s as ludo.LudoState).turn,
  moveCount: (s) => (s as ludo.LudoState).log.length,
  legal: (s, seat) => ludo.legalMoves(s as ludo.LudoState, seat),
  apply: (s, m) => ludo.apply(s as ludo.LudoState, m as ludo.LudoMove),
  auto: (s, seat) => ludo.autoMove(s as ludo.LudoState, seat),
  outcome(s) {
    const r = (s as ludo.LudoState).result;
    return r ? { reason: "home", winner: r.winner, ranking: r.ranking.map((x) => ({ seat: x.seat, rank: x.rank, points: x.score, cardsLeft: 4 - x.finished })) } : null;
  },
  view(s, _mine, roomSeats) {
    const st = s as ludo.LudoState;
    return {
      board: [],
      ends: null,
      yourHand: [],
      ludo: {
        dice: st.dice,
        lastRoll: st.lastRoll ? { seat: roomSeats[st.lastRoll.seat] as number, value: st.lastRoll.value } : null,
        lastCapture: st.lastCapture.map((c) => ({ seat: roomSeats[c.seat] as number, pawn: c.pawn })),
        players: st.pawns.map((pawns, i) => ({ seat: roomSeats[i] as number, start: ludo.startCell(st.config, i), pawns: pawns.slice() })),
      },
    };
  },
  moveViews(s, mine) {
    if (mine < 0) return [];
    return ludo.legalMoves(s as ludo.LudoState, mine).map((m) => (m.type === "roll" ? { type: "roll" as const } : { type: "pick" as const, pawn: m.pawn }));
  },
  remaining: (s, seat) => 4 - (s as ludo.LudoState).pawns[seat]!.filter((p) => p === ludo.FINISH).length,
  fromClient(msg) {
    if (msg.type === "roll") return { type: "roll" };
    if (msg.type === "pick") return { type: "move", pawn: msg.pawn };
    return null;
  },
};

const ADAPTERS: Record<GameId, GameAdapter> = { gaple: gapleAdapter, ludo: ludoAdapter };

export function adapterOf(id: GameId | undefined): GameAdapter {
  return ADAPTERS[id ?? "gaple"] ?? gapleAdapter;
}

export const GAME_IDS: GameId[] = ["gaple", "ludo"];
export { isEngineError };
