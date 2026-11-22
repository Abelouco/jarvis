# Cria o atalho do J.A.R.V.I.S. (versão instalada) na Área de Trabalho.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\atalho-pc.ps1
$pastas = @(
  (Join-Path $env:LOCALAPPDATA 'JARVIS'),
  (Join-Path $env:LOCALAPPDATA 'Programs\JARVIS'),
  (Join-Path $env:ProgramFiles 'JARVIS')
)
$exe = $null
foreach ($p in $pastas) {
  if (Test-Path $p) {
    $exe = Get-ChildItem $p -Filter *.exe -File | Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
    if ($exe) { break }
  }
}
if (-not $exe) {
  # Procura pelo atalho que o instalador pôs no Menu Iniciar e usa o destino dele.
  $menus = @(
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonPrograms')
  )
  $shellTmp = New-Object -ComObject WScript.Shell
  foreach ($m in $menus) {
    $lnk = Get-ChildItem $m -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
      Where-Object { $_.BaseName -match 'J\.?A\.?R\.?V\.?I\.?S' } | Select-Object -First 1
    if ($lnk) {
      $alvo = $shellTmp.CreateShortcut($lnk.FullName).TargetPath
      if ($alvo -and (Test-Path $alvo)) { $exe = Get-Item $alvo; break }
    }
  }
}
if (-not $exe) {
  Write-Host 'Nao achei o J.A.R.V.I.S. instalado. Instale o .exe da pagina de Releases do GitHub.' -ForegroundColor Red
  exit 1
}
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
# O instalador já cria "JARVIS.lnk". Se já existe um atalho para o mesmo .exe, não duplica.
$existente = Get-ChildItem $desktop -Filter *.lnk -ErrorAction SilentlyContinue |
  Where-Object { $shell.CreateShortcut($_.FullName).TargetPath -eq $exe.FullName } | Select-Object -First 1
if ($existente) {
  Write-Host "Ja existe o atalho: $($existente.FullName)" -ForegroundColor Green
  exit 0
}
$destino = Join-Path $desktop 'JARVIS.lnk'
$atalho = $shell.CreateShortcut($destino)
$atalho.TargetPath = $exe.FullName
$atalho.WorkingDirectory = $exe.DirectoryName
$atalho.IconLocation = "$($exe.FullName),0"
$atalho.Description = 'J.A.R.V.I.S. - assistente pessoal'
$atalho.Save()
Write-Host "Atalho criado: $destino" -ForegroundColor Green
Write-Host "Aponta para: $($exe.FullName)"
