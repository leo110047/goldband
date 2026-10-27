import { expect, test } from 'claude-code/testing';

import {
  DATA_DIR,
  failure,
  fakeHost,
  mainTurn,
  ok,
  type Run,
  sessionStart,
  withPluginList,
} from './fake-host';

type Source = Record<string, unknown>;

function statusJson(sources: Source[]): string {
  return JSON.stringify({ sessionId: 'session-1', sources });
}

const IDLE: Source[] = [
  { name: 'careful-mode', available: true, active: false },
  { name: 'freeze-mode', available: true, active: false },
  { name: 'cross-review', available: true, active: false },
];

function withSources(overrides: Record<string, Source>): Source[] {
  return IDLE.map((source) => ({
    ...source,
    ...overrides[String(source.name)],
  }));
}

function statusRuns(runs: Run[]) {
  return runs.filter((run) => run.argv[0] === 'node');
}

test('nothing on shows no line', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() => ok(statusJson(IDLE)));

  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  expect(host.statuses).toEqual([undefined]);
});

test('a refused command registration still starts the session and its line', async ($, on) => {
  const host = fakeHost(on);
  host.refusesCommand = true;
  host.respond = withPluginList(() =>
    ok(statusJson(withSources({ 'careful-mode': { active: true } }))),
  );

  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  expect(host.statuses).toEqual(['careful']);
});

test('the status script runs with the hooks data directory and session', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() => ok(statusJson(IDLE)));

  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  const [run] = statusRuns(host.runs);
  expect(run?.argv.slice(-2)).toEqual(['--session', 'session-1']);
  expect(run?.argv[1]).toMatch(/hooks\/scripts\/tools\/goldband-status\.js$/);
  expect(run?.env).toEqual({ CLAUDE_PLUGIN_DATA: DATA_DIR });
});

test('careful and freeze show after a main turn and clear when off', async ($, on) => {
  const host = fakeHost(on);
  let sources = IDLE;
  host.respond = withPluginList(() => ok(statusJson(sources)));
  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  sources = withSources({ 'careful-mode': { active: true } });
  await $.turn.complete(mainTurn());
  await host.waitForStatus(2);
  expect(host.statuses.at(-1)).toBe('careful');

  sources = withSources({
    'careful-mode': { active: true },
    'freeze-mode': { active: true },
  });
  await $.turn.complete(mainTurn());
  await host.waitForStatus(3);
  expect(host.statuses.at(-1)).toBe('careful · freeze');

  sources = IDLE;
  await $.turn.complete(mainTurn());
  await host.waitForStatus(4);
  expect(host.statuses.at(-1)).toBeUndefined();
});

test('cross-review shows while a review contract is active', async ($, on) => {
  const host = fakeHost(on);
  const sources = withSources({ 'cross-review': { active: true } });
  host.respond = withPluginList(() => ok(statusJson(sources)));

  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  expect(host.statuses).toEqual(['cross-review']);
});

test('a source that cannot answer shows unavailable, never inactive', async ($, on) => {
  const host = fakeHost(on);
  const corrupt = { available: false, reason: 'not valid JSON' };
  const sources = withSources({
    'careful-mode': corrupt,
    'freeze-mode': corrupt,
  });
  host.respond = withPluginList(() => ok(statusJson(sources)));

  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  expect(host.statuses).toEqual([
    'careful-mode, freeze-mode status unavailable',
  ]);
});

for (const [label, answer] of [
  ['exits non-zero', failure(1, 'boom')],
  ['prints invalid JSON', ok('{not json')],
  ['prints no sources', ok('{}')],
] as const) {
  test(`a status script that ${label} shows every source unavailable`, async ($, on) => {
    const host = fakeHost(on);
    host.respond = withPluginList(() => answer);

    await $.session.start(sessionStart());
    await host.waitForStatus(1);

    expect(host.statuses).toEqual([
      'careful-mode, freeze-mode, cross-review status unavailable',
    ]);
  });
}

test('a subagent turn does not query the status', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() => ok(statusJson(IDLE)));
  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  await $.turn.complete(mainTurn('agent-7'));
  await $.turn.complete(mainTurn());
  await host.waitForStatus(2);

  expect(statusRuns(host.runs)).toHaveLength(2);
});

test('a non-interactive session never queries the status', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() =>
    ok(statusJson(withSources({ 'careful-mode': { active: true } }))),
  );
  await $.session.start({ ...sessionStart(), isInteractive: false });
  await $.turn.complete(mainTurn());

  expect(host.runs).toEqual([]);
  expect(host.statuses).toEqual([]);
});

test('/clear drops the old line and shows the new session', async ($, on) => {
  const host = fakeHost(on);
  let sources = withSources({ 'careful-mode': { active: true } });
  host.respond = withPluginList(() => ok(statusJson(sources)));
  await $.session.start(sessionStart());
  await host.waitForStatus(1);

  await $.session.end({
    reason: 'clear',
    sessionId: 'session-1',
    resume: { id: '' },
  });
  expect(host.statuses.at(-1)).toBeUndefined();

  sources = IDLE;
  host.sessionId = 'session-2';
  await $.classic.SessionStart({ source: 'clear', session_id: 'session-2' });
  await host.waitForStatus(3);

  expect(statusRuns(host.runs).at(-1)?.argv.at(-1)).toBe('session-2');
  expect(host.statuses).toEqual(['careful', undefined, undefined]);
});

// A root no entry matches stays unmatched; a host that failed is asked again.
for (const [label, listed, lookups] of [
  [
    'lists no plugin read from this root',
    ok(
      '[{"id":"goldband@goldband","enabled":true,"installPath":"/elsewhere"}]',
    ),
    1,
  ],
  ['fails', failure(1, 'not logged in'), 2],
  ['prints invalid JSON', ok('{not json'), 2],
  ['prints no list', ok('{}'), 2],
] as const) {
  test(`a plugin list that ${label} shows every source unavailable`, async ($, on) => {
    const host = fakeHost(on);
    host.respond = (argv) =>
      argv[0] === 'claude' ? listed : ok(statusJson(IDLE));

    await $.session.start(sessionStart());
    await host.waitForStatus(1);
    await $.turn.complete(mainTurn());
    await host.waitForStatus(2);

    expect(statusRuns(host.runs)).toHaveLength(0);
    expect(host.runs.filter((run) => run.argv[0] === 'claude')).toHaveLength(
      lookups,
    );
    const unavailable =
      'careful-mode, freeze-mode, cross-review status unavailable';
    expect(host.statuses).toEqual([unavailable, unavailable]);
  });
}
