# J.A.R.V.I.S.

Assistente de IA pessoal, no PC e no celular, local-first, com um "cérebro" visível que pulsa a partir de eventos reais.

## Estado atual — Fase 0 (núcleo e sincronização)

- **Núcleo:** Supabase (plano gratuito, região São Paulo), projeto `JARVIS`.
- **Banco:** `supabase/migrations/0001_fase0_nucleo.sql`. Tabelas: projetos, tarefas, lembretes, hábitos (+ registros), memória (+ conexões), eventos, confirmações e recibos de desfazer.
- **Regras do banco:**
  - Cada linha tem dono (`user_id`) e RLS: cada um só vê o que é seu.
  - `updated_at` e `deleted_at` em tudo, para o app puxar "o que mudou desde X" e funcionar offline.
  - Toda mudança gera uma linha em `events`, transmitida em tempo real. É ela que faz o cérebro pulsar.

## Decisões

- PC + celular, com um único código TypeScript: Expo (celular) e Tauri (PC).
- Núcleo na nuvem até haver SSD; depois pode voltar para casa.
- Só serviços gratuitos por enquanto: Groq (caminho rápido, voz para texto), Gemini Flash (raciocínio), troca automática quando um atinge o limite.
- Voz falada: voz própria, inspirada no perfil "lento, confiante e distante" (referência: "Will", da biblioteca do ElevenLabs). Não é cópia de nenhuma pessoa real.
- Herança do Néctar: `dominio_verbo`, "nome ou id", prévia + código para ações arriscadas, desfazer em 24 h, respostas em camadas.

## Documentos

- Engenharia reversa do Néctar e arquitetura: Claude Docs, "Néctar — Engenharia reversa para o J.A.R.V.I.S."
- Conceito visual do cérebro: canvas "J.A.R.V.I.S. — Conceito do cérebro".
