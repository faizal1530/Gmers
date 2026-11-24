import type { StateMessage } from "@gmers/server/protocol";
import { clear, h } from "../dom";
import { id } from "../i18n/id";
import { CHAT_MAX, ChatLimiter, cleanText } from "../logic";
import { ChatStore, kindOf, otherMember, type Convo, type StoredMsg } from "../chatstore";
import { avatar } from "./avatar";
import { icon } from "./icons";

export interface HubDeps {
  store: ChatStore;
  send: (text: string) => boolean;
  live: () => StateMessage | null;
  connected: () => boolean;
  myName: () => string;
  /** Masuk lagi ke room lama (kode kelompok tetap hidup). */
  rejoin: (groupId: string) => void;
  toRoom: () => void;
  toGames: () => void;
  toProfile: () => void;
  onUnread: () => void;
  now?: () => number;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
};
const dayStart = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** Waktu di daftar: jam bila hari ini, "Kemarin", nama hari dalam seminggu, selain itu tanggal. */
export function listTime(ts: number, now: number): string {
  const diff = Math.round((dayStart(now) - dayStart(ts)) / DAY);
  if (diff <= 0) return fmtTime(ts);
  if (diff === 1) return id.chat.yesterday;
  if (diff < 7) return DAYS[new Date(ts).getDay()] as string;
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function dayLabel(ts: number, now: number): string {
  const diff = Math.round((dayStart(now) - dayStart(ts)) / DAY);
  if (diff <= 0) return id.chat.today;
  if (diff === 1) return id.chat.yesterday;
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function convoTitle(c: Convo): string {
  if (kindOf(c) === "direct") return otherMember(c)?.name ?? id.chat.roomLabel(c.groupId);
  return id.chat.roomLabel(c.groupId);
}

function preview(c: Convo): string {
  const last = [...c.msgs].reverse().find((m) => m.kind === "msg") ?? c.msgs[c.msgs.length - 1];
  if (!last) return id.chat.noMessages;
  if (last.kind === "sys") return last.text;
  if (last.mine) return `${id.chat.youPrefix}${last.text}`;
  return kindOf(c) === "group" ? `${last.name}: ${last.text}` : last.text;
}

function groupAvatar(size: "md" | "lg"): HTMLElement {
  return h("span", { class: `gav ${size}`, "aria-hidden": "true" }, icon("people"));
}

/** Daftar chat dan percakapan ala WhatsApp, mengikuti mockup. Riwayat tersimpan hanya di perangkat. */
export class ChatHub {
  readonly view: HTMLElement;
  private mode: { kind: "list" } | { kind: "thread"; groupId: string } = { kind: "list" };
  private active = false;
  private readonly limiter = new ChatLimiter();
  private readonly now: () => number;
  // bagian percakapan yang bertahan selama thread terbuka (supaya ketikan tidak hilang)
  private head: HTMLElement | null = null;
  private log: HTMLElement | null = null;
  private foot: HTMLElement | null = null;
  private footKey = "";
  private input: HTMLInputElement | null = null;
  private note: HTMLElement | null = null;
  private tray: HTMLElement | null = null;

  constructor(private readonly d: HubDeps) {
    this.now = d.now ?? (() => Date.now());
    this.view = h("section", { class: "hub" });
    this.refresh();
  }

  get openThreadId(): string | null {
    return this.mode.kind === "thread" ? this.mode.groupId : null;
  }

  /** Sedang dilihat pengguna (tab Chat aktif dan thread itu terbuka). */
  isViewing(groupId: string): boolean {
    return this.active && this.mode.kind === "thread" && this.mode.groupId === groupId;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active && this.mode.kind === "thread" && this.d.store.markRead(this.mode.groupId)) this.d.onUnread();
    this.refresh();
    if (active) this.scrollEnd();
  }

  showList(): void {
    this.mode = { kind: "list" };
    this.head = this.log = this.foot = this.input = this.note = this.tray = null;
    this.footKey = "";
    this.refresh();
  }

  openThread(groupId: string): void {
    if (!this.d.store.get(groupId)) return;
    this.mode = { kind: "thread", groupId };
    this.head = this.log = this.foot = this.input = this.note = this.tray = null;
    this.footKey = "";
    if (this.d.store.markRead(groupId)) this.d.onUnread();
    this.refresh();
    this.scrollEnd();
  }

  focusInput(): void {
    this.input?.focus();
  }

  /** Perbarui tampilan dari penyimpanan dan state live. */
  refresh(): void {
    if (this.mode.kind === "list") {
      clear(this.view);
      this.view.append(this.buildList());
      return;
    }
    const convo = this.d.store.get(this.mode.groupId);
    if (!convo) {
      this.showList();
      return;
    }
    if (!this.log) {
      clear(this.view);
      this.head = h("header", { class: "th-head" });
      this.log = h("ul", { class: "th-log", "aria-live": "polite", "data-testid": "chat-log" });
      this.foot = h("footer", { class: "th-foot" });
      this.view.append(this.head, this.log, this.foot);
    }
    this.renderHead(convo);
    this.renderLog(convo);
    this.renderFoot(convo);
  }

  // ---------- daftar ----------

  private buildList(): HTMLElement {
    const convos = this.d.store.list();
    const live = this.d.live();
    const nowTs = this.now();
    const connected = this.d.connected();
    const rows = convos.map((c) => {
      const isLive = live?.room.groupId === c.groupId;
      const kind = kindOf(c);
      const other = otherMember(c);
      const liveSeat = isLive && other ? live?.room.seats[other.seat] : null;
      return h(
        "button",
        { type: "button", class: "convo", "data-testid": "convo", "data-group": c.groupId, "data-kind": kind, onclick: () => this.openThread(c.groupId) },
        kind === "direct" && other
          ? h("span", { class: "cv-av" }, avatar(other.name, other.seat, "lg"), liveSeat?.connected ? h("span", { class: "dot on pres", "aria-hidden": "true" }) : null)
          : groupAvatar("lg"),
        h(
          "span",
          { class: "cv-mid" },
          h("span", { class: "cv-title" }, h("b", {}, convoTitle(c)), isLive ? h("span", { class: "chip live" }, id.chat.liveTag) : null),
          h("span", { class: "cv-prev" }, preview(c)),
        ),
        h("span", { class: "cv-side" }, h("span", { class: "cv-time" }, c.msgs.length || c.lastTs ? listTime(c.lastTs, nowTs) : ""), c.unread > 0 ? h("span", { class: "unread", "data-testid": "convo-unread", "aria-label": id.tabs.chat + ". " + id.chat.tabUnread(c.unread) }, c.unread > 99 ? "99+" : c.unread) : null),
      );
    });
    const myName = this.d.myName();
    return h(
      "div",
      { class: "chatlist" },
      h(
        "div",
        { class: "cl-head" },
        h("h1", {}, id.chat.title),
        h("span", { class: `pill${connected ? " ok" : ""}`, role: "status" }, h("span", { class: `dot ${connected ? "on" : "off"}`, "aria-hidden": "true" }), connected ? id.chat.connOnline : id.chat.connOffline),
        h("button", { type: "button", class: "me-btn", "aria-label": id.tabs.profile, "data-testid": "me-btn", onclick: this.d.toProfile }, avatar(myName || id.chat.me, 0, "md")),
      ),
      rows.length > 0
        ? h("div", { class: "cl-rows" }, rows)
        : h("div", { class: "cl-empty" }, h("h2", {}, id.chat.listEmptyTitle), h("p", { class: "hint" }, id.chat.listEmptyBody)),
      h("button", { type: "button", class: "fab", "data-testid": "fab", "aria-label": id.chat.newRoom, onclick: this.d.toGames }, icon("plus")),
    );
  }

  // ---------- percakapan ----------

  private subtitle(c: Convo): string {
    const live = this.d.live();
    const isLive = live?.room.groupId === c.groupId;
    if (kindOf(c) === "direct") {
      const other = otherMember(c);
      if (isLive && other) return live?.room.seats[other.seat]?.connected ? id.chat.online : id.chat.offline;
      return id.chat.lastSeen(`${dayLabel(c.lastTs, this.now()).toLowerCase()} ${fmtTime(c.lastTs)}`);
    }
    const names = c.members.map((m) => (m.seat === c.me ? id.chat.me : m.name)).join(", ");
    return `${id.chat.kindGroup} · ${names}`;
  }

  private renderHead(c: Convo): void {
    const head = this.head as HTMLElement;
    const live = this.d.live();
    const isLive = live?.room.groupId === c.groupId;
    const other = otherMember(c);
    clear(head);
    head.append(
      h("button", { type: "button", class: "th-back", "data-testid": "chat-back", "aria-label": id.chat.back, onclick: () => this.showList() }, icon("back")),
      kindOf(c) === "direct" && other ? avatar(other.name, other.seat, "md") : groupAvatar("md"),
      h("span", { class: "th-title" }, h("b", {}, convoTitle(c)), h("span", { class: "hint", "data-testid": "chat-sub" }, this.subtitle(c))),
    );
    if (isLive) head.append(h("button", { type: "button", class: "dice-btn", "data-testid": "to-table", "aria-label": id.chat.toTable, onclick: this.d.toRoom }, icon("room")));
  }

  private renderLog(c: Convo): void {
    const log = this.log as HTMLElement;
    const nowTs = this.now();
    const group = kindOf(c) === "group";
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    clear(log);
    if (c.msgs.length === 0) log.append(h("li", { class: "sys" }, id.chat.noMessages));
    let lastDay = -1;
    for (const m of c.msgs) {
      const day = dayStart(m.ts);
      if (day !== lastDay) {
        lastDay = day;
        log.append(h("li", { class: "daysep" }, h("span", {}, dayLabel(m.ts, nowTs))));
      }
      log.append(this.bubble(m, group));
    }
    if (stick || this.active) log.scrollTop = log.scrollHeight;
  }

  private bubble(m: StoredMsg, group: boolean): HTMLElement {
    if (m.kind === "sys") return h("li", { class: "sys" }, m.text);
    return h(
      "li",
      { class: m.mine ? "bub mine" : "bub" },
      !m.mine && group ? h("span", { class: `bub-name c${Math.abs(m.seat) % 6}` }, m.name) : null,
      h("span", { class: "bub-text" }, m.text),
      h("span", { class: "bub-time" }, fmtTime(m.ts)),
    );
  }

  private renderFoot(c: Convo): void {
    const foot = this.foot as HTMLElement;
    const live = this.d.live();
    const isLive = live?.room.groupId === c.groupId;
    const key = `${isLive}:${this.d.connected()}`;
    if (key === this.footKey) return;
    this.footKey = key;
    clear(foot);
    this.input = null;
    if (!isLive) {
      foot.append(h("div", { class: "th-off" }, h("p", { class: "hint" }, id.chat.notLive), h("button", { type: "button", class: "btn primary", "data-testid": "rejoin", onclick: () => this.d.rejoin(c.groupId) }, id.chat.rejoin)), h("p", { class: "hint center" }, id.chat.deviceNote));
      return;
    }
    const input = h("input", { class: "th-input", type: "text", maxlength: CHAT_MAX, placeholder: id.chat.placeholder, "aria-label": id.chat.placeholder, autocomplete: "off", "data-testid": "chat-input" });
    this.input = input;
    this.note = h("p", { class: "hint bad", role: "status" });
    this.tray = h("div", { class: "emoji-tray", hidden: true, role: "group", "aria-label": id.chat.emoji }, id.chat.emojis.map((e) => h("button", { type: "button", class: "emoji", onclick: () => { input.value += e; input.focus(); } }, e)));
    foot.append(
      this.note,
      this.tray,
      h(
        "form",
        {
          class: "composer",
          onsubmit: (ev: Event) => {
            ev.preventDefault();
            this.submit();
          },
        },
        h("button", { type: "button", class: "dice-btn", "aria-label": id.chat.toTable, onclick: this.d.toRoom }, icon("room")),
        h("button", { type: "button", class: "ic-btn", "aria-label": id.chat.emoji, "data-testid": "emoji-toggle", onclick: () => { const t = this.tray as HTMLElement; t.hidden = !t.hidden; } }, icon("smile")),
        input,
        h("button", { type: "submit", class: "send-btn", "data-testid": "chat-send", "aria-label": id.chat.send }, icon("send")),
      ),
    );
  }

  private submit(): void {
    const text = cleanText(this.input?.value ?? "");
    if (!text || !this.input) return;
    if (text.length > CHAT_MAX) {
      (this.note as HTMLElement).textContent = id.chat.tooLong;
      return;
    }
    if (!this.limiter.tryAcquire(this.now())) {
      (this.note as HTMLElement).textContent = id.chat.tooFast;
      return;
    }
    (this.note as HTMLElement).textContent = "";
    if (this.d.send(text)) this.input.value = "";
  }

  private scrollEnd(): void {
    if (this.log) this.log.scrollTop = this.log.scrollHeight;
  }
}
