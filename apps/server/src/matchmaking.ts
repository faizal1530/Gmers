import type { Clock } from "./clock";
import type { EconomyConfig } from "./economy";
import type { GameId } from "./protocol";

export interface QueuedPlayer<C> {
  conn: C;
  accountId: string;
  since: number;
}

/**
 * Antrean Ranked lawan acak (tanpa lawan komputer). Per game: 4 pemain menunggu = langsung mulai; 2 atau 3 pemain
 * mulai setelah menunggu `queueWaitMs`. Mengurus hanya antrean; pembuatan room dilakukan lewat `start`.
 */
export class Matchmaker<C> {
  private readonly queues: Record<GameId, QueuedPlayer<C>[]> = { gaple: [], ludo: [] };
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly econ: Pick<EconomyConfig, "queueWaitMs">,
    private readonly start: (players: QueuedPlayer<C>[], game: GameId) => void,
  ) {}

  /** Antrean saat ini milik akun ini (game dan waktu mulai), atau null. */
  waiting(accountId: string): { game: GameId; since: number } | null {
    for (const game of Object.keys(this.queues) as GameId[]) {
      const q = this.queues[game].find((p) => p.accountId === accountId);
      if (q) return { game, since: q.since };
    }
    return null;
  }

  size(game: GameId): number {
    return this.queues[game].length;
  }

  enqueue(conn: C, accountId: string, game: GameId): { game: GameId; since: number } {
    this.remove(accountId);
    const entry = { conn, accountId, since: this.clock.now() };
    this.queues[game].push(entry);
    this.evaluate();
    return { game, since: entry.since };
  }

  /** Keluarkan akun dari antrean. Mengembalikan true bila memang sedang mengantre. */
  remove(accountId: string): boolean {
    let removed = false;
    for (const game of Object.keys(this.queues) as GameId[]) {
      const before = this.queues[game].length;
      this.queues[game] = this.queues[game].filter((p) => p.accountId !== accountId);
      removed ||= this.queues[game].length !== before;
    }
    if (removed) this.evaluate();
    return removed;
  }

  /** Koneksi putus: semua entri milik koneksi itu dibuang. */
  dropConn(conn: C): void {
    let removed = false;
    for (const game of Object.keys(this.queues) as GameId[]) {
      const before = this.queues[game].length;
      this.queues[game] = this.queues[game].filter((p) => p.conn !== conn);
      removed ||= this.queues[game].length !== before;
    }
    if (removed) this.evaluate();
  }

  stop(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private evaluate(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const now = this.clock.now();
    let nextAt: number | null = null;
    for (const game of Object.keys(this.queues) as GameId[]) {
      for (;;) {
        const q = this.queues[game];
        if (q.length >= 4) {
          this.take(game, 4);
          continue;
        }
        const first = q[0];
        if (q.length >= 2 && first) {
          const ready = first.since + this.econ.queueWaitMs;
          if (now >= ready) {
            this.take(game, q.length);
            continue;
          }
          nextAt = nextAt === null ? ready : Math.min(nextAt, ready);
        }
        break;
      }
    }
    if (nextAt !== null) this.cancelTimer = this.clock.setTimeout(() => this.evaluate(), Math.max(1, nextAt - now));
  }

  private take(game: GameId, n: number): void {
    const players = this.queues[game].splice(0, n);
    this.start(players, game);
  }
}
