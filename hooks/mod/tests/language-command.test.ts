import type { Engine } from 'claude-code/testing';
import { expect, test } from 'claude-code/testing';

import {
  commandRun,
  failure,
  fakeHost,
  ok,
  PLUGIN_HELPER,
  sessionStart,
  withPluginList,
} from './fake-host';

type Host = ReturnType<typeof fakeHost>;

function helperRuns(host: Host) {
  return host.runs.filter((run) => run.argv[0] === 'bash');
}

function setRuns(host: Host) {
  return helperRuns(host).filter((run) => run.argv[2] === 'set');
}

// A language helper over an in-memory config value. It accepts only the
// canonical names; scripts/test-goldband-language-helper.mjs covers aliases.
function installHelper(host: Host, initial = 'zh-TW') {
  let value = initial;
  host.respond = withPluginList((argv) => {
    if (argv[2] === 'set') {
      const requested = String(argv[3]);
      if (requested !== 'zh-TW' && requested !== 'en') {
        return failure(2, `unsupported language: ${requested}`);
      }
      value = requested;
    }
    return ok(`${value}\n`);
  });
}

async function start($: Engine, host: Host) {
  await $.session.start(sessionStart());
  await host.waitForStatus(1);
}

test('switching reports the current and read-back values', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host, 'zh-TW');
  await start($, host);

  const toEnglish = await $.command.run(commandRun('en'));
  expect(toEnglish.text).toBe(
    'Goldband language: current zh-TW / new en. If this session still uses the old setting, restart Claude Code / Codex once.',
  );
  const toChinese = await $.command.run(commandRun('zh-TW'));
  expect(toChinese.text).toContain('目前值 en / 新值 zh-TW');
  expect(helperRuns(host).map((run) => run.argv.slice(1).join(' '))).toEqual([
    `${PLUGIN_HELPER} get`,
    `${PLUGIN_HELPER} set en`,
    `${PLUGIN_HELPER} get`,
    `${PLUGIN_HELPER} set zh-TW`,
  ]);
});

test('the argument reaches the helper as typed', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList((argv) =>
    ok(argv[2] === 'set' ? 'en\n' : 'zh-TW\n'),
  );
  await start($, host);

  const result = await $.command.run(commandRun(' 英文 '));

  expect(setRuns(host).map((run) => run.argv[3])).toEqual(['英文']);
  expect(result.text).toContain('current zh-TW / new en');
});

test('an unsupported value lists the options and never sets', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host);
  await start($, host);

  const result = await $.command.run(commandRun('fr'));

  expect(result.text).toContain(
    'zh-TW (zh, tw, 中文, 繁中), en (english, 英文)',
  );
  expect(result.exitCode).toBe(1);
  expect(result.text).not.toContain('new');
});

test('no argument asks first, then sets the choice', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host);
  const asked: string[] = [];
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asked.push(JSON.stringify(e));
    expect(setRuns(host)).toHaveLength(0);
    return { result: { answers: { [e.questions[0]?.question ?? '']: 'en' } } };
  });
  await start($, host);

  const result = await $.command.run(commandRun(''));

  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('zh-TW');
  expect(setRuns(host).map((run) => run.argv[3])).toEqual(['en']);
  expect(result.text).toContain('new en');
});

test('no argument without anyone to ask fails before asking', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host);
  let asked = 0;
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    asked += 1;
    return { deny: 'unexpected' };
  });
  await $.session.start({ ...sessionStart(), isInteractive: false });

  const result = await $.command.run(commandRun(''));

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain('pass a language');
  expect(asked).toBe(0);
  expect(setRuns(host)).toHaveLength(0);
});

test('a dismissed question changes nothing', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host);
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ deny: 'dismissed' }));
  await start($, host);

  const result = await $.command.run(commandRun(''));

  expect(result.text).toContain('nothing changed');
  expect(result.exitCode).toBe(1);
  expect(setRuns(host)).toHaveLength(0);
});

test('a missing Goldband Loop gives the install hint before asking', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() => failure(3, 'goldband-config not found'));
  let asked = 0;
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    asked += 1;
    return { deny: 'unexpected' };
  });
  await start($, host);

  const result = await $.command.run(commandRun(''));

  expect(result.text).toContain('./install.sh workflow-auto');
  expect(result.exitCode).toBe(1);
  expect(asked).toBe(0);
  expect(setRuns(host)).toHaveLength(0);
});

test('a missing helper says to reinstall the plugin', async ($, on) => {
  const host = fakeHost(on);
  installHelper(host);
  host.hasPluginHelper = false;
  await start($, host);

  const result = await $.command.run(commandRun('en'));

  expect(result.text).toContain('`goldband@goldband` plugin');
  expect(result.exitCode).toBe(1);
  expect(helperRuns(host)).toHaveLength(0);
});

test('a failed read of the current value never sets', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList(() =>
    failure(1, 'failed to read goldband_language'),
  );
  await start($, host);

  const result = await $.command.run(commandRun('en'));

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain('failed to read goldband_language');
  expect(setRuns(host)).toHaveLength(0);
});

test('a failed set relays the helper error and never claims success', async ($, on) => {
  const host = fakeHost(on);
  host.respond = withPluginList((argv) =>
    argv[2] === 'set'
      ? failure(1, 'goldband_language readback is zh-TW, expected en')
      : ok('zh-TW\n'),
  );
  await start($, host);

  const result = await $.command.run(commandRun('en'));

  expect(result.exitCode).toBe(1);
  expect(result.text).toContain('readback is zh-TW, expected en');
  expect(result.text).not.toContain('new en');
  expect(setRuns(host)).toHaveLength(1);
});
