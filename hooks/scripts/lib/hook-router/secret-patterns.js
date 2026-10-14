// A private key's body follows its header. With an END marker in reach (real
// or escaped newlines) the whole block is redacted; without one, as when a
// source frame quotes part of a key, redaction covers the following lines
// that carry base64 runs and keeps the output after them.
// Covers PKCS#1/#8, OpenSSH, encrypted PKCS#8, and PGP armor (`... BLOCK-----`).
const KEY_HEADER =
  '-----BEGIN\\s+(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)?\\s*PRIVATE KEY(?: BLOCK)?-----';
const KEY_FOOTER =
  '-----END\\s+(?:RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)?\\s*PRIVATE KEY(?: BLOCK)?-----';
const PRIVATE_KEY_BLOCK = new RegExp(
  `${KEY_HEADER}(?:[\\s\\S]{0,16384}?${KEY_FOOTER}|(?:(?:\\\\n|[A-Za-z0-9+/=])*)(?:\\r?\\n[^\\n]*?[A-Za-z0-9+/=]{16,}[^\\n]*)*)`,
  'g',
);
// Key material, not a bare header: shell text that only names the header
// (searches, documentation) is allowed; a header followed by key body is not.
// Armor and legacy PEM put blank lines or `Name: value` headers (Version,
// Proc-Type, DEK-Info) between the header and the body.
const PRIVATE_KEY_MATERIAL = new RegExp(
  `${KEY_HEADER}(?:(?:\\r?\\n|\\\\n)[ \\t]*(?:[A-Za-z-]+:[^\\r\\n]*)?){0,8}?(?:\\r?\\n|\\\\n)[ \\t]*[A-Za-z0-9+/=]{16,}`,
);

// Shell text: a rule applies its `pattern` unless it declares `shellText:
// false` (the signature also appears in legitimate commands) or a narrower
// `shellPattern`. File writes always use `pattern`; `matchPattern` widens the
// matched value when the signature alone does not identify a secret.
const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', severity: 'high', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'AWS Secret Access Key',
    severity: 'high',
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/,
  },
  {
    name: 'GitHub Token (classic)',
    severity: 'high',
    pattern: /ghp_[A-Za-z0-9]{36}/,
  },
  {
    name: 'GitHub Token (fine-grained)',
    severity: 'high',
    pattern: /github_pat_[A-Za-z0-9_]{22,}/,
  },
  { name: 'GitHub OAuth', severity: 'high', pattern: /gho_[A-Za-z0-9]{36}/ },
  {
    name: 'Stripe Secret Key',
    severity: 'high',
    pattern: /sk_live_[A-Za-z0-9]{24,}/,
  },
  {
    name: 'Stripe Restricted Key',
    severity: 'high',
    pattern: /rk_live_[A-Za-z0-9]{24,}/,
  },
  // A bare header appears in searches and docs; only key material counts.
  {
    name: 'Private Key',
    severity: 'high',
    shellPattern: PRIVATE_KEY_MATERIAL,
    // A key's identity is its whole block; every PKCS#8 header is identical.
    matchPattern: PRIVATE_KEY_BLOCK,
    pattern: new RegExp(KEY_HEADER),
  },
  // Local connection strings and demo JWTs appear in legitimate commands;
  // file-tool writes still block, and the post-command scan reports them
  // where the checker is installed.
  {
    name: 'Database URL with password',
    severity: 'high',
    shellText: false,
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@/,
  },
  {
    name: 'JWT Token',
    severity: 'high',
    shellText: false,
    pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/,
  },
  // Real Slack tokens carry a numeric segment after the prefix, which
  // placeholders such as `xoxb-your-token` lack.
  {
    name: 'Slack Token',
    severity: 'high',
    pattern: /xox[bporas]-\d+-[A-Za-z0-9-]+/,
  },
  {
    name: 'Google API Key',
    severity: 'high',
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
  },
  {
    name: 'Anthropic API Key',
    severity: 'high',
    pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/,
  },
  { name: 'OpenAI API Key', severity: 'high', pattern: /sk-[A-Za-z0-9]{48,}/ },
  {
    name: 'OpenAI project API Key',
    severity: 'warn',
    pattern: /sk-proj-[A-Za-z0-9_-]{24,}/,
  },
  // Generic signatures are advisory only to reduce false positives.
  {
    name: 'Generic API Key assignment',
    severity: 'warn',
    pattern:
      /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9\-_]{20,}['"]/,
  },
  {
    name: 'Generic password assignment',
    severity: 'warn',
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/,
  },
];

// File exclusions apply only to the opt-in Git style gate, never tool writes.
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
        severity: rule.severity || 'high',
      });
    }
  }
  return detected;
}

// Every matched value, so callers can tell a newly written secret from one an
// earlier version of the content already held.
function matchSecrets(content) {
  if (!content) return [];
  const matches = [];
  for (const rule of SECRET_PATTERNS) {
    const source = rule.matchPattern ?? rule.pattern;
    const global = new RegExp(
      source.source,
      `${source.flags.replace('g', '')}g`,
    );
    for (const match of content.matchAll(global)) {
      matches.push({
        name: rule.name,
        severity: rule.severity || 'high',
        value: match[0],
      });
    }
  }
  return matches;
}

// Diagnostics that may quote file content pass through this before reaching a
// model or log, so a detected secret is never echoed back.
function redactSecrets(text) {
  let redacted = String(text ?? '').replace(
    PRIVATE_KEY_BLOCK,
    '[REDACTED Private Key]',
  );
  for (const rule of SECRET_PATTERNS) {
    const global = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    redacted = redacted.replace(global, `[REDACTED ${rule.name}]`);
  }
  return redacted;
}

// Shell command text is denied only for high-confidence signatures marked safe
// to apply there; warn-level signatures never act on shell text.
function classifyShellSecretContent(command) {
  const text = String(command || '');
  const names = SECRET_PATTERNS.filter(
    (rule) =>
      rule.severity === 'high' &&
      rule.shellText !== false &&
      (rule.shellPattern ?? rule.pattern).test(text),
  ).map((rule) => rule.name);
  if (names.length === 0) return null;
  return {
    severity: 'high',
    message: `BLOCKED: Potential secrets detected: ${names.join(', ')}. Use environment variables or a secrets manager; remove an existing secret with a file edit or patch, not shell text.`,
  };
}

function classifySecretContent(content) {
  const detected = detectSecrets(content);
  if (detected.length === 0) return null;
  const high = detected.filter((item) => item.severity === 'high');
  const selected = high.length > 0 ? high : detected;
  const names = selected.map((item) => item.name).join(', ');
  return {
    severity: high.length > 0 ? 'high' : 'warn',
    message:
      high.length > 0
        ? `BLOCKED: Potential secrets detected: ${names}. Use environment variables or a secrets manager.`
        : `WARNING: Potential credential-shaped text (advisory): ${names}. Review before commit.`,
  };
}

module.exports = {
  classifySecretContent,
  classifyShellSecretContent,
  SECRET_PATTERNS,
  isSecretScanExcluded,
  detectSecrets,
  matchSecrets,
  redactSecrets,
};
