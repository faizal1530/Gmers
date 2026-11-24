import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { defaultServerConfig, type ServerConfig } from "../src/config";
import type { Clock } from "../src/clock";
import type { ClientMessage, ServerMessage, StateMessage } from "../src/protocol";
import type { Conn } from "../src/service";

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  // Tiap konfigurasi uji memakai folder data sendiri agar log antar uji tidak bercampur.
  const dataDir = mkdtempSync(join(tmpdir(), "gmers-test-"));
  return { ...defaultServerConfig, port: 0, host: "127.0.0.1", eventsCsvFile: null, dataDir, passwordCost: 1024, ...overrides };
}

export function tok(i: number | string): string {
  return `token-perangkat-${String(i).padStart(6, "0")}`;
}

export class FakeClock implements Clock {
  t = 1_700_000_000_000;
  private timers: { at: number; fn: () => void; id: number; live: boolean }[] = [];
  private nextId = 0;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { at: this.t + ms, fn, id: this.nextId++, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.live = false;
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = target;
    this.timers = this.timers.filter((x) => x.live);
  }
}

let connCounter = 0;
export class FakeConn implements Conn {
  readonly id = `fake-${connCounter++}`;
  session: Conn["session"] = null;
  account: Conn["account"] = null;
  msgs: ServerMessage[] = [];
  closedWith: number | null = null;
  send(msg: ServerMessage): void {
    this.msgs.push(JSON.parse(JSON.stringify(msg)) as ServerMessage);
  }
  close(code = 1000): void {
    this.closedWith = code;
  }
  state(): StateMessage {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i] as ServerMessage;
      if (m.type === "state") return m;
    }
    throw new Error("belum ada state");
  }
  errors(): { code: string; message: string }[] {
    return this.msgs.flatMap((m) => (m.type === "error" ? [{ code: m.code, message: m.message }] : []));
  }
  lastError(): { code: string; message: string } | undefined {
    return this.errors().at(-1);
  }
}

// ---------- klien WebSocket nyata ----------

export class Client {
  msgs: ServerMessage[] = [];
  raw: string[] = [];
  private listeners: (() => void)[] = [];
  closed = false;
  closeCode: number | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.msgs.push(JSON.parse(text) as ServerMessage);
      for (const l of [...this.listeners]) l();
    });
    ws.on("close", (code) => {
      this.closed = true;
      this.closeCode = code;
      for (const l of [...this.listeners]) l();
    });
  }

  static async connect(port: number, opts: { autoPong?: boolean } = {}): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts.autoPong === false ? { autoPong: false } : {});
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new Client(ws);
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  state(): StateMessage | null {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i] as ServerMessage;
      if (m.type === "state") return m;
    }
    return null;
  }

  errors(): { code: string; message: string }[] {
    return this.msgs.flatMap((m) => (m.type === "error" ? [{ code: m.code, message: m.message }] : []));
  }

  waitFor<T>(check: () => T | null | undefined | false, ms = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const test = (): boolean => {
        const r = check();
        if (r) {
          cleanup();
          resolve(r);
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("waitFor melewati batas waktu"));
      }, ms);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== test);
      };
      if (!test()) this.listeners.push(test);
    });
  }

  waitState(pred: (s: StateMessage) => boolean, ms?: number): Promise<StateMessage> {
    return this.waitFor(() => {
      const s = this.state();
      return s && pred(s) ? s : null;
    }, ms);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

/** Pemain uji: memilih langkah acak dari yourMoves (bot hanya untuk uji). */
export function autoplay(client: Client, rng: () => number): void {
  let lastSent = -1;
  const handler = (): void => {
    const s = client.state();
    if (!s || !s.game || s.room.phase !== "playing") return;
    if (s.game.turn !== s.you.seat || s.game.yourMoves.length === 0) return;
    if (lastSent === s.game.moveCount) return;
    lastSent = s.game.moveCount;
    const move = s.game.yourMoves[Math.floor(rng() * s.game.yourMoves.length)];
    if (move) client.send(move);
  };
  client.ws.on("message", handler);
}

/** Kunci yang boleh muncul di pesan state; selain ini berarti kebocoran. */
export const STATE_KEYS = {
  top: ["type", "now", "room", "you", "game"],
  room: ["id", "groupId", "phase", "gameId", "ranked", "gameNo", "hostSeat", "maxSeats", "seats"],
  seat: ["seat", "name", "connected", "cardsLeft", "isYou", "registered"],
  game: ["kind", "ludo", "board", "ends", "turn", "turnDeadline", "yourHand", "yourMoves", "moveCount", "result"],
  result: ["rewards", "reason", "winner", "ranking"],
  reward: ["seat", "trofi", "bintang", "trofiTotal", "kelas", "kelasUp"],
  rank: ["seat", "rank", "points", "cardsLeft"],
};

export function assertStateShape(msg: StateMessage): void {
  const only = (obj: object, allowed: string[], where: string): void => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`Kunci tak diizinkan di ${where}: ${k}`);
  };
  only(msg, STATE_KEYS.top, "state");
  only(msg.room, STATE_KEYS.room, "room");
  for (const s of msg.room.seats) if (s) only(s, STATE_KEYS.seat, "seat");
  if (msg.game) {
    only(msg.game, STATE_KEYS.game, "game");
    if (msg.game.result) {
      only(msg.game.result, STATE_KEYS.result, "result");
      for (const r of msg.game.result.ranking) only(r, STATE_KEYS.rank, "rank");
      for (const r of msg.game.result.rewards ?? []) only(r, STATE_KEYS.reward, "reward");
    }
  }
}
