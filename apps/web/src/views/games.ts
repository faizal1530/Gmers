import { id } from "../i18n/id";
import { h } from "../dom";
import { nameForm } from "./forms";
import { domino } from "./card";

export interface GamesOptions {
  initialName: string;
  busy: boolean;
  roomCode: string | null;
  onCreate: (name: string) => void;
  onBackToRoom: () => void;
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
        : nameForm({ initial: o.initialName, submitLabel: o.busy ? id.home.creating : id.home.create, busy: o.busy, onSubmit: o.onCreate }),
    ),
    h(
      "div",
      { class: "game-row" },
      [g.ludo, g.remi].map((x) => h("article", { class: "game-card soon", "aria-disabled": "true" }, h("div", { class: "game-body" }, h("h2", {}, x.name), h("p", { class: "hint" }, x.tagline)), h("span", { class: "tag warn" }, g.soon))),
    ),
    h("details", { class: "panel rules" }, h("summary", {}, g.rulesTitle), h("ol", {}, g.rules.map((r) => h("li", {}, r)))),
    h("div", { class: "panel" }, h("h2", {}, id.home.howTitle), h("ol", { class: "how" }, id.home.how.map((t) => h("li", {}, t)))),
  );
}
