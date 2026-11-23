import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("semua teks pengguna ada di src/i18n/id.ts", () => {
  it("tidak ada literal kalimat (huruf besar di awal, mengandung spasi) di luar berkas i18n", () => {
    const src = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const f of files(src)) {
      if (f.endsWith(join("i18n", "id.ts"))) continue;
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
        const lit = m[2] as string;
        if (/^[A-Z][a-z]+(\s+\S+)+/.test(lit) && !/^(Bearer|GET|HEAD)\b/.test(lit)) offenders.push(`${f.split("/src/")[1]}: ${lit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
