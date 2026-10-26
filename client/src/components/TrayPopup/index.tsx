import { useState } from "react";
import { useEventStore } from "../../stores/eventStore";
import { EventItem as EventItemCard } from "./EventItem";
import { QuickCreate } from "./QuickCreate";
import { EventEditor, type EditorTarget } from "../Calendar/EventEditor";
import { ContextMenuLayer } from "../ContextMenu";
import { showContextMenu, eventMenuEntries, item, sep } from "../../stores/menuStore";
import { showMainWindow } from "../../lib/tauri";
import { Calendar, Plus, Settings as SettingsIcon, X, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, isSameDay, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Settings } from "../Settings";
import type { EventItem } from "../../lib/types";

export function TrayPopup() {
  const { events, syncStatus, pendingCount, currentUser } = useEventStore();
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [baseDate, setBaseDate] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);

  const openEdit = (ev: EventItem) => setEditorTarget({ mode: "edit", event: ev });
  const openMenuFor = (ev: EventItem, e: { clientX: number; clientY: number }) =>
    showContextMenu(
      eventMenuEntries(ev, {
        onEdit: openEdit,
        onDelete: (x) => useEventStore.getState().localDelete(x.id),
      }),
      e.clientX,
      e.clientY
    );

  // Get events for a specific day, grouped
  const getEventsForDay = (day: Date) => {
    return events
      .filter((e) => {
        const start = parseISO(e.start_time);
        return isSameDay(start, day);
      })
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  };

  // Show today + next 2 days
  const days = [baseDate, addDays(baseDate, 1), addDays(baseDate, 2)];

  return (
    <div
      className="w-[360px] h-[480px] flex flex-col rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        boxShadow: "var(--shadow-popup)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {format(baseDate, "M月d日 EEEE", { locale: zhCN })}
          </span>
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {format(baseDate, "yyyy")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded-md pressable"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setBaseDate(addDays(baseDate, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="p-1 rounded-md pressable"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setBaseDate(addDays(baseDate, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="p-1 rounded-md pressable"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setShowQuickCreate(!showQuickCreate)}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Quick Create */}
      {showQuickCreate && <QuickCreate onClose={() => setShowQuickCreate(false)} />}

      {/* Event List */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1">
        {days.map((day) => {
          const dayEvents = getEventsForDay(day);
          return (
            <div key={day.toISOString()}>
              <div
                className="text-xs font-medium px-2 py-1.5 sticky top-0"
                style={{
                  color: isSameDay(day, new Date()) ? "var(--accent)" : "var(--text-tertiary)",
                  background: "var(--glass-bg)",
                }}
              >
                {isSameDay(day, new Date()) ? "今天" : format(day, "M月d日 EEE", { locale: zhCN })}
                {dayEvents.length > 0 && (
                  <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>({dayEvents.length})</span>
                )}
              </div>
              {dayEvents.length === 0 ? (
                <div className="text-xs px-3 py-2" style={{ color: "var(--text-tertiary)" }}>
                  暂无安排
                </div>
              ) : (
                dayEvents.map((e) => (
                  <EventItemCard
                    key={e.id}
                    event={e}
                    isToday={isSameDay(parseISO(e.start_time), new Date())}
                    onEdit={openEdit}
                    onMenu={openMenuFor}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: syncStatus === "local" ? "#8E8E93" : syncStatus === "synced" ? "#10B981" : syncStatus === "syncing" ? "#F59E0B" : "#EF4444",
            }}
          />
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {syncStatus === "local" ? "本地" : syncStatus === "synced" ? "已同步" : syncStatus === "syncing" ? "同步中" : "离线"}
            {pendingCount > 0 && ` (${pendingCount} 待同步)`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs pressable flex items-center gap-1"
            style={{ color: "var(--text-tertiary)" }}
            onClick={async () => {
              // 通过 Tauri 打开完整日历窗口；纯浏览器环境下退化为 hash 路由
              const ok = await showMainWindow();
              if (!ok) window.location.hash = "#/main";
            }}
          >
            <Calendar size={12} />
            日历
          </button>
          <button
            className="text-xs pressable"
            style={{ color: "var(--text-tertiary)" }}
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={12} />
          </button>
        </div>
      </div>

      {/* Settings overlay */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* 事件编辑器：点击 / 右键 → 编辑，可直接修改标题与时间 */}
      {editorTarget && (
        <EventEditor target={editorTarget} onClose={() => setEditorTarget(null)} />
      )}

      {/* 托盘窗口自己的右键菜单，屏蔽 WebView2 默认浏览器菜单 */}
      <ContextMenuLayer
        defaultEntries={() => [
          item("quick_create", "快速新建事件", () => setShowQuickCreate(true)),
          item("open_main", "打开完整日历", () => {
            void showMainWindow();
          }),
          sep(),
          item("settings", "设置…", () => setShowSettings(true)),
        ]}
      />
    </div>
  );
}
