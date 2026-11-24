import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Clock } from "./clock";

/** Pertemanan, blokir, laporan, status, dan streak (spesifikasi bagian 6, 5.4, 8, 14). Isi chat TIDAK pernah disimpan di sini. */
export type Status = "siap" | "sibuk" | "senyap" | "dnd";
export const STATUSES: Status[] = ["siap", "sibuk", "senyap", "dnd"];

export interface NotifPrefs {
  invite: boolean;
  follow: boolean;
  streak: boolean;
  dm: boolean;
}
export const DEFAULT_PREFS: NotifPrefs = { invite: true, follow: true, streak: true, dm: true };

export type SocialRecord =
  | { t: "follow"; a: string; b: string; on: boolean }
  | { t: "contact"; a: string; b: string; on: boolean }
  | { t: "block"; a: string; b: string; on: boolean }
  | { t: "status"; a: string; status: Status }
  | { t: "prefs"; a: string; prefs: NotifPrefs }
  | { t: "pairday"; pair: string; day: number }
  | { t: "report"; id: string; ts: number; from: string; kind: string; target: string; reason: string }
  | { t: "purge"; a: string };

export interface SocialLog {
  append(rec: SocialRecord): void;
  readAll(): SocialRecord[];
}

export class MemorySocialLog implements SocialLog {
  private recs: SocialRecord[] = [];
  append(rec: SocialRecord): void {
    this.recs.push(JSON.parse(JSON.stringify(rec)) as SocialRecord);
  }
  readAll(): SocialRecord[] {
    return this.recs.slice();
  }
}

export class FileSocialLog implements SocialLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(rec: SocialRecord): void {
    appendFileSync(this.file, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  }
  readAll(): SocialRecord[] {
    if (!existsSync(this.file)) return [];
    const out: SocialRecord[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as SocialRecord);
      } catch {
        // baris terpotong dilewati
      }
    }
    return out;
  }
}

export interface Report {
  id: string;
  ts: number;
  /** Id akun pelapor. */
  from: string;
  kind: string;
  target: string;
  reason: string;
}

const DAY = 86_400_000;
/** Hari streak berjalan 03.00 sampai 03.00 WIB (spek 8). Nomor hari. */
export const streakDay = (ts: number): number => Math.floor((ts + 4 * 3_600_000) / DAY);
/** Awal minggu streak: Senin (hari ke-4 sejak epoch Kamis 1 Jan 1970 => Senin = day%7==4). */
const weekOf = (day: number): number => Math.floor((day + 3) / 7);

export interface StreakInfo {
  count: number;
  doneToday: boolean;
  /** Pembeku (freeze) tersisa. */
  freezes: number;
}

export class Social {
  private readonly follows = new Map<string, Set<string>>();
  private readonly contacts = new Map<string, Set<string>>();
  private readonly blocks = new Map<string, Set<string>>();
  private readonly statuses = new Map<string, Status>();
  private readonly prefs = new Map<string, NotifPrefs>();
  private readonly pairDays = new Map<string, Set<number>>();
  readonly reports: Report[] = [];

  constructor(
    private readonly log: SocialLog,
    private readonly clock: Clock,
  ) {
    for (const r of log.readAll()) this.apply(r);
  }

  private apply(r: SocialRecord): void {
    switch (r.t) {
      case "follow":
        this.toggle(this.follows, r.a, r.b, r.on);
        break;
      case "contact":
        this.toggle(this.contacts, r.a, r.b, r.on);
        break;
      case "block":
        this.toggle(this.blocks, r.a, r.b, r.on);
        break;
      case "status":
        this.statuses.set(r.a, r.status);
        break;
      case "prefs":
        this.prefs.set(r.a, r.prefs);
        break;
      case "pairday": {
        const s = this.pairDays.get(r.pair) ?? new Set<number>();
        s.add(r.day);
        this.pairDays.set(r.pair, s);
        break;
      }
      case "report":
        this.reports.push({ id: r.id, ts: r.ts, from: r.from, kind: r.kind, target: r.target, reason: r.reason });
        break;
      case "purge":
        this.purgeLocal(r.a);
        break;
    }
  }

  private toggle(m: Map<string, Set<string>>, a: string, b: string, on: boolean): void {
    const s = m.get(a) ?? new Set<string>();
    if (on) s.add(b);
    else s.delete(b);
    m.set(a, s);
  }

  private has(m: Map<string, Set<string>>, a: string, b: string): boolean {
    return m.get(a)?.has(b) ?? false;
  }

  private emit(r: SocialRecord): void {
    this.log.append(r);
    this.apply(r);
  }

  isBlocked(a: string, b: string): boolean {
    return this.has(this.blocks, a, b) || this.has(this.blocks, b, a);
  }

  iBlocked(a: string, b: string): boolean {
    return this.has(this.blocks, a, b);
  }

  /** Teman = saling mengikuti, atau saling menyimpan kontak (dan tidak ada blokir). Dihitung ulang tiap saat dari data dasar. */
  areFriends(a: string, b: string): boolean {
    if (a === b || this.isBlocked(a, b)) return false;
    return (this.has(this.follows, a, b) && this.has(this.follows, b, a)) || (this.has(this.contacts, a, b) && this.has(this.contacts, b, a));
  }

  follow(a: string, b: string, on: boolean): boolean {
    if (a === b || (on && this.isBlocked(a, b))) return false;
    if (this.has(this.follows, a, b) === on) return true;
    this.emit({ t: "follow", a, b, on });
    return true;
  }

  saveContact(a: string, b: string, on: boolean): boolean {
    if (a === b || (on && this.isBlocked(a, b))) return false;
    if (this.has(this.contacts, a, b) === on) return true;
    this.emit({ t: "contact", a, b, on });
    return true;
  }

  /** Blokir memutus pertemanan dan semua kontak (spek 6): ikut, simpan kontak di kedua arah dihapus. */
  block(a: string, b: string, on: boolean): boolean {
    if (a === b) return false;
    if (on) {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        if (this.has(this.follows, x, y)) this.emit({ t: "follow", a: x, b: y, on: false });
        if (this.has(this.contacts, x, y)) this.emit({ t: "contact", a: x, b: y, on: false });
      }
    }
    if (this.has(this.blocks, a, b) !== on) this.emit({ t: "block", a, b, on });
    return true;
  }

  report(from: string, kind: string, target: string, reason: string): Report {
    const rec = { t: "report" as const, id: randomBytes(6).toString("hex"), ts: this.clock.now(), from, kind, target, reason: reason.slice(0, 300) };
    this.emit(rec);
    return this.reports[this.reports.length - 1] as Report;
  }

  status(a: string): Status {
    return this.statuses.get(a) ?? "siap";
  }

  setStatus(a: string, status: Status): void {
    if (this.status(a) !== status) this.emit({ t: "status", a, status });
  }

  prefsOf(a: string): NotifPrefs {
    return { ...DEFAULT_PREFS, ...(this.prefs.get(a) ?? {}) };
  }

  setPrefs(a: string, patch: Partial<NotifPrefs>): NotifPrefs {
    const next = { ...this.prefsOf(a), ...patch };
    this.emit({ t: "prefs", a, prefs: next });
    return next;
  }

  /** Hubungan satu arah untuk daftar teman. */
  relation(me: string, other: string): { iFollow: boolean; followsMe: boolean; iSaved: boolean; savedMe: boolean; friend: boolean; iBlocked: boolean } {
    return {
      iFollow: this.has(this.follows, me, other),
      followsMe: this.has(this.follows, other, me),
      iSaved: this.has(this.contacts, me, other),
      savedMe: this.has(this.contacts, other, me),
      friend: this.areFriends(me, other),
      iBlocked: this.has(this.blocks, me, other),
    };
  }

  /** Id akun yang pernah berhubungan dengan `me`. */
  related(me: string): { friends: string[]; waiting: string[]; incoming: string[]; blocked: string[] } {
    const ids = new Set<string>([...(this.follows.get(me) ?? []), ...(this.contacts.get(me) ?? []), ...(this.blocks.get(me) ?? [])]);
    for (const [a, s] of this.follows) if (s.has(me)) ids.add(a);
    for (const [a, s] of this.contacts) if (s.has(me)) ids.add(a);
    const out = { friends: [] as string[], waiting: [] as string[], incoming: [] as string[], blocked: [] as string[] };
    for (const o of ids) {
      if (o === me) continue;
      const r = this.relation(me, o);
      if (r.iBlocked) out.blocked.push(o);
      else if (this.isBlocked(me, o)) continue;
      else if (r.friend) out.friends.push(o);
      else if (r.iFollow || r.iSaved) out.waiting.push(o);
      else if (r.followsMe || r.savedMe) out.incoming.push(o);
    }
    return out;
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join(",");
  }

  /** Catat bahwa akun-akun ini menyelesaikan game bersama: hari itu dihitung untuk streak tiap pasangan yang berteman. */
  recordGame(accountIds: string[], ts: number): void {
    const day = streakDay(ts);
    const ids = [...new Set(accountIds)];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i] as string;
        const b = ids[j] as string;
        if (!this.areFriends(a, b)) continue;
        const key = this.pairKey(a, b);
        if (!this.pairDays.get(key)?.has(day)) this.emit({ t: "pairday", pair: key, day });
      }
    }
  }

  /**
   * Streak pasangan: hari berturut-turut (03.00-03.00 WIB) dengan minimal satu game selesai bersama. Aturan pemaaf:
   * 1 pembeku gratis per minggu (tabung maksimal 2) menutup satu hari yang terlewat; hari ini yang belum dimainkan
   * belum dianggap putus.
   */
  streak(a: string, b: string, now = this.clock.now()): StreakInfo {
    const days = this.pairDays.get(this.pairKey(a, b));
    const today = streakDay(now);
    if (!days || days.size === 0) return { count: 0, doneToday: false, freezes: 0 };
    const first = Math.min(...days);
    let count = 0;
    let freezes = 0;
    let week = weekOf(first) - 1;
    for (let d = first; d <= today; d++) {
      if (weekOf(d) !== week) {
        week = weekOf(d);
        freezes = Math.min(2, freezes + 1);
      }
      if (days.has(d)) count++;
      else if (d < today) {
        if (freezes > 0) freezes--;
        else count = 0;
      }
    }
    return { count, doneToday: days.has(today), freezes };
  }

  pairKeys(): string[] {
    return [...this.pairDays.keys()];
  }

  /** Hapus semua hubungan sebuah akun (saat akun dihapus). */
  purge(a: string): void {
    this.emit({ t: "purge", a });
  }

  private purgeLocal(a: string): void {
    this.follows.delete(a);
    this.contacts.delete(a);
    this.blocks.delete(a);
    this.statuses.delete(a);
    this.prefs.delete(a);
    for (const m of [this.follows, this.contacts, this.blocks]) for (const s of m.values()) s.delete(a);
    for (const k of [...this.pairDays.keys()]) if (k.split(",").includes(a)) this.pairDays.delete(k);
  }
}
