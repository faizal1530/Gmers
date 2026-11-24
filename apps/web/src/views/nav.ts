import { id } from "../i18n/id";
import { h } from "../dom";
import { icon } from "./icons";

export type Tab = "games" | "room" | "chat" | "profile";
const ORDER: Tab[] = ["chat", "games", "room", "profile"];

export function tabBar(active: Tab, chatUnread: number, onSelect: (t: Tab) => void): HTMLElement {
  return h(
    "nav",
    { class: "tabs", "aria-label": id.tabs.label },
    ORDER.map((t) =>
      h(
        "button",
        {
          type: "button",
          class: `tab${t === active ? " on" : ""}`,
          "data-testid": `tab-${t}`,
          "aria-current": t === active ? "page" : null,
          "aria-label": t === "chat" && chatUnread > 0 ? `${id.tabs.chat}. ${id.chat.tabUnread(chatUnread)}` : id.tabs[t],
          onclick: () => onSelect(t),
        },
        h("span", { class: "tab-ic" }, icon(t), t === "chat" && chatUnread > 0 ? h("span", { class: "badge", "data-testid": "chat-badge" }, chatUnread > 9 ? "9+" : chatUnread) : null),
        h("span", { class: "tab-tx" }, id.tabs[t]),
      ),
    ),
  );
}
