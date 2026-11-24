import type { Card } from "@gmers/game-engine";
import type { ClientMessage, ServerMessage, StateMessage } from "@gmers/server/protocol";
import { Api, type AccountInfo } from "./api";
import { clear, h } from "./dom";
import { id } from "./i18n/id";
import { cardKey, checkName, isMyTurn, parseRoute, secondsLeft, type Route } from "./logic";
import { GameClient, type ConnStatus, type SocketLike } from "./net";
import { SoundPlayer, haptic, type SoundLike } from "./sound";
import { Identity, createKV, randomToken, type KV } from "./storage";
import { applyTheme, readTheme, type ThemeMode } from "./theme";
import { ChatStore, type StoredMsg } from "./chatstore";
import { ChatHub } from "./views/chathub";
import { gamesView } from "./views/games";
import { lobbyView } from "./views/lobby";
import { errorView, notFoundView, privacyView } from "./views/misc";
import { tabBar, type Tab } from "./views/nav";
import { profileView } from "./views/profile";
import { resultView } from "./views/result";
import { tableView, type LastMove } from "./views/table";
import { nameForm } from "./views/forms";

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
  sound?: SoundLike;
  fetch?: ConstructorParameters<typeof Api>[1];
  /** Muat ulang halaman (dipakai saat identitas berganti). Uji mengganti ini. */
  reload?: () => void;
}

const NUDGE_COOLDOWN_MS = 10_000;

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

const cardText = (c: Card): string => `${c[0]}|${c[1]}`;

/** Langkah terakhir dari selisih dua state berurutan (untuk catatan di meja dan animasi). */
export function describeLastMove(prev: StateMessage | null, next: StateMessage): { kind: "open" | "play" | "pass"; seat: number; name: string; card?: Card; side?: "left" | "right" } | null {
  if (!prev?.game || !next.game) return null;
  if (prev.room.id !== next.room.id || prev.room.gameNo !== next.room.gameNo) return null;
  if (next.game.moveCount <= prev.game.moveCount) return null;
  const seat = prev.game.turn;
  const name = next.room.seats[seat]?.name ?? "";
  const pb = prev.game.board;
  const nb = next.game.board;
  if (nb.length <= pb.length) return { kind: "pass", seat, name };
  if (pb.length === 0) return { kind: "open", seat, name, card: nb[0] as Card, side: "left" };
  const leftChanged = (nb[0] as Card)[0] !== (pb[0] as Card)[0] || (nb[0] as Card)[1] !== (pb[0] as Card)[1];
  return leftChanged ? { kind: "play", seat, name, card: nb[0] as Card, side: "left" } : { kind: "play", seat, name, card: nb[nb.length - 1] as Card, side: "right" };
}

export class App {
  private readonly kv: KV;
  private readonly identity: Identity;
  private readonly store: ChatStore;
  private readonly hub: ChatHub;
  private readonly sound: SoundLike;
  private readonly api: Api;
  private account: { username: string } | null = null;
  private client: GameClient | null = null;
  private route: Route = { kind: "home" };
  private tab: Tab = "games";
  private theme: ThemeMode = "auto";
  private intent: Intent = { kind: "none" };
  private room: StateMessage | null = null;
  private info: GroupInfo | null = null;
  private notice: string | null = null;
  private fatal: { message: string; retry: boolean } | null = null;
  private busy = false;
  private replaced = false;
  private linkMissing = false;
  private pendingCard: Card | null = null;
  private lastMove: LastMove | null = null;
  private clockOffset = 0;
  private turnTotalMs = 60_000;
  private nudgeUntil = 0;
  private status: ConnStatus = "connecting";
  private lastKey = "";
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  private readonly header: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly main: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly copy: (text: string) => Promise<boolean>;
  private readonly origin: string;
  private readonly wsUrl: string;

  constructor(private readonly deps: AppDeps) {
    this.kv = deps.kv ?? createKV();
    this.identity = new Identity(this.kv);
    this.sound = deps.sound ?? new SoundPlayer(this.kv);
    this.api = new Api(() => this.identity.session(), deps.fetch);
    this.copy = deps.copy ?? defaultCopy;
    this.origin = deps.origin ?? window.location.origin;
    this.wsUrl = deps.wsUrl ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    this.store = new ChatStore(this.kv);
    this.hub = new ChatHub({
      store: this.store,
      send: (text) => this.sendMsg({ type: "chat", text }),
      live: () => this.room,
      connected: () => this.status === "open",
      myName: () => this.identity.name() ?? "",
      rejoin: (groupId) => this.openGroup(groupId),
      toRoom: () => this.selectTab("room"),
      toGames: () => this.selectTab("games"),
      toProfile: () => this.selectTab("profile"),
      isGuest: () => this.account === null,
      onUnread: () => this.renderNav(),
    });
    this.header = h("header", { class: "top" });
    this.banner = h("div", { class: "banner", role: "status", "aria-live": "polite", hidden: true, "data-testid": "banner" });
    this.main = h("main", { class: "main", id: "utama", tabindex: "-1" });
    this.nav = h("div", { class: "navwrap" });
    this.toast = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
    deps.root.append(this.header, this.banner, this.main, this.nav, this.toast);
  }

  start(): void {
    this.theme = readTheme(this.kv);
    applyTheme(this.theme);
    this.route = parseRoute(window.location.pathname);
    // Kebijakan putar-otomatis peramban: buka kunci audio pada gestur pertama.
    const unlock = (): void => this.sound.unlock();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    this.tick = setInterval(() => this.updateTimer(), 250);
    window.addEventListener("popstate", () => {
      this.route = parseRoute(window.location.pathname);
      this.render(true);
    });
    const session = this.identity.session();
    if (!session) {
      this.afterBoot();
      return;
    }
    // Sudah pernah masuk: tetap masuk sampai pengguna sendiri memilih keluar.
    const cached = this.identity.cachedAccount();
    if (cached) this.account = { username: cached.username };
    this.render(true);
    void this.api.me().then((r) => {
      if (r.ok) this.applyAccount(r.data.account);
      else if (r.status === 401) {
        // Sesi dicabut (admin reset atau kata sandi diganti di perangkat lain).
        this.identity.setSession(null);
        this.identity.setCachedAccount(null);
        this.account = null;
      } // galat jaringan atau server: tetap masuk dengan data yang tersimpan
      this.afterBoot();
    });
  }

  private afterBoot(): void {
    if (this.route.kind === "link") {
      this.tab = "room";
      this.intent = { kind: "open", groupId: this.route.groupId };
      this.ensureClient();
    } else if (this.route.kind === "privacy") {
      this.tab = "profile";
    }
    this.render(true);
  }

  /** Terapkan data akun dari server. Mengembalikan true bila identitas room berganti. */
  private applyAccount(acc: AccountInfo): boolean {
    const changed = this.identity.token() !== acc.token;
    if (changed) this.identity.setToken(acc.token);
    this.identity.setName(acc.name);
    this.identity.setCachedAccount({ username: acc.username, name: acc.name });
    this.account = { username: acc.username };
    if (acc.prefs.theme) {
      this.theme = acc.prefs.theme;
      applyTheme(this.theme, this.kv);
    }
    if (acc.prefs.sound !== undefined) this.sound.setEnabled(acc.prefs.sound);
    for (const g of acc.groups) this.store.ensureStub(g.groupId, g.ts);
    this.hub.refresh();
    this.renderNav();
    return changed;
  }

  private reload(): void {
    (this.deps.reload ?? (() => window.location.reload()))();
  }

  private async doRegister(username: string, password: string): Promise<string | null> {
    const nm = checkName(this.identity.name() ?? "");
    const r = await this.api.register({ username: username.trim(), password, name: nm.ok ? nm.name : undefined, token: this.identity.token() });
    if (!r.ok) return r.message;
    this.identity.setSession(r.data.session);
    const changed = this.applyAccount(r.data.account);
    this.showToast(id.account.created);
    if (changed && this.client) this.reload();
    this.render(true);
    return null;
  }

  private async doLogin(username: string, password: string): Promise<string | null> {
    const r = await this.api.login({ username: username.trim(), password });
    if (!r.ok) return r.message;
    this.identity.setSession(r.data.session);
    const changed = this.applyAccount(r.data.account);
    this.showToast(id.account.welcome(r.data.account.name));
    if (changed && (this.client || this.room)) this.reload();
    this.render(true);
    return null;
  }

  /** Bersihkan data akun dari perangkat ini dan jadi tamu baru (identitas room baru). */
  private async leaveAccount(): Promise<void> {
    this.identity.setSession(null);
    this.identity.setCachedAccount(null);
    this.identity.setToken(randomToken());
    this.account = null;
    this.store.clear();
    this.reload();
  }

  private async doLogout(): Promise<void> {
    await this.api.logout();
    await this.leaveAccount();
  }

  private async doDelete(password: string): Promise<string | null> {
    const r = await this.api.deleteAccount({ password });
    if (!r.ok) return r.message;
    await this.leaveAccount();
    return null;
  }

  private async doChangePassword(oldPassword: string, newPassword: string): Promise<string | null> {
    if (newPassword.length < 8) return id.account.pwShort;
    const r = await this.api.changePassword({ oldPassword, newPassword });
    return r.ok ? null : r.message;
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
        this.hub.refresh();
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
        this.onState(m);
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
      case "chat": {
        const mine = this.room ? m.seat === this.room.you.seat : false;
        this.storeMsg({ kind: "msg", seat: m.seat, name: m.name, text: m.text, ts: m.ts, mine });
        if (!mine) this.sound.play("chat");
        return;
      }
      case "nudge":
        this.sound.play("nudge");
        haptic(this.sound, [60, 40, 60]);
        this.showToast(id.table.nudged(m.fromName));
        return;
      case "nudge_ack":
        this.nudgeUntil = Date.now() + NUDGE_COOLDOWN_MS;
        this.sound.play("nudge");
        this.showToast(id.table.nudgeSent(m.name));
        this.render(false);
        return;
      case "left":
        this.room = null;
        this.lastMove = null;
        this.hub.refresh();
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

  private onState(m: StateMessage): void {
    const prev = this.room;
    const joinedNow = prev === null;
    this.room = m;
    this.clockOffset = m.now - Date.now();
    this.busy = false;
    this.notice = null;
    this.fatal = null;
    this.intent = { kind: "join", groupId: m.room.groupId, name: this.identity.name() ?? m.room.seats[m.you.seat]?.name ?? "Pemain" };
    if (window.location.pathname !== `/g/${m.room.groupId}`) window.history.replaceState(null, "", `/g/${m.room.groupId}`);
    this.route = { kind: "link", groupId: m.room.groupId };
    if (joinedNow) this.tab = "room";
    this.recordConversation(prev, m);

    // Suara dan catatan langkah dari selisih state.
    const move = describeLastMove(prev, m);
    const phaseNow = m.room.phase;
    const newGame = !!prev && phaseNow === "playing" && (prev.room.phase !== "playing" || prev.room.gameNo !== m.room.gameNo);
    if (newGame) {
      this.lastMove = null;
      this.sound.play("start");
      this.addSys(m, id.chat.sysStart);
    } else if (move) {
      this.lastMove = {
        side: move.kind === "pass" ? null : (move.side ?? null),
        text: move.kind === "pass" ? id.table.lastPass(move.name) : move.kind === "open" ? id.table.lastOpen(move.name, cardText(move.card as Card)) : id.table.lastPlay(move.name, cardText(move.card as Card), move.side as "left" | "right"),
      };
      this.sound.play(move.kind === "pass" ? "pass" : "place");
      if (phaseNow === "playing" && isMyTurn(m) && !(prev && isMyTurn(prev))) {
        setTimeout(() => this.sound.play("turn"), 220);
        haptic(this.sound, 30);
      }
    } else if (phaseNow === "playing" && prev && isMyTurn(m) && !isMyTurn(prev)) {
      setTimeout(() => this.sound.play("turn"), 50);
    }
    if (prev && prev.room.phase !== "finished" && phaseNow === "finished" && m.game?.result) {
      const won = m.game.result.winner === m.you.seat;
      this.addSys(m, id.chat.sysFinish(m.room.seats[m.game.result.winner]?.name ?? ""));
      setTimeout(() => this.sound.play(won ? "win" : "lose"), 350);
    }
    if (m.game && (!prev?.game || prev.game.moveCount !== m.game.moveCount || prev.room.gameNo !== m.room.gameNo) && m.game.turnDeadline !== null) {
      this.turnTotalMs = Math.max(1000, m.game.turnDeadline - m.now);
    }
    this.hub.refresh();
    this.render(false);
  }

  /** Simpan percakapan di perangkat: anggota terbaru, pesan sistem (bergabung, keluar). */
  private recordConversation(prev: StateMessage | null, m: StateMessage): void {
    const gid = m.room.groupId;
    const members = m.room.seats.flatMap((s, i) => (s ? [{ seat: i, name: s.name }] : []));
    const existed = !!this.store.get(gid);
    this.store.ensure(gid, m.you.seat, members);
    if (!existed) this.addSys(m, id.chat.roomCreated(m.room.seats[m.room.hostSeat]?.name ?? ""));
    if (prev && prev.room.id === m.room.id) {
      m.room.seats.forEach((after, i) => {
        const before = prev.room.seats[i];
        if (!before && after && !after.isYou) this.addSys(m, id.chat.sysJoined(after.name));
        if (before && !after) this.addSys(m, id.chat.sysLeft(before.name));
      });
    }
  }

  private addSys(m: StateMessage, text: string): void {
    this.store.add(m.room.groupId, { kind: "sys", seat: -1, name: "", text, ts: m.now, mine: false }, false);
  }

  private storeMsg(msg: StoredMsg): void {
    const room = this.room;
    if (!room) return;
    const gid = room.room.groupId;
    this.store.ensure(gid, room.you.seat, room.room.seats.flatMap((s, i) => (s ? [{ seat: i, name: s.name }] : [])));
    const viewing = this.hub.isViewing(gid);
    this.store.add(gid, msg, !viewing);
    if (viewing) this.store.markRead(gid);
    this.hub.refresh();
    this.renderNav();
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
    this.sound.play("error");
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

  /** Buka kelompok dari tautan atau kode yang ditempel. */
  private openGroup(groupId: string): void {
    this.info = null;
    this.notice = null;
    this.linkMissing = false;
    this.intent = { kind: "open", groupId };
    this.route = { kind: "link", groupId };
    this.tab = "room";
    window.history.pushState(null, "", `/g/${groupId}`);
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

  private nudge(): void {
    if (Date.now() < this.nudgeUntil) return;
    this.sendMsg({ type: "nudge" });
  }

  private selectTab(t: Tab): void {
    if (this.route.kind === "privacy") {
      this.route = this.room ? { kind: "link", groupId: this.room.room.groupId } : { kind: "home" };
      window.history.pushState(null, "", this.room ? `/g/${this.room.room.groupId}` : "/");
    }
    this.tab = t;
    if (t === "chat") this.hub.showList();
    this.hub.setActive(t === "chat");
    this.render(true);
  }

  private goHome(): void {
    this.client?.stop();
    this.client = null;
    this.room = null;
    this.info = null;
    this.intent = { kind: "none" };
    this.linkMissing = false;
    this.replaced = false;
    this.lastMove = null;
    this.hub.showList();
    window.history.pushState(null, "", "/");
    this.route = { kind: "home" };
    this.tab = "games";
    this.render(true);
  }

  private openPrivacy(): void {
    window.history.pushState(null, "", "/privasi");
    this.route = { kind: "privacy" };
    this.tab = "profile";
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
    const g = this.room?.game;
    const el = this.main.querySelector<HTMLElement>("#timer");
    if (el && g && this.room?.room.phase === "playing") {
      const left = secondsLeft(g.turnDeadline, Date.now() + this.clockOffset);
      el.textContent = left === null ? "" : id.table.secondsLeft(left);
      const fill = this.main.querySelector<HTMLElement>("#timefill");
      if (fill && g.turnDeadline !== null) {
        const ratio = Math.max(0, Math.min(1, (g.turnDeadline - (Date.now() + this.clockOffset)) / this.turnTotalMs));
        fill.style.width = `${Math.round(ratio * 100)}%`;
        fill.classList.toggle("low", ratio < 0.25);
      }
    }
    const nudge = this.main.querySelector<HTMLButtonElement>("#nudge");
    if (nudge) {
      const cooling = Date.now() < this.nudgeUntil;
      nudge.disabled = cooling || this.status !== "open";
      if (!cooling && nudge.textContent === id.table.nudgeWait) {
        nudge.textContent = id.table.nudge(this.room?.room.seats[this.room.game?.turn ?? 0]?.name ?? "");
      }
    }
  }

  private renderHeader(): void {
    clear(this.header);
    // Tab Chat punya judul sendiri (seperti mockup), jadi header aplikasi disembunyikan di sana.
    this.header.hidden = this.tab === "chat" && this.route.kind !== "privacy";
    this.header.append(
      h("a", { class: "brand", href: "/", onclick: (e: Event) => { e.preventDefault(); this.selectTab("games"); } }, id.appName),
    );
    if (this.room) this.header.append(h("span", { class: "code", "data-testid": "group-code" }, this.room.room.groupId));
  }

  private renderNav(): void {
    clear(this.nav);
    this.nav.append(tabBar(this.tab, this.store.totalUnread(), (t) => this.selectTab(t)));
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
    if (this.route.kind === "privacy") return "privacy";
    if (this.route.kind === "notfound") return "notfound";
    switch (this.tab) {
      case "games":
        return `games:${this.busy}:${this.room?.room.groupId ?? ""}`;
      case "room": {
        if (this.room) return "room";
        const i = this.info;
        return this.route.kind === "link" ? `link:${this.busy}:${this.notice ?? ""}:${i ? `${i.phase}/${i.players}/${i.isMember}` : "loading"}` : "roomempty";
      }
      case "chat":
        return "chat";
      case "profile":
        return `profile:${this.theme}:${this.sound.enabled}:${this.identity.name() ?? ""}:${this.account?.username ?? ""}`;
    }
  }

  render(force: boolean): void {
    this.renderHeader();
    this.renderBanner();
    this.renderNav();
    const key = this.screenKey();
    if (!force && key === this.lastKey && key !== "room") return;
    this.lastKey = key;
    clear(this.main);
    this.main.classList.toggle("stale", !!this.room && this.status !== "open");
    this.main.append(this.buildScreen());
    this.updateTimer();
  }

  private buildScreen(): HTMLElement {
    if (this.fatal) return errorView(this.fatal.message, null, () => this.goHome());
    if (this.linkMissing) return notFoundView("link", () => this.goHome());
    if (this.route.kind === "privacy") return privacyView(() => this.selectTab("profile"));
    if (this.route.kind === "notfound") return notFoundView("page", () => this.goHome());
    switch (this.tab) {
      case "games":
        return gamesView({
          initialName: this.identity.name() ?? "",
          busy: this.busy,
          roomCode: this.room?.room.groupId ?? null,
          onCreate: (n) => this.create(n),
          onBackToRoom: () => this.selectTab("room"),
        });
      case "room":
        if (this.room) return this.buildRoom(this.room);
        return this.route.kind === "link" ? this.buildLink() : this.buildRoomEmpty();
      case "chat":
        return this.hub.view;
      case "profile":
        return profileView({
          account: {
            username: this.account?.username ?? null,
            onRegister: (u, p) => this.doRegister(u, p),
            onLogin: (u, p) => this.doLogin(u, p),
            onLogout: () => void this.doLogout(),
            onChangePassword: (o, n) => this.doChangePassword(o, n),
            onDelete: (p) => this.doDelete(p),
          },
          name: this.identity.name() ?? "",
          theme: this.theme,
          soundOn: this.sound.enabled,
          onSaveName: (n) => {
            this.identity.setName(n);
            if (this.account) void this.api.updateProfile({ name: n });
          },
          onClearChats: () => {
            this.store.clear();
            this.hub.showList();
            this.renderNav();
            this.showToast(id.profile.clearedChats);
          },
          onTheme: (mode) => {
            this.theme = mode;
            applyTheme(mode, this.kv);
            if (this.account) void this.api.updateProfile({ prefs: { theme: mode } });
            this.render(true);
          },
          onSound: (on) => {
            this.sound.setEnabled(on);
            if (this.account) void this.api.updateProfile({ prefs: { sound: on } });
            if (on) this.sound.play("turn");
            this.render(true);
          },
          onPrivacy: () => this.openPrivacy(),
        });
    }
  }

  private buildRoomEmpty(): HTMLElement {
    const input = h("input", { id: "tempel", class: "input", type: "text", placeholder: id.roomTab.pastePlaceholder, autocomplete: "off", autocapitalize: "off", "aria-label": id.roomTab.pasteLabel });
    const hint = h("p", { class: "hint", role: "status", "aria-live": "polite" });
    return h(
      "section",
      { class: "stack" },
      h("div", { class: "panel center" }, h("h1", {}, id.roomTab.emptyTitle), h("p", {}, id.roomTab.emptyBody), h("button", { class: "btn primary", type: "button", onclick: () => this.selectTab("games") }, id.roomTab.toGames)),
      h(
        "form",
        {
          class: "panel form",
          novalidate: true,
          onsubmit: (ev: Event) => {
            ev.preventDefault();
            const code = parsePasted(input.value);
            if (!code) {
              hint.textContent = id.roomTab.pasteBad;
              hint.classList.add("bad");
              return;
            }
            this.openGroup(code);
          },
        },
        h("label", { for: "tempel", class: "label" }, id.roomTab.pasteLabel),
        input,
        hint,
        h("button", { class: "btn", type: "submit" }, id.roomTab.pasteGo),
      ),
    );
  }

  private buildLink(): HTMLElement {
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
      lastMove: this.lastMove,
      nudgeCooling: Date.now() < this.nudgeUntil,
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
      onNudge: () => this.nudge(),
    });
  }
}

/** Ambil kode kelompok dari tautan lengkap atau kode polos; null bila tidak dikenali. */
export function parsePasted(text: string): string | null {
  const t = text.trim();
  if (/^[A-Za-z0-9]{4,10}$/.test(t)) return t.toUpperCase();
  try {
    const r = parseRoute(new URL(t).pathname);
    return r.kind === "link" ? r.groupId : null;
  } catch {
    return null;
  }
}
