import type { Card } from "@gmers/game-engine";
import type { ClientMessage, ServerMessage, StateMessage } from "@gmers/server/protocol";
import { Api, type AccountInfo, type FeedItem, type FeedTab, type FriendsData, type LiveRoom, type ReplyItem, type ShopData, type LeaderRow, type NoticeRow, type NotifPrefs, type StatusId, type UserCard, type WalletInfo } from "./api";
import { clear, h } from "./dom";
import { id } from "./i18n/id";
import { cardKey, checkName, isMyTurn, parseRoute, secondsLeft, type Route } from "./logic";
import { GameClient, type ConnStatus, type SocketLike } from "./net";
import { SoundPlayer, haptic, type SoundLike } from "./sound";
import { Identity, createKV, randomToken, type KV } from "./storage";
import { applyTheme, readTheme, type ThemeMode } from "./theme";
import { ChatStore, type InviteInfo, type StoredMsg } from "./chatstore";
import { ChatHub } from "./views/chathub";
import { communityView } from "./views/community";
import { friendsView } from "./views/friends";
import { liveListView } from "./views/live";
import { shopView } from "./views/shop";
import { gamesView } from "./views/games";
import { lobbyView } from "./views/lobby";
import { ludoView } from "./views/ludo";
import { errorView, notFoundView, privacyView } from "./views/misc";
import { tabBar, type Tab } from "./views/nav";
import { profileView } from "./views/profile";
import { leaderboardView, rankedCard, walletPanel, type QueueState } from "./views/ranked";
import { resultView } from "./views/result";
import { tableView, type LastMove } from "./views/table";
import { nameForm } from "./views/forms";

type Intent =
  | { kind: "none" }
  | { kind: "create"; name: string; game: "gaple" | "ludo" }
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

/** Langkah Ludo terakhir dari selisih dua state: lemparan dadu, bidak digerakkan, atau bidak dimakan. */
export function describeLudoMove(prev: StateMessage | null, next: StateMessage): { text: string; sound: "dice" | "capture" | "place" } | null {
  const pl = prev?.game?.ludo;
  const nl = next.game?.ludo;
  if (!prev?.game || !pl || !nl || !next.game) return null;
  if (prev.room.id !== next.room.id || prev.room.gameNo !== next.room.gameNo) return null;
  if (next.game.moveCount <= prev.game.moveCount) return null;
  const seat = prev.game.turn;
  const name = next.room.seats[seat]?.name ?? "";
  if (pl.dice === null) {
    // sebelumnya belum melempar: langkah itu adalah lemparan dadu
    const value = nl.lastRoll?.value ?? 0;
    const stuck = nl.dice === null;
    return { text: id.ludo.rolled(name, value) + (stuck ? ` · ${id.ludo.noMove}` : ""), sound: "dice" };
  }
  if (nl.lastCapture.length > 0) return { text: id.ludo.captured(name), sound: "capture" };
  const before = pl.players.find((p) => p.seat === seat)?.pawns ?? [];
  const after = nl.players.find((p) => p.seat === seat)?.pawns ?? [];
  const pawn = after.findIndex((p, i) => p !== before[i]);
  return { text: id.ludo.moved(name, pawn + 1), sound: "place" };
}

export class App {
  private readonly kv: KV;
  private readonly identity: Identity;
  private readonly store: ChatStore;
  private readonly hub: ChatHub;
  private readonly sound: SoundLike;
  private readonly api: Api;
  private account: { username: string } | null = null;
  private wallet: WalletInfo | null = null;
  private queue: QueueState = { state: "idle", game: null, since: null };
  private queueStartedAt = 0;
  private pendingQueue: "gaple" | "ludo" | null = null;
  private board: { rows: LeaderRow[]; you: { rank: number | null } } | null = null;
  private section: "main" | "komunitas" | "live" | "toko" = "main";
  private ver = 0;
  private comm = {
    tab: "untukmu" as FeedTab,
    comm: null as string | null,
    items: null as FeedItem[] | null,
    next: null as number | null,
    suggestions: [] as { username: string; name: string }[],
    failed: false,
    posting: false,
    draft: "",
    replyDraft: "",
    thread: null as { post: FeedItem; replies: ReplyItem[] } | null,
  };
  private shopData: ShopData | null = null;
  private shopFailed = false;
  private shopBusy = false;
  private liveRooms: LiveRoom[] | null = null;
  private liveFailed = false;
  private spectate: { key: string; delayMs: number; state: StateMessage | null; ended: string | null; chat: { name: string; text: string; ts: number }[]; draft: string } | null = null;
  private friends: FriendsData | null = null;
  private friendsFailed = false;
  private friendsOpen = false;
  private friendsVer = 0;
  private searchDraft = "";
  private found: { card: UserCard } | { error: string } | null = null;
  private notices: NoticeRow[] = [];
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
      extraEmojis: () => this.ownedEmojis(),
      sendDm: (u, t) => this.sendDm(u, t),
      isFriend: (u) => this.friends === null || this.friends.friends.some((f) => f.username === u),
      onInviteFriend: (u) => this.inviteFriend(u),
      onInviteReply: (inv, reply) => this.replyInvite(inv, reply),
      onFriends: () => this.openFriends(),
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
      if (r.ok) {
        this.applyAccount(r.data.account, r.data.wallet ?? null);
        void this.refreshBoard();
      }
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
  private applyAccount(acc: AccountInfo, wallet: WalletInfo | null): boolean {
    this.wallet = wallet;
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
    void this.loadFriends();
    void this.loadShop();
    const hadClient = this.client !== null;
    this.ensureClient(); // tersambung agar pesan teman dan ajakan bisa diterima
    // Koneksi yang sudah terbuka sebelum masuk akun perlu dikenali ulang.
    const session = this.identity.session();
    if (hadClient && this.client?.isOpen && session && /^[0-9a-f]{64}$/.test(session)) this.sendMsg({ type: "auth", session });
    return changed;
  }

  // ---------- bagian Games: Komunitas, Live, Toko ----------

  private selectSection(sec: "main" | "komunitas" | "live" | "toko"): void {
    this.section = sec;
    if (sec === "komunitas" && this.account && this.comm.items === null) void this.loadFeed(false);
    if (sec === "live" && this.account) void this.loadLive();
    if (sec === "toko" && this.account) void this.loadShop();
    this.ver++;
    this.render(true);
  }

  private async loadFeed(more: boolean): Promise<void> {
    const c = this.comm;
    const r = await this.api.feed(c.tab, c.comm, more ? c.next : null);
    if (r.ok) {
      c.items = more && c.items ? [...c.items, ...r.data.items] : r.data.items;
      c.next = r.data.next;
      if (!more) c.suggestions = r.data.suggestions;
      c.failed = false;
    } else if (!more) c.failed = true;
    this.ver++;
    this.render(false);
  }

  private resetFeed(patch: Partial<{ tab: FeedTab; comm: string | null }>): void {
    Object.assign(this.comm, patch, { items: null, next: null, failed: false });
    this.ver++;
    this.render(true);
    void this.loadFeed(false);
  }

  private async doPost(text: string): Promise<void> {
    this.comm.posting = true;
    this.ver++;
    this.render(true);
    const r = await this.api.post(text, this.comm.comm);
    this.comm.posting = false;
    if (r.ok) {
      this.comm.draft = "";
      await this.loadFeed(false);
    } else this.showToast(r.message);
    this.ver++;
    this.render(true);
  }

  private patchItem(postId: string, fn: (p: FeedItem) => FeedItem): void {
    const c = this.comm;
    if (c.items) c.items = c.items.map((p) => (p.id === postId ? fn(p) : p));
    if (c.thread && c.thread.post.id === postId) c.thread = { ...c.thread, post: fn(c.thread.post) };
  }

  private async togglePost(p: FeedItem, what: "like" | "save"): Promise<void> {
    const on = what === "like" ? !p.liked : !p.saved;
    const r = await this.api.toggle(p.id, what, on);
    if (!r.ok) return void this.showToast(r.message);
    this.patchItem(p.id, (x) => (what === "like" ? { ...x, liked: on, likes: x.likes + (on ? 1 : -1) } : { ...x, saved: on }));
    if (what === "save" && !on && this.comm.tab === "tersimpan" && this.comm.items) this.comm.items = this.comm.items.filter((x) => x.id !== p.id);
    this.ver++;
    this.render(true);
  }

  private async openThread(postId: string): Promise<void> {
    const r = await this.api.thread(postId);
    if (!r.ok) return void this.showToast(r.message);
    this.comm.thread = r.data;
    this.comm.replyDraft = "";
    this.ver++;
    this.render(true);
  }

  private async sendReply(postId: string, text: string): Promise<void> {
    const r = await this.api.reply(postId, text);
    if (!r.ok) return void this.showToast(r.message);
    this.comm.replyDraft = "";
    await this.openThread(postId);
    this.patchItem(postId, (x) => ({ ...x, replies: x.replies + 1 }));
  }

  private async removePost(postId: string): Promise<void> {
    const r = await this.api.removePost(postId);
    if (!r.ok) return void this.showToast(r.message);
    if (this.comm.thread && this.comm.thread.post.id !== postId) {
      await this.openThread(this.comm.thread.post.id);
      return;
    }
    this.comm.thread = null;
    await this.loadFeed(false);
  }

  private async loadShop(): Promise<void> {
    if (!this.account) return;
    const r = await this.api.shop();
    if (r.ok) {
      this.shopData = r.data;
      this.shopFailed = false;
    } else this.shopFailed = true;
    this.ver++;
    this.hub.refresh();
    this.render(false);
  }

  private async shopAct(kind: "claim" | "buy" | "equip", item?: string): Promise<void> {
    this.shopBusy = true;
    this.ver++;
    this.render(true);
    const r = await this.api.shopAct(kind, item);
    this.shopBusy = false;
    if (r.ok) {
      this.shopData = r.data.shop;
      this.wallet = r.data.wallet;
      this.showToast(kind === "claim" ? id.shop.claimOk : kind === "buy" ? id.shop.bought : id.shop.equippedOk);
    } else this.showToast(r.message);
    this.ver++;
    this.hub.refresh();
    this.render(true);
  }

  /** Kelas CSS skin dadu yang terpasang (hanya tampilan lokal). */
  private diceSkin(): string {
    const eq = this.shopData?.equipped.dadu ?? "dadu_klasik";
    return `skin-${eq.replace(/^dadu_/, "").replace(/_/g, "-")}`;
  }

  private ownedEmojis(): string[] {
    const packs: Record<string, string[]> = { emoji_meja_gaple: ["🎴", "🃏", "♠️", "♥️", "🎯", "🪑"], emoji_drama_ludo: ["🎲", "🏁", "😱", "🤯", "😤", "🥳"] };
    return (this.shopData?.items ?? []).filter((i) => i.kind === "emoji" && i.owned).flatMap((i) => packs[i.id] ?? []);
  }

  private async loadLive(): Promise<void> {
    const r = await this.api.live();
    if (r.ok) {
      this.liveRooms = r.data.rooms;
      this.liveFailed = false;
    } else this.liveFailed = true;
    this.ver++;
    this.render(false);
  }

  private startWatch(key: string): void {
    this.ensureClient();
    this.spectate = { key, delayMs: 0, state: null, ended: null, chat: [], draft: "" };
    this.tab = "room";
    this.sendMsg({ type: "watch", key });
    this.ver++;
    this.render(true);
  }

  private stopWatch(): void {
    this.sendMsg({ type: "unwatch" });
    this.spectate = null;
    this.tab = "games";
    this.section = "live";
    void this.loadLive();
    this.ver++;
    this.render(true);
  }

  private sendWatchChat(text: string): void {
    if (this.spectate) this.spectate.draft = "";
    this.sendMsg({ type: "watch_chat", text });
  }

  // ---------- teman ----------

  private async loadFriends(): Promise<void> {
    if (!this.account) return;
    const [f, n] = await Promise.all([this.api.friends(), this.api.notices()]);
    if (f.ok) {
      this.friends = f.data;
      this.friendsFailed = false;
    } else this.friendsFailed = true;
    if (n.ok) this.notices = n.data.notices;
    this.friendsVer++;
    this.hub.refresh();
    this.render(false);
  }

  private openFriends(): void {
    this.friendsOpen = true;
    this.found = null;
    this.friendsVer++;
    void this.loadFriends();
    this.render(true);
  }

  private closeFriends(): void {
    this.friendsOpen = false;
    this.render(true);
  }

  private async searchFriend(username: string): Promise<void> {
    if (username.toLowerCase() === this.account?.username) {
      this.found = { error: id.friends.yourself };
    } else {
      const r = await this.api.user(username);
      this.found = r.ok ? { card: r.data.user } : { error: r.status === 404 ? id.friends.notFound : r.message };
    }
    this.friendsVer++;
    this.render(true);
  }

  private async relate(kind: "follow" | "contact" | "block", username: string, on: boolean): Promise<void> {
    const r = await this.api.relate(kind, username, on);
    if (!r.ok) {
      this.showToast(r.message);
      return;
    }
    if (this.found && "card" in this.found && this.found.card.username === username) this.found = { card: { ...this.found.card, relation: r.data.relation } };
    await this.loadFriends();
    this.friendsVer++;
    this.render(true);
  }

  private async reportUser(username: string, reason: string): Promise<void> {
    const r = await this.api.report("user", username, reason);
    this.showToast(r.ok ? id.friends.reportSent : r.message);
  }

  private async setMyStatus(status: StatusId): Promise<void> {
    const r = await this.api.setStatus(status);
    if (r.ok && this.friends) this.friends = { ...this.friends, status };
    this.friendsVer++;
    this.render(true);
  }

  private async setPrefs(p: Partial<NotifPrefs>): Promise<void> {
    const r = await this.api.setNotifPrefs(p);
    if (r.ok && this.friends) this.friends = { ...this.friends, prefs: r.data.prefs };
  }

  private async markNoticesRead(): Promise<void> {
    await this.api.readNotices();
    this.notices = this.notices.map((n) => ({ ...n, read: true }));
    this.friendsVer++;
    this.render(true);
  }

  private openDm(username: string, name: string): void {
    this.store.ensureDm(username, name);
    this.friendsOpen = false;
    this.tab = "chat";
    this.hub.setActive(true);
    this.hub.openThread(`@${username}`);
    this.render(true);
  }

  private sendDm(username: string, text: string): boolean {
    this.ensureClient();
    if (!this.sendMsg({ type: "dm_send", to: username, text })) return false;
    const c = this.store.ensureDm(username, this.store.get(`@${username}`)?.dm?.name ?? username);
    this.store.add(c.groupId, { kind: "msg", seat: -1, name: "", text, ts: Date.now(), mine: true }, false);
    this.hub.refresh();
    return true;
  }

  private inviteFriend(username: string): void {
    const r = this.room;
    if (!r || r.room.phase === "playing") {
      this.showToast(id.friends.needRoom);
      return;
    }
    this.sendMsg({ type: "invite_send", to: username, game: r.room.gameId });
  }

  private replyInvite(inv: InviteInfo, reply: "join" | "later" | "busy"): void {
    this.sendMsg({ type: "invite_reply", id: inv.id, reply });
    for (const c of this.store.list()) this.store.updateInvite(c.groupId, inv.id, reply);
    this.hub.refresh();
    if (reply === "join") this.openGroup(inv.groupId, this.room !== null);
  }

  private onDm(m: Extract<ServerMessage, { type: "dm" }>): void {
    const key = `@${m.from.username}`;
    this.store.ensureDm(m.from.username, m.from.name);
    const viewing = this.hub.isViewing(key);
    this.store.add(key, { kind: "msg", seat: -2, name: m.from.name, text: m.text, ts: m.ts, mine: false }, !viewing);
    if (viewing) this.store.markRead(key);
    if (!viewing) this.sound.play("chat");
    this.hub.refresh();
    this.renderNav();
  }

  private onInvite(m: Extract<ServerMessage, { type: "invite" }>): void {
    const key = `@${m.from.username}`;
    this.store.ensureDm(m.from.username, m.from.name);
    const viewing = this.hub.isViewing(key);
    const info: InviteInfo = { id: m.id, game: m.game, groupId: m.groupId, expiresAt: m.expiresAt, dir: "in", state: "pending" };
    this.store.add(key, { kind: "invite", invite: info, seat: -2, name: m.from.name, text: id.dm.inviteIn(m.from.name, id.games[m.game].name), ts: Date.now(), mine: false }, !viewing);
    if (viewing) this.store.markRead(key);
    if (!m.silent) {
      this.sound.play("nudge");
      this.showToast(id.dm.inviteIn(m.from.name, id.games[m.game].name));
    }
    this.hub.refresh();
    this.renderNav();
  }

  private onInviteResult(m: Extract<ServerMessage, { type: "invite_result" }>): void {
    const key = `@${m.to.username}`;
    this.store.ensureDm(m.to.username, m.to.name);
    const game = this.room?.room.gameId ?? "gaple";
    if (m.reply === "sent" || m.reply === "auto_busy") {
      const info: InviteInfo = { id: m.id, game, groupId: this.room?.room.groupId ?? "", expiresAt: Date.now() + 15 * 60_000, dir: "out", state: m.reply };
      this.store.add(key, { kind: "invite", invite: info, seat: -1, name: "", text: id.dm.inviteOut(m.to.name, id.games[game].name), ts: Date.now(), mine: true }, false);
      if (m.reply === "auto_busy") this.showToast(id.dm.result.auto_busy);
    } else {
      this.store.updateInvite(key, m.id, m.reply);
      this.showToast(`${m.to.name}: ${id.dm.result[m.reply]}`);
    }
    this.hub.refresh();
  }

  /** Papan peringkat dari server (butuh akun). */
  private async refreshBoard(): Promise<void> {
    if (!this.account) return;
    const r = await this.api.leaderboard();
    if (r.ok) {
      this.board = { rows: r.data.rows, you: r.data.you };
      this.render(false);
    }
  }

  private findMatch(game: "gaple" | "ludo"): void {
    if (!this.account) return;
    this.pendingQueue = game;
    this.queue = { state: "waiting", game, since: null };
    this.queueStartedAt = Date.now();
    this.ensureClient();
    // Bila sudah tersambung dan dikenali, kirim langsung; bila belum, dikirim setelah auth_ok.
    if (this.client?.isOpen && this.authed) {
      this.pendingQueue = null;
      this.sendMsg({ type: "queue_ranked", game });
    }
    this.render(true);
  }

  private cancelMatch(): void {
    this.pendingQueue = null;
    this.queue = { state: "idle", game: null, since: null };
    this.sendMsg({ type: "cancel_queue" });
    this.render(true);
  }

  private get authed(): boolean {
    return this.account !== null && this.client?.isOpen === true;
  }

  private reload(): void {
    (this.deps.reload ?? (() => window.location.reload()))();
  }

  private async doRegister(username: string, password: string): Promise<string | null> {
    const nm = checkName(this.identity.name() ?? "");
    const r = await this.api.register({ username: username.trim(), password, name: nm.ok ? nm.name : undefined, token: this.identity.token() });
    if (!r.ok) return r.message;
    this.identity.setSession(r.data.session);
    const changed = this.applyAccount(r.data.account, r.data.wallet ?? null);
    this.showToast(id.account.created);
    if (changed && this.client) this.reload();
    this.render(true);
    return null;
  }

  private async doLogin(username: string, password: string): Promise<string | null> {
    const r = await this.api.login({ username: username.trim(), password });
    if (!r.ok) return r.message;
    this.identity.setSession(r.data.session);
    const changed = this.applyAccount(r.data.account, r.data.wallet ?? null);
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
    this.wallet = null;
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
    // Akun masuk: kenali koneksi ini dulu (dibutuhkan untuk Ranked dan fitur akun lain).
    const session = this.identity.session();
    const auth: ClientMessage[] = session && /^[0-9a-f]{64}$/.test(session) ? [{ type: "auth", session }] : [];
    if (i.kind === "create") return [...auth, { type: "create_room", name: i.name, token, game: i.game }];
    if (i.kind === "open") return [...auth, { type: "open_link", groupId: i.groupId, token }];
    if (i.kind === "join") return [...auth, { type: "join", groupId: i.groupId, name: i.name, token }];
    return auth;
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
        if (m.spectating) {
          if (this.spectate) this.spectate.state = m;
          this.ver++;
          this.render(false);
          return;
        }
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
      case "auth_ok":
        if (this.pendingQueue) {
          const g = this.pendingQueue;
          this.pendingQueue = null;
          this.sendMsg({ type: "queue_ranked", game: g });
        }
        return;
      case "queue":
        if (m.state === "waiting" && this.queue.state !== "waiting") this.queueStartedAt = Date.now();
        this.queue = { state: m.state, game: m.game, since: m.since };
        this.render(false);
        return;
      case "watching":
        if (this.spectate) this.spectate.delayMs = m.delayMs;
        this.ver++;
        this.render(false);
        return;
      case "watch_end":
        if (this.spectate && m.reason !== "left") this.spectate.ended = id.live.ended[m.reason];
        this.ver++;
        this.render(false);
        return;
      case "watch_chat":
        if (this.spectate) {
          this.spectate.chat = [...this.spectate.chat.slice(-49), { name: m.name, text: m.text, ts: m.ts }];
          this.ver++;
          this.render(false);
        }
        return;
      case "dm":
        this.onDm(m);
        return;
      case "dm_ack":
        return;
      case "invite":
        this.onInvite(m);
        return;
      case "invite_result":
        this.onInviteResult(m);
        return;
      case "notice":
        this.notices = [{ id: m.id, kind: m.kind, text: m.text, ts: m.ts, read: false }, ...this.notices];
        this.friendsVer++;
        if (this.friendsOpen) this.render(true);
        return;
      case "match_found":
        this.queue = { state: "idle", game: null, since: null };
        this.sound.play("start");
        this.showToast(id.ranked.found);
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
    const move = m.game?.kind === "ludo" ? null : describeLastMove(prev, m);
    const lmove = m.game?.kind === "ludo" ? describeLudoMove(prev, m) : null;
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
    } else if (lmove) {
      this.lastMove = { side: null, text: lmove.text };
      this.sound.play(lmove.sound);
      if (phaseNow === "playing" && isMyTurn(m) && !(prev && isMyTurn(prev))) {
        setTimeout(() => this.sound.play("turn"), 260);
        haptic(this.sound, 30);
      }
    } else if (phaseNow === "playing" && prev && isMyTurn(m) && !isMyTurn(prev)) {
      setTimeout(() => this.sound.play("turn"), 50);
    }
    if (prev && prev.room.phase !== "finished" && phaseNow === "finished" && m.game?.result) {
      const mine = m.game.result.rewards?.find((r) => r.seat === m.you.seat);
      if (mine && this.wallet) {
        this.wallet = { ...this.wallet, trofi: mine.trofiTotal, bintang: this.wallet.bintang + mine.bintang, kelas: mine.kelas };
        void this.refreshBoard();
      }
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

  private create(name: string, game: "gaple" | "ludo" = "gaple"): void {
    this.identity.setName(name);
    this.busy = true;
    this.intent = { kind: "create", name, game };
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
  private openGroup(groupId: string, leaveFirst = false): void {
    this.info = null;
    this.notice = null;
    this.linkMissing = false;
    this.intent = { kind: "open", groupId };
    this.route = { kind: "link", groupId };
    this.tab = "room";
    window.history.pushState(null, "", `/g/${groupId}`);
    this.render(true);
    // Masih duduk di room lain: keluar dulu; pesan `left` yang melanjutkan membuka tautan.
    if (leaveFirst && this.sendMsg({ type: "leave" })) return;
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
    if (t === "games") void this.refreshBoard();
    if (t === "chat") {
      this.friendsOpen = false;
      this.hub.showList();
    }
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
    const qw = this.main.querySelector<HTMLElement>('[data-testid="queue-waiting"]');
    if (qw && this.queue.state === "waiting") qw.textContent = `${id.ranked.searching} ${id.gamePick[this.queue.game ?? "gaple"]} · ${id.ranked.waited(Math.floor((Date.now() - this.queueStartedAt) / 1000))}`;
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
        return `games:${this.section}:${this.ver}:${this.busy}:${this.room?.room.groupId ?? ""}:${this.queue.state}:${this.account?.username ?? ""}:${this.board?.rows.length ?? -1}:${this.board?.you.rank ?? ""}`;
      case "room": {
        if (this.spectate) return `spectate:${this.ver}`;
        if (this.room) return "room";
        const i = this.info;
        return this.route.kind === "link" ? `link:${this.busy}:${this.notice ?? ""}:${i ? `${i.phase}/${i.players}/${i.isMember}` : "loading"}` : "roomempty";
      }
      case "chat":
        return this.friendsOpen ? `friends:${this.friendsVer}` : "chat";
      case "profile":
        return `profile:${this.theme}:${this.sound.enabled}:${this.identity.name() ?? ""}:${this.account?.username ?? ""}:${this.wallet?.trofi ?? ""}:${this.wallet?.bintang ?? ""}`;
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
    // Lebar bilah kemajuan kelas diatur lewat CSSOM (CSP melarang atribut style inline).
    for (const bar of this.main.querySelectorAll<HTMLElement>("#kelasfill")) bar.style.width = `${bar.dataset.pct ?? "0"}%`;
    this.updateTimer();
  }

  private buildScreen(): HTMLElement {
    if (this.fatal) return errorView(this.fatal.message, null, () => this.goHome());
    if (this.linkMissing) return notFoundView("link", () => this.goHome());
    if (this.route.kind === "privacy") return privacyView(() => this.selectTab("profile"));
    if (this.route.kind === "notfound") return notFoundView("page", () => this.goHome());
    switch (this.tab) {
      case "games":
        return this.buildGames();
      case "room":
        if (this.spectate) return this.buildSpectate(this.spectate);
        if (this.room) return this.buildRoom(this.room);
        return this.route.kind === "link" ? this.buildLink() : this.buildRoomEmpty();
      case "chat":
        if (this.friendsOpen) return this.buildFriends();
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
          wallet: walletPanel(this.wallet, this.account !== null),
          name: this.identity.name() ?? "",
          avatarFrame: this.shopData?.equipped.avatar ?? null,
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

  private buildGamesMain(): HTMLElement {
    return gamesView({
      initialName: this.identity.name() ?? "",
      busy: this.busy,
      roomCode: this.room?.room.groupId ?? null,
      onCreate: (n, g) => this.create(n, g),
      onBackToRoom: () => this.selectTab("room"),
      extra: [
        rankedCard({
          loggedIn: this.account !== null,
          queue: this.queue,
          waited: Math.floor((Date.now() - this.queueStartedAt) / 1000),
          onFind: (g) => this.findMatch(g),
          onCancel: () => this.cancelMatch(),
          onToProfile: () => this.selectTab("profile"),
        }),
        ...(this.account ? [leaderboardView(this.board?.rows ?? null, this.board?.you ?? null)] : []),
      ],
    });
  }

  private buildGames(): HTMLElement {
    const sec = this.section;
    const labels: [typeof sec, string][] = [["main", id.sections.main], ["komunitas", id.sections.komunitas], ["live", id.sections.live], ["toko", id.sections.toko]];
    const nav = h("div", { class: "seg", role: "tablist", "aria-label": id.sections.label }, labels.map(([k, label]) => h("button", { type: "button", role: "tab", class: `seg-btn${sec === k ? " on" : ""}`, "aria-selected": String(sec === k), "data-section": k, onclick: () => this.selectSection(k) }, label)));
    if (sec === "main") return h("div", { class: "stack" }, nav, this.buildGamesMain());
    const guest = h("div", { class: "panel" }, h("p", { class: "hint", "data-testid": "section-guest" }, id.sections.needAccount), h("button", { type: "button", class: "btn primary", onclick: () => this.selectTab("profile") }, id.sections.toProfile));
    if (!this.account) return h("div", { class: "stack" }, nav, guest);
    if (sec === "komunitas") return h("div", { class: "stack" }, nav, this.buildCommunity());
    if (sec === "toko") return h("div", { class: "stack" }, nav, shopView({ data: this.shopData, failed: this.shopFailed, busy: this.shopBusy, onClaim: () => void this.shopAct("claim"), onBuy: (i) => void this.shopAct("buy", i), onEquip: (i) => void this.shopAct("equip", i), onRetry: () => void this.loadShop() }));
    return h("div", { class: "stack" }, nav, liveListView({ loggedIn: true, rooms: this.liveRooms, failed: this.liveFailed, onWatch: (k) => this.startWatch(k), onRefresh: () => void this.loadLive(), onToProfile: () => this.selectTab("profile") }));
  }

  private buildCommunity(): HTMLElement {
    const c = this.comm;
    return communityView({
      tab: c.tab,
      comm: c.comm,
      items: c.items,
      next: c.next,
      suggestions: c.suggestions,
      failed: c.failed,
      posting: c.posting,
      draft: c.draft,
      thread: c.thread,
      replyDraft: c.replyDraft,
      now: Date.now(),
      communities: Object.entries(id.community.communities).map(([cid, name]) => ({ id: cid, name })),
      onDraft: (v) => void (c.draft = v),
      onReplyDraft: (v) => void (c.replyDraft = v),
      onPost: (t) => void this.doPost(t),
      onTab: (t) => this.resetFeed({ tab: t }),
      onComm: (k) => this.resetFeed({ comm: k }),
      onMore: () => void this.loadFeed(true),
      onRetry: () => void this.loadFeed(false),
      onLike: (p) => void this.togglePost(p, "like"),
      onSave: (p) => void this.togglePost(p, "save"),
      onOpen: (p) => void this.openThread(p.id),
      onCloseThread: () => {
        c.thread = null;
        this.ver++;
        this.render(true);
      },
      onReply: (pid, t) => void this.sendReply(pid, t),
      onShare: (p) => void this.copy(`${p.author.name}: ${p.text}\n${this.origin}`).then((ok) => this.showToast(ok ? id.community.shared : id.lobby.copyFailed)),
      onHide: (p) => {
        void this.api.hidePost(p.id);
        if (c.items) c.items = c.items.filter((x) => x.id !== p.id);
        this.ver++;
        this.render(true);
      },
      onReport: (p, reason) => void this.api.report("post", p.id, reason).then((r) => this.showToast(r.ok ? id.community.reportSent : r.message)),
      onRemove: (pid) => void this.removePost(pid),
      onFollow: (u) => void this.api.relate("follow", u.username, true).then((r) => {
        if (r.ok) c.suggestions = c.suggestions.filter((x) => x.username !== u.username);
        else this.showToast(r.message);
        this.ver++;
        this.render(true);
      }),
    });
  }

  /** Penonton: papan tertunda tanpa kartu pemain, chat penonton, tombol berhenti. */
  private buildSpectate(sp: NonNullable<App["spectate"]>): HTMLElement {
    const l = id.live;
    const s = sp.state;
    const noop = (): void => undefined;
    let board: HTMLElement;
    if (!s) board = h("p", { class: "panel hint center", role: "status", "data-testid": "spectate-wait" }, sp.ended ?? l.waitingFrame);
    else if (s.room.phase === "finished") board = resultView(s, false, noop);
    else if (s.game?.kind === "ludo") board = ludoView(s, { connected: true, nudgeCooling: true, lastMoveText: null, diceSkin: "skin-klasik", onRoll: noop, onPick: noop, onNudge: noop });
    else board = tableView(s, { connected: true, pendingCard: null, lastMove: null, nudgeCooling: true, onPlay: noop, onNeedEnd: noop, onCancelEnd: noop, onPass: noop, onNudge: noop });
    const input = h("input", { class: "input", type: "text", maxlength: 300, value: sp.draft, placeholder: l.chatPlaceholder, "aria-label": l.chatPlaceholder, "data-testid": "watch-input", oninput: (e: Event) => void (sp.draft = (e.target as HTMLInputElement).value) });
    return h(
      "section",
      { class: "stack spectating", "data-testid": "spectate" },
      h("p", { class: "notice", role: "status", "data-testid": "spectate-banner" }, `${l.watching}. ${l.delay(Math.round(sp.delayMs / 1000))}`),
      sp.ended && s ? h("p", { class: "notice", role: "alert" }, sp.ended) : null,
      board,
      h(
        "div",
        { class: "panel" },
        h("h2", {}, l.chatTitle),
        h("p", { class: "hint" }, l.chatNote),
        h("ul", { class: "flist", "data-testid": "watch-log" }, sp.chat.map((c) => h("li", {}, h("b", {}, c.name), ": ", c.text))),
        h("form", { class: "form", onsubmit: (e: Event) => { e.preventDefault(); if (input.value.trim()) this.sendWatchChat(input.value.trim()); } }, input, h("button", { type: "submit", class: "btn", "data-testid": "watch-send" }, l.chatSend)),
      ),
      h("button", { type: "button", class: "btn", "data-testid": "unwatch", onclick: () => this.stopWatch() }, l.leave),
    );
  }

  private buildFriends(): HTMLElement {
    return friendsView({
      loggedIn: this.account !== null,
      data: this.friends,
      failed: this.friendsFailed,
      notices: this.notices,
      found: this.found,
      draft: this.searchDraft,
      onDraft: (v) => void (this.searchDraft = v),
      onBack: () => this.closeFriends(),
      onSearch: (u) => void this.searchFriend(u),
      onRelate: (k, u, on) => void this.relate(k, u, on),
      onReport: (u, r) => void this.reportUser(u, r),
      onChat: (f) => this.openDm(f.username, f.name),
      onInvite: (f) => this.inviteFriend(f.username),
      onStatus: (st) => void this.setMyStatus(st),
      onPrefs: (p) => void this.setPrefs(p),
      onMarkRead: () => void this.markNoticesRead(),
      onRetry: () => void this.loadFriends(),
      onToProfile: () => this.selectTab("profile"),
    });
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
        onSetGame: (game) => this.sendMsg({ type: "set_game", game }),
        onSetRanked: (on) => this.sendMsg({ type: "set_ranked", on }),
        onSetWatch: (on) => this.sendMsg({ type: "set_watch", on }),
        canWatch: this.account !== null,
      });
    }
    if (s.room.phase === "finished") {
      return resultView(s, this.busy, () => {
        this.busy = true;
        this.sendMsg({ type: "rematch" });
        this.render(false);
      });
    }
    if (s.game?.kind === "ludo") {
      return ludoView(s, {
        connected,
        nudgeCooling: Date.now() < this.nudgeUntil,
        lastMoveText: this.lastMove?.text ?? null,
        diceSkin: this.diceSkin(),
        onRoll: () => {
          if (s.game?.yourMoves.some((m) => m.type === "roll") && isMyTurn(s)) this.sendMsg({ type: "roll" });
        },
        onPick: (pawn) => {
          if (s.game?.yourMoves.some((m) => m.type === "pick" && m.pawn === pawn) && isMyTurn(s)) this.sendMsg({ type: "pick", pawn });
        },
        onNudge: () => this.nudge(),
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
