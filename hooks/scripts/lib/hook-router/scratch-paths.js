const fs = require('fs');
const path = require('path');
const { repositoryGitDirs } = require('./git-config-files');
const { foldedVariants, isWithin } = require('./path-variants');

// Where Gate G may treat a project-level surface as a scratch copy: below a
// per-user temporary root, outside homes, relocated user configuration, and
// the configuration the calling session reads.

// $TMPDIR and Claude Code's /tmp/claude-<uid>, each only while it is a real
// directory this user owns, so a shared /tmp, a filesystem root, or a link
// another user planted never counts.
function scratchRoots(env) {
  const uid = process.getuid?.();
  if (uid === undefined) return [];
  const owned = (root) => {
    try {
      const stat = fs.lstatSync(root);
      return stat.isDirectory() && stat.uid === uid;
    } catch {
      return false;
    }
  };
  return [env.TMPDIR, path.join('/tmp', `claude-${uid}`)]
    .filter((root) => path.isAbsolute(root || '') && owned(root))
    .flatMap(foldedVariants);
}

function sessionDirs({ workdir, env }) {
  const project = env.CLAUDE_PROJECT_DIR;
  return path.isAbsolute(project || '') ? [workdir, project] : [workdir];
}

// The anchors these checks read; `context` is a protected-path context.
function scratchAnchors(context) {
  const { env } = context;
  return {
    scratchRoots: scratchRoots(env),
    // User configuration a host may relocate; never a scratch copy.
    configHomes: [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME]
      .filter((dir) => path.isAbsolute(dir || ''))
      .flatMap(foldedVariants),
    // The call's directory and, in Claude, the session's project root.
    workdirs: sessionDirs(context).flatMap(foldedVariants),
    repositoryGitDirs: sessionDirs(context)
      .flatMap(repositoryGitDirs)
      .flatMap(foldedVariants),
  };
}

// The `.claude` or `.codex` directory holding a project-level target, else
// its nearest enclosing `*.git` directory; null for a file such as
// `.mcp.json` or a `.git` entry in the directory it configures.
function configDir(target) {
  const parts = target.split(path.sep);
  let index = parts.findLastIndex((part) =>
    ['.claude', '.codex'].includes(part),
  );
  if (index === -1)
    index = parts.slice(0, -1).findLastIndex((part) => part.endsWith('.git'));
  return index > 0 ? parts.slice(0, index + 1).join(path.sep) : null;
}

// What a project-level path is within the configuration it belongs to.
function configRole(target) {
  const dir = configDir(target);
  return dir ? path.relative(dir, target) : path.basename(target);
}

// A session in the starting directory reads configuration from that
// directory and its ancestors, and from its repository's Git directories.
function isLiveProjectConfig(target, context) {
  const dir = configDir(target);
  const owner = path.dirname(dir || target);
  return (
    context.repositoryGitDirs.some((gitDir) => isWithin(target, gitDir)) ||
    context.workdirs.some(
      (workdir) => isWithin(target, workdir) || isWithin(workdir, owner),
    )
  );
}

// A target under a scratch root, outside every home and relocated user
// configuration, that the starting directory's session does not read.
function isScratchPath(target, context) {
  const within = (roots) => roots.some((root) => isWithin(target, root));
  return (
    within(context.scratchRoots) &&
    !within(context.homes) &&
    !within(context.configHomes) &&
    !isLiveProjectConfig(target, context)
  );
}

module.exports = { configRole, isScratchPath, scratchAnchors };
