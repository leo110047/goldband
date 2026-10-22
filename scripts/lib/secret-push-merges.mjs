// Merge commits through the pre-push secret gate, run by
// test-secret-push-gate.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {
  assertBlocked,
  assertEqual,
  assertIncludes,
  assertPassed,
  commitFile,
  createRepo,
  git,
  push,
  remoteHas,
  secretLine,
} from './secret-push-fixture.mjs';

export function testEvilMergeBlocks() {
  const { repo, bare } = createRepo();
  git(repo, ['checkout', '-q', '-b', 'topic']);
  commitFile(repo, 'topic.txt', 'topic\n');
  git(repo, ['checkout', '-q', 'main']);
  commitFile(repo, 'main.txt', 'main\n');
  git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'topic']);
  fs.writeFileSync(path.join(repo, 'conf.txt'), secretLine());
  git(repo, ['add', 'conf.txt']);
  git(repo, ['commit', '-q', '-m', 'merge topic']);
  const result = push(repo, ['origin', 'main']);
  assertBlocked(result, 'gitleaks found secrets');
  assertEqual(remoteHas(bare, 'refs/heads/main'), false);
}

// The merge commit's diff holds only what the automatic merge did not, so an
// ignored side-branch finding is not reported again under the merge commit.
export function testIgnoredMergedFindingPasses() {
  const { repo, bare } = createRepo();
  git(repo, ['checkout', '-q', '-b', 'topic']);
  commitFile(repo, 'conf.txt', secretLine());
  const finding = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', 'main']);
  commitFile(repo, 'main.txt', 'main\n');
  git(repo, ['merge', '-q', '--no-ff', '-m', 'merge topic', 'topic']);
  fs.writeFileSync(
    path.join(repo, '.gitleaksignore'),
    `${finding}:conf.txt:aws-access-token:1\n`,
  );
  assertPassed(push(repo, ['origin', 'main']));
  assertEqual(remoteHas(bare, 'refs/heads/main'), true);
}

// Git skips remerge diffs for octopus merges, so the gate refuses to pass
// one it could not read.
export function testOctopusMergeBlocks() {
  const { repo, bare } = createRepo();
  for (const branch of ['one', 'two']) {
    git(repo, ['checkout', '-q', '-b', branch, 'main']);
    commitFile(repo, `${branch}.txt`, `${branch}\n`);
  }
  git(repo, ['checkout', '-q', 'main']);
  git(repo, ['merge', '-q', '--no-ff', '-m', 'octopus', 'one', 'two']);
  assertEqual(
    git(repo, ['rev-list', '--count', '--min-parents=3', 'HEAD']),
    '1',
  );
  const result = push(repo, ['origin', 'main']);
  assertBlocked(result, 'secret scan failed');
  assertIncludes(result.stderr, 'octopus merge');
  assertEqual(remoteHas(bare, 'refs/heads/main'), false);
}
