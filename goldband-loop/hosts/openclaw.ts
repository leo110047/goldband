import type { HostConfig } from '../scripts/host-config';

const openclaw: HostConfig = {
  name: 'openclaw',
  displayName: 'OpenClaw',
  cliCommand: 'openclaw',
  cliAliases: [],

  globalRoot: '.openclaw/skills/goldband',
  localSkillRoot: '.openclaw/skills/goldband',
  hostSubdir: '.openclaw',

  runtimeRoot: {
    globalSymlinks: ['bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  coAuthorTrailer: 'Co-Authored-By: OpenClaw Agent <agent@openclaw.ai>',
  learningsMode: 'basic',
};

export default openclaw;
