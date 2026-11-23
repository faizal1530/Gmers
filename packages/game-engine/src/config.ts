import type { GapleConfig } from "./types";

/** Default usulan dari docs/05-aturan-gaple-draf.md bagian 2. Belum dikunci. */
export const DEFAULT_CONFIG: GapleConfig = {
  players: 4,
  handSize: 7,
  opening: "sixSix",
  openerSeat: null,
  turnDirection: "clockwise",
  mustPlayIfAble: true,
  zeroZeroPenalty: 0,
  passRule: "pass",
  spinner: "none",
  blockedWinner: "lowestPips",
  tieBreak: "lowestSingleThenEndThenSeat",
  roundsPerGame: 1,
  targetScore: null,
  teams: false,
};

export function createConfig(overrides: Partial<GapleConfig> = {}): GapleConfig {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const errors = validateConfig(config);
  if (errors.length > 0) throw new RangeError(`Konfigurasi Gaple tidak valid: ${errors.join("; ")}`);
  return config;
}

/** Daftar masalah (kosong = valid). Nilai varian yang belum dibangun ditolak, bukan diabaikan diam-diam. */
export function validateConfig(config: GapleConfig): string[] {
  const errors: string[] = [];
  if (![2, 3, 4].includes(config.players)) errors.push("players harus 2, 3, atau 4");
  if (![6, 7].includes(config.handSize)) errors.push("handSize harus 6 atau 7");
  if (!["sixSix", "zeroZero", "random"].includes(config.opening)) errors.push("opening tidak dikenal");
  if (config.openerSeat !== null && !(Number.isInteger(config.openerSeat) && config.openerSeat >= 0 && config.openerSeat < config.players)) {
    errors.push("openerSeat di luar rentang kursi");
  }
  if (!["clockwise", "counterclockwise"].includes(config.turnDirection)) errors.push("turnDirection tidak dikenal");
  if (typeof config.mustPlayIfAble !== "boolean") errors.push("mustPlayIfAble harus boolean");
  if (![0, 25].includes(config.zeroZeroPenalty)) errors.push("zeroZeroPenalty harus 0 atau 25");
  if (config.passRule !== "pass") errors.push("passRule selain 'pass' (kartu mati) belum dibangun");
  if (config.spinner !== "none") errors.push("spinner belum dibangun");
  if (config.blockedWinner !== "lowestPips") errors.push("blockedWinner selain 'lowestPips' belum dibangun");
  if (config.tieBreak !== "lowestSingleThenEndThenSeat") errors.push("tieBreak lain belum dibangun");
  if (config.roundsPerGame !== 1) errors.push("roundsPerGame selain 1 belum dibangun");
  if (config.targetScore !== null) errors.push("targetScore belum dibangun");
  if (config.teams !== false) errors.push("teams (2 lawan 2) belum dibangun");
  return errors;
}
