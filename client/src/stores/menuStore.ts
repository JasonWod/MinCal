// 应用内自定义右键菜单的状态。
//
// 目的：彻底接管 WebView2 的“浏览器默认右键菜单”（返回/重新加载/打印/检查
// 等），换成 MinCal 自己的 macOS 风格菜单。任何组件都可以调用
// `showContextMenu(entries, x, y)` 给出当前上下文专属的菜单项。

import { isOwnerOf } from "../lib/eventUtils";
import { useEventStore } from "./eventStore";
import { create } from "zustand";
import type { EventItem } from "../lib/types";

export interface MenuItemAction {
  kind: "item";
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onClick: () => void;
}

export interface MenuSeparator {
  kind: "separator";
}

export type MenuEntry = MenuItemAction | MenuSeparator;

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  entries: MenuEntry[];
  show: (entries: MenuEntry[], x: number, y: number) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  entries: [],
  show: (entries, x, y) => set({ open: true, entries, x, y }),
  close: () => set({ open: false }),
}));

/** 供非组件代码（事件回调里）使用的同步查询 */
export function contextMenuIsOpen(): boolean {
  return useContextMenuStore.getState().open;
}

export function showContextMenu(
  entries: MenuEntry[],
  x: number,
  y: number
): void {
  if (entries.length === 0) return;
  useContextMenuStore.getState().show(entries, x, y);
}

export function closeContextMenu(): void {
  useContextMenuStore.getState().close();
}

export function sep(): MenuSeparator {
  return { kind: "separator" };
}

export function item(
  id: string,
  label: string,
  onClick: () => void,
  opts: { danger?: boolean; disabled?: boolean; shortcut?: string } = {}
): MenuItemAction {
  return { kind: "item", id, label, onClick, ...opts };
}

/** 针对某个日程的标准菜单项（编辑 / 删除） */
export function eventMenuEntries(
  event: EventItem,
  handlers: { onEdit: (e: EventItem) => void; onDelete: (e: EventItem) => void }
): MenuEntry[] {
  const own = isOwnerOf(event, useEventStore.getState().selfId);
  return [
    item("edit", own ? "编辑事件" : "查看日程", () => handlers.onEdit(event)),
    ...(own ? [item("delete", "删除事件…", () => handlers.onDelete(event), { danger: true })] : []),
  ];
}
