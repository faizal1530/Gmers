import type { FriendsData, FriendRow, NotifPrefs, NoticeRow, PersonRow, StatusId, UserCard } from "../api";
import { h } from "../dom";
import { id } from "../i18n/id";
import { avatar } from "./avatar";

export interface FriendsOptions {
  loggedIn: boolean;
  data: FriendsData | null;
  failed: boolean;
  notices: NoticeRow[];
  /** Hasil pencarian terakhir (kartu pengguna) atau pesan galat. */
  found: { card: UserCard } | { error: string } | null;
  /** Isi kolom cari yang belum dikirim (dipertahankan saat tampilan dimuat ulang). */
  draft: string;
  onDraft: (v: string) => void;
  onBack: () => void;
  onSearch: (username: string) => void;
  onRelate: (kind: "follow" | "contact" | "block", username: string, on: boolean) => void;
  onReport: (username: string, reason: string) => void;
  onChat: (f: PersonRow) => void;
  onInvite: (f: PersonRow) => void;
  onStatus: (s: StatusId) => void;
  onPrefs: (p: Partial<NotifPrefs>) => void;
  onMarkRead: () => void;
  onRetry: () => void;
  onToProfile: () => void;
}

const STATUSES: StatusId[] = ["siap", "sibuk", "senyap", "dnd"];
const PREFS: (keyof NotifPrefs)[] = ["invite", "follow", "streak", "dm"];

function flame(f: FriendRow): HTMLElement | null {
  if (f.streak.count <= 0) return null;
  return h("span", { class: `streak${f.streak.doneToday ? " done" : ""}`, "data-testid": "streak", title: f.streak.doneToday ? id.friends.streak(f.streak.count) : id.friends.streakPending }, `🔥 ${f.streak.count}`);
}

function friendRow(f: FriendRow, o: FriendsOptions): HTMLElement {
  return h(
    "li",
    { class: "frow", "data-testid": "friend", "data-username": f.username },
    h("span", { class: "cv-av" }, avatar(f.name, 0, "lg"), h("span", { class: `dot ${f.online ? "on" : "off"} pres`, "aria-hidden": "true" })),
    h(
      "span",
      { class: "frow-mid" },
      h("b", {}, f.name),
      h("span", { class: "hint" }, `@${f.username} · ${f.online ? id.friends.status[f.status] : id.friends.offline}`),
      flame(f),
    ),
    h(
      "span",
      { class: "frow-actions" },
      h("button", { type: "button", class: "btn small", "data-testid": "friend-chat", onclick: () => o.onChat(f) }, id.friends.chat),
      h("button", { type: "button", class: "btn small primary", "data-testid": "friend-invite", onclick: () => o.onInvite(f) }, id.friends.invite),
    ),
  );
}

function personRow(p: PersonRow, actions: HTMLElement[]): HTMLElement {
  return h("li", { class: "frow", "data-username": p.username }, avatar(p.name, 0, "md"), h("span", { class: "frow-mid" }, h("b", {}, p.name), h("span", { class: "hint" }, `@${p.username}`)), h("span", { class: "frow-actions" }, actions));
}

function userCard(c: UserCard, o: FriendsOptions): HTMLElement {
  const r = c.relation;
  const toggle = (kind: "follow" | "contact" | "block", on: boolean, label: string, testid: string): HTMLElement =>
    h("button", { type: "button", class: "btn small", "data-testid": testid, onclick: () => o.onRelate(kind, c.username, on) }, label);
  const reason = h("input", { class: "input", type: "text", maxlength: 200, placeholder: id.friends.reportReason, "aria-label": id.friends.reportReason, "data-testid": "report-reason" });
  return h(
    "div",
    { class: "panel usercard", "data-testid": "usercard", "data-username": c.username },
    h("div", { class: "me" }, avatar(c.name, 0, "lg"), h("span", { class: "frow-mid" }, h("b", {}, c.name), h("span", { class: "hint" }, `@${c.username}`)), r.friend ? h("span", { class: "chip live", "data-testid": "friend-tag" }, id.friends.friendTag) : null),
    h(
      "div",
      { class: "frow-actions wrap" },
      toggle("follow", !r.iFollow, r.iFollow ? id.friends.unfollow : id.friends.follow, "rel-follow"),
      toggle("contact", !r.iSaved, r.iSaved ? id.friends.unsave : id.friends.save, "rel-contact"),
      toggle("block", !r.iBlocked, r.iBlocked ? id.friends.unblock : id.friends.block, "rel-block"),
    ),
    h(
      "form",
      { class: "form", onsubmit: (e: Event) => { e.preventDefault(); if (reason.value.trim()) { o.onReport(c.username, reason.value.trim()); reason.value = ""; } } },
      reason,
      h("button", { type: "submit", class: "btn small", "data-testid": "report-send" }, id.friends.report),
    ),
  );
}

export function friendsView(o: FriendsOptions): HTMLElement {
  const f = id.friends;
  const back = h("button", { type: "button", class: "btn small", "data-testid": "friends-back", onclick: o.onBack }, f.back);
  if (!o.loggedIn) {
    return h("section", { class: "stack" }, h("div", { class: "row-head" }, back, h("h1", {}, f.title)), h("div", { class: "panel" }, h("p", { class: "hint" }, f.needAccount), h("button", { type: "button", class: "btn primary", onclick: o.onToProfile }, id.account.bannerBtn)));
  }
  const input = h("input", { id: "cari-teman", class: "input", type: "text", autocomplete: "off", autocapitalize: "off", value: o.draft, oninput: (e: Event) => o.onDraft((e.target as HTMLInputElement).value), placeholder: f.searchPlaceholder, "aria-label": f.searchLabel, "data-testid": "friend-search" });
  const search = h(
    "form",
    { class: "form", onsubmit: (e: Event) => { e.preventDefault(); const v = input.value.trim().replace(/^@/, ""); if (v) o.onSearch(v); } },
    h("label", { for: "cari-teman", class: "label" }, f.searchLabel),
    input,
    h("button", { type: "submit", class: "btn primary", "data-testid": "friend-search-btn" }, f.searchBtn),
  );
  const found = o.found ? ("card" in o.found ? userCard(o.found.card, o) : h("p", { class: "hint bad", role: "status", "data-testid": "search-error" }, o.found.error)) : null;
  const d = o.data;
  const list = (title: string, rows: HTMLElement[], testid: string): HTMLElement | null =>
    rows.length ? h("div", { class: "panel" }, h("h2", {}, title), h("ul", { class: "flist", "data-testid": testid }, rows)) : null;
  const body: (HTMLElement | null)[] = [];
  if (!d) {
    body.push(h("div", { class: "panel" }, h("p", { class: o.failed ? "hint bad" : "hint" }, o.failed ? f.error : "…"), o.failed ? h("button", { type: "button", class: "btn", "data-testid": "friends-retry", onclick: o.onRetry }, f.retry) : null));
  } else {
    body.push(
      h(
        "div",
        { class: "panel" },
        h("h2", {}, f.statusTitle),
        h("div", { class: "seg", role: "radiogroup", "aria-label": f.statusTitle }, STATUSES.map((s) => h("button", { type: "button", role: "radio", class: `seg-btn${d.status === s ? " on" : ""}`, "aria-checked": String(d.status === s), "data-status": s, onclick: () => o.onStatus(s) }, f.status[s]))),
        h("p", { class: "hint" }, f.statusNote),
      ),
      d.friends.length ? list(f.listFriends, d.friends.map((x) => friendRow(x, o)), "friend-list") : h("div", { class: "panel" }, h("p", { class: "hint", "data-testid": "friends-empty" }, f.empty), h("p", { class: "hint" }, f.friendHint)),
      list(f.listIncoming, d.incoming.map((p) => personRow(p, [h("button", { type: "button", class: "btn small", onclick: () => o.onRelate("follow", p.username, true) }, f.follow)])), "incoming-list"),
      list(f.listWaiting, d.waiting.map((p) => personRow(p, [h("button", { type: "button", class: "btn small", onclick: () => o.onRelate("follow", p.username, false) }, f.unfollow)])), "waiting-list"),
      list(f.listBlocked, d.blocked.map((p) => personRow(p, [h("button", { type: "button", class: "btn small", onclick: () => o.onRelate("block", p.username, false) }, f.unblock)])), "blocked-list"),
      h(
        "div",
        { class: "panel" },
        h("h2", {}, f.notifTitle),
        PREFS.map((k) => {
          const cb = h("input", { type: "checkbox", "data-pref": k, checked: d.prefs[k], onchange: () => o.onPrefs({ [k]: cb.checked }) });
          return h("label", { class: "check" }, cb, h("span", {}, f.notif[k]));
        }),
      ),
    );
  }
  const unread = o.notices.filter((n) => !n.read).length;
  const notices = h(
    "div",
    { class: "panel", "data-testid": "notices" },
    h("h2", {}, f.noticesTitle),
    o.notices.length ? h("ul", { class: "flist" }, o.notices.slice(0, 20).map((n) => h("li", { class: `notice${n.read ? "" : " new"}` }, n.text))) : h("p", { class: "hint" }, f.noticesEmpty),
    unread ? h("button", { type: "button", class: "btn small", "data-testid": "notices-read", onclick: o.onMarkRead }, f.markRead) : null,
  );
  return h("section", { class: "stack" }, h("div", { class: "row-head" }, back, h("h1", {}, f.title)), h("div", { class: "panel" }, search, found), ...body, notices);
}
