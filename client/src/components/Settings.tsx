import { ColorSwatch } from "./ColorSwatch";
import { useRef, useState } from "react";
import { useEventStore } from "../stores/eventStore";
import { useDialog } from "../hooks/useDialog";
import * as api from "../lib/api";
import { Globe, Clock, Palette, X, Unplug, Cable } from "lucide-react";

const COLORS = ["#4F46E5", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#EC4899"];

// A self-contained settings panel. Rendered as a centered overlay by its host
// (full window / tray popup). Two groups:
//   1. Local identity — always available, saved to localStorage (no server).
//   2. Server sync — OPTIONAL. Blank server = pure standalone mode.
export function Settings({ onClose }: { onClose: () => void }) {
  const { localUser, currentUser, syncEnabled, syncStatus, syncError, pendingCount, setLocalPrefs, setUser } = useEventStore();

  // Local identity fields
  const [displayName, setDisplayName] = useState(localUser.display_name);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [color, setColor] = useState(localUser.color);

  // Optional server / sync fields
  const [server, setServer] = useState(api.getServer());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [discardRequested, setDiscardRequested] = useState(false);
  const [disconnectRequested, setDisconnectRequested] = useState(false);
  const savedPrefs = useRef(JSON.stringify([displayName, color]));
  const savedConnection = useRef(JSON.stringify([server, username, password]));
  const requestClose = () => {
    if (loading) return;
    if (discardRequested) { setDiscardRequested(false); return; }
    if (JSON.stringify([displayName, color]) !== savedPrefs.current || JSON.stringify([server, username, password]) !== savedConnection.current) { setDiscardRequested(true); return; }
    onClose();
  };
  const dialogRef = useDialog(requestClose);
  const savePrefs = () => {
    try {
      setLocalPrefs({ display_name: displayName.trim() || "本地用户", timezone, color });
      savedPrefs.current = JSON.stringify([displayName.trim() || "本地用户", color]);
      setDisplayName(displayName.trim() || "本地用户");
      setMessage("个人信息已保存");
    } catch { setError("保存失败，请检查设备存储空间"); }
  };

  const handleConnect = async () => {
    if (!server.trim()) {
      setError("请填写服务器地址，或留空使用单机模式");
      return;
    }
    setLoading(true);
    setError("");
    try { const url = new URL(server.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); }
    catch { setError("请输入以 http:// 或 https:// 开头的服务器地址"); setLoading(false); return; }
    if (!username.trim() || !password) { setError("请填写用户名和密码"); setLoading(false); return; }
    const previousServer = api.getServer();
    api.setServer(server.trim());
    try {
      if (isRegister) {
        await api.auth.register({
          username,
          password,
          display_name: displayName || username,
        });
        setIsRegister(false);
      }
      const tokens = await api.auth.login({ username, password });
      api.setToken(tokens.access_token);
      const user = await api.auth.me();
      setUser(user); // flips syncEnabled -> true
      await useEventStore.getState().syncNow();
      savedConnection.current = JSON.stringify([server, username, password]);
    } catch (err: any) {
      api.clearToken();
      api.setServer(previousServer);
      setError(err?.message || "连接失败，请检查地址与网络");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    if (pendingCount && !disconnectRequested) { setDisconnectRequested(true); return; }
    setDisconnectRequested(false);
    useEventStore.getState().disconnect();
    setUsername("");
    setPassword("");
    setError("");
    savedConnection.current = JSON.stringify([server, "", ""]);
  };

  const connected = !!currentUser;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--scrim)" }}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        className="w-[360px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-secondary)",
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
          <button aria-label="关闭设置" className="pressable" style={{ color: "var(--text-tertiary)" }} onClick={requestClose}>
            <X size={14} />
          </button>
        </div>

        {discardRequested && <div role="alert" className="text-xs p-3">
          放弃未保存的设置？
          <button className="ml-2 underline" onClick={() => setDiscardRequested(false)}>继续编辑</button>
          <button className="ml-2 text-[color:var(--danger)]" onClick={onClose}>放弃修改</button>
        </div>}
        <div className="flex-1 overflow-y-auto px-4 space-y-5 pb-2">
          {/* 1. Local identity */}
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
              我的信息
            </div>
            <label className="text-xs text-text-2 mb-1 block">显示名称</label>
            <input
              type="text"
              aria-label="显示名称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
            <label className="text-xs text-text-2 mb-1 flex items-center gap-1">
              <Clock size={12} /> 时区
            </label>
            <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
              跟随设备：{timezone}。修改系统时区后重新打开应用。
            </p>
            <label className="text-xs text-text-2 mb-1 flex items-center gap-1">
              <Palette size={12} /> 我的颜色
            </label>
            <div className="flex gap-2 mb-2">
              {COLORS.map((c) => (
                <ColorSwatch
                  key={c}
                  color={c}
                  label={`个人颜色 ${c}`}
                  selected={color === c}
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
            {message && <p role="status" className="text-xs mt-2">{message}</p>}
          </div>

          <div className="h-px" style={{ background: "var(--border)" }} />

          {/* 2. Optional server sync */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Globe size={12} style={{ color: "var(--text-secondary)" }} />
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                同步（可选）
              </span>
            </div>

            <div
              className="text-xs px-2.5 py-1.5 rounded-lg mb-2"
              style={{
                background: "var(--bg-tertiary)",
                color: connected && syncStatus === "synced" ? "var(--success)" : "var(--text-tertiary)",
              }}
            >
              {connected
                ? `${currentUser!.display_name} · ${syncStatus === "synced" ? "已同步" : syncStatus === "syncing" ? "同步中" : "同步异常"} @ ${api.getServer()}`
                : syncEnabled ? "同步未连接，请检查网络或重新登录" : "单机模式 — 日程仅保存在此设备，无需联网"}
            </div>

            <label className="text-xs text-text-2 mb-1 block">服务器地址</label>
            <input
              type="text"
              disabled={connected || loading}
              aria-label="服务器地址"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="留空 = 单机模式，如 http://10.0.0.5:28091"
            />
            <input
              type="text"
              disabled={connected || loading}
              aria-label="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="用户名"
            />
            <input
              type="password"
              disabled={connected || loading}
              aria-label="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border outline-none mb-2"
              style={{ background: "var(--bg-tertiary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="密码"
            />

            {syncError && <p role="alert" className="text-xs text-[color:var(--danger)] mb-2">{syncError}（{pendingCount} 项待上传）</p>}
            {error && (
              <div className="text-xs px-2.5 py-1.5 rounded-lg mb-2" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                {error}
              </div>
            )}

            {connected ? (
              <div>
              <button className="w-full py-2 text-xs pressable" disabled={syncStatus === "syncing"} onClick={() => void useEventStore.getState().syncNow()}>重试同步</button>
              <button
                className="w-full py-2 rounded-lg text-xs pressable mb-1"
                style={{ color: "var(--danger)", border: "1px solid var(--border)" }}
                onClick={handleDisconnect}
              >
                <Unplug size={12} className="inline mr-1" /> {disconnectRequested ? "确认断开同步" : "断开同步"}
              </button>
              {disconnectRequested && <p role="alert" className="text-xs">还有修改未上传，断开后保留本机数据与待上传记录。
                <button className="ml-2 underline" onClick={() => setDisconnectRequested(false)}>取消断开</button>
              </p>}
              </div>
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
