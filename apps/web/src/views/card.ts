import { id } from "../i18n/id";
import { h } from "../dom";

/** Posisi titik pada kisi 3x3 (baris demi baris) untuk tiap angka. */
const PIPS: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function half(n: number): HTMLElement {
  const on = new Set(PIPS[n] ?? []);
  return h(
    "span",
    { class: "half", "aria-hidden": "true" },
    Array.from({ length: 9 }, (_, i) => h("i", { class: on.has(i) ? "pip on" : "pip" })),
  );
}

/** Kartu domino. `orient` v = atas-bawah (kartu di tangan), h = kiri-kanan (di meja). */
export function domino(a: number, b: number, orient: "v" | "h"): HTMLElement {
  return h("span", { class: `domino ${orient}${a === b ? " double" : ""}`, role: "img", "aria-label": id.table.cardLabel(a, b) }, half(a), h("span", { class: "bar", "aria-hidden": "true" }), half(b));
}
