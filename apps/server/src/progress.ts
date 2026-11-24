import { classIndex, className, wibDay, type EconomyConfig } from "./economy";
import type { Ledger, LedgerEntry, LedgerRow } from "./ledger";

export interface SettlePlayer {
  /** Akun pemain; null untuk tamu (tidak mendapat Trofi atau Bintang). */
  accountId: string | null;
  /** Peringkat 1..n dari hasil game. */
  rank: number;
  /** Meninggalkan game (giliran dimainkan otomatis berturut-turut): dihitung peringkat terakhir. */
  abandoned: boolean;
}

export interface SettleInput {
  /** Kunci idempotensi, mis. `${roomId}:${gameNo}`. */
  ref: string;
  ts: number;
  ranked: boolean;
  players: SettlePlayer[];
}

export interface Reward {
  accountId: string;
  trofi: number;
  bintang: number;
  /** Total Trofi setelah game. */
  trofiTotal: number;
  kelas: string;
  /** Nama kelas baru bila naik kelas pada game ini. */
  kelasUp: string | null;
}

export interface Wallet {
  trofi: number;
  bintang: number;
  koin: number;
  kelas: string;
  kelasIndex: number;
  /** Kelas berikutnya dan Trofi yang dibutuhkan; null bila sudah kelas tertinggi. */
  next: { name: string; min: number } | null;
}

/** Trofi, Bintang, dan kelas. Semua perubahan saldo lewat Ledger; perhitungan dilakukan di server. */
export class Progress {
  private readonly peak = new Map<string, number>();
  private readonly rankedDays = new Map<string, Set<number>>();
  private readonly pairCount = new Map<string, number>();
  private readonly bintangToday = new Map<string, number>();

  constructor(
    private readonly ledger: Ledger,
    private readonly econ: EconomyConfig,
  ) {
    for (const r of ledger.rows()) this.track(r);
  }

  /** Perbarui catatan turunan (kelas tertinggi yang pernah dicapai, hari Ranked, pasangan, Bintang harian) dari satu baris buku besar. */
  private track(r: LedgerRow): void {
    const { accountId, currency, meta } = r;
    if (currency === "trofi") {
      this.peak.set(accountId, Math.max(this.peak.get(accountId) ?? 0, classIndex(this.econ, r.balance)));
      if (r.reason === "ranked" && meta && typeof meta.day === "number") {
        const days = this.rankedDays.get(accountId) ?? new Set<number>();
        days.add(meta.day);
        this.rankedDays.set(accountId, days);
        if (typeof meta.pair === "string") {
          const k = `${meta.day}|${meta.pair}`;
          // Satu game menulis satu baris per anggota; bagi dengan ukuran kelompok agar dihitung sekali.
          this.pairCount.set(k, (this.pairCount.get(k) ?? 0) + 1 / meta.pair.split(",").length);
        }
      }
    } else if (currency === "bintang" && r.reason === "game" && meta && typeof meta.day === "number") {
      const k = `${accountId}|${meta.day}`;
      this.bintangToday.set(k, (this.bintangToday.get(k) ?? 0) + r.delta);
    }
  }

  wallet(accountId: string): Wallet {
    const trofi = this.ledger.balance(accountId, "trofi");
    const idx = classIndex(this.econ, trofi);
    const next = this.econ.classes[idx + 1];
    return {
      trofi,
      bintang: this.ledger.balance(accountId, "bintang"),
      koin: this.ledger.balance(accountId, "koin"),
      kelas: className(this.econ, trofi),
      kelasIndex: idx,
      next: next ? { name: next.name, min: next.min } : null,
    };
  }

  /** Hitung dan catat hasil sebuah game. Idempotens per `ref`; mengembalikan daftar hadiah (kosong bila sudah pernah dicatat). */
  settle(input: SettleInput): Reward[] {
    const day = wibDay(input.ts);
    const reg = input.players.filter((p): p is SettlePlayer & { accountId: string } => p.accountId !== null);
    if (reg.length === 0) return [];
    const entries: LedgerEntry[] = [];
    const before = new Map(reg.map((p) => [p.accountId, classIndex(this.econ, this.ledger.balance(p.accountId, "trofi"))]));
    const bintangGain = new Map<string, number>();
    const trofiGain = new Map<string, number>();

    for (const p of reg) {
      const used = this.bintangToday.get(`${p.accountId}|${day}`) ?? 0;
      const gain = Math.max(0, Math.min(this.econ.bintangPerGame, this.econ.bintangDailyCap - used));
      bintangGain.set(p.accountId, gain);
      if (gain > 0) entries.push({ accountId: p.accountId, currency: "bintang", delta: gain, reason: "game", ref: input.ref, meta: { day } });
    }

    const n = input.players.length;
    const table = this.econ.trophy[n];
    if (input.ranked && table && reg.length === n && n >= 2) {
      const ids = reg.map((p) => p.accountId).sort();
      const pair = ids.join(",");
      const pairKey = `${day}|${pair}`;
      if ((this.pairCount.get(pairKey) ?? 0) < this.econ.pairDailyCap) {
        // Yang meninggalkan game dihitung peringkat terakhir; urutan lainnya dipertahankan.
        const ordered = [...reg].sort((a, b) => Number(a.abandoned) - Number(b.abandoned) || a.rank - b.rank);
        ordered.forEach((p, i) => {
          const trofi = this.ledger.balance(p.accountId, "trofi");
          const floor = (this.econ.classes[this.peak.get(p.accountId) ?? 0] as { min: number }).min;
          const bonus = this.rankedDays.get(p.accountId)?.has(day) ? 0 : this.econ.firstRankedBonus;
          const raw = (table[i] as number) + bonus;
          const applied = raw < 0 ? Math.max(raw, floor - trofi) : raw;
          trofiGain.set(p.accountId, applied);
          entries.push({ accountId: p.accountId, currency: "trofi", delta: applied, reason: "ranked", ref: input.ref, meta: { day, pair } });
        });
      }
    }

    if (entries.length === 0) return [];
    const res = this.ledger.post(entries);
    if (!res.ok || res.duplicate) return [];
    for (const r of res.rows) this.track(r);
    return reg.map((p) => {
      const trofiTotal = this.ledger.balance(p.accountId, "trofi");
      const now = classIndex(this.econ, trofiTotal);
      return {
        accountId: p.accountId,
        trofi: trofiGain.get(p.accountId) ?? 0,
        bintang: bintangGain.get(p.accountId) ?? 0,
        trofiTotal,
        kelas: className(this.econ, trofiTotal),
        kelasUp: now > (before.get(p.accountId) ?? 0) ? className(this.econ, trofiTotal) : null,
      };
    });
  }

  /** Papan peringkat: akun dengan Trofi terbanyak. */
  leaderboard(limit: number): { accountId: string; trofi: number }[] {
    const seen = new Set<string>();
    const out: { accountId: string; trofi: number }[] = [];
    for (const r of this.ledger.rows()) {
      if (r.currency !== "trofi" || seen.has(r.accountId)) continue;
      seen.add(r.accountId);
      out.push({ accountId: r.accountId, trofi: this.ledger.balance(r.accountId, "trofi") });
    }
    return out.sort((a, b) => b.trofi - a.trofi).slice(0, limit);
  }
}
