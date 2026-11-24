import type { KV } from "./storage";

/** Riwayat chat disimpan HANYA di perangkat (peramban). Server tidak pernah menyimpan isi chat. */
export interface InviteInfo {
  id: string;
  game: "gaple" | "ludo";
  groupId: string;
  expiresAt: number;
  dir: "in" | "out";
  /** pending = menunggu jawabanku (masuk); sent = terkirim (keluar); selain itu jawaban akhir. */
  state: "pending" | "sent" | "join" | "later" | "busy" | "auto_busy" | "expired";
}

export interface StoredMsg {
  kind: "msg" | "sys" | "invite";
  invite?: InviteInfo;
  seat: number;
  name: string;
  text: string;
  ts: number;
  mine: boolean;
}

export interface Member {
  seat: number;
  name: string;
}

export interface Convo {
  /** Kode kelompok (room) atau `@namapengguna` untuk percakapan 1-1 antar teman. */
  groupId: string;
  /** Hanya untuk chat 1-1 dengan teman. */
  dm?: { username: string; name: string };
  /** Kursi saya di sesi terakhir (untuk mengenali "teman" pada chat berdua). */
  me: number;
  members: Member[];
  lastTs: number;
  unread: number;
  msgs: StoredMsg[];
}

export type ConvoKind = "direct" | "group";

const KEY = "gmers.chats.v1";
export const MAX_CONVOS = 30;
export const MAX_MSGS = 200;

/** Room berdua tampil seperti chat biasa; selain itu seperti grup. */
export function kindOf(c: Pick<Convo, "members" | "dm">): ConvoKind {
  return c.dm || c.members.length === 2 ? "direct" : "group";
}

export function otherMember(c: Convo): Member | null {
  if (c.dm) return { seat: -2, name: c.dm.name };
  return c.members.find((m) => m.seat !== c.me) ?? null;
}

export class ChatStore {
  private convos: Convo[] = [];

  constructor(
    private readonly kv: KV,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.kv.get(KEY);
      const data = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(data)) this.convos = data.filter(isConvo).slice(0, MAX_CONVOS);
    } catch {
      this.convos = [];
    }
  }

  private save(): void {
    this.kv.set(KEY, JSON.stringify(this.convos));
  }

  /** Daftar percakapan, terbaru di atas. */
  list(): Convo[] {
    return this.convos.slice().sort((a, b) => b.lastTs - a.lastTs);
  }

  get(groupId: string): Convo | null {
    return this.convos.find((c) => c.groupId === groupId) ?? null;
  }

  totalUnread(): number {
    return this.convos.reduce((n, c) => n + c.unread, 0);
  }

  /** Buat atau perbarui percakapan dari daftar anggota terbaru. */
  ensure(groupId: string, me: number, members: Member[]): Convo {
    let c = this.get(groupId);
    if (!c) {
      c = { groupId, me, members, lastTs: this.now(), unread: 0, msgs: [] };
      this.convos.push(c);
      if (this.convos.length > MAX_CONVOS) {
        const drop = this.list().slice(MAX_CONVOS);
        this.convos = this.convos.filter((x) => !drop.includes(x));
      }
    } else {
      c.me = me;
      c.members = members;
    }
    this.save();
    return c;
  }

  /** Chat 1-1 dengan teman (kunci `@namapengguna`). Isi hanya di perangkat ini. */
  ensureDm(username: string, name: string): Convo {
    const key = `@${username}`;
    let c = this.get(key);
    if (!c) {
      c = { groupId: key, dm: { username, name }, me: -1, members: [], lastTs: this.now(), unread: 0, msgs: [] };
      this.convos.push(c);
    } else if (c.dm) c.dm = { username, name };
    this.save();
    return c;
  }

  /** Perbarui status kartu ajakan di sebuah percakapan. */
  updateInvite(groupId: string, inviteId: string, state: InviteInfo["state"]): void {
    const c = this.get(groupId);
    const m = c?.msgs.find((x) => x.invite?.id === inviteId);
    if (m?.invite) {
      m.invite.state = state;
      this.save();
    }
  }

  /** Percakapan kosong untuk room yang diketahui server (mis. dari akun di perangkat lain). */
  ensureStub(groupId: string, ts: number): void {
    if (this.get(groupId)) return;
    this.convos.push({ groupId, me: -1, members: [], lastTs: ts, unread: 0, msgs: [] });
    this.save();
  }

  add(groupId: string, msg: StoredMsg, countUnread: boolean): void {
    const c = this.get(groupId);
    if (!c) return;
    c.msgs.push(msg);
    if (c.msgs.length > MAX_MSGS) c.msgs.splice(0, c.msgs.length - MAX_MSGS);
    c.lastTs = Math.max(c.lastTs, msg.ts);
    if (countUnread && (msg.kind === "msg" || msg.kind === "invite") && !msg.mine) c.unread++;
    this.save();
  }

  markRead(groupId: string): boolean {
    const c = this.get(groupId);
    if (!c || c.unread === 0) return false;
    c.unread = 0;
    this.save();
    return true;
  }

  clear(): void {
    this.convos = [];
    this.save();
  }
}

function isConvo(x: unknown): x is Convo {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return typeof c.groupId === "string" && typeof c.me === "number" && Array.isArray(c.members) && Array.isArray(c.msgs) && typeof c.lastTs === "number" && typeof c.unread === "number";
}
