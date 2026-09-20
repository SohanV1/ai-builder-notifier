/**
 * ai-notifier.ts
 * OpenCode plugin hook that intercepts tool executions, analyzes change significance,
 * and requests WhatsApp approval before applying modifications.
 */

import type { Plugin } from '@opencode-ai/plugin';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const EDIT_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'edit_file',
  'file_editor',
  'apply_patch',
  'patch'
]);

const CRITICAL_KEYWORDS = ['auth', 'jwt', 'token', 'crypto', 'password', 'migration', 'schema', 'package.json', 'dockerfile', '.env'];

export const aiNotifierPlugin: Plugin = async ({ client, project, directory }) => {
  return {
    'tool.execute.before': async (input, output) => {
      const toolName = input.tool.toLowerCase();
      const args = output.args || {};

      // Check if tool is modifying a file
      if (EDIT_TOOLS.has(toolName)) {
        const targetPath = args.TargetFile || args.targetFile || args.filePath || args.path || 'file';
        const fileName = path.basename(targetPath);
        const lowerPath = targetPath.toLowerCase();

        // Check significance
        const isCritical = CRITICAL_KEYWORDS.some(k => lowerPath.includes(k));
        const content = args.CodeContent || args.ReplacementContent || args.content || '';
        const linesChanged = typeof content === 'string' ? content.split('\n').length : 0;

        // Skip minor doc edits or very tiny edits in non-critical files
        if (!isCritical && linesChanged < 6 && (lowerPath.endsWith('.md') || lowerPath.endsWith('.txt'))) {
          return; // Allow silently
        }

        // Generate 5-7 word summary for smartwatch
        let summary = `Updated ${fileName} code logic`;
        if (isCritical) {
          summary = `Modified critical security file ${fileName}`;
        } else if (toolName.includes('write')) {
          summary = `Created or overwritten ${fileName}`;
        }

        // First attempt: call local daemon HTTP for speed
        let approved = false;
        let responseReceived = false;

        try {
          const res = await fetch('http://127.0.0.1:49321/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent: 'OpenCode',
              summary,
              timeoutMs: 180000
            }),
            signal: AbortSignal.timeout(185000)
          });
          if (res.ok) {
            const data = await res.json();
            approved = !!data.approved;
            responseReceived = true;
          }
        } catch (e) {
          // Daemon might not be running, fallback to CLI spawn
        }

        if (!responseReceived) {
          const result = spawnSync('ai-notify', ['--agent', 'OpenCode', '--ask', summary], {
            stdio: 'inherit',
            encoding: 'utf8'
          });
          approved = result.status === 0;
        }

        if (!approved) {
          throw new Error(`[ai-notifier] Change to "${fileName}" was rejected by user via WhatsApp.`);
        }
      }
    }
  };
};

export default aiNotifierPlugin;
