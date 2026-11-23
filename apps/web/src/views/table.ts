import type { Card } from "@gmers/game-engine";
import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { canPass, cardKey, isMyTurn, playableKeys } from "../logic";
import { domino } from "./card";

export interface TableActions {
  onPlay: (card: Card, end: "left" | "right") => void;
  /** Dipanggil saat kartu bisa dipasang di dua ujung; tampilan memilih ujung. */
  onNeedEnd: (card: Card) => void;
  onPass: () => void;
  onCancelEnd: () => void;
  /** Kartu yang menunggu pilihan ujung. */
  pendingCard: Card | null;
  connected: boolean;
}

export function tableView(s: StateMessage, a: TableActions): HTMLElement {
  const game = s.game;
  if (!game) return h("div");
  const mine = isMyTurn(s);
  const moves = mine && a.connected ? game.yourMoves : [];
  const playable = playableKeys(moves);
  const turnName = s.room.seats[game.turn]?.name ?? "";

  const players = h(
    "ul",
    { class: "players", "aria-label": id.table.playersLabel },
    s.room.seats.map((seat, i) =>
      seat
        ? h(
            "li",
            { class: `chip${game.turn === i ? " turn" : ""}`, "data-seat": i },
            h("span", { class: `dot ${seat.connected ? "on" : "off"}`, role: "img", "aria-label": seat.connected ? id.lobby.ready : id.lobby.offline }),
            h("span", { class: "chip-name" }, seat.isYou ? id.lobby.you : seat.name),
            h("span", { class: "chip-n" }, seat.cardsLeft === null ? "" : id.table.cardsLeft(seat.cardsLeft)),
          )
        : null,
    ),
  );

  const status = h(
    "div",
    { class: `turnbar${mine ? " mine" : ""}`, role: "status", "aria-live": "polite" },
    h("span", { class: "turn-text", "data-testid": "turn-text" }, mine ? id.table.yourTurn : id.table.turnOf(turnName)),
    h("span", { class: "timer", id: "timer", "data-testid": "timer" }),
  );

  const ends = game.ends
    ? h(
        "div",
        { class: "ends", "data-testid": "ends" },
        h("div", { class: "end" }, h("span", { class: "end-label" }, id.table.left), h("span", { class: "end-num", "data-testid": "end-left" }, game.ends.left)),
        h("div", { class: "end" }, h("span", { class: "end-label" }, id.table.right), h("span", { class: "end-num", "data-testid": "end-right" }, game.ends.right)),
      )
    : null;

  const board = h(
    "div",
    { class: "board", role: "group", "aria-label": id.table.chainLabel, "data-testid": "board" },
    game.board.length === 0
      ? h("p", { class: "muted center" }, id.table.emptyBoard)
      : h("div", { class: "chain" }, game.board.map((c, i) => h("span", { class: `placed${i === 0 ? " first" : ""}${i === game.board.length - 1 ? " last" : ""}` }, domino(c[0], c[1], "h")))),
  );

  let hint: string;
  if (!mine) hint = id.table.waiting;
  else if (game.board.length === 0) hint = id.table.opening;
  else if (canPass(moves)) hint = id.table.passHint;
  else hint = id.table.pickCard;

  const hand = h(
    "ul",
    { class: "hand", "aria-label": id.table.handTitle, "data-testid": "hand" },
    game.yourHand.map((c) => {
      const ok = playable.has(cardKey(c));
      return h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            class: `card-btn${ok ? " ok" : " off"}`,
            "data-card": cardKey(c),
            disabled: !ok,
            "aria-label": `${id.table.cardLabel(c[0], c[1])}${ok ? "" : `, ${id.table.cardOff}`}`,
            onclick: () => {
              const ends = new Set<string>();
              for (const m of moves) if (m.type === "play" && cardKey(m.card) === cardKey(c)) ends.add(m.end);
              if (ends.size === 0) return; // tidak ada langkah sah: tidak mengirim apa pun
              if (ends.size === 1) a.onPlay(c, [...ends][0] as "left" | "right");
              else a.onNeedEnd(c);
            },
          },
          domino(c[0], c[1], "v"),
        ),
      );
    }),
  );

  const picker = a.pendingCard && game.ends
    ? h(
        "div",
        { class: "sheet", role: "dialog", "aria-label": id.table.pickEnd, "data-testid": "end-picker" },
        h("p", { class: "sheet-title" }, id.table.pickEnd),
        h("div", { class: "row" }, domino(a.pendingCard[0], a.pendingCard[1], "h")),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary big", type: "button", "data-end": "left", onclick: () => a.onPlay(a.pendingCard as Card, "left") }, id.table.atLeft(game.ends.left)),
          h("button", { class: "btn primary big", type: "button", "data-end": "right", onclick: () => a.onPlay(a.pendingCard as Card, "right") }, id.table.atRight(game.ends.right)),
        ),
        h("button", { class: "btn", type: "button", onclick: a.onCancelEnd }, id.table.cancel),
      )
    : null;

  return h(
    "section",
    { class: "table-screen" },
    players,
    status,
    ends,
    board,
    h("p", { class: "hint center", role: "status" }, hint),
    h("button", { class: "btn big pass", type: "button", "data-testid": "pass", disabled: !canPass(moves), onclick: a.onPass }, id.table.pass),
    hand,
    picker,
  );
}
