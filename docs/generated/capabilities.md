<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# Goldband capabilities

Formal interface: `$goldband <capability> <action>`. Old workflow names are not aliases.

Public inventory: 20 actions. Experimental actions are excluded from routing and activation hints.

| Capability | Action | Outcome | Runtime owner | Runtime | Dispatch | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `review` | `code` | Evidence-backed or explicit semantic-only code review. | `review-runtime` | `typed` | `trusted-launcher` | `medium` |
| `review` | `security` | Review security and trust boundaries. | `prompt-contract-dispatch` | `compatibility` | `prompt-contract` | `medium` |
| `investigate` | `code` | Investigate code or runtime behavior. | `prompt-contract-dispatch` | `compatibility` | `prompt-contract` | `medium` |
| `qa` | `app` | Run product QA and record evidence. | `qa-runtime` | `typed` | `host-runtime` | `medium` |
| `plan` | `create` | Create a versioned Work Map for tracked work. | `work-map-store` | `typed` | `trusted-launcher` | `low` |
| `plan` | `sync` | Preview, inspect, or synchronize a Work Map tracker projection. | `tracker-runtime` | `typed` | `trusted-launcher` | `high` |
| `browser` | `session` | Use the persistent browser for interactive work. | `browse` | `typed` | `trusted-launcher` | `medium` |
| `design` | `consult` | Define a design direction and system. | `design-decision-store` | `typed` | `host-runtime` | `low` |
| `safety` | `guard` | Enable careful-mode for a Claude session. | `claude-hook-mode-state` | `typed` | `host-runtime` | `low` |
| `safety` | `freeze` | Enable read-only freeze-mode for a Claude session. | `claude-hook-mode-state` | `typed` | `host-runtime` | `low` |
| `safety` | `unfreeze` | Disable freeze-mode for a Claude session. | `claude-hook-mode-state` | `typed` | `host-runtime` | `low` |
| `context` | `save` | Save current working context. | `context-checkpoint-store` | `typed` | `host-runtime` | `low` |
| `context` | `restore` | Restore saved working context. | `context-checkpoint-store` | `typed` | `host-runtime` | `low` |
| `context` | `retro` | Summarize recent work and lessons. | `prompt-contract-dispatch` | `compatibility` | `prompt-contract` | `low` |
| `knowledge` | `recall` | Inspect Goldband learnings and knowledge. | `goldband-knowledge` | `typed` | `host-runtime` | `low` |
| `benchmark` | `workflow` | Benchmark product or workflow performance. | `benchmark-evidence-aggregator` | `typed` | `host-runtime` | `low` |
| `document` | `generate` | Audit documentation coverage and prepare documentation artifacts. | `documentation-audit` | `typed` | `host-runtime` | `low` |
| `system` | `health` | Inspect Goldband health and installation state. | `goldband-installation` | `typed` | `host-runtime` | `low` |
| `system` | `upgrade` | Upgrade Goldband. | `goldband-setup-gate` | `typed` | `host-runtime` | `high` |
| `ios` | `qa` | Run iOS QA. | `ios-qa-evidence` | `typed` | `host-runtime` | `high` |

## Experimental inventory

These actions are tracked for implementation, but are not discoverable or runnable. They cannot claim a runtime owner before integration.

| Capability | Action | Outcome | Runtime owner | Runtime | Dispatch | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `release` | `land` | Merge, deploy, and verify. | — | `registered-only` | `registered-only` | `high` |
| `release` | `setup` | Configure deployment. | — | `registered-only` | `registered-only` | `high` |

## High-risk safety gates

These operation IDs are internal safety inventory, not public action aliases. `blocked-before-runtime` operations cannot run until a matching owner replaces the block and implements every precondition, authorization boundary, side effect, and readback requirement. `runtime-owner` operations record successful gate evidence only after an operation-specific verifier validates the declared contract against owner output and trusted readback; blocked or mock-only runs remain pending.

| Operation | Active action | Mode | Enforcement | Authorization | Gate owner |
| --- | --- | --- | --- | --- | --- |
| `release/land` | `release/land` | `land` | `blocked-before-runtime` | `native-host-approval` | — |
| `release/canary` | `release/land` | `canary` | `blocked-before-runtime` | `not-required-read-only` | — |
| `release/setup` | `release/setup` | `setup` | `blocked-before-runtime` | `native-host-approval` | — |
| `plan/sync-preview` | `plan/sync` | `preview` | `runtime-owner` | `not-required-read-only` | `tracker-runtime` |
| `plan/sync` | `plan/sync` | `publish-step` | `runtime-owner` | `native-host-approval` | `tracker-runtime` |
| `browser/cookies` | `browser/session` | `cookies` | `blocked-before-runtime` | `native-host-approval` | — |
| `system/upgrade` | `system/upgrade` | `upgrade` | `runtime-owner` | `native-host-approval` | `goldband-setup-gate` |
| `ios/qa` | `ios/qa` | `qa` | `runtime-owner` | `not-required-read-only` | `ios-qa-evidence` |
| `ios/sync` | `ios/qa` | `sync` | `blocked-before-runtime` | `native-host-approval` | — |

## Prompt/runtime boundary

- Prompt contract: goal, relevant-context, hard-boundaries, verification.
- Model owns: semantic-reasoning, task-decomposition, tool-selection, adaptation.
- Runtime owns: routing, authorization, side-effect-gates, typed-evidence, stop-conditions, state, observability, interaction-schema.
- Installed workflow documents are thin contracts generated from manifest-owned `promptContract` fields. Per-workflow `SKILL.md` and `SKILL.md.tmpl` prompt surfaces are not part of the architecture.

## Human decisions

- Ask only when user authority is required, or two plausible answers would change the target, behavior, or external effect and current evidence or preferences cannot resolve intent.
- Batch related decisions when they can be answered together; split only when an earlier answer changes the next question, risk level, or required evidence.
- Tool schemas and UI own question shape, option labels, validation, and persistence. Prompts should provide only concise decision context.
- Avoid prompt-owned formats: prompt-owned formatting rubrics, scores, word-count rules, per-finding question rules.
