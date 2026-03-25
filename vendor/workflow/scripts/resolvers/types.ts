export type Host = 'claude' | 'codex';

export interface HostPaths {
  skillRoot: string;
  localSkillRoot: string;
  binDir: string;
  browseDir: string;
}

export const HOST_PATHS: Record<Host, HostPaths> = {
  claude: {
    skillRoot: '~/.claude/skills/workflow',
    localSkillRoot: '.claude/skills/workflow',
    binDir: '~/.claude/skills/workflow/bin',
    browseDir: '~/.claude/skills/workflow/browse/dist',
  },
  codex: {
    skillRoot: '$WORKFLOW_ROOT',
    localSkillRoot: '.agents/skills/workflow',
    binDir: '$WORKFLOW_BIN',
    browseDir: '$WORKFLOW_BROWSE',
  },
};

export interface TemplateContext {
  skillName: string;
  tmplPath: string;
  benefitsFrom?: string[];
  host: Host;
  paths: HostPaths;
  preambleTier?: number;  // 1-4, controls which preamble sections are included
}
