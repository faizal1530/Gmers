import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Buku besar: satu-satunya jalan untuk mengubah saldo (Trofi, Bintang, Koin). Hanya-tambah. Satu panggilan `post`
 * menulis semua barisnya dalam satu catatan, sehingga atomik. Saldo diturunkan dari baris, tidak disimpan terpisah.
 */
export type Currency = "trofi" | "bintang" | "koin";

export interface LedgerEntry {
  accountId: string;
  currency: Currency;
  delta: number;
  reason: string;
  /** Kunci idempotensi bersama accountId, currency, reason (mis. id game). Pengiriman ulang diabaikan. */
  ref: string;
  meta?: Record<string, string | number>;
}

export interface LedgerRow extends LedgerEntry {
  id: number;
  ts: number;
  /** Saldo mata uang itu setelah baris ini. */
  balance: number;
}

export interface LedgerLog {
  append(batch: { ts: number; rows: LedgerRow[] }): void;
  readAll(): { ts: number; rows: LedgerRow[] }[];
}

export class MemoryLedgerLog implements LedgerLog {
  private batches: { ts: number; rows: LedgerRow[] }[] = [];
  append(b: { ts: number; rows: LedgerRow[] }): void {
    this.batches.push(JSON.parse(JSON.stringify(b)) as { ts: number; rows: LedgerRow[] });
  }
  readAll(): { ts: number; rows: LedgerRow[] }[] {
    return this.batches.slice();
  }
}

export class FileLedgerLog implements LedgerLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(b: { ts: number; rows: LedgerRow[] }): void {
    appendFileSync(this.file, `${JSON.stringify(b)}\n`, { mode: 0o600 });
  }
  readAll(): { ts: number; rows: LedgerRow[] }[] {
    if (!existsSync(this.file)) return [];
    const out: { ts: number; rows: LedgerRow[] }[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as { ts: number; rows: LedgerRow[] });
      } catch {
        // baris terpotong dilewati
      }
    }
    return out;
  }
}

export type PostResult = { ok: true; rows: LedgerRow[]; duplicate: boolean } | { ok: false; code: "INSUFFICIENT"; message: string };

export class Ledger {
  private readonly balances = new Map<string, number>();
  private readonly seen = new Set<string>();
  private readonly history: LedgerRow[] = [];
  private nextId = 1;

  constructor(
    private readonly log: LedgerLog,
    private readonly now: () => number,
  ) {
    for (const b of log.readAll()) {
      for (const r of b.rows) {
        this.balances.set(this.key(r.accountId, r.currency), r.balance);
        this.seen.add(this.idem(r));
        this.history.push(r);
        this.nextId = Math.max(this.nextId, r.id + 1);
      }
    }
  }

  private key(accountId: string, currency: Currency): string {
    return `${accountId}:${currency}`;
  }
  private idem(e: Pick<LedgerEntry, "accountId" | "currency" | "reason" | "ref">): string {
    return `${e.accountId}:${e.currency}:${e.reason}:${e.ref}`;
  }

  balance(accountId: string, currency: Currency): number {
    return this.balances.get(this.key(accountId, currency)) ?? 0;
  }

  rows(accountId?: string): readonly LedgerRow[] {
    return accountId ? this.history.filter((r) => r.accountId === accountId) : this.history;
  }

  /**
   * Terapkan beberapa baris sekaligus. Bila ada baris yang kunci idempotensinya sudah ada, seluruh panggilan dianggap
   * pengiriman ulang (duplicate) dan tidak mengubah apa pun. Saldo tidak boleh menjadi negatif.
   */
  post(entries: LedgerEntry[]): PostResult {
    if (entries.some((e) => this.seen.has(this.idem(e)))) return { ok: true, rows: [], duplicate: true };
    const draft = new Map<string, number>();
    const rows: LedgerRow[] = [];
    const ts = this.now();
    let id = this.nextId;
    for (const e of entries) {
      if (!Number.isFinite(e.delta) || !Number.isInteger(e.delta)) return { ok: false, code: "INSUFFICIENT", message: "Jumlah tidak valid." };
      const k = this.key(e.accountId, e.currency);
      const bal = (draft.get(k) ?? this.balance(e.accountId, e.currency)) + e.delta;
      if (bal < 0) return { ok: false, code: "INSUFFICIENT", message: "Saldo tidak cukup." };
      draft.set(k, bal);
      rows.push({ ...e, id: id++, ts, balance: bal });
    }
    this.log.append({ ts, rows });
    this.nextId = id;
    for (const r of rows) {
      this.balances.set(this.key(r.accountId, r.currency), r.balance);
      this.seen.add(this.idem(r));
      this.history.push(r);
    }
    return { ok: true, rows, duplicate: false };
  }
}
