// Notificação do Windows para os lembretes. Roda no Rust (não no WebView, que bloqueia notificações)
// e registra no log se o Windows recusar, para dar para investigar.
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn notificar(app: AppHandle, titulo: String, corpo: String) -> Result<(), String> {
    let r = app.notification().builder().title(&titulo).body(&corpo).show();
    match &r {
        Ok(_) => println!("aviso: notificação enviada ({titulo})"),
        Err(e) => eprintln!("aviso: notificação falhou: {e}"),
    }
    r.map_err(|e| e.to_string())
}
