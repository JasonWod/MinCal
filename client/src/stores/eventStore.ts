import { isOwnerOf } from "../lib/eventUtils";
import { create } from "zustand";
import type { EventItem, User, SyncStatus } from "../lib/types";
import type { LocalPrefs } from "../lib/prefs";
import { getPrefs, savePrefs } from "../lib/prefs";
import {
  getAllLocalEvents,
  putLocalEvent,
  putAllLocalEvents,
  deleteLocalEvent,
} from "../lib/localStore";
import * as api from "../lib/api";

// Local-first event store.
//
// Invariants:
//  - `events` is always populated from local storage (IndexedDB) first, so the
//    UI works with no network and no account.
//  - Local mutations commit to IndexedDB before becoming visible in memory.
//  - Network sync (push/pull/websocket) is only attempted when `syncEnabled`
//    is true (a server is configured and the user has a valid token), and any
//    network failure degrades gracefully to "offline" without touching local
//    data.

interface EventStore {
  // State
  events: EventItem[];
  localUser: LocalPrefs;
  selfId: string; // currentUser?.id || localUser.id
  currentUser: User | null; // optional server identity
  users: User[];
  syncEnabled: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  syncError: string | null;
  lastSyncAt: number | null;
  version: number;
  initialized: boolean;

  // Actions
  init: () => Promise<void>;
  setEvents: (events: EventItem[]) => void;
  addEvent: (event: EventItem) => void;
  updateEvent: (event: EventItem) => void;
  deleteEvent: (id: string) => void;
  setUser: (user: User | null) => void;
  setUsers: (users: User[]) => void;
  setLocalPrefs: (partial: Partial<LocalPrefs>) => void;
  setSyncEnabled: (b: boolean) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setVersion: (v: number) => void;
  setPendingCount: (n: number) => void;

  // Local (always available)
  localCreate: (data: Record<string, unknown>) => Promise<void>;
  localUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  localDelete: (id: string) => Promise<void>;

  // Sync (optional, only when connected)
  syncNow: () => Promise<void>;
  doPull: () => Promise<void>;
  pushLocalChange: (op: "create" | "update" | "delete", data: Record<string, unknown>) => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let initStarted = false;
let syncInFlight: Promise<void> | null = null;

function recomputeSelfId(currentUser: User | null, localUser: LocalPrefs): string {
  return currentUser?.id || localUser.id;
}

export const useEventStore = create<EventStore>((set, get) => {
  const initialPrefs = getPrefs();

  return {
    events: [],
    localUser: initialPrefs,
    selfId: recomputeSelfId(null, initialPrefs),
    currentUser: null,
    users: [],
    syncEnabled: false,
    syncStatus: "local",
    pendingCount: 0,
    syncError: null,
    lastSyncAt: null,
    version: 0,
    initialized: false,

    init: async () => {
      if (initStarted) return;
      initStarted = true;
      try {
        // 1) Load local data first — this is what makes the app usable offline.
        const local = await getAllLocalEvents();
        set({ events: local });
      } catch (e) {
        console.warn("local store load failed, starting empty", e);
        set({ events: [] });
      }
      set({ initialized: true });
      // 2) If a server is already configured and we hold a token, go online.
      const token = api.getToken();
      const server = api.getServer();
      if (token && server && server.trim()) {
        get().setSyncEnabled(true);
        void get().syncNow();
      } else {
        set({ syncStatus: "local" });
      }
    },

    setEvents: (events) => set({ events }),
    addEvent: (event) => set((s) => ({ events: [...s.events, event] })),
    updateEvent: (event) =>
      set((s) => ({ events: s.events.map((e) => (e.id === event.id ? event : e)) })),
    deleteEvent: (id) =>
      set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
    setUser: (user) =>
      set((s) => ({
        currentUser: user,
        selfId: recomputeSelfId(user, s.localUser),
        syncEnabled: !!user,
        version: s.currentUser?.id === user?.id ? s.version : 0,
      })),
    setUsers: (users) => set({ users }),
    setLocalPrefs: (partial) => {
      const next = savePrefs(partial);
      set((s) => ({ localUser: next, selfId: recomputeSelfId(s.currentUser, next) }));
    },
    setSyncEnabled: (b) => set({ syncEnabled: b, syncStatus: b ? "syncing" : "local" }),
    setSyncStatus: (status) => set({ syncStatus: status }),
    setVersion: (v) => set({ version: v }),
    setPendingCount: (n) => set({ pendingCount: n }),

    localCreate: async (data) => {
      const { selfId } = get();
      const now = new Date().toISOString();
      const event: EventItem = {
        id: crypto.randomUUID(),
        owner_id: selfId,
        title: (data.title as string) || "新事件",
        description: data.description as string | undefined,
        start_time: data.start_time as string,
        end_time: data.end_time as string,
        location: data.location as string | undefined,
        color: data.color as string | undefined,
        visibility: (data.visibility as EventItem["visibility"]) || "busy",
        all_day: (data.all_day as boolean) || false,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      await putLocalEvent(event);
      get().addEvent(event);
      if (get().syncEnabled) get().pushLocalChange("create", { ...data, id: event.id });
    },

    localUpdate: async (id, data) => {
      const existing = get().events.find((e) => e.id === id);
      if (!existing) return;
      if (!isOwnerOf(existing, get().selfId)) throw new Error("仅创建者可以修改日程");
      const updated: EventItem = {
        ...existing,
        ...(data as Partial<EventItem>),
        updated_at: new Date().toISOString(),
        version: existing.version + 1,
      };
      await putLocalEvent(updated);
      get().updateEvent(updated);
      if (get().syncEnabled) get().pushLocalChange("update", { ...data, id, version: existing.version });
    },

    localDelete: async (id) => {
      const existing = get().events.find((e) => e.id === id);
      if (!existing) return;
      if (!isOwnerOf(existing, get().selfId)) throw new Error("仅创建者可以删除日程");
      await deleteLocalEvent(id);
      get().deleteEvent(id);
      if (get().syncEnabled) get().pushLocalChange("delete", { id });
    },

    syncNow: async () => {
      if (!get().syncEnabled) return;
      if (syncInFlight) return syncInFlight;
      const server = api.getServer();
      syncInFlight = (async () => {
        set({ syncStatus: "syncing" });
        try {
          if (!get().currentUser) get().setUser(await api.auth.me());
          if (!get().syncEnabled || api.getServer() !== server) return;
          await flushPending();
          if (!get().syncEnabled || api.getServer() !== server) return;
          await get().doPull();
          if (!ws || ws.readyState > 1) connectWS();
        } catch (error) {
          if (get().syncEnabled && api.getServer() === server) set({
            syncStatus: "error",
            syncError: `同步失败，修改已保存在本机。${error instanceof Error ? error.message : "请检查网络后重试"}`,
          });
        }
      })();
      try { await syncInFlight; } finally { syncInFlight = null; }
    },

    doPull: async () => {
      if (!get().syncEnabled) return;
      try {
        const { version, selfId } = get();
        const server = api.getServer();
        const result = await api.sync.pull(version);
        if (!get().syncEnabled || get().selfId !== selfId || api.getServer() !== server) return;
        // Merge remote into local: keep local as source of truth, fold in new
        // / newer remote rows, never drop locally-authored events.
        const map = new Map<string, EventItem>(get().events.map((e) => [e.id, e]));
        for (const r of result.events) {
          if (pendingChanges().some((c) => c.data.id === r.id)) continue;
          if (r.deleted) { map.delete(r.id); continue; }
          const existing = map.get(r.id);
          if (!existing) {
            map.set(r.id, r);
          } else {
            const rNewer =
              r.version > existing.version ||
              (r.version === existing.version && (r.updated_at || "") > (existing.updated_at || ""));
            if (rNewer) map.set(r.id, r);
          }
        }
        // Only surface others' events if they are not private.
        const visible = Array.from(map.values()).filter(
          (e) => e.owner_id === selfId || e.visibility !== "private"
        );
        set({
          events: visible,
          version: result.version,
          syncStatus: pendingChanges().length ? "error" : "synced",
          pendingCount: pendingChanges().length,
          syncError: pendingChanges().length ? "仍有修改待上传，请重试同步" : null,
          lastSyncAt: Date.now(),
        });
        await putAllLocalEvents(visible);
        for (const r of result.events) {
          if (r.deleted && !pendingChanges().some((c) => c.data.id === r.id)) await deleteLocalEvent(r.id);
        }
      } catch {
        set({ syncStatus: "offline", syncError: "同步失败，修改已保存在本机。请检查网络或重新登录后重试。" });
      }
    },

    pushLocalChange: (op, data) => {
      if (!get().syncEnabled) return;
      try {
        const changes = pendingChanges();
        changes.push({ op, data });
        savePending(changes);
        set({ pendingCount: changes.length, syncStatus: "syncing", syncError: null });
        void get().syncNow();
      } catch {
        set({ syncStatus: "error", syncError: "日程已保存到本机，但无法保存上传队列，请勿关闭应用并检查存储空间。" });
      }
    },

    disconnect: () => {
      api.clearToken();
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
      if (ws) ws.onclose = null;
      ws?.close();
      ws = null;
      set({ currentUser: null, syncEnabled: false, syncStatus: "local", pendingCount: 0, syncError: null });
      set((s) => ({ selfId: recomputeSelfId(null, s.localUser) }));
    },
  };
});

// Internal helper not part of the public action surface above.
// (init() sets the `initialized` flag directly via set(); nothing to attach.)

// WebSocket connection (optional, only meaningful when syncEnabled).
function connectWS() {
  const token = api.getToken();
  if (!token || !useEventStore.getState().syncEnabled) return;
  const url = api.getServer().replace(/^http/, "ws") + `/sync/ws?token=${token}`;

  try {
    ws = new WebSocket(url);
    ws.onopen = () => { void useEventStore.getState().syncNow(); };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (
          data.type === "event_updated" ||
          data.type === "event_created" ||
          data.type === "event_deleted"
        ) {
          useEventStore.getState().doPull();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (useEventStore.getState().syncEnabled) {
        useEventStore.setState({ syncStatus: "offline" });
        scheduleReconnect();
      }
    };
    ws.onerror = () => ws?.close();
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWS();
  }, 5000);
}

export function disconnectWS() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = null;
  if (ws) ws.onclose = null;
  ws?.close();
  ws = null;
}


type PendingChange = { op: "create" | "update" | "delete"; data: Record<string, unknown> };
function pendingKey() {
  return `mincal_pending:${api.getServer()}:${useEventStore.getState().selfId}`;
}
function pendingChanges(): PendingChange[] {
  return JSON.parse(localStorage.getItem(pendingKey()) || "[]");
}
function savePending(changes: PendingChange[]) {
  localStorage.setItem(pendingKey(), JSON.stringify(changes));
}
let flushing: Promise<void> | null = null;
async function flushPending() {
  if (flushing) return flushing;
  const key = pendingKey();
  flushing = (async () => {
    let changes = pendingChanges();
    useEventStore.setState({ pendingCount: changes.length });
    while (changes.length && useEventStore.getState().syncEnabled && pendingKey() === key) {
      const change = changes[0];
      const response = await api.sync.push([change]);
      const result = response.results?.[0];
      const allowed = change.op === "create" ? ["created", "already_exists"]
        : change.op === "delete" ? ["deleted", "already_deleted", "not_found"] : ["updated"];
      if (!result || !allowed.includes(result.status)) {
        throw new Error(`上传失败：${result?.status || "未知响应"}`);
      }
      if (pendingKey() !== key || !useEventStore.getState().syncEnabled) return;
      changes = pendingChanges();
      changes.shift();
      // Use the acknowledged version for later edits rather than the local counter.
      if (result.version) {
        for (const next of changes) {
          if (next.data.id === change.data.id && next.op === "update") next.data.version = result.version;
        }
        const current = useEventStore.getState().events.find((e) => e.id === change.data.id);
        if (current) {
          const acknowledged = { ...current, version: result.version };
          await putLocalEvent(acknowledged);
          useEventStore.getState().updateEvent(acknowledged);
        }
      }
      savePending(changes);
      useEventStore.setState({ pendingCount: changes.length });
    }
  })();
  try { await flushing; } finally { flushing = null; }
}
