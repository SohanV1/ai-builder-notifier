#!/usr/bin/env node

/**
 * index.js
 * CLI entry point for ai-notify
 * Sends WhatsApp notifications, analyzes changes, and handles user approval/rejection replies
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  connectWhatsApp,
  sendNotification,
  askApproval,
  startDaemon,
  isDaemonRunning,
  loadConfig
} from './whatsapp.js';
import { analyzeDiff, getGitDiff, formatNotification } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Print help banner
function printHelp() {
  console.log(`
AI Builder Notifier CLI (ai-notify)
====================================
Watch-friendly WhatsApp notification and approval bridge for AI coding agents.

Usage:
  ai-notify [options] [message]
  ai-notify connect
  ai-notify daemon <start|stop|status>

Commands:
  connect, --connect         Connect to WhatsApp via QR code scan in terminal
  daemon start               Start background WhatsApp daemon (keeps session warm)
  daemon stop                Stop background WhatsApp daemon
  daemon status              Check background daemon status

Options:
  -a, --agent <name>         Specify agent name: Antigravity, Codex, OpenCode (default: Antigravity)
  --ask                      Wait for user's WhatsApp reply ("approve" / "reject")
  --diff                     Read git diff from stdin or repo, auto-analyze significance and ask
  --analyze-git              Analyze unstaged git changes in current directory
  -t, --timeout <seconds>    Approval timeout in seconds (default: 180s)
  -r, --recipient <phone>    Target phone number (default: self / Note to Self)
  -h, --help                 Show this help message

Exit codes:
  0: Success / Approved / Minor change
  1: Rejected / Aborted / Timeout / Error

Examples:
  ai-notify "Build finished successfully"
  ai-notify --agent Codex "Refactored payment gateway"
  ai-notify --agent Antigravity --ask "Added JWT authentication middleware"
  git diff | ai-notify --agent Codex --diff
`);
}

/**
 * Call daemon endpoint via HTTP
 */
async function callDaemon(endpoint, payload = {}, method = 'POST') {
  const config = loadConfig();
  const port = config.port || 49321;
  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method !== 'GET' ? JSON.stringify(payload) : undefined
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Daemon error (${res.status}): ${errorText}`);
  }
  return await res.json();
}

/**
 * Ensure daemon is started if not already running
 */
async function ensureDaemon() {
  const running = await isDaemonRunning();
  if (running) return true;

  // Attempt to spawn daemon in background
  try {
    const child = spawn(process.execPath, [__filename, 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Wait up to 3 seconds for daemon to start
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await isDaemonRunning()) return true;
    }
  } catch (err) {
    // Daemon spawn failed, fallback to direct execution
  }
  return false;
}

/**
 * Read all input from stdin
 */
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => resolve(data));
    // If stdin is a TTY and not piped, immediately resolve empty
    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

// CLI argument parser
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  // Handle daemon command
  if (args[0] === 'daemon') {
    const action = args[1] || 'status';
    if (action === 'start') {
      await startDaemon();
      return;
    }
    if (action === 'status') {
      const running = await isDaemonRunning();
      if (running) {
        const info = await callDaemon('/status', {}, 'GET');
        console.log(`[ai-notify] Daemon is RUNNING.`);
        console.log(` Connected to WhatsApp: ${info.connected}`);
        if (info.user) console.log(` User: ${info.user.name || info.user.id}`);
        console.log(` Uptime: ${Math.round(info.uptime)}s`);
      } else {
        console.log(`[ai-notify] Daemon is NOT running.`);
      }
      return;
    }
    if (action === 'stop') {
      try {
        await callDaemon('/stop', {});
        console.log(`[ai-notify] Daemon stopped.`);
      } catch (e) {
        console.log(`[ai-notify] Daemon is not running or already stopped.`);
      }
      return;
    }
  }

  // Handle connect / QR scan
  if (args.includes('connect') || args.includes('--connect')) {
    console.log('[ai-notify] Initializing WhatsApp pairing session...');
    try {
      await connectWhatsApp({
        showQR: true,
        onConnected: () => {
          console.log('\n Pairing successful! Your WhatsApp session is saved.');
          console.log(' You can now send notifications and receive watch approvals.');
          process.exit(0);
        }
      });
    } catch (err) {
      console.error(`\n Connection failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Parse flags
  let agent = 'Antigravity';
  let ask = false;
  let isDiff = false;
  let analyzeGit = false;
  let timeoutSec = 180;
  let recipient = null;
  const messageParts = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-a' || arg === '--agent') {
      agent = args[++i] || agent;
    } else if (arg === '--ask') {
      ask = true;
    } else if (arg === '--diff') {
      isDiff = true;
    } else if (arg === '--analyze-git') {
      analyzeGit = true;
    } else if (arg === '-t' || arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10) || 180;
    } else if (arg === '-r' || arg === '--recipient') {
      recipient = args[++i] || null;
    } else if (!arg.startsWith('-')) {
      messageParts.push(arg);
    }
  }

  const rawMessage = messageParts.join(' ').trim();

  // Mode: analyze-git
  if (analyzeGit) {
    const diff = getGitDiff();
    const analysis = analyzeDiff(diff);
    console.log('\n--- Git Change Analysis ---');
    console.log(`Significant: ${analysis.isSignificant ? 'YES' : 'NO'}`);
    console.log(`Reason:      ${analysis.reason}`);
    console.log(`Summary:     ${analysis.summary}`);
    console.log(`Stats:       ${analysis.stats.totalFiles} file(s), +${analysis.stats.added}/-${analysis.stats.deleted} lines`);
    console.log('---------------------------\n');
    return;
  }

  // Mode: diff inspection
  if (isDiff) {
    let diff = await readStdin();
    if (!diff || !diff.trim()) {
      diff = getGitDiff();
    }
    const analysis = analyzeDiff(diff);
    console.log(`[ai-notify] Analysis: ${analysis.reason}`);
    console.log(`[ai-notify] Summary: "${analysis.summary}"`);

    if (!analysis.isSignificant) {
      console.log(`[ai-notify] Change is minor. Skipping push notification.`);
      process.exit(0);
    }

    // Significant change: ask for approval
    ask = true;
    const summaryMsg = rawMessage || analysis.summary;

    const daemonReady = await ensureDaemon();
    if (daemonReady) {
      const result = await callDaemon('/ask', {
        agent,
        summary: summaryMsg,
        timeoutMs: timeoutSec * 1000,
        recipient
      });
      if (result.approved) {
        console.log(`\n[ai-notify] ✅ Approved via WhatsApp ("${result.reply}"). Proceeding.`);
        process.exit(0);
      } else {
        console.error(`\n[ai-notify] ❌ Rejected or timed out ("${result.reply || result.reason}"). Aborting.`);
        process.exit(1);
      }
    } else {
      // Direct connection
      const result = await askApproval({
        agent,
        summary: summaryMsg,
        timeoutMs: timeoutSec * 1000,
        recipient
      });
      if (result.approved) {
        console.log(`\n[ai-notify] ✅ Approved via WhatsApp ("${result.reply}"). Proceeding.`);
        process.exit(0);
      } else {
        console.error(`\n[ai-notify] ❌ Rejected or timed out ("${result.reply || result.reason}"). Aborting.`);
        process.exit(1);
      }
    }
    return;
  }

  // Mode: ask or notify with message
  const message = rawMessage || 'Pending change review';

  const daemonReady = await ensureDaemon();

  if (ask) {
    console.log(`[ai-notify] Sending approval request for [${agent}]: "${message}"...`);
    console.log(`[ai-notify] Waiting for reply from WhatsApp (timeout: ${timeoutSec}s)...`);

    try {
      let result;
      if (daemonReady) {
        result = await callDaemon('/ask', {
          agent,
          summary: message,
          timeoutMs: timeoutSec * 1000,
          recipient
        });
      } else {
        result = await askApproval({
          agent,
          summary: message,
          timeoutMs: timeoutSec * 1000,
          recipient
        });
      }

      if (result.approved) {
        console.log(`[ai-notify] ✅ Approved via WhatsApp: "${result.reply}". Proceeding.`);
        process.exit(0);
      } else {
        console.error(`[ai-notify] ❌ Rejected via WhatsApp: "${result.reply || result.reason}". Aborting.`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`[ai-notify] Error requesting approval: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Fire-and-forget notification
    console.log(`[ai-notify] Sending notification [${agent}]: "${message}"...`);
    try {
      if (daemonReady) {
        await callDaemon('/notify', { agent, message, recipient });
      } else {
        await sendNotification({ message, agent, recipient });
      }
      console.log(`[ai-notify] Notification sent successfully.`);
      process.exit(0);
    } catch (err) {
      console.error(`[ai-notify] Error sending notification: ${err.message}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`[ai-notify] Fatal error: ${err.message}`);
  process.exit(1);
});
