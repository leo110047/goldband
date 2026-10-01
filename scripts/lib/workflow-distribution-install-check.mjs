import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  declaredDispatchContract,
  inspectDistribution,
} from './workflow-distribution-contract.mjs';

export function assertInstalledWorkflowDistribution(home, loopDir) {
  const runtimeRoot = path.join(home, '.codex', 'goldband', 'workflow-runtime');
  const markerFile = path.join(
    home,
    '.codex',
    'skills',
    'goldband',
    '.workflow-launcher.json',
  );
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  const result = inspectDistribution(runtimeRoot, loopDir, [
    { role: 'workflow-launcher-marker', path: markerFile },
    { role: 'codex-execpolicy-rule', path: marker.ruleFile },
  ]);
  assert.equal(result.ok, true, result.detail ?? result.status);
  const entry = path.join(runtimeRoot, 'bin', 'goldband');
  assert.ok(
    fs.statSync(entry).mode & 0o111,
    'installed review entrypoint must be executable',
  );
  const help = spawnSync(entry, ['review', 'code', '--help'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(help.status, 0, `installed review help failed: ${help.stderr}`);
  assert.match(help.stdout, /resolved automatically/);
  const dispatch = declaredDispatchContract(loopDir);
  for (const action of dispatch.trustedLauncher) {
    const probe = spawnSync(
      marker.argvPrefix[0],
      [marker.argvPrefix[1], '--contract-probe', action],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(
      probe.status,
      0,
      `trusted launcher probe failed: ${action}: ${probe.stderr}`,
    );
    assert.equal(JSON.parse(probe.stdout).action, action);
  }
  for (const action of dispatch.registeredOnly) {
    const [capability, name] = action.split('/');
    const probe = spawnSync(
      marker.argvPrefix[0],
      [marker.argvPrefix[1], capability, name, '--host', 'codex'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(
      probe.status,
      2,
      `registered-only action became executable: ${action}`,
    );
  }
}
