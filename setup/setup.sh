#!/usr/bin/env bash
# ==============================================================================
# setup.sh
# Automated installer for AI Builder Notifier (Linux / macOS)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=================================================================="
echo "    AI Builder Notifier — Automated Setup & Installation"
echo "=================================================================="
echo ""

# 1. Check Node.js and npm
echo "[1/7] Checking Node.js and npm..."
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed. Please install Node.js (v18+) first." >&2
    exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is not installed." >&2
    exit 1
fi
NODE_VER=$(node -v)
echo "Found Node.js $NODE_VER and npm $(npm -v)"

# 2. Install dependencies in ai-notify/
echo ""
echo "[2/7] Installing npm dependencies in ai-notify/..."
cd "$ROOT_DIR/ai-notify"
npm install --no-audit --no-fund

# 3. Install ai-notify CLI to ~/.local/bin/
echo ""
echo "[3/7] Installing ai-notify CLI to ~/.local/bin/..."
mkdir -p "$HOME/.local/bin"

# Create launcher wrapper in ~/.local/bin/ai-notify
AI_NOTIFY_BIN="$HOME/.local/bin/ai-notify"
cat << 'EOF' > "$AI_NOTIFY_BIN"
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_NOTIFY_ENTRY="__ENTRY_PATH__"
if [ ! -f "$AI_NOTIFY_ENTRY" ]; then
    echo "Error: ai-notify entry point not found at $AI_NOTIFY_ENTRY" >&2
    exit 1
fi
exec node "$AI_NOTIFY_ENTRY" "$@"
EOF

# Substitute the absolute path to index.js
sed -i "s|__ENTRY_PATH__|$ROOT_DIR/ai-notify/index.js|g" "$AI_NOTIFY_BIN"
chmod +x "$AI_NOTIFY_BIN"
chmod +x "$ROOT_DIR/ai-notify/index.js"

# Ensure ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo "Adding ~/.local/bin to PATH..."
    export PATH="$HOME/.local/bin:$PATH"
fi
echo "Installed ai-notify at $AI_NOTIFY_BIN"

# 4. Install OpenCode plugin
echo ""
echo "[4/7] Installing OpenCode plugin..."
OPENCODE_PLUGIN_DIR="$HOME/.config/opencode/plugin"
mkdir -p "$OPENCODE_PLUGIN_DIR"
cp "$ROOT_DIR/opencode-plugin/ai-notifier.ts" "$OPENCODE_PLUGIN_DIR/ai-notifier.ts"
# Also install to plugins/ in case version uses plural
mkdir -p "$HOME/.config/opencode/plugins"
cp "$ROOT_DIR/opencode-plugin/ai-notifier.ts" "$HOME/.config/opencode/plugins/ai-notifier.ts"
echo "Installed OpenCode plugin at $OPENCODE_PLUGIN_DIR/ai-notifier.ts"

# 5. Install Codex wrapper script
echo ""
echo "[5/7] Configuring Codex wrapper..."
CODEX_TARGET="$HOME/.local/bin/codex"
CODEX_ORIGINAL="$HOME/.local/bin/codex-original"

if [ -e "$CODEX_TARGET" ] && [ ! -e "$CODEX_ORIGINAL" ]; then
    echo "Saving original Codex executable to $CODEX_ORIGINAL..."
    cp -L "$CODEX_TARGET" "$CODEX_ORIGINAL"
    chmod +x "$CODEX_ORIGINAL"
fi

# Remove target if it exists (prevents overwriting target of existing symlink)
rm -f "$CODEX_TARGET"
cp "$ROOT_DIR/codex-wrapper/codex-wrapper.sh" "$CODEX_TARGET"
chmod +x "$CODEX_TARGET"
echo "Installed Codex wrapper at $CODEX_TARGET"

# 6. Install Antigravity skill
echo ""
echo "[6/7] Installing Antigravity skill..."
SKILL_DIR_1="$HOME/.gemini/antigravity/skills/ai-builder-notifier"
SKILL_DIR_2="$HOME/.agents/skills/ai-builder-notifier"
mkdir -p "$SKILL_DIR_1" "$SKILL_DIR_2"
cp "$ROOT_DIR/SKILL.md" "$SKILL_DIR_1/SKILL.md"
cp "$ROOT_DIR/SKILL.md" "$SKILL_DIR_2/SKILL.md"
echo "Installed SKILL.md to:"
echo " - $SKILL_DIR_1/SKILL.md"
echo " - $SKILL_DIR_2/SKILL.md"

# 7. WhatsApp Connection status
echo ""
echo "[7/7] Setup verification..."
echo "ai-notify CLI is ready at $(which ai-notify 2>/dev/null || echo "$AI_NOTIFY_BIN")"
echo ""
echo "=================================================================="
echo "    Installation Complete!"
echo "=================================================================="
echo ""
echo "Next step: Link your WhatsApp account with one-time QR scan:"
echo "    ai-notify --connect"
echo ""
echo "After pairing, test with:"
echo "    ai-notify --agent Antigravity \"Setup verified successfully\""
echo ""

# If --connect was passed in args, trigger QR scan right away
if [[ "$*" == *"--connect"* ]]; then
    "$AI_NOTIFY_BIN" --connect
fi
