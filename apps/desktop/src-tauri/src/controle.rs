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

#[derive(Serialize)]
pub struct PrintTela {
    imagem: String,
    processo: String,
    titulo: String,
    produto: String,
    texto_tela: String,
}

#[cfg(windows)]
#[tauri::command]
pub async fn pc_print(modo: String) -> Result<PrintTela, String> {
    let leitura = match modo.as_str() {
        "leitura" => true,
        "controle" => false,
        _ => return Err("Modo de captura desconhecido.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let (processo, titulo) = crate::pilotar::janela_frente();
        let hwnd = unsafe { GetForegroundWindow() };
        let produto = nome_produto(hwnd);
        let (imagem, texto_tela) = capturar_jpeg(if leitura { ModoCaptura::Leitura } else { ModoCaptura::Controle })?;
        Ok(PrintTela { imagem, processo, titulo, produto, texto_tela })
    })
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
pub async fn pc_print(modo: String) -> Result<PrintTela, String> {
    let _ = modo;
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum ModoCaptura {
    Leitura,
    Controle,
}

#[cfg(windows)]
fn capturar_jpeg(modo: ModoCaptura) -> Result<(String, String), String> {
    let monitores = xcap::Monitor::all().map_err(|e| format!("Não li as telas: {e}"))?;
    let idx = monitores.iter().position(|m| m.is_primary().unwrap_or(false)).unwrap_or(0);
    let monitor = monitores.into_iter().nth(idx).ok_or("Nenhuma tela encontrada.")?;
    let img = monitor.capture_image().map_err(|e| format!("Não capturei a tela: {e}"))?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 { return Err("A tela veio vazia.".into()) }
    let cheia = image::RgbaImage::from_raw(w, h, img.into_raw()).ok_or("Imagem inválida.")?;

    let inicio_ocr = std::time::Instant::now();
    let ocr = if modo == ModoCaptura::Leitura { Some(iniciar_ocr(&cheia)) } else { None };
    let (max_px, filtro, qualidade) = match modo {
        ModoCaptura::Leitura => (1600, image::imageops::FilterType::CatmullRom, 85),
        ModoCaptura::Controle => (1024, image::imageops::FilterType::Nearest, 60),
    };
    let mut imagem = jpeg_base64(&cheia, max_px, filtro, qualidade)?;
    if modo == ModoCaptura::Leitura && imagem.len() > 1_900_000 {
        imagem = jpeg_base64(&cheia, 1280, image::imageops::FilterType::CatmullRom, 85)?;
    }
    let texto_tela = match ocr {
        Some(rx) => {
            let restante = std::time::Duration::from_millis(1500).saturating_sub(inicio_ocr.elapsed());
            rx.recv_timeout(restante).unwrap_or_default()
        }
        None => String::new(),
    };
    Ok((imagem, texto_tela))
}

#[cfg(windows)]
fn jpeg_base64(
    img: &image::RgbaImage,
    max_px: u32,
    filtro: image::imageops::FilterType,
    qualidade: u8,
) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use image::ExtendedColorType;
    use std::io::Cursor;

    let nossa = if img.width() > max_px {
        let nh = ((img.height() as u64 * max_px as u64) / img.width() as u64).max(1) as u32;
        image::imageops::resize(img, max_px, nh, filtro)
    } else {
        img.clone()
    };
    let rgb = image::DynamicImage::ImageRgba8(nossa).to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut buf = Cursor::new(Vec::new());
    let mut enc = JpegEncoder::new_with_quality(&mut buf, qualidade);
    enc.encode(rgb.as_raw(), w, h, ExtendedColorType::Rgb8).map_err(|e| format!("Não gerei o JPEG: {e}"))?;
    Ok(STANDARD.encode(buf.into_inner()))
}

/// OCR do Windows, no máximo 1,5 s. Erro ou atraso devolve texto vazio e não falha o comando.
#[cfg(windows)]
fn iniciar_ocr(img: &image::RgbaImage) -> std::sync::mpsc::Receiver<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let pixels = img.as_raw().clone();
    let (w, h) = img.dimensions();
    let _ = std::thread::Builder::new().name("jarvis-ocr".into()).spawn(move || {
        let inicio = std::time::Instant::now();
        let texto = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reconhecer_texto(pixels, w, h)))
            .unwrap_or_default();
        if inicio.elapsed() <= std::time::Duration::from_millis(1500) {
            let _ = tx.send(texto);
        }
    });
    rx
}

#[cfg(windows)]
fn reconhecer_texto(pixels: Vec<u8>, w: u32, h: u32) -> String {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

    struct Apartamento;
    impl Drop for Apartamento {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    let _apartamento = match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        Ok(()) => Some(Apartamento),
        Err(_) => None,
    };
    let Some(motor) = motor_ocr() else { return String::new() };
    let Some(cheia) = image::RgbaImage::from_raw(w, h, pixels) else { return String::new() };
    let max = OcrEngine::MaxImageDimension().unwrap_or(u32::MAX);
    let img = reduzir_ate_caber(cheia, max);
    let (w, h) = img.dimensions();
    let Ok(wi) = i32::try_from(w) else { return String::new() };
    let Ok(hi) = i32::try_from(h) else { return String::new() };
    let bgra = rgba_para_bgra(img.as_raw());
    let bitmap = (|| {
        let escritor = DataWriter::new()?;
        escritor.WriteBytes(&bgra)?;
        let buffer = escritor.DetachBuffer()?;
        SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            wi,
            hi,
            BitmapAlphaMode::Premultiplied,
        )
    })();
    let Ok(bitmap) = bitmap else { return String::new() };
    let Ok(operacao) = motor.RecognizeAsync(&bitmap) else { return String::new() };
    let Ok(resultado) = operacao.get() else { return String::new() };
    texto_das_linhas(&resultado)
}

#[cfg(windows)]
fn motor_ocr() -> Option<windows::Media::Ocr::OcrEngine> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Media::Ocr::OcrEngine;

    if let Some(motor) = motor_util(OcrEngine::TryCreateFromUserProfileLanguages().ok()) {
        return Some(motor);
    }
    for tag in ["pt-BR", "en-US"] {
        let Ok(idioma) = Language::CreateLanguage(&HSTRING::from(tag)) else { continue };
        if !OcrEngine::IsLanguageSupported(&idioma).unwrap_or(false) { continue }
        if let Some(motor) = motor_util(OcrEngine::TryCreateFromLanguage(&idioma).ok()) {
            return Some(motor);
        }
    }
    None
}

#[cfg(windows)]
fn motor_util(motor: Option<windows::Media::Ocr::OcrEngine>) -> Option<windows::Media::Ocr::OcrEngine> {
    let motor = motor?;
    motor.RecognizerLanguage().ok()?;
    Some(motor)
}

#[cfg(windows)]
fn reduzir_ate_caber(img: image::RgbaImage, max: u32) -> image::RgbaImage {
    if max == 0 { return img }
    let mut atual = img;
    for _ in 0..4 {
        let (w, h) = atual.dimensions();
        if w <= max && h <= max { return atual }
        let maior = w.max(h).max(1);
        let nw = ((w as u64 * max as u64) / maior as u64).max(1).min(max as u64) as u32;
        let nh = ((h as u64 * max as u64) / maior as u64).max(1).min(max as u64) as u32;
        if nw == w && nh == h { return atual }
        atual = image::imageops::resize(&atual, nw, nh, image::imageops::FilterType::CatmullRom);
    }
    atual
}

#[cfg(windows)]
fn rgba_para_bgra(rgba: &[u8]) -> Vec<u8> {
    let mut bgra = Vec::with_capacity(rgba.len());
    for px in rgba.chunks_exact(4) {
        bgra.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
    }
    bgra
}

#[cfg(windows)]
fn texto_das_linhas(resultado: &windows::Media::Ocr::OcrResult) -> String {
    let Ok(linhas) = resultado.Lines() else { return String::new() };
    let n = linhas.Size().unwrap_or(0);
    let mut itens = Vec::with_capacity(n as usize);
    for i in 0..n {
        let Ok(linha) = linhas.GetAt(i) else { continue };
        let texto = linha.Text().map(|t| t.to_string()).unwrap_or_default();
        let texto = texto.trim();
        if texto.is_empty() { continue }
        itens.push((y_da_linha(&linha), texto.to_string()));
    }
    itens.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    cortar_chars(&itens.into_iter().map(|(_, t)| t).collect::<Vec<_>>().join("\n"), 3000)
}

#[cfg(windows)]
fn y_da_linha(linha: &windows::Media::Ocr::OcrLine) -> f32 {
    let Ok(palavras) = linha.Words() else { return 0.0 };
    let n = palavras.Size().unwrap_or(0);
    let mut y = f32::MAX;
    for i in 0..n {
        if let Ok(palavra) = palavras.GetAt(i) {
            if let Ok(ret) = palavra.BoundingRect() {
                y = y.min(ret.Y);
            }
        }
    }
    if y == f32::MAX { 0.0 } else { y }
}

#[cfg(windows)]
fn nome_produto(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    if hwnd.is_null() { return String::new() }
    let caminho = caminho_exe(hwnd);
    if caminho.is_empty() { return String::new() }
    let nome = descricao_arquivo(&caminho).unwrap_or_else(|| limpar_nome_exe(&caminho));
    cortar_chars(&nome, 80)
}

#[cfg(windows)]
fn caminho_exe(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 { return String::new() }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() { return String::new() }
        let mut buf = [0u16; 1024];
        let mut tam = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut tam);
        let _ = CloseHandle(h);
        if ok == 0 || tam == 0 { return String::new() }
        String::from_utf16_lossy(&buf[..tam as usize])
    }
}

#[cfg(windows)]
fn descricao_arquivo(caminho: &str) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW};
    let wide: Vec<u16> = caminho.encode_utf16().chain(std::iter::once(0)).collect();
    let mut ignorado = 0u32;
    let tam = unsafe { GetFileVersionInfoSizeW(wide.as_ptr(), &mut ignorado) };
    if tam == 0 { return None }
    let mut bloco = vec![0u8; tam as usize];
    let ok = unsafe { GetFileVersionInfoW(wide.as_ptr(), 0, tam, bloco.as_mut_ptr() as *mut _) };
    if ok == 0 { return None }
    let mut pares = traducoes_versao(&bloco);
    for extra in [(0x0416u16, 1200u16), (0x0409, 1200)] {
        if !pares.contains(&extra) { pares.push(extra) }
    }
    for chave in ["FileDescription", "ProductName"] {
        for &(idioma, pagina) in &pares {
            if let Some(texto) = ler_versao(&bloco, idioma, pagina, chave) {
                return Some(texto);
            }
        }
    }
    None
}

#[cfg(windows)]
fn traducoes_versao(bloco: &[u8]) -> Vec<(u16, u16)> {
    use windows_sys::Win32::Storage::FileSystem::VerQueryValueW;
    let sub: Vec<u16> = "\\VarFileInfo\\Translation".encode_utf16().chain(std::iter::once(0)).collect();
    let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut tam = 0u32;
    let achou = unsafe { VerQueryValueW(bloco.as_ptr() as _, sub.as_ptr(), &mut ptr, &mut tam) };
    if achou == 0 || ptr.is_null() || tam < 4 { return Vec::new() }
    let n = (tam as usize) / 4;
    let base = ptr as *const u16;
    let mut pares = Vec::with_capacity(n);
    for i in 0..n {
        unsafe {
            let idioma = std::ptr::read_unaligned(base.add(i * 2));
            let pagina = std::ptr::read_unaligned(base.add(i * 2 + 1));
            pares.push((idioma, pagina));
        }
    }
    pares
}

#[cfg(windows)]
fn ler_versao(bloco: &[u8], idioma: u16, pagina: u16, chave: &str) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::VerQueryValueW;
    let consulta = format!("\\StringFileInfo\\{idioma:04X}{pagina:04X}\\{chave}");
    let wide: Vec<u16> = consulta.encode_utf16().chain(std::iter::once(0)).collect();
    let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut tam = 0u32;
    let achou = unsafe { VerQueryValueW(bloco.as_ptr() as _, wide.as_ptr(), &mut ptr, &mut tam) };
    if achou == 0 || ptr.is_null() || tam <= 1 { return None }
    let fatia = unsafe { std::slice::from_raw_parts(ptr as *const u16, (tam as usize) - 1) };
    let texto = String::from_utf16_lossy(fatia).trim().trim_matches('\0').trim().to_string();
    if texto.is_empty() { None } else { Some(texto) }
}

fn limpar_nome_exe(caminho: &str) -> String {
    let arquivo = caminho.rsplit(['\\', '/']).next().unwrap_or("");
    let sem_ext = if arquivo.len() >= 4 && arquivo[arquivo.len() - 4..].eq_ignore_ascii_case(".exe") {
        &arquivo[..arquivo.len() - 4]
    } else {
        arquivo
    };
    let mut nome = sem_ext.to_string();
    for trecho in ["-Win64-Shipping", "-Win64", "_x64"] {
        nome = tirar_trecho(&nome, trecho);
    }
    nome
}

fn tirar_trecho(nome: &str, trecho: &str) -> String {
    let baixo = nome.to_ascii_lowercase();
    let alvo = trecho.to_ascii_lowercase();
    match baixo.find(&alvo) {
        Some(i) => {
            let mut s = String::with_capacity(nome.len() - trecho.len());
            s.push_str(&nome[..i]);
            s.push_str(&nome[i + trecho.len()..]);
            tirar_trecho(&s, trecho)
        }
        None => nome.to_string(),
    }
}

fn cortar_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
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
