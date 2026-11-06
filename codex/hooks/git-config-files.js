const fs = require('fs');
const path = require('path');

// Locations of Git configuration files: those [include] and [includeIf] path
// entries name, and the repository directories a working directory uses.
const INCLUDE_DEPTH_LIMIT = 4;
// A section header and its name: `[include]`, `[includeIf "gitdir:~/w/"]`.
const CONFIG_HEADER = /^\s*\[\s*([^\]\s"]+)(?:[^\]"]|"(?:[^"\\]|\\.)*")*\]/;

function includeValue(text, file, home) {
  const value = text
    .replace(/^"(.*)"\s*(?:[#;].*)?$/, '$1')
    .replace(/\s+[#;].*$/, '')
    .trim();
  if (!value) return null;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return path.resolve(path.dirname(file), value);
}

// Files a Git configuration file includes through include.path and
// includeIf.<condition>.path, followed as Git does: `~/` from home and
// relative paths from the including file. A file that cannot be read
// includes nothing.
function configIncludes(file, home, depth = 0) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let section = '';
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const header = CONFIG_HEADER.exec(line);
    if (header) section = header[1].toLowerCase();
    // A key may follow its section header on the same line.
    const entry = /^\s*path\s*=\s*(.*)$/i.exec(
      header ? line.slice(header[0].length) : line,
    );
    if (!entry || !['include', 'includeif'].includes(section)) continue;
    const included = includeValue(entry[1], file, home);
    if (included) files.push(included);
  }
  if (depth + 1 >= INCLUDE_DEPTH_LIMIT) return files;
  return [
    ...files,
    ...files.flatMap((included) => configIncludes(included, home, depth + 1)),
  ];
}

function readLine(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
  } catch {
    return '';
  }
}

// The Git directories a `.git` entry in `dir` names: itself when it is a
// directory, else the `gitdir:` its file names with that directory's
// `commondir`; null when there is no entry.
function dotGitDirs(dir) {
  const dotGit = path.join(dir, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return [dotGit];
  const gitdir = /^gitdir:\s*(.+)$/.exec(readLine(dotGit));
  if (!gitdir) return null;
  const linked = path.resolve(dir, gitdir[1]);
  const common = readLine(path.join(linked, 'commondir'));
  return common ? [linked, path.resolve(linked, common)] : [linked];
}

// The Git directories whose config a command in `cwd` reads, found as Git
// does from the nearest `.git` entry, with any enclosing directory whose name
// ends in `.git`.
function repositoryGitDirs(cwd) {
  const dirs = [];
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (path.basename(dir).endsWith('.git')) dirs.push(dir);
    const found = dotGitDirs(dir);
    if (found) return [...dirs, ...found];
    if (dir === path.dirname(dir)) return dirs;
  }
}

// `target` and the context's anchors are case-folded.
function isGlobalGitConfig(target, context) {
  return (
    context.homes.some((home) => path.join(home, '.gitconfig') === target) ||
    context.gitConfigFiles.includes(target)
  );
}

// Repository, worktree, and global Git configuration, where core.hooksPath
// and aliases live, and a `.git` file that points the work tree at another
// repository. A bare repository's directory ends in `.git`.
function isGitConfig(target, context) {
  const parts = target.split(path.sep);
  const git = parts.findLastIndex((part) => part.endsWith('.git'));
  const inGitDir = git !== -1 && git < parts.length - 1;
  return (
    (inGitDir &&
      ['config', 'config.worktree'].includes(path.basename(target))) ||
    path.basename(target) === '.git' ||
    isGlobalGitConfig(target, context)
  );
}

module.exports = {
  configIncludes,
  isGitConfig,
  isGlobalGitConfig,
  repositoryGitDirs,
};
