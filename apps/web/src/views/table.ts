import type { Card } from "@gmers/game-engine";
import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { canPass, cardKey, isMyTurn, playableKeys } from "../logic";
import { avatar } from "./avatar";
import { domino } from "./card";

export interface LastMove {
  text: string;
  /** Sisi tempat kartu baru dipasang (untuk animasi); null bila lewat. */
  side: "left" | "right" | null;
}

export interface TableActions {
  onPlay: (card: Card, end: "left" | "right") => void;
  onNeedEnd: (card: Card) => void;
  onPass: () => void;
  onCancelEnd: () => void;
  onNudge: () => void;
  pendingCard: Card | null;
  connected: boolean;
  lastMove: LastMove | null;
  /** Sundulan sedang dalam jeda tunggu. */
  nudgeCooling: boolean;
}

export function tableView(s: StateMessage, a: TableActions): HTMLElement {
  const game = s.game;
  if (!game) return h("div");
  const mine = isMyTurn(s);
  const moves = mine && a.connected ? game.yourMoves : [];
  const playable = playableKeys(moves);
  const turnSeat = s.room.seats[game.turn];
  const turnName = turnSeat?.name ?? "";

  const players = h(
    "ul",
    { class: "players", "aria-label": id.table.playersLabel },
    s.room.seats.map((seat, i) =>
      seat
        ? h(
            "li",
            { class: `pl${game.turn === i ? " turn" : ""}${seat.connected ? "" : " off"}`, "data-seat": i },
            h("span", { class: "pl-av" }, avatar(seat.name, i, "md"), h("span", { class: `dot ${seat.connected ? "on" : "off"}`, role: "img", "aria-label": seat.connected ? id.lobby.ready : id.lobby.offline })),
            h("span", { class: "pl-name" }, seat.isYou ? id.lobby.you : seat.name),
            h("span", { class: "pl-n" }, seat.cardsLeft === null ? "" : id.table.cardsLeft(seat.cardsLeft)),
          )
        : null,
    ),
  );

  const canNudge = !mine && !!turnSeat && turnSeat.connected;
  const status = h(
    "div",
    { class: `turnbar${mine ? " mine" : ""}`, role: "status", "aria-live": "polite" },
    h(
      "div",
      { class: "turn-row" },
      h("span", { class: "turn-text", "data-testid": "turn-text" }, mine ? id.table.yourTurn : id.table.turnOf(turnName)),
      h("span", { class: "timer", id: "timer", "data-testid": "timer" }),
    ),
    h("div", { class: "timebar", "aria-hidden": "true" }, h("i", { id: "timefill" })),
    canNudge
      ? h("button", { class: "btn small nudge", id: "nudge", type: "button", "data-testid": "nudge", disabled: a.nudgeCooling || !a.connected, onclick: a.onNudge }, a.nudgeCooling ? id.table.nudgeWait : id.table.nudge(turnName))
      : null,
  );

  const ends = game.ends
    ? h(
        "div",
        { class: "ends", "data-testid": "ends" },
        h("div", { class: "end" }, h("span", { class: "end-label" }, id.table.left), h("span", { class: "end-num", "data-testid": "end-left" }, game.ends.left)),
        h("div", { class: "end" }, h("span", { class: "end-label" }, id.table.right), h("span", { class: "end-num", "data-testid": "end-right" }, game.ends.right)),
      )
    : null;

  const last = game.board.length - 1;
  const board = h(
    "div",
    { class: "board", role: "group", "aria-label": id.table.chainLabel, "data-testid": "board" },
    game.board.length === 0
      ? h("p", { class: "muted center" }, id.table.emptyBoard)
      : h(
          "div",
          { class: "chain" },
          game.board.map((c, i) => {
            const fresh = (a.lastMove?.side === "left" && i === 0) || (a.lastMove?.side === "right" && i === last);
            return h("span", { class: `placed${i === 0 ? " first" : ""}${i === last ? " last" : ""}${fresh ? " pop" : ""}` }, domino(c[0], c[1], "h"));
          }),
        ),
    h("p", { class: "lastmove", role: "status", "aria-live": "polite", "data-testid": "lastmove" }, a.lastMove?.text ?? id.table.noLastMove),
  );

  let hint: string;
  if (!mine) hint = id.table.waiting;
  else if (game.board.length === 0) hint = id.table.opening;
  else if (canPass(moves)) hint = id.table.passHint;
  else hint = id.table.pickCard;

  const hand = h(
    "ul",
    { class: `hand${mine ? " mine" : ""}`, "aria-label": id.table.handTitle, "data-testid": "hand" },
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
              const sides = new Set<string>();
              for (const m of moves) if (m.type === "play" && cardKey(m.card) === cardKey(c)) sides.add(m.end);
              if (sides.size === 0) return; // tidak ada langkah sah: tidak mengirim apa pun
              if (sides.size === 1) a.onPlay(c, [...sides][0] as "left" | "right");
              else a.onNeedEnd(c);
            },
          },
          domino(c[0], c[1], "v"),
        ),
      );
    }),
  );

  const picker =
    a.pendingCard && game.ends
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
