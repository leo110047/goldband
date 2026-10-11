import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  abortCreatedManagedWorktree,
  createManagedWorktree,
  finishManagedWorktree,
  markIntegratedWithRetry,
  type ManagedWorktreeLease,
} from '../lib/managed-worktree';
import { writeLease } from '../lib/managed-worktree-contract';
import { createGitExecutionContext } from '../lib/managed-worktree-git';
import { prepareManagedCommit } from '../lib/managed-worktree-integration';
import {
  recordVerification,
} from '../lib/verification-receipt';
import {
  probeManagedBoundary,
  runManagedCommand,
} from '../lib/managed-worktree-boundary';
import { type WorkMapCreateInput } from '../workflows/work-map';
import { WorkMapStore } from '../workflows/work-map-store';

const fixtures: string[] = [];
const skipLiveBoundary =
  process.env.GOLDBAND_REQUIRE_LIVE_BOUNDARY !== '1' &&
  hostForbidsNestedBoundary();

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe('managed worktree contract', () => {
  test('bound finish integrates project-verified code without a review artifact', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'bound-finish',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'verified candidate\n');
    recordVerification({
      stage: 'check',
      command: [process.execPath, '-e', 'process.exit(0)'],
      cwd: lease.worktreePath,
    });

    const result = finishManagedWorktree({
      name: lease.name,
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      message: 'feat: integrate verified ticket',
    });

    const completed = store.read('work-a');
    expect(completed.status).toBe('completed');
    expect(completed.tickets[0]?.integratedCommit).toBe(result.commit);
    expect(fs.readFileSync(path.join(fixture.repo, 'tracked.txt'), 'utf8')).toBe(
      'verified candidate\n',
    );
  }, 10_000);


  test('bound finish preserves a candidate without project verification', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'bound-unreviewed',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'implemented only\n');
    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'must not integrate',
      }),
    ).toThrow('lacks project verification');
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    expect(store.read('work-a').tickets[0]?.status).toBe('claimed');
  });


  test('bound finish rejects an executable-mode change after project verification', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'bound-mode-change',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    const script = path.join(lease.worktreePath, 'candidate.sh');
    fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    recordVerification({
      stage: 'check',
      command: [process.execPath, '-e', 'process.exit(0)'],
      cwd: lease.worktreePath,
    });
    fs.chmodSync(script, 0o755);

    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'must not integrate an unreviewed mode',
      }),
    ).toThrow('verification receipt is stale');
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
  });

  test('integrated commit readback retries an unrelated Work Map revision race', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    const created = store.create(workMapInput(), 'codex');
    const claimed = store.claimTicket({
      workId: created.id,
      ticketId: 'ticket-a',
      expectedRevision: created.revision,
      owner: 'codex',
      leaseId: 'lease-a',
    });
    store.markImplemented({
      workId: created.id,
      ticketId: 'ticket-a',
      expectedRevision: claimed.revision,
      actor: 'recorder',
      receipt: { id: 'receipt-a', digest: 'a'.repeat(64), treeDigest: 'b'.repeat(64) },
    });
    let injected = false;
    const commit = 'd'.repeat(40);
    markIntegratedWithRetry({
      store,
      workId: created.id,
      ticketId: 'ticket-a',
      commit,
      beforeAttempt: (attempt) => {
        if (attempt !== 1) return;
        const current = store.read(created.id);
        store.update(created.id, current.revision, 'concurrent-map-note', 'other-ticket', (map) => {
          map.destination = 'Integrate a verified managed candidate safely';
          return map;
        });
        injected = true;
      },
    });
    expect(injected).toBe(true);
    expect(store.read(created.id).tickets[0]?.integratedCommit).toBe(commit);
  });

  test('aborting a newly created bound worktree rolls its claim back', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'bound-abort',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    expect(store.read('work-a').tickets[0]?.status).toBe('claimed');
    abortCreatedManagedWorktree(lease);
    const rolledBack = store.read('work-a');
    expect(rolledBack.tickets[0]?.status).toBe('ready');
    expect(rolledBack.tickets[0]?.claim).toBeUndefined();
    expect(rolledBack.frontier).toEqual(['ticket-a']);
  });

  test('abort keeps the claim while worktree removal is blocked', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'abort-locked',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    gitOk(fixture.repo, [
      'worktree',
      'lock',
      '--reason',
      'test removal failure',
      lease.worktreePath,
    ]);

    expect(() => abortCreatedManagedWorktree(lease)).toThrow();
    expect(store.read('work-a').tickets[0]?.status).toBe('claimed');
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    expect(fs.existsSync(lease.manifestPath)).toBe(true);

    gitOk(fixture.repo, ['worktree', 'unlock', lease.worktreePath]);
    abortCreatedManagedWorktree(lease);
    expect(store.read('work-a').tickets[0]?.status).toBe('ready');
  });

  test('abort retries an unrelated Work Map revision race after removal', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'abort-revision-race',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    let injected = false;
    abortCreatedManagedWorktree(lease, {
      beforeRollbackAttempt: (attempt) => {
        if (attempt !== 1) return;
        const current = store.read('work-a');
        store.update('work-a', current.revision, 'concurrent-map-note', 'other-actor', (map) => {
          map.destination = 'Integrate a verified managed candidate safely';
          return map;
        });
        injected = true;
      },
    });
    expect(injected).toBe(true);
    expect(fs.existsSync(lease.worktreePath)).toBe(false);
    expect(store.read('work-a').tickets[0]?.status).toBe('ready');
  });

  test('abort can resume after worktree removal outlives all rollback retries', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'abort-retry-saga',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });

    expect(() =>
      abortCreatedManagedWorktree(lease, {
        beforeRollbackAttempt: () => {
          const current = store.read('work-a');
          store.update('work-a', current.revision, 'persistent-map-race', 'other-actor', (map) => map);
        },
      }),
    ).toThrow('stale Work Map revision');
    expect(fs.existsSync(lease.worktreePath)).toBe(false);
    expect(store.read('work-a').tickets[0]?.status).toBe('claimed');
    expect(JSON.parse(fs.readFileSync(lease.manifestPath, 'utf8')).status).toBe('aborting');

    abortCreatedManagedWorktree(lease);
    expect(store.read('work-a').tickets[0]?.status).toBe('ready');
    expect(fs.existsSync(lease.manifestPath)).toBe(false);
  });

  test('abort releases a concurrently blocked lease and resume returns it to ready', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const lease = createManagedWorktree({
      name: 'abort-block-race',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    abortCreatedManagedWorktree(lease, {
      beforeRollbackAttempt: (attempt) => {
        if (attempt !== 1) return;
        const current = store.read('work-a');
        store.blockTicket({
          workId: 'work-a',
          ticketId: 'ticket-a',
          expectedRevision: current.revision,
          actor: 'concurrent-blocker',
          reason: 'temporary external dependency',
        });
      },
    });
    const blocked = store.read('work-a');
    expect(blocked.tickets[0]?.status).toBe('blocked');
    expect(blocked.tickets[0]?.claim).toBeUndefined();
    expect(fs.existsSync(lease.worktreePath)).toBe(false);
    const resumed = store.resumeTicket({
      workId: 'work-a',
      ticketId: 'ticket-a',
      expectedRevision: blocked.revision,
      actor: 'resume-after-abort',
    });
    expect(resumed.tickets[0]?.status).toBe('ready');
  });

  test('create records a detached managed lease without creating a branch', () => {
    const fixture = createFixture();
    const refsBefore = git(fixture.repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']);

    const lease = createManagedWorktree({
      name: 'task-one',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });

    expect(git(lease.worktreePath, ['symbolic-ref', '-q', 'HEAD'], true).status).not.toBe(0);
    expect(git(lease.worktreePath, ['rev-parse', 'HEAD']).stdout.trim()).toBe(lease.baseCommit);
    expect(git(fixture.repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']).stdout).toBe(
      refsBefore.stdout,
    );
    expect(fs.statSync(lease.manifestPath).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(lease.worktreeGitDir, 'goldband-managed-worktree.json'))).toBe(
      true,
    );
    expect(lease.stateRoot).toBe(fs.realpathSync(fixture.state));
  });

  test('reconciles a process crash after pending lease publication before claim', () => {
    const fixture = createFixture();
    const store = new WorkMapStore({
      cwd: fixture.repo,
      goldbandHome: fixture.state,
      idFactory: () => 'work-a',
    });
    store.create(workMapInput(), 'codex');
    const moduleUrl = new URL('../lib/managed-worktree.ts', import.meta.url).href;
    const crashed = spawnSync(
      process.execPath,
      [
        '-e',
        `
          import { createManagedWorktree } from ${JSON.stringify(moduleUrl)};
          createManagedWorktree({
            name: 'crash-pending',
            repoRoot: ${JSON.stringify(fixture.repo)},
            stateRoot: ${JSON.stringify(fixture.state)},
            ticketId: 'ticket-a',
            afterPendingLease: () => process.exit(92),
          });
        `,
      ],
      { encoding: 'utf8' },
    );
    expect(crashed.status).toBe(92);
    expect(store.read('work-a').tickets[0]?.status).toBe('ready');

    const recovered = createManagedWorktree({
      name: 'after-crash',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      ticketId: 'ticket-a',
    });
    expect(store.read('work-a').tickets[0]?.claim?.leaseId).toBe(recovered.id);
    expect(fs.existsSync(recovered.worktreePath)).toBe(true);
    abortCreatedManagedWorktree(recovered);
  });

  test.skipIf(skipLiveBoundary)(
    'the OS boundary blocks Git metadata and delayed broker-input poisoning while work and reads still run',
    () => {
      const fixture = createFixture();
      const agentHome = path.join(fixture.root, 'agent-home');
      fs.mkdirSync(agentHome);
      const previousHome = process.env.HOME;
      process.env.HOME = agentHome;
      let lease: ManagedWorktreeLease;
      try {
        lease = createManagedWorktree({
          name: 'boundary',
          repoRoot: fixture.repo,
          stateRoot: fixture.state,
        });
      } finally {
        if (previousHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = previousHome;
        }
      }

      const runtimePoison = path.join(
        lease.broker.runtimeRoot,
        `.goldband-runtime-poison-${lease.id}`,
      );
      const configPoison = path.join(agentHome, '.gitconfig');
      const brokerScratchPoison = path.join(lease.scratchPath, 'agent-poison');
      try {
        fs.writeFileSync(
          path.join(lease.worktreePath, 'indirect.sh'),
          '#!/bin/sh\ngit add -A\ngit commit -m indirect\n',
          { mode: 0o755 },
        );
        fs.writeFileSync(path.join(lease.worktreePath, 'changed.txt'), 'changed\n');

        const probe = probeManagedBoundary(lease);
        expect(probe).toEqual({ available: true, boundary: lease.enforcement.boundary });

        const metadataBefore = metadataSnapshot(lease);
        const attempts: string[][] = [
          ['git', 'add', 'changed.txt'],
          ['git', 'commit', '--allow-empty', '-m', 'blocked'],
          ['git', 'commit', '--no-verify', '--allow-empty', '-m', 'blocked'],
          ['/usr/bin/git', 'commit', '--allow-empty', '-m', 'blocked'],
          ['/bin/sh', './indirect.sh'],
          ['/bin/sh', '-c', 'git commit-tree "$(git rev-parse HEAD^{tree})" -p HEAD -m blocked'],
          ['git', 'update-ref', 'refs/heads/blocked', 'HEAD'],
          ['/bin/sh', '-c', 'printf poisoned > "$1"', 'poison-config', configPoison],
          ['/bin/sh', '-c', 'printf poisoned > "$1"', 'poison-runtime', runtimePoison],
          [
            '/bin/sh',
            '-c',
            'printf poisoned > "$1"',
            'poison-broker-scratch',
            brokerScratchPoison,
          ],
        ];
        for (const attempt of attempts) {
          const result = runManagedCommand(lease, attempt);
          expect(result.status, `${attempt.join(' ')} unexpectedly succeeded`).not.toBe(0);
          expect(metadataSnapshot(lease)).toEqual(metadataBefore);
        }

        expect(fs.existsSync(configPoison)).toBe(false);
        expect(fs.existsSync(runtimePoison)).toBe(false);
        expect(fs.existsSync(brokerScratchPoison)).toBe(false);
        expect(
          runManagedCommand(lease, ['/bin/sh', '-c', 'printf work > writable.txt']).status,
        ).toBe(0);
        expect(fs.readFileSync(path.join(lease.worktreePath, 'writable.txt'), 'utf8')).toBe('work');
        expect(runManagedCommand(lease, ['git', 'status', '--short']).status).toBe(0);
        expect(runManagedCommand(lease, ['git', 'diff', '--', 'tracked.txt']).status).toBe(0);
        expect(runManagedCommand(lease, [process.execPath, '-e', 'process.exit(0)']).status).toBe(0);
      } finally {
        fs.rmSync(runtimePoison, { force: true });
      }
    },
  );

  test('ordinary non-managed repositories remain writable', () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.repo, 'ordinary.txt'), 'ordinary\n');
    gitOk(fixture.repo, ['add', 'ordinary.txt']);
    gitOk(fixture.repo, ['commit', '-m', 'ordinary commit']);
    expect(git(fixture.repo, ['log', '-1', '--format=%s']).stdout.trim()).toBe('ordinary commit');
  });

  test('finish commits tracked and untracked changes onto the unchanged source branch', () => {
    const fixture = createFixture();
    const lease = createManagedWorktree({
      name: 'finish-ok',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'updated\n');
    fs.writeFileSync(path.join(lease.worktreePath, 'untracked.txt'), 'new\n');
    fs.rmSync(path.join(lease.worktreePath, 'delete-me.txt'));

    const result = finishManagedWorktree({
      name: lease.name,
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      message: 'feat: integrate managed worktree',
    });

    expect(result.commit).toBe(git(fixture.repo, ['rev-parse', 'refs/heads/main']).stdout.trim());
    expect(git(fixture.repo, ['log', '-1', '--format=%s']).stdout.trim()).toBe(
      'feat: integrate managed worktree',
    );
    expect(fs.readFileSync(path.join(fixture.repo, 'tracked.txt'), 'utf8')).toBe('updated\n');
    expect(fs.readFileSync(path.join(fixture.repo, 'untracked.txt'), 'utf8')).toBe('new\n');
    expect(fs.existsSync(path.join(fixture.repo, 'delete-me.txt'))).toBe(false);
    expect(fs.existsSync(lease.worktreePath)).toBe(false);
    expect(fs.existsSync(lease.manifestPath)).toBe(false);
    expect(fs.existsSync(result.evidencePath)).toBe(true);
  });

  test('finish ignores poisoned global Git hook configuration', () => {
    const fixture = createFixture();
    const agentHome = path.join(fixture.root, 'agent-home');
    fs.mkdirSync(agentHome);
    const brokerRan = path.join(fixture.root, 'broker-ran');
    const previousHome = process.env.HOME;
    process.env.HOME = agentHome;
    try {
      const lease = createManagedWorktree({
        name: 'poisoned-global-config',
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
      });
      fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'safe candidate\n');
      const hookRoot = path.join(lease.worktreePath, 'poison-hooks');
      fs.mkdirSync(hookRoot);
      fs.writeFileSync(
        path.join(hookRoot, 'post-receive'),
        `#!/bin/sh\nprintf broker-ran > ${JSON.stringify(brokerRan)}\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(agentHome, '.gitconfig'),
        `[core]\n\thooksPath = ${hookRoot}\n`,
      );
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: ignore poisoned broker config',
      });
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
    expect(fs.existsSync(brokerRan)).toBe(false);
  });

  test('finish preserves a source ignored file that collides with the candidate tree', () => {
    const fixture = createFixture();
    const lease = createManagedWorktree({
      name: 'source-ignored-collision',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    const sourceCollision = path.join(fixture.repo, 'collision.log');
    fs.writeFileSync(sourceCollision, 'source-private\n');
    fs.writeFileSync(path.join(lease.worktreePath, '.gitignore'), '*.log\n!collision.log\n');
    fs.writeFileSync(path.join(lease.worktreePath, 'collision.log'), 'managed-version\n');

    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: reject source ignored collision',
      }),
    ).toThrow(/ignored|collision/i);
    expect(fs.readFileSync(sourceCollision, 'utf8')).toBe('source-private\n');
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
  });

  test('finish fails closed and preserves the worktree for unsafe source or ignored content', () => {
    for (const scenario of ['moved', 'dirty', 'ignored'] as const) {
      const fixture = createFixture();
      const lease = createManagedWorktree({
        name: `unsafe-${scenario}`,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
      });
      fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), `${scenario}\n`);

      if (scenario === 'moved') {
        fs.writeFileSync(path.join(fixture.repo, 'source.txt'), 'moved\n');
        gitOk(fixture.repo, ['add', 'source.txt']);
        gitOk(fixture.repo, ['commit', '-m', 'move source branch']);
      } else if (scenario === 'dirty') {
        fs.writeFileSync(path.join(fixture.repo, 'source-dirty.txt'), 'dirty\n');
      } else {
        fs.writeFileSync(path.join(lease.worktreePath, 'ignored.log'), 'must not disappear\n');
      }

      expect(() =>
        finishManagedWorktree({
          name: lease.name,
          repoRoot: fixture.repo,
          stateRoot: fixture.state,
          message: `test: ${scenario}`,
        }),
      ).toThrow();
      expect(fs.existsSync(lease.worktreePath)).toBe(true);
      expect(fs.readFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'utf8')).toBe(`${scenario}\n`);
    }
  });

  test('finish validates the manifest and preserves work on integration failure', () => {
    const fixture = createFixture();
    const lease = createManagedWorktree({
      name: 'invalid-and-failure',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'preserved\n');
    fs.writeFileSync(path.join(fixture.repo, '.git', 'index.lock'), 'busy\n');

    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: blocked integration',
      }),
    ).toThrow(/lock|safe|integration/i);
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    expect(fs.readFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'utf8')).toBe('preserved\n');

    fs.rmSync(path.join(fixture.repo, '.git', 'index.lock'));
    const tampered = JSON.parse(fs.readFileSync(lease.manifestPath, 'utf8')) as ManagedWorktreeLease;
    tampered.sourceBranch = 'refs/heads/not-the-source';
    fs.writeFileSync(lease.manifestPath, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 });
    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: reject tampered lease',
      }),
    ).toThrow(/manifest|branch|valid/i);
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
  });

  test('receive failure leaves no candidate objects and can be retried safely', () => {
    const fixture = createFixture();
    const hook = path.join(fixture.repo, '.git/hooks/pre-receive');
    gitOk(fixture.repo, ['config', 'core.hooksPath', path.dirname(hook)]);
    const lease = createManagedWorktree({
      name: 'receive-failure',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'preserved after receive failure\n');
    const objectsBefore = git(fixture.repo, ['count-objects', '-v']).stdout;
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: quarantined receive failure',
      }),
    ).toThrow(/integration failed/i);
    expect(git(fixture.repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(lease.baseCommit);
    expect(git(fixture.repo, ['count-objects', '-v']).stdout).toBe(objectsBefore);
    expect(fs.existsSync(path.join(lease.scratchPath, 'objects'))).toBe(false);
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    const failedLease = JSON.parse(fs.readFileSync(lease.manifestPath, 'utf8')) as ManagedWorktreeLease;
    expect(failedLease.preparedCommit).toBeUndefined();

    fs.rmSync(hook);
    const retry = finishManagedWorktree({
      name: lease.name,
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      message: 'test: retry quarantined commit',
    });
    expect(git(fixture.repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(retry.commit);
    expect(fs.existsSync(lease.worktreePath)).toBe(false);
  });

  test('finish reaps a crash-left scratch candidate before rebuilding it', () => {
    const fixture = createFixture();
    const lease = createManagedWorktree({
      name: 'prepared-crash-recovery',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'recover candidate\n');
    const stale = prepareManagedCommit(
      lease,
      'test: stale candidate',
      createGitExecutionContext({
        executable: lease.broker.gitExecutable,
        scratchPath: lease.scratchPath,
        hookRoot: lease.broker.hookRoot,
        identity: {
          name: lease.broker.authorName,
          email: lease.broker.authorEmail,
        },
      }),
    );
    writeLease({ ...lease, preparedCommit: stale.commit, preparedTree: stale.tree });
    expect(fs.existsSync(stale.objectDirectory)).toBe(true);

    const result = finishManagedWorktree({
      name: lease.name,
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
      message: 'test: rebuilt candidate',
    });
    expect(git(fixture.repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(result.commit);
    expect(fs.existsSync(lease.scratchPath)).toBe(false);
  });

  test('finish rejects dirty submodule worktrees instead of discarding nested changes', () => {
    const fixture = createFixture();
    const submodule = path.join(fixture.root, 'submodule-source');
    fs.mkdirSync(submodule);
    gitOk(submodule, ['init', '-b', 'main']);
    gitOk(submodule, ['config', 'user.name', 'Goldband Test']);
    gitOk(submodule, ['config', 'user.email', 'goldband@example.invalid']);
    fs.writeFileSync(path.join(submodule, 'nested.txt'), 'nested base\n');
    gitOk(submodule, ['add', 'nested.txt']);
    gitOk(submodule, ['commit', '-m', 'nested initial']);
    gitOk(fixture.repo, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      submodule,
      'modules/example',
    ]);
    gitOk(fixture.repo, ['commit', '-am', 'add submodule']);

    const lease = createManagedWorktree({
      name: 'dirty-submodule',
      repoRoot: fixture.repo,
      stateRoot: fixture.state,
    });
    gitOk(lease.worktreePath, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'update',
      '--init',
    ]);
    fs.writeFileSync(path.join(lease.worktreePath, 'tracked.txt'), 'parent change\n');
    fs.writeFileSync(
      path.join(lease.worktreePath, 'modules/example/untracked.txt'),
      'nested work must survive\n',
    );

    expect(() =>
      finishManagedWorktree({
        name: lease.name,
        repoRoot: fixture.repo,
        stateRoot: fixture.state,
        message: 'test: reject dirty submodule',
      }),
    ).toThrow(/submodule/i);
    expect(fs.existsSync(lease.worktreePath)).toBe(true);
    expect(
      fs.readFileSync(path.join(lease.worktreePath, 'modules/example/untracked.txt'), 'utf8'),
    ).toBe('nested work must survive\n');
  });
});

function createFixture(): { root: string; repo: string; state: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-managed-worktree-'));
  fixtures.push(root);
  const repo = path.join(root, 'repo');
  const state = path.join(root, 'state');
  fs.mkdirSync(repo);
  gitOk(repo, ['init', '-b', 'main']);
  gitOk(repo, ['config', 'user.name', 'Goldband Test']);
  gitOk(repo, ['config', 'user.email', 'goldband@example.invalid']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'delete-me.txt'), 'remove during finish\n');
  gitOk(repo, ['add', '.gitignore', 'tracked.txt', 'delete-me.txt']);
  gitOk(repo, ['commit', '-m', 'initial']);
  return { root, repo, state };
}

function workMapInput(): WorkMapCreateInput {
  return {
    mode: 'bounded',
    destination: 'Integrate a verified managed candidate',
    scope: { included: ['ticket-a'], excluded: ['external tracker'] },
    decisions: [],
    fog: [],
    tickets: [
      {
        id: 'ticket-a',
        title: 'Implement the managed candidate',
        delivers: 'An integrated verified commit',
        blockedBy: [],
        acceptanceCriteria: ['The source branch contains the candidate'],
        verificationMode: 'existing-tests',
        verificationCommand: [process.execPath, '-e', 'process.exit(0)'],
        testSeams: ['managed-worktree integration'],
        status: 'ready',
      },
    ],
  };
}

function metadataSnapshot(lease: ManagedWorktreeLease): Record<string, string> {
  return {
    head: git(lease.worktreePath, ['rev-parse', 'HEAD']).stdout.trim(),
    refs: git(lease.repoRoot, ['for-each-ref', '--format=%(refname):%(objectname)']).stdout,
    index: hashFile(path.join(lease.worktreeGitDir, 'index')),
    commonHead: hashFile(path.join(lease.commonGitDir, 'HEAD')),
  };
}

function hashFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '<missing>';
  return Bun.hash(fs.readFileSync(filePath)).toString(16);
}

function git(
  cwd: string,
  args: string[],
  tolerateFailure = false,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (!tolerateFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result as ReturnType<typeof spawnSync> & { stdout: string; stderr: string };
}

function gitOk(cwd: string, args: string[]): void {
  git(cwd, args);
}

function hostForbidsNestedBoundary(): boolean {
  if (process.platform === 'darwin') {
    const result = spawnSync(
      '/usr/bin/sandbox-exec',
      ['-p', '(version 1) (allow default)', '--', '/usr/bin/true'],
      { encoding: 'utf8' },
    );
    return (
      result.status === 71 ||
      /sandbox_apply|operation not permitted.*sandbox/i.test(`${result.stderr}${result.stdout}`)
    );
  }
  if (process.platform === 'linux') {
    const bwrap = Bun.which('bwrap');
    if (!bwrap) return true;
    const result = spawnSync(
      bwrap,
      ['--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc', '/usr/bin/true'],
      { encoding: 'utf8' },
    );
    return result.status !== 0;
  }
  return true;
}
