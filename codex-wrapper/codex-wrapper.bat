@echo off
rem ==============================================================================
rem codex-wrapper.bat
rem Windows wrapper for Codex CLI with WhatsApp approval notifications
rem ==============================================================================

setlocal enabledelayedexpansion

rem Resolve original codex binary
if defined CODEX_ORIGINAL_BIN (
    set "REAL_CODEX=%CODEX_ORIGINAL_BIN%"
) else if exist "%USERPROFILE%\bin\codex-original.exe" (
    set "REAL_CODEX=%USERPROFILE%\bin\codex-original.exe"
) else if exist "%LOCALAPPDATA%\Programs\codex\codex.exe" (
    set "REAL_CODEX=%LOCALAPPDATA%\Programs\codex\codex.exe"
) else (
    set "REAL_CODEX=codex-original"
)

rem Check bypass
if "%AI_NOTIFY_BYPASS%"=="1" (
    "%REAL_CODEX%" %*
    exit /b %ERRORLEVEL%
)

rem Snapshot git status
set IN_GIT=0
for /f %%i in ('git rev-parse --is-inside-work-tree 2^>nul') do (
    if "%%i"=="true" set IN_GIT=1
)

if "%IN_GIT%"=="1" (
    git status --porcelain > "%TEMP%\codex_before.txt" 2>nul
)

rem Execute Codex
"%REAL_CODEX%" %*
set CODEX_EXIT=%ERRORLEVEL%

if %CODEX_EXIT% neq 0 exit /b %CODEX_EXIT%
if "%IN_GIT%" neq "1" exit /b 0

git status --porcelain > "%TEMP%\codex_after.txt" 2>nul
fc /b "%TEMP%\codex_before.txt" "%TEMP%\codex_after.txt" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [Codex-Notifier] Changes detected. Requesting WhatsApp approval...
    git diff HEAD | ai-notify.cmd --agent Codex --diff
    if !ERRORLEVEL! equ 0 (
        echo [Codex-Notifier] Changes approved via WhatsApp.
    ) else (
        echo [Codex-Notifier] Changes REJECTED or timed out via WhatsApp!
        echo Rolling back unapproved changes...
        git restore .
        git clean -df
        exit /b 1
    )
)

del "%TEMP%\codex_before.txt" "%TEMP%\codex_after.txt" >nul 2>&1
exit /b %CODEX_EXIT%
