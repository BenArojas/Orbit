// Native-only sidecar launch. The webview cannot spawn arbitrary processes.
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[derive(Default)]
struct SidecarSession {
    child: Option<CommandChild>,
    secret: Option<String>,
}

#[tauri::command]
fn sidecar_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Mutex<SidecarSession>>,
) -> Result<String, String> {
    let url = window.url().map_err(|_| "Unknown desktop origin")?;
    let trusted = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    #[cfg(debug_assertions)]
    let trusted = trusted
        || (url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
            && url.port() == Some(1420));
    if window.label() != "main" || !trusted {
        return Err("Sidecar access is restricted to the main window".into());
    }
    let mut session = state.lock().map_err(|_| "Sidecar session unavailable")?;
    if let Some(secret) = &session.secret {
        return Ok(secret.clone());
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not create sidecar session")?;
    let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

    #[cfg(debug_assertions)]
    let command = {
        let backend = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Missing repository directory")?
            .join("backend");
        app.shell()
            .command("uv")
            .args(["run", "python", "run.py", "--native-session"])
            .env("SQLITE_DB_PATH", backend.join("parallax.db"))
            .current_dir(backend)
    };
    #[cfg(not(debug_assertions))]
    let command = app
        .shell()
        .sidecar("parallax-backend")
        .map_err(|_| "Bundled sidecar is unavailable")?
        .args(["--native-session"]);

    let (mut events, mut child) = command.spawn().map_err(|_| "Could not start sidecar")?;
    if child.write(format!("{secret}\n").as_bytes()).is_err() {
        let _ = child.kill();
        return Err("Could not initialize sidecar session".into());
    }
    session.child = Some(child);
    session.secret = Some(secret.clone());
    // Drain output without forwarding broker/private data to the webview or
    // agent-visible console. Never log the secret or its stdin payload.
    tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
    Ok(secret)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SidecarSession::default()))
        .invoke_handler(tauri::generate_handler![sidecar_session])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Ok(mut session) = app.state::<Mutex<SidecarSession>>().lock() {
                    if let Some(mut child) = session.child.take() {
                        // Python also treats stdin EOF as a graceful shutdown,
                        // so parent crashes do not strand its Gateway process.
                        if child.write(b"shutdown\n").is_err() {
                            let _ = child.kill();
                        }
                    }
                    session.secret = None;
                }
            }
        });
}
