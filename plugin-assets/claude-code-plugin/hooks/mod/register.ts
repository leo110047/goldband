import type { Register } from 'claude-code';

import { runLanguageCommand } from './language-command';
import { clearStatusLine, refreshStatusLine } from './status-line';

// Claude-only adapter: shows the state goldband hooks enforce and serves
// /goldband-language without a model turn. It holds no policy and writes no
// state; the hooks and their owners stay the source of truth.
export const register: Register = (on) => {
  // Whether someone sees the status line and can answer `$.ui.ask`;
  // `claude -p` has nobody, so it spends no process on either.
  let interactive = false;

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive;
    // A refused command must not stop the session or its status line.
    await $.command
      .register({
        name: 'goldband-language',
        description: '切換或查詢 Goldband Loop 的提問與說明語言。',
        argumentHint: '[zh-TW|en]',
      })
      .catch((error: unknown) => {
        $.ui.log(`goldband-language not registered: ${String(error)}`, {
          to: 'debug',
        });
      });
    const started = await next(e);
    if (interactive) refreshStatusLine($, await $.session.id());
    return started;
  });

  on('session.end', async ($, e, next) => {
    clearStatusLine($);
    return next(e);
  });

  // /clear and /resume start a new session id without a new session.start.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e);
    if (interactive && e.source !== 'startup') {
      refreshStatusLine($, e.session_id);
    }
    return result;
  }).catch(($, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (interactive && e.agentId === undefined) {
      refreshStatusLine($, await $.session.id());
    }
    return result;
  });

  on('command.run', { command: 'goldband-language' }, ($, e) =>
    runLanguageCommand($, e.args, interactive),
  );
};
