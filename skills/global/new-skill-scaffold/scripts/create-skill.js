#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(SKILL_DIR, 'config.json');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

function fail(message) {
  console.error(`[new-skill-scaffold] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    baseDir: process.cwd(),
    dryRun: false,
    force: false,
    withConfig: null,
    withScript: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--name') {
      options.name = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--description') {
      options.description = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--scope') {
      options.scope = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--root') {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--base-dir') {
      options.baseDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--with-script') {
      options.withScript = true;
      continue;
    }

    if (token === '--without-script') {
      options.withScript = false;
      continue;
    }

    if (token === '--with-config') {
      options.withConfig = true;
      continue;
    }

    if (token === '--without-config') {
      options.withConfig = false;
      continue;
    }

    if (token === '--force') {
      options.force = true;
      continue;
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    fail(`Unknown argument: ${token}`);
  }

  return options;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Failed to read JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('config.json must contain a JSON object');
  }

  if (typeof config.defaultSkillRoot !== 'string' || config.defaultSkillRoot.trim().length === 0) {
    fail('config.json requires a non-empty "defaultSkillRoot"');
  }

  if (!Array.isArray(config.defaultAllowedTools) || config.defaultAllowedTools.some(tool => typeof tool !== 'string' || tool.trim().length === 0)) {
    fail('config.json requires "defaultAllowedTools" as an array of non-empty strings');
  }

  if (typeof config.defaultReferenceDir !== 'string' || config.defaultReferenceDir.trim().length === 0) {
    fail('config.json requires a non-empty "defaultReferenceDir"');
  }

  if (typeof config.defaultScriptFileName !== 'string' || config.defaultScriptFileName.trim().length === 0) {
    fail('config.json requires a non-empty "defaultScriptFileName"');
  }

  if (typeof config.defaultIncludeScriptStub !== 'boolean') {
    fail('config.json requires boolean "defaultIncludeScriptStub"');
  }

  if (typeof config.defaultIncludeConfigStub !== 'boolean') {
    fail('config.json requires boolean "defaultIncludeConfigStub"');
  }

  if (config.rootAliases !== undefined) {
    const aliases = config.rootAliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      fail('config.json "rootAliases" must be an object when provided');
    }

    for (const [alias, value] of Object.entries(aliases)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        fail(`config.json root alias "${alias}" must map to a non-empty string`);
      }
    }
  }

  return config;
}

function validateOptions(options) {
  if (typeof options.name !== 'string' || options.name.trim().length === 0) {
    fail('Missing required argument: --name');
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.name.trim())) {
    fail('Skill name must be kebab-case (lowercase letters, numbers, hyphens)');
  }

  if (typeof options.description !== 'string' || options.description.trim().length === 0) {
    fail('Missing required argument: --description');
  }

  if (typeof options.baseDir !== 'string' || options.baseDir.trim().length === 0) {
    fail('Invalid --base-dir');
  }

  return {
    ...options,
    name: options.name.trim(),
    description: options.description.trim(),
    baseDir: path.resolve(options.baseDir)
  };
}

function titleFromName(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveRoot(options, config) {
  if (typeof options.root === 'string' && options.root.trim().length > 0) {
    return options.root.trim();
  }

  if (typeof options.scope === 'string' && options.scope.trim().length > 0) {
    const alias = options.scope.trim();
    const value = config.rootAliases && config.rootAliases[alias];
    if (!value) {
      fail(`Unknown scope "${alias}". Available aliases: ${Object.keys(config.rootAliases || {}).sort().join(', ') || '(none)'}`);
    }
    return value;
  }

  return config.defaultSkillRoot;
}

function readTemplate(name) {
  const templatePath = path.join(TEMPLATES_DIR, name);
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    fail(`Failed to read template ${templatePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderTemplate(name, variables) {
  const template = readTemplate(name);
  return template.replace(/{{([A-Z0-9_]+)}}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : '';
  });
}

function toYamlList(values) {
  return values.map(value => `  - ${value}`).join('\n');
}

function toBlockScalarValue(value) {
  return String(value)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
}

function buildFilePlan(options, config) {
  const relativeRoot = resolveRoot(options, config);
  const skillDir = path.resolve(options.baseDir, relativeRoot, options.name);
  const includeScript = options.withScript === null ? config.defaultIncludeScriptStub : options.withScript;
  const includeConfig = options.withConfig === null ? config.defaultIncludeConfigStub : options.withConfig;
  const title = titleFromName(options.name);
  const scriptFileName = config.defaultScriptFileName;
  const referenceDir = config.defaultReferenceDir;

  const variables = {
    NAME: options.name,
    TITLE: title,
    DESCRIPTION_BLOCK: toBlockScalarValue(options.description),
    ALLOWED_TOOLS_YAML: toYamlList(config.defaultAllowedTools),
    REFERENCE_DIR: referenceDir,
    SCRIPT_LINE: includeScript ? `- \`scripts/${scriptFileName}\` - replace this stub with real automation once the workflow stabilizes` : '',
    CONFIG_LINE: includeConfig ? '- `config.json` - fill in user- or team-specific defaults before depending on this skill' : ''
  };

  const files = [
    {
      filePath: path.join(skillDir, 'SKILL.md'),
      content: renderTemplate('SKILL.md.template', variables)
    },
    {
      filePath: path.join(skillDir, referenceDir, 'README.md'),
      content: renderTemplate('reference-README.md.template', variables)
    }
  ];

  if (includeScript) {
    files.push({
      filePath: path.join(skillDir, 'scripts', scriptFileName),
      content: renderTemplate('script-stub.js.template', variables)
    });
  }

  if (includeConfig) {
    files.push({
      filePath: path.join(skillDir, 'config.json'),
      content: renderTemplate('generated-config.json.template', variables)
    });
  }

  return {
    skillDir,
    relativeRoot,
    files
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFilePlan(plan, force) {
  for (const file of plan.files) {
    ensureDir(path.dirname(file.filePath));
    fs.writeFileSync(file.filePath, file.content, force ? 'utf8' : { encoding: 'utf8', flag: 'wx' });

    if (file.filePath.includes(`${path.sep}scripts${path.sep}`)) {
      fs.chmodSync(file.filePath, 0o755);
    }
  }
}

function printSummary(plan, dryRun) {
  console.log('New Skill Scaffold');
  console.log('==================');
  console.log(`Mode:       ${dryRun ? 'dry-run' : 'write'}`);
  console.log(`Skill dir:  ${plan.skillDir}`);
  console.log(`Files:      ${plan.files.length}`);
  console.log('');
  for (const file of plan.files) {
    console.log(`- ${file.filePath}`);
  }
}

function main() {
  const options = validateOptions(parseArgs(process.argv));
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`Missing ${CONFIG_PATH}. Ask the user for scaffold defaults and create config.json first.`);
  }

  const config = validateConfig(readJson(CONFIG_PATH));
  const plan = buildFilePlan(options, config);

  if (fs.existsSync(plan.skillDir) && !options.force) {
    fail(`Target directory already exists: ${plan.skillDir}. Re-run with --force to overwrite scaffold-managed files.`);
  }

  if (!options.dryRun) {
    writeFilePlan(plan, options.force);
  }

  printSummary(plan, options.dryRun);
}

main();
