import fs from 'node:fs';
import path from 'node:path';

export function validateCapabilityInvocations({
  root,
  invocationRoots,
  capabilities,
}) {
  const missingRoots = invocationRoots.filter(
    (entry) => !fs.existsSync(path.join(root, entry)),
  );
  if (missingRoots.length > 0) {
    throw new Error(
      `missing Goldband capability invocation root: ${missingRoots.join(', ')}`,
    );
  }

  const validActions = new Set(
    capabilities.flatMap((capability) =>
      capability.actions.map((action) => `${capability.id}/${action.id}`),
    ),
  );
  const invalid = invocationRoots
    .flatMap((entry) => invocationFiles(path.join(root, entry)))
    .flatMap((file) => invalidInvocations(file, root, validActions));

  if (invalid.length > 0) {
    throw new Error(
      `invalid Goldband capability invocation; expected $goldband <capability> <action>:\n${invalid.join('\n')}`,
    );
  }
}

function invalidInvocations(file, root, validActions) {
  const content = fs.readFileSync(file, 'utf8');
  const pattern =
    /(?:\$|\/)goldband(?:[ \t]+([a-z][a-z0-9-]*))?(?:[ \t]+([a-z][a-z0-9-]*))?/gi;
  const invalid = [...content.matchAll(pattern)]
    .filter((match) => match[1])
    .filter((match) => {
      if (!match[2]) return true;
      return !validActions.has(
        `${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
      );
    })
    .map((match) => {
      const line = content.slice(0, match.index).split('\n').length;
      return `${path.relative(root, file)}:${line}: ${JSON.stringify(match[0])}`;
    });
  const retired =
    /\bGoldband\s+(?:cso|skillify|plan-eng-review)\s+workflow\b|\/(?:craft|why|next)\b/g;
  for (const match of content.matchAll(retired)) {
    const line = content.slice(0, match.index).split('\n').length;
    invalid.push(
      `${path.relative(root, file)}:${line}: retired guidance ${JSON.stringify(match[0])}`,
    );
  }
  return invalid;
}

function invocationFiles(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  return fs
    .readdirSync(entry, { withFileTypes: true })
    .flatMap((child) => invocationFiles(path.join(entry, child.name)));
}
