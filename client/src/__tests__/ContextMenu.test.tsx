import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ContextMenuLayer } from "../components/ContextMenu";
import { showContextMenu, item, sep, useContextMenuStore, type MenuEntry } from "../stores/menuStore";

afterEach(() => {
  cleanup();
  act(() => useContextMenuStore.getState().close());
});

function setup(entries: MenuEntry[] = [item("a", "菜单A", vi.fn()), item("b", "菜单B", vi.fn())]) {
  return render(
    <div data-testid="host">
      <ContextMenuLayer defaultEntries={() => entries} />
    </div>
  );
}

const ctxEvent = (target: Element, x = 100, y = 50) => {
  const e = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  // 事件是从 React 外部派发的，需要 act() 让 store 更新同步刷到 DOM
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};

describe("右键菜单：屏蔽浏览器默认菜单", () => {
  it("在窗口空白处右键 → 浏览器默认菜单被 preventDefault", () => {
    setup();
    const e = ctxEvent(screen.getByTestId("host"));
    expect(e.defaultPrevented).toBe(true);
  });

  it("右键后出现的是应用自定义菜单，且带无障碍角色 menu/menuitem", () => {
    setup();
    ctxEvent(screen.getByTestId("host"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getAllByRole("menuitem").length).toBe(2);
    expect(screen.getByText("菜单A")).toBeTruthy();
  });

  it("点击菜单项 → 执行动作并立即关闭", () => {
    const onClick = vi.fn();
    setup([item("a", "编辑事件", onClick), item("b", "删除事件", onClick, { danger: true })]);
    ctxEvent(screen.getByTestId("host"));
    fireEvent.click(screen.getByText("编辑事件"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    setup();
    ctxEvent(screen.getByTestId("host"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("点击菜单外区域关闭菜单", () => {
    setup();
    ctxEvent(screen.getByTestId("host"));
    fireEvent.pointerDown(screen.getByTestId("host"), { bubbles: true });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("再次右键（菜单已开）不会叠加出第二个菜单", () => {
    setup();
    const host = screen.getByTestId("host");
    ctxEvent(host);
    ctxEvent(host);
    expect(screen.getAllByRole("menu").length).toBe(1);
  });

  it("没有兜底菜单项时不渲染空菜单", () => {
    setup([]);
    ctxEvent(screen.getByTestId("host"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("业务自定义菜单优先：组件内部自行 showContextMenu 后不再被默认菜单覆盖", () => {
    render(
      <div data-testid="host">
        <button
          data-testid="ev"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu([item("x", "针对该日程的编辑", () => {})], 10, 10);
          }}
        >
          日程
        </button>
        <ContextMenuLayer defaultEntries={() => [item("d", "默认菜单", () => {})]} />
      </div>
    );
    ctxEvent(screen.getByTestId("ev"));
    expect(screen.getByText("针对该日程的编辑")).toBeTruthy();
    expect(screen.queryByText("默认菜单")).toBeNull();
  });

  it("分隔线不产生可点击项", () => {
    setup([item("a", "A", () => {}), sep(), item("b", "B", () => {})]);
    ctxEvent(screen.getByTestId("host"));
    expect(screen.getAllByRole("menuitem").length).toBe(2);
  });
});

it("输入框保留系统右键编辑菜单", () => {
  render(<><input aria-label="标题" /><ContextMenuLayer defaultEntries={() => [item("new", "新建", () => {})]} /></>);
  const e = ctxEvent(screen.getByLabelText("标题"));
  expect(e.defaultPrevented).toBe(false);
  expect(screen.queryByRole("menu")).toBeNull();
});
