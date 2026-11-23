import type { ClientMessage, ServerMessage } from "@gmers/server/protocol";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ClientOptions {
  url: string;
  makeSocket?: (url: string) => SocketLike;
  /** Pesan yang dikirim tiap kali koneksi terbuka (mis. join dengan token yang sama). */
  onOpenMessages: () => ClientMessage[];
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnStatus) => void;
  pingEveryMs?: number;
  staleAfterMs?: number;
}

const OPEN = 1;

/** Klien WebSocket dengan sambung ulang otomatis (backoff), ping berkala, dan pemicu saat jaringan berpindah. */
export class GameClient {
  status: ConnStatus = "connecting";
  private socket: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = Date.now();
  private stopped = false;
  private everOpened = false;
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly opts: ClientOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
    this.pingTimer = setInterval(() => this.heartbeat(), this.opts.pingEveryMs ?? 20_000);
    if (typeof window !== "undefined") {
      const kick = (): void => this.kick();
      window.addEventListener("online", kick);
      const vis = (): void => {
        if (document.visibilityState === "visible") this.kick();
      };
      document.addEventListener("visibilitychange", vis);
      this.listeners.push(
        () => window.removeEventListener("online", kick),
        () => document.removeEventListener("visibilitychange", vis),
      );
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.listeners.splice(0).forEach((off) => off());
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
    this.setStatus("closed");
  }

  get isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  /** Kirim bila terbuka. Langkah tidak diantre: giliran bisa sudah berganti saat tersambung kembali. */
  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  /** Sambung sekarang bila belum terbuka (jaringan berpindah atau tab kembali aktif). */
  kick(): void {
    if (this.stopped || this.isOpen) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  private setStatus(status: ConnStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus(status);
  }

  private connect(): void {
    if (this.stopped) return;
    const old = this.socket;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      old.close();
    }
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    const make = this.opts.makeSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = make(this.opts.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.everOpened = true;
      this.lastMessageAt = Date.now();
      this.setStatus("open");
      for (const m of this.opts.onOpenMessages()) this.send(m);
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      try {
        this.opts.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        // pesan rusak diabaikan
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      this.setStatus("reconnecting");
      const delay = Math.min(500 * 2 ** this.attempt, 5000);
      this.attempt++;
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => {
      // onclose menyusul dan mengurus sambung ulang
    };
  }

  private heartbeat(): void {
    if (this.stopped) return;
    if (this.isOpen) {
      if (Date.now() - this.lastMessageAt > (this.opts.staleAfterMs ?? 50_000)) {
        this.socket?.close();
        return;
      }
      this.send({ type: "ping" });
    } else {
      this.kick();
    }
  }
}
