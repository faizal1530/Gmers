import { cardPips, compareCards, fullDeck, handPoints, isDouble, sameCard } from "./cards";
import { createConfig } from "./config";
import { createRng, shuffle } from "./rng";
import type {
  Card,
  EndSide,
  EngineError,
  GameResult,
  GameStatus,
  GapleConfig,
  GapleState,
  Move,
  RankEntry,
  Rng,
  Seat,
} from "./types";

export function isEngineError(x: unknown): x is EngineError {
  return typeof x === "object" && x !== null && "code" in x && "message" in x;
}

function fail(code: EngineError["code"], message: string): EngineError {
  return { code, message };
}

/** Ujung rantai, atau null bila meja kosong. */
export function ends(state: GapleState): { left: number; right: number } | null {
  const first = state.board[0];
  const last = state.board[state.board.length - 1];
  if (!first || !last) return null;
  return { left: first[0], right: last[1] };
}

export function nextSeat(config: GapleConfig, seat: Seat): Seat {
  const step = config.turnDirection === "clockwise" ? 1 : -1;
  return (seat + step + config.players) % config.players;
}

/** Jarak duduk dari pembuka searah arah main (0 = pembuka sendiri). */
function seatDistance(config: GapleConfig, opener: Seat, seat: Seat): number {
  let d = 0;
  let s = opener;
  while (s !== seat) {
    s = nextSeat(config, s);
    d++;
  }
  return d;
}

function sortHand(hand: Card[]): Card[] {
  return hand.slice().sort(compareCards);
}

/** Tentukan pembuka dan kartu wajibnya (null = bebas). */
function pickOpening(config: GapleConfig, hands: Card[][], rng: Rng): { seat: Seat; card: Card | null } {
  if (config.openerSeat !== null) return { seat: config.openerSeat, card: null };
  if (config.opening === "random") return { seat: Math.floor(rng() * config.players), card: null };

  const target: Card = config.opening === "sixSix" ? [6, 6] : [0, 0];
  let best: { seat: Seat; card: Card } | null = null;
  for (let seat = 0; seat < hands.length; seat++) {
    for (const card of hands[seat] as Card[]) {
      if (sameCard(card, target)) return { seat, card };
    }
  }
  // openingFallback: balak tertinggi; tanpa balak, jumlah titik tertinggi (seri: sisi tertinggi).
  const better = (c: Card, b: Card): boolean => {
    if (isDouble(c) !== isDouble(b)) return isDouble(c);
    if (isDouble(c)) return c[0] > b[0];
    return cardPips(c) > cardPips(b) || (cardPips(c) === cardPips(b) && c[1] > b[1]);
  };
  for (let seat = 0; seat < hands.length; seat++) {
    for (const card of hands[seat] as Card[]) {
      if (best === null || better(card, best.card)) best = { seat, card };
    }
  }
  if (best === null) throw new Error("Tidak ada kartu dibagikan");
  return best;
}

/** Bangun state dari tangan yang sudah ditentukan (dipakai `init` dan uji). */
export function initWithHands(
  configInput: GapleConfig,
  seed: string | number,
  hands: Card[][],
  discarded: Card[],
  rng: Rng = createRng(`${seed}:open`),
): GapleState {
  const config = createConfig(configInput);
  if (hands.length !== config.players) throw new RangeError("Jumlah tangan tidak sama dengan jumlah pemain");
  const sorted = hands.map(sortHand);
  const opening = pickOpening(config, sorted, rng);
  return {
    version: 1,
    config,
    seed,
    hands: sorted,
    discarded: sortHand(discarded),
    board: [],
    turn: opening.seat,
    opener: opening.seat,
    requiredOpening: opening.card,
    consecutivePasses: 0,
    log: [],
    result: null,
  };
}

/**
 * Mulai game. Pengacakan memakai RNG yang diinjeksi; bila `rng` tidak diberikan,
 * dipakai RNG deterministik dari `seed`, sehingga seed yang tercatat cukup untuk replay.
 */
export function init(configInput: GapleConfig, seed: string | number, rng: Rng = createRng(seed)): GapleState {
  const config = createConfig(configInput);
  const deck = shuffle(fullDeck(), rng);
  const hands: Card[][] = [];
  for (let seat = 0; seat < config.players; seat++) {
    hands.push(deck.slice(seat * config.handSize, (seat + 1) * config.handSize));
  }
  const discarded = deck.slice(config.players * config.handSize);
  return initWithHands(config, seed, hands, discarded, rng);
}

function playsFor(state: GapleState, seat: Seat): Move[] {
  const hand = state.hands[seat] as Card[];
  const e = ends(state);
  if (e === null) {
    const cards = state.requiredOpening ? hand.filter((c) => sameCard(c, state.requiredOpening as Card)) : hand;
    return cards.map((card) => ({ type: "play", seat, card, end: "left" }));
  }
  const moves: Move[] = [];
  for (const card of hand) {
    if (card[0] === e.left || card[1] === e.left) moves.push({ type: "play", seat, card, end: "left" });
    if (card[0] === e.right || card[1] === e.right) moves.push({ type: "play", seat, card, end: "right" });
  }
  return moves;
}

/** Langkah sah untuk `seat`. Kosong bila bukan gilirannya atau game selesai. */
export function legalMoves(state: GapleState, seat: Seat): Move[] {
  if (state.result !== null || seat !== state.turn) return [];
  const plays = playsFor(state, seat);
  if (state.board.length === 0) return plays;
  if (plays.length === 0) return [{ type: "pass", seat }];
  return state.config.mustPlayIfAble ? plays : [...plays, { type: "pass", seat }];
}

/** Terapkan langkah. Murni: `state` tidak diubah. */
export function apply(state: GapleState, move: Move): GapleState | EngineError {
  if (state.result !== null) return fail("GAME_OVER", "Game sudah selesai.");
  if (!Number.isInteger(move.seat) || move.seat < 0 || move.seat >= state.config.players) {
    return fail("BAD_SEAT", "Kursi tidak dikenal.");
  }
  if (move.seat !== state.turn) return fail("NOT_YOUR_TURN", "Belum giliranmu.");
  const hand = state.hands[move.seat] as Card[];
  const e = ends(state);

  let board = state.board;
  let newHand = hand;

  if (move.type === "pass") {
    if (e === null) return fail("CANNOT_PASS_ON_OPENING", "Pembuka harus memasang kartu.");
    if (state.config.mustPlayIfAble && playsFor(state, move.seat).length > 0) {
      return fail("MUST_PLAY", "Kamu punya kartu yang cocok, tidak boleh lewat.");
    }
  } else {
    const idx = hand.findIndex((c) => sameCard(c, move.card));
    if (idx < 0) return fail("CARD_NOT_IN_HAND", "Kartu itu tidak ada di tanganmu.");
    const card = hand[idx] as Card;
    if (move.end !== "left" && move.end !== "right") return fail("BAD_END", "Ujung harus kiri atau kanan.");
    if (e === null) {
      if (state.requiredOpening && !sameCard(card, state.requiredOpening)) {
        return fail(
          "MUST_OPEN_WITH_REQUIRED",
          `Pembuka harus memasang kartu ${state.requiredOpening[0]}|${state.requiredOpening[1]}.`,
        );
      }
      if (move.end !== "left") return fail("BAD_END", "Kartu pembuka dipasang di ujung kiri.");
      board = [[card[0], card[1]]];
    } else if (move.end === "left") {
      if (card[0] !== e.left && card[1] !== e.left) return fail("CARD_DOES_NOT_FIT", `Kartu tidak cocok dengan ujung kiri (${e.left}).`);
      const other = card[0] === e.left ? card[1] : card[0];
      board = [[other, e.left], ...board];
    } else {
      if (card[0] !== e.right && card[1] !== e.right) return fail("CARD_DOES_NOT_FIT", `Kartu tidak cocok dengan ujung kanan (${e.right}).`);
      const other = card[0] === e.right ? card[1] : card[0];
      board = [...board, [e.right, other]];
    }
    newHand = hand.filter((_, i) => i !== idx);
  }

  const hands = state.hands.map((h, i) => (i === move.seat ? newHand : h));
  const consecutivePasses = move.type === "pass" ? state.consecutivePasses + 1 : 0;
  const next: GapleState = {
    ...state,
    hands,
    board,
    requiredOpening: null,
    consecutivePasses,
    log: [...state.log, move],
    turn: nextSeat(state.config, move.seat),
  };

  if (move.type === "play" && newHand.length === 0) {
    return { ...next, result: computeResult(next, "out", move.seat) };
  }
  if (consecutivePasses >= state.config.players) {
    return { ...next, result: computeResult(next, "blocked", null) };
  }
  return next;
}

/** Kunci pembanding tie-break 1 dan 2: kartu tunggal sisa dengan titik terendah, lalu sisi terendahnya. */
function lowestSingleKey(hand: readonly Card[]): [number, number] {
  let best: [number, number] = [Infinity, Infinity];
  for (const card of hand) {
    const key: [number, number] = [cardPips(card), Math.min(card[0], card[1])];
    if (key[0] < best[0] || (key[0] === best[0] && key[1] < best[1])) best = key;
  }
  return best;
}

function computeResult(state: GapleState, reason: "out" | "blocked", outSeat: Seat | null): GameResult {
  const { config } = state;
  const entries = state.hands.map((hand, seat) => ({
    seat,
    points: handPoints(hand, config),
    cardsLeft: hand.length,
    key: lowestSingleKey(hand),
  }));
  const contenders = entries.filter((x) => x.seat !== outSeat);
  contenders.sort((x, y) => {
    if (x.points !== y.points) return x.points - y.points;
    if (x.key[0] !== y.key[0]) return x.key[0] - y.key[0];
    if (x.key[1] !== y.key[1]) return x.key[1] - y.key[1];
    return seatDistance(config, state.opener, x.seat) - seatDistance(config, state.opener, y.seat);
  });
  const ordered = outSeat === null ? contenders : [entries[outSeat] as (typeof entries)[number], ...contenders];
  const ranking: RankEntry[] = ordered.map((x, i) => ({
    seat: x.seat,
    rank: i + 1,
    points: x.points,
    cardsLeft: x.cardsLeft,
  }));
  return { reason, winner: (ranking[0] as RankEntry).seat, ranking };
}

export function status(state: GapleState): GameStatus {
  if (state.result === null) return { over: false, reason: null, winner: null, ranking: null };
  return { over: true, reason: state.result.reason, winner: state.result.winner, ranking: state.result.ranking };
}

/** Putar ulang log langkah dari seed. Mengembalikan error bila ada langkah ditolak. */
export function replay(config: GapleConfig, seed: string | number, moves: readonly Move[]): GapleState | EngineError {
  let state = init(config, seed);
  for (const move of moves) {
    const result = apply(state, move);
    if (isEngineError(result)) return result;
    state = result;
  }
  return state;
}

export type { EndSide };
