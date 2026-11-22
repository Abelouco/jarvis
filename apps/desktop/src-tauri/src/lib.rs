use tauri::Manager;

mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Uma janela só: abrir o J.A.R.V.I.S. de novo traz a janela que já está aberta.
        // (Precisa ser o primeiro plugin registrado.)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(janela) = app.get_webview_window("main") {
                let _ = janela.unminimize();
                let _ = janela.show();
                let _ = janela.set_focus();
            }
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Auto-update: baixa do GitHub Releases e confere a assinatura.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![terminal::abrir_terminal, terminal::abrir_link])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o J.A.R.V.I.S.");
}
