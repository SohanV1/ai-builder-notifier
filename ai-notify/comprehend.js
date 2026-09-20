/**
 * comprehend.js
 * Contextual conversation memory & LLM intent comprehension for WhatsApp replies
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

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
 * Fast heuristic classifier
 */
function fastClassify(text) {
  const clean = text.toLowerCase().trim();

  // Clear single-phrase approvals
  const approveRegex = /^(approve|approved|appr|yes|yep|yeah|yup|y|ok|okay|k|proceed|go ahead|do it|lgtm|looks good|sure|accept|confirm|allow|fine|make it so|ship it|do this)$/i;
  if (approveRegex.test(clean)) {
    return { intent: 'APPROVE', reply: 'Approved. Proceeding with changes.' };
  }

  // Clear single-phrase rejections
  const rejectRegex = /^(reject|rejected|rej|no|nah|nope|n|cancel|stop|abort|deny|disallow|dont|don't|halt|drop it)$/i;
  if (rejectRegex.test(clean)) {
    return { intent: 'REJECT', reply: 'Rejected. Changes aborted.' };
  }

  return null;
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
  // 1. Check fast path first
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
You are asking for approval to make code changes on their system.

Current proposed change: "${currentAction}"

Recent Conversation History:
${formattedConvo}
User: ${userMessage}

Determine the user's intent from their message in this context:
1. APPROVE: User agrees, says yes, gives green light, likes it, says go ahead, etc.
2. REJECT: User denies, says no, tells you to stop, abort, don't do it, etc.
3. QUESTION: User is asking for clarification, details, explanation, or files.
4. FEEDBACK: User gives a modification instruction (e.g., "change the port to 3000 instead").

Reply ONLY with valid JSON with NO backticks or markdown:
{"intent": "APPROVE" | "REJECT" | "QUESTION" | "FEEDBACK", "reply": "<Short 1-2 sentence response for WhatsApp>"}`;

  try {
    // Try opencode CLI first
    const proc = spawnSync('opencode', ['run', '--pure', '-m', 'opencode/nemotron-3.5-lightning-free', prompt], {
      encoding: 'utf8',
      timeout: 12000
    });

    if (proc.status === 0 && proc.stdout) {
      const output = proc.stdout.trim();
      // Extract JSON
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.intent && parsed.reply) {
          appendHistory('user', 'User', userMessage);
          appendHistory('agent', agent, parsed.reply);
          return parsed;
        }
      }
    }
  } catch (err) {
    // Fallback if opencode fails
  }

  // Fallback heuristic if LLM call was unavailable
  const lower = userMessage.toLowerCase();
  let intent = 'QUESTION';
  let reply = `I received: "${userMessage}". Please reply 'approve' to proceed or 'reject' to abort.`;

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
 * Generate full conversational AI response for two-way WhatsApp chat
 * @param {object} params
 * @param {string} params.userMessage
 * @param {string} [params.agent="Antigravity"]
 * @returns {Promise<string>}
 */
export async function generateChatReply({ userMessage, agent = 'Antigravity' }) {
  const history = getHistory(10);
  const formattedConvo = history.map(h => `${h.role === 'user' ? 'User' : h.name}: ${h.text}`).join('\n');

  const prompt = `You are ${agent}, an expert AI coding assistant chatting with your developer directly via WhatsApp.
Keep your response concise, friendly, and practical (2-4 sentences, suitable for reading on phone or smartwatch).

Recent Conversation History:
${formattedConvo}
User: ${userMessage}

Respond directly to the developer:`;

  const opencodeBin = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  const bin = fs.existsSync(opencodeBin) ? opencodeBin : 'opencode';

  try {
    const proc = spawnSync(bin, ['run', '--pure', '-m', 'opencode/nemotron-3.5-lightning-free', prompt], {
      encoding: 'utf8',
      timeout: 25000
    });

    if (proc.status === 0 && proc.stdout) {
      const lines = proc.stdout.split('\n');
      const filtered = lines.filter(l => !l.startsWith('>') && !l.includes('build ·')).join('\n').trim();
      if (filtered) {
        return filtered;
      }
    }
  } catch (err) {}

  return `Got your instruction: "${userMessage}". Working on it right away!`;
}
