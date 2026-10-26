# Launch the locally built Tauri app with the current sidecar source.
# Keep this file ASCII for Windows PowerShell 5.1 without a UTF-8 BOM.
param([string]$BinaryPath)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$desktopCandidates = @((Join-Path $desktopRoot 'src-tauri\target\debug\jsra-tauri.exe'), (Join-Path $desktopRoot '.tmp\projects-harness-target\debug\jsra-tauri.exe'))
$desktopBinary = if ($BinaryPath) { [IO.Path]::GetFullPath($BinaryPath) } else { ($desktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Get-Item | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
$desktopEntry = Join-Path $desktopRoot 'sidecar\index.mjs'
if (-not $desktopBinary -or -not (Test-Path -LiteralPath $desktopBinary)) {
  throw 'Build the desktop app first: cargo build --manifest-path src-tauri/Cargo.toml'
}
$desktopRunning = Get-CimInstance Win32_Process -Filter "Name='jsra-tauri.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($desktopRoot + '\', [StringComparison]::OrdinalIgnoreCase) }
if ($desktopRunning) { throw 'Close the running DecryptHub window before starting another instance with the same session data.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
$desktopRuntimeNode = (& node -p 'process.execPath').Trim()
$desktopOldTarget = $env:CARGO_TARGET_DIR
try {
  $env:CARGO_TARGET_DIR = Split-Path -Parent (Split-Path -Parent $desktopBinary)
  & $desktopRuntimeNode (Join-Path $desktopRoot 'scripts\prepare-windows-runtime.mjs') desktop
} finally { $env:CARGO_TARGET_DIR = $desktopOldTarget }
if ($LASTEXITCODE -ne 0) { throw 'Desktop executable integrity check failed. Start from a normal Windows terminal.' }

$desktopLogs = Join-Path $desktopRoot '.tmp'
New-Item -ItemType Directory -Path $desktopLogs -Force | Out-Null
$desktopOldEntry = $env:JSRA_SIDECAR_NODE
$desktopOldAppData = $env:DECRYPTHUB_DATA_DIR
try {
  $env:JSRA_SIDECAR_NODE = $desktopEntry
  $env:DECRYPTHUB_DATA_DIR = Join-Path $desktopRoot '.tmp\desktop-appdata\WebDecryptHub'
  $desktopProcess = Start-Process -FilePath $desktopBinary -WorkingDirectory $desktopRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $desktopLogs 'desktop-stdout.log') `
    -RedirectStandardError (Join-Path $desktopLogs 'desktop-stderr.log')
} finally {
  $env:JSRA_SIDECAR_NODE = $desktopOldEntry
  $env:DECRYPTHUB_DATA_DIR = $desktopOldAppData
}
Write-Output ('Desktop started. PID: ' + $desktopProcess.Id)
