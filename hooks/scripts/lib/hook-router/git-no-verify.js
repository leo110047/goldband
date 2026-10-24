// Git subcommands that run commit or push hooks, and how their arguments
// select --no-verify.
const NO_VERIFY = '--no-verify';
// Shortest prefix git may accept for --no-verify: `am` has no other
// `--no-v...` option. Where a shorter prefix is ambiguous, git rejects it.
const NO_VERIFY_MIN_LENGTH = '--no-v'.length;

// Option specs for subcommands that accept --no-verify. Value options keep
// messages such as `-m "explain --no-verify"` out of option scanning.
const NO_VERIFY_SPECS = {
  commit: {
    shortNoVerify: 'n',
    shortValue: 'mFCct',
    shortOptional: 'Su',
    longValue: [
      '--message',
      '--file',
      '--author',
      '--date',
      '--template',
      '--reuse-message',
      '--reedit-message',
      '--fixup',
      '--squash',
      '--cleanup',
      '--trailer',
      '--pathspec-from-file',
    ],
  },
  push: {
    shortValue: 'o',
    longValue: ['--push-option', '--repo', '--receive-pack', '--exec'],
  },
  merge: {
    shortValue: 'mFsX',
    longValue: ['--file', '--strategy', '--strategy-option', '--into-name'],
  },
  pull: { shortValue: 'sX', longValue: ['--strategy', '--strategy-option'] },
  rebase: {
    shortValue: 'sXx',
    longValue: ['--onto', '--exec', '--strategy', '--strategy-option'],
  },
  am: {
    shortNoVerify: 'n',
    shortValue: 'pC',
    longValue: ['--patch-format', '--resolvemsg'],
  },
};

function shortClusterNoVerify(word, spec) {
  for (let index = 1; index < word.length; index += 1) {
    const flag = word[index];
    if (flag === spec.shortNoVerify) return { found: true };
    if (spec.shortValue.includes(flag))
      return { found: false, consumesNext: index === word.length - 1 };
    if (spec.shortOptional?.includes(flag)) break;
  }
  return { found: false, consumesNext: false };
}

function longOptionNoVerify(word, spec) {
  const name = word.split('=')[0];
  return {
    found: name.length >= NO_VERIFY_MIN_LENGTH && NO_VERIFY.startsWith(name),
    consumesNext: !word.includes('=') && spec.longValue.includes(name),
  };
}

// Only literal options count: an argument computed when the command runs is
// outside Gate A's static scope.
function argumentNoVerify(word, spec) {
  if (!word.startsWith('-') || word === '-') return { found: false };
  return word.startsWith('--')
    ? longOptionNoVerify(word, spec)
    : shortClusterNoVerify(word, spec);
}

function noVerifyArgument(args, spec) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--') return null;
    const option = argumentNoVerify(args[index], spec);
    if (option.found) return true;
    if (option.consumesNext) index += 1;
  }
  return null;
}

module.exports = { NO_VERIFY_SPECS, noVerifyArgument };
