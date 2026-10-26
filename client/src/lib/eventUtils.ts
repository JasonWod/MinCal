// Pure helpers shared by the full calendar, the tray popup and the editor.
// Kept free of React / Tauri imports so they can be unit-tested directly.

import type { EventItem } from "./types";

/**
 * 该事件对“我”而言是否应显示为灰色“忙碌”。
 *
 * 只有“别人的 busy 事件”才应该被涂灰并把标题隐去；自己的 busy 事件
 * 必须显示真实标题（旧代码写成 `owner_id !== undefined`，导致自己的日程
 * 在托盘里也一律显示成 "Busy"）。
 */
export function isOtherBusy(
  event: Pick<EventItem, "visibility" | "owner_id">,
  selfId: string
): boolean {
  if (event.visibility !== "busy") return false;
  if (!selfId) return false;
  return event.owner_id !== selfId;
}

/**
 * 当前用户是否为该事件的所有者。
 * 单机模式下 selfId === "local"，本地新建的事件 owner_id 同样是 "local"，
 * 因此本地用户始终拥有对自己日程的编辑/删除权。
 */
export function isOwnerOf(
  event: Pick<EventItem, "owner_id">,
  selfId: string
): boolean {
  if (!event.owner_id || event.owner_id === "unknown") return true;
  return event.owner_id === selfId;
}

/** ISO 字符串 -> <input type="datetime-local"> 需要的 "YYYY-MM-DDTHH:mm"（本地时区） */
export function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" -> ISO 字符串（按本地时区解释） */
export function fromLocalInput(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

/**
 * 校验 datetime-local 的起止串。
 * @returns 错误信息；合法时返回 null
 */
export function validateRange(startLocal: string, endLocal: string): string | null {
  const s = new Date(startLocal);
  const e = new Date(endLocal);
  if (!startLocal || isNaN(s.getTime())) return "开始时间无效";
  if (!endLocal || isNaN(e.getTime())) return "结束时间无效";
  if (e.getTime() <= s.getTime()) return "结束时间必须晚于开始时间";
  return null;
}

/** 事件是否与 [start, end) 区间重叠（脏数据兜底：end < start 时按 start 计） */
export function overlapsRange(
  event: Pick<EventItem, "start_time" | "end_time">,
  start: Date,
  end: Date
): boolean {
  const s = new Date(event.start_time).getTime();
  if (isNaN(s)) return false;
  let e = new Date(event.end_time).getTime();
  if (isNaN(e) || e < s) e = s;
  return s < end.getTime() && e >= start.getTime();
}

/** 把标题安全地截断成一行显示 */
export function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** 生成一个“就近半小时”的默认开始时间（用于新建事件） */
export function nextHalfHour(from: Date = new Date()): Date {
  const d = new Date(from);
  const m = d.getMinutes();
  d.setSeconds(0, 0);
  d.setMinutes(m <= 30 ? 30 : 60);
  return d;
}
