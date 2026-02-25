#!/usr/bin/env node
/**
 * PreToolUse Hook: Reminder before git push
 *
 * Outputs a reminder to stderr when a git push command is detected,
 * prompting the user to review changes before pushing.
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

    if (/git push/.test(cmd)) {
      console.error('[Hook] Review changes before push...');
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
});
