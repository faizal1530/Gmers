/* Menghitung metrik "kelompok aktif" dari CSV peristiwa.
 * Pakai: pnpm hitung <events.csv> [--out hasil.csv] [--window 14] [--min-players 3] [--replay-days 7] */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_OPTIONS, computeReport, formatTable, parseEvents, resultsToCsv, type Options } from "./lib/metrics";

function usage(): never {
  process.stderr.write("Pemakaian: pnpm hitung <events.csv> [--out hasil.csv] [--window 14] [--min-players 3] [--replay-days 7]\n");
  process.exit(2);
}

const args = process.argv.slice(2);
const flagsWithValue = new Set(["--out", "--window", "--min-players", "--replay-days"]);
let file: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (flagsWithValue.has(a)) i++;
  else if (!a.startsWith("--") && !file) file = a;
}
if (!file || args.includes("--help")) usage();

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function num(name: string, fallback: number): number {
  const v = flag(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`Nilai --${name} harus bilangan bulat positif.\n`);
    process.exit(2);
  }
  return n;
}

const options: Options = {
  windowDays: num("window", DEFAULT_OPTIONS.windowDays),
  minPlayers: num("min-players", DEFAULT_OPTIONS.minPlayers),
  replayDays: num("replay-days", DEFAULT_OPTIONS.replayDays),
};

try {
  const report = computeReport(parseEvents(readFileSync(file, "utf8")), options);
  process.stdout.write(`${formatTable(report)}\n`);
  const out = flag("out");
  if (out) {
    writeFileSync(out, resultsToCsv(report));
    process.stdout.write(`\nHasil per kelompok ditulis ke ${out}\n`);
  }
} catch (e) {
  process.stderr.write(`Gagal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
