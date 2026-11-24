import { id } from "./i18n/id";

export interface Prefs {
  theme?: "auto" | "light" | "dark";
  sound?: boolean;
}

export interface AccountInfo {
  username: string;
  name: string;
  /** Identitas room akun ini. Rahasia; hanya diterima setelah masuk. */
  token: string;
  prefs: Prefs;
  groups: { groupId: string; ts: number }[];
}

export interface WalletInfo {
  trofi: number;
  bintang: number;
  koin: number;
  kelas: string;
  kelasIndex: number;
  next: { name: string; min: number } | null;
}

export interface LeaderRow {
  rank: number;
  name: string;
  kelas: string;
  trofi: number;
  isYou: boolean;
}

export interface Relation {
  iFollow: boolean;
  followsMe: boolean;
  iSaved: boolean;
  savedMe: boolean;
  friend: boolean;
  iBlocked: boolean;
}
export type StatusId = "siap" | "sibuk" | "senyap" | "dnd";
export interface FriendRow {
  username: string;
  name: string;
  kelas: string;
  online: boolean;
  status: StatusId;
  streak: { count: number; doneToday: boolean };
}
export interface PersonRow {
  username: string;
  name: string;
}
export interface NotifPrefs {
  invite: boolean;
  follow: boolean;
  streak: boolean;
  dm: boolean;
}
export interface FriendsData {
  friends: FriendRow[];
  waiting: PersonRow[];
  incoming: PersonRow[];
  blocked: PersonRow[];
  status: StatusId;
  prefs: NotifPrefs;
}
export interface UserCard {
  username: string;
  name: string;
  kelas: string;
  relation: Relation;
}
export interface NoticeRow {
  id: string;
  kind: "follow" | "invite" | "streak" | "dm";
  text: string;
  ts: number;
  read: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Klien API akun (same-origin). Galat jaringan dikembalikan sebagai status 0, bukan dilempar. */
export class Api {
  constructor(
    private readonly getSession: () => string | null,
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, { ...init, credentials: "omit" }) as unknown as ReturnType<FetchLike>,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const session = this.getSession();
    if (session) headers.authorization = `Bearer ${session}`;
    try {
      const r = await this.fetchFn(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (r.status >= 200 && r.status < 300) return { ok: true, data: json as T };
      return { ok: false, status: r.status, code: String(json.code ?? "ERROR"), message: String(json.message ?? id.errors.generic) };
    } catch {
      return { ok: false, status: 0, code: "NETWORK", message: id.account.network };
    }
  }

  register(b: { username: string; password: string; name?: string; token: string }): Promise<ApiResult<{ session: string; account: AccountInfo; wallet: WalletInfo | null }>> {
    return this.call("POST", "/api/register", b);
  }
  login(b: { username: string; password: string }): Promise<ApiResult<{ session: string; account: AccountInfo; wallet: WalletInfo | null }>> {
    return this.call("POST", "/api/login", b);
  }
  leaderboard(): Promise<ApiResult<{ rows: LeaderRow[]; you: { rank: number | null; trofi: number; kelas: string } }>> {
    return this.call("GET", "/api/leaderboard");
  }
  friends(): Promise<ApiResult<FriendsData>> {
    return this.call("GET", "/api/friends");
  }
  user(username: string): Promise<ApiResult<{ user: UserCard }>> {
    return this.call("GET", `/api/users?username=${encodeURIComponent(username)}`);
  }
  relate(kind: "follow" | "contact" | "block", username: string, on: boolean): Promise<ApiResult<{ relation: Relation }>> {
    return this.call("POST", `/api/${kind}`, { username, on });
  }
  report(kind: "user" | "post", target: string, reason: string): Promise<ApiResult<{ ok: true }>> {
    return this.call("POST", "/api/report", { kind, target, reason });
  }
  setStatus(status: StatusId): Promise<ApiResult<{ status: StatusId }>> {
    return this.call("PUT", "/api/status", { status });
  }
  setNotifPrefs(prefs: Partial<NotifPrefs>): Promise<ApiResult<{ prefs: NotifPrefs }>> {
    return this.call("PUT", "/api/notif-prefs", prefs);
  }
  notices(): Promise<ApiResult<{ notices: NoticeRow[] }>> {
    return this.call("GET", "/api/notices");
  }
  readNotices(): Promise<ApiResult<{ ok: true }>> {
    return this.call("POST", "/api/notices/read", {});
  }
  logout(): Promise<ApiResult<{ ok: true }>> {
    return this.call("POST", "/api/logout", {});
  }
  me(): Promise<ApiResult<{ account: AccountInfo; wallet: WalletInfo | null }>> {
    return this.call("GET", "/api/me");
  }
  updateProfile(b: { name?: string; prefs?: Prefs }): Promise<ApiResult<{ account: AccountInfo }>> {
    return this.call("PUT", "/api/me", b);
  }
  changePassword(b: { oldPassword: string; newPassword: string }): Promise<ApiResult<{ ok: true }>> {
    return this.call("POST", "/api/me/password", b);
  }
  deleteAccount(b: { password: string }): Promise<ApiResult<{ ok: true }>> {
    return this.call("DELETE", "/api/me", b);
  }
}
