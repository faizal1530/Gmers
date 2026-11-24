import { z } from "zod";
import type { Card, EndSide } from "@gmers/game-engine";

export type GameId = "gaple" | "ludo";
import type { ServerConfig } from "./config";

/** Pesan klien -> server. Klien hanya mengirim niat; server memutuskan. */
export function makeClientMessageSchema(cfg: Pick<ServerConfig, "nameMinLength" | "nameMaxLength" | "chatMaxLength">) {
  // Sengaja menolak karakter kontrol di nama dan chat.
  // eslint-disable-next-line no-control-regex
  const noControl = /^[^\u0000-\u001F\u007F]*$/;
  const token = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "token perangkat tidak valid");
  const name = z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(cfg.nameMinLength).max(cfg.nameMaxLength).regex(noControl));
  const groupId = z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,10}$/));
  const pip = z.number().int().min(0).max(6);
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("create_room"), name, token, game: z.enum(["gaple", "ludo"]).optional() }).strict(),
    z.object({ type: z.literal("open_link"), groupId, token }).strict(),
    z.object({ type: z.literal("join"), groupId, name, token, seat: z.number().int().min(0).max(3).optional() }).strict(),
    z.object({ type: z.literal("start") }).strict(),
    z.object({ type: z.literal("play"), card: z.tuple([pip, pip]), end: z.enum(["left", "right"]) }).strict(),
    z.object({ type: z.literal("pass") }).strict(),
    z.object({ type: z.literal("roll") }).strict(),
    z.object({ type: z.literal("pick"), pawn: z.number().int().min(0).max(3) }).strict(),
    z.object({ type: z.literal("set_game"), game: z.enum(["gaple", "ludo"]) }).strict(),
    z.object({ type: z.literal("set_ranked"), on: z.boolean() }).strict(),
    z.object({ type: z.literal("auth"), session: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    z.object({ type: z.literal("queue_ranked"), game: z.enum(["gaple", "ludo"]) }).strict(),
    z.object({ type: z.literal("cancel_queue") }).strict(),
    z.object({ type: z.literal("chat"), text: z.string().trim().min(1).max(cfg.chatMaxLength).regex(noControl) }).strict(),
    z.object({ type: z.literal("rematch") }).strict(),
    z.object({ type: z.literal("leave") }).strict(),
    z.object({ type: z.literal("nudge") }).strict(),
    z.object({ type: z.literal("ping") }).strict(),
  ]);
}

export type ClientMessage = z.infer<ReturnType<typeof makeClientMessageSchema>>;

export interface ProtocolError {
  type: "error";
  code: string;
  message: string;
}

export interface SeatView {
  seat: number;
  name: string;
  connected: boolean;
  /** Jumlah kartu di tangan (null di lobi). Isi kartu pemain lain tidak pernah dikirim. */
  cardsLeft: number | null;
  isYou: boolean;
  /** Punya akun (syarat Ranked). */
  registered: boolean;
}

export type MoveView = { type: "play"; card: Card; end: EndSide } | { type: "pass" } | { type: "roll" } | { type: "pick"; pawn: number };

export interface LudoView {
  dice: number | null;
  lastRoll: { seat: number; value: number } | null;
  lastCapture: { seat: number; pawn: number }[];
  /** Posisi bidak per pemain (kursi room): -1 kandang, 0..50 jalur, 51..55 lorong rumah, 56 finish. */
  players: { seat: number; start: number; pawns: number[] }[];
}

/** Bagian tampilan yang berbeda antar game. Isi yang tak berlaku untuk game itu kosong. */
export interface GameKindView {
  board: Card[];
  ends: { left: number; right: number } | null;
  yourHand: Card[];
  ludo: LudoView | null;
}

export interface GameView {
  kind: GameId;
  /** Posisi bidak dan dadu (hanya Ludo); null untuk game lain. */
  ludo: LudoView | null;
  /** Rantai di meja, kiri ke kanan, tiap kartu berorientasi [kiri, kanan]. */
  board: Card[];
  ends: { left: number; right: number } | null;
  /** Kursi room yang sedang giliran. */
  turn: number;
  /** Epoch ms batas giliran (jam server). */
  turnDeadline: number | null;
  yourHand: Card[];
  /** Langkah sah untukmu; kosong bila bukan gilirannya. */
  yourMoves: MoveView[];
  moveCount: number;
  result: null | {
    /** Hadiah game ini per pemain terdaftar (Trofi hanya di Ranked). Dihitung server. */
    rewards?: { seat: number; trofi: number; bintang: number; trofiTotal: number; kelas: string; kelasUp: string | null }[];
    /** out/blocked (Gaple), home (Ludo). */
    reason: string;
    winner: number;
    ranking: { seat: number; rank: number; points: number; cardsLeft: number }[];
  };
}

export interface StateMessage {
  type: "state";
  now: number;
  room: {
    /** Id sesi room (berubah tiap sesi baru). */
    id: string;
    /** Kode kelompok pada tautan (tetap). */
    groupId: string;
    phase: "lobby" | "playing" | "finished";
    /** Game yang dipilih untuk room ini. */
    gameId: GameId;
    /** Room Ranked: Trofi berubah di akhir game. Hanya untuk pemain yang semuanya punya akun. */
    ranked: boolean;
    gameNo: number;
    hostSeat: number;
    maxSeats: number;
    seats: (SeatView | null)[];
  };
  you: { seat: number };
  game: GameView | null;
}

export type ServerMessage =
  | StateMessage
  | ProtocolError
  | { type: "pong"; now: number }
  | { type: "left" }
  | { type: "auth_ok"; username: string; name: string }
  | { type: "queue"; state: "waiting" | "idle"; game: GameId | null; since: number | null }
  | { type: "match_found"; groupId: string }
  /** Dikirim ke pemain yang sedang ditunggu ("sundul"). */
  | { type: "nudge"; fromSeat: number; fromName: string }
  /** Konfirmasi ke pengirim sundulan. */
  | { type: "nudge_ack"; seat: number; name: string }
  | { type: "group_info"; groupId: string; phase: "none" | "lobby" | "playing" | "finished"; players: number; maxSeats: number; isMember: boolean }
  | { type: "chat"; seat: number; name: string; text: string; ts: number };
