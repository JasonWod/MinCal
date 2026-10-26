import { describe, it, expect, vi } from "vitest";
import { useEventStore } from "../stores/eventStore";
import { getAllLocalEvents } from "../lib/localStore";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
/** 等待 IndexedDB 的 fire-and-forget 写入落盘 */
async function flush(times = 10) {
  for (let i = 0; i < times; i++) await tick(5);
}

describe("eventStore 单机模式（无服务器、无账号）", () => {
  it("localCreate 立刻写入内存，owner 归属本机，version=1", () => {
    useEventStore.getState().localCreate({
      title: "评审会",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
      visibility: "busy",
    });
    const s = useEventStore.getState();
    expect(s.events).toHaveLength(1);
    expect(s.events[0].title).toBe("评审会");
    expect(s.events[0].owner_id).toBe("local");
    expect(s.events[0].version).toBe(1);
  });

  it("标题为空时回退为“新事件”，不会创建空条目", () => {
    useEventStore.getState().localCreate({
      title: "",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    expect(useEventStore.getState().events[0].title).toBe("新事件");
  });

  it("未开启同步时，任何本地操作都不发起网络请求", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    useEventStore.getState().localCreate({
      title: "离线事件",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    useEventStore.getState().localUpdate(useEventStore.getState().events[0].id, { title: "改个名" });
    useEventStore.getState().localDelete(useEventStore.getState().events[0].id);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("每次变更都同步落盘到 IndexedDB（重启后数据仍在）", async () => {
    useEventStore.getState().localCreate({
      title: "需要持久化",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    const id = useEventStore.getState().events[0].id;
    await flush();
    const stored = await getAllLocalEvents();
    expect(stored.map((e) => e.id)).toContain(id);
    expect(stored.find((e) => e.id === id)!.title).toBe("需要持久化");
  });

  it("localUpdate 递增 version、刷新 updated_at 并落盘", async () => {
    useEventStore.getState().localCreate({
      title: "原名",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    const id = useEventStore.getState().events[0].id;
    const before = useEventStore.getState().events[0];
    useEventStore.getState().localUpdate(id, { title: "改名后", location: "会议室A" });
    const after = useEventStore.getState().events[0];

    expect(after.title).toBe("改名后");
    expect(after.location).toBe("会议室A");
    expect(after.version).toBe(before.version + 1);
    expect(after.created_at).toBe(before.created_at);

    await flush();
    const stored = await getAllLocalEvents();
    expect(stored.find((e) => e.id === id)!.title).toBe("改名后");
  });

  it("localUpdate 一个不存在的 id：安全无副作用，不抛异常", () => {
    expect(() => useEventStore.getState().localUpdate("no-such-id", { title: "x" })).not.toThrow();
    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it("localDelete 同时清掉内存与 IndexedDB", async () => {
    useEventStore.getState().localCreate({
      title: "要删掉的",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    const id = useEventStore.getState().events[0].id;
    await flush();
    useEventStore.getState().localDelete(id);
    expect(useEventStore.getState().events).toHaveLength(0);
    await flush();
    const stored = await getAllLocalEvents();
    expect(stored.map((e) => e.id)).not.toContain(id);
  });

  it("开启同步后本地变更会推送到服务器队列", () => {
    useEventStore.setState({ syncEnabled: true });
    const spy = vi.spyOn(useEventStore.getState(), "pushLocalChange").mockImplementation(() => {});
    useEventStore.getState().localCreate({
      title: "同步事件",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    expect(spy).toHaveBeenCalledWith("create", expect.objectContaining({ title: "同步事件" }));
  });

  it("修改显示名不会改变本机身份 id（selfId 始终 local，避免历史事件失去所有权）", () => {
    useEventStore.getState().setLocalPrefs({ display_name: "张三" });
    const s = useEventStore.getState();
    expect(s.localUser.display_name).toBe("张三");
    expect(s.selfId).toBe("local");
  });
});
