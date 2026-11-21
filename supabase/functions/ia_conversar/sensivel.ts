// Detector de conteúdo sensível (regras locais, sem chamar IA nenhuma).
// O que for sensível nunca vai para o Gemini grátis (o Google pode treinar com os dados).
// Na dúvida, marca como sensível: errar para o lado seguro custa só usar o Groq.

export interface Sensibilidade {
  sensivel: boolean;
  motivos: string[];
}

/** minúsculas e sem acento, para as regras ficarem simples */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function luhnValido(digitos: string): boolean {
  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (dobrar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

const DOCUMENTO = [
  { motivo: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
  { motivo: 'cnpj', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/ },
];

const SEGREDO =
  /\b(senha|password|passwd|pin do|token|api ?key|chave (da |de )?api|chave secreta|segredo|secret|codigo de (verificacao|seguranca|acesso)|2fa|cvv|cvc)\b|\b(sk-[a-z0-9]{10,}|gsk_[a-z0-9]{10,}|aiza[0-9a-z_-]{20,}|ghp_[a-z0-9]{20,})/;

const SAUDE =
  /\b(diagnostic\w*|doenca\w*|sintoma\w*|remedio\w*|medicament\w*|receita medica|exame\w*|laudo\w*|medic[oa]s?\b|psiquiatr\w*|psicolog\w*|terapia\w*|terapeuta\w*|ansiedade|depress\w*|cancer|tumor\w*|hiv|aids|ist\b|gravid\w*|gestacao|aborto|pressao alta|hipertens\w*|diabet\w*|cirurgi\w*|internac\w*|hospital\w*|plano de saude|convenio medico|tdah|autism\w*|bipolar|suicid\w*|vici[oa]\w*|dependencia quimica)/;

const FINANCAS =
  /\b(salario\w*|saldo\w*|conta bancaria|conta corrente|agencia|extrato\w*|divida\w*|emprestimo\w*|financiamento\w*|fatura\w*|cartao de credito|cartao de debito|limite do cartao|investiment\w*|patrimonio|imposto de renda|irpf|chave pix|pix\b|boleto\w*|renda mensal|holerite|contracheque|score de credito|serasa)/;

export function avaliarSensibilidade(texto: string): Sensibilidade {
  const t = normalizar(texto);
  const motivos: string[] = [];

  for (const d of DOCUMENTO) if (d.re.test(t)) motivos.push(d.motivo);

  // Cartão: 13 a 19 dígitos (com espaço ou hífen) que passam no teste de Luhn.
  for (const m of t.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digitos = m[0].replace(/\D/g, '');
    if (digitos.length >= 13 && digitos.length <= 19 && luhnValido(digitos)) {
      motivos.push('cartao');
      break;
    }
  }

  if (SEGREDO.test(t)) motivos.push('credencial');
  if (SAUDE.test(t)) motivos.push('saude');
  if (FINANCAS.test(t)) motivos.push('financas');

  return { sensivel: motivos.length > 0, motivos: [...new Set(motivos)] };
}
