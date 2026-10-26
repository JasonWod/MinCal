import { useState } from "react";
import { useEventStore } from "../../stores/eventStore";
import { X } from "lucide-react";
import { format, addMinutes } from "date-fns";

export function QuickCreate({ onClose }: { onClose: () => void }) {
  const { localCreate } = useEventStore();
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(format(new Date(), "HH:mm"));
  const [duration, setDuration] = useState("30");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = new Date();
    const [h, m] = startTime.split(":").map(Number);
    const start = new Date(now);
    start.setHours(h, m, 0, 0);
    const end = addMinutes(start, parseInt(duration));

    localCreate({
      title: title.trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      visibility: "busy",
    });
    onClose();
  };

  return (
    <div
      className="mx-3 mb-2 p-3 rounded-xl space-y-2"
      style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>快速新建</span>
        <button onClick={onClose} className="pressable" style={{ color: "var(--text-tertiary)" }}>
          <X size={14} />
        </button>
      </div>
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
        <div className="flex gap-2">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-md text-sm border outline-none"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
          />
          <select
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
        <button
          type="submit"
          className="w-full py-1.5 rounded-md text-xs font-medium text-white pressable"
          style={{ background: "var(--accent)" }}
        >
          创建
        </button>
      </form>
    </div>
  );
}
