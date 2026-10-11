import type { HostConfig } from '../scripts/host-config';

const claude: HostConfig = {
  name: 'claude',
  displayName: 'Claude Code',
  cliCommand: 'claude',
  cliAliases: [],

  globalRoot: '.claude/skills/goldband',
  localSkillRoot: '.claude/skills/goldband',
  hostSubdir: '.claude',

  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': [
        'shared-rubric.md',
        'findings-schema.md',
        'checklist.md',
        'design-checklist.md',
        'greptile-triage.md',
        'TODOS-format.md',
      ],
    },
  },

  coAuthorTrailer: 'Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>',
  learningsMode: 'full',
};

export default claude;
