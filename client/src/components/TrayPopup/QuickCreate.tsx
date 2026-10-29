import { useState } from "react";
import { useEventStore } from "../../stores/eventStore";
import { X } from "lucide-react";
import { format, addMinutes } from "date-fns";

export function QuickCreate({ onClose, date = new Date() }: { onClose: () => void; date?: Date }) {
  const { localCreate } = useEventStore();
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(format(new Date(), "HH:mm"));
  const [duration, setDuration] = useState("30");
  const [day, setDay] = useState(format(date, "yyyy-MM-dd"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) { setError("请输入事件标题"); return; }

    const now = new Date(`${day}T00:00`);
    const [h, m] = startTime.split(":").map(Number);
    const start = new Date(now);
    start.setHours(h, m, 0, 0);
    if (!day || !startTime || isNaN(start.getTime())) { setError("请选择有效日期与时间"); return; }
    const end = addMinutes(start, parseInt(duration));
    setSaving(true);
    try {
      await localCreate({
      title: title.trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      visibility: "busy",
      });
      onClose();
    } catch { setError("保存失败，输入内容已保留，请重试"); }
    finally { setSaving(false); }
  };

  return (
    <div
      className="mx-3 mb-2 p-3 rounded-xl space-y-2"
      style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>快速新建</span>
        <button aria-label="关闭快速新建" disabled={saving} onClick={() => { if (title.trim()) setDiscardRequested(true); else onClose(); }} className="pressable" style={{ color: "var(--text-tertiary)" }}>
          <X size={14} />
        </button>
      </div>
      {discardRequested && <div role="alert" className="text-xs">
        放弃未保存的日程？
        <button className="ml-2 underline" onClick={() => setDiscardRequested(false)}>继续编辑</button>
        <button className="ml-2 text-[color:var(--danger)]" onClick={onClose}>放弃修改</button>
      </div>}
      <form onSubmit={handleCreate} className="space-y-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="事件标题..."
          className="w-full px-2 py-1.5 rounded-md text-sm border outline-none"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
          autoFocus
        />
        <label className="block text-xs">日期
          <input aria-label="日程日期" type="date" required value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded-md p-1" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }} />
        </label>
        <div className="flex gap-2">
          <input
            type="time"
            required
            aria-label="开始时间"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-md text-sm border outline-none"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
          />
          <select
            aria-label="时长"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="px-2 py-1.5 rounded-md text-sm border outline-none"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            <option value="15">15m</option>
            <option value="30">30m</option>
            <option value="60">1h</option>
            <option value="90">1.5h</option>
            <option value="120">2h</option>
          </select>
        </div>
        {error && <p role="alert" className="text-xs text-[color:var(--danger)]">{error}</p>}
        <button
          disabled={saving}
          type="submit"
          className="w-full py-1.5 rounded-md text-xs font-medium text-white pressable"
          style={{ background: "var(--accent)" }}
        >
          {saving ? "保存中…" : "创建"}
        </button>
      </form>
    </div>
  );
}
