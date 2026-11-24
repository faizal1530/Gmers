/** Angka ekonomi dari spesifikasi bagian 4 dan 7.5. Semuanya konfigurasi server, bukan konstanta di klien. */
export interface EconomyConfig {
  /** Perubahan Trofi menurut jumlah pemain dan peringkat (indeks 0 = peringkat 1). */
  trophy: Record<number, number[]>;
  /** Kelas menurut Trofi minimum, urut naik. */
  classes: { name: string; min: number }[];
  /** Bonus game Ranked pertama hari itu (hari kalender WIB), selalu ditambahkan. */
  firstRankedBonus: number;
  bintangPerGame: number;
  bintangDailyCap: number;
  /** Maksimal game Ranked per hari antara kelompok akun yang sama yang mengubah Trofi (anti win-trading sederhana). */
  pairDailyCap: number;
  /** Pemain yang gilirannya dimainkan otomatis sebanyak ini berturut-turut dianggap meninggalkan game (peringkat terakhir). */
  abandonAfterAuto: number;
  /** Berapa lama antrean menunggu sebelum memulai game dengan pemain yang ada (minimal 2). */
  queueWaitMs: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  // 4 pemain dan 2 pemain dari spesifikasi. 3 pemain tidak ada di spesifikasi: diturunkan (jumlah total sama dengan 4 pemain).
  trophy: { 2: [10, -5], 3: [10, 2, -5], 4: [10, 4, -2, -5] },
  classes: [
    { name: "Pemula", min: 0 },
    { name: "Jago", min: 100 },
    { name: "Pro", min: 300 },
    { name: "Master", min: 600 },
    { name: "Raja", min: 1000 },
  ],
  firstRankedBonus: 2,
  bintangPerGame: 5,
  bintangDailyCap: 50,
  pairDailyCap: 6,
  abandonAfterAuto: 3,
  queueWaitMs: 15_000,
};

export function classIndex(econ: EconomyConfig, trofi: number): number {
  let idx = 0;
  econ.classes.forEach((c, i) => {
    if (trofi >= c.min) idx = i;
  });
  return idx;
}

export function className(econ: EconomyConfig, trofi: number): string {
  return (econ.classes[classIndex(econ, trofi)] as { name: string }).name;
}

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3_600_000;
/** Nomor hari kalender WIB. */
export const wibDay = (ts: number): number => Math.floor((ts + WIB_MS) / DAY_MS);
