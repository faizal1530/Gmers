import { h } from "../dom";

/** Avatar bulat dari huruf pertama nama; warna mengikuti kursi (kelas c0..c5, bukan gaya inline karena CSP). */
export function avatar(name: string, seat: number, size: "sm" | "md" | "lg" = "md"): HTMLElement {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return h("span", { class: `av c${Math.abs(seat) % 6} ${size}`, "aria-hidden": "true" }, initial);
}
