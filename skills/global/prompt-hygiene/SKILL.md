---
name: prompt-hygiene
description: |
  Use when creating or editing prompts, system prompts, agent instructions,
  workflow prompts, cron prompts, briefing prompts, design-tool prompts,
  Discord/report prompts, or handoff prompts for another AI agent.

  Best fit for prompt authoring before the prompt is delivered or installed.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
---

# Prompt Hygiene

## Core Principle

Write the minimum prompt that gives the model the right target, context, hard
boundaries, and success criteria.

Every sentence should serve the current prompt surface: outcome, visible
context, hard boundary, or success criterion.

## Prompt Contract

A prompt that will be reused, installed, handed off, or run by another agent
defines its work contract:

- Outcome: the finished state the model is responsible for producing.
- Verification: the executable test, check, review method, or evidence the
  target model, reviewer, or runtime can use to prove the outcome was reached.
- Constraints: forbidden actions, source-of-truth boundaries, permission gates,
  files or systems that must not be touched, and delivery limits.
- Iteration policy: what the model records while working, matched to the
  prompt surface.
- Error handling: when the model must stop, ask, or report instead of guessing;
  include what information it should return when blocked.

## When to Use

- Writing or revising a system prompt
- Creating agent instructions, handoff prompts, workflow prompts, or cron prompts
- Writing prompts for briefing, research, Discord/report output, or design tools
- Turning user preferences into reusable prompt text
- Installing or editing live prompt files

## Gotchas

- Add a negative rule only when it is explicitly requested, is a hard task
  boundary, or responds to observed bad output in this exact task type.
- Ground style in observable behavior, not abstract quality adjectives.
- Use steps when order is operationally required. For judgment work, describe
  the decision standard and expected outcome.
- Include the context the target model will actually receive. Rewrite references
  to missing files, transcript sections, memory, prior conversations, or
  timestamps into self-contained prompt content.
- Use different prompt surfaces for materially different jobs.

## Authoring Workflow

1. Identify the prompt surface:
   - Briefing / editorial prompt
   - Coding-agent handoff prompt
   - Live-agent or system prompt
   - Design-tool prompt
   - Discord / report prompt
   - Cron / scheduled prompt

2. Write only the prompt material this surface needs. Use the Prompt Contract as
   the checklist, but omit any element that is already enforced by schema,
   surrounding code, or runtime policy.

3. Prefer positive criteria.
   - Say what good output does.
   - Use a "not X" clause only when X is a proven or user-stated failure.

4. Keep format separate from judgment when possible.
   - Machine-readable structure belongs in schema, parser, or surrounding code.
   - Human-readable expression belongs in the prompt.

## Surface Guidance

### Briefing / Editorial Prompts

Focus on the reader's decision context, important changes, implications, and what
to monitor next. Give the model editorial judgment and room to select the useful
signal.

### Coding-Agent Handoff Prompts

Be stricter. Name the source of truth, expected implementation scope, tests,
verification commands, and final report requirements. For coding agents, an
ordered workflow is valid because execution order affects correctness.

### Live-Agent / System Prompts

Keep durable identity and behavior separate from channel-specific instructions.
Put stable role/style rules in the base layer, and put temporary routing,
language, or delivery rules in the runtime/channel layer.

### Design-Tool Prompts

Make the brief self-contained. Include the content, audience, interaction needs,
non-negotiable materials, and any source details the design tool must use.

### Discord / Report Prompts

Write for the person scanning the message. State the reporting purpose, audience,
and useful signal. Put reader-facing summary first; include diagnostics only when
the recipient needs them.

### Cron / Scheduled Prompts

Name the recurring job's purpose, available inputs, delivery destination, and
success/failure reporting expectations. Describe the runtime capability exactly:
trigger, available tools, and delivery path.

## Completion Check

Before delivering or installing the prompt, confirm:

- The Prompt Contract is present where the prompt surface needs it, without
  duplicating rules already enforced elsewhere.
- The prompt can stand alone with the context the target model will actually get.
- Every negative rule is justified by user request, hard boundary, or observed
  failure.
- Abstract style words have been replaced with observable criteria.
- Judgment work has a decision standard rather than a rigid SOP.
- Different prompt surfaces use separate prompt text.
