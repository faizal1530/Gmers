import type { StateMessage } from "@gmers/server/protocol";
import { id } from "../i18n/id";
import { h } from "../dom";
import { shareUrl, whatsappLink } from "../logic";
import { avatar } from "./avatar";

export interface LobbyActions {
  onStart: () => void;
  onLeave: () => void;
  onSetGame: (game: "gaple" | "ludo") => void;
  onSetRanked: (on: boolean) => void;
  onSetWatch: (on: boolean) => void;
  /** Hanya akun yang bisa menyiarkan atau menonton. */
  canWatch: boolean;
  onCopy: (url: string) => Promise<boolean>;
  origin: string;
}

export function lobbyView(s: StateMessage, a: LobbyActions): HTMLElement {
  const url = shareUrl(a.origin, s.room.groupId);
  const seated = s.room.seats.filter((x) => x !== null);
  const isHost = s.you.seat === s.room.hostSeat;
  const hostName = s.room.seats[s.room.hostSeat]?.name ?? "";
  const allRegistered = seated.every((x) => x?.registered);
  const copyNote = h("span", { class: "hint", role: "status", "aria-live": "polite" });
  const copyBtn = h(
    "button",
    {
      class: "btn",
      type: "button",
      onclick: () => {
        void a.onCopy(url).then((ok) => {
          copyNote.textContent = ok ? id.lobby.copied : id.lobby.copyFailed;
        });
      },
    },
    id.lobby.copy,
  );
  return h(
    "section",
    { class: "stack" },
    h("h1", {}, id.lobby.title),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, id.lobby.shareTitle),
      h("p", { class: "hint" }, id.lobby.shareHint),
      h("p", { class: "link-box", "data-testid": "share-url" }, url),
      h(
        "div",
        { class: "row" },
        copyBtn,
        h("a", { class: "btn wa", href: whatsappLink(id.lobby.shareText(url)), target: "_blank", rel: "noopener noreferrer" }, id.lobby.whatsapp),
      ),
      copyNote,
    ),
    h(
      "div",
      { class: "panel", "data-testid": "game-pick" },
      h("h2", {}, id.gamePick.label),
      isHost
        ? h("div", { class: "seg", role: "radiogroup", "aria-label": id.gamePick.label }, (["gaple", "ludo"] as const).map((g) => h("button", { type: "button", role: "radio", class: `seg-btn${s.room.gameId === g ? " on" : ""}`, "aria-checked": String(s.room.gameId === g), "data-game": g, onclick: () => a.onSetGame(g) }, id.gamePick[g])))
        : h("p", { class: "game-label", "data-testid": "game-label" }, id.gamePick[s.room.gameId], " · ", id.gamePick.note),
    ),
    h(
      "div",
      { class: "panel", "data-testid": "ranked-pick" },
      h("h2", {}, id.ranked.lobbyTitle),
      isHost
        ? h(
            "div",
            { class: "seg", role: "radiogroup", "aria-label": id.ranked.lobbyTitle },
            ([false, true] as const).map((on) =>
              h("button", { type: "button", role: "radio", class: `seg-btn${s.room.ranked === on ? " on" : ""}`, "aria-checked": String(s.room.ranked === on), "data-ranked": on ? "on" : "off", disabled: on && !allRegistered, onclick: () => a.onSetRanked(on) }, on ? id.ranked.rankedOn : id.ranked.casual),
            ),
          )
        : h("p", { class: "game-label", "data-testid": "ranked-label" }, s.room.ranked ? id.ranked.rankedOn : id.ranked.casual),
      h("p", { class: "hint" }, allRegistered || s.room.ranked ? id.ranked.lobbyNote : id.ranked.needAccounts),
    ),
    isHost && a.canWatch
      ? h(
          "div",
          { class: "panel", "data-testid": "watch-pick" },
          h("h2", {}, id.live.toggleTitle),
          h("div", { class: "seg", role: "radiogroup", "aria-label": id.live.toggleTitle }, ([false, true] as const).map((on) => h("button", { type: "button", role: "radio", class: `seg-btn${s.room.watchable === on ? " on" : ""}`, "aria-checked": String(s.room.watchable === on), "data-watch": on ? "on" : "off", onclick: () => a.onSetWatch(on) }, on ? id.live.toggleOn : id.live.toggleOff))),
          h("p", { class: "hint" }, id.live.toggleNote),
          s.room.watchable ? h("p", { class: "hint" }, id.live.spectatorsNow(s.room.spectators)) : null,
        )
      : null,
    h(
      "div",
      { class: "panel" },
      h("h2", {}, id.lobby.seatsTitle),
      h(
        "ul",
        { class: "seats" },
        s.room.seats.map((seat, i) =>
          h(
            "li",
            { class: seat ? "seat" : "seat empty", "data-seat": i },
            seat
              ? [
                  avatar(seat.name, i, "md"),
                  h("span", { class: `dot ${seat.connected ? "on" : "off"}`, "aria-hidden": "true" }),
                  h("span", { class: "grow" }, seat.name, seat.isYou ? ` (${id.lobby.you})` : "", i === s.room.hostSeat ? ` · ${id.lobby.owner}` : ""),
                  h("span", { class: seat.connected ? "tag good" : "tag warn" }, seat.connected ? id.lobby.ready : id.lobby.offline),
                ]
              : h("span", { class: "grow muted" }, id.lobby.empty),
          ),
        ),
      ),
    ),
    isHost
      ? h(
          "div",
          { class: "stack" },
          h("button", { class: "btn primary big", type: "button", disabled: seated.length < 2, onclick: a.onStart }, id.lobby.start),
          seated.length < 2 ? h("p", { class: "hint center" }, id.lobby.needMore) : null,
        )
      : h("p", { class: "hint center" }, id.lobby.waitHost(hostName)),
    h("button", { class: "btn link", type: "button", onclick: a.onLeave }, id.lobby.leave),
  );
}
