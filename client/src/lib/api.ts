import type { User, EventItem, EventCreate, EventUpdate, SyncResult, PushResult } from "./types";

// 服务器端口改用 28091：8091/8090 常与本机其它服务（next-server 等）冲突，
// 且 32768-60999 是系统临时端口区会被随机占用，28091 在该区间之外。
const DEFAULT_SERVER = "http://127.0.0.1:28091";

/** 规整服务器地址：迁移历史遗留的 :8091，并去掉结尾斜杠（避免拼出 //sync）。 */
function normalizeServer(url: string): string {
  return url.replace(":8091", ":28091").replace(/\/+$/, "");
}

function readStoredServer(): string {
  try {
    const stored = localStorage.getItem("mincal_server");
    return stored ? normalizeServer(stored) : DEFAULT_SERVER;
  } catch {
    // 非浏览器环境或存储不可用
    return DEFAULT_SERVER;
  }
}

// 关键：模块加载时就把用户设置的服务器地址读回来。
// 之前只有 setServer 会写 localStorage，重启后 request() 仍用硬编码默认值，
// 导致“设置里显示的地址”与“实际请求的地址”不一致（同步静默失效）。
let baseUrl = readStoredServer();
let accessToken = "";

export function setServer(url: string) {
  baseUrl = normalizeServer(url);
  try {
    localStorage.setItem("mincal_server", baseUrl);
  } catch {
    /* 存储不可用时仅内存生效 */
  }
}

export function getServer(): string {
  return baseUrl;
}

export function setToken(token: string) {
  accessToken = token;
  localStorage.setItem("mincal_token", token);
}

export function getToken(): string {
  return localStorage.getItem("mincal_token") || accessToken;
}

export function clearToken() {
  accessToken = "";
  localStorage.removeItem("mincal_token");
  localStorage.removeItem("mincal_user");
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    throw new Error("登录已失效，请重新登录");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// --- Auth ---
export const auth = {
  register: (data: { username: string; password: string; display_name: string }) =>
    request<User>("POST", "/auth/register", data),
  login: (data: { username: string; password: string }) =>
    request<{ access_token: string; refresh_token: string }>("POST", "/auth/login", data),
  me: () => request<User>("GET", "/auth/me"),
};

// --- Events ---
export const events = {
  list: (start: string, end: string, owner?: string) =>
    request<EventItem[]>("GET", `/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${owner ? `&owner=${owner}` : ""}`),
  create: (data: EventCreate) => request<EventItem>("POST", "/events", data),
  update: (id: string, data: EventUpdate) => request<EventItem>("PUT", `/events/${id}`, data),
  delete: (id: string) => request<void>("DELETE", `/events/${id}`),
};

// --- Sync ---
export const sync = {
  initial: () => request<SyncResult>("POST", "/sync/initial"),
  push: (changes: { id?: string; op: string; data: Record<string, unknown> }[]) =>
    request<PushResult>("POST", "/sync/push", changes),
  pull: (since: number) => request<SyncResult>("GET", `/sync/pull?since=${since}`),
};

// --- Users ---
export const users = {
  // 注意：后端尚未提供 GET /users 与 PUT /users/me，当前仅 me 可用
  list: () => request<User[]>("GET", "/users"),
  me: () => request<User>("GET", "/auth/me"),
  update: (data: Record<string, string>) => request<User>("PUT", "/users/me", data),
};
