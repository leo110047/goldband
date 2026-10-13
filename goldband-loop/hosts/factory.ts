import type { HostConfig } from '../scripts/host-config';

const factory: HostConfig = {
  name: 'factory',
  displayName: 'Factory Droid',
  cliCommand: 'droid',
  cliAliases: ['droid'],

  globalRoot: '.factory/skills/goldband',
  localSkillRoot: '.factory/skills/goldband',
  hostSubdir: '.factory',

  runtimeRoot: {
    globalSymlinks: ['bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  coAuthorTrailer: 'Co-Authored-By: Factory Droid <droid@users.noreply.github.com>',
  learningsMode: 'full',
};

export default factory;
