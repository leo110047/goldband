import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT_PATH = path.resolve(import.meta.dir, '..', '..', '..', 'hooks', 'scripts', 'hooks', 'skill-activation-suggestions.js');

function runSuggestionHook(input: object, pluginDataDir: string) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: JSON.stringify(input),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginDataDir
    }
  });

  const raw = result.stdout.toString().trim();
  return raw ? JSON.parse(raw) : {};
}

describe('skill-activation-suggestions hook', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  test('injects claim verification baseline once even when no skill matches', () => {
    const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-claim-baseline-'));
    tempDirs.push(pluginDataDir);

    const first = runSuggestionHook({
      prompt: 'hello there',
      session_id: 'baseline-session'
    }, pluginDataDir);

    expect(first.hookSpecificOutput.additionalContext).toContain('Claim verification baseline:');
    expect(first.hookSpecificOutput.additionalContext).not.toContain('Relevant skills for this prompt:');

    const second = runSuggestionHook({
      prompt: 'hello there',
      session_id: 'baseline-session'
    }, pluginDataDir);

    expect(second).toEqual({});
  });

  test('still emits skill suggestions after baseline was already shown', () => {
    const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-claim-suggestions-'));
    tempDirs.push(pluginDataDir);

    runSuggestionHook({
      prompt: 'hello there',
      session_id: 'suggestion-session'
    }, pluginDataDir);

    const output = runSuggestionHook({
      prompt: 'Please review this PR',
      session_id: 'suggestion-session'
    }, pluginDataDir);

    expect(output.hookSpecificOutput.additionalContext).toContain('Relevant skills for this prompt:');
    expect(output.hookSpecificOutput.additionalContext).toContain('code-review-skill');
  });
});
