/** true só para comando de leitura que não muda nada no PC. Na dúvida, false. */
export function comandoSeguro(comando: string): boolean {
  const texto = comando.trim();
  if (!texto || texto.length > 300) return false;
  if (/[;&`><]|\$\(|@\(|[{}\n]/.test(texto)) return false;

  const primeira = [
    'get-date', 'get-process', 'get-service', 'get-computerinfo', 'get-volume', 'get-psdrive',
    'get-netipaddress', 'get-netadapter', 'get-location', 'get-childitem', 'get-item', 'get-content',
    'get-uptime', 'get-timezone', 'get-culture', 'get-hotfix', 'test-connection', 'test-path',
    'resolve-dnsname', 'ipconfig', 'hostname', 'whoami', 'systeminfo', 'ping', 'tasklist', 'nslookup', 'ver',
  ];
  const seguintes = [
    'select-object', 'where-object', 'sort-object', 'format-table', 'format-list',
    'measure-object', 'out-string', 'select-string', 'group-object',
  ];
  const perigo = [
    '-credential', 'invoke-', 'start-', 'stop-', 'set-', 'remove-', 'new-', 'add-',
    'clear-', 'restart-', 'out-file', 'export-', 'iex', 'downloadstring', '-encodedcommand',
  ];

  const partes = texto.split('|').map((p) => p.trim());
  if (partes.some((p) => p.length === 0)) return false;

  for (let i = 0; i < partes.length; i++) {
    const baixo = partes[i].toLowerCase();
    if (perigo.some((p) => baixo.includes(p))) return false;
    const nome = baixo.split(/\s+/)[0] ?? '';
    if (!(i === 0 ? primeira : seguintes).includes(nome)) return false;
  }
  return true;
}
