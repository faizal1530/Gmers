import { createHash, randomBytes, randomInt } from "node:crypto";
import { isEngineError, type EngineError } from "@gmers/game-engine";
import { adapterOf, GAME_IDS, type GameAdapter } from "./games";
import { Matchmaker, type QueuedPlayer } from "./matchmaking";
import type { Reward, SettleInput } from "./progress";
import { realClock, type Clock } from "./clock";
import type { ServerConfig } from "./config";
import { NoopEventSink, type EventName, type EventSink } from "./events";
import type { ClientMessage, GameId, GameView, ProtocolError, ServerMessage, StateMessage } from "./protocol";
import type { LogRecord, RoomLog } from "./store";
import { MemoryRoomLog } from "./store";

/** Satu koneksi klien. Lapisan WebSocket mengimplementasikannya; uji memakai versi palsu. */
export interface Conn {
  readonly id: string;
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
  session: { roomId: string; tokenHash: string } | null;
  /** Akun yang sudah masuk lewat `auth` pada koneksi ini (null = tamu). */
  account: { id: string; username: string; name: string; token: string } | null;
}

interface Member {
  seat: number;
  tokenHash: string;
  name: string;
  conn: Conn | null;
  /** Waktu pesan chat terakhir (untuk pembatas laju). */
  chatTimes: number[];
  lastNudge: number | null;
}

interface ActiveGame {
  adapter: GameAdapter;
  /** Status mesin. Bentuknya milik tiap adapter game; room hanya meneruskannya, jadi sengaja `any` di batas ini. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  /** roomSeats[kursiMesin] = kursi room. */
  roomSeats: number[];
  /** Hash perangkat (16 hex) tiap pemain game ini, urut kursi room. Hanya untuk metrik. */
  devices: string[];
  deadline: number | null;
  cancelTimer: (() => void) | null;
  /** Room Ranked saat game ini dimulai. */
  ranked: boolean;
  /** Hadiah game ini per kursi room (setelah game selesai). */
  rewards: { seat: number; trofi: number; bintang: number; trofiTotal: number; kelas: string; kelasUp: string | null }[];
}

/** Kelompok = kode pada tautan. Tidak pernah kedaluwarsa; sesi room di bawahnya boleh dibersihkan dan dibuat ulang. */
interface Group {
  id: string;
  createdAt: number;
  liveRoomId: string | null;
}

export interface Room {
  /** Id sesi. Sesi pertama memakai kode kelompok; sesi berikutnya `${kode}-${waktu}`. */
  id: string;
  groupId: string;
  lastActivity: number;
  hostSeat: number;
  seats: (Member | null)[];
  phase: "lobby" | "playing" | "finished";
  /** Game yang dipilih untuk sesi ini (bisa diganti pemilik di lobi atau setelah game selesai). */
  gameId: GameId;
  /** Room Ranked (Trofi berubah). */
  ranked: boolean;
  /** Giliran berturut-turut yang dimainkan otomatis per kursi room (tanda meninggalkan game). */
  autoStreak: Map<number, number>;
  gameNo: number;
  game: ActiveGame | null;
  lastWinnerSeat: number | null;
  /** Live: room boleh ditonton, kunci tonton (bukan kode kelompok), penonton, dan bingkai tertunda. */
  watchable: boolean;
  watchKey: string;
  spectators: Map<Conn, { name: string; lastChat: number }>;
  frames: { ts: number; msg: StateMessage }[];
}

/** Kaitan ke layanan akun dan ekonomi. Semua opsional: tanpa kaitan, room berjalan sebagai tamu semua. */
export interface Hooks {
  authenticate?(session: string): { id: string; username: string; name: string; token: string } | null;
  accountIdOf?(tokenHash: string): string | null;
  /** Catat hasil game (Trofi, Bintang). Mengembalikan hadiah per akun. */
  settle?(input: SettleInput): Reward[];
  /** Pesan 1-1, ajakan main, dan notifikasi (lihat SocialHub). */
  social?: {
    attach(conn: Conn): void;
    detach(conn: Conn): void;
    handle(conn: Conn, msg: { type: string; [k: string]: unknown }): void;
  };
}

export interface ServiceDeps {
  hooks?: Hooks;
  clock?: Clock;
  log?: RoomLog;
  events?: EventSink;
  /** Pembangkit kode kelompok. */
  newGroupId?: () => string;
  newSeed?: () => string;
  /** Dipanggil saat sebuah perangkat duduk di kelompok (untuk daftar room akun). */
  onSeat?: (tokenHash: string, groupId: string) => void;
}

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function defaultRoomId(): string {
  let id = "";
  for (let i = 0; i < 6; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

export function hashToken(token: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

function err(code: string, message: string): ProtocolError {
  return { type: "error", code, message };
}

export class RoomService {
  readonly rooms = new Map<string, Room>();
  readonly groups = new Map<string, Group>();
  private readonly clock: Clock;
  private readonly log: RoomLog;
  private readonly events: EventSink;
  private readonly newGroupId: () => string;
  private readonly newSeed: () => string;
  private readonly hooks: Hooks;
  private readonly matchmaker: Matchmaker<Conn>;
  private readonly onSeat: ((tokenHash: string, groupId: string) => void) | undefined;
  private cancelSweep: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly cfg: ServerConfig,
    deps: ServiceDeps = {},
  ) {
    this.clock = deps.clock ?? realClock;
    this.log = deps.log ?? new MemoryRoomLog();
    this.events = deps.events ?? new NoopEventSink();
    this.newGroupId = deps.newGroupId ?? defaultRoomId;
    this.onSeat = deps.onSeat;
    this.hooks = deps.hooks ?? {};
    this.matchmaker = new Matchmaker<Conn>(this.clock, this.cfg.economy, (players, game) => this.startRankedMatch(players, game));
    this.newSeed = deps.newSeed ?? (() => randomBytes(12).toString("hex"));
  }

  /** Room tempat koneksi ini duduk (untuk mengajak teman). */
  roomOfConn(conn: Conn): { groupId: string; phase: "lobby" | "playing" | "finished" } | null {
    const ctx = this.contextOf(conn);
    return ctx ? { groupId: ctx.room.groupId, phase: ctx.room.phase } : null;
  }

  /** Kelompok yang sedang diduduki sebuah perangkat (untuk menyertakannya saat mendaftar akun). */
  groupsOf(tokenHash: string): string[] {
    const out: string[] = [];
    for (const room of this.rooms.values()) if (room.seats.some((m) => m?.tokenHash === tokenHash)) out.push(room.groupId);
    return out;
  }

  // ---------- siklus hidup ----------

  /** Bangun ulang semua room dari log, mulai timer giliran, dan jadwalkan pembersihan. */
  start(): void {
    this.restore();
    this.scheduleSweep();
  }

  stop(): void {
    this.stopped = true;
    this.cancelSweep?.();
    this.matchmaker.stop();
    for (const room of this.rooms.values()) room.game?.cancelTimer?.();
  }

  private scheduleSweep(): void {
    this.cancelSweep = this.clock.setTimeout(() => {
      if (this.stopped) return;
      this.sweep();
      this.scheduleSweep();
    }, this.cfg.cleanupIntervalMs);
  }

  /** Hapus room yang tak aktif lewat TTL dan tak punya pemain terhubung. */
  sweep(): string[] {
    const now = this.clock.now();
    const closed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      const anyConnected = room.seats.some((m) => m?.conn);
      if (!anyConnected && now - room.lastActivity > this.cfg.roomIdleTtlMs) {
        room.game?.cancelTimer?.();
        this.endWatch(room, "closed");
        this.log.append({ t: "closed", roomId: room.id, ts: now });
        this.rooms.delete(room.id);
        const group = this.groups.get(room.groupId);
        if (group?.liveRoomId === room.id) group.liveRoomId = null;
        closed.push(room.id);
      }
    }
    if (closed.length > 0) this.compactLog();
    return closed;
  }

  private compactLog(): void {
    const live = new Set(this.rooms.keys());
    // Catatan kelompok selalu dipertahankan; sesi yang sudah ditutup dibuang.
    this.log.rewrite(this.log.readAll().filter((r) => r.t === "group" || live.has(r.roomId)));
  }

  private restore(): void {
    const records = this.log.readAll();
    const closed = new Set(records.flatMap((r) => (r.t === "closed" ? [r.roomId] : [])));
    for (const rec of records) {
      if (rec.t === "group") {
        this.groups.set(rec.groupId, { id: rec.groupId, createdAt: rec.ts, liveRoomId: null });
        continue;
      }
      if (closed.has(rec.roomId)) continue;
      switch (rec.t) {
        case "room": {
          this.rooms.set(rec.roomId, this.blankRoom(rec.roomId, rec.groupId, rec.ts));
          const group = this.groups.get(rec.groupId);
          if (group) group.liveRoomId = rec.roomId;
          break;
        }
        case "sit": {
          const room = this.rooms.get(rec.roomId);
          if (!room) break;
          this.seatMember(room, rec.seat, { seat: rec.seat, tokenHash: rec.tokenHash, name: rec.name, conn: null, chatTimes: [], lastNudge: null });
          room.lastActivity = rec.ts;
          break;
        }
        case "stand": {
          const room = this.rooms.get(rec.roomId);
          if (!room) break;
          this.unseat(room, rec.seat);
          room.lastActivity = rec.ts;
          break;
        }
        case "ranked": {
          const room = this.rooms.get(rec.roomId);
          if (room) room.ranked = rec.on;
          break;
        }
        case "setgame": {
          const room = this.rooms.get(rec.roomId);
          if (room) room.gameId = rec.game;
          break;
        }
        case "start": {
          const room = this.rooms.get(rec.roomId);
          if (!room) break;
          room.gameNo = rec.gameNo;
          room.phase = "playing";
          const adapter = adapterOf(rec.game);
          room.gameId = adapter.id;
          room.game = { adapter, state: adapter.restore(rec.config, rec.seed), roomSeats: rec.roomSeats, devices: this.deviceIds(room, rec.roomSeats), deadline: null, cancelTimer: null, ranked: !!rec.ranked, rewards: [] };
          room.lastActivity = rec.ts;
          break;
        }
        case "move": {
          const room = this.rooms.get(rec.roomId);
          if (!room?.game || room.gameNo !== rec.gameNo) break;
          const next = room.game.adapter.apply(room.game.state, rec.move);
          if (isEngineError(next)) throw new Error(`Log rusak untuk room ${rec.roomId}: ${(next as EngineError).code}`);
          {
            const roomSeat = room.game.roomSeats[(rec.move as { seat: number }).seat] as number;
            room.autoStreak.set(roomSeat, rec.auto ? (room.autoStreak.get(roomSeat) ?? 0) + 1 : 0);
          }
          room.game.state = next;
          if (room.game.adapter.outcome(next)) this.markFinished(room, next);
          room.lastActivity = rec.ts;
          break;
        }
        case "closed":
          break;
      }
    }
    // Room yang sudah ditutup dibuang dari log (pemadatan).
    if (closed.size > 0) this.compactLog();
    for (const room of this.rooms.values()) {
      if (room.phase === "playing") this.armTimer(room);
    }
  }

  // ---------- pembantu room ----------

  private readonly watching = new Map<Conn, Room>();

  private blankRoom(id: string, groupId: string, ts: number): Room {
    return {
      id,
      groupId,
      lastActivity: ts,
      hostSeat: 0,
      seats: Array.from({ length: this.cfg.maxSeats }, () => null),
      phase: "lobby",
      gameId: "gaple",
      ranked: false,
      autoStreak: new Map(),
      gameNo: 0,
      game: null,
      lastWinnerSeat: null,
      watchable: false,
      watchKey: randomBytes(5).toString("hex"),
      spectators: new Map(),
      frames: [],
    };
  }

  private seatMember(room: Room, seat: number, member: Member): void {
    room.seats[seat] = member;
    if (room.seats.filter(Boolean).length === 1) room.hostSeat = seat;
  }

  private unseat(room: Room, seat: number): void {
    room.seats[seat] = null;
    if (room.hostSeat === seat) {
      const first = room.seats.findIndex(Boolean);
      if (first >= 0) room.hostSeat = first;
    }
  }

  private markFinished(room: Room, state: unknown): void {
    room.phase = "finished";
    const game = room.game as ActiveGame;
    game.cancelTimer?.();
    game.cancelTimer = null;
    game.deadline = null;
    const winnerEngineSeat = game.adapter.outcome(state)?.winner ?? 0;
    room.lastWinnerSeat = game.roomSeats[winnerEngineSeat] ?? null;
  }

  private deviceIds(room: Room, roomSeats: number[]): string[] {
    return roomSeats.map((seat) => (room.seats[seat]?.tokenHash ?? "").slice(0, 16));
  }

  private emit(room: Room, event: EventName, tokenHash: string | null, detail = ""): void {
    this.events.emit({
      ts: this.clock.now(),
      groupId: room.groupId,
      roomId: room.id,
      deviceId: tokenHash ? tokenHash.slice(0, 16) : "",
      event,
      gameNo: room.gameNo > 0 ? room.gameNo : null,
      detail,
    });
  }

  private append(rec: LogRecord): void {
    this.log.append(rec);
  }

  private touch(room: Room): void {
    room.lastActivity = this.clock.now();
  }

  // ---------- tampilan per pemain (tanpa kartu pemain lain) ----------

  view(room: Room, member: Member): StateMessage {
    const game = room.game;
    const engineSeatOf = (roomSeat: number): number => (game ? game.roomSeats.indexOf(roomSeat) : -1);
    let gameView: GameView | null = null;
    if (game) {
      const st = game.state;
      const ad = game.adapter;
      const mine = engineSeatOf(member.seat);
      const out = ad.outcome(st);
      gameView = {
        kind: ad.id,
        ...ad.view(st, mine, game.roomSeats),
        turn: game.roomSeats[ad.turn(st)] as number,
        turnDeadline: game.deadline,
        yourMoves: ad.moveViews(st, mine),
        moveCount: ad.moveCount(st),
        result: out
          ? {
              rewards: game.rewards,
              reason: out.reason,
              winner: game.roomSeats[out.winner] as number,
              ranking: out.ranking.map((r) => ({ seat: game.roomSeats[r.seat] as number, rank: r.rank, points: r.points, cardsLeft: r.cardsLeft })),
            }
          : null,
      };
    }
    return {
      type: "state",
      now: this.clock.now(),
      room: {
        id: room.id,
        groupId: room.groupId,
        phase: room.phase,
        gameId: room.gameId,
        ranked: room.ranked,
        watchable: room.watchable,
        spectators: room.spectators.size,
        gameNo: room.gameNo,
        hostSeat: room.hostSeat,
        maxSeats: this.cfg.maxSeats,
        seats: room.seats.map((m, seat) => {
          if (!m) return null;
          const es = engineSeatOf(seat);
          return {
            seat,
            name: m.name,
            connected: m.conn !== null,
            cardsLeft: game && es >= 0 ? game.adapter.remaining(game.state, es) : null,
            isYou: m === member,
            registered: (this.hooks.accountIdOf?.(m.tokenHash) ?? null) !== null,
          };
        }),
      },
      you: { seat: member.seat },
      game: gameView,
    };
  }

  private broadcast(room: Room): void {
    for (const m of room.seats) m?.conn?.send(this.view(room, m));
    if (room.watchable) this.pushFrame(room);
  }

  // ---------- Live (penonton) ----------

  /** Tampilan publik: tanpa kartu tangan siapa pun, tanpa langkah sah, tanpa batas waktu giliran. */
  private spectatorView(room: Room): StateMessage {
    const base = this.view(room, { seat: -1, tokenHash: "", name: "", conn: null, chatTimes: [], lastNudge: null } as Member);
    return {
      ...base,
      now: this.clock.now(),
      room: { ...base.room, seats: base.room.seats.map((s) => (s ? { ...s, isYou: false } : null)) },
      you: { seat: -1 },
      game: base.game ? { ...base.game, yourHand: [], yourMoves: [], turnDeadline: null } : null,
      spectating: true,
    };
  }

  /** Simpan bingkai sekarang dan kirim ke penonton setelah penundaan (cegah curang lewat penonton). */
  private pushFrame(room: Room): void {
    const frame = { ts: this.clock.now(), msg: this.spectatorView(room) };
    room.frames.push(frame);
    if (room.frames.length > 40) room.frames.splice(0, room.frames.length - 40);
    this.clock.setTimeout(() => {
      if (this.stopped || !this.rooms.has(room.id) || !room.watchable) return;
      for (const c of room.spectators.keys()) c.send({ ...frame.msg, now: this.clock.now() });
    }, this.cfg.liveDelayMs);
  }

  private endWatch(room: Room, reason: "closed" | "off"): void {
    for (const c of room.spectators.keys()) {
      this.watching.delete(c);
      c.send({ type: "watch_end", reason });
    }
    room.spectators.clear();
    room.frames = [];
  }

  /** Daftar room yang boleh ditonton dan sedang bermain. Memakai kunci tonton, bukan kode kelompok. */
  liveList(): { key: string; game: GameId; ranked: boolean; players: string[]; spectators: number }[] {
    const out: { key: string; game: GameId; ranked: boolean; players: string[]; spectators: number }[] = [];
    for (const r of this.rooms.values()) {
      if (!r.watchable || r.phase !== "playing") continue;
      out.push({ key: r.watchKey, game: r.gameId, ranked: r.ranked, players: r.seats.flatMap((m) => (m ? [m.name] : [])), spectators: r.spectators.size });
    }
    return out;
  }

  private setWatch(conn: Conn, room: Room, member: Member, on: boolean): void {
    if (member.seat !== room.hostSeat) {
      conn.send(err("NOT_HOST", "Hanya pembuat room yang bisa mengatur siaran."));
      return;
    }
    if (room.watchable !== on) {
      room.watchable = on;
      if (!on) this.endWatch(room, "off");
    }
    this.broadcast(room);
  }

  private watch(conn: Conn, key: string): void {
    if (!conn.account) {
      conn.send(err("NOT_LOGGED_IN", "Masuk atau daftar dulu untuk menonton."));
      return;
    }
    if (this.contextOf(conn)) {
      conn.send(err("IN_ROOM", "Kamu sedang duduk di sebuah room."));
      return;
    }
    const room = [...this.rooms.values()].find((r) => r.watchKey === key && r.watchable);
    if (!room || room.phase === "lobby") {
      conn.send(err("NOT_FOUND", "Siaran tidak ditemukan atau sudah selesai."));
      return;
    }
    this.unwatch(conn, false);
    if (room.spectators.size >= this.cfg.liveMaxSpectators) {
      conn.send(err("WATCH_FULL", "Penonton room ini sudah penuh."));
      return;
    }
    room.spectators.set(conn, { name: conn.account.name, lastChat: 0 });
    this.watching.set(conn, room);
    const due = this.clock.now() - this.cfg.liveDelayMs;
    const frame = [...room.frames].reverse().find((f) => f.ts <= due);
    conn.send({ type: "watching", key, delayMs: this.cfg.liveDelayMs, hasFrame: !!frame });
    if (frame) conn.send({ ...frame.msg, now: this.clock.now() });
  }

  private unwatch(conn: Conn, notify: boolean): void {
    const room = this.watching.get(conn);
    if (!room) return;
    room.spectators.delete(conn);
    this.watching.delete(conn);
    if (notify) conn.send({ type: "watch_end", reason: "left" });
  }

  /** Chat penonton: hanya dibagikan ke sesama penonton, tidak pernah ke pemain; tidak disimpan. */
  private watchChat(conn: Conn, text: string): void {
    const room = this.watching.get(conn);
    const sp = room?.spectators.get(conn);
    if (!room || !sp) {
      conn.send(err("NOT_WATCHING", "Kamu tidak sedang menonton."));
      return;
    }
    const now = this.clock.now();
    if (now - sp.lastChat < this.cfg.liveChatMinMs) {
      conn.send(err("RATE_LIMIT", "Terlalu cepat. Tunggu sebentar."));
      return;
    }
    sp.lastChat = now;
    for (const c of room.spectators.keys()) c.send({ type: "watch_chat", name: sp.name, text, ts: now });
  }

  // ---------- timer giliran ----------

  private armTimer(room: Room): void {
    const game = room.game;
    if (!game || room.phase !== "playing") return;
    game.cancelTimer?.();
    const stamp = game.adapter.moveCount(game.state);
    const gameNo = room.gameNo;
    game.deadline = this.clock.now() + this.cfg.turnTimeoutMs;
    game.cancelTimer = this.clock.setTimeout(() => {
      if (this.stopped || room.phase !== "playing" || room.gameNo !== gameNo || (room.game ? room.game.adapter.moveCount(room.game.state) : -1) !== stamp) return;
      this.autoMove(room);
    }, this.cfg.turnTimeoutMs);
  }

  /** Waktu habis: lewat bila tidak ada langkah lain; selain itu kartu sah pertama. */
  private autoMove(room: Room): void {
    const game = room.game as ActiveGame;
    const seat = game.adapter.turn(game.state);
    const move = game.adapter.auto(game.state, seat);
    if (!move) return;
    const roomSeat = game.roomSeats[seat] as number;
    room.autoStreak.set(roomSeat, (room.autoStreak.get(roomSeat) ?? 0) + 1);
    this.commitMove(room, move, true);
    this.broadcast(room);
  }

  /** Terapkan langkah yang sudah divalidasi mesin: log, timer, penutupan game. */
  private commitMove(room: Room, move: unknown, auto: boolean): ProtocolError | null {
    const game = room.game as ActiveGame;
    const next = game.adapter.apply(game.state, move);
    if (isEngineError(next)) return err((next as EngineError).code, (next as EngineError).message);
    const rec: LogRecord = { t: "move", roomId: room.id, ts: this.clock.now(), gameNo: room.gameNo, move };
    this.append(auto ? { ...rec, auto: true } : rec);
    game.state = next;
    const out = game.adapter.outcome(next);
    if (out) {
      this.markFinished(room, next);
      this.settle(room, out);
      const ranking = out.ranking.map((r) => game.roomSeats[r.seat]).join(">");
      this.emit(
        room,
        "game_finished",
        null,
        `reason=${out.reason};players=${game.roomSeats.length};ranking=${ranking};devices=${game.devices.join("|")};game=${game.adapter.id}`,
      );
    } else {
      this.armTimer(room);
    }
    return null;
  }

  /** Catat hasil: Trofi (Ranked) dan Bintang lewat buku besar. Dihitung di server, hanya untuk pemain terdaftar. */
  private settle(room: Room, out: NonNullable<ReturnType<GameAdapter["outcome"]>>): void {
    const game = room.game as ActiveGame;
    if (!this.hooks.settle) return;
    const players = game.roomSeats.map((roomSeat, es) => ({
      roomSeat,
      accountId: this.hooks.accountIdOf?.(room.seats[roomSeat]?.tokenHash ?? "") ?? null,
      rank: out.ranking.find((r) => r.seat === es)?.rank ?? game.roomSeats.length,
      abandoned: (room.autoStreak.get(roomSeat) ?? 0) >= this.cfg.economy.abandonAfterAuto,
    }));
    const rewards = this.hooks.settle({ ref: `${room.id}:${room.gameNo}`, ts: this.clock.now(), ranked: game.ranked, players });
    game.rewards = rewards.flatMap((r) => {
      const p = players.find((x) => x.accountId === r.accountId);
      return p ? [{ seat: p.roomSeat, trofi: r.trofi, bintang: r.bintang, trofiTotal: r.trofiTotal, kelas: r.kelas, kelasUp: r.kelasUp }] : [];
    });
  }

  // ---------- pesan klien ----------

  handle(conn: Conn, msg: ClientMessage): void {
    try {
      this.dispatch(conn, msg);
    } catch (e) {
      conn.send(err("SERVER_ERROR", "Terjadi kesalahan di server. Coba lagi."));
      throw e;
    }
  }

  private dispatch(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case "ping":
        conn.send({ type: "pong", now: this.clock.now() });
        return;
      case "auth":
        return this.authenticate(conn, msg.session);
      case "queue_ranked":
        return this.queueRanked(conn, msg.game);
      case "cancel_queue":
        return this.cancelQueue(conn);
      case "dm_send":
      case "invite_send":
      case "invite_reply":
        this.hooks.social?.handle(conn, msg);
        return;
      case "watch":
        return this.watch(conn, msg.key);
      case "unwatch":
        return this.unwatch(conn, true);
      case "watch_chat":
        return this.watchChat(conn, msg.text);
      case "create_room":
        return this.createGroup(conn, msg.name, msg.token, msg.game);
      case "open_link":
        return this.openLink(conn, msg.groupId, msg.token);
      case "join":
        return this.join(conn, msg.groupId, msg.name, msg.token, msg.seat);
    }
    const ctx = this.contextOf(conn);
    if (!ctx) {
      conn.send(err("NOT_IN_ROOM", "Kamu belum masuk ke room."));
      return;
    }
    const { room, member } = ctx;
    this.touch(room);
    switch (msg.type) {
      case "start":
        return this.startGame(conn, room, member, false);
      case "rematch":
        return this.rematch(conn, room, member);
      case "leave":
        return this.leave(conn, room, member);
      case "chat":
        return this.chat(conn, room, member, msg.text);
      case "nudge":
        return this.nudge(conn, room, member);
      case "set_game":
        return this.setGame(conn, room, member, msg.game);
      case "set_ranked":
        return this.setRanked(conn, room, member, msg.on);
      case "set_watch":
        return this.setWatch(conn, room, member, msg.on);
      case "play":
      case "pass":
      case "roll":
      case "pick":
        return this.playerMove(conn, room, member, msg);
    }
  }

  private contextOf(conn: Conn): { room: Room; member: Member } | null {
    const s = conn.session;
    if (!s) return null;
    const room = this.rooms.get(s.roomId);
    if (!room) return null;
    const member = room.seats.find((m) => m?.tokenHash === s.tokenHash && m.conn === conn);
    return member ? { room, member } : null;
  }

  /** Lepas koneksi lama dari sesinya (pindah room atau digantikan). */
  private detach(conn: Conn): void {
    const ctx = this.contextOf(conn);
    conn.session = null;
    if (ctx) {
      ctx.member.conn = null;
      this.broadcast(ctx.room);
    }
  }

  private bind(conn: Conn, room: Room, member: Member): void {
    if (member.conn && member.conn !== conn) {
      const old = member.conn;
      old.session = null;
      old.send(err("REPLACED", "Kamu masuk dari tab atau perangkat lain."));
      old.close(4001, "replaced");
    }
    member.conn = conn;
    conn.session = { roomId: room.id, tokenHash: member.tokenHash };
  }

  private createGroup(conn: Conn, name: string, token: string, game?: GameId): void {
    if (this.rooms.size >= this.cfg.maxRooms) {
      conn.send(err("SERVER_BUSY", "Server sedang penuh. Coba lagi nanti."));
      return;
    }
    this.detach(conn);
    let id = this.newGroupId();
    while (this.groups.has(id)) id = this.newGroupId();
    const now = this.clock.now();
    this.groups.set(id, { id, createdAt: now, liveRoomId: null });
    this.append({ t: "group", groupId: id, ts: now });
    const room = this.newSession(this.groups.get(id) as Group, true);
    if (game && GAME_IDS.includes(game) && game !== room.gameId) {
      room.gameId = game;
      this.append({ t: "setgame", roomId: room.id, ts: now, game });
    }
    const tokenHash = hashToken(token, this.cfg.hashSalt);
    this.emit(room, "group_created", tokenHash);
    this.sit(room, tokenHash, name, 0, conn);
  }

  /** Buat sesi room baru untuk kelompok yang belum punya sesi hidup. */
  private newSession(group: Group, first = false): Room {
    const now = this.clock.now();
    let id = first ? group.id : `${group.id}-${now.toString(36)}`;
    while (this.rooms.has(id)) id += "x";
    const room = this.blankRoom(id, group.id, now);
    this.rooms.set(id, room);
    group.liveRoomId = id;
    this.append({ t: "room", roomId: id, groupId: group.id, ts: now });
    return room;
  }

  private liveRoom(group: Group): Room | null {
    return group.liveRoomId ? (this.rooms.get(group.liveRoomId) ?? null) : null;
  }

  /** Klien membuka tautan: catat peristiwa dan beri ringkasan kelompok (tanpa membuat sesi). */
  private openLink(conn: Conn, groupId: string, token: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      conn.send(err("ROOM_NOT_FOUND", "Tautan ini tidak dikenal. Minta tautan baru dari temanmu."));
      return;
    }
    const tokenHash = hashToken(token, this.cfg.hashSalt);
    const room = this.liveRoom(group);
    this.events.emit({
      ts: this.clock.now(),
      groupId,
      roomId: room?.id ?? "",
      deviceId: tokenHash.slice(0, 16),
      event: "invite_link_opened",
      gameNo: room && room.gameNo > 0 ? room.gameNo : null,
      detail: "",
    });
    conn.send({
      type: "group_info",
      groupId,
      phase: room ? room.phase : "none",
      players: room ? room.seats.filter(Boolean).length : 0,
      maxSeats: this.cfg.maxSeats,
      isMember: room ? room.seats.some((m) => m?.tokenHash === tokenHash) : false,
    });
  }

  private join(conn: Conn, groupId: string, name: string, token: string, wantSeat: number | undefined): void {
    const group = this.groups.get(groupId);
    if (!group) {
      conn.send(err("ROOM_NOT_FOUND", "Tautan ini tidak dikenal. Minta tautan baru dari temanmu."));
      return;
    }
    // Sesi lama sudah dibersihkan: kelompok yang sama mendapat sesi room baru, bukan galat.
    const room = this.liveRoom(group) ?? this.newSession(group);
    if (conn.session && conn.session.roomId !== room.id) this.detach(conn);
    const tokenHash = hashToken(token, this.cfg.hashSalt);
    this.touch(room);
    const existing = room.seats.find((m) => m?.tokenHash === tokenHash);
    if (existing) {
      // Sambung ulang: kursi dan state yang sama.
      const wasConnected = existing.conn !== null;
      this.bind(conn, room, existing);
      this.emit(room, "reconnected", tokenHash, `seat=${existing.seat}${wasConnected ? ";takeover=1" : ""}`);
      this.broadcast(room);
      return;
    }
    if (room.phase === "playing") {
      conn.send(err("GAME_IN_PROGRESS", "Game sedang berjalan. Tunggu game selesai untuk bergabung."));
      return;
    }
    let seat = wantSeat ?? room.seats.findIndex((m) => m === null);
    if (seat < 0 || seat >= this.cfg.maxSeats) {
      conn.send(err("ROOM_FULL", "Room sudah penuh."));
      return;
    }
    if (room.seats[seat]) {
      conn.send(err(wantSeat === undefined ? "ROOM_FULL" : "SEAT_TAKEN", wantSeat === undefined ? "Room sudah penuh." : "Kursi itu sudah terisi."));
      return;
    }
    seat = Math.floor(seat);
    this.sit(room, tokenHash, name, seat, conn);
  }

  private sit(room: Room, tokenHash: string, name: string, seat: number, conn: Conn): void {
    const member: Member = { seat, tokenHash, name, conn: null, chatTimes: [], lastNudge: null };
    this.seatMember(room, seat, member);
    this.append({ t: "sit", roomId: room.id, ts: this.clock.now(), seat, tokenHash, name });
    this.bind(conn, room, member);
    this.emit(room, "player_joined", tokenHash, `seat=${seat}`);
    this.onSeat?.(tokenHash, room.groupId);
    if (room.ranked && (this.hooks.accountIdOf?.(tokenHash) ?? null) === null) {
      // Tamu duduk di room Ranked: Ranked dimatikan agar adil bagi yang lain.
      room.ranked = false;
      this.append({ t: "ranked", roomId: room.id, ts: this.clock.now(), on: false });
    }
    this.broadcast(room);
  }

  private startGame(conn: Conn, room: Room, member: Member, rematch: boolean): void {
    if (!rematch) {
      if (room.phase !== "lobby") {
        conn.send(err("WRONG_PHASE", room.phase === "playing" ? "Game sudah berjalan." : "Gunakan tombol main lagi untuk game baru."));
        return;
      }
      if (member.seat !== room.hostSeat) {
        conn.send(err("NOT_HOST", "Hanya pembuat room yang bisa memulai game."));
        return;
      }
    }
    if (room.ranked && !this.allRegistered(room)) {
      conn.send(err("NOT_ALL_REGISTERED", "Ranked hanya untuk room yang semua pemainnya sudah punya akun."));
      return;
    }
    const roomSeats = room.seats.flatMap((m, i) => (m ? [i] : []));
    if (roomSeats.length < this.cfg.minPlayersToStart) {
      conn.send(err("NEED_MORE_PLAYERS", `Butuh minimal ${this.cfg.minPlayersToStart} pemain untuk mulai.`));
      return;
    }
    // Rematch: pemenang game sebelumnya jalan lebih dulu (parameter openerSeat mesin).
    const winnerEngine = rematch && room.lastWinnerSeat !== null ? roomSeats.indexOf(room.lastWinnerSeat) : -1;
    const adapter = adapterOf(room.gameId);
    const seed = this.newSeed();
    const created = adapter.create(roomSeats.length, seed, winnerEngine >= 0 ? winnerEngine : null, this.cfg);
    room.gameNo += 1;
    room.phase = "playing";
    room.autoStreak = new Map();
    room.game = { adapter, state: created.state, roomSeats, devices: this.deviceIds(room, roomSeats), deadline: null, cancelTimer: null, ranked: room.ranked, rewards: [] };
    const config = created.config;
    this.append({ t: "start", roomId: room.id, ts: this.clock.now(), gameNo: room.gameNo, seed, config, roomSeats, game: adapter.id, ranked: room.ranked });
    this.emit(room, "game_started", null, `players=${roomSeats.length};rematch=${rematch ? 1 : 0};devices=${room.game?.devices.join("|") ?? ""};game=${adapter.id};ranked=${room.ranked ? 1 : 0}`);
    this.armTimer(room);
    this.broadcast(room);
  }

  private rematch(conn: Conn, room: Room, member: Member): void {
    if (room.phase !== "finished") {
      conn.send(err("WRONG_PHASE", "Game belum selesai."));
      return;
    }
    this.emit(room, "rematch_clicked", member.tokenHash);
    this.startGame(conn, room, member, true);
  }

  private leave(conn: Conn, room: Room, member: Member): void {
    if (room.phase === "playing") {
      conn.send(err("GAME_IN_PROGRESS", "Game sedang berjalan. Kamu bisa menutup halaman dan kembali lagi lewat tautan yang sama."));
      return;
    }
    this.emit(room, "player_left", member.tokenHash, `seat=${member.seat}`);
    this.append({ t: "stand", roomId: room.id, ts: this.clock.now(), seat: member.seat });
    this.unseat(room, member.seat);
    conn.session = null;
    member.conn = null;
    conn.send({ type: "left" });
    this.broadcast(room);
  }

  /** Menyundul pemain yang sedang ditunggu. Tidak disimpan di log dan tidak dicatat sebagai peristiwa. */
  private nudge(conn: Conn, room: Room, member: Member): void {
    const game = room.game;
    const mine = game ? game.roomSeats.indexOf(member.seat) : -1;
    if (!game || room.phase !== "playing" || mine < 0) {
      conn.send(err("NOT_PLAYING", "Game belum berjalan."));
      return;
    }
    if (game.adapter.turn(game.state) === mine) {
      conn.send(err("SELF_TURN", "Sekarang giliranmu, bukan giliran temanmu."));
      return;
    }
    const now = this.clock.now();
    if (member.lastNudge !== null && now - member.lastNudge < this.cfg.nudgeIntervalMs) {
      conn.send(err("RATE_LIMITED", "Tunggu sebentar sebelum menyundul lagi."));
      return;
    }
    const targetSeat = game.roomSeats[game.adapter.turn(game.state)] as number;
    const target = room.seats[targetSeat];
    if (!target?.conn) {
      conn.send(err("NOT_CONNECTED", `${target?.name ?? "Pemain itu"} sedang terputus.`));
      return;
    }
    member.lastNudge = now;
    target.conn.send({ type: "nudge", fromSeat: member.seat, fromName: member.name });
    conn.send({ type: "nudge_ack", seat: targetSeat, name: target.name });
  }

  private chat(conn: Conn, room: Room, member: Member, text: string): void {
    const now = this.clock.now();
    member.chatTimes = member.chatTimes.filter((t) => now - t < this.cfg.chatWindowMs);
    if (member.chatTimes.length >= this.cfg.chatBurst) {
      conn.send(err("RATE_LIMITED", "Terlalu cepat. Tunggu sebentar sebelum mengirim lagi."));
      return;
    }
    member.chatTimes.push(now);
    this.emit(room, "message_sent", member.tokenHash);
    const msg: ServerMessage = { type: "chat", seat: member.seat, name: member.name, text, ts: this.clock.now() };
    for (const m of room.seats) m?.conn?.send(msg);
  }

  // ---------- akun, Ranked, antrean ----------

  private authenticate(conn: Conn, session: string): void {
    const acc = this.hooks.authenticate?.(session) ?? null;
    if (!acc) {
      conn.account = null;
      conn.send(err("UNAUTHORIZED", "Sesi masuk tidak berlaku. Masuk lagi."));
      return;
    }
    conn.account = acc;
    conn.send({ type: "auth_ok", username: acc.username, name: acc.name });
    this.hooks.social?.attach(conn);
    const w = this.matchmaker.waiting(acc.id);
    conn.send({ type: "queue", state: w ? "waiting" : "idle", game: w?.game ?? null, since: w?.since ?? null });
  }

  private allRegistered(room: Room): boolean {
    return room.seats.filter(Boolean).every((m) => (this.hooks.accountIdOf?.((m as Member).tokenHash) ?? null) !== null);
  }

  /** Pemilik menyalakan atau mematikan Ranked. Hanya bila semua yang duduk punya akun. */
  private setRanked(conn: Conn, room: Room, member: Member, on: boolean): void {
    if (member.seat !== room.hostSeat) {
      conn.send(err("NOT_HOST", "Hanya pembuat room yang bisa mengatur Ranked."));
      return;
    }
    if (room.phase === "playing") {
      conn.send(err("WRONG_PHASE", "Game sedang berjalan."));
      return;
    }
    if (on && !this.allRegistered(room)) {
      conn.send(err("NOT_ALL_REGISTERED", "Ranked hanya untuk room yang semua pemainnya sudah punya akun."));
      return;
    }
    if (room.ranked !== on) {
      room.ranked = on;
      this.append({ t: "ranked", roomId: room.id, ts: this.clock.now(), on });
    }
    this.broadcast(room);
  }

  private queueRanked(conn: Conn, game: GameId): void {
    if (!conn.account) {
      conn.send(err("NOT_LOGGED_IN", "Masuk atau daftar dulu untuk main Ranked."));
      return;
    }
    const ctx = this.contextOf(conn);
    if (ctx?.room.phase === "playing") {
      conn.send(err("ALREADY_PLAYING", "Selesaikan game yang sedang berjalan dulu."));
      return;
    }
    if (!GAME_IDS.includes(game)) {
      conn.send(err("BAD_GAME", "Game tidak dikenal."));
      return;
    }
    const w = this.matchmaker.enqueue(conn, conn.account.id, game);
    // Bila pasangan langsung ditemukan, conn sudah dipindah ke room baru dan antrean kosong.
    const still = this.matchmaker.waiting(conn.account.id);
    conn.send({ type: "queue", state: still ? "waiting" : "idle", game: still ? w.game : null, since: still ? w.since : null });
  }

  private cancelQueue(conn: Conn): void {
    if (conn.account) this.matchmaker.remove(conn.account.id);
    conn.send({ type: "queue", state: "idle", game: null, since: null });
  }

  /** Buat room Ranked dari pemain antrean dan langsung mulai. Pemain pertama menjadi "pemilik". */
  private startRankedMatch(players: QueuedPlayer<Conn>[], game: GameId): void {
    const live = players.filter((p) => p.conn.account);
    if (live.length < 2) {
      for (const p of live) this.matchmaker.enqueue(p.conn, p.accountId, game);
      return;
    }
    let id = this.newGroupId();
    while (this.groups.has(id)) id = this.newGroupId();
    const now = this.clock.now();
    this.groups.set(id, { id, createdAt: now, liveRoomId: null });
    this.append({ t: "group", groupId: id, ts: now });
    const room = this.newSession(this.groups.get(id) as Group, true);
    room.gameId = game;
    room.ranked = true;
    this.append({ t: "setgame", roomId: room.id, ts: now, game });
    this.append({ t: "ranked", roomId: room.id, ts: now, on: true });
    let first: { conn: Conn; member: Member } | null = null;
    live.forEach((p, seat) => {
      const acc = p.conn.account as NonNullable<Conn["account"]>;
      this.detach(p.conn);
      const tokenHash = hashToken(acc.token, this.cfg.hashSalt);
      const member: Member = { seat, tokenHash, name: acc.name, conn: null, chatTimes: [], lastNudge: null };
      this.seatMember(room, seat, member);
      this.append({ t: "sit", roomId: room.id, ts: now, seat, tokenHash, name: acc.name });
      this.bind(p.conn, room, member);
      this.emit(room, "player_joined", tokenHash, `seat=${seat};ranked=1`);
      this.onSeat?.(tokenHash, room.groupId);
      first ??= { conn: p.conn, member };
    });
    for (const p of live) p.conn.send({ type: "match_found", groupId: room.groupId });
    const f = first as { conn: Conn; member: Member } | null;
    if (f) this.startGame(f.conn, room, f.member, false);
  }

  /** Pemilik memilih game untuk room (di lobi atau setelah game selesai). */
  private setGame(conn: Conn, room: Room, member: Member, game: GameId): void {
    if (member.seat !== room.hostSeat) {
      conn.send(err("NOT_HOST", "Hanya pembuat room yang bisa memilih game."));
      return;
    }
    if (room.phase === "playing") {
      conn.send(err("WRONG_PHASE", "Game sedang berjalan."));
      return;
    }
    if (!GAME_IDS.includes(game)) {
      conn.send(err("BAD_GAME", "Game tidak dikenal."));
      return;
    }
    if (room.gameId !== game) {
      room.gameId = game;
      this.append({ t: "setgame", roomId: room.id, ts: this.clock.now(), game });
      // Setelah game selesai, pindah game kembali ke ruang tunggu.
      if (room.phase === "finished") {
        room.phase = "lobby";
        room.game?.cancelTimer?.();
        room.game = null;
      }
    }
    this.broadcast(room);
  }

  private playerMove(conn: Conn, room: Room, member: Member, msg: ClientMessage): void {
    const game = room.game;
    if (!game || room.phase !== "playing") {
      conn.send(err("NOT_PLAYING", "Game belum berjalan."));
      return;
    }
    const engineSeat = game.roomSeats.indexOf(member.seat);
    if (engineSeat < 0) {
      conn.send(err("NOT_PLAYING", "Kamu tidak ikut di game ini."));
      return;
    }
    const base = game.adapter.fromClient(msg);
    if (!base) {
      conn.send(err("WRONG_GAME", "Langkah itu bukan untuk game ini."));
      return;
    }
    const error = this.commitMove(room, { ...base, seat: engineSeat }, false);
    if (error) {
      conn.send(error);
      return;
    }
    room.autoStreak.set(member.seat, 0);
    this.broadcast(room);
  }

  // ---------- koneksi ----------

  onDisconnect(conn: Conn): void {
    this.matchmaker.dropConn(conn);
    this.unwatch(conn, false);
    this.hooks.social?.detach(conn);
    const ctx = this.contextOf(conn);
    conn.session = null;
    if (!ctx) return;
    ctx.member.conn = null;
    this.touch(ctx.room);
    this.broadcast(ctx.room);
  }
}
