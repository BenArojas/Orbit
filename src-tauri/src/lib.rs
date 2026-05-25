// Orbit — Tauri shell
//
// Keep this minimal. All business logic lives in the Python sidecar.
// Rust only handles: app lifecycle, sidecar process management, and
// Tauri plugin registration.
//
// Orbit integration:
//   When Orbit launches, this file will be replaced by Orbit's
//   src-tauri/src/lib.rs which manages one consolidated sidecar
//   serving both Parallax and MoonMarket routes.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
