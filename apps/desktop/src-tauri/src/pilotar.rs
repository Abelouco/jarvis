// Modo controle (Fase 4 · etapa 8): árvore da janela, passos de mouse e teclado,
// PowerShell só depois do cf_, faixa de pânico e pausa quando o dono mexe o mouse.
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub static PARAR: AtomicBool = AtomicBool::new(false);
pub static PAUSADO: AtomicBool = AtomicBool::new(false);
static ULTIMO_MOVIMENTO_NOSSO: AtomicU64 = AtomicU64::new(0);
static EM_CURSO: AtomicBool = AtomicBool::new(false);

const RECUSA: &str = "Isso precisa do computador_comando, com confirmação";
const SENHA: &str = "Digite a senha você mesmo e diga 'continua'";

fn agora_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn travado() -> bool {
    PARAR.load(Ordering::SeqCst) || PAUSADO.load(Ordering::SeqCst)
}

fn marcar_movimento_nosso() {
    ULTIMO_MOVIMENTO_NOSSO.store(agora_ms(), Ordering::SeqCst);
}

#[derive(Serialize)]
pub struct ElementoTela {
    id: String,
    tipo: String,
    nome: String,
    valor: String,
    x: i32,
    y: i32,
    largura: i32,
    altura: i32,
    habilitado: bool,
}

#[derive(Serialize)]
pub struct ArvoreTela {
    elementos: Vec<ElementoTela>,
    processo: String,
    titulo: String,
    largura_tela: i32,
    altura_tela: i32,
}

#[cfg(windows)]
mod win {
    use super::*;
    use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
    use std::collections::HashMap;
    use std::os::windows::process::CommandExt;
    use std::thread;
    use tauri::{AppHandle, Emitter};
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    use uiautomation::patterns::{UIInvokePattern, UIValuePattern};
    use uiautomation::types::Handle;
    use uiautomation::{UIAutomation, UIElement, UITreeWalker};
    use windows_sys::Win32::Foundation::{CloseHandle, POINT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowThreadProcessId,
        SM_CXSCREEN, SM_CYSCREEN,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    static APP: OnceLock<AppHandle> = OnceLock::new();
    static FILA: OnceLock<Mutex<mpsc::Sender<Pedido>>> = OnceLock::new();

    enum Pedido {
        Arvore(mpsc::Sender<Result<ArvoreTela, String>>),
        Passo(Value, mpsc::Sender<Result<(), String>>),
    }

    pub fn ligar(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let _ = APP.set(app.clone());
        garantir_fila();
        thread::spawn(vigiar_mouse);
        let atalho = tauri_plugin_global_shortcut::Shortcut::new(
            Some(tauri_plugin_global_shortcut::Modifiers::CONTROL | tauri_plugin_global_shortcut::Modifiers::SHIFT),
            tauri_plugin_global_shortcut::Code::F12,
        );
        app.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _atalho, evento| {
                    if evento.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        PARAR.store(true, Ordering::SeqCst);
                        let _ = app.emit("controle-panico", ());
                    }
                })
                .build(),
        )?;
        app.global_shortcut().register(atalho)?;
        Ok(())
    }

    fn garantir_fila() {
        static UMA: std::sync::Once = std::sync::Once::new();
        UMA.call_once(|| {
            let (tx, rx) = mpsc::channel::<Pedido>();
            let _ = FILA.set(Mutex::new(tx));
            thread::spawn(move || loop_trabalho(rx));
        });
    }

    fn pedir<T>(pedido: Pedido, rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
        garantir_fila();
        let fila = FILA.get().ok_or("O controle do PC não está pronto.")?;
        fila.lock().map_err(|_| "O controle do PC travou.")?.send(pedido).map_err(|_| "O controle do PC parou.")?;
        rx.recv_timeout(Duration::from_secs(20)).map_err(|_| "A tela não respondeu a tempo.")?
    }

    fn loop_trabalho(rx: mpsc::Receiver<Pedido>) {
        let auto = UIAutomation::new();
        let mut mapa: HashMap<String, UIElement> = HashMap::new();
        let mut enigo = Enigo::new(&Settings::default()).ok();
        while let Ok(pedido) = rx.recv() {
            match pedido {
                Pedido::Arvore(ret) => {
                    let r = match &auto {
                        Ok(a) => montar_arvore(a, &mut mapa),
                        Err(e) => Err(format!("Não abri a árvore da tela: {e}")),
                    };
                    let _ = ret.send(r);
                }
                Pedido::Passo(valor, ret) => {
                    let r = match (&auto, enigo.as_mut()) {
                        (Ok(a), Some(mouse)) => executar_passo(a, mouse, &mapa, &valor),
                        (Err(e), _) => Err(format!("Não abri a árvore da tela: {e}")),
                        _ => Err("O controle do mouse não está pronto.".into()),
                    };
                    let _ = ret.send(r);
                }
            }
        }
    }

    fn cortar(s: String, max: usize) -> String {
        s.chars().take(max).collect()
    }

    fn montar_arvore(auto: &UIAutomation, mapa: &mut HashMap<String, UIElement>) -> Result<ArvoreTela, String> {
        mapa.clear();
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return Err("Não achei a janela da frente.".into());
        }
        let janela = auto.element_from_handle(Handle::from(hwnd as isize)).map_err(|e| format!("Não li a janela: {e}"))?;
        let walker = auto.get_control_view_walker().map_err(|e| format!("Não li a árvore: {e}"))?;
        let mut elementos = Vec::new();
        let mut n = 0i32;
        visitar(&walker, &janela, 0, &mut n, &mut elementos, mapa);
        let (largura, altura) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
        Ok(ArvoreTela {
            elementos,
            processo: nome_exe(hwnd),
            titulo: cortar(janela.get_name().unwrap_or_default(), 120),
            largura_tela: largura,
            altura_tela: altura,
        })
    }

    fn visitar(
        walker: &UITreeWalker, el: &UIElement, profundidade: u8, n: &mut i32,
        saida: &mut Vec<ElementoTela>, mapa: &mut HashMap<String, UIElement>,
    ) {
        if *n >= 300 || profundidade > 12 { return }
        let id = format!("e{n}");
        *n += 1;
        let senha = el.is_password().unwrap_or(false);
        let valor = if senha {
            String::new()
        } else {
            el.get_pattern::<UIValuePattern>().and_then(|p| p.get_value()).unwrap_or_default()
        };
        let rect = el.get_bounding_rectangle().ok();
        let (x, y, largura, altura) = rect.map(|r| (r.get_left(), r.get_top(), r.get_width(), r.get_height())).unwrap_or((0, 0, 0, 0));
        saida.push(ElementoTela {
            id: id.clone(),
            tipo: el.get_localized_control_type().unwrap_or_else(|_| "elemento".into()),
            nome: cortar(el.get_name().unwrap_or_default(), 80),
            valor: cortar(valor, 80),
            x, y, largura, altura,
            habilitado: el.is_enabled().unwrap_or(false),
        });
        mapa.insert(id, el.clone());
        if profundidade == 12 { return }
        let Ok(mut filho) = walker.get_first_child(el) else { return };
        loop {
            visitar(walker, &filho, profundidade + 1, n, saida, mapa);
            match walker.get_next_sibling(&filho) {
                Ok(prox) => filho = prox,
                Err(_) => break,
            }
        }
    }

    fn nome_exe(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 { return String::new() }
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() { return String::new() }
            let mut buf = [0u16; 520];
            let mut tam = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut tam);
            let _ = CloseHandle(h);
            if ok == 0 { return String::new() }
            let caminho = String::from_utf16_lossy(&buf[..tam as usize]);
            caminho.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase()
        }
    }

    fn nome_classe(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
        unsafe {
            let mut buf = [0u16; 128];
            let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if n <= 0 { return String::new() }
            String::from_utf16_lossy(&buf[..n as usize])
        }
    }

    fn shell_proibido(exe: &str) -> bool {
        matches!(exe,
            "powershell.exe" | "pwsh.exe" | "cmd.exe" | "windowsterminal.exe" | "wt.exe" | "regedit.exe" | "mmc.exe")
    }

    fn area_de_trabalho(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
        if nome_exe(hwnd) != "explorer.exe" { return false }
        let classe = nome_classe(hwnd);
        classe.eq_ignore_ascii_case("Progman") || classe.eq_ignore_ascii_case("WorkerW")
    }

    fn executar_passo(auto: &UIAutomation, enigo: &mut Enigo, mapa: &HashMap<String, UIElement>, passo: &Value) -> Result<(), String> {
        if travado() { return Err("parado".into()) }
        let acao = passo.get("acao").and_then(|v| v.as_str()).unwrap_or("");
        match acao {
            "clicar" => clicar(enigo, mapa, passo),
            "digitar" => {
                recusar_shell()?;
                recusar_senha(auto)?;
                let texto = passo.get("texto").and_then(|v| v.as_str()).unwrap_or("");
                if texto.is_empty() || texto.chars().count() > 500 { return Err("Não tenho o que digitar.".into()) }
                enigo.text(texto).map_err(|e| format!("Não digitei: {e}"))
            }
            "tecla" => {
                recusar_shell()?;
                let combinacao = passo.get("combinacao").and_then(|v| v.as_str()).unwrap_or("");
                recusar_tecla(combinacao)?;
                apertar(enigo, combinacao)
            }
            "rolar" => {
                let cima = passo.get("direcao").and_then(|v| v.as_str()) == Some("cima");
                let q = passo.get("quantidade").and_then(|v| v.as_i64()).unwrap_or(1).clamp(1, 10) as i32;
                let delta = if cima { -q } else { q };
                enigo.scroll(delta, Axis::Vertical).map_err(|e| format!("Não rolei: {e}"))
            }
            "esperar" => {
                let mut falta = passo.get("ms").and_then(|v| v.as_u64()).unwrap_or(100).clamp(100, 5000);
                while falta > 0 {
                    if travado() { return Err("parado".into()) }
                    let pedaco = falta.min(100);
                    thread::sleep(Duration::from_millis(pedaco));
                    falta -= pedaco;
                }
                Ok(())
            }
            "abrir" => {
                let alvo = passo.get("alvo").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let tipo = if alvo.starts_with("http://") || alvo.starts_with("https://") {
                    "url"
                } else if alvo.contains('\\') || alvo.contains('/') || alvo.contains("%USERPROFILE%") {
                    "caminho"
                } else {
                    "programa"
                };
                crate::controle::pc_abrir(alvo, tipo.to_string()).map(|_| ())
            }
            _ => Err("Passo desconhecido.".into()),
        }
    }

    fn recusar_shell() -> Result<(), String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if !hwnd.is_null() && shell_proibido(&nome_exe(hwnd)) {
            return Err(RECUSA.into());
        }
        Ok(())
    }

    fn recusar_senha(auto: &UIAutomation) -> Result<(), String> {
        if let Ok(foco) = auto.get_focused_element() {
            if foco.is_password().unwrap_or(false) {
                return Err(SENHA.into());
            }
        }
        Ok(())
    }

    fn recusar_tecla(combinacao: &str) -> Result<(), String> {
        // Mesma normalização do servidor: modificadores em ordem fixa (r+win = win+r).
        let partes: Vec<String> = combinacao.to_ascii_lowercase().replace(' ', "").split('+').map(String::from).collect();
        let ordem = ["ctrl", "alt", "shift", "win"];
        let mut n: Vec<String> = ordem.iter().filter(|m| partes.iter().any(|p| p == *m)).map(|m| m.to_string()).collect();
        n.extend(partes.iter().filter(|p| !ordem.contains(&p.as_str())).cloned());
        let n = n.join("+");
        if n == "win+r" || n == "win+x" || n == "ctrl+shift+esc" {
            return Err(RECUSA.into());
        }
        if n == "alt+f4" {
            let hwnd = unsafe { GetForegroundWindow() };
            if !hwnd.is_null() && area_de_trabalho(hwnd) {
                return Err(RECUSA.into());
            }
        }
        Ok(())
    }

    fn tecla_de(nome: &str) -> Option<Key> {
        Some(match nome {
            "enter" => Key::Return,
            "esc" => Key::Escape,
            "tab" => Key::Tab,
            "backspace" => Key::Backspace,
            "delete" => Key::Delete,
            "espaco" => Key::Space,
            "cima" => Key::UpArrow,
            "baixo" => Key::DownArrow,
            "esquerda" => Key::LeftArrow,
            "direita" => Key::RightArrow,
            "home" => Key::Home,
            "end" => Key::End,
            "pageup" => Key::PageUp,
            "pagedown" => Key::PageDown,
            "f1" => Key::F1,
            "f2" => Key::F2,
            "f3" => Key::F3,
            "f4" => Key::F4,
            "f5" => Key::F5,
            "f6" => Key::F6,
            "f7" => Key::F7,
            "f8" => Key::F8,
            "f9" => Key::F9,
            "f10" => Key::F10,
            "f11" => Key::F11,
            "f12" => Key::F12,
            "ctrl" => Key::Control,
            "alt" => Key::Alt,
            "shift" => Key::Shift,
            "win" => Key::Meta,
            outro if outro.len() == 1 => Key::Unicode(outro.chars().next().unwrap_or('a')),
            _ => return None,
        })
    }

    fn apertar(enigo: &mut Enigo, combinacao: &str) -> Result<(), String> {
        let partes: Vec<&str> = combinacao.split('+').filter(|p| !p.is_empty()).collect();
        if partes.is_empty() { return Err("Tecla desconhecida.".into()) }
        let mut mods = Vec::new();
        let mut tecla = None;
        for p in partes {
            let k = tecla_de(p).ok_or("Tecla desconhecida.")?;
            if matches!(p, "ctrl" | "alt" | "shift" | "win") { mods.push(k); } else { tecla = Some(k); }
        }
        let tecla = tecla.ok_or("Tecla desconhecida.")?;
        for m in &mods {
            enigo.key(*m, Direction::Press).map_err(|e| format!("Não apertei a tecla: {e}"))?;
        }
        let r = enigo.key(tecla, Direction::Click);
        for m in mods.iter().rev() {
            let _ = enigo.key(*m, Direction::Release);
        }
        r.map_err(|e| format!("Não apertei a tecla: {e}"))
    }

    fn clicar(enigo: &mut Enigo, mapa: &HashMap<String, UIElement>, passo: &Value) -> Result<(), String> {
        let direito = passo.get("direito").and_then(|v| v.as_bool()).unwrap_or(false);
        let duplo = passo.get("duplo").and_then(|v| v.as_bool()).unwrap_or(false);
        if let Some(id) = passo.get("alvo_id").and_then(|v| v.as_str()) {
            let el = mapa.get(id).ok_or("Não achei esse elemento na tela.")?;
            if el.get_pattern::<UIInvokePattern>().and_then(|p| p.invoke()).is_ok() && !direito && !duplo {
                return Ok(());
            }
            if let Ok(r) = el.get_bounding_rectangle() {
                let x = r.get_left() + r.get_width() / 2;
                let y = r.get_top() + r.get_height() / 2;
                if y >= 32 { return clique_em(enigo, x, y, direito, duplo) }
            }
        }
        let x = passo.get("x").and_then(|v| v.as_i64()).ok_or("Não sei onde clicar.")? as i32;
        let y = passo.get("y").and_then(|v| v.as_i64()).ok_or("Não sei onde clicar.")? as i32;
        if y < 32 { return Err("Não clico na faixa.".into()) }
        clique_em(enigo, x, y, direito, duplo)
    }

    fn clique_em(enigo: &mut Enigo, x: i32, y: i32, direito: bool, duplo: bool) -> Result<(), String> {
        if travado() { return Err("parado".into()) }
        marcar_movimento_nosso();
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| format!("Não movi o mouse: {e}"))?;
        let botao = if direito { Button::Right } else { Button::Left };
        enigo.button(botao, Direction::Click).map_err(|e| format!("Não cliquei: {e}"))?;
        if duplo {
            thread::sleep(Duration::from_millis(60));
            if travado() { return Err("parado".into()) }
            marcar_movimento_nosso();
            enigo.button(botao, Direction::Click).map_err(|e| format!("Não cliquei: {e}"))?;
        }
        Ok(())
    }

    fn vigiar_mouse() {
        let mut anterior: Option<(i32, i32)> = None;
        loop {
            thread::sleep(Duration::from_millis(100));
            let mut p = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut p) } == 0 { continue }
            let atual = (p.x, p.y);
            if let Some((x, y)) = anterior {
                let dx = (atual.0 - x) as i64;
                let dy = (atual.1 - y) as i64;
                let nosso = agora_ms().saturating_sub(ULTIMO_MOVIMENTO_NOSSO.load(Ordering::SeqCst));
                if dx * dx + dy * dy > 150 * 150 && nosso > 400 && EM_CURSO.load(Ordering::SeqCst) && !PAUSADO.load(Ordering::SeqCst) {
                    PAUSADO.store(true, Ordering::SeqCst);
                    if let Some(app) = APP.get() {
                        let _ = app.emit("controle-pausado", ());
                    }
                }
            }
            anterior = Some(atual);
        }
    }

    pub fn arvore() -> Result<ArvoreTela, String> {
        let (tx, rx) = mpsc::channel();
        pedir(Pedido::Arvore(tx), rx)
    }

    pub fn passo(valor: Value) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        pedir(Pedido::Passo(valor, tx), rx)
    }

    pub fn comando(comando: String) -> Result<String, String> {
        let comando = comando.trim().to_string();
        if comando.is_empty() || comando.len() > 2000 || comando.contains('\0') {
            return Err("Qual comando?".into());
        }
        let mut child = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &comando])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Não abri o PowerShell: {e}"))?;
        let mut saida = child.stdout.take();
        let mut erro = child.stderr.take();
        let t_out = thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut o) = saida.take() { let _ = std::io::Read::read_to_string(&mut o, &mut s); }
            s
        });
        let t_err = thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut o) = erro.take() { let _ = std::io::Read::read_to_string(&mut o, &mut s); }
            s
        });
        let inicio = Instant::now();
        loop {
            if inicio.elapsed() > Duration::from_secs(60) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = t_out.join();
                let _ = t_err.join();
                return Err("O comando passou de 60 segundos.".into());
            }
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(format!("O comando falhou: {e}")),
            }
        }
        let mut texto = t_out.join().unwrap_or_default();
        let err = t_err.join().unwrap_or_default();
        if !err.is_empty() {
            if !texto.is_empty() { texto.push('\n'); }
            texto.push_str(&err);
        }
        if let Some((i, _)) = texto.char_indices().nth(4_000) { texto.truncate(i); }
        Ok(texto)
    }
}

#[cfg(windows)]
pub use win::ligar;

#[cfg(not(windows))]
pub fn ligar(_app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[tauri::command]
pub fn pc_arvore() -> Result<ArvoreTela, String> {
    #[cfg(windows)]
    { return win::arvore() }
    #[cfg(not(windows))]
    Err("O modo controle ainda só funciona no Windows.".into())
}

#[tauri::command]
pub fn pc_passo(passo: Value) -> Result<(), String> {
    #[cfg(windows)]
    { return win::passo(passo) }
    #[cfg(not(windows))]
    { let _ = passo; Err("O modo controle ainda só funciona no Windows.".into()) }
}

#[tauri::command]
pub fn pc_comando(comando: String) -> Result<String, String> {
    #[cfg(windows)]
    { return win::comando(comando) }
    #[cfg(not(windows))]
    { let _ = comando; Err("O comando ainda só funciona no Windows.".into()) }
}

#[tauri::command]
pub fn pc_parar(pausar: bool) {
    if pausar { PAUSADO.store(true, Ordering::SeqCst); }
    else { PARAR.store(true, Ordering::SeqCst); }
}

#[tauri::command]
pub fn pc_retomar() {
    PARAR.store(false, Ordering::SeqCst);
    PAUSADO.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn pc_controle_ativo(ativo: bool) {
    EM_CURSO.store(ativo, Ordering::SeqCst);
    if !ativo {
        PARAR.store(false, Ordering::SeqCst);
        PAUSADO.store(false, Ordering::SeqCst);
    }
}
