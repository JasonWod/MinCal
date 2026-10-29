import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullCalendar } from "../components/Calendar";
import { TrayPopup } from "../components/TrayPopup";
import { Settings } from "../components/Settings";
import { useEventStore, disconnectWS } from "../stores/eventStore";
import * as api from "../lib/api";
import * as local from "../lib/localStore";

const calendar = vi.hoisted(() => ({ props: {} as any, today: vi.fn() }));
vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  return { default: React.forwardRef((props: any, ref: any) => {
    calendar.props = props;
    React.useImperativeHandle(ref, () => ({ getApi: () => ({ today: calendar.today }) }));
    return <button onClick={() => props.dateClick({ date: new Date(2027, 1, 12, 10), allDay: false })}>选择2月12日10点</button>;
  }) };
});
afterEach(() => { cleanup(); disconnectWS(); vi.unstubAllGlobals(); });
const user = { id: "u1", username: "tester", display_name: "测试用户", timezone: "UTC", color: "blue" };
const draft = { title: "测试日程", start_time: "2027-02-12T10:00:00Z", end_time: "2027-02-12T11:00:00Z" };

it("点击日历日期使用该格子的时间；已保存日程传给日历且禁用未实现的拖动", async () => {
  const input = userEvent.setup();
  await useEventStore.getState().localCreate(draft);
  render(<FullCalendar />);
  expect(calendar.props.events).toHaveLength(1);
  expect(calendar.props.events[0].editable).toBe(false);
  expect(calendar.props.slotMinTime).toBe("00:00:00");
  await input.click(screen.getByText("选择2月12日10点"));
  expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe("2027-02-12T10:00");
});

it("托盘显示跨夜日程，结束恰好在今日零点的日程不占用今日", async () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setHours(-1);
  const end = new Date(today); end.setHours(1);
  await useEventStore.getState().localCreate({ title: "跨夜会议", start_time: start.toISOString(), end_time: end.toISOString() });
  await useEventStore.getState().localCreate({ title: "昨天已结束", start_time: start.toISOString(), end_time: today.toISOString() });
  render(<TrayPopup />);
  expect(screen.getByText("跨夜会议")).toBeTruthy();
  expect(screen.queryByText("昨天已结束")).toBeNull();
});

it("他人日程右键只有查看入口，没有删除", async () => {
  await useEventStore.getState().localCreate(draft);
  useEventStore.setState({ selfId: "other" });
  // The chosen event date is independent of today.
  render(<FullCalendar />);
  const el = document.createElement("div"); document.body.append(el);
  calendar.props.eventDidMount({ el, event: { id: useEventStore.getState().events[0].id } });
  fireEvent.contextMenu(el);
  expect(screen.getByRole("menuitem", { name: "查看日程" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /删除/ })).toBeNull();
  el.remove();
});

it("本地落盘失败不把日程加入内存或发起同步", async () => {
  const push = vi.spyOn(api.sync, "push");
  vi.spyOn(local, "putLocalEvent").mockRejectedValueOnce(new Error("quota"));
  await expect(useEventStore.getState().localCreate(draft)).rejects.toThrow("quota");
  expect(useEventStore.getState().events).toHaveLength(0);
  expect(push).not.toHaveBeenCalled();
});

describe("同步失败与重试", () => {
  it.each(["conflict", "forbidden"])("%s 不显示已同步，队列持久保留；重试成功才移除", async (status) => {
    api.setServer("https://calendar.example.test");
    useEventStore.getState().setUser(user);
    vi.spyOn(api.sync, "push").mockResolvedValueOnce({ results: [{ id: "e1", status }] })
      .mockResolvedValueOnce({ results: [{ id: "e1", status: "created", version: 5 }] });
    vi.spyOn(api.sync, "pull").mockResolvedValue({ events: [], version: 5 });
    vi.stubGlobal("WebSocket", class { readyState = 1; close() {} });
    await useEventStore.getState().localCreate(draft);
    await useEventStore.getState().syncNow();
    expect(useEventStore.getState().syncStatus).toBe("error");
    expect(useEventStore.getState().pendingCount).toBe(1);
    const key = "mincal_pending:https://calendar.example.test:u1";
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
    await useEventStore.getState().syncNow();
    expect(useEventStore.getState().pendingCount).toBe(0);
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(0);
    expect(useEventStore.getState().syncStatus).toBe("synced");
  });

  it("HTTP 401 保留待上传记录，不显示已同步", async () => {
    api.setServer("https://calendar.example.test");
    api.setToken("expired-test-token");
    useEventStore.getState().setUser(user);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await useEventStore.getState().localCreate(draft);
    await useEventStore.getState().syncNow();
    expect(useEventStore.getState().syncStatus).toBe("error");
    expect(useEventStore.getState().pendingCount).toBe(1);
  });
});

it("设置显示真实同步状态、保存反馈，并约束键盘焦点", async () => {
  const input = userEvent.setup();
  useEventStore.getState().setUser(user);
  useEventStore.setState({ syncStatus: "offline" });
  const onClose = vi.fn();
  render(<Settings onClose={onClose} />);
  expect(screen.getByText(/跟随设备/)).toBeTruthy();
  await input.click(screen.getByRole("button", { name: "保存信息" }));
  expect(screen.getByRole("status").textContent).toContain("已保存");
  await input.click(screen.getByRole("button", { name: "同步设置" }));
  expect(screen.getByText(/同步异常/)).toBeTruthy();
  const close = screen.getByRole("button", { name: "关闭设置" });
  close.focus();
  await input.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /断开同步/ }));
});
