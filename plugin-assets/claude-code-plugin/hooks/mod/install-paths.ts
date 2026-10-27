import type { EngineInterface } from 'claude-code';

// The one place the mod locates installed goldband files. Child processes the
// mod starts do not receive CLAUDE_PLUGIN_DATA, so the plugin data directory
// is derived the way Claude Code names it: <config>/plugins/data/<id> with the
// plugin id `<name>@<marketplace>` and every character outside [A-Za-z0-9_-]
// replaced by `-`. A plugin root `claude plugin list` does not show (as under
// --plugin-dir) is an error, so status reads unavailable rather than reading
// another directory.

// The host could not answer; a later lookup may succeed.
class PluginListUnavailable extends Error {}

type InstalledPlugin = {
  id?: unknown;
  enabled?: unknown;
  installPath?: unknown;
  readFromFolder?: unknown;
};

function withoutTrailingSlash(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : value;
}

async function configDir($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR');
  if (configured) return configured;
  const home = await $.env.get('HOME');
  if (!home) throw new Error('HOME is not set');
  return `${home}/.claude`;
}

async function listPlugins($: EngineInterface): Promise<InstalledPlugin[]> {
  let listed: Awaited<ReturnType<EngineInterface['process']['run']>>;
  try {
    listed = await $.process.run(['claude', 'plugin', 'list', '--json']);
  } catch (error) {
    throw new PluginListUnavailable(`claude plugin list: ${String(error)}`);
  }
  if (listed.exitCode !== 0) {
    throw new PluginListUnavailable(
      `claude plugin list exited ${listed.exitCode}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(listed.stdout);
  } catch {
    throw new PluginListUnavailable('claude plugin list printed invalid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new PluginListUnavailable('claude plugin list printed no list');
  }
  return parsed.filter(
    (entry): entry is InstalledPlugin =>
      typeof entry === 'object' && entry !== null,
  );
}

async function pluginId($: EngineInterface): Promise<string> {
  const plugins = await listPlugins($);
  const root = withoutTrailingSlash($.plugin.root);
  const ids = new Set(
    plugins
      .filter(
        (plugin) =>
          plugin.enabled === true &&
          (withoutTrailingSlash(plugin.readFromFolder) === root ||
            withoutTrailingSlash(plugin.installPath) === root),
      )
      .map((plugin) => String(plugin.id)),
  );
  if (ids.size !== 1) {
    throw new Error(
      ids.size === 0
        ? `no enabled installed plugin is read from ${root}`
        : `plugin root matches ${[...ids].join(', ')}`,
    );
  }
  return [...ids][0] as string;
}

let pluginDataDir: Promise<string> | undefined;

/**
 * The CLAUDE_PLUGIN_DATA value the plugin's command hooks receive. Kept for
 * the module's life, a root no entry matches included; only a host that could
 * not answer is asked again.
 */
export function resolvePluginDataDir($: EngineInterface): Promise<string> {
  if (pluginDataDir) return pluginDataDir;
  const lookup = (async () => {
    const id = (await pluginId($)).replace(/[^A-Za-z0-9_-]/g, '-');
    return `${await configDir($)}/plugins/data/${id}`;
  })();
  pluginDataDir = lookup;
  lookup.catch((error) => {
    if (error instanceof PluginListUnavailable && pluginDataDir === lookup) {
      pluginDataDir = undefined;
    }
  });
  return lookup;
}

export function statusScriptPath($: EngineInterface): string {
  return `${$.plugin.root}/hooks/scripts/tools/goldband-status.js`;
}

/** The language helper the plugin ships beside the mod. */
export function languageHelperPath($: EngineInterface): string {
  return `${$.plugin.root}/commands/scripts/set-goldband-language.sh`;
}
