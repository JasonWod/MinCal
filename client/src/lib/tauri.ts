// Tauri 窗口操作封装。
//
// 全部走“动态 import + try/catch”：在纯浏览器（vite dev 直接开网页）或权限
// 未授予（capabilities 缺失）时不会抛错打断 UI，只是退化成无效操作并在控制台
// 留痕，保证前端在任何环境都不白屏。

export interface WindowOps {
  showMain: () => Promise<boolean>;
  hideSelf: () => Promise<boolean>;
  inTauri: () => boolean;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function callWindow(label: string, action: "show" | "hide"): Promise<boolean> {
  if (!hasTauri()) return false;
  try {
    const mod = await import("@tauri-apps/api/webviewWindow");
    const win = await mod.WebviewWindow.getByLabel(label);
    if (!win) return false;
    if (action === "show") {
      await win.show();
      await win.setFocus();
    } else {
      await win.hide();
    }
    return true;
  } catch (err) {
    console.warn(`[MinCal] ${action} window '${label}' failed:`, err);
    return false;
  }
}

/** 显示并聚焦完整日历窗口（托盘 → 主窗口） */
export async function showMainWindow(): Promise<boolean> {
  return callWindow("main", "show");
}

/** 隐藏托盘弹层 */
export async function hideTrayPopup(): Promise<boolean> {
  return callWindow("tray-popup", "hide");
}

/** 隐藏主窗口（收进托盘） */
export async function hideMainWindow(): Promise<boolean> {
  return callWindow("main", "hide");
}

export const tauriOps: WindowOps = {
  showMain: showMainWindow,
  hideSelf: hideTrayPopup,
  inTauri: hasTauri,
};
