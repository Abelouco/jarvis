# Política de privacidade do J.A.R.V.I.S.

O J.A.R.V.I.S. é um assistente pessoal, feito para uso do próprio dono deste repositório.

## Dados do Google (Gmail)

- O J.A.R.V.I.S. só acessa o Gmail depois que o dono conecta a conta e permite o acesso na tela do Google.
- Permissões pedidas: `gmail.modify` (ler, rascunhar, arquivar e mover para a lixeira) e `gmail.send` (enviar). Enviar um e-mail sempre pede a confirmação do dono antes.
- O acesso permanente (refresh token) fica guardado criptografado no cofre (Vault) do banco do app e só é lido pelo servidor do próprio app.
- O conteúdo dos e-mails é lido na hora, para responder ao dono, e não é guardado no banco.
- Os dados do Gmail não são vendidos, não são repassados a terceiros, não são usados para publicidade e não são usados para treinar modelos de IA. O assistente não envia conteúdo de e-mail para serviços de IA que possam treinar com os dados.
- O uso dos dados recebidos das APIs do Google segue a [Política de dados do usuário dos serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy), incluindo os requisitos de uso limitado.

## Desconectar e apagar

- O botão "Google" no app desconecta a conta: o acesso é revogado no Google e apagado do cofre na hora.
- Também é possível tirar o acesso em https://myaccount.google.com/permissions.

## Contato

Pelas issues deste repositório: https://github.com/Abelouco/jarvis/issues
