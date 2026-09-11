// AUTO-GENERATED from goldband.manifest.json. Do not edit.
import type { HostName, RiskLevel, RuntimeActionContract, SafetyGateContract } from './types';

export type CapabilityActionRecord = {
  capability: string;
  action: string;
  name: string;
  description: string;
  contractPath: string;
  runtime: 'typed' | 'compatibility' | 'registered-only';
  dispatch: 'trusted-launcher' | 'host-runtime' | 'prompt-contract' | 'registered-only';
  lifecycle: 'public' | 'experimental';
  runtimeOwner: string | null;
  runtimeContract: RuntimeActionContract | null;
  safetyGates: SafetyGateContract[];
  riskLevel: RiskLevel;
  hostSupport: HostName[];
};

export const CAPABILITY_ACTIONS: CapabilityActionRecord[] = [
  {
    "capability": "review",
    "action": "code",
    "name": "review/code",
    "description": "Evidence-backed or explicit semantic-only code review.",
    "contractPath": "generated/workflow-contracts/review/code.workflow.md",
    "runtime": "typed",
    "dispatch": "trusted-launcher",
    "lifecycle": "public",
    "runtimeOwner": "review-runtime",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "review",
    "action": "security",
    "name": "review/security",
    "description": "Review security and trust boundaries.",
    "contractPath": "generated/workflow-contracts/review/security.workflow.md",
    "runtime": "compatibility",
    "dispatch": "prompt-contract",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "investigate",
    "action": "code",
    "name": "investigate/code",
    "description": "Investigate code or runtime behavior.",
    "contractPath": "generated/workflow-contracts/investigate/code.workflow.md",
    "runtime": "compatibility",
    "dispatch": "prompt-contract",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "qa",
    "action": "app",
    "name": "qa/app",
    "description": "Run product QA and record evidence.",
    "contractPath": "generated/workflow-contracts/qa/app.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "qa-runtime",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "release",
    "action": "land",
    "name": "release/land",
    "description": "Merge, deploy, and verify.",
    "contractPath": "generated/workflow-contracts/release/land.workflow.md",
    "runtime": "registered-only",
    "dispatch": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "safetyGates": [
      {
        "operation": "release/land",
        "mode": "land",
        "enforcement": "blocked-before-runtime",
        "owner": null,
        "authorization": "native-host-approval",
        "preconditions": [
          "clean-worktree",
          "required-checks-passed",
          "deployment-target-resolved",
          "rollback-plan-recorded"
        ],
        "sideEffects": [
          "merge",
          "deploy"
        ],
        "readback": [
          "merged-commit",
          "deployment-health",
          "rollback-signal"
        ]
      },
      {
        "operation": "release/canary",
        "mode": "canary",
        "enforcement": "blocked-before-runtime",
        "owner": null,
        "authorization": "not-required-read-only",
        "preconditions": [
          "deployment-identity-resolved",
          "health-baseline-recorded",
          "observation-window-bounded"
        ],
        "sideEffects": [],
        "readback": [
          "canary-health-samples",
          "anomaly-decision",
          "observation-window-complete"
        ]
      }
    ],
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "release",
    "action": "setup",
    "name": "release/setup",
    "description": "Configure deployment.",
    "contractPath": "generated/workflow-contracts/release/setup.workflow.md",
    "runtime": "registered-only",
    "dispatch": "registered-only",
    "lifecycle": "experimental",
    "runtimeOwner": null,
    "runtimeContract": null,
    "safetyGates": [
      {
        "operation": "release/setup",
        "mode": "setup",
        "enforcement": "blocked-before-runtime",
        "owner": null,
        "authorization": "native-host-approval",
        "preconditions": [
          "deployment-target-resolved",
          "current-config-readback",
          "secret-references-only",
          "rollback-plan-recorded"
        ],
        "sideEffects": [
          "deployment-config-write",
          "secret-binding-update"
        ],
        "readback": [
          "effective-config-digest",
          "secret-bindings-redacted",
          "deployment-health"
        ]
      }
    ],
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "plan",
    "action": "create",
    "name": "plan/create",
    "description": "Create a versioned Work Map for tracked work.",
    "contractPath": "generated/workflow-contracts/plan/create.workflow.md",
    "runtime": "typed",
    "dispatch": "trusted-launcher",
    "lifecycle": "public",
    "runtimeOwner": "work-map-store",
    "runtimeContract": {
      "modes": [
        "create"
      ],
      "requiredInputs": {
        "create": [
          "mode",
          "destination",
          "scope",
          "decisions",
          "fog",
          "tickets"
        ]
      },
      "outputs": [
        "work-id",
        "revision",
        "digest",
        "frontier",
        "map-readback"
      ],
      "sideEffects": {
        "local-work-map-write": "runtime-owner"
      }
    },
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex"
    ]
  },
  {
    "capability": "plan",
    "action": "sync",
    "name": "plan/sync",
    "description": "Preview, inspect, or synchronize a Work Map tracker projection.",
    "contractPath": "generated/workflow-contracts/plan/sync.workflow.md",
    "runtime": "typed",
    "dispatch": "trusted-launcher",
    "lifecycle": "public",
    "runtimeOwner": "tracker-runtime",
    "runtimeContract": {
      "modes": [
        "preview",
        "inspect",
        "publish-step"
      ],
      "requiredInputs": {
        "preview": [
          "mode",
          "workId"
        ],
        "inspect": [
          "mode",
          "workId"
        ],
        "publish-step": [
          "mode",
          "workId",
          "operationDigest",
          "stepId"
        ]
      },
      "outputs": [
        "mode",
        "workId",
        "readback"
      ],
      "sideEffects": {
        "tracker-issue-write": "publish-step-only"
      }
    },
    "safetyGates": [
      {
        "operation": "plan/sync-preview",
        "mode": "preview",
        "enforcement": "runtime-owner",
        "owner": "tracker-runtime",
        "authorization": "not-required-read-only",
        "preconditions": [
          "tracker-config-readback",
          "local-work-map-readback"
        ],
        "sideEffects": [],
        "readback": [
          "operation-digest",
          "projection-steps",
          "approval-requirements"
        ]
      },
      {
        "operation": "plan/sync",
        "mode": "publish-step",
        "enforcement": "runtime-owner",
        "owner": "tracker-runtime",
        "authorization": "native-host-approval",
        "preconditions": [
          "matching-preview-digest",
          "local-revision-unchanged",
          "remote-digest-unchanged"
        ],
        "sideEffects": [
          "tracker-issue-create",
          "tracker-issue-update",
          "tracker-relationship-update"
        ],
        "readback": [
          "remote-markers",
          "remote-digest",
          "sync-checkpoint"
        ]
      }
    ],
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "browser",
    "action": "session",
    "name": "browser/session",
    "description": "Use the persistent browser for interactive work.",
    "contractPath": "generated/workflow-contracts/browser/session.workflow.md",
    "runtime": "typed",
    "dispatch": "trusted-launcher",
    "lifecycle": "public",
    "runtimeOwner": "browse",
    "runtimeContract": null,
    "safetyGates": [
      {
        "operation": "browser/cookies",
        "mode": "cookies",
        "enforcement": "blocked-before-runtime",
        "owner": null,
        "authorization": "native-host-approval",
        "preconditions": [
          "source-profile-resolved",
          "domain-scope-explicit",
          "credential-store-approval"
        ],
        "sideEffects": [
          "session-cookie-import"
        ],
        "readback": [
          "imported-domain-list",
          "import-count",
          "no-cookie-values-in-evidence"
        ]
      }
    ],
    "riskLevel": "medium",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "design",
    "action": "consult",
    "name": "design/consult",
    "description": "Define a design direction and system.",
    "contractPath": "generated/workflow-contracts/design/consult.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "design-decision-store",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "safety",
    "action": "guard",
    "name": "safety/guard",
    "description": "Enable careful-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/guard.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "safety",
    "action": "freeze",
    "name": "safety/freeze",
    "description": "Enable read-only freeze-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/freeze.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "safety",
    "action": "unfreeze",
    "name": "safety/unfreeze",
    "description": "Disable freeze-mode for a Claude session.",
    "contractPath": "generated/workflow-contracts/safety/unfreeze.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "claude-hook-mode-state",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude"
    ]
  },
  {
    "capability": "context",
    "action": "save",
    "name": "context/save",
    "description": "Save current working context.",
    "contractPath": "generated/workflow-contracts/context/save.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "context-checkpoint-store",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "context",
    "action": "restore",
    "name": "context/restore",
    "description": "Restore saved working context.",
    "contractPath": "generated/workflow-contracts/context/restore.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "context-checkpoint-store",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "context",
    "action": "retro",
    "name": "context/retro",
    "description": "Summarize recent work and lessons.",
    "contractPath": "generated/workflow-contracts/context/retro.workflow.md",
    "runtime": "compatibility",
    "dispatch": "prompt-contract",
    "lifecycle": "public",
    "runtimeOwner": "prompt-contract-dispatch",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "knowledge",
    "action": "recall",
    "name": "knowledge/recall",
    "description": "Inspect Goldband learnings and knowledge.",
    "contractPath": "generated/workflow-contracts/knowledge/recall.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "goldband-knowledge",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "benchmark",
    "action": "workflow",
    "name": "benchmark/workflow",
    "description": "Benchmark product or workflow performance.",
    "contractPath": "generated/workflow-contracts/benchmark/workflow.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "benchmark-evidence-aggregator",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "document",
    "action": "generate",
    "name": "document/generate",
    "description": "Audit documentation coverage and prepare documentation artifacts.",
    "contractPath": "generated/workflow-contracts/document/generate.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "documentation-audit",
    "runtimeContract": {
      "modes": [
        "audit"
      ],
      "requiredInputs": {
        "audit": [
          "diffFile"
        ]
      },
      "outputs": [
        "coverage-artifact",
        "pr-body-section-artifact"
      ],
      "sideEffects": {
        "pr-body-update": "native-host-approval"
      }
    },
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "system",
    "action": "health",
    "name": "system/health",
    "description": "Inspect Goldband health and installation state.",
    "contractPath": "generated/workflow-contracts/system/health.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "goldband-installation",
    "runtimeContract": null,
    "safetyGates": [],
    "riskLevel": "low",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "system",
    "action": "upgrade",
    "name": "system/upgrade",
    "description": "Upgrade Goldband.",
    "contractPath": "generated/workflow-contracts/system/upgrade.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "goldband-setup-gate",
    "runtimeContract": {
      "modes": [
        "preflight",
        "readback"
      ],
      "requiredInputs": {
        "preflight": [
          "phase"
        ],
        "readback": [
          "phase",
          "preflightId",
          "oldVersion",
          "newVersion",
          "setupVerified"
        ]
      },
      "outputs": [
        "upgrade-preflight",
        "installed-version",
        "installed-head",
        "setup-status"
      ],
      "sideEffects": {
        "git-fast-forward": "native-host-approval",
        "installer-execution": "native-host-approval"
      }
    },
    "safetyGates": [
      {
        "operation": "system/upgrade",
        "mode": "upgrade",
        "enforcement": "runtime-owner",
        "owner": "goldband-setup-gate",
        "authorization": "native-host-approval",
        "preconditions": [
          "trusted-installation",
          "clean-worktree",
          "upgrade-preflight-recorded"
        ],
        "sideEffects": [
          "git-fast-forward",
          "installer-execution"
        ],
        "readback": [
          "installed-version",
          "installed-head",
          "setup-status",
          "completed-preflight"
        ]
      }
    ],
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  },
  {
    "capability": "ios",
    "action": "qa",
    "name": "ios/qa",
    "description": "Run iOS QA.",
    "contractPath": "generated/workflow-contracts/ios/qa.workflow.md",
    "runtime": "typed",
    "dispatch": "host-runtime",
    "lifecycle": "public",
    "runtimeOwner": "ios-qa-evidence",
    "runtimeContract": {
      "modes": [
        "qa"
      ],
      "requiredInputs": {
        "qa": [
          "targetScope",
          "checks"
        ]
      },
      "outputs": [
        "simulator-inventory",
        "qa-evidence-artifact",
        "untested-device-coverage"
      ],
      "sideEffects": {}
    },
    "safetyGates": [
      {
        "operation": "ios/qa",
        "mode": "qa",
        "enforcement": "runtime-owner",
        "owner": "ios-qa-evidence",
        "authorization": "not-required-read-only",
        "preconditions": [
          "darwin-platform",
          "xcode-toolchain",
          "target-scope-explicit",
          "qa-checks-supplied"
        ],
        "sideEffects": [],
        "readback": [
          "simulator-inventory",
          "qa-evidence-artifact",
          "untested-device-coverage"
        ]
      },
      {
        "operation": "ios/sync",
        "mode": "sync",
        "enforcement": "blocked-before-runtime",
        "owner": null,
        "authorization": "native-host-approval",
        "preconditions": [
          "project-identity-resolved",
          "sync-target-explicit",
          "pre-sync-diff-recorded",
          "backup-or-rollback-recorded"
        ],
        "sideEffects": [
          "xcode-project-sync",
          "project-file-write"
        ],
        "readback": [
          "post-sync-diff",
          "project-file-digest",
          "build-status"
        ]
      }
    ],
    "riskLevel": "high",
    "hostSupport": [
      "claude",
      "codex",
      "factory",
      "kiro",
      "opencode",
      "slate",
      "cursor",
      "openclaw",
      "hermes"
    ]
  }
];
