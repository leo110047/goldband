// `git config`, `git clone`, and `git init` arguments that read or change
// the configuration keys Gate A protects.

// Keys whose value can set core.hooksPath: the key itself, include files
// that may contain it, and the template whose config each new repository
// copies. Git compares section and variable names case-insensitively.
const HOOK_CONTROL_KEY =
  /^(?:core\.hookspath|include\.path|includeif\..*\.path|init\.templatedir)$/s;

function isHookControlKey(key) {
  return HOOK_CONTROL_KEY.test(String(key || '').toLowerCase());
}

// A KEY or KEY=VALUE word that sets a hook-control key.
function isHooksPathAssignment(word) {
  return isHookControlKey(String(word || '').split('=')[0]);
}

const CONFIG_READ_FLAGS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--get-color',
  '--get-colorbool',
  '-l',
  '--list',
]);
const CONFIG_WRITE_FLAGS = new Set([
  '--unset',
  '--unset-all',
  '--replace-all',
  '--add',
]);
const CONFIG_SECTION_FLAGS = new Set(['--remove-section', '--rename-section']);
const CONFIG_ACTIONS = new Set([
  'set',
  'unset',
  'edit',
  'rename-section',
  'remove-section',
]);
const CONFIG_VALUE_OPTIONS = new Set([
  '-f',
  '--file',
  '--blob',
  '--type',
  '--default',
  '--comment',
  '--value',
]);

function configArguments(args) {
  const flags = [];
  const operands = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    if (word === '--') {
      operands.push(...args.slice(index + 1));
      break;
    }
    if (!word.startsWith('-')) operands.push(word);
    else {
      flags.push(word.split('=')[0]);
      if (!word.includes('=') && CONFIG_VALUE_OPTIONS.has(word)) index += 1;
    }
  }
  return { flags, operands };
}

function configWritesHooksPath(args) {
  const { flags, operands } = configArguments(args);
  if (flags.some((flag) => CONFIG_READ_FLAGS.has(flag))) return false;
  let rest = operands;
  let section = flags.some((flag) => CONFIG_SECTION_FLAGS.has(flag));
  let write = flags.some((flag) => CONFIG_WRITE_FLAGS.has(flag));
  if (['get', 'list', 'edit'].includes(rest[0])) return false;
  if (['set', 'unset', 'rename-section', 'remove-section'].includes(rest[0])) {
    section = rest[0].endsWith('section');
    write = true;
    rest = rest.slice(1);
  }
  // Removing or renaming core, or renaming a section into include, changes
  // the keys that set core.hooksPath.
  if (section)
    return rest
      .slice(0, 2)
      .some((name) =>
        /^(?:core|include|includeif\..*)$/s.test(name.toLowerCase()),
      );
  return isHooksPathAssignment(rest[0]) && (write || rest.length >= 2);
}

// A short option cluster selects -e unless a value-taking -f comes first:
// `-le`, not `-f/home/me/x`.
function shortClusterEdits(flag) {
  for (const char of flag.slice(1)) {
    if (char === 'e') return true;
    if (char === 'f') return false;
  }
  return false;
}

// `git config --edit` hands the file to an editor the agent can script.
function configEdits(args) {
  const { flags, operands } = configArguments(args);
  return (
    flags.some(
      (flag) =>
        flag === '--edit' || (/^-[^-]/.test(flag) && shortClusterEdits(flag)),
    ) || operands[0] === 'edit'
  );
}

function configReads(args) {
  const { flags, operands } = configArguments(args);
  if (flags.some((flag) => CONFIG_READ_FLAGS.has(flag))) return true;
  if (['get', 'list'].includes(operands[0])) return true;
  const writes = flags.some(
    (flag) => CONFIG_WRITE_FLAGS.has(flag) || CONFIG_SECTION_FLAGS.has(flag),
  );
  return !writes && operands.length === 1 && !CONFIG_ACTIONS.has(operands[0]);
}

// The NAME and VALUE of `git config [set|--add|--replace-all] alias.NAME
// VALUE`, or null.
function configAliasDefinition(args) {
  const { flags, operands } = configArguments(args);
  if (flags.some((flag) => CONFIG_READ_FLAGS.has(flag))) return null;
  const rest = operands[0] === 'set' ? operands.slice(1) : operands;
  if (!/^alias\./i.test(rest[0] || '') || rest[1] === undefined) return null;
  return { key: rest[0], value: rest[1] };
}

// `clone -c`/`--config` and `clone`/`init --template` write the new
// repository's configuration, which can set core.hooksPath.
// Git accepts any unambiguous abbreviation of a long option; every prefix
// past `--` and one letter counts.
function longOption(name, option) {
  return name.length >= 4 && option.startsWith(name);
}

function newRepositoryConfig(args) {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    if (word === '--') return null;
    const [name, attached] = word.split(/=(.*)/s);
    if (longOption(name, '--template')) return 'a template';
    const config = name === '-c' || longOption(name, '--config');
    const value = config
      ? (attached ?? args[index + 1])
      : /^-c(.+)$/s.exec(word)?.[1];
    if (value !== undefined && isHooksPathAssignment(value))
      return 'its configuration';
  }
  return null;
}

module.exports = {
  configAliasDefinition,
  configEdits,
  configReads,
  configWritesHooksPath,
  isHookControlKey,
  isHooksPathAssignment,
  newRepositoryConfig,
};
