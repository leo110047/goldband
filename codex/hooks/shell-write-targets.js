const fs = require('fs');
const path = require('path');
const {
  GLOB_CHARACTERS,
  PROTECTED_RELATIVE_PROBES,
  expandPathWord,
  globMatches,
  isDirectoryTarget,
} = require('./protected-surfaces');

// Paths that explicit shell writers create, replace, or remove, read from
// static command words. Each target is { word, operation: write | remove }.
// A recursive copy whose source cannot be listed within this many entries is
// treated as if it carried every protected name.
const TREE_ENTRY_LIMIT = 2000;

function shellOperands(words, valueOptions = []) {
  const operands = [];
  let targetDirectory = null;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') {
      operands.push(...words.slice(index + 1));
      break;
    }
    if (word.startsWith('--target-directory=')) {
      targetDirectory = word.slice('--target-directory='.length);
    } else if (['-t', '--target-directory'].includes(word)) {
      targetDirectory = words[++index];
    } else if (valueOptions.includes(word)) index += 1;
    else if (!word.startsWith('-') || word === '-') operands.push(word);
  }
  return {
    operands: operands.filter((word) => word && word !== '-'),
    targetDirectory,
  };
}

function writes(words, operation = 'write') {
  return words.map((word) => ({ word, operation }));
}

function isRecursiveCopy(words) {
  const end = words.indexOf('--');
  return words
    .slice(1, end === -1 ? undefined : end)
    .some(
      (word) =>
        ['--recursive', '--archive'].includes(word) ||
        /^-[A-Za-z]*[rRa]/.test(word),
    );
}

// Relative paths below a directory, or null when it cannot be listed within
// TREE_ENTRY_LIMIT entries.
function listTree(directory) {
  const entries = [];
  const pending = [''];
  while (pending.length) {
    const relative = pending.pop();
    let children;
    try {
      children = fs.readdirSync(path.join(directory, relative), {
        withFileTypes: true,
      });
    } catch {
      return null;
    }
    for (const child of children) {
      const entry = path.join(relative, child.name);
      entries.push(entry);
      if (entries.length > TREE_ENTRY_LIMIT) return null;
      if (child.isDirectory()) pending.push(entry);
    }
  }
  return entries;
}

function isMergeForm(word) {
  return word.endsWith('/') || path.basename(word) === '.';
}

// Absolute source locations a source word may name: one list for each
// working directory, empty for an unmatched glob. A trailing `/` marks a
// source whose contents, not itself, are copied.
function sourceLocations(source, context) {
  const expanded = expandPathWord(source, context);
  const suffix = isMergeForm(expanded) ? '/' : '';
  return context.cwds.map((cwd) =>
    GLOB_CHARACTERS.test(expanded)
      ? globMatches(expanded, cwd, context.budget)
      : [path.resolve(cwd, expanded) + suffix],
  );
}

function sourceEntries(location) {
  try {
    return fs.lstatSync(location).isDirectory() ? listTree(location) : [];
  } catch {
    return null;
  }
}

// BSD cp copies the contents of `src/`; BSD and GNU cp copy those of `src/.`.
function mergesContents(name, source) {
  return name === 'cp' && isMergeForm(source);
}

function under(root, entries) {
  return writes(entries.map((entry) => path.join(root, entry)));
}

// A source that cannot be listed is checked as if it held every protected
// name; so is a missing cp source, which may be a glob or created later in
// the command. A missing mv source moves nothing. The destination comes
// first, so a destination that is itself a protected container is the
// reported surface.
function unlistedTargets(name, root, location) {
  if (name === 'mv' && !(location && fs.existsSync(location))) return [];
  return [...writes([root]), ...under(root, PROTECTED_RELATIVE_PROBES)];
}

// Every entry a moved or recursively copied source places below its
// destination. Each working directory is judged on its own, so a glob
// unmatched in one counts even where another matches.
function contentTargets(name, source, place, context) {
  return sourceLocations(source, context).flatMap((locations) =>
    locations.length
      ? locations.flatMap((location) => {
          const entries = sourceEntries(location);
          return entries
            ? under(place(location), entries)
            : unlistedTargets(name, place(location), location);
        })
      : unlistedTargets(name, place(source)),
  );
}

const COPY_VALUE_OPTIONS = {
  cp: ['-S', '--suffix'],
  mv: ['-S', '--suffix'],
  ln: ['-S', '--suffix'],
  install: [
    '-m',
    '--mode',
    '-o',
    '--owner',
    '-g',
    '--group',
    '-S',
    '--suffix',
    '-B',
    '-f',
    '-h',
    '-l',
    '-N',
  ],
};

function copyDestination(name, words) {
  const { operands, targetDirectory } = shellOperands(
    words,
    COPY_VALUE_OPTIONS[name],
  );
  if (targetDirectory)
    return {
      destination: targetDirectory,
      sources: operands,
      intoDirectory: true,
    };
  if (name === 'ln' && operands.length === 1)
    return { destination: '.', sources: operands, intoDirectory: true };
  return { destination: operands.at(-1), sources: operands.slice(0, -1) };
}

// cp/mv/ln/install destination paths, including SOURCE-into-DIRECTORY forms.
function copyTargets(name, words, context) {
  const { destination, sources, ...forced } = copyDestination(name, words);
  if (!destination) return [];
  const intoDirectory =
    forced.intoDirectory ||
    destination === '.' ||
    isDirectoryTarget(destination, context);
  const place = (source) =>
    !intoDirectory || mergesContents(name, source)
      ? destination
      : path.join(destination, path.basename(source));
  // `.` and `..` name no entry to place in a directory; only cp merges them.
  const written = intoDirectory
    ? sources
        .filter(
          (source) =>
            !mergesContents(name, source) &&
            !['.', '..'].includes(path.basename(source)),
        )
        .map(place)
    : [destination];
  const targets = writes(written);
  if (name === 'mv' || (name === 'cp' && isRecursiveCopy(words))) {
    for (const source of sources)
      targets.push(...contentTargets(name, source, place, context));
  }
  if (name === 'mv') targets.push(...writes(sources, 'remove'));
  // A link to a protected path lets a later write in the same command reach
  // it through the link.
  if (name === 'ln') targets.push(...writes(sources));
  return targets;
}

function sedInPlaceTargets(words) {
  const inPlace = words.some(
    (word) => /^-[A-Za-z]*[iI]/.test(word) || word.startsWith('--in-place'),
  );
  if (!inPlace) return [];
  const files = [];
  let script = false;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (['-e', '--expression', '-f', '--file'].includes(word)) {
      script = true;
      index += 1;
    } else if (/^(?:-[ef]|--expression=|--file=)/.test(word)) script = true;
    else if (!word.startsWith('-') && word) files.push(word);
  }
  // Without -e/-f the first operand is the sed script, not a file.
  return writes(script ? files : files.slice(1));
}

// `install -d` creates every operand as a directory.
function installTargets(words, context) {
  const end = words.indexOf('--');
  const options = words.slice(1, end === -1 ? undefined : end);
  if (options.some((word) => word === '--directory' || /^-[^-]*d/.test(word)))
    return writes(shellOperands(words, COPY_VALUE_OPTIONS.install).operands);
  return copyTargets('install', words, context);
}

// chmod, chown, chgrp, and chflags change who may read, write, or run their
// file operands. The first operand is the mode, owner, group, or flags unless
// --reference supplies it; chmod modes may start with `-` (`chmod -x f`).
const METADATA_FLAGS = {
  chmod: /^-[cfvhRHLP]+$/,
  chown: /^-/,
  chgrp: /^-/,
  chflags: /^-/,
};
const METADATA_VALUE_OPTIONS = ['--reference', '--from'];

// Applies one option word; returns how many following words it consumes.
function metadataOption(name, word, result) {
  const option = word.split('=')[0];
  if (METADATA_VALUE_OPTIONS.includes(option)) {
    result.reference ||= option === '--reference';
    return word.includes('=') ? 0 : 1;
  }
  if (word.startsWith('--')) result.recursive ||= word === '--recursive';
  else if (METADATA_FLAGS[name].test(word))
    result.recursive ||= word.includes('R');
  else result.operands.push(word);
  return 0;
}

function metadataArguments(name, words) {
  const result = { operands: [], reference: false, recursive: false };
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') {
      result.operands.push(...words.slice(index + 1));
      break;
    }
    if (word.startsWith('-') && word !== '-')
      index += metadataOption(name, word, result);
    else result.operands.push(word);
  }
  return result;
}

// Every existing entry below a recursive operand; one that cannot be listed
// within TREE_ENTRY_LIMIT entries is checked as if it held every protected
// name.
function existingTreeTargets(word, context) {
  return sourceLocations(word, context)
    .flat()
    .filter((location) => fs.existsSync(location))
    .flatMap((location) =>
      under(location, sourceEntries(location) ?? PROTECTED_RELATIVE_PROBES),
    );
}

function metadataTargets(name, words, context) {
  const args = metadataArguments(name, words);
  const files = args.reference ? args.operands : args.operands.slice(1);
  const targets = writes(files);
  if (args.recursive)
    for (const file of files)
      targets.push(...existingTreeTargets(file, context));
  return targets;
}

const WRITERS = {
  tee: (words) => writes(shellOperands(words).operands),
  touch: (words) => writes(shellOperands(words).operands),
  truncate: (words) =>
    writes(
      shellOperands(words, ['-s', '--size', '-r', '--reference']).operands,
    ),
  rm: (words) => writes(shellOperands(words).operands, 'remove'),
  unlink: (words) => writes(shellOperands(words).operands, 'remove'),
  cp: (words, context) => copyTargets('cp', words, context),
  mv: (words, context) => copyTargets('mv', words, context),
  ln: (words, context) => copyTargets('ln', words, context),
  install: installTargets,
  dd: (words) =>
    writes(
      words
        .filter((word) => word.startsWith('of='))
        .map((word) => word.slice(3)),
    ),
  sed: sedInPlaceTargets,
  ...Object.fromEntries(
    Object.keys(METADATA_FLAGS).map((name) => [
      name,
      (words, context) => metadataTargets(name, words, context),
    ]),
  ),
};

function commandWriteTargets(words, context) {
  const writer = Object.hasOwn(WRITERS, words[0]) ? WRITERS[words[0]] : null;
  return writer ? writer(words, context) : [];
}

function redirectTargets(segment) {
  return (segment.redirects || [])
    .filter((redirect) => redirect.operator.includes('>'))
    .filter(
      (redirect) =>
        !(
          /^>+&$/.test(redirect.operator) &&
          /^(?:\d+-?|-)$/.test(redirect.target)
        ),
    )
    .map((redirect) => ({ word: redirect.target, operation: 'write' }));
}

const WRITER_NAMES = Object.keys(WRITERS);

module.exports = { WRITER_NAMES, commandWriteTargets, redirectTargets };
