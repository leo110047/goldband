const { detectSecrets, isSecretScanExcluded } = require('./secret-patterns');

function shouldBlockDevServer(command) {
  if (!command || process.platform === 'win32') {
    return false;
  }

  return /(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(command);
}

function shouldBlockDocFile(filePath) {
  if (!/\.(md|txt)$/.test(filePath)) return false;
  if (/(README|CLAUDE|AGENTS|CONTRIBUTING|SKILL)\.md$/.test(filePath)) return false;
  if (/\.claude\//.test(filePath)) return false;
  if (/\.planning\//.test(filePath)) return false;
  if (/\/reference\//.test(filePath)) return false;
  if (/\/commands\//.test(filePath)) return false;
  if (/\/docs\//.test(filePath)) return false;
  return true;
}

function evaluatePreToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (toolName === 'Bash') {
    const command = toolInput.command || '';

    if (shouldBlockDevServer(command)) {
      return {
        decision: 'block',
        blockedBy: 'dev-server-blocker',
        logs: [
          '[Hook] BLOCKED: Dev server must run in tmux for log access',
          '[Hook] Use: tmux new-session -d -s dev "npm run dev"',
          '[Hook] Then: tmux attach -t dev'
        ]
      };
    }

    if (/\bgit\s+push\b/.test(command)) {
      return {
        decision: 'allow',
        blockedBy: null,
        logs: ['[Hook] Reminder: review branch/commits/remote before git push']
      };
    }
  }

  if (toolName === 'Write') {
    const filePath = toolInput.file_path || '';

    if (shouldBlockDocFile(filePath)) {
      return {
        decision: 'block',
        blockedBy: 'doc-file-blocker',
        logs: [
          '[Hook] BLOCKED: Unnecessary documentation file creation',
          `[Hook] File: ${filePath}`
        ]
      };
    }
  }

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';

    if (!isSecretScanExcluded(filePath)) {
      const content = toolInput.new_string || toolInput.content || '';
      const detected = detectSecrets(content);
      const highConfidence = detected.filter(item => item.severity === 'high');
      const advisoryOnly = detected.filter(item => item.severity !== 'high');

      if (highConfidence.length > 0) {
        const detailLines = highConfidence.map(item => `  - ${item.name}`);
        return {
          decision: 'block',
          blockedBy: 'secret-detector',
          logs: [
            '[Hook] BLOCKED: Potential secrets detected in file content',
            `[Hook] File: ${filePath}`,
            '[Hook] Detected:',
            ...detailLines,
            '[Hook] Use environment variables or a secrets manager instead.'
          ]
        };
      }

      if (advisoryOnly.length > 0) {
        const detailLines = advisoryOnly.map(item => `  - ${item.name}`);
        return {
          decision: 'allow',
          blockedBy: null,
          logs: [
            '[Hook] WARNING: Potential generic secret patterns detected (advisory)',
            `[Hook] File: ${filePath}`,
            '[Hook] Review before commit:',
            ...detailLines
          ]
        };
      }
    }
  }

  return {
    decision: 'allow',
    blockedBy: null,
    logs: []
  };
}

module.exports = {
  evaluatePreToolUse
};
