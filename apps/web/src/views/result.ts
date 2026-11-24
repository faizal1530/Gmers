import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { avatar } from "./avatar";

export function resultView(s: StateMessage, busy: boolean, onAgain: () => void): HTMLElement {
  const r = s.game?.result;
  if (!r) return h("div");
  const nameOf = (seat: number): string => s.room.seats[seat]?.name ?? `#${seat + 1}`;
  const iWon = r.winner === s.you.seat;
  return h(
    "section",
    { class: "stack" },
    h(
      "div",
      { class: `hero${iWon ? " won" : ""}`, role: "status" },
      h("span", { class: "crown", "aria-hidden": "true" }, "★"),
      avatar(nameOf(r.winner), r.winner, "lg"),
      h("h1", {}, iWon ? id.result.youWon : id.result.winner(nameOf(r.winner))),
      h("p", { class: "hint" }, r.reason === "out" ? id.result.reasonOut : id.result.reasonBlocked),
    ),
    h(
      "ol",
      { class: "ranking", "data-testid": "ranking" },
      r.ranking.map((e) =>
        h(
          "li",
          { class: `rank r${Math.min(e.rank, 4)}`, "data-rank": e.rank, "aria-label": id.result.medal(e.rank) },
          h("span", { class: "rank-n" }, e.rank),
          avatar(nameOf(e.seat), e.seat, "sm"),
          h("span", { class: "grow" }, nameOf(e.seat), s.room.seats[e.seat]?.isYou ? ` (${id.lobby.you})` : ""),
          h("span", { class: "muted" }, id.result.points(e.points)),
        ),
      ),
    ),
    h("button", { class: "btn primary big again", type: "button", "data-testid": "rematch", disabled: busy, onclick: onAgain }, busy ? id.result.againing : id.result.again),
    h("p", { class: "hint center" }, id.result.againHint),
  );
}
