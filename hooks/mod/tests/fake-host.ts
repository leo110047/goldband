import type { On, ProcessRunResult } from 'claude-code';

// Stands for the engine beneath the mod: the host's files, environment and
// child processes, answered from memory.

export const HOME = '/home/tester';
// `claude plugin test` loads tests as ES modules; the engine types leave
// import.meta out because hooks modules never need it.
declare global {
  interface ImportMeta {
    readonly url: string;
  }
}

// This file sits at <plugin root>/hooks/mod/tests/.
export const PLUGIN_ROOT = new URL(
  '../../..',
  import.meta.url,
).pathname.replace(/\/$/, '');
export const PLUGIN_HELPER = `${PLUGIN_ROOT}/commands/scripts/set-goldband-language.sh`;
export const DATA_DIR = `${HOME}/.claude/plugins/data/goldband-goldband`;
export const PLUGIN_LIST = JSON.stringify([
  { id: 'other@market', enabled: true, installPath: '/elsewhere' },
  { id: 'goldband@goldband', enabled: true, readFromFolder: `${PLUGIN_ROOT}/` },
]);

export type Run = { argv: readonly string[]; env: Record<string, string> };

type Fake = {
  sessionId: string;
  hasPluginHelper: boolean;
  refusesCommand: boolean;
  runs: Run[];
  statuses: (string | undefined)[];
  respond: (argv: readonly string[]) => ProcessRunResult;
  waitForStatus: (count: number) => Promise<void>;
};

export function ok(stdout: string): ProcessRunResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  };
}

export function failure(exitCode: number, stderr: string): ProcessRunResult {
  return { ...ok(''), exitCode, stderr };
}

export function fakeHost(on: On): Fake {
  const waiters: { count: number; resolve: () => void }[] = [];
  const fake: Fake = {
    sessionId: 'session-1',
    hasPluginHelper: true,
    refusesCommand: false,
    runs: [],
    statuses: [],
    respond: (argv) => ok(argv[0] === 'claude' ? PLUGIN_LIST : '{}'),
    waitForStatus: (count) =>
      fake.statuses.length >= count
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ count, resolve })),
  };

  on('command.register', (_, e) => {
    if (fake.refusesCommand) throw new Error(`/${e.name} refused`);
    return { value: { command: e.name } };
  });
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('session.end', (_, e) => ({ sessionId: e.sessionId }));
  on('session.id', () => ({ value: fake.sessionId }));
  on('session.cwd', () => ({ value: '/work' }));
  on('turn.complete', (_, e) => ({ text: e.answer }));
  on('classic.SessionStart', () => ({}));
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }));
  on('fs.exists', (_, e) => ({
    value: fake.hasPluginHelper && e.path === PLUGIN_HELPER,
  }));
  on('ui.log', () => ({ value: undefined }));
  on('ui.status', (_, e) => {
    fake.statuses.push(e.text);
    for (const waiter of waiters.filter(
      (w) => fake.statuses.length >= w.count,
    )) {
      waiter.resolve();
    }
    return { value: undefined };
  });
  on('process.run', (_, e) => {
    fake.runs.push({ argv: e.argv, env: e.init?.env ?? {} });
    return { value: fake.respond(e.argv) };
  });
  return fake;
}

/** Answers `claude plugin list` as the host does; `answer` handles the rest. */
export function withPluginList(
  answer: (argv: readonly string[]) => ProcessRunResult,
) {
  return (argv: readonly string[]) =>
    argv[0] === 'claude' ? ok(PLUGIN_LIST) : answer(argv);
}

export function commandRun(args: string) {
  return {
    command: 'goldband-language',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as const;
}

export function sessionStart() {
  return { cwd: '/work', surface: 'terminal', isInteractive: true } as const;
}

export function mainTurn(agentId?: string) {
  return {
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    ...(agentId ? { agentId } : {}),
  } as const;
}
