import type { MouseEvent } from "react";
import type { EventItem as EventItemType } from "../../lib/types";
import { useEventStore } from "../../stores/eventStore";
import { isOtherBusy } from "../../lib/eventUtils";
import { parseISO, format } from "date-fns";
import { Lock } from "lucide-react";

const COLOR_MAP: Record<string, string> = {
  blue: "#4F46E5",
  green: "#10B981",
  orange: "#F59E0B",
  purple: "#8B5CF6",
  red: "#EF4444",
  pink: "#EC4899",
};

export function EventItem({
  event,
  isToday,
  onEdit,
  onMenu,
}: {
  event: EventItemType;
  isToday: boolean;
  onEdit?: (event: EventItemType) => void;
  onMenu?: (event: EventItemType, e: MouseEvent) => void;
}) {
  const selfId = useEventStore((s) => s.selfId);
  const start = parseISO(event.start_time);
  const end = parseISO(event.end_time);
  const color = event.color || "blue";
  const barColor = COLOR_MAP[color] || "#4F46E5";

  // 只有“别人的 busy 事件”才涂灰并隐去标题；自己的始终显示真实标题。
  const isBusy = isOtherBusy(event, selfId);
  // 别人的私有事件不展示；自己的私有事件照常展示（带锁标记）。
  const isOwn = event.owner_id === selfId;
  const isOthersPrivate = event.visibility === "private" && !isOwn;

  if (isOthersPrivate) return null;

  const isOwnPrivate = event.visibility === "private" && isOwn;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`事件 ${event.title}`}
      className="flex items-center gap-2 px-2 py-2 rounded-lg card-hover pressable"
      style={{ background: isBusy ? "var(--bg-tertiary)" : "transparent" }}
      onClick={() => onEdit?.(event)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit?.(event);
        }
      }}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onMenu(event, e);
      }}
    >
      {/* Color bar */}
      <div
        className="event-bar h-6"
        style={{ background: isBusy ? "var(--text-tertiary)" : barColor }}
      />

      {/* Time */}
      <div className="flex flex-col min-w-[50px]">
        <span
          className="text-xs font-medium"
          style={{ color: isBusy ? "var(--text-tertiary)" : "var(--text-primary)" }}
        >
          {format(start, "HH:mm")}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {format(end, "HH:mm")}
        </span>
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <span
          className="text-sm truncate block"
          style={{
            color: isBusy ? "var(--text-tertiary)" : "var(--text-primary)",
            fontWeight: isToday ? 500 : 400,
          }}
        >
          {isBusy ? "忙碌" : event.title}
          {isOwnPrivate && (
            <Lock size={10} className="inline ml-1" style={{ color: "var(--text-tertiary)" }} />
          )}
        </span>
        {event.location && !isBusy && (
          <span className="text-xs truncate block" style={{ color: "var(--text-tertiary)" }}>
            {event.location}
          </span>
        )}
      </div>
    </div>
  );
}
