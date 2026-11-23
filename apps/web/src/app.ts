import type { Card } from "@gmers/game-engine";
import type { ClientMessage, ServerMessage, StateMessage } from "@gmers/server/protocol";
import { clear, h } from "./dom";
import { id } from "./i18n/id";
import { cardKey, isMyTurn, parseRoute, secondsLeft, type Route } from "./logic";
import { GameClient, type ConnStatus, type SocketLike } from "./net";
import { Identity, createKV, type KV } from "./storage";
import { ChatPanel } from "./views/chat";
import { nameForm } from "./views/forms";
import { lobbyView } from "./views/lobby";
import { errorView, notFoundView, privacyView } from "./views/misc";
import { resultView } from "./views/result";
import { tableView } from "./views/table";

type Intent =
  | { kind: "none" }
  | { kind: "create"; name: string }
  | { kind: "open"; groupId: string }
  | { kind: "join"; groupId: string; name: string };

type GroupInfo = Extract<ServerMessage, { type: "group_info" }>;

export interface AppDeps {
  root: HTMLElement;
  kv?: KV;
  makeSocket?: (url: string) => SocketLike;
  wsUrl?: string;
  copy?: (text: string) => Promise<boolean>;
  origin?: string;
}

async function defaultCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.className = "offscreen";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export class App {
  private readonly identity: Identity;
  private readonly chat: ChatPanel;
  private client: GameClient | null = null;
  private route: Route = { kind: "home" };
  private intent: Intent = { kind: "none" };
  private room: StateMessage | null = null;
  private info: GroupInfo | null = null;
  private notice: string | null = null;
  private fatal: { message: string; retry: boolean } | null = null;
  private busy = false;
  private replaced = false;
  private linkMissing = false;
  private pendingCard: Card | null = null;
  private clockOffset = 0;
  private status: ConnStatus = "connecting";
  private lastKey = "";
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  private readonly header: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly main: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly copy: (text: string) => Promise<boolean>;
  private readonly origin: string;
  private readonly wsUrl: string;

  constructor(private readonly deps: AppDeps) {
    this.identity = new Identity(deps.kv ?? createKV());
    this.copy = deps.copy ?? defaultCopy;
    this.origin = deps.origin ?? window.location.origin;
    this.wsUrl = deps.wsUrl ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    this.chat = new ChatPanel((text) => this.sendMsg({ type: "chat", text }));
    this.header = h("header", { class: "top" });
    this.banner = h("div", { class: "banner", role: "status", "aria-live": "polite", hidden: true, "data-testid": "banner" });
    this.main = h("main", { class: "main", id: "utama", tabindex: "-1" });
    this.toast = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
    deps.root.append(this.header, this.banner, this.main, this.toast, this.chat.sheet);
  }

  start(): void {
    this.route = parseRoute(window.location.pathname);
    if (this.route.kind === "link") {
      this.intent = { kind: "open", groupId: this.route.groupId };
      this.ensureClient();
    }
    this.tick = setInterval(() => this.updateTimer(), 250);
    window.addEventListener("popstate", () => {
      this.route = parseRoute(window.location.pathname);
      this.render(true);
    });
    this.render(true);
  }

  stop(): void {
    this.client?.stop();
    if (this.tick) clearInterval(this.tick);
  }

  // ---------- jaringan ----------

  private ensureClient(): GameClient {
    if (this.client) return this.client;
    this.client = new GameClient({
      url: this.wsUrl,
      makeSocket: this.deps.makeSocket,
      onOpenMessages: () => this.openMessages(),
      onMessage: (m) => this.onMessage(m),
      onStatus: (s) => {
        this.status = s;
        this.render(false);
      },
    });
    this.client.start();
    return this.client;
  }

  private openMessages(): ClientMessage[] {
    const token = this.identity.token();
    const i = this.intent;
    if (i.kind === "create") return [{ type: "create_room", name: i.name, token }];
    if (i.kind === "open") return [{ type: "open_link", groupId: i.groupId, token }];
    if (i.kind === "join") return [{ type: "join", groupId: i.groupId, name: i.name, token }];
    return [];
  }

  private flush(): void {
    this.ensureClient();
    if (this.client?.isOpen) for (const m of this.openMessages()) this.client.send(m);
  }

  private sendMsg(msg: ClientMessage): boolean {
    return this.client?.send(msg) ?? false;
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case "state":
        this.room = m;
        this.clockOffset = m.now - Date.now();
        this.busy = false;
        this.notice = null;
        this.fatal = null;
        this.intent = { kind: "join", groupId: m.room.groupId, name: this.identity.name() ?? m.room.seats[m.you.seat]?.name ?? "Pemain" };
        if (window.location.pathname !== `/g/${m.room.groupId}`) window.history.replaceState(null, "", `/g/${m.room.groupId}`);
        this.route = { kind: "link", groupId: m.room.groupId };
        this.render(false);
        return;
      case "group_info":
        this.info = m;
        this.busy = false;
        if (m.isMember) {
          this.intent = { kind: "join", groupId: m.groupId, name: this.identity.name() ?? "Pemain" };
          this.flush();
        }
        this.render(false);
        return;
      case "chat":
        this.chat.add({ seat: m.seat, name: m.name, text: m.text, mine: this.room ? m.seat === this.room.you.seat : false });
        return;
      case "left":
        this.room = null;
        this.chat.reset();
        this.info = null;
        if (this.route.kind === "link") this.intent = { kind: "open", groupId: this.route.groupId };
        this.flush();
        this.render(false);
        return;
      case "error":
        this.onError(m.code, m.message);
        return;
      case "pong":
        return;
    }
  }

  private onError(code: string, message: string): void {
    this.busy = false;
    if (code === "ROOM_NOT_FOUND") {
      this.linkMissing = true;
      this.render(false);
      return;
    }
    if (code === "REPLACED") {
      this.replaced = true;
      this.client?.stop();
      this.render(false);
      return;
    }
    if ((code === "ROOM_FULL" || code === "GAME_IN_PROGRESS" || code === "SEAT_TAKEN") && !this.room) {
      this.notice = message;
      if (this.route.kind === "link") {
        this.intent = { kind: "open", groupId: this.route.groupId };
        this.flush();
      }
      this.render(false);
      return;
    }
    if (code === "BAD_MESSAGE" && this.intent.kind === "create") {
      this.fatal = { message, retry: false };
      this.render(false);
      return;
    }
    this.showToast(message);
    this.render(false);
  }

  // ---------- aksi ----------

  private create(name: string): void {
    this.identity.setName(name);
    this.busy = true;
    this.intent = { kind: "create", name };
    this.render(true);
    this.flush();
  }

  private joinWith(name: string): void {
    if (this.route.kind !== "link") return;
    this.identity.setName(name);
    this.busy = true;
    this.notice = null;
    this.intent = { kind: "join", groupId: this.route.groupId, name };
    this.render(true);
    this.flush();
  }

  private play(card: Card, end: "left" | "right"): void {
    // Hanya langkah yang ada di yourMoves milik server yang boleh dikirim.
    const s = this.room;
    const ok = !!s?.game?.yourMoves.some((m) => m.type === "play" && cardKey(m.card) === cardKey(card) && m.end === end);
    this.pendingCard = null;
    if (!ok || !s || !isMyTurn(s)) {
      this.render(false);
      return;
    }
    this.sendMsg({ type: "play", card, end });
    this.render(false); // tutup pilihan ujung; state baru datang dari server
  }

  private pass(): void {
    const s = this.room;
    if (!s?.game?.yourMoves.some((m) => m.type === "pass") || !isMyTurn(s)) return;
    this.sendMsg({ type: "pass" });
  }

  private goHome(): void {
    this.client?.stop();
    this.client = null;
    this.room = null;
    this.info = null;
    this.intent = { kind: "none" };
    this.linkMissing = false;
    this.replaced = false;
    this.chat.reset();
    window.history.pushState(null, "", "/");
    this.route = { kind: "home" };
    this.render(true);
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
    }, 4000);
  }

  // ---------- tampilan ----------

  private updateTimer(): void {
    const el = this.main.querySelector<HTMLElement>("#timer");
    const g = this.room?.game;
    if (!el || !g || this.room?.room.phase !== "playing") return;
    const left = secondsLeft(g.turnDeadline, Date.now() + this.clockOffset);
    el.textContent = left === null ? "" : id.table.secondsLeft(left);
  }

  private renderHeader(): void {
    clear(this.header);
    this.header.append(h("a", { class: "brand", href: "/", onclick: (e: Event) => { e.preventDefault(); this.goHome(); } }, id.appName));
    if (this.room) this.header.append(h("span", { class: "code", "data-testid": "group-code" }, this.room.room.groupId), this.chat.button);
  }

  private renderBanner(): void {
    let text: string | null = null;
    let withReload = false;
    if (this.replaced) {
      text = id.conn.replaced;
      withReload = true;
    } else if (this.client && this.status !== "open") {
      text = typeof navigator !== "undefined" && navigator.onLine === false ? id.conn.offline : this.status === "connecting" && !this.room ? id.conn.connecting : id.conn.reconnecting;
    }
    clear(this.banner);
    this.banner.hidden = text === null;
    if (text !== null) {
      this.banner.append(text);
      if (withReload) this.banner.append(" ", h("button", { class: "btn small", type: "button", onclick: () => window.location.reload() }, id.conn.reload));
    }
  }

  private screenKey(): string {
    if (this.fatal) return `fatal:${this.fatal.message}`;
    if (this.linkMissing) return "notfound-link";
    if (this.room) return "room";
    if (this.route.kind === "home") return `home:${this.busy}`;
    if (this.route.kind === "privacy") return "privacy";
    if (this.route.kind === "notfound") return "notfound";
    const i = this.info;
    return `link:${this.busy}:${this.notice ?? ""}:${i ? `${i.phase}/${i.players}/${i.isMember}` : "loading"}`;
  }

  render(force: boolean): void {
    this.renderHeader();
    this.renderBanner();
    const key = this.screenKey();
    const formScreen = key.startsWith("home") || key.startsWith("link");
    if (!force && key === this.lastKey && formScreen) return;
    this.lastKey = key;
    clear(this.main);
    this.main.classList.toggle("stale", !!this.room && this.status !== "open");
    this.main.append(this.buildScreen(key));
    this.updateTimer();
  }

  private buildScreen(key: string): HTMLElement {
    if (this.fatal) return errorView(this.fatal.message, null, () => this.goHome());
    if (this.linkMissing) return notFoundView("link", () => this.goHome());
    if (this.room) return this.buildRoom(this.room);
    switch (this.route.kind) {
      case "home":
        return this.buildHome();
      case "privacy":
        return privacyView(() => this.goHome());
      case "notfound":
        return notFoundView("page", () => this.goHome());
      case "link":
        return this.buildLink(key);
    }
  }

  private buildHome(): HTMLElement {
    return h(
      "section",
      { class: "stack" },
      h("h1", {}, id.home.title),
      h("p", { class: "lead" }, id.tagline),
      h("div", { class: "panel" }, nameForm({ initial: this.identity.name() ?? "", submitLabel: this.busy ? id.home.creating : id.home.create, busy: this.busy, onSubmit: (n) => this.create(n) })),
      h("div", { class: "panel" }, h("h2", {}, id.home.howTitle), h("ol", {}, id.home.how.map((t) => h("li", {}, t)))),
      h("a", { class: "btn link", href: "/privasi", onclick: (e: Event) => { e.preventDefault(); window.history.pushState(null, "", "/privasi"); this.route = { kind: "privacy" }; this.render(true); } }, id.home.privacy),
    );
  }

  private buildLink(key: string): HTMLElement {
    const i = this.info;
    if (!i) return h("section", { class: "panel center", role: "status" }, h("p", {}, id.link.opening));
    const blocked = i.phase === "playing" ? id.link.playing : i.players >= i.maxSeats ? id.link.full : null;
    return h(
      "section",
      { class: "stack" },
      h("h1", {}, id.link.title),
      this.notice ? h("p", { class: "notice", role: "alert" }, this.notice) : null,
      blocked
        ? h(
            "div",
            { class: "panel" },
            h("p", { role: "alert" }, blocked),
            h("button", { class: "btn primary", type: "button", onclick: () => { this.info = null; this.notice = null; this.flush(); this.render(true); } }, id.link.retry),
          )
        : h("div", { class: "panel" }, nameForm({ initial: this.identity.name() ?? "", submitLabel: this.busy ? id.link.joining : id.link.join, busy: this.busy, onSubmit: (n) => this.joinWith(n) })),
      key ? null : null,
    );
  }

  private buildRoom(s: StateMessage): HTMLElement {
    const connected = this.status === "open";
    if (s.room.phase === "lobby") {
      return lobbyView(s, {
        origin: this.origin,
        onCopy: this.copy,
        onStart: () => this.sendMsg({ type: "start" }),
        onLeave: () => this.sendMsg({ type: "leave" }),
      });
    }
    if (s.room.phase === "finished") {
      return resultView(s, this.busy, () => {
        this.busy = true;
        this.sendMsg({ type: "rematch" });
        this.render(false);
      });
    }
    if (this.pendingCard && !(isMyTurn(s) && s.game?.yourHand.some((c) => cardKey(c) === cardKey(this.pendingCard as Card)))) this.pendingCard = null;
    return tableView(s, {
      connected,
      pendingCard: this.pendingCard,
      onPlay: (c, e) => this.play(c, e),
      onNeedEnd: (c) => {
        this.pendingCard = c;
        this.render(false);
      },
      onCancelEnd: () => {
        this.pendingCard = null;
        this.render(false);
      },
      onPass: () => this.pass(),
    });
  }
}
