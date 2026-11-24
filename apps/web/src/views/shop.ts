import type { ShopData } from "../api";
import { h } from "../dom";
import { id } from "../i18n/id";

export interface ShopOptions {
  data: ShopData | null;
  failed: boolean;
  busy: boolean;
  onClaim: () => void;
  onBuy: (item: string) => void;
  onEquip: (item: string) => void;
  onRetry: () => void;
}

export function shopView(o: ShopOptions): HTMLElement {
  const s = id.shop;
  const d = o.data;
  const banner = h("p", { class: "notice", role: "note", "data-testid": "shop-sim" }, s.simulation);
  if (!d) return h("section", { class: "stack" }, banner, h("div", { class: "panel" }, h("p", { class: o.failed ? "hint bad" : "hint" }, o.failed ? s.error : "…"), o.failed ? h("button", { type: "button", class: "btn", onclick: o.onRetry }, s.retry) : null));
  const kinds: ("dadu" | "emoji" | "avatar")[] = ["dadu", "emoji", "avatar"];
  return h(
    "section",
    { class: "stack" },
    banner,
    h("div", { class: "panel" }, h("h2", { "data-testid": "koin" }, s.balance(d.koin)), h("button", { type: "button", class: "btn primary", "data-testid": "claim", disabled: !d.canClaim || o.busy, onclick: o.onClaim }, d.canClaim ? s.claim(d.dailyKoin) : s.claimed)),
    kinds.map((k) =>
      h(
        "div",
        { class: "panel" },
        h("h2", {}, s.kinds[k]),
        h(
          "ul",
          { class: "flist" },
          d.items
            .filter((i) => i.kind === k)
            .map((i) =>
              h(
                "li",
                { class: "frow", "data-testid": "shop-item", "data-item": i.id },
                h("span", { class: "frow-mid" }, h("b", {}, i.name), h("span", { class: "hint" }, i.free ? s.free : i.owned ? s.owned : "")),
                i.owned
                  ? h("button", { type: "button", class: `btn small${i.equipped ? " on" : ""}`, "data-testid": "equip", disabled: i.equipped || o.busy || k === "emoji", onclick: () => o.onEquip(i.id) }, i.equipped ? s.equipped : k === "emoji" ? s.owned : s.equip)
                  : h("button", { type: "button", class: "btn small primary", "data-testid": "buy", disabled: o.busy || d.koin < i.price, onclick: () => o.onBuy(i.id) }, s.buy(i.price)),
              ),
            ),
        ),
      ),
    ),
  );
}
