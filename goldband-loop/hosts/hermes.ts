import type { HostConfig } from '../scripts/host-config';

const hermes: HostConfig = {
  name: 'hermes',
  displayName: 'Hermes',
  cliCommand: 'hermes',
  cliAliases: [],

  globalRoot: '.hermes/skills/goldband',
  localSkillRoot: '.hermes/skills/goldband',
  hostSubdir: '.hermes',

  runtimeRoot: {
    globalSymlinks: ['bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  coAuthorTrailer: 'Co-Authored-By: Hermes Agent <agent@nousresearch.com>',
  learningsMode: 'basic',
};

export default hermes;
