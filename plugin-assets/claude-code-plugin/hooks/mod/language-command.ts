import type { CommandRunResult, EngineInterface } from 'claude-code';

import { languageHelperPath } from './install-paths';

// The plugin install's /goldband-language; installer installs keep
// commands/goldband-language.md. Same options and messages, but it reads the
// current value before asking, as its installation check: the question itself
// stays bilingual and never depends on that value. The helper owns locating
// the Goldband Loop config binary, normalizing aliases, and verifying writes.

const SUPPORTED =
  '支援的選項 / Supported values: zh-TW (zh, tw, 中文, 繁中), en (english, 英文)';
const CONFIG_MISSING =
  'Goldband Loop 尚未安裝 / Goldband Loop is not installed. 請先執行 / Run `./install.sh workflow-auto` 或 / or `./install.sh all-with-workflow`.';
const HELPER_MISSING =
  'goldband language helper 尚未安裝 / is not installed. 請重裝或更新 / Reinstall or update the `goldband@goldband` plugin.';
const NEEDS_ARGUMENT = `沒有人可以回答提問，請帶參數 / Nobody can answer a question here; pass a language. ${SUPPORTED}`;

// Exit codes set-goldband-language.sh reserves.
const HELPER_EXIT_TEXT: Record<number, string> = {
  2: SUPPORTED,
  3: CONFIG_MISSING,
};

type HelperResult =
  | { ok: true; value: string }
  | { ok: false; text: string; exitCode: number };

async function runHelper(
  $: EngineInterface,
  args: readonly string[],
): Promise<HelperResult> {
  const helper = languageHelperPath($);
  if (!(await $.fs.exists(helper))) {
    return { ok: false, text: HELPER_MISSING, exitCode: 1 };
  }
  const result = await $.process.run(['bash', helper, ...args]);
  if (result.exitCode !== 0) {
    const detail =
      HELPER_EXIT_TEXT[result.exitCode] ??
      (result.stderr.trim() || `exit ${result.exitCode}`);
    return { ok: false, text: detail, exitCode: 1 };
  }
  return { ok: true, value: result.stdout.trim() };
}

function successText(previous: string, next: string) {
  return next === 'zh-TW'
    ? `Goldband 語言：目前值 ${previous} / 新值 ${next}。若當前 session 還在吃舊狀態，重開 Claude Code / Codex 一次。`
    : `Goldband language: current ${previous} / new ${next}. If this session still uses the old setting, restart Claude Code / Codex once.`;
}

function failed(result: Extract<HelperResult, { ok: false }>, prefix = '') {
  return { text: `${prefix}${result.text}`, exitCode: result.exitCode };
}

// The requested language as typed; the helper normalizes or rejects it.
async function chooseLanguage(
  $: EngineInterface,
  requested: string,
  canAsk: boolean,
): Promise<string | CommandRunResult> {
  if (requested) return requested;
  if (!canAsk) return { text: NEEDS_ARGUMENT, exitCode: 1 };
  try {
    const answer = await $.ui.ask('要切換到哪個語言？ / Which language?', {
      options: ['zh-TW', 'en'],
      header: 'Language',
    });
    return answer.trim();
  } catch (error) {
    // The host rejects alike for a dismissal and for a question it could not
    // show, so the reason goes to the debug log and nothing counts as done.
    $.ui.log(`goldband-language: question rejected: ${String(error)}`, {
      to: 'debug',
    });
    return {
      text: '沒有選擇語言，設定未變更 / No language chosen; nothing changed.',
      exitCode: 1,
    };
  }
}

export async function runLanguageCommand(
  $: EngineInterface,
  args: string,
  canAsk: boolean,
): Promise<CommandRunResult> {
  // The current value doubles as the installation check, before any question.
  const previous = await runHelper($, ['get']);
  if (!previous.ok) {
    return failed(
      previous,
      '讀取目前語言失敗 / Reading the current language failed: ',
    );
  }

  const target = await chooseLanguage($, args.trim(), canAsk);
  if (typeof target !== 'string') return target;

  // `set` prints the value it read back, and fails when it differs.
  const set = await runHelper($, ['set', target]);
  if (!set.ok) return failed(set, '切換失敗 / Switching failed: ');
  return { text: successText(previous.value, set.value) };
}
