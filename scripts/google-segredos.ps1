# Guarda o cliente OAuth do Google nos secrets do Supabase (Fase 4 · etapa 4).
# O dono só cola os dois valores; a chave secreta não aparece na tela e não fica em arquivo nenhum.
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'J.A.R.V.I.S. - conexao com o Google' -ForegroundColor Cyan
Write-Host 'Cole os valores do cliente OAuth (Google Cloud > APIs e servicos > Credenciais).'
Write-Host ''
$id = (Read-Host 'ID do cliente (termina em .apps.googleusercontent.com)').Trim()
if ($id -notmatch '\.apps\.googleusercontent\.com$') { throw 'Esse nao parece o ID do cliente.' }
$seguro = Read-Host 'Chave secreta do cliente (nao aparece enquanto cola)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
try {
  $segredo = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim()
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ($segredo.Length -lt 10) { throw 'Chave secreta vazia ou curta demais.' }
npx.cmd -y supabase@latest secrets set "GOOGLE_CLIENT_ID=$id" "GOOGLE_CLIENT_SECRET=$segredo" --project-ref pmqxeikcnuywvcxkeoep
$segredo = $null
Write-Host ''
Write-Host 'Pronto: chaves guardadas no Supabase. Pode fechar esta aba.' -ForegroundColor Green
