// Botão "Rodar" das respostas: abre uma janela de terminal VISÍVEL rodando o comando,
// para o dono acompanhar a saída. Só roda quando o dono clica e confirma no app.
use base64::{engine::general_purpose::STANDARD, Engine};

#[tauri::command]
pub fn abrir_terminal(comando: String, shell: String) -> Result<(), String> {
    let comando = comando.trim();
    if comando.is_empty() {
        return Err("Comando vazio.".into());
    }
    if comando.len() > 8000 {
        return Err("Comando longo demais.".into());
    }
    abrir(comando, &shell)
}

#[cfg(windows)]
fn abrir(comando: &str, shell: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    // Janela de console nova e visível.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let pasta = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into());

    let mut c = if shell == "cmd" {
        let mut c = Command::new("cmd.exe");
        // /K mantém a janela aberta depois de rodar. raw_arg: o cmd lê a linha como está.
        c.raw_arg(format!("/K {comando}"));
        c
    } else {
        // PowerShell (também para bash/sh, que no Windows não existem por padrão).
        // -EncodedCommand evita qualquer problema de aspas: o texto vai em base64 UTF-16LE.
        let script = format!(
            "Write-Host 'J.A.R.V.I.S. > rodando:' -ForegroundColor Cyan\n\
             Write-Host @'\n{comando}\n'@ -ForegroundColor DarkGray\n\
             Write-Host ''\n\
             {comando}"
        );
        let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let mut c = Command::new("powershell.exe");
        c.args(["-NoExit", "-EncodedCommand", &STANDARD.encode(utf16)]);
        c
    };
    c.current_dir(pasta)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Não consegui abrir o terminal: {e}"))
}

#[cfg(not(windows))]
fn abrir(_comando: &str, _shell: &str) -> Result<(), String> {
    Err("Rodar comandos ainda só funciona no Windows.".into())
}

/// Abre um link no navegador padrão (fontes da pesquisa e links das respostas).
/// Só aceita http/https: nada de abrir arquivos ou programas por aqui.
#[tauri::command]
pub fn abrir_link(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.len() > 4000 {
        return Err("Link inválido.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Não consegui abrir o link: {e}"))
    }
    #[cfg(not(windows))]
    {
        Err("Abrir links ainda só funciona no Windows.".into())
    }
}
