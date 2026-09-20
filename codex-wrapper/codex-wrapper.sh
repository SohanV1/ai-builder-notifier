#!/usr/bin/env bash
# ==============================================================================
# codex-wrapper.sh
# Intercepts Codex CLI executions, monitors for generated code changes,
# and requires WhatsApp approval for significant modifications.
# ==============================================================================

set -e

# Resolve real codex executable
REAL_CODEX=""
if [ -n "$CODEX_ORIGINAL_BIN" ] && [ -x "$CODEX_ORIGINAL_BIN" ]; then
    REAL_CODEX="$CODEX_ORIGINAL_BIN"
elif [ -x "$HOME/.local/bin/codex-original" ]; then
    REAL_CODEX="$HOME/.local/bin/codex-original"
elif [ -x "$HOME/.codex/packages/standalone/current/bin/codex" ]; then
    REAL_CODEX="$HOME/.codex/packages/standalone/current/bin/codex"
else
    # Find codex in PATH excluding this script
    REAL_CODEX=$(which -a codex 2>/dev/null | grep -v "$0" | head -n 1 || true)
fi

if [ -z "$REAL_CODEX" ] || [ ! -x "$REAL_CODEX" ]; then
    echo "Error: Could not locate underlying real Codex binary." >&2
    echo "Please set CODEX_ORIGINAL_BIN or ensure codex-original exists." >&2
    exit 1
fi

# Bypass check if requested
if [ "$AI_NOTIFY_BYPASS" = "1" ] || [[ " $* " == *" --no-notify "* ]]; then
    exec "$REAL_CODEX" "$@"
fi

# Snapshot git status before running Codex
IN_GIT_REPO=0
BEFORE_STATUS=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IN_GIT_REPO=1
    BEFORE_STATUS=$(git status --porcelain 2>/dev/null || true)
fi

# Execute original codex command
"$REAL_CODEX" "$@"
CODEX_EXIT_CODE=$?

# If command failed or not in git repo, exit immediately with codex exit code
if [ $CODEX_EXIT_CODE -ne 0 ] || [ $IN_GIT_REPO -ne 1 ]; then
    exit $CODEX_EXIT_CODE
fi

# Check if working tree changed
AFTER_STATUS=$(git status --porcelain 2>/dev/null || true)

if [ "$BEFORE_STATUS" != "$AFTER_STATUS" ]; then
    echo ""
    echo "[Codex-Notifier] Code changes detected. Analyzing significance..."

    # Check if ai-notify CLI is available
    if command -v ai-notify >/dev/null 2>&1; then
        # Run ai-notify with --agent Codex and --diff
        if git diff HEAD | ai-notify --agent Codex --diff; then
            echo "[Codex-Notifier] Changes approved via WhatsApp."
        else
            echo "[Codex-Notifier] Changes REJECTED or timed out via WhatsApp!"
            read -p "Do you want to revert changes automatically? [Y/n] " -r REPLY
            if [[ "$REPLY" =~ ^[Nn]$ ]]; then
                echo "[Codex-Notifier] Keeping unapproved changes at user request."
            else
                echo "[Codex-Notifier] Rolling back rejected changes..."
                git restore . 2>/dev/null || true
                git clean -df 2>/dev/null || true
                echo "[Codex-Notifier] Working tree reverted to clean state."
            fi
            exit 1
        fi
    else
        echo "[Codex-Notifier] Warning: ai-notify command not found in PATH."
    fi
fi

exit $CODEX_EXIT_CODE
