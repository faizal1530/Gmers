import type { LiveRoom } from "../api";
import { h } from "../dom";
import { id } from "../i18n/id";

export interface LiveOptions {
  loggedIn: boolean;
  rooms: LiveRoom[] | null;
  failed: boolean;
  onWatch: (key: string) => void;
  onRefresh: () => void;
  onToProfile: () => void;
}

export function liveListView(o: LiveOptions): HTMLElement {
  const l = id.live;
  if (!o.loggedIn) return h("section", { class: "stack" }, h("div", { class: "panel" }, h("p", { class: "hint" }, l.needAccount), h("button", { type: "button", class: "btn primary", onclick: o.onToProfile }, id.sections.toProfile)));
  return h(
    "section",
    { class: "stack" },
    h("p", { class: "hint" }, l.note),
    h("button", { type: "button", class: "btn small", "data-testid": "live-refresh", onclick: o.onRefresh }, l.refresh),
    o.rooms === null
      ? h("div", { class: "panel" }, h("p", { class: o.failed ? "hint bad" : "hint" }, o.failed ? l.error : "…"), o.failed ? h("button", { type: "button", class: "btn", onclick: o.onRefresh }, l.retry) : null)
      : o.rooms.length === 0
        ? h("p", { class: "hint center", "data-testid": "live-empty" }, l.empty)
        : h(
            "ul",
            { class: "flist", "data-testid": "live-list" },
            o.rooms.map((r) =>
              h(
                "li",
                { class: "panel frow", "data-testid": "live-room" },
                h("span", { class: "frow-mid" }, h("b", {}, `${id.gamePick[r.game]}${r.ranked ? ` · ${id.ranked.rankedOn}` : ""}`), h("span", { class: "hint" }, l.players(r.players)), h("span", { class: "hint" }, l.spectators(r.spectators))),
                h("button", { type: "button", class: "btn small primary", "data-testid": "live-watch", onclick: () => o.onWatch(r.key) }, l.watch),
              ),
            ),
          ),
  );
}
