#!/usr/bin/env node
/**
 * PreToolUse Hook: Detect secrets in file edits/writes
 *
 * Scans file content for 13+ secret patterns (AWS keys, GitHub tokens,
 * private keys, database URLs, etc.) and blocks the operation if found.
 * Excludes .env.example, test/spec files, and __tests__/ directories.
 */

const MAX_STDIN = 1024 * 1024;
let data = '';
process.stdin.setEncoding('utf8');

// Secret patterns with descriptive names
const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Access Key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/ },
  { name: 'GitHub Token (classic)', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub Token (fine-grained)', pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'GitHub OAuth', pattern: /gho_[A-Za-z0-9]{36}/ },
  { name: 'Stripe Secret Key', pattern: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Restricted Key', pattern: /rk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Private Key', pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/ },
  { name: 'Database URL with password', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@/ },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/ },
  { name: 'Slack Token', pattern: /xox[bporas]-[A-Za-z0-9-]+/ },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Generic API Key assignment', pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9\-_]{20,}['"]/ },
  { name: 'Generic password assignment', pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/ },
  { name: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/ },
  { name: 'OpenAI API Key', pattern: /sk-[A-Za-z0-9]{48,}/ },
];

// Files/paths to exclude from scanning
function isExcluded(filePath) {
  if (!filePath) return true;
  if (/\.env\.example$/.test(filePath)) return true;
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return true;
  if (/__tests__\//.test(filePath)) return true;
  if (/__mocks__\//.test(filePath)) return true;
  if (/\.test\//.test(filePath)) return true;
  if (/fixtures?\//.test(filePath)) return true;
  return false;
}

process.stdin.on('data', chunk => {
  if (data.length < MAX_STDIN) {
    data += chunk;
  }
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path || '';

    if (isExcluded(filePath)) {
      process.stdout.write(data);
      return;
    }

    // Check content from Edit (new_string) or Write (content)
    const content = input.tool_input?.new_string || input.tool_input?.content || '';

    if (!content) {
      process.stdout.write(data);
      return;
    }

    const detected = [];
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        detected.push(name);
      }
    }

    if (detected.length > 0) {
      console.error('[Hook] BLOCKED: Potential secrets detected in file content');
      console.error('[Hook] File: ' + filePath);
      console.error('[Hook] Detected:');
      for (const name of detected) {
        console.error('  - ' + name);
      }
      console.error('[Hook] Use environment variables or a secrets manager instead.');
      process.exit(2);
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
});
