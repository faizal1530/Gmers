import type { Card } from "@gmers/game-engine";
import type { MoveView, StateMessage } from "@gmers/server/protocol";

export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const CHAT_MAX = 300;
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 10_000;

// Sengaja mencocokkan karakter kontrol dan karakter tak terlihat untuk dibuang.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2066-\\u2069\\uFEFF]", "g");

/** Buang karakter kontrol dan karakter tak terlihat; rapikan spasi. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: "tooShort" | "tooLong" };

export function checkName(raw: string): NameCheck {
  const name = cleanText(raw);
  if (name.length < NAME_MIN) return { ok: false, reason: "tooShort" };
  if (name.length > NAME_MAX) return { ok: false, reason: "tooLong" };
  return { ok: true, name };
}

export type Route = { kind: "home" } | { kind: "link"; groupId: string } | { kind: "privacy" } | { kind: "notfound" };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return { kind: "home" };
  if (p === "/privasi") return { kind: "privacy" };
  const m = /^\/g\/([A-Za-z0-9]{4,10})$/.exec(p);
  if (m) return { kind: "link", groupId: (m[1] as string).toUpperCase() };
  return { kind: "notfound" };
}

export const cardKey = (c: Card): string => `${c[0]}|${c[1]}`;

export function playableKeys(moves: readonly MoveView[]): Set<string> {
  const s = new Set<string>();
  for (const m of moves) if (m.type === "play") s.add(cardKey(m.card));
  return s;
}

/** Ujung yang sah untuk satu kartu (dari langkah sah server). */
export function endOptions(moves: readonly MoveView[], card: Card): ("left" | "right")[] {
  const out: ("left" | "right")[] = [];
  for (const m of moves) {
    if (m.type === "play" && cardKey(m.card) === cardKey(card) && !out.includes(m.end)) out.push(m.end);
  }
  return out;
}

export const canPass = (moves: readonly MoveView[]): boolean => moves.some((m) => m.type === "pass");

export function isMyTurn(s: StateMessage): boolean {
  return !!s.game && s.room.phase === "playing" && s.game.turn === s.you.seat;
}

export function secondsLeft(deadline: number | null, serverNow: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

export function shareUrl(origin: string, groupId: string): string {
  return `${origin}/g/${groupId}`;
}

export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Pembatas laju kirim chat di sisi klien (server juga membatasi). */
export class ChatLimiter {
  private times: number[] = [];
  constructor(
    private readonly burst = CHAT_BURST,
    private readonly windowMs = CHAT_WINDOW_MS,
  ) {}
  tryAcquire(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.burst) return false;
    this.times.push(now);
    return true;
  }
}
