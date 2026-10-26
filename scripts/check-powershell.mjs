// Use Windows PowerShell itself: PowerShell 7 decodes UTF-8 scripts differently.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('Windows PowerShell validation only runs on Windows.');
  process.exit(0);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const command = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$failed = 0
$files = @(Get-ChildItem -LiteralPath $env:DECRYPTHUB_PS_SCRIPTS -Filter '*.ps1' -File)
if (-not $files.Count) { throw 'No PowerShell scripts found' }
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  foreach ($parseIssue in $errors) {
    $failed++
    Write-Output ($file.Name + ':' + $parseIssue.Extent.StartLineNumber + ': ' + $parseIssue.Message)
  }
}
if ($failed) { exit 1 }
Write-Output ('Windows PowerShell ' + $PSVersionTable.PSVersion + ': parsed ' + $files.Count + ' scripts')
`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
  cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, DECRYPTHUB_PS_SCRIPTS: path.join(root, 'scripts') },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
