// Voz natural do J.A.R.V.I.S. no PC: Piper (TTS neural aberto, roda no próprio PC, grátis e sem
// limite) com a voz masculina pt-BR "faber". Não é voz clonada de ninguém.
//
// A voz não vem no instalador (~85 MB): o dono instala com um clique no app. Os arquivos vêm
// das fontes oficiais (GitHub do projeto Piper e Hugging Face rhasspy/piper-voices), são
// conferidos por SHA-256 e ficam na pasta do programa (no D:), não no C:.
//
// Para responder rápido, o piper.exe fica aberto em segundo plano (modo --json-input): cada
// frase é uma linha JSON e ele devolve o caminho do .wav gerado (apagado logo depois de lido).
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;

struct Arquivo {
    url: &'static str,
    nome: &'static str,
    sha256: &'static str,
}

const PIPER_ZIP: Arquivo = Arquivo {
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    nome: "piper_windows_amd64.zip",
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
};
const MODELO: Arquivo = Arquivo {
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx",
    nome: "pt_BR-faber-medium.onnx",
    sha256: "858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7",
};
const MODELO_JSON: Arquivo = Arquivo {
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json",
    nome: "pt_BR-faber-medium.onnx.json",
    sha256: "7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f",
};
/// Tamanho total aproximado (para a barra de progresso).
const TOTAL_BYTES: u64 = 22_477_236 + 63_201_294 + 4_855;

static BAIXANDO: AtomicBool = AtomicBool::new(false);

struct Piper {
    filho: Child,
    entrada: ChildStdin,
    saida: BufReader<ChildStdout>,
}

static PIPER: Mutex<Option<Piper>> = Mutex::new(None);

#[cfg(windows)]
fn sem_janela(c: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    c.creation_flags(CREATE_NO_WINDOW)
}
#[cfg(not(windows))]
fn sem_janela(c: &mut Command) -> &mut Command {
    c
}

/// Pasta da voz: ao lado do programa instalado (D:\Programas\JARVIS\voz). Se não der para
/// escrever lá, usa a pasta de dados do app.
fn pasta(app: &tauri::AppHandle) -> PathBuf {
    if let Some(p) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("voz"))) {
        if fs::create_dir_all(&p).is_ok() {
            let teste = p.join(".escrita");
            if fs::write(&teste, b"ok").is_ok() {
                let _ = fs::remove_file(teste);
                return p;
            }
        }
    }
    let p = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("voz");
    let _ = fs::create_dir_all(&p);
    p
}

fn piper_exe(p: &Path) -> PathBuf {
    p.join("piper").join("piper.exe")
}

fn instalada(p: &Path) -> bool {
    piper_exe(p).is_file() && p.join(MODELO.nome).is_file() && p.join(MODELO_JSON.nome).is_file()
}

#[derive(Serialize)]
pub struct EstadoVoz {
    instalada: bool,
    baixando: bool,
    baixado: u64,
    total: u64,
    pasta: String,
}

#[tauri::command]
pub fn voz_estado(app: tauri::AppHandle) -> EstadoVoz {
    let p = pasta(&app);
    let mut baixado = 0;
    for a in [&PIPER_ZIP, &MODELO, &MODELO_JSON] {
        for nome in [format!("{}.parte", a.nome), a.nome.to_string()] {
            if let Ok(m) = fs::metadata(p.join(nome)) {
                baixado += m.len();
            }
        }
    }
    if piper_exe(&p).is_file() && !p.join(PIPER_ZIP.nome).is_file() {
        baixado += 22_477_236; // o zip já foi extraído e apagado
    }
    EstadoVoz {
        instalada: instalada(&p),
        baixando: BAIXANDO.load(Ordering::SeqCst),
        baixado: baixado.min(TOTAL_BYTES),
        total: TOTAL_BYTES,
        pasta: p.display().to_string(),
    }
}

fn sha256_do_arquivo(arquivo: &Path) -> Result<String, String> {
    // certutil vem em todo Windows: evita mais uma dependência só para isso.
    let saida = sem_janela(Command::new("certutil.exe").arg("-hashfile").arg(arquivo).arg("SHA256"))
        .output()
        .map_err(|e| format!("não consegui conferir o arquivo: {e}"))?;
    let texto = String::from_utf8_lossy(&saida.stdout);
    texto
        .lines()
        .map(|l| l.trim().replace(' ', "").to_lowercase())
        .find(|l| l.len() == 64 && l.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(|| "não consegui conferir o arquivo baixado".to_string())
}

fn baixar(a: &Arquivo, p: &Path) -> Result<PathBuf, String> {
    let destino = p.join(a.nome);
    if destino.is_file() && sha256_do_arquivo(&destino).ok().as_deref() == Some(a.sha256) {
        return Ok(destino);
    }
    let parte = p.join(format!("{}.parte", a.nome));
    let _ = fs::remove_file(&parte);
    // curl.exe também vem no Windows 10/11.
    let st = sem_janela(
        Command::new("curl.exe")
            .args(["-L", "--fail", "--silent", "--show-error", "--retry", "2", "-o"])
            .arg(&parte)
            .arg(a.url),
    )
    .status()
    .map_err(|e| format!("não consegui baixar {}: {e}", a.nome))?;
    if !st.success() {
        let _ = fs::remove_file(&parte);
        return Err(format!("o download de {} falhou (verifique a internet)", a.nome));
    }
    let hash = sha256_do_arquivo(&parte)?;
    if hash != a.sha256 {
        let _ = fs::remove_file(&parte);
        return Err(format!("{} chegou diferente do esperado e foi descartado", a.nome));
    }
    let _ = fs::remove_file(&destino);
    fs::rename(&parte, &destino).map_err(|e| e.to_string())?;
    Ok(destino)
}

fn instalar(p: &Path) -> Result<(), String> {
    baixar(&MODELO_JSON, p)?;
    baixar(&MODELO, p)?;
    if !piper_exe(p).is_file() {
        let zip = baixar(&PIPER_ZIP, p)?;
        // O tar.exe do Windows abre .zip.
        let st = sem_janela(Command::new("tar.exe").arg("-xf").arg(&zip).arg("-C").arg(p))
            .status()
            .map_err(|e| format!("não consegui extrair o Piper: {e}"))?;
        if !st.success() || !piper_exe(p).is_file() {
            return Err("não consegui extrair o Piper".into());
        }
        let _ = fs::remove_file(zip);
    }
    Ok(())
}

/// Baixa e instala a voz (uma vez só). Demora conforme a internet; o app acompanha pelo voz_estado.
#[tauri::command]
pub async fn voz_instalar(app: tauri::AppHandle) -> Result<(), String> {
    if BAIXANDO.swap(true, Ordering::SeqCst) {
        return Err("A voz já está sendo baixada.".into());
    }
    let p = pasta(&app);
    let r = tauri::async_runtime::spawn_blocking(move || instalar(&p))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    BAIXANDO.store(false, Ordering::SeqCst);
    r.map_err(|e| format!("Não consegui instalar a voz: {e}."))
}

fn abrir_piper(p: &Path) -> Result<Piper, String> {
    let saidas = p.join("falas");
    let _ = fs::create_dir_all(&saidas);
    let mut filho = sem_janela(
        Command::new(piper_exe(p))
            .current_dir(p.join("piper"))
            .arg("--model")
            .arg(p.join(MODELO.nome))
            .arg("--json-input")
            .arg("--output_dir")
            .arg(&saidas)
            // Um pouco mais ágil que o padrão (o dono achou a voz lenta).
            .args(["--length_scale", "0.92", "--sentence_silence", "0.18"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null()),
    )
    .spawn()
    .map_err(|e| format!("não consegui abrir o Piper: {e}"))?;
    let entrada = filho.stdin.take().ok_or("sem entrada do Piper")?;
    let saida = BufReader::new(filho.stdout.take().ok_or("sem saída do Piper")?);
    Ok(Piper { filho, entrada, saida })
}

fn sintetizar(piper: &mut Piper, texto: &str) -> Result<Vec<u8>, String> {
    // Modo pasta (--output_dir): o Piper cria um .wav com nome único e escreve o caminho na saída.
    let linha = serde_json::json!({ "text": texto });
    writeln!(piper.entrada, "{linha}").map_err(|e| e.to_string())?;
    piper.entrada.flush().map_err(|e| e.to_string())?;
    let mut caminho = String::new();
    if piper.saida.read_line(&mut caminho).map_err(|e| e.to_string())? == 0 {
        return Err("o Piper fechou".into());
    }
    // O Piper responde com o caminho do .wav que gerou.
    let gerado = PathBuf::from(caminho.trim());
    let bytes = fs::read(&gerado).map_err(|e| format!("não achei o áudio gerado: {e}"))?;
    let _ = fs::remove_file(&gerado);
    Ok(bytes)
}

/// Gera a fala de um trecho curto e devolve o .wav (bytes).
#[tauri::command]
pub async fn voz_falar(app: tauri::AppHandle, texto: String) -> Result<tauri::ipc::Response, String> {
    let texto: String = texto.chars().filter(|c| !c.is_control() || *c == ' ').take(1200).collect();
    if texto.trim().is_empty() {
        return Err("Texto vazio.".into());
    }
    let p = pasta(&app);
    if !instalada(&p) {
        return Err("A voz natural não está instalada.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut guarda = PIPER.lock().map_err(|_| "voz travada".to_string())?;
        // Tenta com o Piper que já está aberto; se ele tiver fechado, abre de novo uma vez.
        for tentativa in 0..2 {
            if guarda.is_none() {
                *guarda = Some(abrir_piper(&p)?);
            }
            match sintetizar(guarda.as_mut().unwrap(), &texto) {
                Ok(b) => return Ok(b),
                Err(e) => {
                    if let Some(mut velho) = guarda.take() {
                        let _ = velho.filho.kill();
                    }
                    if tentativa == 1 {
                        return Err(e);
                    }
                }
            }
        }
        Err("não consegui gerar a fala".into())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
