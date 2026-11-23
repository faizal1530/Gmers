import { id } from "../i18n/id";
import { clear, h } from "../dom";
import { CHAT_MAX, ChatLimiter, cleanText } from "../logic";

export interface ChatLine {
  seat: number;
  name: string;
  text: string;
  mine: boolean;
}

/** Panel chat sebagai lapisan yang bisa dibuka dan ditutup; tidak menutupi meja saat tertutup. Semua teks lewat node teks. */
export class ChatPanel {
  readonly button: HTMLButtonElement;
  readonly sheet: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly badge: HTMLElement;
  private lines: ChatLine[] = [];
  private unread = 0;
  private isOpen = false;
  private readonly limiter = new ChatLimiter();

  constructor(
    private readonly send: (text: string) => boolean,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.badge = h("span", { class: "badge", hidden: true, "aria-hidden": "true" });
    this.button = h("button", { class: "icon-btn", type: "button", "data-testid": "chat-toggle", "aria-expanded": "false", "aria-controls": "chat-panel", onclick: () => this.setOpen(!this.isOpen) }, h("span", { class: "icon-label" }, id.chat.title), this.badge);
    this.button.setAttribute("aria-label", id.chat.open);
    this.list = h("ul", { class: "chat-log", "aria-live": "polite", "data-testid": "chat-log" });
    this.input = h("input", { class: "input", type: "text", maxlength: CHAT_MAX, placeholder: id.chat.placeholder, "aria-label": id.chat.placeholder, autocomplete: "off", "data-testid": "chat-input" });
    this.note = h("p", { class: "hint bad", role: "status" });
    this.sheet = h(
      "section",
      { class: "chat", id: "chat-panel", role: "dialog", "aria-label": id.chat.title, hidden: true },
      h("div", { class: "chat-head" }, h("strong", {}, id.chat.title), h("button", { class: "btn small", type: "button", "aria-label": id.chat.close, onclick: () => this.setOpen(false) }, id.chat.close)),
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
    this.renderLog();
    this.renderBadge();
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
    if (!this.isOpen && !line.mine) this.unread++;
    this.renderLog();
    this.renderBadge();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.sheet.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
    if (open) {
      this.unread = 0;
      this.renderBadge();
      this.input.focus();
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  get open(): boolean {
    return this.isOpen;
  }

  get unreadCount(): number {
    return this.unread;
  }

  reset(): void {
    this.lines = [];
    this.unread = 0;
    this.setOpen(false);
    this.renderLog();
    this.renderBadge();
  }

  private renderBadge(): void {
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
    this.button.setAttribute("aria-label", this.unread > 0 ? `${id.chat.open}. ${id.chat.unread(this.unread)}` : id.chat.open);
  }

  private renderLog(): void {
    clear(this.list);
    if (this.lines.length === 0) {
      this.list.appendChild(h("li", { class: "muted" }, id.chat.empty));
      return;
    }
    for (const l of this.lines) {
      this.list.appendChild(h("li", { class: l.mine ? "msg mine" : "msg" }, h("strong", {}, l.name), ": ", l.text));
    }
    this.list.scrollTop = this.list.scrollHeight;
  }
}
