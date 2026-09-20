# ==============================================================================
# setup.ps1
# Automated installer for AI Builder Notifier (Windows PowerShell)
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "    AI Builder Notifier — Automated Setup (Windows)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js and npm
Write-Host "[1/7] Checking Node.js and npm..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/"
    exit 1
}
$nodeVer = node -v
Write-Host "Found Node.js $nodeVer and npm $(npm -v)" -ForegroundColor Green

# 2. Install dependencies in ai-notify
Write-Host "`n[2/7] Installing npm dependencies in ai-notify..." -ForegroundColor Yellow
Set-Location "$RootDir\ai-notify"
npm install --no-audit --no-fund

# 3. Create Windows CLI runner in %USERPROFILE%\bin
Write-Host "`n[3/7] Setting up ai-notify CLI in %USERPROFILE%\bin..." -ForegroundColor Yellow
$userBin = "$env:USERPROFILE\bin"
if (-not (Test-Path $userBin)) {
    New-Item -ItemType Directory -Path $userBin -Force | Out-Null
}

$entryPath = "$RootDir\ai-notify\index.js"
$cmdScript = @"
@echo off
node "$entryPath" %*
"@
Set-Content -Path "$userBin\ai-notify.cmd" -Value $cmdScript -Encoding ASCII
Set-Content -Path "$userBin\ai-notify.bat" -Value $cmdScript -Encoding ASCII

# Ensure %USERPROFILE%\bin is in User PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$userBin*") {
    Write-Host "Adding $userBin to User PATH..." -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("Path", "$userBin;$userPath", "User")
    $env:Path = "$userBin;$env:Path"
}
Write-Host "Installed ai-notify at $userBin\ai-notify.cmd" -ForegroundColor Green

# 4. Install OpenCode plugin
Write-Host "`n[4/7] Installing OpenCode plugin..." -ForegroundColor Yellow
$opencodePluginDirs = @(
    "$env:APPDATA\opencode\plugin",
    "$env:USERPROFILE\.config\opencode\plugin",
    "$env:APPDATA\opencode\plugins",
    "$env:USERPROFILE\.config\opencode\plugins"
)
foreach ($dir in $opencodePluginDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Copy-Item "$RootDir\opencode-plugin\ai-notifier.ts" "$dir\ai-notifier.ts" -Force
}
Write-Host "Installed OpenCode plugin." -ForegroundColor Green

# 5. Install Codex wrapper
Write-Host "`n[5/7] Installing Codex wrapper for Windows..." -ForegroundColor Yellow
$codexWrapper = "$RootDir\codex-wrapper\codex-wrapper.bat"
$codexTarget = "$userBin\codex.bat"
Copy-Item $codexWrapper $codexTarget -Force
Write-Host "Installed Codex wrapper at $codexTarget" -ForegroundColor Green

# 6. Install Antigravity skills
Write-Host "`n[6/7] Installing Antigravity skill..." -ForegroundColor Yellow
$skillDirs = @(
    "$env:USERPROFILE\.gemini\antigravity\skills\ai-builder-notifier",
    "$env:USERPROFILE\.agents\skills\ai-builder-notifier"
)
foreach ($dir in $skillDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Copy-Item "$RootDir\SKILL.md" "$dir\SKILL.md" -Force
    Write-Host "Installed SKILL.md to $dir" -ForegroundColor Green
}

# 7. Verification & Next steps
Write-Host "`n[7/7] Installation complete!" -ForegroundColor Cyan
Write-Host "ai-notify CLI is ready in your path." -ForegroundColor Green
Write-Host "`nNext step: Link your WhatsApp account with one-time QR scan:" -ForegroundColor Yellow
Write-Host "    ai-notify --connect`n" -ForegroundColor White
Write-Host "After pairing, test with:" -ForegroundColor Yellow
Write-Host "    ai-notify --agent Antigravity ""Setup verified successfully""`n" -ForegroundColor White

if ($args -contains "--connect") {
    & "$userBin\ai-notify.cmd" --connect
}
