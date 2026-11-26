# Fase 3: proatividade (avisos), desenho aprovado em 2026-11-26

Objetivo: o J.A.R.V.I.S. avisa por conta própria quando importa, sem virar spam. Começa pelo PC.

## Decisões do dono
- Canal externo: **notificação push no app Android** (Expo Push, grátis). Exige mexer em `apps/mobile` (só o necessário para push) e um novo `eas build -p android --profile preview`.
- **Sem teto de avisos por dia.** O volume é controlado por silêncio, junção de avisos parecidos, prioridade e regras ajustadas pela conversa.
- Padrões: silêncio de 22:00 a 07:00, resumo da manhã às 08:00 e resumo da noite às 21:00.
- Pedidos que entram junto, fora dos avisos:
  - tirar "marcos" da aba Projetos (só a tela; o schema e os dados ficam);
  - no núcleo, nós **verdes** para tarefas de projeto concluídas e nós **azuis** para tarefas em "Fazendo".

## Tabelas (migração `0014_avisos.sql`)
Todas com `user_id` + RLS, `updated_at` (trigger), `deleted_at` e `log_entity_event`.
- `notice_settings` (uma por dono):
  - `enabled`;
  - `quiet_start`/`quiet_end` (`HH:MM`);
  - `morning_at`/`evening_at`;
  - `pc_seen_at` (sinal de PC aberto).
- `push_tokens`: `device_id`, `expo_token`, `platform`, `last_seen_at` (um por aparelho).
- `notice_rules`:
  - `kind` (`tarefa_atrasada`, `lembrete_hora`, `habito_sequencia`, `prazo_projeto`, `diario_vazio`, `resumo_manha`, `resumo_noite`);
  - `entity_id` opcional ("não me avisa mais **disso**");
  - `active`, `fixed_time` ("só às 9h"), `muted_until`.
- `notices` (registro):
  - `kind`, `entity_type`, `entity_id`, `title`, `body`;
  - `reason` (motivo legível);
  - `priority` (`urgente` | `normal` | `baixa`);
  - `status` (`enviado` | `segurado_silencio` | `juntado` | `silenciado` | `agendado`);
  - `channels` (jsonb), `scheduled_for`, `sent_at`, `read_at`, `group_id`;
  - `dedupe_key`, única por dono.

## Vigia
- O `pg_cron` roda a cada 1 minuto e, pelo `pg_net`, faz um POST à Edge Function `avisos_vigia`, com a chave guardada no Vault.
- São cerca de 43 mil chamadas por mês, dentro do plano grátis.
- Os textos saem de modelos fixos (sem IA).

## Regras de decisão (em ordem)
1. Regra ou item silenciado: grava como `silenciado` e não envia.
2. `dedupe_key` repetida: ignora.
3. Hora fixa da regra: `agendado`.
4. Silêncio: só `urgente` fura. O resto fica `segurado_silencio` e vai para o resumo da manhã.
5. Juntar: avisos do mesmo `kind` numa janela de 15 min viram um só.
6. Canal:
   - PC aberto (`pc_seen_at` < 2 min): vai para o PC, pelo Realtime em `notices`, e aparece como notificação do Windows;
   - senão: push no celular;
   - urgente: os dois.
- Urgente = lembrete com alarme ou prioridade alta, ou tarefa de prioridade alta atrasada.
- Sensível nunca vai no texto do push: sai como "conteúdo reservado".

## Gatilhos
- Tarefa atrasada: um aviso por tarefa por dia.
- Lembrete na hora: o PC aberto continua avisando localmente; o servidor registra e cobre o PC fechado.
- Hábito com sequência ≥ 3 e ainda não cumprido: 2 h antes do silêncio.
- Prazo de projeto ou marco: em 3 dias e em 1 dia.
- Dia sem diário: às 21:30, prioridade baixa.
- Resumo da manhã: plano do dia + os avisos segurados no silêncio.
- Resumo da noite: o que foi feito e o que está pendente.

## Etapas
| Etapa | O quê | Claude | Cursor |
|---|---|---|---|
| 0 | Tirar os marcos da aba Projetos e as cores dos nós (verde = concluída, azul = fazendo) | ficha `docs/tarefas/ajustes-projetos.md` e revisão | executa |
| 1 | 0014, `avisos_vigia` (decisão + tarefa atrasada + lembrete), entrega no PC, registro | tudo | — |
| 2 | Push Android: `push_tokens`, registro do token no app e envio pelo Expo Push | servidor, `apps/mobile` mínimo, `eas build` | — |
| 3 | Gatilhos de hábito, prazo e diário, mais juntar | regras | testes em `regras.test.ts` |
| 4 | Resumos da manhã e da noite | tudo | — |
| 5 | Conversa: `avisos_silenciar`, `avisos_horario`, `avisos_configurar`, `avisos_listar`, `avisos_ligar` (via `registrar`, com recibo) | tudo | — |
| 6 | Aba Avisos (lista com o motivo) e configurações | ficha `docs/tarefas/aba-avisos.md` e revisão | executa |

O dono faz sozinho:
- criar o projeto no Firebase e enviar a credencial FCM v1 ao EAS (`eas credentials`);
- rodar o `eas build`;
- instalar o novo .apk.
