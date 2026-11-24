import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Clock } from "./clock";
import type { ServerConfig } from "./config";
import { hashToken } from "./service";

/** Akun sederhana: nama pengguna + kata sandi. Tanpa email dan tanpa nomor HP. */
export interface Prefs {
  theme?: "auto" | "light" | "dark";
  sound?: boolean;
}

export interface PassHash {
  salt: string;
  hash: string;
  n: number;
}

export interface Account {
  id: string;
  username: string;
  /** Nama pengguna huruf kecil (kunci unik). */
  key: string;
  pass: PassHash;
  /** Identitas room akun ini (dipakai sebagai token perangkat di room). Rahasia. */
  token: string;
  name: string;
  prefs: Prefs;
  groups: { groupId: string; ts: number }[];
  createdAt: number;
}

export type AccountRecord =
  | { t: "account"; account: Account }
  | { t: "profile"; id: string; name?: string; prefs?: Prefs }
  | { t: "pass"; id: string; pass: PassHash }
  | { t: "group"; id: string; groupId: string; ts: number }
  | { t: "session"; h: string; id: string; exp: number | null }
  | { t: "revoke"; h: string }
  | { t: "delete"; id: string };

export interface AccountLog {
  append(rec: AccountRecord): void;
  readAll(): AccountRecord[];
}

export class MemoryAccountLog implements AccountLog {
  private recs: AccountRecord[] = [];
  append(rec: AccountRecord): void {
    this.recs.push(JSON.parse(JSON.stringify(rec)) as AccountRecord);
  }
  readAll(): AccountRecord[] {
    return this.recs.slice();
  }
}

export class FileAccountLog implements AccountLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(rec: AccountRecord): void {
    appendFileSync(this.file, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  }
  readAll(): AccountRecord[] {
    if (!existsSync(this.file)) return [];
    const out: AccountRecord[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AccountRecord);
      } catch {
        // baris terpotong dilewati
      }
    }
    return out;
  }
}

export interface AuthError {
  status: number;
  code: string;
  message: string;
}

export const isAuthError = (x: unknown): x is AuthError => typeof x === "object" && x !== null && "status" in x && "code" in x && "message" in x;

function fail(status: number, code: string, message: string): AuthError {
  return { status, code, message };
}

export interface PublicAccount {
  username: string;
  name: string;
  token: string;
  prefs: Prefs;
  groups: { groupId: string; ts: number }[];
}

export interface AuthResult {
  session: string;
  account: PublicAccount;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function scryptAsync(password: string, salt: Buffer, n: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 };
  return new Promise((resolve, reject) => scrypt(password, salt, 64, opts, (e, key) => (e ? reject(e) : resolve(key))));
}

export class AccountService {
  private readonly byId = new Map<string, Account>();
  private readonly byKey = new Map<string, string>();
  private readonly byTokenHash = new Map<string, string>();
  private readonly sessions = new Map<string, { id: string; exp: number | null }>();
  private readonly fails = new Map<string, { n: number; until: number }>();
  private regTimes: number[] = [];

  constructor(
    private readonly cfg: ServerConfig,
    private readonly log: AccountLog,
    private readonly clock: Clock,
    /** Kelompok yang sedang diduduki perangkat itu saat mendaftar (agar ikut tercatat di akun). */
    private readonly groupsFor: (tokenHash: string) => string[] = () => [],
    /** Dipanggil saat akun dihapus (membersihkan hubungan sosial). */
    private readonly onDelete: (accountId: string) => void = () => undefined,
  ) {
    this.restore();
  }

  get count(): number {
    return this.byId.size;
  }

  private restore(): void {
    for (const r of this.log.readAll()) {
      switch (r.t) {
        case "account":
          this.index(r.account);
          break;
        case "profile": {
          const a = this.byId.get(r.id);
          if (a) {
            if (r.name !== undefined) a.name = r.name;
            if (r.prefs) a.prefs = { ...a.prefs, ...r.prefs };
          }
          break;
        }
        case "pass": {
          const a = this.byId.get(r.id);
          if (a) a.pass = r.pass;
          break;
        }
        case "group":
          this.addGroup(r.id, r.groupId, r.ts);
          break;
        case "session":
          this.sessions.set(r.h, { id: r.id, exp: r.exp });
          break;
        case "revoke":
          this.sessions.delete(r.h);
          break;
        case "delete":
          this.unindex(r.id);
          break;
      }
    }
  }

  private index(a: Account): void {
    this.byId.set(a.id, a);
    this.byKey.set(a.key, a.id);
    this.byTokenHash.set(hashToken(a.token, this.cfg.hashSalt), a.id);
  }

  private unindex(id: string): void {
    const a = this.byId.get(id);
    if (!a) return;
    this.byId.delete(id);
    this.byKey.delete(a.key);
    this.byTokenHash.delete(hashToken(a.token, this.cfg.hashSalt));
    for (const [h, s] of this.sessions) if (s.id === id) this.sessions.delete(h);
  }

  private addGroup(id: string, groupId: string, ts: number): void {
    const a = this.byId.get(id);
    if (!a) return;
    const g = a.groups.find((x) => x.groupId === groupId);
    if (g) g.ts = Math.max(g.ts, ts);
    else a.groups.push({ groupId, ts });
    a.groups.sort((x, y) => y.ts - x.ts);
    if (a.groups.length > 50) a.groups.length = 50;
  }

  private async hash(password: string): Promise<PassHash> {
    const salt = randomBytes(16);
    const n = this.cfg.passwordCost;
    return { salt: salt.toString("hex"), hash: (await scryptAsync(password, salt, n)).toString("hex"), n };
  }

  private async verify(password: string, p: PassHash): Promise<boolean> {
    const got = await scryptAsync(password, Buffer.from(p.salt, "hex"), p.n);
    const want = Buffer.from(p.hash, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  }

  private pub(a: Account): PublicAccount {
    return { username: a.username, name: a.name, token: a.token, prefs: a.prefs, groups: a.groups };
  }

  private issue(a: Account): AuthResult {
    const session = randomBytes(32).toString("hex");
    const exp = this.cfg.sessionTtlMs === null ? null : this.clock.now() + this.cfg.sessionTtlMs;
    this.sessions.set(sha(session), { id: a.id, exp });
    this.log.append({ t: "session", h: sha(session), id: a.id, exp });
    return { session, account: this.pub(a) };
  }

  async register(input: { username: string; password: string; name: string; token: string }): Promise<AuthResult | AuthError> {
    const now = this.clock.now();
    this.regTimes = this.regTimes.filter((t) => now - t < 60_000);
    if (this.regTimes.length >= this.cfg.registerBurst) return fail(429, "RATE_LIMITED", "Terlalu banyak pendaftaran. Coba lagi sebentar lagi.");
    this.regTimes.push(now);
    const key = input.username.toLowerCase();
    if (this.byKey.has(key)) return fail(409, "USERNAME_TAKEN", "Nama pengguna itu sudah dipakai.");
    // Identitas room: pakai token perangkat yang sedang dipakai bila belum terikat akun lain (kursi dan metrik tetap menyambung).
    const bound = this.byTokenHash.has(hashToken(input.token, this.cfg.hashSalt));
    const token = bound ? randomBytes(16).toString("hex") : input.token;
    const account: Account = {
      id: randomBytes(8).toString("hex"),
      username: input.username,
      key,
      pass: await this.hash(input.password),
      token,
      name: input.name,
      prefs: {},
      groups: [],
      createdAt: now,
    };
    if (this.byKey.has(key)) return fail(409, "USERNAME_TAKEN", "Nama pengguna itu sudah dipakai.");
    this.index(account);
    this.log.append({ t: "account", account });
    for (const groupId of this.groupsFor(hashToken(account.token, this.cfg.hashSalt))) this.noteGroup(hashToken(account.token, this.cfg.hashSalt), groupId);
    return this.issue(account);
  }

  async login(input: { username: string; password: string }): Promise<AuthResult | AuthError> {
    const key = input.username.toLowerCase();
    const now = this.clock.now();
    const f = this.fails.get(key);
    if (f && f.until > now) return fail(429, "LOCKED", "Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.");
    const id = this.byKey.get(key);
    const account = id ? this.byId.get(id) : undefined;
    // Hash tiruan untuk nama yang tidak ada, supaya waktu jawaban tidak membocorkan keberadaan akun.
    const ok = account ? await this.verify(input.password, account.pass) : (await this.verify(input.password, { salt: "00".repeat(16), hash: "00".repeat(64), n: this.cfg.passwordCost }), false);
    if (!account || !ok) {
      const lockExpired = !!f && f.until > 0 && f.until <= now;
      const n = (lockExpired ? 0 : (f?.n ?? 0)) + 1;
      this.fails.set(key, { n, until: n >= this.cfg.loginMaxFails ? now + this.cfg.loginLockMs : 0 });
      return fail(401, "BAD_CREDENTIALS", "Nama pengguna atau kata sandi salah.");
    }
    this.fails.delete(key);
    return this.issue(account);
  }

  private find(session: string | null): Account | null {
    if (!session) return null;
    const h = sha(session);
    const s = this.sessions.get(h);
    if (!s) return null;
    if (s.exp !== null && s.exp <= this.clock.now()) {
      this.sessions.delete(h);
      return null;
    }
    return this.byId.get(s.id) ?? null;
  }

  /** Akun milik sesi (termasuk id internal), atau null. */
  identify(session: string | null): { id: string; username: string; name: string; token: string } | null {
    const a = this.find(session);
    return a ? { id: a.id, username: a.username, name: a.name, token: a.token } : null;
  }

  accountIdByTokenHash(tokenHash: string): string | null {
    return this.byTokenHash.get(tokenHash) ?? null;
  }

  /** Nama tampilan dan nama pengguna sebuah akun (untuk papan peringkat). */
  nameOf(accountId: string): { name: string; username: string } | null {
    const a = this.byId.get(accountId);
    return a ? { name: a.name, username: a.username } : null;
  }

  /** Cari akun lewat nama pengguna (tanpa membedakan huruf besar/kecil). Hanya info publik. */
  byUsername(username: string): { id: string; username: string; name: string } | null {
    const id = this.byKey.get(username.trim().toLowerCase());
    const a = id ? this.byId.get(id) : undefined;
    return a ? { id: a.id, username: a.username, name: a.name } : null;
  }

  profileOf(accountId: string): { id: string; username: string; name: string } | null {
    const a = this.byId.get(accountId);
    return a ? { id: a.id, username: a.username, name: a.name } : null;
  }

  idOfSession(session: string | null): string | null {
    return this.find(session)?.id ?? null;
  }

  me(session: string | null): PublicAccount | null {
    const a = this.find(session);
    return a ? this.pub(a) : null;
  }

  logout(session: string | null): void {
    if (!session) return;
    const h = sha(session);
    if (this.sessions.delete(h)) this.log.append({ t: "revoke", h });
  }

  updateProfile(session: string | null, patch: { name?: string; prefs?: Prefs }): PublicAccount | AuthError {
    const a = this.find(session);
    if (!a) return fail(401, "UNAUTHORIZED", "Silakan masuk lagi.");
    if (patch.name !== undefined) a.name = patch.name;
    if (patch.prefs) a.prefs = { ...a.prefs, ...patch.prefs };
    this.log.append({ t: "profile", id: a.id, name: patch.name, prefs: patch.prefs });
    return this.pub(a);
  }

  async changePassword(session: string | null, oldPassword: string, newPassword: string): Promise<{ ok: true } | AuthError> {
    const a = this.find(session);
    if (!a) return fail(401, "UNAUTHORIZED", "Silakan masuk lagi.");
    if (!(await this.verify(oldPassword, a.pass))) return fail(401, "BAD_CREDENTIALS", "Kata sandi lama salah.");
    a.pass = await this.hash(newPassword);
    this.log.append({ t: "pass", id: a.id, pass: a.pass });
    // Sesi lain dicabut; sesi ini dipertahankan.
    const keep = sha(session as string);
    for (const [h, s] of [...this.sessions]) {
      if (s.id === a.id && h !== keep) {
        this.sessions.delete(h);
        this.log.append({ t: "revoke", h });
      }
    }
    return { ok: true };
  }

  async deleteAccount(session: string | null, password: string): Promise<{ ok: true } | AuthError> {
    const a = this.find(session);
    if (!a) return fail(401, "UNAUTHORIZED", "Silakan masuk lagi.");
    if (!(await this.verify(password, a.pass))) return fail(401, "BAD_CREDENTIALS", "Kata sandi salah.");
    this.unindex(a.id);
    this.log.append({ t: "delete", id: a.id });
    this.onDelete(a.id);
    return { ok: true };
  }

  /** Reset oleh admin (tanpa email, pemilik layanan yang mengatur ulang). Mencabut semua sesi akun itu. */
  async adminReset(username: string, newPassword: string): Promise<{ ok: true } | AuthError> {
    const id = this.byKey.get(username.toLowerCase());
    const a = id ? this.byId.get(id) : undefined;
    if (!a) return fail(404, "NOT_FOUND", "Akun tidak ditemukan.");
    a.pass = await this.hash(newPassword);
    this.log.append({ t: "pass", id: a.id, pass: a.pass });
    for (const [h, s] of [...this.sessions]) {
      if (s.id === a.id) {
        this.sessions.delete(h);
        this.log.append({ t: "revoke", h });
      }
    }
    this.fails.delete(a.key);
    return { ok: true };
  }

  /** Dipanggil layanan room saat sebuah perangkat duduk di kelompok: ingat daftar room akun itu. */
  noteGroup(tokenHash: string, groupId: string): void {
    const id = this.byTokenHash.get(tokenHash);
    if (!id) return;
    const ts = this.clock.now();
    this.addGroup(id, groupId, ts);
    this.log.append({ t: "group", id, groupId, ts });
  }
}
