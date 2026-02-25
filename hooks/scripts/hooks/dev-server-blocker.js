#!/usr/bin/env node
/**
 * PreToolUse Hook: Block dev servers outside tmux
 *
 * Detects npm/pnpm/yarn/bun dev server commands and blocks them
 * with instructions to use tmux for proper log access.
 */

const MAX_STDIN = 1024 * 1024;
let data = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (data.length < MAX_STDIN) {
    data += chunk;
  }
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const cmd = input.tool_input?.command || '';

    if (
      process.platform !== 'win32' &&
      /(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(cmd)
    ) {
      console.error('[Hook] BLOCKED: Dev server must run in tmux for log access');
      console.error('[Hook] Use: tmux new-session -d -s dev "npm run dev"');
      console.error('[Hook] Then: tmux attach -t dev');
      process.exit(2);
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
});
