import { z } from "zod";
import type { Card, EndSide } from "@gmers/game-engine";
import type { ServerConfig } from "./config";

/** Pesan klien -> server. Klien hanya mengirim niat; server memutuskan. */
export function makeClientMessageSchema(cfg: Pick<ServerConfig, "nameMaxLength" | "chatMaxLength">) {
  const noControl = /^[^\u0000-\u001F\u007F]*$/;
  const token = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "token perangkat tidak valid");
  const name = z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1).max(cfg.nameMaxLength).regex(noControl));
  const roomId = z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,10}$/));
  const pip = z.number().int().min(0).max(6);
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("create_room"), name, token }).strict(),
    z.object({ type: z.literal("join"), roomId, name, token, seat: z.number().int().min(0).max(3).optional() }).strict(),
    z.object({ type: z.literal("start") }).strict(),
    z.object({ type: z.literal("play"), card: z.tuple([pip, pip]), end: z.enum(["left", "right"]) }).strict(),
    z.object({ type: z.literal("pass") }).strict(),
    z.object({ type: z.literal("chat"), text: z.string().trim().min(1).max(cfg.chatMaxLength).regex(noControl) }).strict(),
    z.object({ type: z.literal("rematch") }).strict(),
    z.object({ type: z.literal("leave") }).strict(),
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
}

export type MoveView = { type: "play"; card: Card; end: EndSide } | { type: "pass" };

export interface GameView {
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
    reason: "out" | "blocked";
    winner: number;
    ranking: { seat: number; rank: number; points: number; cardsLeft: number }[];
  };
}

export interface StateMessage {
  type: "state";
  now: number;
  room: {
    id: string;
    phase: "lobby" | "playing" | "finished";
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
  | { type: "chat"; seat: number; name: string; text: string; ts: number };
