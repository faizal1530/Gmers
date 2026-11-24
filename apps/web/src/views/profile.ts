import { id } from "../i18n/id";
import { h } from "../dom";
import { checkName } from "../logic";
import type { ThemeMode } from "../theme";
import { accountView, type AccountViewOptions } from "./account";
import { avatar } from "./avatar";

export interface ProfileOptions {
  account: AccountViewOptions;
  wallet: HTMLElement;
  name: string;
  theme: ThemeMode;
  soundOn: boolean;
  onSound: (on: boolean) => void;
  onSaveName: (name: string) => void;
  onClearChats: () => void;
  onTheme: (mode: ThemeMode) => void;
  onPrivacy: () => void;
}

export function profileView(o: ProfileOptions): HTMLElement {
  const p = id.profile;
  const input = h("input", { id: "nama", class: "input", type: "text", value: o.name, autocomplete: "nickname", maxlength: 40, "aria-describedby": "nama-bantuan" });
  const hint = h("p", { id: "nama-bantuan", class: "hint", role: "status", "aria-live": "polite" }, p.nameNote);
  const themes: [ThemeMode, string][] = [["auto", p.themeAuto], ["light", p.themeLight], ["dark", p.themeDark]];
  return h(
    "section",
    { class: "stack" },
    h("h1", {}, p.title),
    accountView(o.account),
    o.wallet,
    h(
      "div",
      { class: "panel" },
      h("div", { class: "me" }, avatar(o.name || "?", 0, "lg"), h("strong", {}, o.name || "-")),
      h(
        "form",
        {
          class: "form",
          novalidate: true,
          onsubmit: (ev: Event) => {
            ev.preventDefault();
            const r = checkName(input.value);
            if (!r.ok) {
              hint.textContent = id.name[r.reason];
              hint.classList.add("bad");
              return;
            }
            hint.classList.remove("bad");
            hint.textContent = p.nameSaved;
            o.onSaveName(r.name);
          },
        },
        h("label", { for: "nama", class: "label" }, p.nameLabel),
        input,
        hint,
        h("button", { class: "btn primary", type: "submit" }, p.nameSave),
      ),
    ),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, p.soundTitle),
      h("p", { class: "hint" }, p.soundNote),
      h("div", { class: "seg", role: "radiogroup", "aria-label": p.soundTitle }, [[true, p.soundOn], [false, p.soundOff]].map(([on, label]) => h("button", { type: "button", role: "radio", class: `seg-btn${o.soundOn === on ? " on" : ""}`, "aria-checked": String(o.soundOn === on), "data-sound": on ? "on" : "off", onclick: () => o.onSound(on as boolean) }, label as string))),
    ),
    h(
      "div",
      { class: "panel" },
      h("h2", {}, p.themeTitle),
      h("div", { class: "seg", role: "radiogroup", "aria-label": p.themeTitle }, themes.map(([m, label]) => h("button", { type: "button", role: "radio", class: `seg-btn${o.theme === m ? " on" : ""}`, "aria-checked": String(o.theme === m), "data-theme-mode": m, onclick: () => o.onTheme(m) }, label))),
    ),
    h("div", { class: "panel" }, h("h2", {}, p.dataTitle), h("p", { class: "hint" }, id.chat.deviceNote), h("button", { class: "btn", type: "button", "data-testid": "clear-chats", onclick: o.onClearChats }, p.clearChats)),
    h("div", { class: "panel" }, h("h2", {}, p.aboutTitle), h("p", { class: "hint" }, p.about), h("button", { class: "btn", type: "button", onclick: o.onPrivacy }, p.privacy)),
  );
}
