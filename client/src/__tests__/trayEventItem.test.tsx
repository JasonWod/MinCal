import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EventItem } from "../components/TrayPopup/EventItem";
import type { EventItem as EventItemType } from "../lib/types";

afterEach(cleanup);

function ev(over: Partial<EventItemType> = {}): EventItemType {
  return {
    id: "e1",
    owner_id: "local",
    title: "产品评审",
    start_time: "2026-10-26T02:00:00.000Z",
    end_time: "2026-10-26T03:00:00.000Z",
    visibility: "busy",
    all_day: false,
    created_at: "2026-10-26T01:00:00.000Z",
    updated_at: "2026-10-26T01:00:00.000Z",
    version: 1,
    ...over,
  };
}

describe("托盘事件卡片：脱敏逻辑（回归：自己的日程被显示成 Busy）", () => {
  it("自己的 busy 事件显示真实标题", () => {
    render(<EventItem event={ev({ visibility: "busy", owner_id: "local" })} isToday={false} />);
    expect(screen.getByText(/产品评审/)).toBeTruthy();
    expect(screen.queryByText("忙碌")).toBeNull();
  });

  it("同事的 busy 事件只显示“忙碌”，不泄露标题", () => {
    render(<EventItem event={ev({ owner_id: "u-9", title: "机密面谈" })} isToday={false} />);
    expect(screen.getByText("忙碌")).toBeTruthy();
    expect(screen.queryByText(/机密面谈/)).toBeNull();
  });

  it("同事的 private 事件完全不渲染", () => {
    const { container } = render(
      <EventItem event={ev({ owner_id: "u-9", visibility: "private" })} isToday={false} />
    );
    expect(container.textContent).toBe("");
  });

  it("自己的 private 事件正常显示（带锁标记）", () => {
    render(<EventItem event={ev({ visibility: "private" })} isToday />);
    expect(screen.getByText(/产品评审/)).toBeTruthy();
  });

  it("public 事件始终显示真实标题", () => {
    render(<EventItem event={ev({ owner_id: "u-9", visibility: "public" })} isToday={false} />);
    expect(screen.getByText(/产品评审/)).toBeTruthy();
  });
});

describe("托盘事件卡片：交互入口", () => {
  it("左键点击 → 触发编辑回调", () => {
    const onEdit = vi.fn();
    render(<EventItem event={ev()} isToday={false} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /产品评审/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe("e1");
  });

  it("右键 → 自定义菜单回调，且阻止浏览器默认菜单", () => {
    const onMenu = vi.fn();
    render(<EventItem event={ev()} isToday={false} onMenu={onMenu} />);
    const el = screen.getByRole("button", { name: /产品评审/ });
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 42,
      clientY: 24,
    });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect((onMenu.mock.calls[0][1] as any).clientX).toBe(42);
  });

  it("键盘 Enter 也可打开编辑", () => {
    const onEdit = vi.fn();
    render(<EventItem event={ev()} isToday={false} onEdit={onEdit} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /产品评审/ }), { key: "Enter" });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
