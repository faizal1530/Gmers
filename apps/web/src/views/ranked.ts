import { id } from "../i18n/id";
import { h } from "../dom";
import type { LeaderRow, WalletInfo } from "../api";
import { avatar } from "./avatar";

const KELAS = ["Pemula", "Jago", "Pro", "Master", "Raja"];

/** Lencana kelas (Pemula sampai Raja); warna mengikuti tingkat. */
export function kelasBadge(name: string): HTMLElement {
  const idx = Math.max(0, KELAS.indexOf(name));
  return h("span", { class: `kls k${idx}`, "data-kelas": name }, name);
}

export interface QueueState {
  state: "waiting" | "idle";
  game: "gaple" | "ludo" | null;
  since: number | null;
}

export interface RankedCardOptions {
  loggedIn: boolean;
  queue: QueueState;
  /** Detik menunggu sampai sekarang. */
  waited: number;
  onFind: (game: "gaple" | "ludo") => void;
  onCancel: () => void;
  onToProfile: () => void;
}

/** Kartu "Ranked lawan acak" di tab Games: pilih game, cari lawan, lihat status antrean. */
export function rankedCard(o: RankedCardOptions): HTMLElement {
  const r = id.ranked;
  const waiting = o.queue.state === "waiting";
  return h(
    "article",
    { class: "game-card ranked-card", "data-testid": "ranked-card" },
    h("div", { class: "game-body" }, h("h2", {}, r.title), h("p", { class: "hint" }, r.intro)),
    !o.loggedIn
      ? h("div", { class: "stack pad" }, h("p", { class: "hint", role: "status" }, r.need), h("button", { class: "btn primary", type: "button", onclick: o.onToProfile }, r.toProfile))
      : waiting
        ? h(
            "div",
            { class: "stack pad", role: "status", "aria-live": "polite" },
            h("p", { class: "queue-line", "data-testid": "queue-waiting" }, `${r.searching} ${id.gamePick[o.queue.game ?? "gaple"]} · ${r.waited(o.waited)}`),
            h("button", { class: "btn", type: "button", "data-testid": "queue-cancel", onclick: o.onCancel }, r.cancel),
          )
        : h(
            "div",
            { class: "row pad" },
            h("button", { class: "btn primary", type: "button", "data-testid": "find-gaple", onclick: () => o.onFind("gaple") }, `${r.find} ${id.gamePick.gaple}`),
            h("button", { class: "btn primary", type: "button", "data-testid": "find-ludo", onclick: () => o.onFind("ludo") }, `${r.find} ${id.gamePick.ludo}`),
          ),
  );
}

/** Dompet: kelas, Trofi dengan kemajuan ke kelas berikutnya, dan Bintang. */
export function walletPanel(w: WalletInfo | null, loggedIn: boolean): HTMLElement {
  const r = id.ranked;
  if (!loggedIn || !w) return h("div", { class: "panel", "data-testid": "wallet" }, h("h2", {}, r.wallet), h("p", { class: "hint" }, r.guestNote));
  const pct = w.next ? Math.min(100, Math.round(((w.trofi - (w.kelasIndex === 0 ? 0 : (CLASS_MIN[w.kelasIndex] ?? 0))) / Math.max(1, w.next.min - (CLASS_MIN[w.kelasIndex] ?? 0))) * 100)) : 100;
  return h(
    "div",
    { class: "panel", "data-testid": "wallet" },
    h("h2", {}, r.wallet),
    h("div", { class: "wallet-row" }, kelasBadge(w.kelas), h("span", { class: "wallet-n", "data-testid": "wallet-trofi" }, `${w.trofi} ${r.trofi}`), h("span", { class: "wallet-n", "data-testid": "wallet-bintang" }, `${w.bintang} ${r.bintang}`)),
    h("div", { class: "progressbar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }, h("i", { id: "kelasfill", "data-pct": pct })),
    h("p", { class: "hint" }, w.next ? r.toNext(w.next.min - w.trofi, w.next.name) : r.topClass),
  );
}

const CLASS_MIN = [0, 100, 300, 600, 1000];

export function leaderboardView(rows: LeaderRow[] | null, you: { rank: number | null } | null): HTMLElement {
  const r = id.ranked;
  return h(
    "div",
    { class: "panel", "data-testid": "leaderboard" },
    h("h2", {}, r.boardTitle),
    rows === null
      ? h("p", { class: "hint" }, r.boardLoading)
      : rows.length === 0
        ? h("p", { class: "hint" }, r.boardEmpty)
        : h(
            "ol",
            { class: "board-rows" },
            rows.map((x) => h("li", { class: `brow${x.isYou ? " you" : ""}`, "data-rank": x.rank }, h("span", { class: "rank-n" }, x.rank), avatar(x.name, x.rank, "sm"), h("span", { class: "grow" }, x.name, x.isYou ? ` (${id.lobby.you})` : ""), kelasBadge(x.kelas), h("b", {}, x.trofi))),
          ),
    you ? h("p", { class: "hint" }, r.boardYou(you.rank)) : null,
  );
}
