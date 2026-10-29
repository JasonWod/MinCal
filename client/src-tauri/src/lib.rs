use std::io::Write;
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Wry, WebviewWindow,
};

// ---------------------------------------------------------------------------
// 诊断日志：GUI 版没有控制台，eprintln 无处可见，因此同时把关键信息追加到
// %LOCALAPPDATA%\MinCal\mincal.log，便于排障（“双击无反应”这类问题）。
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
fn log_file_path() -> Option<std::path::PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::Path::new(&base).join("MinCal");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("mincal.log"))
}
#[cfg(not(target_os = "windows"))]
fn log_file_path() -> Option<std::path::PathBuf> {
    None
}

fn log(msg: &str) {
    eprintln!("[MinCal] {}", msg);
    if let Some(path) = log_file_path() {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "[MinCal] {}", msg);
        }
    }
}

// ---------------------------------------------------------------------------
// WebView2 运行库：Tauri/wry 在 Windows 上强依赖 WebView2 Runtime。用户机器若
// 没装（Windows 11 并非都预装），CoreWebView2Environment 创建会失败，程序在
// 建窗口阶段就崩掉 → 表现为“双击无任何反应”。这里在启动前自动检测并安装。
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod wv2 {
    use super::log;
    use std::path::PathBuf;
    use std::process::Command;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    // WebView2 Evergreen 运行库在注册表里登记的客户端 GUID（微软官方检测法）
    const GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    fn read_pv(hive: &RegKey, path: &str) -> bool {
        hive.open_subkey_with_flags(path, KEY_READ)
            .ok()
            .and_then(|k| k.get_value::<String, _>("pv").ok())
            .is_some()
    }

    /// 判断系统是否已安装 WebView2 运行库（查 HKLM 与 HKCU 的登记项）。
    pub fn is_installed() -> bool {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let wow = format!(
            "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{}",
            GUID
        );
        let plain = format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{}", GUID);
        if read_pv(&hklm, &wow) || read_pv(&hklm, &plain) {
            return true;
        }
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let cu = format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{}", GUID);
        read_pv(&hkcu, &cu)
    }

    fn exe_dir() -> Option<PathBuf> {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    }

    /// 在本程序所在目录里找捆绑的 WebView2 安装器（Evergreen Bootstrapper）。
    fn bootstrapper() -> Option<PathBuf> {
        let dir = exe_dir()?;
        let candidates = [
            "MicrosoftEdgeWebview2Setup.exe",
            "WebView2RuntimeSetup.exe",
            "安装WebView2运行库.exe",
        ];
        for name in candidates {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
        None
    }

    fn marker() -> Option<PathBuf> {
        exe_dir().map(|d| d.join(".wv2_ready"))
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 原生 Windows 消息框（user32::MessageBoxW）——GUI 版无控制台，用它把错误告诉用户。
    pub fn msgbox(title: &str, body: &str) {
        let t = wide(title);
        let b = wide(body);
        // MB_OK(0) | MB_ICONWARNING(0x30) | MB_SETFOREGROUND(0x10000)
        unsafe {
            wv2_messagebox_w(std::ptr::null(), b.as_ptr(), t.as_ptr(), 0x30 | 0x10000);
        }
    }

    #[link(name = "user32")]
    extern "system" {
        #[link_name = "MessageBoxW"]
        fn wv2_messagebox_w(
            hwnd: *const std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            mbs: u32,
        ) -> i32;
    }

    /// 确保 WebView2 运行库可用；缺失则用捆绑安装器自动安装。
    pub fn ensure() {
        if is_installed() {
            if let Some(m) = marker() {
                let _ = std::fs::write(&m, "ok");
            }
            return; // 已安装，直接放行
        }

        log("WebView2 运行库未检测到，尝试自动安装…");

        match bootstrapper() {
            Some(bp) => {
                log(&format!(
                    "运行捆绑安装器: {}  /silent /install",
                    bp.display()
                ));
                let status = Command::new(bp.as_os_str())
                    .args(["/silent", "/install"])
                    .status();
                let ok = status.map(|s| s.success()).unwrap_or(false);
                log(&format!("安装器退出 ok={}", ok));

                // 安装可能是异步/脱离前台的，轮询等待运行库真正出现在注册表（最多 ~240s）。
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
                loop {
                    if is_installed() {
                        break;
                    }
                    if std::time::Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }

                if is_installed() {
                    if let Some(m) = marker() {
                        let _ = std::fs::write(&m, "ok");
                    }
                    log("WebView2 运行库安装完成。");
                } else {
                    log("WebView2 自动安装未完成（可能无网络或安装器被拦截）。");
                    let msg = "MinCal 需要 Microsoft Edge WebView2 运行库，自动安装未能完成。\n\n请手动安装：\n  1) 确认电脑已联网；\n  2) 双击本目录下的「安装WebView2运行库.exe」，等待其完成（约 30 秒到 2 分钟）；\n  3) 装完再重新双击 MinCal.exe。\n\n详细日志：%LOCALAPPDATA%\\MinCal\\mincal.log";
                    msgbox("MinCal 缺少 WebView2 运行库", msg);
                }
            }
            None => {
                log("未找到捆绑的 WebView2 安装器，提示用户手动安装。");
                let msg = "MinCal 需要 Microsoft Edge WebView2 运行库，且当前目录找不到自动安装器。\n\n请先到微软官网安装 WebView2：\n  https://developer.microsoft.com/en-us/microsoft-edge/webview2/\n（在“下载最新的 Stable 版”里选 x64），装完再运行 MinCal。";
                msgbox("MinCal 缺少 WebView2 运行库", msg);
            }
        }
    }
}
#[cfg(not(target_os = "windows"))]
mod wv2 {
    pub fn ensure() {}
    pub fn msgbox(_t: &str, _b: &str) {}
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log("=== run() starting ===");
    log(&format!(
        "version = {}, target_os = {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    ));

    // 启动前先确保 WebView2 运行库存在（否则建窗口会直接失败、无界面）。
    #[cfg(target_os = "windows")]
    wv2::ensure();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app: &mut App| {
            let has_icon = app.default_window_icon().is_some();
            log(&format!(
                "setup: entering; default_window_icon present = {}",
                has_icon
            ));
            if !has_icon {
                log("setup: WARNING no default window icon; tray may lack icon");
            }

            // --- Tray menu ---
            let toggle_popup =
                MenuItem::with_id(app, "toggle_popup", "显示/隐藏日历", true, None::<&str>)?;
            let open_main =
                MenuItem::with_id(app, "open_main", "打开完整日历", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出 MinCal", true, None::<&str>)?;

            let items: [&dyn IsMenuItem<Wry>; 4] =
                [&toggle_popup, &open_main, &separator, &quit];
            let menu = Menu::with_items(app, &items)?;

            log("setup: building system tray...");
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle_popup" => toggle_window(app, "tray-popup"),
                    "open_main" => show_window(app, "main"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_window(app, "tray-popup");
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;
            log("setup: tray built OK");

            for (label, w) in app.webview_windows() {
                log(&format!(
                    "setup: window '{}' exists, visible={:?}, size={:?}",
                    label,
                    w.is_visible(),
                    w.inner_size()
                ));
            }

            if let Some(window) = app.get_webview_window("tray-popup") {
                position_near_tray(&window);
            }

            log("setup: COMPLETE (if you see this, startup succeeded)");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = &event {
                if window.label() == "main" {
                    log("main window close requested -> hide to tray");
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    // 用 match 而不是 expect：万一仍因 WebView2 等原因失败，至少留下日志并弹窗说明。
    match builder.run(tauri::generate_context!()) {
        Ok(()) => log("=== run() returned (application exited normally) ==="),
        Err(e) => {
            log(&format!("FATAL: tauri application failed to start/run: {}", e));
            #[cfg(target_os = "windows")]
            wv2::msgbox(
                "MinCal 启动失败",
                &format!(
                    "应用无法启动：{}\n\n最常见原因：缺少 Microsoft Edge WebView2 运行库。\n请先安装 WebView2（见 使用说明.txt，或本目录 安装WebView2运行库.exe），再重试。\n\n日志：%LOCALAPPDATA%\\MinCal\\mincal.log",
                    e
                ),
            );
        }
    }
}

fn toggle_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_near_tray(window: &WebviewWindow) {
    if let Some(monitor) = window.current_monitor().ok().flatten() {
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        let win = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize { width: 360, height: 480 });

        let x = (screen.width as f64 / scale) as i32 - (win.width as i32) - 16;
        let y = (screen.height as f64 / scale) as i32 - (win.height as i32) - 60;

        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}
