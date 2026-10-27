import type { EngineInterface } from 'claude-code';

import { resolvePluginDataDir, statusScriptPath } from './install-paths';

type StatusSource =
  | { name: string; available: true; active: boolean }
  | { name: string; available: false; reason?: string };

const SOURCES = ['careful-mode', 'freeze-mode', 'cross-review'] as const;
const LABELS: Record<string, string> = {
  'careful-mode': 'careful',
  'freeze-mode': 'freeze',
  'cross-review': 'cross-review',
};

/**
 * The status line text, or undefined when nothing is on and every source
 * answered. Claude Code draws it after the plugin name (`goldband: careful`).
 */
function formatStatusLine(
  sources: readonly StatusSource[],
): string | undefined {
  const shown: string[] = [];
  const unavailable: string[] = [];
  for (const name of SOURCES) {
    const source = sources.find((candidate) => candidate.name === name);
    if (!source || !source.available) {
      unavailable.push(name);
    } else if (source.active) {
      shown.push(LABELS[name] ?? name);
    }
  }
  if (unavailable.length > 0) {
    shown.push(`${unavailable.join(', ')} status unavailable`);
  }
  return shown.length > 0 ? shown.join(' · ') : undefined;
}

function parseSources(stdout: string): StatusSource[] {
  const parsed: unknown = JSON.parse(stdout);
  const sources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) throw new Error('status output has no sources');
  return sources as StatusSource[];
}

async function querySources(
  $: EngineInterface,
  sessionId: string,
): Promise<StatusSource[]> {
  const result = await $.process.run(
    ['node', statusScriptPath($), '--session', sessionId],
    { env: { CLAUDE_PLUGIN_DATA: await resolvePluginDataDir($) } },
  );
  if (result.exitCode !== 0) {
    throw new Error(`status script exited ${result.exitCode}`);
  }
  return parseSources(result.stdout);
}

let generation = 0;

async function showStatus(
  $: EngineInterface,
  sessionId: string,
): Promise<void> {
  const current = ++generation;
  let sources: StatusSource[];
  try {
    sources = await querySources($, sessionId);
  } catch (error) {
    $.ui.log(`goldband status failed: ${String(error)}`, { to: 'debug' });
    sources = [];
  }
  if (current === generation) $.ui.status(formatStatusLine(sources));
}

/**
 * Shows the session's state in the background; a failed query shows every
 * source unavailable. Never rejects: hooks start it without waiting.
 */
export function refreshStatusLine($: EngineInterface, sessionId: string): void {
  showStatus($, sessionId).catch(() => {
    // The line is advisory; a host that refuses it leaves nothing to show.
  });
}

/** Drops the shown state and any query still running for the ending session. */
export function clearStatusLine($: EngineInterface): void {
  generation += 1;
  $.ui.status(undefined);
}
