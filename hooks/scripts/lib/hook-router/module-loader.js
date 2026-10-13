const fs = require('fs');

function requireFirst(candidates) {
  const attempted = [];
  for (const candidate of candidates.filter(Boolean)) {
    attempted.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    return require(candidate);
  }
  const error = new Error(
    `Goldband runtime module unavailable; checked: ${attempted.join(', ')}`,
  );
  error.code = 'GOLDBAND_RUNTIME_MODULE_MISSING';
  throw error;
}

module.exports = { requireFirst };
