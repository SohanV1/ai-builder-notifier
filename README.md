# AI Builder Notifier ⌚💬

Watch-friendly WhatsApp notification and approval bridge for AI coding agents (**Antigravity**, **Codex CLI**, and **OpenCode**). 

Prompts you on your smartphone or smartwatch (e.g. **CMF Watch 3 Pro**) with concise 5-7 word summaries before significant code modifications are applied, and directly acts on your **approve** or **reject** replies.

---

## 🎯 How It Works

```
Agent proposes code change
       │
       ▼
Change Significance Analyzer (utils.js)
       │ Is it a major change?
       ├── No  ──► Agent proceeds silently (no watch spam)
       └── Yes ──► ai-notify sends WhatsApp push notification
                     │
                     ▼
            CMF Watch Vibrates ⌚
            Message: "[Antigravity] Added auth middleware"
            Action:  "Reply 'approve' or 'reject'"
                     │
                     ▼
            You reply "approve" or "reject"
                     │
                     ▼
            ai-notify detects reply
                     │
                     ├── "approve" ──► Agent executes code change
                     └── "reject"  ──► Agent aborts change & reverts
```

---

## 📁 Project Structure

```
ai-builder-notifier/
├── SKILL.md                    # Antigravity skill instructions
├── README.md                   # Complete documentation
├── ai-notify/
│   ├── package.json            # Baileys, qrcode-terminal, pino
│   ├── index.js                # CLI entry point (send / ask / diff / daemon)
│   ├── whatsapp.js             # Baileys connection, session & daemon RPC
│   ├── utils.js                # Change significance analyzer & 5-7 word summarizer
│   └── sessions/               # WhatsApp session credentials (gitignored)
├── opencode-plugin/
│   └── ai-notifier.ts          # OpenCode plugin hook (tool.execute.before)
├── codex-wrapper/
│   ├── codex-wrapper.sh        # Linux Codex wrapper with rollback on reject
│   └── codex-wrapper.bat       # Windows Codex wrapper
└── setup/
    ├── setup.sh                # Linux / macOS automated installer
    └── setup.ps1               # Windows PowerShell automated installer
```

---

## 🚀 Quick Start (Automated Setup)

### Linux / macOS / WSL
From the root of this repo, run:
```bash
./setup/setup.sh
```

### Windows (PowerShell)
```powershell
.\setup\setup.ps1
```

### What Setup Does Automatically:
1. Verifies Node.js (v18+) and npm.
2. Installs required dependencies (`@whiskeysockets/baileys`, `pino`, `qrcode-terminal`) in `ai-notify/`.
3. Installs `ai-notify` CLI permanently into your PATH (`~/.local/bin/ai-notify` on Linux, `%USERPROFILE%\bin\ai-notify.cmd` on Windows).
4. Installs the OpenCode plugin to `~/.config/opencode/plugin/ai-notifier.ts`.
5. Wraps Codex CLI at `~/.local/bin/codex` while backing up the original executable.
6. Installs `SKILL.md` to `~/.gemini/antigravity/skills/ai-builder-notifier/` and `~/.agents/skills/ai-builder-notifier/`.

---

## 📲 One-Time WhatsApp Pairing

Link your WhatsApp Web session using terminal QR scan:

```bash
ai-notify --connect
```

1. Open WhatsApp on your phone.
2. Navigate to **Settings** → **Linked Devices** → **Link a Device**.
3. Scan the QR code displayed in your terminal.
4. Your credentials are securely cached in `~/.config/ai-notify/sessions/`. You do **not** need to scan again.

> **CMF Watch 3 Pro Integration:**
> By default, `ai-notify` messages your **"Note to Self"** chat. When WhatsApp delivers the message to your phone, your CMF Watch 3 Pro vibrates and displays the agent's notification. You can reply with `approve` or `reject` directly from your watch or phone notification shade!

---

## 🤖 Agent Integrations

### 1. Google Antigravity
The installed Antigravity skill (`ai-builder-notifier`) automatically instructs Antigravity:
- When planning significant modifications (auth, database, configs, new files, large edits > 15 lines):
  ```bash
  ai-notify --agent Antigravity --ask "Added JWT auth middleware"
  ```
- If you reply **`approve`** (Exit Code `0`): Antigravity applies the changes.
- If you reply **`reject`** (Exit Code `1`): Antigravity immediately aborts the proposed change and reports rejection to you.

### 2. Codex CLI
Whenever you run `codex`:
- The wrapper monitors repository status.
- If Codex modifies files, it analyzes the diff.
- If significant, it sends:
  `[Codex] Updated database schema in user.sql`
- If you reply **`reject`**, the wrapper automatically rolls back the modifications (`git restore . && git clean -df`) to keep your repo pristine.

### 3. OpenCode Plugin
The plugin hooks into OpenCode's `tool.execute.before`:
- Intercepts file write and replacement tools (`write_to_file`, `replace_file_content`).
- Requests approval with `[OpenCode] ...` before the tool writes to disk.
- Blocks execution if rejected.

---

## 💻 CLI Usage

```bash
# Send a test notification (no waiting)
ai-notify "Build finished successfully"

# Specify agent identity
ai-notify --agent Antigravity "Server restarted"
ai-notify --agent Codex "Tests passing"

# Ask for approval (waits for WhatsApp reply 'approve' or 'reject')
ai-notify --agent Antigravity --ask "Added JWT authentication middleware"

# Pipe a git diff (automatically determines if major and prompts)
git diff | ai-notify --agent Codex --diff

# Inspect git changes in current working tree
ai-notify --analyze-git

# Background daemon management (for instant sub-millisecond dispatch)
ai-notify daemon start
ai-notify daemon status
ai-notify daemon stop
```

---

## ⚙️ Configuration

Settings can be customized in `~/.config/ai-notify/config.json`:
```json
{
  "port": 49321,
  "timeoutMs": 180000,
  "recipient": null,
  "defaultAgent": "Antigravity"
}
```
- `recipient`: Leave as `null` to use "Note to Self" (recommended for single-user smartwatch setups), or set a specific phone number (e.g. `"919876543210"`).
- `timeoutMs`: Milliseconds to wait for your approval before timing out and aborting (default: 3 minutes).

---

## 🛡️ License
MIT
