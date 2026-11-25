// Notificação do Windows para os lembretes. Roda no Rust (o WebView bloqueia notificações) e
// registra no log se o Windows recusar.
// No Windows usa sempre a identidade do app (`identifier` do tauri.conf.json, ex.: com.jarvis.desktop),
// também no modo de teste: o plugin trocaria por "Windows PowerShell" quando roda de target\debug.
use tauri::AppHandle;

#[tauri::command]
pub fn notificar(app: AppHandle, titulo: String, corpo: String) -> Result<(), String> {
    let r = mostrar(&app, &titulo, &corpo);
    match &r {
        Ok(_) => println!("aviso: notificação enviada ({titulo})"),
        Err(e) => eprintln!("aviso: notificação falhou: {e}"),
    }
    r
}

#[cfg(windows)]
fn mostrar(app: &AppHandle, titulo: &str, corpo: &str) -> Result<(), String> {
    use tauri_winrt_notification::{Sound, Toast};
    let id = app.config().identifier.clone();
    let mut t = Toast::new(&id).title(titulo).sound(Some(Sound::Reminder));
    let mut linhas = corpo.lines();
    if let Some(l) = linhas.next() {
        t = t.text1(l);
    }
    let resto = linhas.collect::<Vec<_>>().join(" ");
    if !resto.is_empty() {
        t = t.text2(&resto);
    }
    t.show().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn mostrar(app: &AppHandle, titulo: &str, corpo: &str) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(titulo).body(corpo).show().map_err(|e| e.to_string())
}
