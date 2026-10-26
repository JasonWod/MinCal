import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  useContextMenuStore,
  type MenuEntry,
  type MenuItemAction,
} from "../stores/menuStore";

// 应用内自定义右键菜单。
//
// ContextMenuLayer 挂在每个窗口根部，职责有两层：
//  1) 全局拦截 `contextmenu`，永远阻止 WebView2 的浏览器默认菜单
//     （返回 / 重新加载 / 打印 / 检查 这类让普通用户困惑的项）。
//  2) 渲染 MinCal 自己的菜单。业务组件在自己的 onContextMenu 里调用
//     showContextMenu() 并 stopPropagation，即可给出上下文相关菜单；
//     落到空白处时用 defaultEntries 兜底。

const MENU_MIN_WIDTH = 176;
const ITEM_HEIGHT = 28;

function isItem(entry: MenuEntry): entry is MenuItemAction {
  return entry.kind === "item";
}

export function ContextMenuLayer({
  defaultEntries,
}: {
  /** 空白处右键时的兜底菜单项（懒求值，保证拿到最新状态） */
  defaultEntries?: () => MenuEntry[];
}) {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const entries = useContextMenuStore((s) => s.entries);
  const close = useContextMenuStore((s) => s.close);
  const show = useContextMenuStore((s) => s.show);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const defaultsRef = useRef(defaultEntries);
  defaultsRef.current = defaultEntries;
  const activeIndexRef = useRef(0);

  // 1) 全局接管右键事件：浏览器默认菜单永不出现在用户面前。
  //    菜单已打开时再次右键 = 把菜单移到新位置（而不是叠出第二层，也不是关掉）。
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const items = defaultsRef.current ? defaultsRef.current() : [];
      if (items.length > 0) show(items, e.clientX, e.clientY);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [show]);

  // 2) 关闭时机：点击别处 / Esc / 窗口失焦 / 滚动 / 缩放 + 方向键导航
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest("[data-ctx-menu]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const items = useContextMenuStore.getState().entries.filter(isItem);
      if (items.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        let next = activeIndexRef.current;
        for (let i = 0; i < items.length; i++) {
          next = (next + dir + items.length) % items.length;
          if (!items[next].disabled) break;
        }
        activeIndexRef.current = next;
        const els = menuRef.current?.querySelectorAll<HTMLElement>("[data-ctx-item]");
        els?.[next]?.focus();
      } else if (e.key === "Enter") {
        const els = menuRef.current?.querySelectorAll<HTMLElement>("[data-ctx-item]");
        els?.[activeIndexRef.current]?.click();
      }
    };
    const onHide = () => close();

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onHide);
    window.addEventListener("resize", onHide);
    window.addEventListener("scroll", onHide, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onHide);
      window.removeEventListener("resize", onHide);
      window.removeEventListener("scroll", onHide, true);
    };
  }, [open, close]);


  // 3) 防止菜单超出窗口可视区域
  useLayoutEffect(() => {
    if (!open) return;
    activeIndexRef.current = 0;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(x, vw - rect.width - 8));
    const top = Math.max(8, Math.min(y, vh - rect.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, x, y, entries]);

  if (!open) return null;

  const runEntry = (entry: MenuItemAction) => {
    if (entry.disabled) return;
    close();
    entry.onClick();
  };

  const items = entries.filter(isItem);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="上下文菜单"
      data-ctx-menu="true"
      tabIndex={-1}
      className="fixed z-[9999] py-1 rounded-lg"
      style={{
        left: x,
        top: y,
        minWidth: MENU_MIN_WIDTH,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-popup)",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {entries.map((entry, idx) =>
        entry.kind === "separator" ? (
          <div key={`sep-${idx}`} className="my-1 h-px" style={{ background: "var(--border)" }} />
        ) : (
          <button
            key={entry.id}
            role="menuitem"
            data-ctx-item={entry.id}
            disabled={entry.disabled}
            tabIndex={-1}
            onClick={() => runEntry(entry)}
            className="w-full flex items-center justify-between gap-3 px-3 text-left text-xs"
            style={{
              height: ITEM_HEIGHT,
              color: entry.disabled
                ? "var(--text-tertiary)"
                : entry.danger
                ? "#EF4444"
                : "var(--text-primary)",
              opacity: entry.disabled ? 0.5 : 1,
              cursor: entry.disabled ? "not-allowed" : "default",
            }}
            onMouseEnter={(e) => {
              if (entry.disabled) return;
              activeIndexRef.current = items.indexOf(entry);
              e.currentTarget.style.background = entry.danger
                ? "rgba(239,68,68,0.12)"
                : "var(--accent-soft)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span className="truncate">{entry.label}</span>
            {entry.shortcut && (
              <span style={{ color: "var(--text-tertiary)" }}>{entry.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
