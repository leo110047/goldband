---
name: frontend-design
description: |
  Use when creating, restyling, or reviewing frontend pages, components,
  dashboards, tools, posters, artifacts, or application screens.

  Prefer the Goldband design-review workflow for full design review and
  iteration. This portable skill only defines shared design policy.
license: Complete terms in LICENSE.txt
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
paths:
  - "DESIGN.md"
  - "app/**"
  - "pages/**"
  - "src/**"
  - "components/**"
  - "styles/**"
  - "public/**"
---

# Frontend Design

Shared UI design policy. The Goldband design-review workflow owns full design review.

## Source of Truth

Before designing or coding:

- If the repo has `DESIGN.md`, read it and treat it as the project design source
  of truth.
- If the product already has a design system, match it before introducing a new
  direction.
- If no source exists, define typography, color, spacing, layout, motion, and
  interaction states before writing components.

Do not override an existing product system just to make the result more novel.

## Workflow Handoff

Use the Goldband design-review workflow, when installed, for new UI, visual QA, design
iteration, screenshot critique, and production polish. Use this skill alone for
small design decisions or when the workflow is not installed.

## Required Design Contract

For meaningful UI work, define:

- Outcome: finished visual and interaction state.
- Verification: browser interaction, screenshots, responsive checks, or task-flow
  checks.
- Constraints: framework, design system, accessibility requirements, assets,
  dependency limits, and forbidden scope.
- Iteration policy: observations, issues found, fixes made, and scope left alone.
- Error handling: pause and report when required assets, brand guidance, runnable
  app state, or product requirements are missing.

## Completion Check

Before considering UI work complete, confirm:

- The design matches the repo or product source of truth.
- The UI has coherent hierarchy and product-specific decisions.
- Typography, spacing, color, states, and responsiveness hold up in tested
  viewports.
- The primary user task is understandable and completable.
- Any unverified browser, screenshot, asset, or responsive check is reported.
