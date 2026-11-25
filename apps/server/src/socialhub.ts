import { randomBytes } from "node:crypto";
import type { AccountService } from "./accounts";
import type { Clock } from "./clock";
import type { ServerConfig } from "./config";
import type { GameId, ProtocolError, ServerMessage } from "./protocol";
import type { Social, Status } from "./social";
import { streakDay } from "./social";

/** Bagian koneksi yang dipakai hub. */
export interface HubConn {
  readonly id: string;
  send(msg: ServerMessage): void;
  account: { id: string; username: string; name: string; token: string } | null;
}

export interface Invite {
  id: string;
  from: string;
  to: string;
  game: GameId;
  groupId: string;
  expiresAt: number;
  replied: boolean;
  /** Ditahan (Jangan ganggu atau penerima offline) dan belum dikirim. */
  held: boolean;
}

export interface Notice {
  id: string;
  kind: "follow" | "invite" | "streak" | "dm";
  text: string;
  ts: number;
  read: boolean;
}

const err = (code: string, message: string): ProtocolError => ({ type: "error", code, message });

/**
 * Pesan 1-1, ajakan main, dan notifikasi dalam aplikasi. Isi pesan hanya lewat memori (antre bila penerima offline,
 * batas jumlah dan waktu) dan tidak pernah ditulis ke disk atau catatan peristiwa.
 */
export class SocialHub {
  private readonly conns = new Map<string, Set<HubConn>>();
  private readonly pendingDm = new Map<string, { from: string; text: string; ts: number }[]>();
  private readonly invites = new Map<string, Invite>();
  private readonly feeds = new Map<string, Notice[]>();
  private readonly dmTimes = new Map<string, number[]>();
  private readonly inviteTimes = new Map<string, number[]>();
  private readonly reminded = new Map<string, number>();

  constructor(
    private readonly cfg: ServerConfig,
    private readonly clock: Clock,
    readonly social: Social,
    private readonly accounts: AccountService,
    /** Room tempat koneksi ini duduk, bila ada. */
    private readonly roomOf: (conn: HubConn) => { groupId: string; phase: "lobby" | "playing" | "finished" } | null,
  ) {}

  // ---------- koneksi dan kehadiran ----------

  attach(conn: HubConn): void {
    const acc = conn.account;
    if (!acc) return;
    const set = this.conns.get(acc.id) ?? new Set<HubConn>();
    set.add(conn);
    this.conns.set(acc.id, set);
    this.flush(conn);
  }

  detach(conn: HubConn): void {
    for (const [id, set] of this.conns) {
      if (set.delete(conn) && set.size === 0) this.conns.delete(id);
    }
  }

  isOnline(accountId: string): boolean {
    return (this.conns.get(accountId)?.size ?? 0) > 0;
  }

  private sendTo(accountId: string, msg: ServerMessage): boolean {
    const set = this.conns.get(accountId);
    if (!set || set.size === 0) return false;
    for (const c of set) c.send(msg);
    return true;
  }

  private who(accountId: string): { username: string; name: string } {
    const p = this.accounts.profileOf(accountId);
    return { username: p?.username ?? "?", name: p?.name ?? "?" };
  }

  /** Kirim yang tertahan saat penerima kembali daring dan tidak Jangan ganggu. */
  private flush(conn: HubConn): void {
    const acc = conn.account as NonNullable<HubConn["account"]>;
    if (this.social.status(acc.id) === "dnd") return;
    const now = this.clock.now();
    const dms = this.pendingDm.get(acc.id) ?? [];
    this.pendingDm.delete(acc.id);
    for (const d of dms) {
      if (now - d.ts > this.cfg.dmPendingTtlMs) continue;
      conn.send({ type: "dm", from: this.who(d.from), text: d.text, ts: d.ts });
    }
    for (const inv of this.invites.values()) {
      if (inv.to === acc.id && inv.held && !inv.replied && inv.expiresAt > now) this.deliverInvite(inv);
    }
    for (const n of this.feed(acc.id)) if (!n.read && n.ts > (this.lastSeen.get(acc.id) ?? 0)) conn.send({ type: "notice", id: n.id, kind: n.kind, text: n.text, ts: n.ts });
    this.lastSeen.set(acc.id, now);
  }

  private readonly lastSeen = new Map<string, number>();

  // ---------- pesan masuk dari klien ----------

  handle(conn: HubConn, msg: { type: string; [k: string]: unknown }): void {
    if (!conn.account) {
      conn.send(err("NOT_LOGGED_IN", "Masuk dulu untuk memakai fitur teman."));
      return;
    }
    if (msg.type === "dm_send") return this.dm(conn, conn.account.id, String(msg.to), String(msg.text));
    if (msg.type === "invite_send") return this.invite(conn, conn.account.id, String(msg.to), msg.game as GameId);
    if (msg.type === "invite_reply") return this.reply(conn, conn.account.id, String(msg.id), msg.reply as "join" | "later" | "busy");
  }

  private friendOrError(conn: HubConn, me: string, username: string): { id: string; username: string; name: string } | null {
    const other = this.accounts.byUsername(username);
    if (!other || other.id === me) {
      conn.send(err("NOT_FOUND", "Pengguna tidak ditemukan."));
      return null;
    }
    if (this.social.isBlocked(me, other.id)) {
      conn.send(err("BLOCKED", "Tidak bisa menghubungi pengguna ini."));
      return null;
    }
    if (!this.social.areFriends(me, other.id)) {
      conn.send(err("NOT_FRIENDS", "Kalian bukan teman, jadi tidak bisa berkirim pesan atau mengajak main."));
      return null;
    }
    return other;
  }

  private dm(conn: HubConn, me: string, to: string, text: string): void {
    const other = this.friendOrError(conn, me, to);
    if (!other) return;
    const now = this.clock.now();
    const times = (this.dmTimes.get(me) ?? []).filter((t) => now - t < 10_000);
    if (times.length >= 10) {
      conn.send(err("RATE_LIMITED", "Terlalu cepat. Tunggu sebentar sebelum mengirim lagi."));
      return;
    }
    times.push(now);
    this.dmTimes.set(me, times);
    const from = this.who(me);
    const dnd = this.social.status(other.id) === "dnd";
    let delivered = false;
    if (!dnd) delivered = this.sendTo(other.id, { type: "dm", from, text, ts: now });
    if (!delivered) {
      const q = this.pendingDm.get(other.id) ?? [];
      q.push({ from: me, text, ts: now });
      while (q.length > this.cfg.dmPendingMax) q.shift();
      this.pendingDm.set(other.id, q);
    }
    this.notify(other.id, "dm", `Pesan baru dari ${from.name}`);
    conn.send({ type: "dm_ack", to: other.username, ts: now, delivered });
  }

  private invite(conn: HubConn, me: string, to: string, game: GameId): void {
    const other = this.friendOrError(conn, me, to);
    if (!other) return;
    const nowMs = this.clock.now();
    const recent = (this.inviteTimes.get(me) ?? []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= this.cfg.inviteBurst) {
      conn.send(err("RATE_LIMITED", "Terlalu banyak ajakan. Tunggu sebentar."));
      return;
    }
    recent.push(nowMs);
    this.inviteTimes.set(me, recent);
    const room = this.roomOf(conn);
    if (!room || room.phase === "playing") {
      conn.send(err("NO_ROOM", "Buka room dulu (di ruang tunggu), lalu ajak temanmu."));
      return;
    }
    const now = this.clock.now();
    const inv: Invite = { id: randomBytes(6).toString("hex"), from: me, to: other.id, game, groupId: room.groupId, expiresAt: now + this.cfg.inviteTtlMs, replied: false, held: false };
    const status = this.social.status(other.id);
    const peer = { username: other.username, name: other.name };
    if (status === "sibuk") {
      // Sibuk: dibalas otomatis "Lagi sibuk, nanti ya"; undangan tidak dikirim.
      conn.send({ type: "invite_result", id: inv.id, to: peer, reply: "auto_busy" });
      return;
    }
    this.invites.set(inv.id, inv);
    if (status === "dnd" || !this.isOnline(other.id)) inv.held = true; // ditahan sampai penerima kembali
    else this.deliverInvite(inv);
    conn.send({ type: "invite_result", id: inv.id, to: peer, reply: "sent" });
  }

  private deliverInvite(inv: Invite): void {
    inv.held = false;
    const from = this.who(inv.from);
    const silent = this.social.status(inv.to) === "senyap";
    this.sendTo(inv.to, { type: "invite", id: inv.id, from, game: inv.game, groupId: inv.groupId, expiresAt: inv.expiresAt, silent });
    this.notify(inv.to, "invite", `Ajakan main dari ${from.name}`);
  }

  private reply(conn: HubConn, me: string, id: string, reply: "join" | "later" | "busy"): void {
    const inv = this.invites.get(id);
    if (!inv || inv.to !== me) {
      conn.send(err("NOT_FOUND", "Undangan tidak ditemukan."));
      return;
    }
    if (inv.replied || inv.expiresAt <= this.clock.now()) {
      conn.send(err("INVITE_EXPIRED", "Undangan itu sudah kedaluwarsa."));
      return;
    }
    inv.replied = true;
    this.sendTo(inv.from, { type: "invite_result", id, to: this.who(me), reply });
  }

  /** Penerima mengganti status; keluar dari Jangan ganggu mengirimkan yang tertahan. */
  setStatus(accountId: string, status: Status): void {
    const was = this.social.status(accountId);
    this.social.setStatus(accountId, status);
    if (was === "dnd" && status !== "dnd") for (const c of this.conns.get(accountId) ?? []) this.flush(c);
  }

  // ---------- notifikasi dalam aplikasi ----------

  feed(accountId: string): Notice[] {
    return this.feeds.get(accountId) ?? [];
  }

  markRead(accountId: string): void {
    for (const n of this.feed(accountId)) n.read = true;
  }

  /** Catat dan kirim notifikasi netral. Jenis yang dimatikan tidak dibuat; Jangan ganggu menahan kirim langsung. */
  notify(accountId: string, kind: Notice["kind"], text: string): void {
    if (!this.social.prefsOf(accountId)[kind]) return;
    const n: Notice = { id: randomBytes(6).toString("hex"), kind, text, ts: this.clock.now(), read: false };
    const feed = this.feeds.get(accountId) ?? [];
    feed.push(n);
    while (feed.length > 50) feed.shift();
    this.feeds.set(accountId, feed);
    if (this.social.status(accountId) === "dnd") return;
    this.sendTo(accountId, { type: "notice", id: n.id, kind: n.kind, text: n.text, ts: n.ts });
  }

  /** Dipanggil saat game selesai: hari streak dicatat untuk pasangan teman di antara peserta. */
  recordGame(accountIds: string[], ts: number): void {
    this.social.recordGame(accountIds, ts);
  }

  /**
   * Pengingat streak: paling banyak 1 per akun per hari streak, hanya pukul 18.00-22.00 WIB (tidak dikirim 22.00-07.00),
   * untuk pasangan dengan streak minimal 2 hari yang belum bermain hari ini.
   */
  remindStreaks(now = this.clock.now()): number {
    const hour = new Date(now + 7 * 3_600_000).getUTCHours();
    if (hour < 18 || hour >= 22) return 0;
    const day = streakDay(now);
    let sent = 0;
    for (const key of this.social.pairKeys()) {
      const [a, b] = key.split(",") as [string, string];
      if (!this.social.areFriends(a, b)) continue;
      const info = this.social.streak(a, b, now);
      if (info.count < 2 || info.doneToday) continue;
      for (const [me, other] of [[a, b], [b, a]] as const) {
        if (this.reminded.get(me) === day) continue;
        this.reminded.set(me, day);
        this.notify(me, "streak", `Streak ${info.count} hari dengan ${this.who(other).name} hampir putus`);
        sent++;
      }
    }
    return sent;
  }
}
