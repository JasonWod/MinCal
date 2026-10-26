import { create } from "zustand";
import type { EventItem, User, SyncStatus, PushResult } from "../lib/types";
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
//  - Every local mutation writes to memory AND IndexedDB immediately.
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
  localCreate: (data: Record<string, unknown>) => void;
  localUpdate: (id: string, data: Record<string, unknown>) => void;
  localDelete: (id: string) => void;

  // Sync (optional, only when connected)
  syncNow: () => Promise<void>;
  doPull: () => Promise<void>;
  pushLocalChange: (op: "create" | "update" | "delete", data: Record<string, unknown>) => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let initStarted = false;

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

    localCreate: (data) => {
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
      get().addEvent(event);
      void putLocalEvent(event); // persist offline copy
      if (get().syncEnabled) get().pushLocalChange("create", { ...data, id: event.id });
    },

    localUpdate: (id, data) => {
      const existing = get().events.find((e) => e.id === id);
      if (!existing) return;
      const updated: EventItem = {
        ...existing,
        ...(data as Partial<EventItem>),
        updated_at: new Date().toISOString(),
        version: existing.version + 1,
      };
      get().updateEvent(updated);
      void putLocalEvent(updated);
      if (get().syncEnabled) get().pushLocalChange("update", { ...data, id, version: existing.version });
    },

    localDelete: (id) => {
      get().deleteEvent(id);
      void deleteLocalEvent(id);
      if (get().syncEnabled) get().pushLocalChange("delete", { id });
    },

    syncNow: async () => {
      if (!get().syncEnabled) return;
      set({ syncStatus: "syncing" });
      try {
        await get().doPull();
        connectWS();
      } catch {
        set({ syncStatus: "offline" });
      }
    },

    doPull: async () => {
      if (!get().syncEnabled) return;
      try {
        const { version, selfId } = get();
        const result = await api.sync.pull(version);
        // Merge remote into local: keep local as source of truth, fold in new
        // / newer remote rows, never drop locally-authored events.
        const map = new Map<string, EventItem>(get().events.map((e) => [e.id, e]));
        for (const r of result.events) {
          if (r.deleted) continue;
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
          syncStatus: "synced",
          lastSyncAt: Date.now(),
        });
        void putAllLocalEvents(visible); // refresh offline copy
      } catch {
        set({ syncStatus: "offline" });
      }
    },

    pushLocalChange: (op, data) => {
      if (!get().syncEnabled) return;
      set((s) => ({ pendingCount: s.pendingCount + 1, syncStatus: "syncing" }));
      // 令牌走 Authorization 头，不再拼进 URL（避免落入服务端/代理访问日志）
      fetch(`${api.getServer()}/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${api.getToken()}`,
        },
        body: JSON.stringify([{ op, data }]),
      })
        .then((r) => r.json())
        .then((res: PushResult) => {
          set((s) => ({ pendingCount: Math.max(0, s.pendingCount - 1) }));
          if (res.results?.[0]?.status === "created" || res.results?.[0]?.status === "updated") {
            get().doPull();
          } else if (get().syncEnabled) {
            set({ syncStatus: "synced" });
          }
        })
        .catch(() => set({ syncStatus: "offline" }));
    },

    disconnect: () => {
      api.clearToken();
      ws?.close();
      ws = null;
      set({ currentUser: null, syncEnabled: false, syncStatus: "local", pendingCount: 0 });
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
    ws.onopen = () => useEventStore.setState({ syncStatus: "synced" });
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
  ws?.close();
  ws = null;
}
