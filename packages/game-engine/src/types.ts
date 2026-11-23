/** Nomor kursi, 0..players-1. Arah "searah jarum jam" = indeks naik. */
export type Seat = number;

/** Kartu kanonik [kecil, besar], mis. [2, 5] atau [6, 6]. Di meja, kartu berorientasi [sisiKiri, sisiKanan]. */
export type Card = [number, number];

export type EndSide = "left" | "right";

export interface GapleConfig {
  /** Jumlah pemain. [SPEK] 2 sampai 4. */
  players: 2 | 3 | 4;
  /** Kartu per pemain. [SPEK] 7; alternatif 6. */
  handSize: 6 | 7;
  /** Siapa membuka bila `openerSeat` null. 'sixSix' = pemegang 6|6, 'zeroZero' = pemegang 0|0, 'random' = kursi acak dari RNG, kartu bebas. */
  opening: "sixSix" | "zeroZero" | "random";
  /** Kursi pembuka dengan kartu bebas (mis. pemenang game sebelumnya saat rematch). Menimpa `opening`. */
  openerSeat: Seat | null;
  turnDirection: "clockwise" | "counterclockwise";
  /** Benar: tidak boleh lewat bila ada kartu cocok. */
  mustPlayIfAble: boolean;
  /** 0: 0|0 dihitung 0 titik. 25: 0|0 dihitung 25 bila tidak ada kartu kosong lain di tangan. */
  zeroZeroPenalty: 0 | 25;
  // Parameter di bawah baru punya satu nilai yang didukung (varian lain belum dibangun).
  passRule: "pass";
  spinner: "none";
  blockedWinner: "lowestPips";
  tieBreak: "lowestSingleThenEndThenSeat";
  roundsPerGame: 1;
  targetScore: null;
  teams: false;
}

export type Move =
  | { type: "play"; seat: Seat; card: Card; end: EndSide }
  | { type: "pass"; seat: Seat };

export interface RankEntry {
  seat: Seat;
  /** 1..n, selalu unik. */
  rank: number;
  /** Titik sisa (sudah memakai `zeroZeroPenalty`). */
  points: number;
  cardsLeft: number;
}

export interface GameResult {
  reason: "out" | "blocked";
  winner: Seat;
  /** Urut dari peringkat 1 sampai n. */
  ranking: RankEntry[];
}

/** State serializable JSON. Perlakukan sebagai tidak berubah; `apply` selalu mengembalikan objek baru. */
export interface GapleState {
  version: 1;
  config: GapleConfig;
  seed: string | number;
  /** Tangan per kursi, kartu kanonik, terurut. */
  hands: Card[][];
  /** Kartu yang tidak dibagikan (2 atau 3 pemain), tertutup dan tidak dipakai. */
  discarded: Card[];
  /** Rantai di meja dari kiri ke kanan, tiap kartu berorientasi [kiri, kanan]. */
  board: Card[];
  turn: Seat;
  /** Kursi yang jalan pertama (dasar urutan duduk untuk pemecah seri). */
  opener: Seat;
  /** Kartu yang wajib dimainkan pertama; null = bebas. */
  requiredOpening: Card | null;
  consecutivePasses: number;
  /** Log langkah (hanya-tambah) untuk replay. */
  log: Move[];
  result: GameResult | null;
}

export interface EngineError {
  code:
    | "GAME_OVER"
    | "NOT_YOUR_TURN"
    | "BAD_SEAT"
    | "CARD_NOT_IN_HAND"
    | "MUST_OPEN_WITH_REQUIRED"
    | "CARD_DOES_NOT_FIT"
    | "BAD_END"
    | "MUST_PLAY"
    | "CANNOT_PASS_ON_OPENING";
  /** Bahasa Indonesia, aman ditampilkan ke pengguna. */
  message: string;
}

export interface GameStatus {
  over: boolean;
  reason: "out" | "blocked" | null;
  winner: Seat | null;
  /** Null selama game berjalan; setelah selesai selalu n entri dengan rank 1..n. */
  ranking: RankEntry[] | null;
}

export type Rng = () => number;
