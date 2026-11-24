/** Penyimpanan lokal yang tidak pernah melempar galat: bila localStorage gagal (mode privat, diblokir), pakai memori. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function createKV(getStore: () => Storage = () => window.localStorage): KV {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        const v = getStore().getItem(key);
        if (v !== null) return v;
      } catch {
        // abaikan, pakai memori
      }
      return memory.get(key) ?? null;
    },
    set(key, value) {
      memory.set(key, value);
      try {
        getStore().setItem(key, value);
      } catch {
        // abaikan, sudah tersimpan di memori
      }
    },
  };
}

export function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKEN_KEY = "gmers.token";
const NAME_KEY = "gmers.name";
const SESSION_KEY = "gmers.session";
const ACCOUNT_KEY = "gmers.account";

/** Identitas perangkat: token acak + nama panggilan. Tanpa akun, tanpa data pribadi lain. */
export class Identity {
  private cached: string | null = null;
  constructor(private readonly kv: KV) {}
  token(): string {
    if (this.cached) return this.cached;
    let t = this.kv.get(TOKEN_KEY);
    if (!t || !/^[A-Za-z0-9_-]{16,128}$/.test(t)) {
      t = randomToken();
      this.kv.set(TOKEN_KEY, t);
    }
    this.cached = t;
    return t;
  }
  /** Mengganti identitas room (saat masuk ke akun, atau kembali jadi tamu baru saat keluar). */
  setToken(token: string): void {
    this.kv.set(TOKEN_KEY, token);
    this.cached = token;
  }
  /** Sesi masuk: tersimpan permanen di perangkat sampai pengguna memilih keluar. */
  session(): string | null {
    return this.kv.get(SESSION_KEY) || null;
  }
  setSession(session: string | null): void {
    this.kv.set(SESSION_KEY, session ?? "");
  }
  /** Salinan ringan akun untuk ditampilkan saat server tak terjangkau. */
  cachedAccount(): { username: string; name: string } | null {
    try {
      const raw = this.kv.get(ACCOUNT_KEY);
      return raw ? (JSON.parse(raw) as { username: string; name: string }) : null;
    } catch {
      return null;
    }
  }
  setCachedAccount(a: { username: string; name: string } | null): void {
    this.kv.set(ACCOUNT_KEY, a ? JSON.stringify(a) : "");
  }
  name(): string | null {
    return this.kv.get(NAME_KEY);
  }
  setName(name: string): void {
    this.kv.set(NAME_KEY, name);
  }
}
