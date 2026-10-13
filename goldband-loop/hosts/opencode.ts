import type { HostConfig } from '../scripts/host-config';

const opencode: HostConfig = {
  name: 'opencode',
  displayName: 'OpenCode',
  cliCommand: 'opencode',
  cliAliases: [],

  globalRoot: '.config/opencode/skills/goldband',
  localSkillRoot: '.opencode/skills/goldband',
  hostSubdir: '.opencode',

  runtimeRoot: {
    globalSymlinks: ['bin', 'design/dist', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'design-checklist.md', 'greptile-triage.md', 'TODOS-format.md'],
    },
  },

  learningsMode: 'basic',
};

export default opencode;
