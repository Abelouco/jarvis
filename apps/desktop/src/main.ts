import type { JarvisEvent } from '@jarvis/core';
import { jarvis } from './jarvis';
import './estilo.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const pulsos: JarvisEvent[] = [];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function render() {
  const sessao = await jarvis.auth.sessao();
  if (!sessao) return renderLogin();
  const lista = await jarvis.tarefas.listar();
  const { estado, ultimoErro } = jarvis.estado();
  app.innerHTML = `
    <main>
      <h1>J.A.R.V.I.S.</h1>
      <p class="sub">sync: ${estado}${ultimoErro ? ` · ${esc(ultimoErro)}` : ''}</p>
      <form id="nova"><input name="t" placeholder="nova tarefa" autocomplete="off" /><button>+</button></form>
      <ul>
        ${lista.map((t) => `
          <li data-id="${t.id}" class="${t.done_at ? 'feito' : ''}">
            <span class="marca">${t.done_at ? '✓' : '○'}</span>${esc(t.title)}
            <button class="apagar" title="apagar">×</button>
          </li>`).join('') || '<li class="sub">nenhuma tarefa</li>'}
      </ul>
      <p class="sub">pulsos (eventos reais):</p>
      ${pulsos.map((p) => `<p class="pulso">• ${p.kind} ${p.entity_type ?? ''} ${new Date(p.created_at).toLocaleTimeString('pt-BR')}</p>`).join('')}
      <button id="sair" class="link">sair</button>
    </main>`;

  app.querySelector<HTMLFormElement>('#nova')!.onsubmit = async (e) => {
    e.preventDefault();
    const campo = (e.target as HTMLFormElement).t as HTMLInputElement;
    if (campo.value.trim()) await jarvis.tarefas.criar(campo.value);
  };
  app.querySelectorAll<HTMLLIElement>('li[data-id]').forEach((li) => {
    li.onclick = (e) => {
      const id = li.dataset.id!;
      if ((e.target as HTMLElement).classList.contains('apagar')) void jarvis.tarefas.apagar(id);
      else void jarvis.tarefas.alternarConcluida(id);
    };
  });
  app.querySelector<HTMLButtonElement>('#sair')!.onclick = () => void jarvis.auth.sair();
  app.querySelector<HTMLInputElement>('#nova input')!.focus();
}

let ultimoEmail = '';
let criando = false;

function renderLogin(msg = '') {
  app.innerHTML = `
    <main>
      <h1>J.A.R.V.I.S.</h1>
      <form id="login">
        <input name="email" type="email" placeholder="seu e-mail" autocomplete="email" value="${esc(ultimoEmail)}" />
        <input name="senha" type="password" placeholder="senha" autocomplete="${criando ? 'new-password' : 'current-password'}" />
        <button>${criando ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <button id="alternar" class="link">${criando ? 'Já tenho conta: entrar' : 'Não tem conta? Criar conta'}</button>
      <p class="erro">${esc(msg)}</p>
    </main>`;
  const form = app.querySelector<HTMLFormElement>('#login')!;
  app.querySelector<HTMLButtonElement>('#alternar')!.onclick = () => {
    ultimoEmail = (form.email as HTMLInputElement).value;
    criando = !criando;
    renderLogin();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    ultimoEmail = (form.email as HTMLInputElement).value;
    const senha = (form.senha as HTMLInputElement).value;
    try {
      if (!criando) return await jarvis.auth.entrar(ultimoEmail, senha);
      const entrou = await jarvis.auth.criarConta(ultimoEmail, senha);
      if (!entrou) {
        criando = false;
        renderLogin('Conta criada. Confirme pelo link no seu e-mail e depois entre.');
      }
    } catch (err) {
      renderLogin(err instanceof Error ? err.message : String(err));
    }
  };
}

// Redesenha quando algo muda, sem roubar o texto que está sendo digitado.
let pendente = false;
function agendarRender() {
  if (pendente) return;
  pendente = true;
  requestAnimationFrame(() => {
    pendente = false;
    const digitando = document.activeElement as HTMLInputElement | null;
    if (digitando?.tagName === 'INPUT' && digitando.value) return;
    void render();
  });
}

jarvis.aoMudar(agendarRender);
jarvis.aoEvento((e) => {
  pulsos.unshift(e);
  pulsos.length = Math.min(pulsos.length, 5);
  agendarRender();
});
void jarvis.iniciar().then(render);
