import type { KV } from "./storage";

export type ThemeMode = "auto" | "light" | "dark";
const KEY = "gmers.theme";

export function readTheme(kv: KV): ThemeMode {
  const v = kv.get(KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

/** "auto" mengikuti pengaturan perangkat; terang/gelap memaksa lewat atribut data-theme. */
export function applyTheme(mode: ThemeMode, kv?: KV): void {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  kv?.set(KEY, mode);
}
