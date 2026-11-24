import type { StateMessage, LudoView } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { isMyTurn } from "../logic";
import { playersStrip, turnBar } from "./table";

const NS = "http://www.w3.org/2000/svg";
const U = 10;

/** Jalur 52 petak searah jarum jam, mulai dari petak awal kursi merah (baris, kolom) pada kisi 15x15. */
const TRACK: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];
const HOME_COL: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];
const CENTER: [number, number][] = [[7, 6], [6, 7], [7, 8], [8, 7]];
const YARD: [number, number][] = [[0, 0], [0, 9], [9, 9], [9, 0]];
const YARD_SLOT: [number, number][] = [[1, 1], [1, 4], [4, 1], [4, 4]];
const SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]);

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of kids) e.appendChild(k);
  return e;
}

const cellRect = (r: number, c: number, cls: string): SVGElement => el("rect", { x: c * U, y: r * U, width: U, height: U, class: cls });

/** Posisi (pusat, dalam satuan SVG) sebuah bidak. */
export function pawnPoint(slot: number, start: number, progress: number, pawn: number): [number, number] {
  let r: number;
  let c: number;
  if (progress < 0) {
    const base = YARD[slot] as [number, number];
    const off = YARD_SLOT[pawn] as [number, number];
    r = base[0] + off[0];
    c = base[1] + off[1];
  } else if (progress <= 50) {
    [r, c] = TRACK[(start + progress) % 52] as [number, number];
  } else if (progress < 56) {
    [r, c] = (HOME_COL[slot] as [number, number][])[progress - 51] as [number, number];
  } else {
    [r, c] = CENTER[slot] as [number, number];
  }
  return [(c + 0.5) * U, (r + 0.5) * U];
}

export interface LudoActions {
  onRoll: () => void;
  onPick: (pawn: number) => void;
  onNudge: () => void;
  nudgeCooling: boolean;
  connected: boolean;
  /** Teks langkah terakhir untuk dibacakan dan ditampilkan. */
  lastMoveText: string | null;
  /** Skin dadu terpilih (kelas CSS). */
  diceSkin: string;
}

function dieFace(value: number | null, skin: string): HTMLElement {
  const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const on = new Set(value ? (PIPS[value] ?? []) : []);
  return h(
    "span",
    { class: `die ${skin}`, role: "img", "aria-label": id.ludo.diceLabel(value), "data-value": value ?? "" },
    Array.from({ length: 9 }, (_, i) => h("i", { class: on.has(i) ? "pip on" : "pip" })),
  );
}

/** Papan SVG: kandang, jalur 52 petak, petak aman, lorong rumah, dan bidak (yang bisa jalan dapat diketuk). */
export function ludoBoard(ludo: LudoView, movable: Set<number>, mySeat: number, onPick: (pawn: number) => void, turnSeat: number): SVGElement {
  const svg = el("svg", { viewBox: `0 0 ${15 * U} ${15 * U}`, class: "ludo-board", role: "group", "aria-label": id.ludo.boardLabel, "data-testid": "ludo-board" });
  const slotOf = (start: number): number => Math.round(start / 13) % 4;
  svg.appendChild(el("rect", { x: 0, y: 0, width: 15 * U, height: 15 * U, rx: 3, class: "lb-bg" }));
  // kandang
  for (let slot = 0; slot < 4; slot++) {
    const [r, c] = YARD[slot] as [number, number];
    svg.appendChild(el("rect", { x: c * U + 2, y: r * U + 2, width: 6 * U - 4, height: 6 * U - 4, rx: 4, class: `yard c${slot}` }));
    for (const [or, oc] of YARD_SLOT) svg.appendChild(el("circle", { cx: (c + oc + 0.5) * U, cy: (r + or + 0.5) * U, r: 3.6, class: "yard-slot" }));
  }
  // jalur
  TRACK.forEach(([r, c], i) => {
    const startOf = [0, 13, 26, 39].indexOf(i);
    svg.appendChild(cellRect(r, c, `tc${SAFE.has(i) ? " safe" : ""}${startOf >= 0 ? ` start c${startOf}` : ""}`));
    if (SAFE.has(i) && startOf < 0) svg.appendChild(el("path", { d: starPath((c + 0.5) * U, (r + 0.5) * U, 3.4), class: "star" }));
  });
  HOME_COL.forEach((cells, slot) => cells.forEach(([r, c]) => svg.appendChild(cellRect(r, c, `hc c${slot}`))));
  // pusat: empat segitiga
  const m = 7.5 * U;
  const tri = (pts: string, slot: number): SVGElement => el("polygon", { points: pts, class: `center c${slot}` });
  svg.appendChild(tri(`${6 * U},${6 * U} ${m},${m} ${6 * U},${9 * U}`, 0));
  svg.appendChild(tri(`${6 * U},${6 * U} ${m},${m} ${9 * U},${6 * U}`, 1));
  svg.appendChild(tri(`${9 * U},${6 * U} ${m},${m} ${9 * U},${9 * U}`, 2));
  svg.appendChild(tri(`${6 * U},${9 * U} ${m},${m} ${9 * U},${9 * U}`, 3));

  // bidak; yang berbagi titik digeser sedikit agar semuanya terlihat
  const placed = new Map<string, number>();
  const items: { seat: number; slot: number; pawn: number; p: number; pt: [number, number] }[] = [];
  for (const pl of ludo.players) {
    const slot = slotOf(pl.start);
    pl.pawns.forEach((p, pawn) => items.push({ seat: pl.seat, slot, pawn, p, pt: pawnPoint(slot, pl.start, p, pawn) }));
  }
  for (const it of items) {
    const key = `${it.pt[0]},${it.pt[1]}`;
    const n = placed.get(key) ?? 0;
    placed.set(key, n + 1);
    const total = items.filter((o) => `${o.pt[0]},${o.pt[1]}` === key).length;
    const dx = total > 1 ? (n - (total - 1) / 2) * 3.2 : 0;
    const mine = it.seat === mySeat;
    const can = mine && movable.has(it.pawn) && turnSeat === mySeat;
    const label = `${id.ludo.pawn(it.pawn + 1)} ${it.p < 0 ? id.ludo.pawnInYard : it.p === 56 ? id.ludo.pawnHome : id.ludo.pawnOnTrack(it.p)}`;
    const g = el("g", {
      class: `pawn c${it.slot}${can ? " ok" : ""}${mine ? " mine" : ""}`,
      transform: `translate(${it.pt[0] + dx} ${it.pt[1]})`,
      "data-seat": it.seat,
      "data-pawn": it.pawn,
      "data-progress": it.p,
      role: can ? "button" : "img",
      "aria-label": label,
      ...(can ? { tabindex: 0 } : {}),
    });
    g.appendChild(el("circle", { r: 7, class: "hit" }));
    g.appendChild(el("circle", { r: 3.8, class: "body" }));
    const t = el("text", { y: 1.3, "text-anchor": "middle", class: "num" });
    t.textContent = String(it.pawn + 1);
    g.appendChild(t);
    if (can) {
      g.addEventListener("click", () => onPick(it.pawn));
      g.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter" || (ev as KeyboardEvent).key === " ") {
          ev.preventDefault();
          onPick(it.pawn);
        }
      });
    }
    svg.appendChild(g);
  }
  return svg;
}

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${i === 0 ? "M" : "L"}${(cx + Math.cos(ang) * rad).toFixed(2)} ${(cy + Math.sin(ang) * rad).toFixed(2)}`);
  }
  return `${pts.join(" ")} Z`;
}

export function ludoView(s: StateMessage, a: LudoActions): HTMLElement {
  const game = s.game;
  const ludo = game?.ludo;
  if (!game || !ludo) return h("div");
  const mine = isMyTurn(s);
  const moves = mine && a.connected ? game.yourMoves : [];
  const canRoll = moves.some((m) => m.type === "roll");
  const movable = new Set(moves.flatMap((m) => (m.type === "pick" ? [m.pawn] : [])));
  const turnName = s.room.seats[game.turn]?.name ?? "";
  const myProgress = ludo.players.find((p) => p.seat === s.you.seat)?.pawns ?? [];

  let hint: string;
  if (!mine) hint = ludo.dice === null ? id.ludo.waitRoll(turnName) : id.ludo.waitPick(turnName);
  else if (canRoll) hint = id.ludo.yourRoll;
  else hint = id.ludo.pickPawn;

  const pickList = h(
    "ul",
    { class: "pawn-picks", "aria-label": id.ludo.pickPawn },
    [...movable].sort().map((pawn) =>
      h(
        "li",
        {},
        h("button", { type: "button", class: "btn small pawn-pick", "data-pawn-pick": pawn, onclick: () => a.onPick(pawn) }, `${id.ludo.pawn(pawn + 1)} · ${(myProgress[pawn] ?? -1) < 0 ? id.ludo.pawnInYard : id.ludo.pawnOnTrack(myProgress[pawn] as number)}`),
      ),
    ),
  );

  return h(
    "section",
    { class: "table-screen ludo-screen" },
    playersStrip(s, id.ludo.pawnsLeft),
    turnBar(s, a),
    ludoBoard(ludo, movable, s.you.seat, a.onPick, game.turn),
    h(
      "div",
      { class: "dice-row" },
      dieFace(ludo.lastRoll?.value ?? null, a.diceSkin),
      h("button", { type: "button", class: "btn primary big roll", id: "roll-btn", "data-testid": "roll", disabled: !canRoll, onclick: a.onRoll }, id.ludo.roll),
    ),
    h("p", { class: "hint center", role: "status", "data-testid": "ludo-hint" }, hint),
    movable.size > 0 ? pickList : null,
    h("p", { class: "lastmove", role: "status", "aria-live": "polite", "data-testid": "lastmove" }, a.lastMoveText ?? id.table.noLastMove),
  );
}
