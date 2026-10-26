import { useEffect, useRef, useState } from "react";
import type { EventItem } from "../../lib/types";
import { useEventStore } from "../../stores/eventStore";
import {
  isOwnerOf,
  toLocalInput,
  fromLocalInput,
  validateRange,
  nextHalfHour,
} from "../../lib/eventUtils";
import { X, Trash2, Lock } from "lucide-react";
import { contextMenuIsOpen } from "../../stores/menuStore";

const COLORS = [
  { key: "blue", value: "#4F46E5" },
  { key: "green", value: "#10B981" },
  { key: "orange", value: "#F59E0B" },
  { key: "purple", value: "#8B5CF6" },
  { key: "red", value: "#EF4444" },
  { key: "pink", value: "#EC4899" },
];

/** 编辑器目标：新建（带草稿默认值）或编辑既有事件 */
export type EditorTarget =
  | { mode: "create"; draft?: Partial<EventItem> }
  | { mode: "edit"; event: EventItem };

const inputStyle = {
  background: "var(--bg-tertiary)",
  borderColor: "var(--border)",
  color: "var(--text-primary)",
} as const;

export function EventEditor({
  target,
  onClose,
}: {
  target: EditorTarget;
  onClose: () => void;
}) {
  const { localCreate, localUpdate, localDelete, selfId } = useEventStore();
  const isCreate = target.mode === "create";
  const existing = target.mode === "edit" ? target.event : null;
  const draft = target.mode === "create" ? target.draft ?? {} : target.event;

  // 单机模式下 selfId === "local"，本地事件 owner_id 也是 "local" → 一定可编辑。
  const isOwner = isCreate || isOwnerOf(existing!, selfId);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [color, setColor] = useState(draft.color ?? "blue");
  const [visibility, setVisibility] = useState<EventItem["visibility"]>(
    draft.visibility ?? "busy"
  );
  const [allDay, setAllDay] = useState<boolean>(draft.all_day ?? false);
  // 新建时若调用方没给默认时间，兜底为“下一个整点半 + 30 分钟”，
  // 避免出现空时间导致“点创建没反应”。
  const fallbackStart = nextHalfHour().toISOString();
  const fallbackEnd = new Date(new Date(fallbackStart).getTime() + 30 * 60 * 1000).toISOString();
  const initStart = draft.start_time || fallbackStart;
  const initEnd = draft.end_time || fallbackEnd;
  const [startStr, setStartStr] = useState(() => toLocalInput(initStart));
  const [endStr, setEndStr] = useState(() => toLocalInput(initEnd));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleRef = useRef<HTMLInputElement | null>(null);

  // 打开即聚焦标题，确保“点开就能打字”
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    // 编辑已有标题时全选，方便直接覆盖输入
    if (!isCreate && el.value) el.select();
  }, [isCreate]);

  // Esc 关闭（若此刻正开着右键菜单，只关菜单，不关编辑器）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !contextMenuIsOpen()) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = () => {
    if (!isOwner) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("标题不能为空");
      titleRef.current?.focus();
      return;
    }
    const rangeErr = validateRange(startStr, endStr);
    if (rangeErr) {
      setError(rangeErr);
      return;
    }
    const payload: Record<string, unknown> = {
      title: trimmed,
      location: location.trim(),
      description: description.trim(),
      color,
      visibility,
      all_day: allDay,
      start_time: fromLocalInput(startStr),
      end_time: fromLocalInput(endStr),
    };
    if (isCreate) localCreate(payload);
    else localUpdate(existing!.id, payload);
    onClose();
  };

  const handleDelete = () => {
    if (!isOwner || !existing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    localDelete(existing.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[min(560px,calc(100vh-16px))] overflow-y-auto rounded-2xl p-4 space-y-3"
        style={{
          width: "min(420px, calc(100vw - 20px))",
          background: "var(--bg-secondary)",
          boxShadow: "var(--shadow-popup)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isCreate ? "新建事件" : "编辑事件"}
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="pressable"
            style={{ color: "var(--text-tertiary)" }}
          >
            <X size={16} />
          </button>
        </div>

        {!isOwner && (
          <div
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(245,158,11,0.12)", color: "#B45309" }}
          >
            <Lock size={12} />
            只读：这是其他同事的日程，仅创建者可以修改
          </div>
        )}

        {/* Title */}
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
            标题（必填）
          </label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            disabled={!isOwner}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="例如：产品评审 / 与客户午餐"
            aria-label="事件标题"
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
            style={inputStyle}
          />
        </div>

        {/* Time */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
              开始
            </label>
            <input
              type="datetime-local"
              value={startStr}
              disabled={!isOwner}
              onChange={(e) => setStartStr(e.target.value)}
              aria-label="开始时间"
              className="w-full px-2 py-1.5 rounded-lg text-xs border outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
              结束
            </label>
            <input
              type="datetime-local"
              value={endStr}
              disabled={!isOwner}
              onChange={(e) => setEndStr(e.target.value)}
              aria-label="结束时间"
              className="w-full px-2 py-1.5 rounded-lg text-xs border outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={allDay}
            disabled={!isOwner}
            onChange={(e) => setAllDay(e.target.checked)}
            aria-label="全天"
          />
          全天事件
        </label>


        {/* Location */}
        <input
          type="text"
          value={location}
          disabled={!isOwner}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="地点…"
          aria-label="地点"
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
          style={inputStyle}
        />

        {/* Description */}
        <textarea
          value={description}
          disabled={!isOwner}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述…"
          rows={3}
          aria-label="描述"
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
          style={inputStyle}
        />

        {/* Color */}
        <div>
          <label className="text-xs mb-2 block" style={{ color: "var(--text-secondary)" }}>
            颜色
          </label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c.key}
                aria-label={`颜色 ${c.key}`}
                disabled={!isOwner}
                className="w-6 h-6 rounded-full pressable"
                style={{
                  background: c.value,
                  opacity: color === c.key ? 1 : 0.4,
                  transform: color === c.key ? "scale(1.2)" : "scale(1)",
                  transition: "all 120ms ease",
                }}
                onClick={() => setColor(c.key)}
              />
            ))}
          </div>
        </div>

        {/* Visibility */}
        {isOwner && (
          <div>
            <label className="text-xs mb-2 block" style={{ color: "var(--text-secondary)" }}>
              可见性
            </label>
            <div className="segmented">
              {(["private", "busy", "public"] as const).map((v) => (
                <button
                  key={v}
                  className={visibility === v ? "active" : ""}
                  onClick={() => setVisibility(v)}
                >
                  {v === "private" ? "私有" : v === "busy" ? "忙碌" : "公开"}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div
            className="text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            className="flex-1 py-2 rounded-lg text-xs font-medium pressable"
            style={{
              background: isOwner ? "var(--accent)" : "var(--bg-tertiary)",
              color: isOwner ? "#fff" : "var(--text-tertiary)",
            }}
            disabled={!isOwner}
            onClick={handleSave}
          >
            {isCreate ? "创建" : "保存"}
          </button>
          {isOwner && (
            <button
              className="py-2 px-3 rounded-lg text-xs pressable"
              style={{
                background: confirmDelete ? "#EF4444" : "rgba(239,68,68,0.1)",
                color: confirmDelete ? "#fff" : "#EF4444",
              }}
              onClick={handleDelete}
            >
              {confirmDelete ? "确认删除" : "删除"} <Trash2 size={12} className="inline" />
            </button>
          )}
          <button
            className="py-2 px-3 rounded-lg text-xs pressable"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

