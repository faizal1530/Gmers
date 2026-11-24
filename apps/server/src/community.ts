import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Clock } from "./clock";

/** Komunitas yang tersedia (tetap, tanpa pembuatan komunitas oleh pengguna di MVP). */
export const COMMUNITIES = [
  { id: "gaple", name: "Gaple" },
  { id: "ludo", name: "Ludo" },
  { id: "itb", name: "Kampus Bandung" },
] as const;
export type CommunityId = (typeof COMMUNITIES)[number]["id"];

export type CommunityRecord =
  | { t: "post"; id: string; ts: number; author: string; text: string; comm: string | null }
  | { t: "reply"; id: string; ts: number; post: string; author: string; text: string }
  | { t: "like"; post: string; by: string; on: boolean }
  | { t: "save"; post: string; by: string; on: boolean }
  | { t: "hide"; post: string; by: string }
  | { t: "del"; id: string; by: string }
  | { t: "purge"; a: string };

export interface CommunityLog {
  append(rec: CommunityRecord): void;
  readAll(): CommunityRecord[];
}
export class MemoryCommunityLog implements CommunityLog {
  readonly records: CommunityRecord[] = [];
  append(rec: CommunityRecord): void {
    this.records.push(rec);
  }
  readAll(): CommunityRecord[] {
    return this.records.slice();
  }
}
export class FileCommunityLog implements CommunityLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(rec: CommunityRecord): void {
    appendFileSync(this.file, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  }
  readAll(): CommunityRecord[] {
    if (!existsSync(this.file)) return [];
    const out: CommunityRecord[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as CommunityRecord);
      } catch {
        /* baris rusak dilewati */
      }
    }
    return out;
  }
}

export interface CommunityLimits {
  postMax: number;
  replyMax: number;
  postsPerDay: number;
  repliesPerDay: number;
  pageSize: number;
}
export const defaultCommunityLimits: CommunityLimits = { postMax: 280, replyMax: 200, postsPerDay: 20, repliesPerDay: 60, pageSize: 30 };

interface Post {
  id: string;
  ts: number;
  author: string;
  text: string;
  comm: string | null;
  deleted: boolean;
  likes: Set<string>;
  replies: Reply[];
}
interface Reply {
  id: string;
  ts: number;
  author: string;
  text: string;
  deleted: boolean;
}

export type CommunityError = { ok: false; code: string; message: string };
const bad = (code: string, message: string): CommunityError => ({ ok: false, code, message });

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u2028\\u2029\\uFEFF]");
const URL_RE = /(https?:\/\/|www\.)\S+/i;

/** Validasi teks feed: tanpa tautan (anti-spam; tanpa media di MVP) dan tanpa karakter kontrol. */
export function checkText(raw: string, max: number): { ok: true; text: string } | CommunityError {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return bad("EMPTY", "Tulisan tidak boleh kosong.");
  if (Array.from(text).length > max) return bad("TOO_LONG", `Maksimal ${max} karakter.`);
  if (CONTROL.test(text)) return bad("BAD_TEXT", "Tulisan mengandung karakter yang tidak diizinkan.");
  if (URL_RE.test(text)) return bad("NO_LINKS", "Tautan belum diizinkan di Komunitas.");
  return { ok: true, text };
}

export interface FeedItem {
  id: string;
  ts: number;
  author: { username: string; name: string };
  text: string;
  comm: string | null;
  likes: number;
  replies: number;
  liked: boolean;
  saved: boolean;
  mine: boolean;
}
export interface ReplyItem {
  id: string;
  ts: number;
  author: { username: string; name: string };
  text: string;
  mine: boolean;
}

export interface CommunityDeps {
  log: CommunityLog;
  clock: Clock;
  profileOf: (accountId: string) => { username: string; name: string } | null;
  isBlocked: (a: string, b: string) => boolean;
  follows: (a: string, b: string) => boolean;
  limits?: CommunityLimits;
}

/** Feed teks: kiriman, balasan, suka, simpan, sembunyikan. Tanpa iklan dan tanpa media. */
export class Community {
  private readonly posts = new Map<string, Post>();
  private readonly order: Post[] = []; // lama -> baru
  private readonly byReply = new Map<string, Post>();
  private readonly saved = new Map<string, Set<string>>();
  private readonly hidden = new Map<string, Set<string>>();
  private readonly dayCounts = new Map<string, number>();
  readonly limits: CommunityLimits;

  constructor(private readonly d: CommunityDeps) {
    this.limits = d.limits ?? defaultCommunityLimits;
    for (const r of d.log.readAll()) this.apply(r, false);
  }

  private day(ts = this.d.clock.now()): number {
    return Math.floor((ts + 7 * 3_600_000) / 86_400_000); // hari WIB
  }

  private apply(r: CommunityRecord, live: boolean): void {
    switch (r.t) {
      case "post": {
        const p: Post = { id: r.id, ts: r.ts, author: r.author, text: r.text, comm: r.comm, deleted: false, likes: new Set(), replies: [] };
        this.posts.set(p.id, p);
        this.order.push(p);
        this.count(`p:${r.author}:${this.day(r.ts)}`, live);
        break;
      }
      case "reply": {
        const p = this.posts.get(r.post);
        if (!p) break;
        const rep: Reply = { id: r.id, ts: r.ts, author: r.author, text: r.text, deleted: false };
        p.replies.push(rep);
        this.byReply.set(rep.id, p);
        this.count(`r:${r.author}:${this.day(r.ts)}`, live);
        break;
      }
      case "like": {
        const p = this.posts.get(r.post);
        if (p) r.on ? p.likes.add(r.by) : p.likes.delete(r.by);
        break;
      }
      case "save": {
        const s = this.saved.get(r.by) ?? new Set<string>();
        r.on ? s.add(r.post) : s.delete(r.post);
        this.saved.set(r.by, s);
        break;
      }
      case "hide": {
        const s = this.hidden.get(r.by) ?? new Set<string>();
        s.add(r.post);
        this.hidden.set(r.by, s);
        break;
      }
      case "del": {
        const p = this.posts.get(r.id);
        if (p && p.author === r.by) p.deleted = true;
        const rp = this.byReply.get(r.id);
        const rep = rp?.replies.find((x) => x.id === r.id);
        if (rep && rep.author === r.by) rep.deleted = true;
        break;
      }
      case "purge":
        for (const p of this.posts.values()) {
          if (p.author === r.a) p.deleted = true;
          p.likes.delete(r.a);
          for (const rep of p.replies) if (rep.author === r.a) rep.deleted = true;
        }
        this.saved.delete(r.a);
        this.hidden.delete(r.a);
        break;
    }
  }
  private count(key: string, live: boolean): void {
    void live;
    this.dayCounts.set(key, (this.dayCounts.get(key) ?? 0) + 1);
  }
  private write(r: CommunityRecord): void {
    this.d.log.append(r);
    this.apply(r, true);
  }

  post(me: string, rawText: string, comm: string | null): { ok: true; id: string } | CommunityError {
    if (comm !== null && !COMMUNITIES.some((c) => c.id === comm)) return bad("BAD_COMMUNITY", "Komunitas tidak dikenal.");
    const t = checkText(rawText, this.limits.postMax);
    if (!t.ok) return t;
    if ((this.dayCounts.get(`p:${me}:${this.day()}`) ?? 0) >= this.limits.postsPerDay) return bad("RATE_LIMIT", "Batas kiriman harian tercapai. Coba lagi besok.");
    const id = randomBytes(6).toString("hex");
    this.write({ t: "post", id, ts: this.d.clock.now(), author: me, text: t.text, comm });
    return { ok: true, id };
  }

  reply(me: string, postId: string, rawText: string): { ok: true; id: string } | CommunityError {
    const p = this.visiblePost(me, postId);
    if (!p) return bad("NOT_FOUND", "Kiriman tidak ditemukan.");
    const t = checkText(rawText, this.limits.replyMax);
    if (!t.ok) return t;
    if ((this.dayCounts.get(`r:${me}:${this.day()}`) ?? 0) >= this.limits.repliesPerDay) return bad("RATE_LIMIT", "Batas balasan harian tercapai.");
    const id = randomBytes(6).toString("hex");
    this.write({ t: "reply", id, ts: this.d.clock.now(), post: postId, author: me, text: t.text });
    return { ok: true, id };
  }

  private visiblePost(me: string, id: string): Post | null {
    const p = this.posts.get(id);
    if (!p || p.deleted || this.d.isBlocked(me, p.author)) return null;
    return p;
  }

  like(me: string, postId: string, on: boolean): { ok: true; likes: number } | CommunityError {
    const p = this.visiblePost(me, postId);
    if (!p) return bad("NOT_FOUND", "Kiriman tidak ditemukan.");
    if (p.likes.has(me) !== on) this.write({ t: "like", post: postId, by: me, on });
    return { ok: true, likes: p.likes.size };
  }

  save(me: string, postId: string, on: boolean): { ok: true } | CommunityError {
    const p = this.visiblePost(me, postId);
    if (!p) return bad("NOT_FOUND", "Kiriman tidak ditemukan.");
    if ((this.saved.get(me)?.has(postId) ?? false) !== on) this.write({ t: "save", post: postId, by: me, on });
    return { ok: true };
  }

  hide(me: string, postId: string): { ok: true } | CommunityError {
    if (!this.posts.has(postId)) return bad("NOT_FOUND", "Kiriman tidak ditemukan.");
    this.write({ t: "hide", post: postId, by: me });
    return { ok: true };
  }

  remove(me: string, id: string): { ok: true } | CommunityError {
    const p = this.posts.get(id);
    const rep = this.byReply.get(id)?.replies.find((x) => x.id === id);
    if ((!p || p.author !== me || p.deleted) && (!rep || rep.author !== me || rep.deleted)) return bad("NOT_FOUND", "Tidak ditemukan atau bukan milikmu.");
    this.write({ t: "del", id, by: me });
    return { ok: true };
  }

  purge(accountId: string): void {
    this.write({ t: "purge", a: accountId });
  }

  private who(id: string): { username: string; name: string } {
    return this.d.profileOf(id) ?? { username: "?", name: "Pengguna dihapus" };
  }

  private item(me: string, p: Post): FeedItem {
    return {
      id: p.id,
      ts: p.ts,
      author: this.who(p.author),
      text: p.text,
      comm: p.comm,
      likes: p.likes.size,
      replies: p.replies.filter((r) => !r.deleted && !this.d.isBlocked(me, r.author)).length,
      liked: p.likes.has(me),
      saved: this.saved.get(me)?.has(p.id) ?? false,
      mine: p.author === me,
    };
  }

  /** Umpan: `untukmu` (semua), `mengikuti` (penulis yang diikuti), `tersimpan`. Terbaru dulu, halaman lewat `before` (ts). */
  feed(me: string, tab: "untukmu" | "mengikuti" | "tersimpan", comm: string | null, before: number | null): { items: FeedItem[]; next: number | null } {
    const hidden = this.hidden.get(me);
    const saved = this.saved.get(me);
    const items: FeedItem[] = [];
    let next: number | null = null;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const p = this.order[i] as Post;
      if (before !== null && p.ts >= before) continue;
      if (p.deleted || hidden?.has(p.id) || this.d.isBlocked(me, p.author)) continue;
      if (comm && p.comm !== comm) continue;
      if (tab === "mengikuti" && !(p.author === me || this.d.follows(me, p.author))) continue;
      if (tab === "tersimpan" && !saved?.has(p.id)) continue;
      if (items.length >= this.limits.pageSize) {
        next = (items[items.length - 1] as FeedItem).ts;
        break;
      }
      items.push(this.item(me, p));
    }
    return { items, next };
  }

  replies(me: string, postId: string): { post: FeedItem; replies: ReplyItem[] } | null {
    const p = this.visiblePost(me, postId);
    if (!p) return null;
    return {
      post: this.item(me, p),
      replies: p.replies.filter((r) => !r.deleted && !this.d.isBlocked(me, r.author)).map((r) => ({ id: r.id, ts: r.ts, author: this.who(r.author), text: r.text, mine: r.author === me })),
    };
  }

  /** "Kenalan hari ini": penulis aktif yang belum diikuti, urutan berganti tiap hari (WIB). Hanya nama dan nama pengguna. */
  suggestions(me: string, count = 3): { username: string; name: string }[] {
    const seen = new Set<string>();
    const cands: string[] = [];
    for (let i = this.order.length - 1; i >= 0 && cands.length < 50; i--) {
      const a = (this.order[i] as Post).author;
      if (a === me || seen.has(a) || this.d.isBlocked(me, a) || this.d.follows(me, a) || !this.d.profileOf(a)) continue;
      seen.add(a);
      cands.push(a);
    }
    const day = this.day();
    const rank = (s: string): number => {
      let h = day;
      for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return h;
    };
    return cands.sort((x, y) => rank(x) - rank(y)).slice(0, count).map((a) => this.who(a));
  }
}
