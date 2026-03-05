const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', severity: 'high', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Access Key', severity: 'high', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/ },
  { name: 'GitHub Token (classic)', severity: 'high', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub Token (fine-grained)', severity: 'high', pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'GitHub OAuth', severity: 'high', pattern: /gho_[A-Za-z0-9]{36}/ },
  { name: 'Stripe Secret Key', severity: 'high', pattern: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Restricted Key', severity: 'high', pattern: /rk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Private Key', severity: 'high', pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/ },
  { name: 'Database URL with password', severity: 'high', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@/ },
  { name: 'JWT Token', severity: 'high', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/ },
  { name: 'Slack Token', severity: 'high', pattern: /xox[bporas]-[A-Za-z0-9-]+/ },
  { name: 'Google API Key', severity: 'high', pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Anthropic API Key', severity: 'high', pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/ },
  { name: 'OpenAI API Key', severity: 'high', pattern: /sk-[A-Za-z0-9]{48,}/ },
  // Generic signatures are advisory only to reduce false positives.
  { name: 'Generic API Key assignment', severity: 'warn', pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9\-_]{20,}['"]/ },
  { name: 'Generic password assignment', severity: 'warn', pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/ }
];

function isSecretScanExcluded(filePath) {
  if (!filePath) return true;
  if (/\.env\.example$/.test(filePath)) return true;
  if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) return true;
  if (/__tests__\//.test(filePath)) return true;
  if (/__mocks__\//.test(filePath)) return true;
  if (/\.test\//.test(filePath)) return true;
  if (/fixtures?\//.test(filePath)) return true;
  return false;
}

function detectSecrets(content) {
  if (!content) return [];

  const detected = [];
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(content)) {
      detected.push({
        name: rule.name,
        severity: rule.severity || 'high'
      });
    }
  }
  return detected;
}

module.exports = {
  SECRET_PATTERNS,
  isSecretScanExcluded,
  detectSecrets
};
