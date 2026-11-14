// InkFlow — Tauri library entry. Kept minimal by design: all application logic
// lives in the React/TypeScript frontend; Rust only hosts the window and exposes
// the SQLite plugin used by the persistence layer.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running InkFlow");
}
