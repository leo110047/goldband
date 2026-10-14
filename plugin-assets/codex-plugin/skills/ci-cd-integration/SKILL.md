---
name: ci-cd-integration
description: |
  Use when setting up or changing CI pipelines, GitHub Actions workflows,
  build/test/deploy gates, release automation, CI secrets handling, or build caching.

  Best fit for delivery pipeline design and automation, not application architecture.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# CI/CD Integration

Settle ownership, gates, permissions, and verification before editing
workflows.

## Gotchas

- Split build, test, release, and deploy jobs when their failures need
  different owners or rollback paths.
- Green local scripts are not CI proof; clean-environment runs are.
- Secrets must not reach logs, artifacts, caches, debug output, or workflows
  triggered by untrusted pull requests.

## Decision Checks

- Outcome: name the affected build, test, release, deploy, cache, permission,
  secret, artifact, or branch-protection behavior.
- Environment: verify dependencies, services, credentials, and platform versions.
- Security: workflow and token permissions are least-privilege.
- Rollback: a deploy change defines promotion, health checks, and rollback.

## Cache and Release Contracts

- Cache keys include the lockfile or dependency manifest hash, and workflows
  triggered by untrusted pull requests cannot write shared caches.
- Releases run only from protected tags or branches, and the released artifact
  is the one the gated build produced.

## Deploy Contracts

Long-running service deploys meet these contracts:

- Database migrations stay compatible with the version still serving traffic.
- New instances pass health checks and smoke tests before receiving traffic.
- Shutdown handles SIGTERM and drains in-flight requests.
- Progressive rollout compares the new version's error rate and latency with
  the stable version and rolls back automatically past defined thresholds.
- Environment swaps account for session state and DNS propagation.

## Completion Check

- The pipeline change has an explicit build, test, deploy, or release outcome.
- Verification ran in a clean or CI-equivalent environment when feasible.
- Unverified remote CI, environment gates, or deployment steps are reported.
