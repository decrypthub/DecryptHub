# Debug mode (Tauri dev equivalent, no Tauri CLI required):
#   Vite serves the UI with HMR, the debug binary loads http://127.0.0.1:5173
#   - UI changes: hot reload, no rebuild
#   - Rust changes: rebuild first (cargo build), then run this script again
#   - Parallel worktrees: set JSRA_DEV_UI_PORT so each one keeps its own Vite
# Usage: powershell -ExecutionPolicy Bypass -File scripts/dev-desktop.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root 'src-tauri\target\debug\jsra-tauri.exe'
$sidecarEntry = Join-Path $root 'sidecar\index.mjs'
$vitePort = if ($env:JSRA_DEV_UI_PORT) { [int]$env:JSRA_DEV_UI_PORT } else { 5173 }
$logs = Join-Path $root '.tmp'

if (-not (Test-Path -LiteralPath $binary)) {
  throw 'No debug build yet: run scripts\build-desktop.cmd first (vcvars64 + clang-cl + cargo build).'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
$runtimeNode = (& node -p 'process.execPath').Trim()
& $runtimeNode (Join-Path $root 'scripts\prepare-windows-runtime.mjs') desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop executable integrity check failed. Start from a normal Windows terminal.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'sidecar\node_modules'))) { throw 'sidecar deps missing: cd sidecar; npm ci --ignore-scripts' }
New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Test-Port([int]$p) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true } catch { return $false }
}

$vite = $null
if (-not (Test-Port $vitePort)) {
  Write-Output "Starting Vite on 127.0.0.1:$vitePort ..."
  $vite = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', "$vitePort", '--strictPort' `
    -WorkingDirectory $root -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'vite-out.log') -RedirectStandardError (Join-Path $logs 'vite-err.log')
  $ready = $false
  for ($i = 0; $i -lt 150; $i++) { Start-Sleep -Milliseconds 200; if (Test-Port $vitePort) { $ready = $true; break } }
  if (-not $ready) {
    if ($vite -and -not $vite.HasExited) { $vite.Kill() }
    throw 'Vite did not start within 30s, see .tmp\vite-err.log'
  }
} else {
  Write-Output "Reusing Vite already listening on 127.0.0.1:$vitePort"
}

$before = @{ Node = $env:JSRA_SIDECAR_NODE; AppData = $env:DECRYPTHUB_DATA_DIR; DevUrl = $env:JSRA_UI_DEV_URL; Community = $env:DECRYPTHUB_COMMUNITY_URL }
try {
  $env:JSRA_SIDECAR_NODE = $sidecarEntry
  # 开发版默认也用产品正式数据目录，避免「同一个软件换个入口就是另一份空工作台」。
  # 需要与日常数据隔离时显式传 DECRYPTHUB_DATA_DIR=<绝对路径>。
  if (-not $env:DECRYPTHUB_DATA_DIR) { $env:DECRYPTHUB_DATA_DIR = Join-Path $env:APPDATA 'DecryptHub' }
  $env:JSRA_UI_DEV_URL = "http://127.0.0.1:$vitePort/"
  # DECRYPTHUB_COMMUNITY_URL 只影响 debug 构建；留空则连生产社区 decrypthub.cn。
  # 连测试服：$env:DECRYPTHUB_COMMUNITY_URL = 'https://decrypthub.taisuii.cn'
  if ($env:DECRYPTHUB_COMMUNITY_URL) {
    Write-Output "Community origin: $env:DECRYPTHUB_COMMUNITY_URL"
  } else {
    Write-Output 'Community origin: https://decrypthub.cn (default)'
  }
  $app = Start-Process -FilePath $binary -WorkingDirectory $root -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'dev-stdout.log') -RedirectStandardError (Join-Path $logs 'dev-stderr.log')
} finally {
  $env:JSRA_SIDECAR_NODE = $before.Node
  $env:DECRYPTHUB_DATA_DIR = $before.AppData
  $env:JSRA_UI_DEV_URL = $before.DevUrl
  $env:DECRYPTHUB_COMMUNITY_URL = $before.Community
}

Write-Output "Debug mode running: UI from http://127.0.0.1:$vitePort/ , app PID $($app.Id)"
Write-Output 'Press F12 / Ctrl+Shift+I for DevTools when you need it. Closing the window stops Vite too.'
$app.WaitForExit()
if ($vite -and -not $vite.HasExited) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
Write-Output 'App exited.'
