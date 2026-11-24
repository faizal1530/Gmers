import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Clock } from "./clock";
import type { Ledger } from "./ledger";

/**
 * Toko SIMULASI. Koin hanya didapat dari klaim harian gratis; tidak ada pembayaran uang nyata, tidak ada jalur
 * Koin atau Rupiah ke Tiket (CLAUDE.md aturan 1). Semua perubahan saldo lewat Ledger.
 */
export type ShopKind = "dadu" | "emoji" | "avatar";
export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  price: number;
  /** Gratis dan dimiliki semua orang. */
  free?: boolean;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "dadu_klasik", kind: "dadu", name: "Dadu Klasik", price: 0, free: true },
  { id: "dadu_kayu_jati", kind: "dadu", name: "Dadu Kayu Jati", price: 80 },
  { id: "dadu_batik_biru", kind: "dadu", name: "Dadu Batik Biru", price: 120 },
  { id: "dadu_neon", kind: "dadu", name: "Dadu Neon", price: 150 },
  { id: "emoji_meja_gaple", kind: "emoji", name: "Emoji Meja Gaple", price: 60 },
  { id: "emoji_drama_ludo", kind: "emoji", name: "Emoji Drama Ludo", price: 80 },
  { id: "avatar_bingkai_emas", kind: "avatar", name: "Bingkai Emas", price: 120 },
  { id: "avatar_bingkai_batik", kind: "avatar", name: "Bingkai Batik", price: 100 },
];

export const DAILY_KOIN = 50;

export type ShopRecord = { t: "equip"; a: string; kind: ShopKind; item: string };
export interface ShopLog {
  append(r: ShopRecord): void;
  readAll(): ShopRecord[];
}
export class MemoryShopLog implements ShopLog {
  readonly records: ShopRecord[] = [];
  append(r: ShopRecord): void {
    this.records.push(r);
  }
  readAll(): ShopRecord[] {
    return this.records.slice();
  }
}
export class FileShopLog implements ShopLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(r: ShopRecord): void {
    appendFileSync(this.file, `${JSON.stringify(r)}\n`, { mode: 0o600 });
  }
  readAll(): ShopRecord[] {
    if (!existsSync(this.file)) return [];
    const out: ShopRecord[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as ShopRecord);
      } catch {
        /* lewati baris rusak */
      }
    }
    return out;
  }
}

export interface ShopState {
  koin: number;
  canClaim: boolean;
  dailyKoin: number;
  items: (ShopItem & { owned: boolean; equipped: boolean })[];
  equipped: Partial<Record<ShopKind, string>>;
  simulation: true;
}
export type ShopError = { ok: false; code: string; message: string };

export class Shop {
  private readonly equipped = new Map<string, Partial<Record<ShopKind, string>>>();

  constructor(
    private readonly ledger: Ledger,
    private readonly log: ShopLog,
    private readonly clock: Clock,
  ) {
    for (const r of log.readAll()) this.applyEquip(r);
  }

  private applyEquip(r: ShopRecord): void {
    const cur = this.equipped.get(r.a) ?? {};
    cur[r.kind] = r.item;
    this.equipped.set(r.a, cur);
  }

  private day(): number {
    return Math.floor((this.clock.now() + 7 * 3_600_000) / 86_400_000);
  }

  private owns(me: string, item: ShopItem): boolean {
    if (item.free) return true;
    return this.ledger.rows(me).some((r) => r.currency === "koin" && r.reason === "shop_buy" && r.ref === item.id);
  }

  private canClaim(me: string): boolean {
    const ref = `d${this.day()}`;
    return !this.ledger.rows(me).some((r) => r.currency === "koin" && r.reason === "daily_sim" && r.ref === ref);
  }

  state(me: string): ShopState {
    const eq = this.equipped.get(me) ?? {};
    return {
      koin: this.ledger.balance(me, "koin"),
      canClaim: this.canClaim(me),
      dailyKoin: DAILY_KOIN,
      equipped: { dadu: eq.dadu ?? "dadu_klasik", ...(eq.emoji ? { emoji: eq.emoji } : {}), ...(eq.avatar ? { avatar: eq.avatar } : {}) },
      items: SHOP_ITEMS.map((i) => ({ ...i, owned: this.owns(me, i), equipped: (eq[i.kind] ?? (i.kind === "dadu" ? "dadu_klasik" : undefined)) === i.id })),
      simulation: true,
    };
  }

  /** Klaim Koin simulasi harian (sekali per hari WIB). */
  claim(me: string): { ok: true } | ShopError {
    const r = this.ledger.post([{ accountId: me, currency: "koin", delta: DAILY_KOIN, reason: "daily_sim", ref: `d${this.day()}` }]);
    if (!r.ok) return { ok: false, code: "FAILED", message: r.message };
    if (r.duplicate) return { ok: false, code: "ALREADY_CLAIMED", message: "Koin simulasi hari ini sudah diklaim. Kembali besok." };
    return { ok: true };
  }

  buy(me: string, itemId: string): { ok: true } | ShopError {
    const item = SHOP_ITEMS.find((i) => i.id === itemId);
    if (!item) return { ok: false, code: "NOT_FOUND", message: "Barang tidak ditemukan." };
    if (item.free || this.owns(me, item)) return { ok: false, code: "OWNED", message: "Kamu sudah memiliki barang ini." };
    const r = this.ledger.post([{ accountId: me, currency: "koin", delta: -item.price, reason: "shop_buy", ref: item.id }]);
    if (!r.ok) return { ok: false, code: "INSUFFICIENT", message: "Koin tidak cukup." };
    if (r.duplicate) return { ok: false, code: "OWNED", message: "Kamu sudah memiliki barang ini." };
    return { ok: true };
  }

  equip(me: string, itemId: string): { ok: true } | ShopError {
    const item = SHOP_ITEMS.find((i) => i.id === itemId);
    if (!item) return { ok: false, code: "NOT_FOUND", message: "Barang tidak ditemukan." };
    if (!this.owns(me, item)) return { ok: false, code: "NOT_OWNED", message: "Beli dulu barang ini." };
    const rec: ShopRecord = { t: "equip", a: me, kind: item.kind, item: item.id };
    this.log.append(rec);
    this.applyEquip(rec);
    return { ok: true };
  }
}
