const {
  classifySecretContent,
  classifyShellSecretContent,
} = require('./secret-patterns');
const {
  commandInput,
  commandWords,
  shellReadsStdin,
} = require('./shell-commands');
const {
  inspectShellCommand,
  SHELL_ANALYSIS_FAILURE,
} = require('./shell-policy');
const { evaluateGateProtection } = require('./gate-protection');

const MKFS_COMMAND = /^mkfs(?:\.[^\s/]+)?$/;
const FORMAT_COMMANDS = new Set(['mke2fs', 'newfs_apfs']);
const WIPEFS_LONG_OPTIONS = [
  '--all',
  '--backup',
  '--force',
  '--help',
  '--lock',
  '--no-act',
  '--offset',
  '--parsable',
  '--quiet',
  '--types',
  '--version',
  '--json',
  '--noheadings',
  '--output',
];

const HIGH_RISK_BASH_RULES = [
  {
    commands: ['sudo'],
    pattern: /^\s*sudo\b/,
    telemetryName: 'sudo-command',
    reason:
      'sudo commands are high-risk and require explicit user approval outside the hook path.',
  },
  {
    commands: ['dd'],
    argumentCommands: ['dd'],
    pattern: /^dd\b[\s\S]*\bof=\/dev\//,
    telemetryName: 'device-write',
    reason: 'Writing raw data to a device path is high-risk.',
  },
  {
    commands: ['gparted', 'diskutil'],
    argumentCommands: ['diskutil'],
    pattern: /^gparted\b|^diskutil\s+(?:erase|partition|apfs\s+delete)/i,
    telemetryName: 'disk-formatting',
    reason: 'Disk formatting or partition commands are high-risk.',
  },
  {
    commands: ['chmod', 'chown'],
    argumentCommands: ['chmod', 'chown'],
    pattern:
      /^chmod\s+-R\s+777\s+(?:\/|~|\$HOME|\.|\*)\b|^chown\s+-R\b[\s\S]*\s(?:\/|~|\$HOME|\.|\*)\b/,
    telemetryName: 'recursive-permission-change',
    reason:
      'Recursive permission or ownership changes over broad targets are high-risk.',
  },
  {
    commands: ['cat', 'less', 'more', 'sed', 'awk'],
    argumentCommands: ['cat', 'less', 'more', 'sed', 'awk'],
    pattern:
      /^(?:cat|less|more|sed|awk)\b[\s\S]*(?:~\/\.ssh\/id_|~\/\.aws\/credentials|~\/\.netrc|~\/\.npmrc|~\/\.pypirc|~\/\.kube\/config)/,
    telemetryName: 'credential-file-read',
    reason: 'Reading credential files into the session is high-risk.',
  },
  {
    commands: ['env', 'printenv'],
    pattern: /^\s*(?:env|printenv)\s*$/,
    telemetryName: 'environment-dump',
    reason: 'Dumping the full environment can expose secrets.',
  },
  {
    commands: ['security'],
    argumentCommands: ['security'],
    pattern: /^security\s+find-(?:generic|internet)-password\b/,
    telemetryName: 'keychain-read',
    reason: 'Reading passwords from the system keychain is high-risk.',
  },
];
// Unknown argv may name files or query targets. Only signatures requiring
// specific arguments participate; name-only rules still inspect real commands.
const HIGH_RISK_ARGUMENT_COMMANDS = new Set([
  'rm',
  'git',
  'mkfs',
  ...FORMAT_COMMANDS,
  'wipefs',
  'fdisk',
  ...HIGH_RISK_BASH_RULES.flatMap((rule) => rule.argumentCommands || []),
]);

function isRiskyRmTarget(value) {
  const target = value;
  const riskyExact = new Set([
    '/',
    '/*',
    '~',
    '~/',
    '$HOME',
    '$HOME/',
    '.',
    '..',
    '*',
    '/Users',
    '/System',
    '/Library',
    '/private',
    '/etc',
    '/var',
    '/usr',
    '/bin',
    '/sbin',
    '/Applications',
  ]);

  if (riskyExact.has(target)) return true;
  if (/^(?:\.{1,2}|~|\$HOME)?\/?\*$/.test(target)) return true;
  if (/^(?:\.|~|\$HOME)\//.test(target)) return true;
  return /^\/(?:Users|System|Library|private|etc|var|usr|bin|sbin|Applications)(?:\/|$)/.test(
    target,
  );
}

function isRecursiveForceRm(tokens, index) {
  let hasRecursive = false;
  let hasForce = false;
  const targets = [];

  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token === '--') continue;
    if (token.startsWith('-')) {
      hasRecursive =
        hasRecursive || token === '--recursive' || /^-[^-]*r/i.test(token);
      hasForce = hasForce || token === '--force' || /^-[^-]*f/i.test(token);
      continue;
    }

    targets.push(token);
  }

  return hasRecursive && hasForce && targets.some(isRiskyRmTarget);
}

function isDestructiveGitClean(tokens, index) {
  let hasForce = false;
  let hasDryRun = false;

  for (let i = index + 2; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--') break;
    if (!token.startsWith('-')) continue;

    if (token === '-n' || token === '--dry-run') hasDryRun = true;
    if (
      token === '-f' ||
      token === '--force' ||
      /^-[A-Za-z]*f[A-Za-z]*$/.test(token)
    ) {
      hasForce = true;
    }
  }

  return hasForce && !hasDryRun;
}

function highRiskDecision(reason, telemetryName) {
  return { reason, telemetryName };
}

// These are utility option boundaries, not shell expansion. Required values
// must not become flags (for example, wipefs -t -n does not enable --no-act).
function optionGroup(word, required, optional) {
  if (word.startsWith('--')) {
    const name = word.split('=')[0];
    return {
      names: [name],
      consumeNext: required.includes(name) && !word.includes('='),
    };
  }
  const names = [];
  for (let index = 1; index < word.length; index += 1) {
    if (!/[A-Za-z0-9]/.test(word[index]))
      return { names: [], consumeNext: false };
    const name = `-${word[index]}`;
    names.push(name);
    if (required.includes(name))
      return { names, consumeNext: index === word.length - 1 };
    if (optional.includes(name)) break;
  }
  return { names, consumeNext: false };
}

function commandOptionNames(words, required = [], optional = []) {
  const names = new Set();
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') break;
    if (!word.startsWith('-')) continue;
    const group = optionGroup(word, required, optional);
    for (const name of group.names) names.add(name);
    if (group.consumeNext) index += 1;
  }
  return names;
}

function isDestructiveGitHistory(tokens) {
  if (tokens[0] !== 'git') return false;
  const end = tokens.indexOf('--', 2);
  const options = tokens.slice(2, end < 0 ? tokens.length : end);
  if (tokens[1] === 'reset') return options.includes('--hard');
  if (tokens[1] !== 'push') return false;
  const flags = commandOptionNames(tokens.slice(1), [
    '-o',
    '--push-option',
    '--receive-pack',
    '--exec',
    '--repo',
  ]);
  return ['-f', '--force', '--force-with-lease'].some((flag) =>
    flags.has(flag),
  );
}

function hasDeviceArgument(tokens) {
  return tokens.slice(1).some((word) => /^\/dev\/.+/.test(word));
}

function hasUnresolvedDeviceArgument(tokens, segment) {
  return (
    tokens.slice(1).some((word) => word.includes('$')) &&
    commandWords(segment.words)[0] === tokens[0]
  );
}

function isFdiskListing(tokens) {
  const flags = commandOptionNames(
    tokens,
    [
      '-b',
      '-C',
      '-H',
      '-o',
      '-S',
      '-t',
      '-w',
      '-W',
      '--sector-size',
      '--type',
      '--output',
      '--cylinders',
      '--heads',
      '--sectors',
      '--wipe',
      '--wipe-partitions',
    ],
    ['-c', '-L', '-u'],
  );
  if (!flags.has('-l') && !flags.has('--list')) return false;
  // fdisk may be remote: Linux's list flag must not exempt a macOS write
  // where that same text is a geometry value or MBR template filename.
  const macFlags = commandOptionNames(tokens, [
    '-a',
    '-b',
    '-c',
    '-f',
    '-h',
    '-s',
    '-S',
  ]);
  if (macFlags.has('-l') || macFlags.has('--list')) return true;
  return !['-i', '-e', '-u', '-r'].some((flag) => macFlags.has(flag));
}

function canonicalWipefsOption(word) {
  if (!word.startsWith('--')) return word;
  const name = word.split('=')[0];
  const matches = WIPEFS_LONG_OPTIONS.filter((option) =>
    option.startsWith(name),
  );
  return matches.length === 1 ? matches[0] + word.slice(name.length) : word;
}

function isWipefsErase(tokens) {
  const flags = commandOptionNames(
    tokens.map(canonicalWipefsOption),
    ['-o', '-O', '-t', '--offset', '--output', '--types'],
    ['-b'],
  );
  if (
    ['-n', '--no-act', '-h', '--help', '-V', '--version'].some((flag) =>
      flags.has(flag),
    )
  )
    return false;
  return ['-a', '--all', '-o', '--offset'].some((flag) => flags.has(flag));
}

function isExtFormatPreview(tokens) {
  if (tokens[0] !== 'mke2fs' && !/^mkfs\.ext[234]$/.test(tokens[0]))
    return false;
  // mke2fs options that consume a value; -n and -V are standalone flags.
  const required = [...'bdegilmorstCEGIJLMNORTUz'].map(
    (letter) => `-${letter}`,
  );
  const flags = commandOptionNames(tokens, required);
  return flags.has('-n') || flags.has('-V');
}

function isDestructiveDiskCommand(tokens, segment) {
  const name = tokens[0];
  const device = hasDeviceArgument(tokens);
  if (name === 'fdisk')
    return (
      !isFdiskListing(tokens) &&
      (device || commandWords(segment.words)[0] === name)
    );
  if (name === 'wipefs')
    return (
      isWipefsErase(tokens) &&
      (device || hasUnresolvedDeviceArgument(tokens, segment))
    );
  if (!MKFS_COMMAND.test(name) && !FORMAT_COMMANDS.has(name)) return false;
  if (hasUnresolvedDeviceArgument(tokens, segment)) return true;
  if (isExtFormatPreview(tokens)) return false;
  return (
    device ||
    (name === 'newfs_apfs' &&
      tokens.slice(1).some((word) => /^r?disk\d+(?:s\d+)*$/.test(word)))
  );
}

function classifyHighRiskBashSegment(tokens, segment) {
  // Whitespace inside an executable name is literal, not another argv boundary.
  if (/\s/.test(tokens[0] || '')) return null;
  if (isDestructiveDiskCommand(tokens, segment)) {
    return highRiskDecision(
      'Formatting, erasing, or modifying a device partition is high-risk.',
      'disk-formatting',
    );
  }
  if (
    tokens[0] === 'env' &&
    !tokens.some((word) =>
      ['--help', '--version', '-i', '--ignore-environment'].includes(word),
    )
  ) {
    return highRiskDecision(
      'Dumping the full environment can expose secrets.',
      'environment-dump',
    );
  }
  if (tokens[0] === 'rm' && isRecursiveForceRm(tokens, 0)) {
    return highRiskDecision(
      'Recursive force deletion targets a root, home, current directory, wildcard, or system path.',
      'recursive-force-delete',
    );
  }
  if (isDestructiveGitHistory(tokens)) {
    return highRiskDecision(
      'Destructive git history operations are high-risk.',
      'destructive-git-history',
    );
  }
  if (
    tokens[0] === 'git' &&
    tokens[1] === 'clean' &&
    isDestructiveGitClean(tokens, 0)
  ) {
    return highRiskDecision(
      'Destructive git clean over untracked files or directories is high-risk.',
      'destructive-git-clean',
    );
  }
  const inputs = (segment.redirects || [])
    .filter((item) => ['<', '<>'].includes(item.operator))
    .map((item) => item.target);
  const normalized = [...tokens, ...inputs].join(' ');
  const match = HIGH_RISK_BASH_RULES.find(
    (rule) =>
      rule.commands.includes(tokens[0]) && rule.pattern.test(normalized),
  );
  return match ? highRiskDecision(match.reason, match.telemetryName) : null;
}

function classifyHighRiskBash(command) {
  const result = inspectShellCommand(
    command,
    (name) =>
      HIGH_RISK_ARGUMENT_COMMANDS.has(MKFS_COMMAND.test(name) ? 'mkfs' : name),
    (words, segment) => {
      const decision = classifyHighRiskBashSegment(words, segment);
      if (decision) return decision;
      if (shellReadsStdin(words) && commandInput(segment).downloaded) {
        return highRiskDecision(
          'Piping downloaded code directly into a shell is high-risk.',
          'curl-pipe-shell',
        );
      }
      return null;
    },
  );
  return result.failed
    ? highRiskDecision(SHELL_ANALYSIS_FAILURE, 'shell-analysis-failed')
    : result.risk;
}

function findHighRiskBash(command) {
  return classifyHighRiskBash(command)?.reason || null;
}

function secretDecisionForPatch(command) {
  // Only added content reaches disk. Removed lines and context may contain
  // credentials being cleaned up and must not prevent that repair.
  const content = String(command || '')
    .split('\n')
    .filter((line) => line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n');
  return classifySecretContent(content);
}

function classifyHighRiskPatch(command) {
  const patch = String(command || '');
  const secret = secretDecisionForPatch(patch);
  if (secret?.severity === 'high') {
    return highRiskDecision(secret.message, 'secret-detector');
  }

  if (/^\*\*\* (?:Add|Update|Delete) File: \.git\//m.test(patch)) {
    return highRiskDecision(
      'Patch attempts to modify .git internals.',
      'git-internals',
    );
  }

  return null;
}

// Shell text is not file content; only high-confidence signatures act there.
function classifyHighRiskSecretCommand(command) {
  const secret = classifyShellSecretContent(String(command || ''));
  return secret ? highRiskDecision(secret.message, 'secret-detector') : null;
}

function findHighRiskPatch(command) {
  return classifyHighRiskPatch(command)?.reason || null;
}

// Codex has no supported `ask`, so every Gate A and Gate G match is an explicit
// deny. Project `.codex/` files are included: Codex's own read-only protection
// does not hold under `--sandbox danger-full-access`, which managed worktrees use.
function classifyGateProtection(input) {
  const gate = evaluateGateProtection(input);
  if (!gate) return null;
  return highRiskDecision(
    gate.message,
    gate.gate === 'A' ? 'gate-a-bypass' : 'gate-g-protected-config',
  );
}

function classifyToolRisk(toolName, command) {
  if (toolName === 'Bash') {
    return (
      classifyHighRiskSecretCommand(command) || classifyHighRiskBash(command)
    );
  }
  if (toolName === 'apply_patch') return classifyHighRiskPatch(command);
  return null;
}

function classifyHighRiskToolUse(input) {
  const toolName = input.tool_name || '';
  const command = input.tool_input?.command || '';
  return classifyToolRisk(toolName, command) || classifyGateProtection(input);
}

module.exports = {
  secretDecisionForPatch,
  classifyHighRiskToolUse,
  findHighRiskBash,
  findHighRiskPatch,
};
