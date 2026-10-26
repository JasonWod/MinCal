import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickCreate } from "../components/TrayPopup/QuickCreate";
import { useEventStore } from "../stores/eventStore";

afterEach(cleanup);

const titleBox = () => screen.getByPlaceholderText("事件标题...") as HTMLInputElement;

describe("托盘快速新建", () => {
  it("输入标题并创建 → 写入本地库（可见性 busy）", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuickCreate onClose={onClose} />);

    await user.type(titleBox(), "晨会");
    expect(titleBox().value).toBe("晨会");

    await user.click(screen.getByRole("button", { name: "创建" }));

    const s = useEventStore.getState();
    expect(s.events).toHaveLength(1);
    expect(s.events[0].title).toBe("晨会");
    expect(s.events[0].visibility).toBe("busy");
    expect(new Date(s.events[0].end_time).getTime() - new Date(s.events[0].start_time).getTime()).toBe(
      30 * 60 * 1000
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("空标题不创建（避免又产生一条“新事件”垃圾数据）", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuickCreate onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("选择时长后按所选时长创建", async () => {
    const user = userEvent.setup();
    render(<QuickCreate onClose={() => {}} />);
    await user.type(titleBox(), "长会");
    await user.selectOptions(screen.getByRole("combobox"), "60");
    await user.click(screen.getByRole("button", { name: "创建" }));
    const e = useEventStore.getState().events[0];
    expect(
      new Date(e.end_time).getTime() - new Date(e.start_time).getTime()
    ).toBe(60 * 60 * 1000);
  });

  it("未连接服务器时创建不触发任何网络请求", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const user = userEvent.setup();
    render(<QuickCreate onClose={() => {}} />);
    await user.type(titleBox(), "离线创建");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
