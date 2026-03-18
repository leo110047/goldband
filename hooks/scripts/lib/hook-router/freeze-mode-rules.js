const FREEZE_MODE_PROTECTIONS = [
  {
    rule: 'read-only-bash-only',
    detail: 'allows only read-only Bash commands such as git status/diff/log/show, rg, grep, ls, cat, and similar inspection tools'
  },
  {
    rule: 'no-shell-chaining',
    detail: 'blocks shell chaining, pipes, and redirections because they are harder to classify as read-only'
  },
  {
    rule: 'no-file-edits',
    detail: 'blocks Edit and Write tool calls while freeze-mode is active'
  }
];

const FREEZE_MODE_ALLOWED_BASH = [
  {
    rule: 'pwd',
    matches(command) {
      return /^pwd(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'ls',
    matches(command) {
      return /^ls(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'rg',
    matches(command) {
      return /^rg(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'grep',
    matches(command) {
      return /^grep(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'cat',
    matches(command) {
      return /^cat(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'head',
    matches(command) {
      return /^head(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'tail',
    matches(command) {
      return /^tail(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'wc',
    matches(command) {
      return /^wc(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'uniq',
    matches(command) {
      return /^uniq(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'diff',
    matches(command) {
      return /^diff(?:\s|$)/.test(command) && !/(?:^|\s)--output(?:=|\s)/.test(command);
    }
  },
  {
    rule: 'which',
    matches(command) {
      return /^which(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'readlink',
    matches(command) {
      return /^readlink(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'realpath',
    matches(command) {
      return /^realpath(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'basename',
    matches(command) {
      return /^basename(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'dirname',
    matches(command) {
      return /^dirname(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'env',
    matches(command) {
      return /^(env|printenv)(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'echo',
    matches(command) {
      return /^(echo|printf)(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'git-read-only',
    matches(command) {
      return (
        /^git\s+(status|rev-parse)\b/.test(command)
        || /^git\s+(diff|log|show)\b/.test(command) && !/(?:^|\s)--output(?:=|\s)/.test(command)
      );
    }
  }
];

function hasShellControlOperators(command) {
  return /[|;&><]/.test(command);
}

function matchFreezeModeBashViolation(command) {
  if (!command) {
    return null;
  }

  const normalized = String(command).replace(/\s+/g, ' ').trim();
  if (hasShellControlOperators(normalized)) {
    return {
      rule: 'no-shell-chaining',
      detail: 'freeze-mode blocks shell chaining, pipes, and redirections'
    };
  }

  if (FREEZE_MODE_ALLOWED_BASH.some(item => item.matches(normalized))) {
    return null;
  }

  return {
    rule: 'read-only-bash-only',
    detail: 'freeze-mode allows only read-only Bash commands'
  };
}

module.exports = {
  FREEZE_MODE_ALLOWED_BASH,
  FREEZE_MODE_PROTECTIONS,
  matchFreezeModeBashViolation
};
