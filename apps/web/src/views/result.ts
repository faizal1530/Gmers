import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { avatar } from "./avatar";
import { kelasBadge } from "./ranked";

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
      h("p", { class: "hint" }, r.reason === "out" ? id.result.reasonOut : r.reason === "home" ? id.result.reasonHome : id.result.reasonBlocked),
    ),
    myReward(s),
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
          h("span", { class: "muted" }, s.game?.kind === "ludo" ? id.ludo.homeCount(4 - e.cardsLeft) : id.result.points(e.points)),
          rewardChip(s, e.seat),
        ),
      ),
    ),
    h("button", { class: "btn primary big again", type: "button", "data-testid": "rematch", disabled: busy, onclick: onAgain }, busy ? id.result.againing : id.result.again),
    h("p", { class: "hint center" }, id.result.againHint),
  );
}

function rewardOf(s: StateMessage, seat: number) {
  return s.game?.result?.rewards?.find((r) => r.seat === seat) ?? null;
}

function rewardChip(s: StateMessage, seat: number): HTMLElement | null {
  const r = rewardOf(s, seat);
  if (!r || !s.room.ranked) return null;
  return h("span", { class: `chip-reward ${r.trofi >= 0 ? "up" : "down"}`, "data-testid": "reward-chip" }, id.ranked.rewardTrofi(r.trofi));
}

/** Hasilmu: Trofi (Ranked), Bintang, kelas, dan ajakan naik kelas. Semua dihitung server. */
function myReward(s: StateMessage): HTMLElement | null {
  const r = rewardOf(s, s.you.seat);
  if (!r) return null;
  return h(
    "div",
    { class: "panel reward", "data-testid": "my-reward", role: "status" },
    h("h2", {}, id.ranked.yourReward),
    h("div", { class: "wallet-row" }, s.room.ranked ? h("span", { class: "wallet-n" }, id.ranked.rewardTrofi(r.trofi)) : null, h("span", { class: "wallet-n" }, id.ranked.rewardBintang(r.bintang)), kelasBadge(r.kelas)),
    r.kelasUp ? h("p", { class: "classup", "data-testid": "class-up" }, id.ranked.classUp(r.kelasUp)) : null,
  );
}
