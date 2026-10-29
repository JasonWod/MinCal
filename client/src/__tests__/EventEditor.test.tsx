import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventEditor } from "../components/Calendar/EventEditor";
import { useEventStore } from "../stores/eventStore";
import type { EventItem } from "../lib/types";

afterEach(cleanup);

function makeEvent(over: Partial<EventItem> = {}): EventItem {
  return {
    id: "ev-1",
    owner_id: "local",
    title: "写错的标题",
    description: "",
    start_time: "2026-10-26T02:00:00.000Z",
    end_time: "2026-10-26T03:00:00.000Z",
    location: "",
    color: "blue",
    visibility: "busy",
    all_day: false,
    created_at: "2026-10-26T01:00:00.000Z",
    updated_at: "2026-10-26T01:00:00.000Z",
    version: 1,
    ...over,
  };
}

const titleInput = () => screen.getByLabelText("事件标题") as HTMLInputElement;

describe("EventEditor 新建模式（回归：点“新增”无法录入文字）", () => {
  it("可以输入标题并创建成功", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);

    await user.type(titleInput(), "团队周会");
    expect(titleInput().value).toBe("团队周会");

    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const ev = useEventStore.getState().events[0];
    expect(ev.title).toBe("团队周会");
    expect(ev.owner_id).toBe("local");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("打开时标题输入框自动获得焦点（点开就能打字）", () => {
    render(<EventEditor target={{ mode: "create" }} onClose={() => {}} />);
    expect(document.activeElement).toBe(titleInput());
  });

  it("空标题不允许提交，并给出提示", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByText("标题不能为空")).toBeTruthy();
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("结束时间不晚于开始时间时拒绝保存", async () => {
    const user = userEvent.setup();
    render(<EventEditor target={{ mode: "create" }} onClose={() => {}} />);
    await user.type(titleInput(), "时间倒挂");
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-10-26T15:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-10-26T14:00" },
    });
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByText(/结束时间必须晚于开始时间/)).toBeTruthy();
    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it("标题输入框按 Enter 直接保存", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);
    await user.type(titleInput(), "回车新建{enter}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useEventStore.getState().events[0].title).toBe("回车新建");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EventEditor 编辑模式（回归：错误录入的条目无法修改/删除）", () => {
  it("单机模式下自己的事件：可改标题并保存", async () => {
    const user = userEvent.setup();
    const ev = makeEvent();
    await useEventStore.getState().localCreate({
      title: ev.title,
      start_time: ev.start_time,
      end_time: ev.end_time,
    });
    const created = useEventStore.getState().events[0];

    render(<EventEditor target={{ mode: "edit", event: created }} onClose={() => {}} />);
    expect(titleInput().value).toBe("写错的标题");

    await user.clear(titleInput());
    await user.type(titleInput(), "改对的标题");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(useEventStore.getState().events[0].title).toBe("改对的标题"));
    const after = useEventStore.getState().events[0];
    expect(after.title).toBe("改对的标题");
    expect(after.version).toBe(created.version + 1);
  });

  it("单机模式下自己的事件：删除按钮可见且两步确认后删除成功", async () => {
    const user = userEvent.setup();
    await useEventStore.getState().localCreate({
      title: "待删除",
      start_time: "2026-10-26T02:00:00.000Z",
      end_time: "2026-10-26T03:00:00.000Z",
    });
    const created = useEventStore.getState().events[0];
    const onClose = vi.fn();
    render(<EventEditor target={{ mode: "edit", event: created }} onClose={onClose} />);

    const delBtn = screen.getByRole("button", { name: /删除/ });
    await user.click(delBtn);
    expect(useEventStore.getState().events).toHaveLength(1); // 第一步只确认
    await user.click(screen.getByRole("button", { name: /确认删除/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it("他人事件为只读：显示提示、禁用保存、无删除入口", () => {
    const other = makeEvent({ id: "ev-2", owner_id: "u-9", title: "同事的日程" });
    render(<EventEditor target={{ mode: "edit", event: other }} onClose={() => {}} />);
    expect(screen.getByText(/仅创建者可以修改/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /删除/ })).toBeNull();
    expect((titleInput() as HTMLInputElement).disabled).toBe(true);
  });
});

it("新建不显示删除；全天事件使用包含结束日期并保存为次日零点", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);
  expect(screen.queryByRole("button", { name: /删除/ })).toBeNull();
  await user.type(titleInput(), "全天出差");
  await user.click(screen.getByLabelText("全天"));
  fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "2027-02-12" } });
  fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "2027-02-13" } });
  await user.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const event = useEventStore.getState().events[0];
  expect(event.all_day).toBe(true);
  expect(new Date(event.start_time).getHours()).toBe(0);
  expect(new Date(event.end_time).getDate()).toBe(14);
});

it("有改动时关闭需确认，取消放弃会保留输入", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);
  await user.type(titleInput(), "未保存草稿");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("放弃未保存的修改？")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(onClose).not.toHaveBeenCalled();
  expect(titleInput().value).toBe("未保存草稿");
});

it("本地存储失败时保留编辑器和输入，允许重试", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  vi.spyOn(useEventStore.getState(), "localCreate").mockRejectedValueOnce(new Error("quota"));
  render(<EventEditor target={{ mode: "create" }} onClose={onClose} />);
  await user.type(titleInput(), "不能丢的草稿");
  await user.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存失败"));
  expect(onClose).not.toHaveBeenCalled();
  expect(titleInput().value).toBe("不能丢的草稿");
  await user.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
