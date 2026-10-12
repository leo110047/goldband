const { commandStdin } = require('./shell-commands');
const {
  inspectShellCommand,
  SHELL_ANALYSIS_FAILURE,
} = require('./shell-policy');

function optionsBeforeTerminator(words) {
  const end = words.indexOf('--');
  return end < 0 ? words : words.slice(0, end);
}

const CAREFUL_MODE_GUARDS = [
  {
    rule: 'rm-rf',
    commands: ['rm'],
    detail: 'rm -rf / recursive force delete',
    matches(words) {
      const options = optionsBeforeTerminator(words.slice(1));
      return (
        options.some(
          (word) =>
            word === '--recursive' || /^-[A-Za-z]*r[A-Za-z]*$/.test(word),
        ) &&
        options.some(
          (word) => word === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(word),
        )
      );
    },
  },
  {
    rule: 'git-force-push',
    commands: ['git'],
    detail: 'git push --force / --force-with-lease / -f',
    matches(words) {
      return (
        words[1] === 'push' &&
        optionsBeforeTerminator(words.slice(2)).some((word) =>
          /^(?:--force(?:-with-lease)?(?:=\S*)?|-f)$/.test(word),
        )
      );
    },
  },
  {
    rule: 'git-reset-hard',
    commands: ['git'],
    detail: 'git reset --hard',
    matches(words) {
      return (
        words[1] === 'reset' &&
        optionsBeforeTerminator(words.slice(2)).includes('--hard')
      );
    },
  },
  {
    rule: 'terraform-destroy',
    commands: ['terraform'],
    detail: 'terraform destroy',
    matches(words) {
      return words[1] === 'destroy';
    },
  },
  {
    rule: 'kubectl-delete',
    commands: ['kubectl'],
    detail: 'kubectl delete',
    matches(words) {
      return words[1] === 'delete';
    },
  },
  {
    rule: 'helm-uninstall',
    commands: ['helm'],
    detail: 'helm uninstall',
    matches(words) {
      return words[1] === 'uninstall';
    },
  },
  {
    rule: 'destructive-sql',
    commands: ['psql', 'mysql', 'sqlite3', 'sqlcmd', 'pscale', 'prisma'],
    detail:
      'destructive SQL via psql/mysql/sqlite3/sqlcmd/pscale/prisma db execute',
    matches(words, stdin) {
      const usesDbClient =
        words[0] !== 'prisma' || (words[1] === 'db' && words[2] === 'execute');
      const destructiveSql =
        /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i.test(
          `${words.slice(1).join(' ')}\n${stdin()}`,
        );
      return usesDbClient && destructiveSql;
    },
  },
];
const CAREFUL_COMMANDS = new Set(
  CAREFUL_MODE_GUARDS.flatMap((rule) => rule.commands),
);

function matchCarefulModeRisk(command) {
  if (!command) {
    return null;
  }

  const result = inspectShellCommand(
    command,
    (name) => CAREFUL_COMMANDS.has(name),
    (words, segment) =>
      CAREFUL_MODE_GUARDS.find(
        (rule) =>
          rule.commands.includes(words[0]) &&
          rule.matches(words, () => commandStdin(segment)),
      ) || null,
  );
  return result.failed
    ? { rule: 'shell-analysis-failed', detail: SHELL_ANALYSIS_FAILURE }
    : result.risk;
}

module.exports = {
  CAREFUL_MODE_GUARDS,
  matchCarefulModeRisk,
};
