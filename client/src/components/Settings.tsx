import { useState } from "react";
import { useEventStore } from "../stores/eventStore";
import * as api from "../lib/api";
import { Globe, Clock, Palette, X, Unplug, Cable } from "lucide-react";

const COLORS = ["#4F46E5", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#EC4899"];

// A self-contained settings panel. Rendered as a centered overlay by its host
// (full window / tray popup). Two groups:
//   1. Local identity — always available, saved to localStorage (no server).
//   2. Server sync — OPTIONAL. Blank server = pure standalone mode.
export function Settings({ onClose }: { onClose: () => void }) {
  const { localUser, currentUser, syncStatus, setLocalPrefs, setUser } = useEventStore();

  // Local identity fields
  const [displayName, setDisplayName] = useState(localUser.display_name);
  const [timezone, setTimezone] = useState(localUser.timezone);
  const [color, setColor] = useState(localUser.color);

  // Optional server / sync fields
  const [server, setServer] = useState(api.getServer());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const savePrefs = () => setLocalPrefs({ display_name: displayName, timezone, color });

  const handleConnect = async () => {
    if (!server.trim()) {
      setError("请填写服务器地址，或留空使用单机模式");
      return;
    }
    setLoading(true);
    setError("");
    api.setServer(server);
    try {
      if (isRegister) {
        await api.auth.register({
          username,
          password,
          display_name: displayName || username,
        });
      }
      const tokens = await api.auth.login({ username, password });
      api.setToken(tokens.access_token);
      const user = await api.auth.me();
      setUser(user); // flips syncEnabled -> true
      useEventStore.getState().syncNow();
    } catch (err: any) {
      setError(err?.message || "连接失败，请检查地址与网络");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    useEventStore.getState().disconnect();
    setUsername("");
    setPassword("");
    setError("");
  };

  const connected = !!currentUser;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.25)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="w-[360px] max-h-[520px] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--glass-bg)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
          boxShadow: "var(--shadow-popup)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            设置
          </span>
          <button className="pressable" style={{ color: "var(--text-tertiary)" }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-5 pb-2">
          {/* 1. Local identity */}
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>
              我的信息
            </div>
            <label className="text-xs text-text-2 mb-1 block">显示名称</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
            <label className="text-xs text-text-2 mb-1 flex items-center gap-1">
              <Clock size={12} /> 时区
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York</option>
            </select>
            <label className="text-xs text-text-2 mb-1 flex items-center gap-1">
              <Palette size={12} /> 我的颜色
            </label>
            <div className="flex gap-2 mb-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className="w-6 h-6 rounded-full pressable"
                  style={{
                    background: c,
                    opacity: color === c ? 1 : 0.4,
                    transform: color === c ? "scale(1.2)" : "scale(1)",
                    transition: "all 120ms ease",
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <button
              className="w-full py-2 rounded-lg text-xs font-medium text-white pressable"
              style={{ background: "var(--accent)" }}
              onClick={savePrefs}
            >
              保存信息
            </button>
          </div>

          <div className="h-px" style={{ background: "var(--border)" }} />

          {/* 2. Optional server sync */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Globe size={12} style={{ color: "var(--text-2)" }} />
              <span className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                同步（可选）
              </span>
            </div>

            <div
              className="text-xs px-2.5 py-1.5 rounded-lg mb-2"
              style={{
                background: "var(--bg-tertiary)",
                color: connected ? "#10B981" : "var(--text-tertiary)",
              }}
            >
              {connected
                ? `已连接：${currentUser!.display_name} @ ${server}`
                : "单机模式 — 日程仅保存在此设备，无需联网"}
            </div>

            <label className="text-xs text-text-2 mb-1 block">服务器地址</label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="留空 = 单机模式，如 http://10.0.0.5:28091"
            />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="用户名"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="密码"
            />

            {error && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg mb-2" style={{ background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
                {error}
              </div>
            )}

            {connected ? (
              <button
                className="w-full py-2 rounded-lg text-xs pressable mb-1"
                style={{ color: "#EF4444", border: "1px solid var(--border)" }}
                onClick={handleDisconnect}
              >
                <Unplug size={12} className="inline mr-1" /> 断开同步
              </button>
            ) : (
              <>
                <button
                  className="w-full py-2 rounded-lg text-xs font-medium text-white pressable mb-1"
                  style={{ background: "var(--accent)", opacity: loading ? 0.7 : 1 }}
                  disabled={loading}
                  onClick={handleConnect}
                >
                  <Cable size={12} className="inline mr-1" />
                  {loading ? "连接中…" : isRegister ? "注册并连接" : "登录并连接"}
                </button>
                <button
                  className="w-full py-1.5 text-xs pressable"
                  style={{ color: "var(--text-tertiary)" }}
                  onClick={() => setIsRegister(!isRegister)}
                >
                  {isRegister ? "已有账号？切换登录" : "新用户？切换注册"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
