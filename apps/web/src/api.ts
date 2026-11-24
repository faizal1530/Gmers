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

  register(b: { username: string; password: string; name?: string; token: string }): Promise<ApiResult<{ session: string; account: AccountInfo }>> {
    return this.call("POST", "/api/register", b);
  }
  login(b: { username: string; password: string }): Promise<ApiResult<{ session: string; account: AccountInfo }>> {
    return this.call("POST", "/api/login", b);
  }
  logout(): Promise<ApiResult<{ ok: true }>> {
    return this.call("POST", "/api/logout", {});
  }
  me(): Promise<ApiResult<{ account: AccountInfo }>> {
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
