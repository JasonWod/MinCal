import { useEffect, useRef, useState } from "react";
import FullCalendarView from "@fullcalendar/react";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import interaction from "@fullcalendar/interaction";
import zhLocale from "@fullcalendar/core/locales/zh-cn";
import { useEventStore } from "../../stores/eventStore";
import { EventEditor, type EditorTarget } from "./EventEditor";
import { Settings } from "../Settings";
import { ContextMenuLayer } from "../ContextMenu";
import { showContextMenu, eventMenuEntries, item, sep } from "../../stores/menuStore";
import { isOtherBusy, nextHalfHour } from "../../lib/eventUtils";
import type { EventItem } from "../../lib/types";
import { Plus, Settings as SettingsIcon, Users } from "lucide-react";

const COLOR_MAP: Record<string, string> = {
  blue: "#4F46E5",
  green: "#10B981",
  orange: "#F59E0B",
  purple: "#8B5CF6",
  red: "#EF4444",
  pink: "#EC4899",
};

/** 把 store 事件转换成 FullCalendar 需要的结构（含他人 busy 的脱敏显示） */
export function toCalendarEvent(e: EventItem, selfId: string) {
  const masked = isOtherBusy(e, selfId);
  return {
    id: e.id,
    title: masked ? "忙碌" : e.title,
    start: e.start_time,
    end: e.end_time,
    allDay: e.all_day,
    backgroundColor: masked ? "#8E8E93" : COLOR_MAP[e.color ?? "blue"] ?? "#4F46E5",
    borderColor: masked ? "#8E8E93" : COLOR_MAP[e.color ?? "blue"] ?? "#4F46E5",
    textColor: "#FFFFFF",
    editable: !masked,
  };
}

export function FullCalendar() {
  const { events, syncStatus, currentUser, selfId } = useEventStore();
  const calendarRef = useRef<any>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);

  // 用 ref 保存最新事件，让日历回调（dateClick / eventClick）里始终读到最新数据，
  // 避免闭包里拿到旧的 events 数组导致“点了没反应 / 改不到东西”。
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const findByFcId = (id: string): EventItem | undefined =>
    eventsRef.current.find((e) => e.id === id);

  const openCreate = (start?: Date) => {
    const s = start ?? nextHalfHour();
    const end = new Date(s.getTime() + 30 * 60 * 1000);
    setEditorTarget({
      mode: "create",
      draft: {
        start_time: s.toISOString(),
        end_time: end.toISOString(),
        visibility: "busy",
      },
    });
  };

  const openEdit = (ev: EventItem) => setEditorTarget({ mode: "edit", event: ev });
  const deleteEvent = (ev: EventItem) => useEventStore.getState().localDelete(ev.id);

  /** 取 FullCalendar 实例（React ref → getCalendar()） */
  const fc = (): any => {
    const host: any = calendarRef.current;
    if (!host) return null;
    return typeof host.getCalendar === "function" ? host.getCalendar() : host;
  };

  // 同步事件到日历。注意：不再按“当前月”预过滤 —— FullCalendar 会按当前视图
  // 区间自行渲染，预过滤会导致切到上一月 / 周视图时看不到事件。
  useEffect(() => {
    const cal = fc();
    if (!cal || typeof cal.removeAllEvents !== "function") return;
    cal.removeAllEvents();
    events.forEach((e) => cal.addEvent(toCalendarEvent(e, selfId), false));
  }, [events, selfId]);

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      {/* Top Bar */}
      <div
        className="flex items-center justify-between px-4 h-12 border-b"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "var(--accent)" }}
          >
            <CalendarLogo />
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            MinCal
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
            style={{ background: "var(--bg-tertiary)" }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background:
                  syncStatus === "local"
                    ? "#8E8E93"
                    : syncStatus === "synced"
                    ? "#10B981"
                    : syncStatus === "syncing"
                    ? "#F59E0B"
                    : "#EF4444",
              }}
            />
            <span style={{ color: "var(--text-tertiary)" }}>
              {syncStatus === "local"
                ? "本地"
                : syncStatus === "synced"
                ? "已同步"
                : syncStatus === "syncing"
                ? "同步中"
                : "离线"}
            </span>
          </div>
          <button
            className="p-1.5 rounded-lg pressable"
            style={{ color: "var(--text-secondary)" }}
            aria-label="新建事件"
            title="新建事件"
            onClick={() => openCreate()}
          >
            <Plus size={18} />
          </button>
          <button
            className="p-1.5 rounded-lg pressable"
            style={{ color: "var(--text-secondary)" }}
            aria-label="团队"
            title={currentUser ? `已登录：${currentUser.display_name}` : "未连接同步服务器"}
          >
            <Users size={18} />
          </button>
          <button
            className="p-1.5 rounded-lg pressable"
            style={{ color: "var(--text-secondary)" }}
            aria-label="设置"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 min-h-0 p-3">
        <div
          id="calendar-root"
          className="h-full rounded-xl p-3 overflow-hidden"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            ["--fc-border-color" as string]: "var(--border)",
            ["--fc-today-bg-color" as string]: "var(--accent-soft)",
            ["--fc-page-bg-color" as string]: "var(--bg-secondary)",
          }}
        >
          <FullCalendarView
            ref={calendarRef}
            plugins={[dayGrid, timeGrid, interaction]}
            initialView="timeGridWeek"
            locale={zhLocale}
            height="100%"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            nowIndicator={true}
            weekNumbers={false}
            firstDay={1}
            dayMaxEvents={3}
            moreLinkText="更多"
            slotDuration="00:30:00"
            snapDuration="00:15:00"
            eventMinHeight={18}
            displayEventTime={true}
            displayEventEnd={true}
            // 点击空白格 → 直接弹出“新建事件”，不再静默创建“新事件”
            dateClick={(info: any) => openCreate(info.start)}
            eventClick={(info: any) => {
              const ev = findByFcId(info.event.id);
              if (ev) openEdit(ev);
            }}
            // 右键日程 → 自定义菜单（编辑 / 删除），阻止浏览器默认菜单。
            // FullCalendar 6 免费版没有 eventContextMenu 选项，改为在元素挂载时
            // 直接绑定 contextmenu 监听。
            eventDidMount={(info: any) => {
              info.el.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const ev = findByFcId(info.event.id);
                if (!ev) return;
                showContextMenu(
                  eventMenuEntries(ev, { onEdit: openEdit, onDelete: deleteEvent }),
                  e.clientX,
                  e.clientY
                );
              });
            }}
          />
        </div>
      </div>

      {/* Event Editor（新建 / 编辑） */}
      {editorTarget && (
        <EventEditor target={editorTarget} onClose={() => setEditorTarget(null)} />
      )}

      {/* Settings overlay */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* 主窗口自定义右键菜单，屏蔽 WebView2 默认浏览器菜单 */}
      <ContextMenuLayer
        defaultEntries={() => [
          item("create", "新建事件…", () => openCreate(), { shortcut: "点击空白" }),
          item(
            "today",
            "回到今天",
            () => fc()?.today()
          ),
          sep(),
          item(
            "sync",
            syncStatus === "local" ? "未启用同步（单机模式）" : "立即重新同步",
            () => {
              if (syncStatus !== "local") void useEventStore.getState().syncNow();
            },
            { disabled: syncStatus === "local" }
          ),
          item("settings", "设置…", () => setShowSettings(true)),
        ]}
      />
    </div>
  );
}

function CalendarLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

