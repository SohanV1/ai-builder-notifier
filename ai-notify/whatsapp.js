/**
 * whatsapp.js
 * Baileys connection manager, session handling, message dispatching, and reply listening
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { formatNotification, evaluateReply, analyzeDiff, getGitDiff } from './utils.js';
import { comprehendMessage, appendHistory, generateChatReply } from './comprehend.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration paths
const CONFIG_DIR = process.env.AI_NOTIFY_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-notify');
const SESSIONS_DIR = process.env.AI_NOTIFY_SESSION_DIR || path.join(CONFIG_DIR, 'sessions');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const DEFAULT_PORT = 49321;

// Ensure configuration directories exist
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

/**
 * Load persisted config or defaults
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return {
    port: DEFAULT_PORT,
    timeoutMs: 180000,
    recipient: null,
    defaultAgent: 'Antigravity'
  };
}

/**
 * Save configuration to disk
 */
export function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    // ignore
  }
}

/**
 * Global connection singleton state
 */
let currentSock = null;
let isConnecting = false;
let isConnected = false;
let userJid = null;

const logger = pino({ level: 'silent' });

/**
 * Connect to WhatsApp Web using Baileys
 * @param {object} options
 * @param {boolean} [options.showQR=false] - Display QR in terminal for pairing
 * @param {Function} [options.onConnected] - Callback on connection open
 * @param {Function} [options.onClose] - Callback on connection closed
 * @returns {Promise<any>}
 */
export async function connectWhatsApp({ showQR = false, onConnected, onClose } = {}) {
  if (currentSock && isConnected) {
    return currentSock;
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  return new Promise((resolve, reject) => {
    try {
      const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['AI-Builder-Notifier', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true
      });

      currentSock = sock;
      isConnecting = true;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log(`[ai-notify] connection.update: connection=${connection}, qr=${!!qr}, code=${lastDisconnect?.error?.output?.statusCode || '-'}`);

        if (qr) {
          // Always export HTML page with sharp SVG QR code for easy scanning
          try {
            const svg = await QRCode.toString(qr, { type: 'svg', margin: 2 });
            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WhatsApp Web Pairing</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #ffffff; padding: 28px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); text-align: center; max-width: 380px; width: 100%; box-sizing: border-box; }
    svg { width: 100%; height: auto; display: block; border-radius: 8px; }
    h2 { color: #059669; margin: 0 0 10px 0; font-size: 22px; }
    p { color: #475569; font-size: 14px; margin: 0 0 20px 0; line-height: 1.5; }
    .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>WhatsApp Pairing</h2>
    <p>Open WhatsApp &gt; <b>Linked Devices</b> &gt; <b>Link a Device</b> and point your camera here:</p>
    ${svg}
    <div class="badge">CMF Watch 3 Pro Notifier</div>
  </div>
</body>
</html>`;
            const htmlPath = path.join(path.dirname(__dirname), 'qr.html');
            fs.writeFileSync(htmlPath, html, 'utf8');
            qrcode.generate(qr, { small: true }, (ascii) => {
              fs.writeFileSync(path.join(path.dirname(__dirname), 'qr.txt'), ascii, 'utf8');
            });
          } catch (err) {
            console.error('[ai-notify] Error exporting qr.html:', err.message);
          }

          if (showQR) {
            console.log('\n======================================================');
            console.log(' Scan this QR code with WhatsApp on your phone:');
            console.log(' (Settings -> Linked Devices -> Link a Device)');
            console.log('======================================================\n');
            qrcode.generate(qr, { small: true });
            console.log('Waiting for scan (auto-refreshes when updated)...');
          }
        }

        if (connection === 'close') {
          isConnected = false;
          isConnecting = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[ai-notify] WhatsApp connection closed (code: ${statusCode || 'unknown'}).`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.error('\nWhatsApp session logged out. Please re-run: ai-notify --connect');
            try {
              fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
              fs.mkdirSync(SESSIONS_DIR, { recursive: true });
            } catch (err) {}
            if (onClose) onClose({ loggedOut: true });
            reject(new Error('WhatsApp session logged out'));
          } else {
            console.log('[ai-notify] Reconnecting to WhatsApp in 1.5s...');
            setTimeout(async () => {
              try {
                const refreshedSock = await connectWhatsApp({ showQR, onConnected, onClose });
                resolve(refreshedSock);
              } catch (e) {
                // will retry
              }
            }, 1500);
          }
        } else if (connection === 'open') {
          isConnected = true;
          isConnecting = false;
          userJid = sock.user.id.replace(/:.*@/, '@');
          if (showQR) {
            console.log('\n WhatsApp successfully connected!');
            console.log(` Connected as: ${sock.user.name || sock.user.id}`);
            console.log(` Notifications target: Note to Self (${userJid})\n`);
          }
          if (onConnected) onConnected(sock);
          resolve(sock);
        }
      });
    } catch (err) {
      isConnecting = false;
      reject(err);
    }
  });
}


/**
 * Determine the destination JID (Note to Self or configured phone)
 * @param {any} sock
 * @param {string|null} customRecipient
 * @returns {string}
 */
export function resolveTargetJid(sock, customRecipient = null) {
  const config = loadConfig();
  const recipient = customRecipient || config.recipient || process.env.AI_NOTIFY_RECIPIENT || null;

  if (recipient) {
    let clean = recipient.replace(/[^0-9]/g, '');
    if (clean.length === 10) {
      clean = `91${clean}`;
    }
    if (!clean.endsWith('@s.whatsapp.net')) {
      clean = `${clean}@s.whatsapp.net`;
    }
    return clean;
  }

  // Fallback to Note to Self if no recipient configured
  if (sock.user && sock.user.id) {
    return sock.user.id.replace(/:.*@/, '@');
  }
  return null;
}

/**
 * Send a notification message via WhatsApp
 * @param {object} params
 * @param {string} params.message
 * @param {string} [params.agent="AI Agent"]
 * @param {string} [params.recipient]
 * @returns {Promise<boolean>}
 */
export async function sendNotification({ message, agent = 'Antigravity', recipient = null }) {
  const sock = await connectWhatsApp({ showQR: false });
  const target = resolveTargetJid(sock, recipient);

  if (!target) {
    throw new Error('Unable to resolve target WhatsApp recipient. Please run: ai-notify --connect');
  }

  const text = formatNotification({ agent, summary: message, needsApproval: false });
  appendHistory('agent', agent, text);
  await sock.sendMessage(target, { text });
  return true;
}

let activeApprovalHandler = null;
let bridgeInitialized = false;

/**
 * Register active approval session listener
 */
export function registerApprovalHandler(handler) {
  activeApprovalHandler = handler;
  return () => {
    if (activeApprovalHandler === handler) {
      activeApprovalHandler = null;
    }
  };
}

/**
 * Continuous bidirectional chat bridge between WhatsApp and AI Assistant
 */
export function setupChatBridge(sock) {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || messages.length === 0) return;

    for (const msg of messages) {
      const fromMe = msg.key.fromMe;
      const remoteJid = msg.key.remoteJid;
      const targetJid = resolveTargetJid(sock);

      console.log(`[ai-notify-debug] Message received: fromMe=${fromMe}, remoteJid=${remoteJid}, targetJid=${targetJid}`);

      // Ignore messages sent by the bot itself
      if (fromMe) continue;

      // Allow if remoteJid matches target number OR if remoteJid is @s.whatsapp.net / @lid
      const targetNum = targetJid.split('@')[0];
      const isTarget = remoteJid.includes(targetNum) || !remoteJid.endsWith('@g.us'); // ignore group chats
      if (!isTarget) {
        continue;
      }

      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!body || !body.trim()) continue;

      // Ignore echoes from AI
      if (body.includes('[Antigravity]') || body.includes('[Codex]') || body.includes('[OpenCode]')) {
        continue;
      }

      console.log(`[ai-notify-bridge] WhatsApp message received: "${body}"`);

      // 1. Check if an approval is currently pending
      if (activeApprovalHandler) {
        try {
          const handled = await activeApprovalHandler(msg, body);
          if (handled) continue;
        } catch (e) {
          console.error('[ai-notify-bridge] Approval handler error:', e);
        }
      }

      // 2. Continuous two-way conversational chat!
      try {
        appendHistory('user', 'User', body);

        // Relay to active Antigravity CLI session if agentapi is available
        const config = loadConfig();
        const convoId = config.conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID || null;
        if (convoId) {
          try {
            const agentapiBin = [
              path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin', 'agentapi'),
              '/home/sohan/.gemini/antigravity-cli/bin/agentapi'
            ].find(p => fs.existsSync(p)) || 'agentapi';
            spawnSync(agentapiBin, ['send-message', '--title=WhatsApp from User', convoId, `[From WhatsApp] ${body}`], { timeout: 5000 });
          } catch (e) {
            console.error('[ai-notify-bridge] agentapi error:', e.message);
          }
        }

        const agentName = config.defaultAgent || 'Antigravity';
        console.log(`[ai-notify-bridge] Generating AI chat reply for: "${body}"...`);
        const reply = await generateChatReply({ userMessage: body, agent: agentName });
        appendHistory('agent', agentName, reply);

        await sock.sendMessage(targetJid, { text: `[${agentName}] ${reply}` });
        console.log(`[ai-notify-bridge] Reply sent to WhatsApp: "${reply}"`);
      } catch (err) {
        console.error(`[ai-notify-bridge] Error handling incoming chat: ${err.message}`);
      }
    }
  });
}

/**
 * Send an approval request message and wait for user's reply (approve / reject)
 * @param {object} params
 * @param {string} params.agent - "Antigravity", "Codex", "OpenCode"
 * @param {string} params.summary - 5-7 word action description
 * @param {number} [params.timeoutMs=180000] - Timeout in milliseconds
 * @param {string} [params.recipient]
 * @returns {Promise<{ approved: boolean, reply: string, reason: string }>}
 */
export async function askApproval({ agent = 'Antigravity', summary, timeoutMs = 180000, recipient = null }) {
  const sock = await connectWhatsApp({ showQR: false });
  const target = resolveTargetJid(sock, recipient);

  if (!target) {
    throw new Error('Unable to resolve target WhatsApp recipient. Please run: ai-notify --connect');
  }

  // Ensure chat bridge is running
  setupChatBridge(sock);

  const promptText = formatNotification({ agent, summary, needsApproval: true });
  appendHistory('agent', agent, promptText);
  await sock.sendMessage(target, { text: promptText });

  return new Promise((resolve) => {
    let timer = null;

    const unregister = registerApprovalHandler(async (msg, body) => {
      console.log(`[ai-notify] Processing approval reply: "${body}"`);
      const analysis = await comprehendMessage({ userMessage: body, agent, currentAction: summary });
      console.log(`[ai-notify] Decision: ${analysis.intent} - "${analysis.reply}"`);

      if (analysis.intent === 'APPROVE') {
        clearTimeout(timer);
        unregister();
        await sock.sendMessage(target, { text: `✅ [${agent}] ${analysis.reply}` });
        resolve({ approved: true, reply: body, reason: analysis.reply });
        return true;
      } else if (analysis.intent === 'REJECT') {
        clearTimeout(timer);
        unregister();
        await sock.sendMessage(target, { text: `❌ [${agent}] ${analysis.reply}` });
        resolve({ approved: false, reply: body, reason: analysis.reply });
        return true;
      } else {
        // Clarification or question: reply on WhatsApp and continue waiting
        await sock.sendMessage(target, { text: `💬 [${agent}] ${analysis.reply}` });
        return true;
      }
    });

    timer = setTimeout(async () => {
      unregister();
      try {
        await sock.sendMessage(target, { text: `⏱️ [${agent}] Timeout waiting for approval (${Math.round(timeoutMs / 1000)}s). Request aborted.` });
      } catch (err) {}
      resolve({ approved: false, reply: 'timeout', reason: `Timeout waiting for response (${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs);
  });
}

/**
 * Start background HTTP daemon for fast local RPC
 * @param {object} options
 * @param {number} [options.port=49321]
 */
export async function startDaemon({ port = DEFAULT_PORT } = {}) {
  console.log(`[ai-notify-daemon] Starting WhatsApp background daemon on port ${port}...`);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // Helper to send JSON
    const sendJson = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (req.method === 'GET' && url.pathname === '/status') {
      return sendJson(200, {
        status: 'ok',
        connected: isConnected,
        user: currentSock?.user || null,
        uptime: process.uptime()
      });
    }

    if (req.method === 'POST' && url.pathname === '/notify') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const agent = data.agent || 'Antigravity';
          const message = data.message || data.summary || 'Update proposed';
          await sendNotification({ message, agent, recipient: data.recipient });
          return sendJson(200, { success: true, message: 'Notification sent' });
        } catch (err) {
          return sendJson(500, { success: false, error: err.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ask') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const agent = data.agent || 'Antigravity';
          const summary = data.summary || data.message || 'Proposing code changes';
          const timeoutMs = data.timeoutMs || 180000;

          const result = await askApproval({
            agent,
            summary,
            timeoutMs,
            recipient: data.recipient
          });
          return sendJson(200, result);
        } catch (err) {
          return sendJson(500, { approved: false, error: err.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/analyze') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const diff = data.diff || getGitDiff(data.cwd || process.cwd());
          const agent = data.agent || 'Antigravity';
          const analysis = analyzeDiff(diff);

          if (data.autoAsk && analysis.isSignificant) {
            const result = await askApproval({
              agent,
              summary: analysis.summary,
              timeoutMs: data.timeoutMs || 180000
            });
            return sendJson(200, { ...analysis, ...result });
          }

          return sendJson(200, analysis);
        } catch (err) {
          return sendJson(500, { error: err.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/stop') {
      sendJson(200, { message: 'Daemon shutting down' });
      process.exit(0);
    }

    sendJson(404, { error: 'Not found' });
  });

  server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(PID_FILE, process.pid.toString(), 'utf8');
    console.log(`[ai-notify-daemon] Running at http://127.0.0.1:${port} (PID: ${process.pid})`);

    // Connect WhatsApp in background and attach continuous chat bridge
    connectWhatsApp({ showQR: false })
      .then((sock) => {
        console.log(`[ai-notify-daemon] WhatsApp connected as ${sock.user?.name || sock.user?.id}`);
        setupChatBridge(sock);
      })
      .catch((err) => {
        console.warn(`[ai-notify-daemon] WhatsApp connection warning: ${err.message}`);
      });
  });

  const cleanup = () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch (e) {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/**
 * Check if the background daemon is currently active
 * @param {number} [port=49321]
 * @returns {Promise<boolean>}
 */
export async function isDaemonRunning(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch (err) {
    return false;
  }
}
