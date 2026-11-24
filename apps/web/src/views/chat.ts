import { id } from "../i18n/id";
import { clear, h } from "../dom";
import { CHAT_MAX, ChatLimiter, cleanText } from "../logic";
import { avatar } from "./avatar";

export interface ChatLine {
  seat: number;
  name: string;
  text: string;
  mine: boolean;
}

/** Chat sebagai isi tab. Riwayat bertahan selama room yang sama; semua teks lewat node teks (tanpa HTML). */
export class ChatPanel {
  readonly view: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  private lines: ChatLine[] = [];
  private unread = 0;
  private active = false;
  private readonly limiter = new ChatLimiter();

  constructor(
    private readonly send: (text: string) => boolean,
    private readonly onUnreadChange: () => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.head = h("div", { class: "chat-head" });
    this.list = h("ul", { class: "chat-log", "aria-live": "polite", "data-testid": "chat-log" });
    this.input = h("input", { class: "input", type: "text", maxlength: CHAT_MAX, placeholder: id.chat.placeholder, "aria-label": id.chat.placeholder, autocomplete: "off", "data-testid": "chat-input" });
    this.note = h("p", { class: "hint bad", role: "status" });
    this.view = h(
      "section",
      { class: "chat-view" },
      this.head,
      this.list,
      this.note,
      h(
        "form",
        {
          class: "chat-form",
          onsubmit: (ev: Event) => {
            ev.preventDefault();
            this.submit();
          },
        },
        this.input,
        h("button", { class: "btn primary", type: "submit", "data-testid": "chat-send" }, id.chat.send),
      ),
    );
    this.setHeader(null, 0);
    this.renderLog();
  }

  setHeader(groupId: string | null, members: number): void {
    clear(this.head);
    this.head.append(h("strong", {}, groupId ? id.chat.groupTitle(groupId) : id.chat.title));
    if (groupId) this.head.append(h("span", { class: "muted" }, id.chat.members(members)));
  }

  private submit(): void {
    const text = cleanText(this.input.value);
    if (!text) return;
    if (text.length > CHAT_MAX) {
      this.note.textContent = id.chat.tooLong;
      return;
    }
    if (!this.limiter.tryAcquire(this.now())) {
      this.note.textContent = id.chat.tooFast;
      return;
    }
    this.note.textContent = "";
    if (this.send(text)) this.input.value = "";
  }

  add(line: ChatLine): void {
    this.lines.push({ ...line, text: cleanText(line.text) });
    if (this.lines.length > 200) this.lines.shift();
    if (!this.active && !line.mine) {
      this.unread++;
      this.onUnreadChange();
    }
    this.renderLog();
  }

  /** Dipanggil saat tab Chat dibuka atau ditinggalkan. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      if (this.unread > 0) {
        this.unread = 0;
        this.onUnreadChange();
      }
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  focusInput(): void {
    this.input.focus();
  }

  get unreadCount(): number {
    return this.unread;
  }

  reset(): void {
    this.lines = [];
    this.unread = 0;
    this.setHeader(null, 0);
    this.renderLog();
    this.onUnreadChange();
  }

  private renderLog(): void {
    clear(this.list);
    if (this.lines.length === 0) {
      this.list.appendChild(h("li", { class: "muted center" }, id.chat.empty));
      return;
    }
    for (const l of this.lines) {
      this.list.appendChild(
        h("li", { class: l.mine ? "bubble mine" : "bubble" }, l.mine ? null : avatar(l.name, l.seat, "sm"), h("div", { class: "bubble-body" }, l.mine ? null : h("strong", {}, l.name), h("span", {}, l.text))),
      );
    }
    this.list.scrollTop = this.list.scrollHeight;
  }
}
