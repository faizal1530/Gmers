import { id } from "../i18n/id";
import { h } from "../dom";

export interface AccountViewOptions {
  /** Null = tamu. */
  username: string | null;
  /** Mengembalikan pesan galat (Indonesia) atau null bila berhasil. */
  onRegister: (username: string, password: string) => Promise<string | null>;
  onLogin: (username: string, password: string) => Promise<string | null>;
  onLogout: () => void;
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<string | null>;
  onDelete: (password: string) => Promise<string | null>;
}

function field(label: string, inputId: string, type: string, autocomplete: string, hint?: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { id: inputId, class: "input", type, autocomplete, autocapitalize: "off", spellcheck: "false", maxlength: 128, "aria-describedby": hint ? `${inputId}-h` : null });
  return { input, wrap: h("div", { class: "field" }, h("label", { for: inputId, class: "label" }, label), input, hint ? h("p", { id: `${inputId}-h`, class: "hint" }, hint) : null) };
}

/** Pembantu formulir: nonaktifkan tombol selama menunggu, tampilkan galat atau sukses. */
function submitter(btn: HTMLButtonElement, msg: HTMLElement, idle: string, busy: string, run: () => Promise<string | null>, okText?: string): (ev: Event) => void {
  return (ev) => {
    ev.preventDefault();
    btn.disabled = true;
    btn.textContent = busy;
    msg.textContent = "";
    void run().then((err) => {
      btn.disabled = false;
      btn.textContent = idle;
      msg.className = err ? "hint bad" : "hint";
      msg.textContent = err ?? okText ?? "";
    });
  };
}

export function accountView(o: AccountViewOptions): HTMLElement {
  const a = id.account;
  if (o.username === null) return guestPanel(o);
  const user = o.username;

  const askLogout = h("div", { class: "row", hidden: true }, h("p", { class: "hint" }, a.logoutAsk), h("button", { type: "button", class: "btn primary", "data-testid": "logout-yes", onclick: o.onLogout }, a.logoutYes), h("button", { type: "button", class: "btn", onclick: () => { askLogout.hidden = true; } }, a.cancel));

  const oldP = field(a.oldPassword, "pw-lama", "password", "current-password");
  const newP = field(a.newPassword, "pw-baru", "password", "new-password", a.passwordHint);
  const pwMsg = h("p", { class: "hint", role: "status", "aria-live": "polite" });
  const pwBtn = h("button", { type: "submit", class: "btn", "data-testid": "pw-change" }, a.change);
  const pwForm = h("form", { class: "form", novalidate: true }, oldP.wrap, newP.wrap, pwMsg, pwBtn);
  pwForm.addEventListener("submit", submitter(pwBtn, pwMsg, a.change, a.change, async () => {
    const r = await o.onChangePassword(oldP.input.value, newP.input.value);
    if (!r) {
      oldP.input.value = "";
      newP.input.value = "";
    }
    return r;
  }, a.changed));

  const delP = field(a.deletePassword, "pw-hapus", "password", "current-password");
  const delMsg = h("p", { class: "hint", role: "status", "aria-live": "polite" });
  const delBtn = h("button", { type: "submit", class: "btn danger", "data-testid": "delete-go" }, a.deleteGo);
  const delForm = h("form", { class: "form", novalidate: true }, h("p", { class: "hint" }, a.deleteWarn), delP.wrap, delMsg, delBtn);
  delForm.addEventListener("submit", submitter(delBtn, delMsg, a.deleteGo, a.deleteGo, () => o.onDelete(delP.input.value)));

  return h(
    "div",
    { class: "panel", "data-testid": "account-panel" },
    h("h2", {}, a.title),
    h("p", { class: "acc-user", "data-testid": "account-user" }, a.loggedAs(user)),
    h("p", { class: "hint" }, a.dataNote),
    h("button", { type: "button", class: "btn", "data-testid": "logout", onclick: () => { askLogout.hidden = false; } }, a.logout),
    askLogout,
    h("details", { class: "fold" }, h("summary", {}, a.changeTitle), pwForm),
    h("details", { class: "fold" }, h("summary", {}, a.deleteTitle), delForm),
  );
}

function guestPanel(o: AccountViewOptions): HTMLElement {
  const a = id.account;
  let mode: "register" | "login" = "register";
  const user = field(a.username, "akun-user", "text", "username", a.usernameHint);
  const pass = field(a.password, "akun-pass", "password", "new-password", a.passwordHint);
  const msg = h("p", { class: "hint", role: "status", "aria-live": "polite" });
  const go = h("button", { type: "submit", class: "btn primary big", "data-testid": "account-submit" }, a.register);
  const form = h("form", { class: "form", novalidate: true }, user.wrap, pass.wrap, msg, go);
  const tabs = h("div", { class: "seg", role: "tablist" });
  const tabBtn = (m: "register" | "login", label: string): HTMLButtonElement =>
    h("button", { type: "button", role: "tab", class: `seg-btn${m === mode ? " on" : ""}`, "data-mode": m, "aria-selected": String(m === mode), onclick: () => setMode(m) }, label);
  const draw = (): void => {
    tabs.replaceChildren(tabBtn("register", a.tabRegister), tabBtn("login", a.tabLogin));
    go.textContent = mode === "register" ? a.register : a.login;
    pass.input.setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
    pass.wrap.querySelector(".hint")?.toggleAttribute("hidden", mode === "login");
    user.wrap.querySelector(".hint")?.toggleAttribute("hidden", mode === "login");
    msg.textContent = "";
  };
  const setMode = (m: "register" | "login"): void => {
    mode = m;
    draw();
  };
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const idle = mode === "register" ? a.register : a.login;
    go.disabled = true;
    go.textContent = mode === "register" ? a.registering : a.loggingIn;
    msg.textContent = "";
    const run = mode === "register" ? o.onRegister(user.input.value, pass.input.value) : o.onLogin(user.input.value, pass.input.value);
    void run.then((err) => {
      go.disabled = false;
      go.textContent = idle;
      msg.className = err ? "hint bad" : "hint";
      msg.textContent = err ?? "";
    });
  });
  draw();
  return h("div", { class: "panel", "data-testid": "account-panel" }, h("h2", {}, a.title), h("p", { class: "hint" }, a.guestIntro), tabs, form);
}
