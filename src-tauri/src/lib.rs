mod commands;
pub mod gins_cookies;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::check_dependencies,
            commands::check_dependencies_light,
            commands::debug_dependencies,
            commands::debug_ejs,
            commands::get_dependencies_cache,
            commands::get_default_download_dir,
            commands::scan_url,
            commands::start_download,
            commands::check_ytdlp_update,
            commands::update_ytdlp,
            commands::list_impersonate_targets,
            commands::get_facebook_diagnostic,
            commands::export_gins_cookies
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
