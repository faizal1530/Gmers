import type { ServerMessage, StateMessage } from "@gmers/server/protocol";
import type { SocketLike } from "../src/net";
import { App } from "../src/app";
import type { KV } from "../src/storage";

export class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** Putus dari sisi jaringan (bukan close() yang dipicu klien). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  types(): string[] {
    return this.sent.map((m) => String(m.type));
  }
}

export function memoryKV(initial: Record<string, string> = {}): KV & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

export interface Harness {
  app: App;
  root: HTMLElement;
  sockets: FakeSocket[];
  kv: ReturnType<typeof memoryKV>;
  sock(): FakeSocket;
  copied: string[];
}

export function mount(path = "/", kv = memoryKV(), opts: { copyOk?: boolean } = {}): Harness {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, "", path);
  const root = document.getElementById("app") as HTMLElement;
  const sockets: FakeSocket[] = [];
  const copied: string[] = [];
  const app = new App({
    root,
    kv,
    origin: "https://gmers.test",
    wsUrl: "ws://test/ws",
    makeSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    copy: async (t) => {
      copied.push(t);
      return opts.copyOk !== false;
    },
  });
  app.start();
  return { app, root, sockets, kv, sock: () => sockets[sockets.length - 1] as FakeSocket, copied };
}

type Seat = { name: string; connected?: boolean; cardsLeft?: number | null };

export function mkState(o: {
  phase?: "lobby" | "playing" | "finished";
  you?: number;
  turn?: number;
  hand?: [number, number][];
  moves?: StateMessage["game"] extends infer G ? (G extends { yourMoves: infer M } ? M : never) : never;
  board?: [number, number][];
  ends?: { left: number; right: number } | null;
  seats?: (Seat | null)[];
  hostSeat?: number;
  result?: NonNullable<StateMessage["game"]>["result"];
  groupId?: string;
  deadline?: number | null;
  now?: number;
}): StateMessage {
  const you = o.you ?? 0;
  const seats = o.seats ?? [{ name: "Andi" }, { name: "Budi" }, null, null];
  const phase = o.phase ?? "playing";
  return {
    type: "state",
    now: o.now ?? Date.now(),
    room: {
      id: o.groupId ?? "ABCDEF",
      groupId: o.groupId ?? "ABCDEF",
      phase,
      gameNo: phase === "lobby" ? 0 : 1,
      hostSeat: o.hostSeat ?? 0,
      maxSeats: 4,
      seats: seats.map((s, i) => (s ? { seat: i, name: s.name, connected: s.connected ?? true, cardsLeft: phase === "lobby" ? null : (s.cardsLeft ?? 7), isYou: i === you } : null)),
    },
    you: { seat: you },
    game:
      phase === "lobby"
        ? null
        : {
            board: o.board ?? [],
            ends: o.ends ?? null,
            turn: o.turn ?? 0,
            turnDeadline: o.deadline === undefined ? Date.now() + 60_000 : o.deadline,
            yourHand: o.hand ?? [[1, 2], [3, 4], [6, 6]],
            yourMoves: o.moves ?? [],
            moveCount: 0,
            result: o.result ?? null,
          },
  };
}

export const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();
export const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Elemen tidak ditemukan: ${sel}`);
  return el;
};
