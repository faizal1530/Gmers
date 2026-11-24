import { id } from "../i18n/id";
import { h } from "../dom";
import { nameForm } from "./forms";
import { domino } from "./card";

export interface GamesOptions {
  initialName: string;
  busy: boolean;
  roomCode: string | null;
  onCreate: (name: string, game: "gaple" | "ludo") => void;
  onBackToRoom: () => void;
  /** Konten tambahan di bawah kartu game (Ranked dan papan peringkat). */
  extra?: HTMLElement[];
}

export function gamesView(o: GamesOptions): HTMLElement {
  const g = id.games;
  return h(
    "section",
    { class: "stack" },
    h("h1", {}, g.title),
    h(
      "article",
      { class: "game-card gaple" },
      h("div", { class: "cover", "aria-hidden": "true" }, domino(6, 6, "h"), domino(6, 4, "h"), domino(4, 1, "h")),
      h("div", { class: "game-body" }, h("h2", {}, g.gaple.name), h("p", { class: "hint" }, g.gaple.tagline)),
      o.roomCode
        ? h("div", { class: "stack" }, h("p", { class: "hint" }, g.inRoom(o.roomCode)), h("button", { class: "btn primary big", type: "button", "data-testid": "back-to-room", onclick: o.onBackToRoom }, g.backToRoom))
        : nameForm({
            initial: o.initialName,
            submitLabel: o.busy ? id.home.creating : g.createGaple,
            busy: o.busy,
            onSubmit: (n) => o.onCreate(n, "gaple"),
            secondary: { label: g.createLudo, testId: "create-ludo", onSubmit: (n) => o.onCreate(n, "ludo") },
          }),
    ),
    h(
      "article",
      { class: "game-card ludo-card" },
      h("div", { class: "cover ludo-cover", "aria-hidden": "true" }, [0, 1, 2, 3].map((i) => h("span", { class: `lc-pawn c${i}` }))),
      h("div", { class: "game-body" }, h("h2", {}, g.ludo.name), h("p", { class: "hint" }, g.ludo.tagline)),
    ),
    ...(o.extra ?? []),
    h(
      "div",
      { class: "game-row" },
      h("article", { class: "game-card soon", "aria-disabled": "true" }, h("div", { class: "game-body" }, h("h2", {}, g.remi.name), h("p", { class: "hint" }, g.remi.tagline)), h("span", { class: "tag warn" }, g.soon)),
    ),
    h("details", { class: "panel rules" }, h("summary", {}, g.rulesTitle), h("ol", {}, g.rules.map((r) => h("li", {}, r)))),
    h("details", { class: "panel rules" }, h("summary", {}, g.rulesLudoTitle), h("ol", {}, g.rulesLudo.map((r) => h("li", {}, r)))),
    h("div", { class: "panel" }, h("h2", {}, id.home.howTitle), h("ol", { class: "how" }, id.home.how.map((t) => h("li", {}, t)))),
  );
}
