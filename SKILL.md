---
name: ai-builder-notifier
description: Automated watch-friendly WhatsApp notification and approval bridge for AI coding agents (Antigravity, Codex, OpenCode). Prompts user on CMF Watch before significant code modifications.
---

# AI Builder Notifier (Antigravity Skill)

This skill enables Antigravity and companion coding agents to send concise, watch-friendly (5-7 words) WhatsApp push notifications for significant code modifications and wait for user approval ("approve" or "reject") from their smartphone or smartwatch (e.g., CMF Watch 3 Pro).

## Workflow Protocol for Antigravity

Before executing any **significant** file modification, refactor, dependency installation, or architectural change, the agent **MUST** request authorization via `ai-notify`.

### 1. Significance Criteria

**Major / Significant Changes (Notification Required):**
- Modifying security, authentication, or session files (`auth`, `jwt`, `token`, `password`, `permission`)
- Modifying database schemas or migrations (`migration`, `schema`, `models`, `.sql`)
- Adding or modifying project configuration / dependencies (`package.json`, `Cargo.toml`, `Dockerfile`, `.env*`)
- Creating new files or deleting existing files
- Significant code changes (> 15 lines of functional logic)
- Refactoring core routers, API endpoints, or services

**Minor Changes (Proceed Silently):**
- Minor typo fixes or docstring edits (< 10 lines) in non-critical documentation
- Cosmetic whitespace or indentation adjustments
- Adding a single debug log statement in a non-critical file

---

### 2. Formulating the Notification

Notifications must be **concise (5-7 words)** so they fit comfortably on a smartwatch screen:
- ✅ `"Added JWT authentication middleware"` (4 words)
- ✅ `"Updated user schema migration"` (4 words)
- ✅ `"Refactored payment checkout webhook"` (4 words)
- ✅ `"Created Redis caching service"` (4 words)
- ❌ `"I am going to implement a whole new middleware system because the previous one had bugs"` (too long)

---

### 3. Verification & Execution Step

Before making the change, run the `ai-notify` command in bash:

```bash
ai-notify --agent Antigravity --ask "Added JWT authentication middleware"
```

#### Handling the Result:
- **Exit Code 0 (Approved):**
  The user replied `approve`, `yes`, `ok`, etc. Proceed with applying the code changes.
- **Exit Code 1 (Rejected or Timed out):**
  The user replied `reject`, `no`, `cancel`, or timed out.
  **You MUST immediately abort the change.** Do not touch or modify the target files. Inform the user in your response:
  > "Change rejected via WhatsApp: *Added JWT authentication middleware*. Aborted modification."

---

### 4. CLI Reference for Agents

| Command | Description |
|---|---|
| `ai-notify --agent Antigravity --ask "<summary>"` | Sends notification and waits for user's WhatsApp reply |
| `ai-notify --agent Codex --ask "<summary>"` | Identifies request as coming from Codex |
| `git diff \| ai-notify --agent Antigravity --diff` | Auto-analyzes diff; prompts only if change is significant |
| `ai-notify "Build completed"` | Sends a one-way status notification without waiting |
| `ai-notify --connect` | Generates WhatsApp Web QR code in terminal for pairing |

---

### 5. Pairing and Status

If `ai-notify` returns an authentication error indicating the session is missing or expired, prompt the user to link their WhatsApp:
```bash
ai-notify --connect
```
Once linked, the session token is preserved permanently in `~/.config/ai-notify/sessions/`.
