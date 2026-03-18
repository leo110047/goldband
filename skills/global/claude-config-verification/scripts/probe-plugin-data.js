#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  return {
    json: argv.includes('--json')
  };
}

function resolveBaseDir() {
  const pluginDataDir = typeof process.env.CLAUDE_PLUGIN_DATA === 'string'
    ? process.env.CLAUDE_PLUGIN_DATA.trim()
    : '';

  if (pluginDataDir.length > 0) {
    return {
      source: 'CLAUDE_PLUGIN_DATA',
      envPresent: true,
      baseDir: path.join(pluginDataDir, 'claude-config-verification')
    };
  }

  return {
    source: 'temp-fallback',
    envPresent: false,
    baseDir: path.join(os.tmpdir(), 'claude-config-verification')
  };
}

function runProbe() {
  const resolved = resolveBaseDir();
  const probeFile = path.join(resolved.baseDir, `probe-${process.pid}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    source: resolved.source
  };

  try {
    fs.mkdirSync(resolved.baseDir, { recursive: true });
    fs.writeFileSync(probeFile, JSON.stringify(payload), 'utf8');
    const raw = fs.readFileSync(probeFile, 'utf8');
    const parsed = JSON.parse(raw);
    fs.unlinkSync(probeFile);

    return {
      ok: parsed.source === resolved.source,
      writable: true,
      readable: true,
      source: resolved.source,
      envPresent: resolved.envPresent,
      baseDir: resolved.baseDir,
      fallbackUsed: !resolved.envPresent
    };
  } catch (error) {
    return {
      ok: false,
      writable: false,
      readable: false,
      source: resolved.source,
      envPresent: resolved.envPresent,
      baseDir: resolved.baseDir,
      fallbackUsed: !resolved.envPresent,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function printHuman(result) {
  console.log('Claude Plugin Data Probe');
  console.log('========================');
  console.log(`Status:      ${result.ok ? 'OK' : 'FAIL'}`);
  console.log(`Source:      ${result.source}`);
  console.log(`Env Present: ${result.envPresent ? 'yes' : 'no'}`);
  console.log(`Fallback:    ${result.fallbackUsed ? 'yes' : 'no'}`);
  console.log(`Base Dir:    ${result.baseDir}`);
  if (result.error) {
    console.log(`Error:       ${result.error}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const result = runProbe();

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
