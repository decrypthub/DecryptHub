#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
mod embed;
mod shutdown;

const KEYRING_SERVICE: &str = "com.webdecrypthub.app";
const LEGACY_KEYRING_SERVICE: &str = "com.niying.jsra";
const KEYRING_USER: &str = "llm-api-key";

struct AppState {
    port: Arc<Mutex<u16>>,
    token: Arc<Mutex<String>>,
    native_key: Arc<Mutex<String>>,
    sidecar: Arc<Mutex<Option<Child>>>,
    running: Arc<Mutex<bool>>,
}


fn sidecar_path() -> std::path::PathBuf {
    let name = if cfg!(windows) { "jsra-sidecar.exe" } else { "jsra-sidecar-linux" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in [dir.join(name), dir.join("resources").join(name), dir.join("..").join("lib").join("jsra-tauri").join(name)] {
                if cand.exists() { return cand; }
            }
        }
    }
    std::path::PathBuf::from(format!("../build/{}", name))
}

// 端口由 sidecar 自己绑定 127.0.0.1:0（无竞态），启动后在 stdout 打印 JSRA_PORT=N，这里读出写入共享状态。
// 每次（重）启动都换新端口，旧端口被占用也不会陷入重启循环。
// 同一行之后还有 JSRA_TOKEN=<一次性票据>，只有本进程（stdout 是私有管道）能拿到，
// 前端用它做 WS 握手的鉴权，避免本机其它程序直接连 sidecar 的 RPC。
fn spawn_sidecar(port: &Arc<Mutex<u16>>, token: &Arc<Mutex<String>>, native_key: &Arc<Mutex<String>>) -> std::io::Result<Child> {
    let sc = sidecar_path();
    *port.lock().unwrap() = 0;
    token.lock().unwrap().clear();
    native_key.lock().unwrap().clear();
    // Development uses source; Windows production uses the bundled Node host.
    let node_entry = std::env::var("JSRA_SIDECAR_NODE").ok().filter(|s| !s.trim().is_empty())
        .or_else(|| {
            if cfg!(debug_assertions) {
                let entry = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/index.mjs");
                if entry.is_file() { return Some(entry.to_string_lossy().into_owned()); }
            }
            None
        });
    let mut cmd = match &node_entry {
        Some(entry) => {
            eprintln!("[sidecar] 使用 node 运行源码：{}", entry);
            let mut c = Command::new("node");
            c.arg(entry);
            c
        }
        None => {
            if cfg!(windows) {
                let exe = std::env::current_exe()?;
                let dir = exe.parent().ok_or_else(|| std::io::Error::other("Application directory missing"))?;
                let resources = dir.join("resources");
                let node = resources.join("node/node.exe");
                let entry = resources.join("sidecar/main.mjs");
                if !node.is_file() || !entry.is_file() {
                    return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Bundled Node/sidecar is missing; reinstall the application"));
                }
                let mut c = Command::new(node);
                c.arg(entry).current_dir(resources.join("sidecar"))
                    .env("JSRA_RES_DIR", resources.join("patchright-core"));
                c
            } else { Command::new(&sc) }
        },
    };
    cmd.env("JSRA_WS_PORT", "0")
        .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
        .env("JSRA_NATIVE_HOST", "1")
        .env("JSRA_APP_VERSION", env!("CARGO_PKG_VERSION"))
        .stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW：不弹出控制台窗口
    }
    let mut child = cmd.spawn()?;
    if let Some(out) = child.stdout.take() {
        let p = port.clone();
        let t = token.clone();
        let nk = native_key.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                let Ok(l) = line else { break };
                let l = l.trim();
                if let Some(v) = l.strip_prefix("JSRA_PORT=") { if let Ok(n) = v.parse::<u16>() { *p.lock().unwrap() = n; } }
                else if let Some(v) = l.strip_prefix("JSRA_TOKEN=") { if let Ok(mut g) = t.lock() { *g = v.to_string(); } }
                else if let Some(v) = l.strip_prefix("JSRA_NATIVE_KEY=") { if let Ok(mut g) = nk.lock() { *g = v.to_string(); } }
            }
        });
    }
    Ok(child)
}


// slot = 渠道 id（多渠道各自存一份密钥，用户只填一次）；空/slot="default" 即旧版单密钥
fn slot_user(slot: &str) -> String {
    let s = slot.trim();
    if s.is_empty() || s == "default" { KEYRING_USER.to_string() } else { format!("{}::{}", KEYRING_USER, s) }
}

#[tauri::command]
fn secret_set(slot: String, value: String) -> Result<(), String> {
    let user = slot_user(&slot);
    match keyring::Entry::new(KEYRING_SERVICE, &user) {
        Ok(e) => e.set_password(&value).map_err(|err| err.to_string()),
        Err(e) => Err(e.to_string()),
    }
}
fn secret_get(slot: String) -> Result<String, String> {
    let user = slot_user(&slot);
    match keyring::Entry::new(KEYRING_SERVICE, &user) {
        Ok(e) => match e.get_password() {
            Ok(p) => Ok(p),
            Err(keyring::Error::NoEntry) => {
                // 只有默认槽才做 1.0.0（逆影）迁移，渠道槽没有历史数据
                if user == KEYRING_USER {
                    if let Ok(old) = keyring::Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_USER) {
                        if let Ok(p) = old.get_password() {
                            let _ = e.set_password(&p);
                            let _ = old.delete_credential();
                            return Ok(p);
                        }
                    }
                }
                Ok(String::new())
            }
            Err(err) => Err(err.to_string()),
        },
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn secret_sync(state: State<AppState>, slots: Vec<String>) -> Result<serde_json::Value, String> {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
    let encoded = state.native_key.lock().map_err(|e| e.to_string())?.clone();
    if encoded.len() != 64 { return Err("凭据通道尚未就绪".into()); }
    let key: Vec<u8> = (0..64).step_by(2).map(|i| u8::from_str_radix(&encoded[i..i+2], 16).map_err(|_| "无效的凭据通道".to_string())).collect::<Result<_, _>>()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化凭据通道".to_string())?;
    let mut payload = serde_json::Map::new();
    let preferred_slot = slots.first().filter(|s| s.starts_with("prov.")).cloned();
    for slot in slots.into_iter().take(100) {
        if slot.len() > 120 || (!slot.starts_with("prov.") && slot != "default") { return Err("无效的凭据槽位".into()); }
        payload.insert(slot.clone(), serde_json::Value::String(secret_get(slot)?));
    }
    if !payload.iter().any(|(k, v)| k.starts_with("prov.") && v.as_str().is_some_and(|s| !s.is_empty())) {
        if let (Some(first), Some(legacy)) = (preferred_slot, payload.get("default").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(String::from)) {
            secret_set(first.clone(), legacy.clone())?;
            secret_clear("default".to_string())?;
            payload.insert(first, serde_json::Value::String(legacy));
            payload.insert("default".to_string(), serde_json::Value::String(String::new()));
        }
    }
    let mut nonce_bytes = [0u8; 12]; getrandom::fill(&mut nonce_bytes).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce_bytes), bytes.as_slice()).map_err(|_| "凭据加密失败".to_string())?;
    let hex = |bytes: &[u8]| -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() };
    Ok(serde_json::json!({ "nonce": hex(&nonce_bytes), "ciphertext": hex(&encrypted) }))
}
#[tauri::command]
fn secret_clear(slot: String) -> Result<(), String> {
    let user = slot_user(&slot);
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, &user) {
        let _ = e.delete_credential();
    }
    Ok(())
}

// 原生保存对话框（导出 HAR 等）。必须是 async 命令，否则阻塞式对话框会在主线程上死锁
#[tauri::command]
async fn pick_save_path(app: tauri::AppHandle, default_name: String, filter_name: String, ext: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let exts = [ext.as_str()];
    app.dialog().file().set_title("导出").set_file_name(&default_name).add_filter(&filter_name, &exts)
        .blocking_save_file().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

/// 原生打开对话框（多选）：把用户选中的任意文件挂到对话里（Markdown/代码/图片等）
#[tauri::command]
async fn pick_open_paths(app: tauri::AppHandle) -> Option<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file()
        .set_title("选择文件")
        .add_filter("文档与代码", &["md", "markdown", "txt", "json", "js", "mjs", "cjs", "ts", "py", "html", "css", "har", "log"])
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_files();
    picked.map(|list| list.into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
fn get_ws_port(state: State<AppState>) -> u16 { *state.port.lock().unwrap() }

/// Only the native app UI can mint a folder-selection proof. It is short-lived,
/// bound to one chat, and consumed once by the sidecar.
#[tauri::command]
async fn pick_work_folder(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String, recent_path: Option<String>) -> Result<Option<serde_json::Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let selected = match recent_path {
        Some(p) => Some(std::path::PathBuf::from(p)),
        None => app.dialog().file().set_title("选择工作文件夹").blocking_pick_folder().and_then(|p| p.into_path().ok()),
    };
    let Some(selected) = selected else { return Ok(None); };
    let canonical = std::fs::canonicalize(selected).map_err(|e| e.to_string())?;
    if !canonical.is_dir() { return Err("请选择文件夹".into()); }
    let raw = canonical.to_string_lossy().to_string();
    let folder = if let Some(unc) = raw.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{}", unc)
    } else { raw.strip_prefix("\\\\?\\").unwrap_or(&raw).to_string() };
    let expires = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64 + 300_000;
    let token = state.token.lock().map_err(|e| e.to_string())?.clone();
    if token.is_empty() { return Err("逻辑进程尚未连接".into()); }
    let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(format!("{}\n{}\n{}", session_id, folder, expires).as_bytes());
    let signature: String = mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();
    Ok(Some(serde_json::json!({ "path": folder, "sessionId": session_id, "expiresAt": expires, "signature": signature })))
}

/// WS 握手票据（sidecar 每次启动换新）。前端拿不到时会是空串，此时连接会被 sidecar 拒绝。
#[tauri::command]
fn get_ws_token(state: State<AppState>) -> String { state.token.lock().unwrap().clone() }

/// 在线更新拉起安装器之前调用：停掉监督线程，优雅关闭 sidecar 进程树，超时后强制结束。
#[tauri::command]
async fn prepare_for_update(state: State<'_, AppState>) -> Result<(), String> {
    *state.running.lock().unwrap() = false;
    let port = *state.port.lock().unwrap();
    let sidecar = state.sidecar.clone();
    let install_dir = shutdown::current_install_dir();
    tauri::async_runtime::spawn_blocking(move || {
        shutdown::stop_sidecar_for_update(port, &sidecar, &install_dir);
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "DecryptHub",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "keyringBackend": if cfg!(windows) { "Windows DPAPI (凭据管理器)" } else if cfg!(target_os="macos") { "macOS Keychain" } else { "Secret Service" },
    })
}

#[tauri::command]
fn restart_sidecar(state: State<AppState>) -> Result<(), String> {
    let mut guard = state.sidecar.lock().unwrap();
    if let Some(mut c) = guard.take() { shutdown::kill_tree(&mut c); }
    match spawn_sidecar(&state.port, &state.token, &state.native_key) {
        Ok(c) => { *guard = Some(c); Ok(()) }
        Err(e) => Err(format!("重启逻辑进程失败: {}", e)),
    }
}

// ---- 原生嵌入 Chrome（Windows Win32 / Linux X11）----
// 同步命令在主线程执行，原生窗口操作都在主线程完成
#[tauri::command]
fn embed_show(app: tauri::AppHandle, session_id: String, pid: u32, rect: embed::CssRect, dpr: f64, inset: Option<embed::CssInset>) -> Result<serde_json::Value, String> {
    let win = app.get_webview_window("main").ok_or("no main window")?;
    embed::show(&win, &session_id, pid, rect, dpr, inset.unwrap_or_default())
}
#[tauri::command]
fn embed_hide() { embed::hide_all(); }
#[tauri::command]
fn embed_release(session_id: String) { embed::release(&session_id); }
#[tauri::command]
fn embed_supported() -> bool {
    if cfg!(windows) { return true; }
    cfg!(target_os = "linux") && std::env::var("DISPLAY").map(|d| !d.is_empty()).unwrap_or(false)
}

// 调试模式：F12 / Ctrl+Shift+I 打开 WebView2 DevTools（release 构建里是空操作）
#[tauri::command]
fn open_devtools(win: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    win.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = win;
}

fn main() {
    // Wayland 会话：主窗口与 Chrome 都走 XWayland，才能用 XReparentWindow 嵌入（JSRA_NO_EMBED=1 可关闭）
    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() && std::env::var("DISPLAY").is_ok() && std::env::var("GDK_BACKEND").is_err() && std::env::var("JSRA_NO_EMBED").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    let port: Arc<Mutex<u16>> = Arc::new(Mutex::new(0));
    let token: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let native_key: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let sidecar = Arc::new(Mutex::new(None));
    let running = Arc::new(Mutex::new(true));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState { port: port.clone(), token: token.clone(), native_key: native_key.clone(), sidecar: sidecar.clone(), running: running.clone() })
        .invoke_handler(tauri::generate_handler![secret_set, secret_sync, secret_clear, get_ws_port, get_ws_token, app_info, restart_sidecar, prepare_for_update, pick_save_path, pick_open_paths, pick_work_folder, embed_show, embed_hide, embed_release, embed_supported, open_devtools])
        .setup(move |app| {
            match spawn_sidecar(&port, &token, &native_key) {
                Ok(c) => { *sidecar.lock().unwrap() = Some(c); }
                Err(e) => { eprintln!("启动逻辑进程失败: {}", e); }
            }
            // 崩溃自动重启监督线程
            let sc = sidecar.clone();
            let run = running.clone();
            let sp = port.clone();
            let tk = token.clone();
            let nk = native_key.clone();
            std::thread::spawn(move || {
                let mut fails: u32 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if !*run.lock().unwrap() { break; }
                    let mut g = sc.lock().unwrap();
                    let dead = match g.as_mut() {
                        Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                        None => true,
                    };
                    if dead {
                        // 指数退避，避免异常时疯狂重启。更新开始后 running 会被关掉，
                        // 退避醒来必须再看一眼，否则会把刚停掉的 sidecar 又拉起来。
                        fails += 1;
                        if fails > 1 {
                            drop(g);
                            std::thread::sleep(std::time::Duration::from_millis((500u64 << fails.min(5)).min(15000)));
                            if !*run.lock().unwrap() { break; }
                            g = sc.lock().unwrap();
                        }
                        if !*run.lock().unwrap() { break; }
                        if let Ok(c) = spawn_sidecar(&sp, &tk, &nk) { *g = Some(c); }
                    } else if *sp.lock().unwrap() != 0 { fails = 0; }
                }
            });
            let shot = std::env::var("JSRA_SHOT").unwrap_or_default();
            let skip = matches!(std::env::var("JSRA_SKIP_ONBOARD").unwrap_or_default().trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes");
            let shoturl = std::env::var("JSRA_SHOT_URL").unwrap_or_default();
            let pulse = if shot.is_empty() { String::new() } else { "try{setInterval(function(){var b=document.body;if(b){b.style.outline=b.style.outline?'':'1px solid transparent';window.dispatchEvent(new Event('resize'));}},300);}catch(e){}".to_string() };
            // F12 / Ctrl+Shift+I 打开 DevTools（debug 构建有效）：挂到初始化脚本，任何页面（含 Vite dev server）都可用
            let devkeys = "window.addEventListener('keydown',function(e){if(e.key==='F12'||((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==='I'||e.key==='i'))){e.preventDefault();try{window.__TAURI_INTERNALS__.invoke('open_devtools');}catch(err){}}},true);";
            let init = format!("window.__JSRA_WS_PORT = 0; window.__JSRA_NATIVE = true; window.__JSRA_SHOT = {:?}; window.__JSRA_SKIP_ONBOARD = {}; window.__JSRA_DEBUG = {}; window.__JSRA_SHOT_URL = {:?};{}{}", shot, skip, if std::env::var("JSRA_DEBUG").is_ok() { "true" } else { "false" }, shoturl, pulse, devkeys);
            // 默认小窗口，够用即可；用户拖动调整后不记忆（保持可预期的启动尺寸）
            let (mut want_w, mut want_h) = (1160.0_f64, 760.0_f64);
            if let Ok(Some(mon)) = app.primary_monitor() {
                let scale = if mon.scale_factor() > 0.0 { mon.scale_factor() } else { 1.0 };
                let avail_w = mon.size().width as f64 / scale - 48.0;
                let avail_h = mon.size().height as f64 / scale - 96.0;
                want_w = want_w.min(avail_w).max(1080.0);
                want_h = want_h.min(avail_h).max(680.0);
            }
            // 调试模式：JSRA_UI_DEV_URL 指向 Vite dev server 时直接加载它（HMR），否则用编译期嵌入的 ui-dist。
            // 只在 debug 构建里生效，发布版不会被环境变量改掉加载源。
            #[cfg(debug_assertions)]
            let ui_url = std::env::var("JSRA_UI_DEV_URL").ok().map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
            #[cfg(not(debug_assertions))]
            let ui_url: Option<String> = None;
            let ui_target = match ui_url.as_deref() {
                Some(u) => WebviewUrl::External(u.parse::<tauri::Url>().map_err(|e| format!("JSRA_UI_DEV_URL 无效（{}）：{}", u, e))?),
                None => WebviewUrl::default(),
            };
            let mut b = WebviewWindowBuilder::new(app, "main", ui_target)
                .title("DecryptHub")
                .inner_size(want_w, want_h)
                .min_inner_size(1080.0, 680.0)
                .decorations(false)
                .shadow(true)
                .center()
                .initialization_script(&init)
                // WebView2 新版 Chromium 的“本地网络访问”检查会拦截页面到 127.0.0.1 sidecar 的 WebSocket；保留 Tauri 默认禁用项并追加关闭
                .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights");
            if std::env::var("JSRA_MAXIMIZE").is_ok() { b = b.maximized(true); }
            // Local builds may use different WebView2 environment options than the
            // installed app. WebView2 requires a separate profile for those options.
            #[cfg(debug_assertions)]
            {
                if std::env::var("JSRA_DESKTOP_SMOKE").as_deref() == Ok("1") {
                    let data = std::env::var_os("DECRYPTHUB_DATA_DIR").map(std::path::PathBuf::from).ok_or("Smoke DECRYPTHUB_DATA_DIR missing")?;
                    b = b.visible(false).skip_taskbar(true).data_directory(data.join("native-smoke-webview"));
                } else {
                    b = b.data_directory(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.tmp/desktop-webview"));
                }
            }
            let win = b.build()?;
            // 调试模式：JSRA_DEVTOOLS=1 启动即打开 DevTools（F12 也可随时打开）
            #[cfg(debug_assertions)]
            if std::env::var("JSRA_DEVTOOLS").is_ok() { win.open_devtools(); }
            // 定时收养 Chrome 新弹出的顶层窗口 / X11 点击焦点跟随
            {
                let h = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(30));
                    if h.run_on_main_thread(embed::tick).is_err() { break; }
                });
            }
            if !shot.is_empty() {
                let w = win.clone();
                std::thread::spawn(move || {
                    for i in 0..6 {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        let _ = w.set_size(tauri::LogicalSize::new(1540.0, 960.0 + (i as f64)));
                        let _ = w.set_focus();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state: State<AppState> = window.state();
                { *state.running.lock().unwrap() = false; }
                let child = { state.sidecar.lock().unwrap().take() };
                if let Some(mut c) = child { shutdown::kill_tree(&mut c); }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
