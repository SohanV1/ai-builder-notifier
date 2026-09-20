/**
 * comprehend.js
 * Contextual conversation memory & LLM intent comprehension for WhatsApp replies
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const CONFIG_DIR = process.env.AI_NOTIFY_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-notify');
const CONVO_FILE = path.join(CONFIG_DIR, 'conversation.json');

/**
 * Load conversation history
 * @returns {Array<{ role: 'agent'|'user', name: string, text: string, time: string }>}
 */
export function getHistory(limit = 15) {
  try {
    if (fs.existsSync(CONVO_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONVO_FILE, 'utf8'));
      if (Array.isArray(data)) {
        return data.slice(-limit);
      }
    }
  } catch (e) {}
  return [];
}

/**
 * Append message to conversation history
 */
export function appendHistory(role, name, text) {
  try {
    const list = getHistory(50);
    list.push({
      role,
      name: name || (role === 'user' ? 'User' : 'Agent'),
      text: (text || '').trim(),
      time: new Date().toISOString()
    });
    // Keep max 50 entries
    const trimmed = list.slice(-50);
    fs.writeFileSync(CONVO_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Clear conversation history
 */
export function clearHistory() {
  try {
    if (fs.existsSync(CONVO_FILE)) {
      fs.writeFileSync(CONVO_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (e) {}
}

/**
 * Fast heuristic classifier (runs in < 1ms, zero network lag)
 */
export function fastClassify(text) {
  const clean = text.toLowerCase().trim();

  // Strict single-word/short phrase approvals
  const approveStrict = /^(approve|approved|appr|yes|yep|yeah|yup|y|ok|okay|k|proceed|go ahead|do it|lgtm|looks good|sure|accept|confirm|allow|fine|make it so|ship it|do this)$/i;
  if (approveStrict.test(clean)) {
    return { intent: 'APPROVE', reply: 'Approved. Proceeding with changes.' };
  }

  // Strict single-word/short phrase rejections
  const rejectStrict = /^(reject|rejected|rej|no|nah|nope|n|cancel|stop|abort|deny|disallow|dont|don't|halt|drop it)$/i;
  if (rejectStrict.test(clean)) {
    return { intent: 'REJECT', reply: 'Rejected. Changes aborted.' };
  }

  // Multi-word phrase matching with negation detection
  const hasApprove = /\b(approve|approved|lgtm|proceed|go ahead|looks good|do it|make it so|ship it|accept|confirm|allow)\b/i.test(clean);
  const hasReject = /\b(reject|rejected|cancel|abort|stop|halt|deny|disallow|drop it)\b/i.test(clean);
  const hasNegation = /\b(don't|dont|not|never|no|stop|wait|halt|nah|nope)\b/i.test(clean);

  if (hasReject || hasNegation) {
    return { intent: 'REJECT', reply: 'Rejected. Changes aborted.' };
  }
  if (hasApprove) {
    return { intent: 'APPROVE', reply: 'Approved. Proceeding with changes.' };
  }

  return null;
}

/**
 * Asynchronously execute external CLI tool without blocking the Node.js event loop
 */
function runAsyncCLI(bin, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, timeoutMs);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Deep comprehension using LLM + full conversation context
 * @param {object} params
 * @param {string} params.userMessage - Latest message typed by the user on WhatsApp
 * @param {string} [params.agent="Antigravity"] - Active AI agent name
 * @param {string} [params.currentAction="Code modification"] - Active change being proposed
 * @returns {Promise<{ intent: 'APPROVE'|'REJECT'|'QUESTION'|'FEEDBACK', reply: string }>}
 */
export async function comprehendMessage({ userMessage, agent = 'Antigravity', currentAction = '' }) {
  // 1. Instant check (<1ms)
  const fast = fastClassify(userMessage);
  if (fast) {
    appendHistory('user', 'User', userMessage);
    appendHistory('agent', agent, fast.reply);
    return fast;
  }

  // 2. Build full conversation transcript
  const history = getHistory(12);
  const formattedConvo = history.map(h => `${h.role === 'user' ? 'User' : h.name}: ${h.text}`).join('\n');

  const prompt = `You are ${agent}, an AI coding assistant communicating with your developer via WhatsApp.
Current proposed change: "${currentAction}"
Recent Conversation History:
${formattedConvo}
User: ${userMessage}

Determine the user's intent:
1. APPROVE: User agrees or gives go ahead.
2. REJECT: User denies or halts.
3. QUESTION: User asks questions.
4. FEEDBACK: User gives code instructions.

Reply ONLY with valid JSON:
{"intent": "APPROVE" | "REJECT" | "QUESTION" | "FEEDBACK", "reply": "<Short 1-sentence response>"}`;

  const opencodeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  const bin = fs.existsSync(opencodeBin) ? opencodeBin : 'opencode';

  const output = await runAsyncCLI(bin, ['run', '--pure', '-m', 'opencode/mimo-v2.5-free', prompt], 8000);
  if (output) {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.intent && parsed.reply) {
          appendHistory('user', 'User', userMessage);
          appendHistory('agent', agent, parsed.reply);
          return parsed;
        }
      } catch (e) {}
    }
  }

  // Fallback heuristic if LLM took too long or was unavailable
  const lower = userMessage.toLowerCase();
  let intent = 'QUESTION';
  let reply = `Understood: "${userMessage}". Reply 'approve' to proceed or 'reject' to cancel.`;

  if (/\b(good|go ahead|proceed|sure|yes|yeah|yep|looks good|fine|do it|okay|agree)\b/.test(lower) && !/\b(not|don't|dont|wait|stop|no)\b/.test(lower)) {
    intent = 'APPROVE';
    reply = 'Understood. Proceeding with changes.';
  } else if (/\b(no|not|reject|stop|cancel|abort|don't|dont|nah|nope|wait)\b/.test(lower)) {
    intent = 'REJECT';
    reply = 'Understood. Changes aborted.';
  }

  appendHistory('user', 'User', userMessage);
  appendHistory('agent', agent, reply);
  return { intent, reply };
}

/**
 * Generate full conversational AI response for two-way WhatsApp chat (non-blocking)
 * @param {object} params
 * @param {string} params.userMessage
 * @param {string} [params.agent="Antigravity"]
 * @returns {Promise<string>}
 */
export async function generateChatReply({ userMessage, agent = 'Antigravity' }) {
  const history = getHistory(10);
  const formattedConvo = history.map(h => `${h.role === 'user' ? 'User' : h.name}: ${h.text}`).join('\n');

  const prompt = `You are ${agent}, an expert AI coding assistant chatting with your developer directly via WhatsApp.
Keep your response concise, friendly, and practical (1-3 sentences max).
Recent Conversation History:
${formattedConvo}
User: ${userMessage}
Respond directly to the developer:`;

  const opencodeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  const bin = fs.existsSync(opencodeBin) ? opencodeBin : 'opencode';

  // Run with 8-second timeout so WhatsApp never hangs
  const output = await runAsyncCLI(bin, ['run', '--pure', '-m', 'opencode/mimo-v2.5-free', prompt], 8000);
  if (output) {
    const lines = output.split('\n');
    const filtered = lines.filter(l => !l.startsWith('>') && !l.includes('build ·')).join('\n').trim();
    if (filtered) {
      return filtered;
    }
  }

  return `Got your message: "${userMessage}". Forwarded to active Antigravity session!`;
}
