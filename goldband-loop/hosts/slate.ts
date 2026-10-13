import type { HostConfig } from '../scripts/host-config';

const slate: HostConfig = {
  name: 'slate',
  displayName: 'Slate',
  cliCommand: 'slate',
  cliAliases: [],

  globalRoot: '.slate/skills/goldband',
  localSkillRoot: '.slate/skills/goldband',
  hostSubdir: '.slate',

  runtimeRoot: {
    globalSymlinks: ['bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  learningsMode: 'basic',
};

export default slate;
