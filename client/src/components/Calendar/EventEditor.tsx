import { ColorSwatch } from "../ColorSwatch";
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
import { useDialog } from "../../hooks/useDialog";

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

  const [title, setTitle] = useState(draft.title ?? "");
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
  const [endStr, setEndStr] = useState(() => {
    if (!existing?.all_day) return toLocalInput(initEnd);
    const end = new Date(initEnd); end.setDate(end.getDate() - 1);
    return toLocalInput(end.toISOString());
  });
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(Boolean(draft.location || draft.description));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [saving, setSaving] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  const snapshot = JSON.stringify([title, location, description, color, visibility, allDay, startStr, endStr]);
  const initialSnapshot = useRef(snapshot);
  const requestClose = () => {
    if (saving) return;
    if (discardRequested) { setDiscardRequested(false); return; }
    if (snapshot !== initialSnapshot.current) { setDiscardRequested(true); return; }
    onClose();
  };
  const dialogRef = useDialog(requestClose);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // 打开即聚焦标题，确保“点开就能打字”
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    // 编辑已有标题时全选，方便直接覆盖输入
    if (!isCreate && el.value) el.select();
  }, [isCreate]);

  const handleSave = async () => {
    if (!isOwner || saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("标题不能为空");
      titleRef.current?.focus();
      return;
    }
    const startValue = allDay ? `${startStr.slice(0, 10)}T00:00` : startStr;
    const endDate = new Date(`${endStr.slice(0, 10)}T00:00`);
    endDate.setDate(endDate.getDate() + 1);
    const endValue = allDay ? (isNaN(endDate.getTime()) ? "" : toLocalInput(endDate.toISOString())) : endStr;
    const rangeErr = validateRange(startValue, endValue);
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
      start_time: fromLocalInput(startValue),
      end_time: fromLocalInput(endValue),
    };
    setSaving(true);
    try {
      if (isCreate) await localCreate(payload);
      else await localUpdate(existing!.id, payload);
      onClose();
    } catch {
      setError("保存失败，请检查设备存储空间后重试。输入内容已保留。");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!isOwner || !existing || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try { await localDelete(existing.id); onClose(); }
    catch { setError("删除失败，请重试。"); }
    finally { setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "var(--scrim)" }}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? "新建事件" : "编辑事件"}
        tabIndex={-1}
        className="max-h-[calc(100dvh-24px)] flex flex-col overflow-hidden rounded-2xl"
        style={{
          width: "min(420px, calc(100vw - 20px))",
          background: "var(--bg-secondary)",
          boxShadow: "var(--shadow-popup)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isCreate ? "新建事件" : "编辑事件"}
          </h3>
          <button
            onClick={requestClose}
            aria-label="关闭"
            className="pressable"
            style={{ color: "var(--text-tertiary)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 pb-3 space-y-3">
        {discardRequested && (
          <div role="alert" className="text-xs rounded-lg p-3 space-y-2" style={{ background: "var(--bg-tertiary)" }}>
            <p>放弃未保存的修改？</p>
            <button className="pressable mr-3" onClick={() => setDiscardRequested(false)}>继续编辑</button>
            <button className="pressable text-[color:var(--danger)]" onClick={onClose}>放弃修改</button>
          </div>
        )}
        {!isOwner && (
          <div
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
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
            disabled={!isOwner || saving}
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
              type={allDay ? "date" : "datetime-local"}
              value={allDay ? startStr.slice(0, 10) : startStr}
              disabled={!isOwner || saving}
              onChange={(e) => setStartStr(e.target.value)}
              aria-label="开始时间"
              className="w-full px-2 py-1.5 rounded-lg text-xs border outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>
              {allDay ? "结束日期（含当天）" : "结束"}
            </label>
            <input
              type={allDay ? "date" : "datetime-local"}
              value={allDay ? endStr.slice(0, 10) : endStr}
              disabled={!isOwner || saving}
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
            disabled={!isOwner || saving}
            onChange={(e) => {
              setAllDay(e.target.checked);
              if (!e.target.checked) {
                setStartStr(`${startStr.slice(0, 10)}T09:00`);
                setEndStr(`${endStr.slice(0, 10)}T09:30`);
              } else if (endStr.slice(0, 10) < startStr.slice(0, 10)) setEndStr(startStr);
            }}
            aria-label="全天"
          />
          全天事件
        </label>


        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>时间按设备时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        <button type="button" className="text-xs underline pressable" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "收起更多选项" : "更多选项（地点、描述、颜色）"}
        </button>
        <div hidden={!showDetails} className="space-y-3">
        {/* Location */}
        <input
          type="text"
          value={location}
          disabled={!isOwner || saving}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="地点…"
          aria-label="地点"
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
          style={inputStyle}
        />

        {/* Description */}
        <textarea
          value={description}
          disabled={!isOwner || saving}
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
              <ColorSwatch
                key={c.key}
                color={c.value}
                label={`颜色 ${c.key}`}
                selected={color === c.key}
                disabled={!isOwner || saving}
                onClick={() => setColor(c.key)}
              />
            ))}
          </div>
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
                  aria-pressed={visibility === v}
                  className={visibility === v ? "active" : ""}
                  onClick={() => setVisibility(v)}
                >
                  {v === "private" ? "私有" : v === "busy" ? "忙碌" : "公开"}
                </button>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
              {visibility === "private" ? "仅自己可见" : visibility === "busy" ? "同事只看到忙碌时段，看不到标题、地点和描述" : "同事可以查看标题、地点和描述"}
            </p>
          </div>
        )}

        {error && (
          <div role="alert"
            className="text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
          >
            {error}
          </div>
        )}

        </div>
        {/* Keep primary actions visible even when expanded content needs scrolling. */}
        <div className="shrink-0 flex gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            className="flex-1 py-2 rounded-lg text-xs font-medium pressable"
            style={{
              background: isOwner ? "var(--accent)" : "var(--bg-tertiary)",
              color: isOwner ? "#fff" : "var(--text-tertiary)",
            }}
            disabled={!isOwner || saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : isCreate ? "创建" : "保存"}
          </button>
          {isOwner && existing && (
            <button
              className="py-2 px-3 rounded-lg text-xs pressable"
              style={{
                background: confirmDelete ? "#B91C1C" : "var(--danger-soft)",
                color: confirmDelete ? "#fff" : "var(--danger)",
              }}
              disabled={saving}
              onClick={handleDelete}
            >
              {confirmDelete ? "确认删除" : "删除"} <Trash2 size={12} className="inline" />
            </button>
          )}
          <button
            className="py-2 px-3 rounded-lg text-xs pressable"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            onClick={requestClose}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

