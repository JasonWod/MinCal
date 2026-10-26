// 全局测试环境准备：
//  - fake-indexeddb 提供 IndexedDB（本地优先存储依赖）
//  - 每个用例前清空 localStorage / store / 菜单状态，保证用例互不干扰
//  - 补齐 jsdom 缺失的 crypto.randomUUID
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { useEventStore } from "../stores/eventStore";
import { useContextMenuStore } from "../stores/menuStore";

if (!globalThis.crypto || typeof (globalThis.crypto as any).randomUUID !== "function") {
  let counter = 0;
  (globalThis as any).crypto = {
    ...(globalThis.crypto ?? {}),
    randomUUID: () => `test-uuid-${(++counter).toString().padStart(4, "0")}`,
  } as any;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as any).matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* jsdom 提供 localStorage，理论上不会失败 */
  }
  useContextMenuStore.getState().close();
  useEventStore.setState({
    events: [],
    users: [],
    currentUser: null,
    selfId: "local",
    localUser: {
      id: "local",
      display_name: "本地用户",
      timezone: "Asia/Shanghai",
      color: "#4F46E5",
    },
    syncEnabled: false,
    syncStatus: "local",
    version: 0,
    pendingCount: 0,
    lastSyncAt: null,
    initialized: true,
  });
});
