/**
 * utils.js
 * Change significance analyzer, diff parser, and 5-7 word watch-friendly summary generator
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

// File categories
const CRITICAL_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'pom.xml', 'build.gradle',
  'requirements.txt', 'pyproject.toml', 'Gemfile', 'composer.json',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'
];

const SECURITY_KEYWORDS = ['auth', 'jwt', 'token', 'crypto', 'password', 'secret', 'oauth', 'session', 'permission', 'security', 'guard'];
const DB_KEYWORDS = ['migration', 'migrate', 'schema', 'entity', 'model', 'database', 'sql', 'prisma', 'typeorm', 'alembic'];
const ROUTE_KEYWORDS = ['route', 'router', 'controller', 'endpoint', 'handler', 'middleware', 'api'];

/**
 * Parse a unified git diff into structured file change information
 * @param {string} diffText - Raw diff string
 * @returns {Array<{ file: string, status: string, added: number, deleted: number, lines: string[] }>}
 */
export function parseDiff(diffText) {
  if (!diffText || typeof diffText !== 'string') return [];

  const files = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git')) {
      if (currentFile) files.push(currentFile);
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      const fileName = match ? match[2] : 'unknown';
      currentFile = {
        file: fileName,
        status: 'modified',
        added: 0,
        deleted: 0,
        codeAdded: 0,
        codeDeleted: 0,
        lines: []
      };
    } else if (!currentFile) {
      continue;
    } else if (line.startsWith('new file mode')) {
      currentFile.status = 'created';
    } else if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted';
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.added++;
      currentFile.lines.push(line);
      const trimmed = line.slice(1).trim();
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
        currentFile.codeAdded++;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentFile.deleted++;
      currentFile.lines.push(line);
      const trimmed = line.slice(1).trim();
      if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
        currentFile.codeDeleted++;
      }
    }
  }

  if (currentFile) files.push(currentFile);
  return files;
}

/**
 * Check whether a file path matches critical system or configuration files
 * @param {string} filePath
 * @returns {string|null} Category of criticality or null
 */
export function getFileCategory(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const full = filePath.toLowerCase();

  if (CRITICAL_FILES.some(f => base === f.toLowerCase() || base.startsWith('.env'))) {
    return 'config';
  }
  if (SECURITY_KEYWORDS.some(k => full.includes(k))) {
    return 'security';
  }
  if (DB_KEYWORDS.some(k => full.includes(k))) {
    return 'database';
  }
  if (ROUTE_KEYWORDS.some(k => full.includes(k))) {
    return 'api';
  }
  if (base.endsWith('.md') || base.endsWith('.txt') || base.endsWith('.rst')) {
    return 'docs';
  }
  return 'code';
}

/**
 * Classify significance of changes and decide if push notification is needed
 * @param {string|Array} diffOrParsed - Git diff string or parsed file list
 * @returns {{ isSignificant: boolean, reason: string, summary: string, stats: object }}
 */
export function analyzeDiff(diffOrParsed) {
  const files = typeof diffOrParsed === 'string' ? parseDiff(diffOrParsed) : diffOrParsed;

  if (!files || files.length === 0) {
    return {
      isSignificant: false,
      reason: 'No files changed',
      summary: 'No changes detected',
      stats: { totalFiles: 0, added: 0, deleted: 0, codeLines: 0 }
    };
  }

  let totalAdded = 0;
  let totalDeleted = 0;
  let totalCodeAdded = 0;
  let totalCodeDeleted = 0;
  let hasCreated = false;
  let hasDeleted = false;
  let criticalCategory = null;
  let primaryFile = files[0];

  for (const f of files) {
    totalAdded += f.added;
    totalDeleted += f.deleted;
    totalCodeAdded += f.codeAdded;
    totalCodeDeleted += f.codeDeleted;
    if (f.status === 'created') hasCreated = true;
    if (f.status === 'deleted') hasDeleted = true;

    const cat = getFileCategory(f.file);
    if (cat === 'config' || cat === 'security' || cat === 'database') {
      criticalCategory = cat;
      primaryFile = f;
    }
  }

  const totalCodeLines = totalCodeAdded + totalCodeDeleted;
  const isAllDocs = files.every(f => getFileCategory(f.file) === 'docs');

  // Decision logic
  let isSignificant = true;
  let reason = '';

  if (criticalCategory) {
    isSignificant = true;
    reason = `Critical ${criticalCategory} file modified (${primaryFile.file})`;
  } else if (hasCreated || hasDeleted) {
    isSignificant = true;
    reason = hasCreated ? 'New file created' : 'File deleted';
  } else if (isAllDocs && totalCodeLines < 25) {
    isSignificant = false;
    reason = 'Minor documentation edits only';
  } else if (totalCodeLines < 5 && totalAdded + totalDeleted < 12) {
    isSignificant = false;
    reason = 'Minor cosmetic or comment edits (< 5 code lines)';
  } else {
    isSignificant = true;
    reason = `Significant code modification (${totalCodeLines} lines across ${files.length} file(s))`;
  }

  const summary = generateSummary(files, primaryFile, criticalCategory);

  return {
    isSignificant,
    reason,
    summary,
    stats: {
      totalFiles: files.length,
      added: totalAdded,
      deleted: totalDeleted,
      codeLines: totalCodeLines,
      primaryFile: primaryFile.file
    }
  };
}

/**
 * Generate a concise 5-7 word summary optimized for CMF Watch 3 Pro screen
 * @param {Array} files
 * @param {object} primaryFile
 * @param {string|null} criticalCategory
 * @returns {string} 5-7 word summary
 */
export function generateSummary(files, primaryFile, criticalCategory) {
  const fileName = primaryFile ? path.basename(primaryFile.file) : 'codebase';
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

  if (criticalCategory === 'security') {
    return `Updated authentication and security in ${cleanName}`;
  }
  if (criticalCategory === 'database') {
    return `Modified database schema in ${cleanName}`;
  }
  if (criticalCategory === 'config') {
    return `Updated project configuration in ${fileName}`;
  }
  if (primaryFile.status === 'created') {
    return `Created new ${cleanName} component`;
  }
  if (primaryFile.status === 'deleted') {
    return `Removed ${cleanName} file from project`;
  }

  if (files.length > 3) {
    return `Refactored ${files.length} modules across codebase`;
  }

  const baseAction = primaryFile.codeAdded > primaryFile.codeDeleted ? 'Added updates to' : 'Refactored logic in';
  return `${baseAction} ${cleanName} module`;
}

/**
 * Format message for WhatsApp notification and watch display
 * @param {object} options
 * @param {string} options.agent - "Antigravity", "Codex", "OpenCode"
 * @param {string} options.summary - 5-7 word action summary
 * @param {boolean} [options.needsApproval=true] - Whether to ask for approve/reject
 * @returns {string}
 */
export function formatNotification({ agent = 'AI Agent', summary, needsApproval = true }) {
  const cleanAgent = agent.replace(/[\[\]]/g, '').trim();
  if (needsApproval) {
    return `[${cleanAgent}] ${summary}\n\nReply 'approve' or 'reject'`;
  }
  return `[${cleanAgent}] ${summary}`;
}

/**
 * Evaluate user's text reply from WhatsApp
 * @param {string} text - Message received from user
 * @returns {'approved'|'rejected'|'unknown'}
 */
export function evaluateReply(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  const clean = text.trim().toLowerCase();

  const approveKeywords = ['approve', 'approved', 'appr', 'yes', 'y', 'ok', 'okay', 'proceed', 'accept', 'allow', '1'];
  const rejectKeywords = ['reject', 'rejected', 'rej', 'no', 'n', 'cancel', 'stop', 'abort', 'deny', 'disallow', '0'];

  if (approveKeywords.some(k => clean === k || clean.startsWith(`${k} `))) {
    return 'approved';
  }
  if (rejectKeywords.some(k => clean === k || clean.startsWith(`${k} `))) {
    return 'rejected';
  }
  return 'unknown';
}

/**
 * Inspect git working directory diff
 * @param {string} [cwd=process.cwd()]
 * @returns {string} Raw git diff
 */
export function getGitDiff(cwd = process.cwd()) {
  try {
    const diff = execSync('git diff HEAD', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (diff && diff.trim()) return diff;
    const unstaged = execSync('git diff', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (unstaged && unstaged.trim()) return unstaged;
    const staged = execSync('git diff --cached', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return staged || '';
  } catch (err) {
    return '';
  }
}
