import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";

export function resultView(s: StateMessage, busy: boolean, onAgain: () => void): HTMLElement {
  const r = s.game?.result;
  if (!r) return h("div");
  const nameOf = (seat: number): string => s.room.seats[seat]?.name ?? `#${seat + 1}`;
  return h(
    "section",
    { class: "stack" },
    h("h1", {}, id.result.title),
    h("p", { class: "winner", role: "status" }, id.result.winner(nameOf(r.winner)), " · ", r.reason === "out" ? id.result.reasonOut : id.result.reasonBlocked),
    h(
      "ol",
      { class: "ranking", "data-testid": "ranking" },
      r.ranking.map((e) =>
        h(
          "li",
          { class: `rank${e.rank === 1 ? " first" : ""}`, "data-rank": e.rank },
          h("span", { class: "rank-n" }, e.rank),
          h("span", { class: "grow" }, nameOf(e.seat), s.room.seats[e.seat]?.isYou ? ` (${id.lobby.you})` : ""),
          h("span", { class: "muted" }, id.result.points(e.points)),
        ),
      ),
    ),
    h("button", { class: "btn primary big again", type: "button", "data-testid": "rematch", disabled: busy, onclick: onAgain }, busy ? id.result.againing : id.result.again),
    h("p", { class: "hint center" }, id.result.againHint),
  );
}
