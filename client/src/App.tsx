import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TrayPopup } from "./components/TrayPopup";
import { FullCalendar } from "./components/Calendar";
import { useEventStore } from "./stores/eventStore";
import * as api from "./lib/api";

// Both Tauri windows load the same index.html, so the URL hash can't tell them
// apart. Use the real window label instead; fall back to hash for browser dev.
function getWindowMode(): "tray" | "main" {
  try {
    const label = getCurrentWindow().label;
    if (label === "main") return "main";
    if (label === "tray-popup") return "tray";
  } catch {
    /* not in a Tauri webview (plain browser) — use the hash below */
  }
  const hash = window.location.hash.replace("#/", "").replace("#", "");
  return hash === "main" ? "main" : "tray";
}

function App() {
  const [mode, setMode] = useState(getWindowMode);
  useEffect(() => {
    const update = () => setMode(getWindowMode());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const initialized = useEventStore((s) => s.initialized);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore saved server URL (harmless if empty = pure local mode).
    const saved = localStorage.getItem("mincal_server");
    if (saved) api.setServer(saved);

    // Local-first boot: load IndexedDB, then sync only if a server is set.
    let mounted = true;
    useEventStore
      .getState()
      .init()
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !initialized) {
    return (
      <div
        className="w-full h-screen flex items-center justify-center"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="text-text-2 text-sm animate-pulse">MinCal</div>
      </div>
    );
  }

  // No login wall — the calendar is always usable. Settings is an overlay
  // inside each window (see FullCalendar / TrayPopup).
  switch (mode) {
    case "main":
      return <FullCalendar />;
    default:
      return <TrayPopup />;
  }
}

export { App };
