const fs = require('fs');
const path = require('path');

// Lexical and symlink-resolved spellings of a path, and their case-folded
// forms, which Gate G compares.
function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

// Resolve symlinks in the longest existing prefix; the rest stays lexical.
function realpathNearest(target) {
  const tail = [];
  let current = target;
  while (current !== path.dirname(current)) {
    const real = realpathOrNull(current);
    if (real) return path.join(real, ...tail.reverse());
    tail.push(path.basename(current));
    current = path.dirname(current);
  }
  return target;
}

function pathVariants(target) {
  return [...new Set([path.resolve(target), realpathNearest(target)])];
}

function fold(target) {
  return target.toLowerCase();
}

function foldedVariants(target) {
  return [...new Set(pathVariants(target).map(fold))];
}

function isWithin(target, root) {
  return (
    target === root ||
    target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
  );
}

module.exports = {
  fold,
  foldedVariants,
  isWithin,
  pathVariants,
  realpathOrNull,
};
