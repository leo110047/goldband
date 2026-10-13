import type { HostConfig } from '../scripts/host-config';

const kiro: HostConfig = {
  name: 'kiro',
  displayName: 'Kiro',
  cliCommand: 'kiro-cli',
  cliAliases: [],

  globalRoot: '.kiro/skills/goldband',
  localSkillRoot: '.kiro/skills/goldband',
  hostSubdir: '.kiro',

  runtimeRoot: {
    globalSymlinks: ['bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  learningsMode: 'basic',
};

export default kiro;
