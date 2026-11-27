// Computador, parte 1 (Fase 4 · etapa 7): abrir, mídia, achar arquivo e ver a tela.
// O modo controle (mouse, teclado, faixa e pânico) está em `pilotar.rs`. Nada de print fica em disco.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

#[derive(Serialize)]
pub struct ArquivoAchado {
    caminho: String,
    modificado_ms: u64,
}

#[cfg(windows)]
#[tauri::command]
pub fn pc_abrir(alvo: String, tipo: String) -> Result<String, String> {
    let alvo = alvo.trim();
    if alvo.is_empty() || alvo.len() > 2000 || alvo.contains('\n') || alvo.contains('\r') {
        return Err("Não entendi o que abrir.".into());
    }
    match tipo.as_str() {
        "url" => {
            if !(alvo.starts_with("https://") || alvo.starts_with("http://")) {
                return Err("O endereço precisa ser http ou https.".into());
            }
            iniciar(alvo)?;
            Ok(alvo.to_string())
        }
        "caminho" => {
            let caminho = expandir(alvo);
            if caminho.is_empty() || caminho.contains('\n') || caminho.contains('\r') {
                return Err("Não entendi a pasta.".into());
            }
            iniciar(&caminho)?;
            Ok(caminho)
        }
        _ => abrir_programa(alvo),
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn pc_midia(acao: String) -> Result<String, String> {
    let vk = match acao.as_str() {
        "tocar_pausar" => VK_MEDIA_PLAY_PAUSE,
        "proxima" => VK_MEDIA_NEXT_TRACK,
        "anterior" => VK_MEDIA_PREV_TRACK,
        "volume_mais" => VK_VOLUME_UP,
        "volume_menos" => VK_VOLUME_DOWN,
        "mudo" => VK_VOLUME_MUTE,
        _ => return Err("Ação de mídia desconhecida.".into()),
    };
    tecla(vk)?;
    Ok(acao)
}

#[cfg(windows)]
#[tauri::command]
pub async fn pc_achar_arquivo(termo: String, tipo: Option<String>) -> Result<Vec<ArquivoAchado>, String> {
    let termo = termo.trim().to_string();
    if termo.len() < 2 || termo.len() > 120 {
        return Err("Diga o que procurar.".into());
    }
    let tipo = tipo.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || buscar(&termo, &tipo))
        .await
        .map_err(|e| format!("A busca falhou: {e}"))?
}

#[cfg(windows)]
#[tauri::command]
pub async fn pc_print() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(capturar_jpeg)
        .await
        .map_err(|e| format!("Falha ao capturar a tela: {e}"))?
}

#[cfg(not(windows))]
#[tauri::command]
pub fn pc_abrir(alvo: String, tipo: String) -> Result<String, String> {
    let _ = (alvo, tipo);
    Err("Abrir no computador ainda só funciona no Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn pc_midia(acao: String) -> Result<String, String> {
    let _ = acao;
    Err("Mídia ainda só funciona no Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn pc_achar_arquivo(termo: String, tipo: Option<String>) -> Result<Vec<ArquivoAchado>, String> {
    let _ = (termo, tipo);
    Err("Achar arquivo ainda só funciona no Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn pc_print() -> Result<String, String> {
    Err("Ver a tela ainda só funciona no Windows.".into())
}

#[cfg(windows)]
fn expandir(caminho: &str) -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    caminho.replace("%USERPROFILE%", &home)
}

#[cfg(windows)]
fn iniciar(alvo: &str) -> Result<(), String> {
    // ShellExecuteW abre URL, pasta, atalho ou programa sem passar por shell nenhum
    // (o `cmd /c start` interpretava `&` e `|` no alvo vindo da IA).
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let largo = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (verbo, arquivo) = (largo("open"), largo(alvo));
    let r = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verbo.as_ptr(), arquivo.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };
    if (r as isize) <= 32 {
        return Err(format!("Não consegui abrir (código {}).", r as isize));
    }
    Ok(())
}

#[cfg(windows)]
fn abrir_programa(consulta: &str) -> Result<String, String> {
    let melhor = melhor_atalho(consulta);
    if let Some(atalho) = melhor.as_ref() {
        if atalho.nota >= 60 {
            iniciar(&atalho.caminho)?;
            return Ok(atalho.nome.clone());
        }
    }
    if let Some(exe) = alias(consulta) {
        iniciar(exe)?;
        return Ok(consulta.to_string());
    }
    if let Some(atalho) = melhor {
        iniciar(&atalho.caminho)?;
        return Ok(atalho.nome);
    }
    iniciar(consulta)?;
    Ok(consulta.to_string())
}

#[cfg(windows)]
struct Atalho {
    caminho: String,
    nome: String,
    nota: i32,
}

#[cfg(windows)]
fn melhor_atalho(consulta: &str) -> Option<Atalho> {
    let mut melhor: Option<Atalho> = None;
    for raiz in menus_iniciar() {
        visitar_atalhos(&raiz, consulta, &mut melhor);
    }
    melhor
}

#[cfg(windows)]
fn menus_iniciar() -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    if let Ok(app) = std::env::var("APPDATA") {
        v.push(std::path::PathBuf::from(app).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(pd) = std::env::var("PROGRAMDATA") {
        v.push(std::path::PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    v
}

#[cfg(windows)]
fn visitar_atalhos(dir: &std::path::Path, consulta: &str, melhor: &mut Option<Atalho>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for ent in rd.flatten() {
        let caminho = ent.path();
        let Ok(tipo) = ent.file_type() else { continue };
        if tipo.is_dir() {
            visitar_atalhos(&caminho, consulta, melhor);
            continue;
        }
        let Some(ext) = caminho.extension() else { continue };
        if !ext.eq_ignore_ascii_case("lnk") { continue }
        let nome = caminho.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let nota = pontuar(&nome, consulta);
        let troca = match melhor {
            Some(atual) => nota > atual.nota || (nota == atual.nota && nome.len() < atual.nome.len()),
            None => nota > 0,
        };
        if troca {
            *melhor = Some(Atalho { caminho: caminho.to_string_lossy().to_string(), nome, nota });
        }
    }
}

#[cfg(windows)]
fn pontuar(nome_lnk: &str, consulta: &str) -> i32 {
    let nome = simplificar(nome_lnk);
    let q = simplificar(consulta);
    if nome.is_empty() || q.is_empty() { return 0 }
    if nome == q { return 100 }
    if nome.replace(' ', "") == q.replace(' ', "") { return 95 }
    if nome.contains(&q) { return 85 }
    if q.contains(&nome) && nome.len() >= 4 { return 70 }
    let palavras: Vec<&str> = q.split_whitespace().filter(|w| w.len() > 2).collect();
    if palavras.is_empty() { return 0 }
    let acertos = palavras.iter().filter(|w| nome.contains(*w)).count();
    if acertos == palavras.len() { return 80 }
    if acertos > 0 { return 20 + acertos as i32 * 15 }
    0
}

#[cfg(windows)]
fn alias(nome: &str) -> Option<&'static str> {
    match simplificar(nome).as_str() {
        "bloco de notas" | "notepad" | "notas" => Some("notepad"),
        "calculadora" | "calc" => Some("calc"),
        "paint" | "mspaint" => Some("mspaint"),
        "explorador" | "explorador de arquivos" | "explorer" => Some("explorer"),
        "prompt" | "prompt de comando" | "cmd" => Some("cmd"),
        "powershell" => Some("powershell"),
        _ => None,
    }
}

#[cfg(windows)]
fn simplificar(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let c = c.to_lowercase().next().unwrap_or(c);
        out.push(match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        });
    }
    out
}

#[cfg(windows)]
fn buscar(termo: &str, tipo: &str) -> Result<Vec<ArquivoAchado>, String> {
    let ext = extensoes(tipo);
    let mut achados = Vec::new();
    let mut vistos = 0u32;
    for raiz in pastas_do_dono() {
        if vistos > 20_000 { break }
        visitar(&raiz, 0, termo, ext, &mut vistos, &mut achados);
    }
    achados.sort_by(|a, b| b.modificado_ms.cmp(&a.modificado_ms).then(a.caminho.cmp(&b.caminho)));
    achados.dedup_by(|a, b| a.caminho.eq_ignore_ascii_case(&b.caminho));
    achados.truncate(10);
    Ok(achados)
}

#[cfg(windows)]
fn extensoes(tipo: &str) -> Option<&'static [&'static str]> {
    match tipo {
        "pdf" => Some(&["pdf"]),
        "imagem" => Some(&["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"]),
        "video" => Some(&["mp4", "mkv", "mov", "avi", "webm", "wmv"]),
        "planilha" => Some(&["xlsx", "xls", "csv", "ods"]),
        "documento" => Some(&["doc", "docx", "txt", "odt", "rtf"]),
        _ => None,
    }
}

#[cfg(windows)]
fn pastas_do_dono() -> Vec<std::path::PathBuf> {
    let Ok(home) = std::env::var("USERPROFILE") else { return Vec::new() };
    let home = std::path::PathBuf::from(home);
    let nomes = ["Documents", "Downloads", "Desktop", "Pictures", "Videos", "Documentos", "Imagens"];
    let mut bases = vec![home.clone()];
    if let Ok(rd) = std::fs::read_dir(&home) {
        for ent in rd.flatten() {
            let nome = ent.file_name();
            let nome = nome.to_string_lossy();
            if nome.to_ascii_lowercase().starts_with("onedrive") {
                bases.push(ent.path());
            }
        }
    }
    let mut v = Vec::new();
    for base in bases {
        for nome in nomes {
            let p = base.join(nome);
            if p.is_dir() { v.push(p) }
        }
    }
    v
}

#[cfg(windows)]
fn visitar(
    dir: &std::path::Path, nivel: u8, termo: &str, ext: Option<&[&str]>, vistos: &mut u32, achados: &mut Vec<ArquivoAchado>,
) {
    if *vistos > 20_000 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for ent in rd.flatten() {
        if *vistos > 20_000 { return }
        *vistos += 1;
        let nome = ent.file_name();
        let nome_s = nome.to_string_lossy();
        if nome_s.eq_ignore_ascii_case("node_modules") || nome_s.eq_ignore_ascii_case(".git") || nome_s.eq_ignore_ascii_case("appdata") {
            continue;
        }
        let caminho = ent.path();
        let Ok(meta) = ent.metadata() else { continue };
        if meta.is_dir() {
            if nivel < 5 { visitar(&caminho, nivel + 1, termo, ext, vistos, achados) }
            continue;
        }
        if !meta.is_file() { continue }
        if let Some(exts) = ext {
            let e = caminho.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
            if !exts.iter().any(|x| *x == e) { continue }
        }
        if !bate(&nome_s, termo) { continue }
        let ms = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        achados.push(ArquivoAchado { caminho: caminho.to_string_lossy().into_owned(), modificado_ms: ms });
    }
}

#[cfg(windows)]
fn bate(nome: &str, termo: &str) -> bool {
    let n = simplificar(nome);
    let t = simplificar(termo);
    if t.is_empty() { return false }
    if n.contains(&t) { return true }
    let palavras: Vec<&str> = t.split_whitespace().filter(|w| w.len() > 1).collect();
    !palavras.is_empty() && palavras.iter().all(|w| n.contains(w))
}

#[cfg(windows)]
fn capturar_jpeg() -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use image::{imageops::FilterType, ExtendedColorType};
    use std::io::Cursor;

    let monitores = xcap::Monitor::all().map_err(|e| format!("Não li as telas: {e}"))?;
    let idx = monitores.iter().position(|m| m.is_primary().unwrap_or(false)).unwrap_or(0);
    let monitor = monitores.into_iter().nth(idx).ok_or("Nenhuma tela encontrada.")?;
    let img = monitor.capture_image().map_err(|e| format!("Não capturei a tela: {e}"))?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 { return Err("A tela veio vazia.".into()) }
    let mut nossa = image::RgbaImage::from_raw(w, h, img.into_raw()).ok_or("Imagem inválida.")?;
    const MAX: u32 = 1280;
    if nossa.width() > MAX {
        let nh = ((nossa.height() as u64 * MAX as u64) / nossa.width() as u64).max(1) as u32;
        nossa = image::imageops::resize(&nossa, MAX, nh, FilterType::Triangle);
    }
    let rgb: image::RgbImage = image::DynamicImage::ImageRgba8(nossa).to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut buf = Cursor::new(Vec::new());
    let mut enc = JpegEncoder::new_with_quality(&mut buf, 70);
    enc.encode(rgb.as_raw(), w, h, ExtendedColorType::Rgb8).map_err(|e| format!("Não gerei o JPEG: {e}"))?;
    Ok(STANDARD.encode(buf.into_inner()))
}

#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
};

#[cfg(windows)]
fn tecla(vk: u16) -> Result<(), String> {
    let evento = |flags: u32| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        },
    };
    // Tecla de mídia é estendida: sem essa marca o Windows ignora volume e play.
    let inputs = [evento(KEYEVENTF_EXTENDEDKEY), evento(KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP)];
    let n = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if n != inputs.len() as u32 {
        Err("O Windows não aceitou a tecla de mídia.".into())
    } else {
        Ok(())
    }
}
