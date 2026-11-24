import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  apply,
  canonical,
  createConfig,
  ends,
  init,
  isEngineError,
  legalMoves,
  type GapleConfig,
  type GapleState,
  type Move,
} from "@gmers/game-engine";
import { realClock, type Clock } from "./clock";
import type { ServerConfig } from "./config";
import { NoopEventSink, type EventName, type EventSink } from "./events";
import type { ClientMessage, GameView, MoveView, ProtocolError, ServerMessage, StateMessage } from "./protocol";
import type { LogRecord, RoomLog } from "./store";
import { MemoryRoomLog } from "./store";

/** Satu koneksi klien. Lapisan WebSocket mengimplementasikannya; uji memakai versi palsu. */
export interface Conn {
  readonly id: string;
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
  session: { roomId: string; tokenHash: string } | null;
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
  state: GapleState;
  /** roomSeats[kursiMesin] = kursi room. */
  roomSeats: number[];
  /** Hash perangkat (16 hex) tiap pemain game ini, urut kursi room. Hanya untuk metrik. */
  devices: string[];
  deadline: number | null;
  cancelTimer: (() => void) | null;
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
  gameNo: number;
  game: ActiveGame | null;
  lastWinnerSeat: number | null;
}

export interface ServiceDeps {
  clock?: Clock;
  log?: RoomLog;
  events?: EventSink;
  /** Pembangkit kode kelompok. */
  newGroupId?: () => string;
  newSeed?: () => string;
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
    this.newSeed = deps.newSeed ?? (() => randomBytes(12).toString("hex"));
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
        case "start": {
          const room = this.rooms.get(rec.roomId);
          if (!room) break;
          room.gameNo = rec.gameNo;
          room.phase = "playing";
          room.game = { state: init(rec.config, rec.seed), roomSeats: rec.roomSeats, devices: this.deviceIds(room, rec.roomSeats), deadline: null, cancelTimer: null };
          room.lastActivity = rec.ts;
          break;
        }
        case "move": {
          const room = this.rooms.get(rec.roomId);
          if (!room?.game || room.gameNo !== rec.gameNo) break;
          const next = apply(room.game.state, rec.move);
          if (isEngineError(next)) throw new Error(`Log rusak untuk room ${rec.roomId}: ${next.code}`);
          room.game.state = next;
          if (next.result) this.markFinished(room, next);
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

  private blankRoom(id: string, groupId: string, ts: number): Room {
    return {
      id,
      groupId,
      lastActivity: ts,
      hostSeat: 0,
      seats: Array.from({ length: this.cfg.maxSeats }, () => null),
      phase: "lobby",
      gameNo: 0,
      game: null,
      lastWinnerSeat: null,
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

  private markFinished(room: Room, state: GapleState): void {
    room.phase = "finished";
    const game = room.game as ActiveGame;
    game.cancelTimer?.();
    game.cancelTimer = null;
    game.deadline = null;
    const winnerEngineSeat = (state.result as NonNullable<GapleState["result"]>).winner;
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
      const mine = engineSeatOf(member.seat);
      const moves: MoveView[] =
        mine >= 0
          ? legalMoves(st, mine).map((m) => (m.type === "pass" ? { type: "pass" } : { type: "play", card: m.card, end: m.end }))
          : [];
      gameView = {
        board: st.board,
        ends: ends(st),
        turn: game.roomSeats[st.turn] as number,
        turnDeadline: game.deadline,
        yourHand: mine >= 0 ? (st.hands[mine] ?? []) : [],
        yourMoves: moves,
        moveCount: st.log.length,
        result: st.result
          ? {
              reason: st.result.reason,
              winner: game.roomSeats[st.result.winner] as number,
              ranking: st.result.ranking.map((r) => ({
                seat: game.roomSeats[r.seat] as number,
                rank: r.rank,
                points: r.points,
                cardsLeft: r.cardsLeft,
              })),
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
            cardsLeft: game && es >= 0 ? (game.state.hands[es]?.length ?? 0) : null,
            isYou: m === member,
          };
        }),
      },
      you: { seat: member.seat },
      game: gameView,
    };
  }

  private broadcast(room: Room): void {
    for (const m of room.seats) m?.conn?.send(this.view(room, m));
  }

  // ---------- timer giliran ----------

  private armTimer(room: Room): void {
    const game = room.game;
    if (!game || room.phase !== "playing") return;
    game.cancelTimer?.();
    const stamp = game.state.log.length;
    const gameNo = room.gameNo;
    game.deadline = this.clock.now() + this.cfg.turnTimeoutMs;
    game.cancelTimer = this.clock.setTimeout(() => {
      if (this.stopped || room.phase !== "playing" || room.gameNo !== gameNo || room.game?.state.log.length !== stamp) return;
      this.autoMove(room);
    }, this.cfg.turnTimeoutMs);
  }

  /** Waktu habis: lewat bila tidak ada langkah lain; selain itu kartu sah pertama. */
  private autoMove(room: Room): void {
    const game = room.game as ActiveGame;
    const options = legalMoves(game.state, game.state.turn);
    const move = options[0];
    if (!move) return;
    this.commitMove(room, move, true);
    this.broadcast(room);
  }

  /** Terapkan langkah yang sudah divalidasi mesin: log, timer, penutupan game. */
  private commitMove(room: Room, move: Move, auto: boolean): ProtocolError | null {
    const game = room.game as ActiveGame;
    const next = apply(game.state, move);
    if (isEngineError(next)) return err(next.code, next.message);
    const rec: LogRecord = { t: "move", roomId: room.id, ts: this.clock.now(), gameNo: room.gameNo, move };
    this.append(auto ? { ...rec, auto: true } : rec);
    game.state = next;
    if (next.result) {
      this.markFinished(room, next);
      const ranking = next.result.ranking.map((r) => game.roomSeats[r.seat]).join(">");
      this.emit(
        room,
        "game_finished",
        null,
        `reason=${next.result.reason};players=${game.roomSeats.length};ranking=${ranking};devices=${game.devices.join("|")}`,
      );
    } else {
      this.armTimer(room);
    }
    return null;
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
      case "create_room":
        return this.createGroup(conn, msg.name, msg.token);
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
      case "play":
        return this.playerMove(conn, room, member, { type: "play", seat: -1, card: canonical(msg.card), end: msg.end });
      case "pass":
        return this.playerMove(conn, room, member, { type: "pass", seat: -1 });
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

  private createGroup(conn: Conn, name: string, token: string): void {
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
    const roomSeats = room.seats.flatMap((m, i) => (m ? [i] : []));
    if (roomSeats.length < this.cfg.minPlayersToStart) {
      conn.send(err("NEED_MORE_PLAYERS", `Butuh minimal ${this.cfg.minPlayersToStart} pemain untuk mulai.`));
      return;
    }
    // Rematch: pemenang game sebelumnya membuka dengan kartu bebas (parameter openerSeat mesin).
    const winnerEngine = rematch && room.lastWinnerSeat !== null ? roomSeats.indexOf(room.lastWinnerSeat) : -1;
    const config: GapleConfig = createConfig({
      ...this.cfg.game,
      players: roomSeats.length as 2 | 3 | 4,
      openerSeat: winnerEngine >= 0 ? winnerEngine : null,
    });
    const seed = this.newSeed();
    room.gameNo += 1;
    room.phase = "playing";
    room.game = { state: init(config, seed), roomSeats, devices: this.deviceIds(room, roomSeats), deadline: null, cancelTimer: null };
    this.append({ t: "start", roomId: room.id, ts: this.clock.now(), gameNo: room.gameNo, seed, config, roomSeats });
    this.emit(room, "game_started", null, `players=${roomSeats.length};rematch=${rematch ? 1 : 0};devices=${room.game?.devices.join("|") ?? ""}`);
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
    if (game.state.turn === mine) {
      conn.send(err("SELF_TURN", "Sekarang giliranmu, bukan giliran temanmu."));
      return;
    }
    const now = this.clock.now();
    if (member.lastNudge !== null && now - member.lastNudge < this.cfg.nudgeIntervalMs) {
      conn.send(err("RATE_LIMITED", "Tunggu sebentar sebelum menyundul lagi."));
      return;
    }
    const targetSeat = game.roomSeats[game.state.turn] as number;
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

  private playerMove(conn: Conn, room: Room, member: Member, move: Move): void {
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
    const error = this.commitMove(room, { ...move, seat: engineSeat } as Move, false);
    if (error) {
      conn.send(error);
      return;
    }
    this.broadcast(room);
  }

  // ---------- koneksi ----------

  onDisconnect(conn: Conn): void {
    const ctx = this.contextOf(conn);
    conn.session = null;
    if (!ctx) return;
    ctx.member.conn = null;
    this.touch(ctx.room);
    this.broadcast(ctx.room);
  }
}
