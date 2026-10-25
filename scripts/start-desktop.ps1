# Launch the locally built Tauri app with the current sidecar source.
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$desktopBinary = Join-Path $desktopRoot 'src-tauri\target\debug\jsra-tauri.exe'
$desktopEntry = Join-Path $desktopRoot 'sidecar\index.mjs'
if (-not (Test-Path -LiteralPath $desktopBinary)) {
  throw 'Build the desktop app first: cargo build --manifest-path src-tauri/Cargo.toml'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
$desktopRuntimeNode = (& node -p 'process.execPath').Trim()
& $desktopRuntimeNode (Join-Path $desktopRoot 'scripts\prepare-windows-runtime.mjs') desktop
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
