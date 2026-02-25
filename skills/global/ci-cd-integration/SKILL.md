---
name: ci-cd-integration
description: |
  CI/CD pipeline patterns and deployment strategies for modern applications.
  Covers GitHub Actions workflows, testing pipelines, deployment strategies, and automation.

  Use when: setting up CI/CD pipelines, configuring GitHub Actions, implementing deployment strategies,
  managing CI secrets, automating PR workflows, optimizing build caching.

  Focus: Pipeline design and automation, not application architecture.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# CI/CD Integration Patterns

Pipeline design patterns and deployment strategies for modern applications using GitHub Actions and related tooling.

## GitHub Actions Workflow Patterns

### Workflow Structure

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Cancel in-progress runs for the same branch/PR
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm test

  deploy:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
```

### Matrix Builds

Use matrices to test across multiple configurations without duplicating jobs.

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false  # Do not cancel other matrix jobs if one fails
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20]
        exclude:
          - os: windows-latest
            node-version: 18
        include:
          - os: ubuntu-latest
            node-version: 20
            coverage: true  # Extra flag for one specific combination
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
      - if: matrix.coverage
        run: npm run test:coverage
```

**`fail-fast` guidance:**
- Set `fail-fast: false` for CI checks (you want to see all failures)
- Set `fail-fast: true` (default) for deployment pipelines (stop early on failure)

### Reusable Workflows

Define a workflow once, call it from multiple repositories or workflows.

```yaml
# .github/workflows/reusable-test.yml (in a shared repo or same repo)
name: Reusable Test Workflow

on:
  workflow_call:
    inputs:
      node-version:
        required: false
        type: string
        default: '20'
      working-directory:
        required: false
        type: string
        default: '.'
    secrets:
      NPM_TOKEN:
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ${{ inputs.working-directory }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'
          cache-dependency-path: ${{ inputs.working-directory }}/package-lock.json
      - run: npm ci
      - run: npm test
```

```yaml
# .github/workflows/ci.yml (caller)
name: CI
on: [push, pull_request]

jobs:
  test-app:
    uses: ./.github/workflows/reusable-test.yml
    with:
      working-directory: 'apps/web'
    secrets: inherit

  test-api:
    uses: ./.github/workflows/reusable-test.yml
    with:
      working-directory: 'apps/api'
      node-version: '18'
    secrets: inherit
```

### Composite Actions

Bundle multiple steps into a single reusable action.

```yaml
# .github/actions/setup-project/action.yml
name: Setup Project
description: Install dependencies and setup environment

inputs:
  node-version:
    description: Node.js version
    required: false
    default: '20'

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    - run: npm ci
      shell: bash
    - run: npx playwright install --with-deps
      shell: bash
      if: hashFiles('playwright.config.*') != ''
```

```yaml
# Usage in a workflow
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-project
    with:
      node-version: '20'
  - run: npm test
```

---

## Testing Pipeline Design

### Test Stage Ordering

```
Stage 1: Static Analysis (fastest, cheapest)
  - Linting (ESLint, Prettier, Ruff)
  - Type checking (tsc --noEmit, mypy)
  - Security scanning (npm audit, trivy)

Stage 2: Unit Tests
  - Run all unit tests
  - Generate coverage report

Stage 3: Integration Tests
  - Database tests (with service containers)
  - API tests (with test server)

Stage 4: E2E Tests (slowest, most expensive)
  - Browser tests (Playwright, Cypress)
  - Smoke tests against staging
```

**Key principle:** Fail fast. Run cheap checks first so developers get feedback in seconds, not minutes.

### Parallelization and Sharding

- Jobs without `needs` run in parallel -- put lint, typecheck, and unit tests at the same level
- Use `needs: [lint, typecheck, unit-test]` to gate integration tests on static checks
- Use service containers (`services: postgres:`) for integration tests that need a database

**Test sharding** splits large suites across runners:

```yaml
# Jest:        npx jest --shard=${{ matrix.shard }}     matrix: ['1/4','2/4','3/4','4/4']
# Playwright:  npx playwright test --shard=${{ matrix.shard }}
# Pytest:      pytest --splits 4 --group ${{ matrix.group }}
```

---

## Deployment Strategies

### Decision Table

| Strategy | Downtime | Risk | Rollback Speed | Cost | Best For |
|----------|----------|------|----------------|------|----------|
| **Recreate** | Yes | High | Slow (redeploy) | Low | Dev/staging environments |
| **Rolling Update** | No | Medium | Medium (roll back pods) | Low | Standard web apps |
| **Blue-Green** | No | Low | Instant (swap routing) | High (2x resources) | Critical services |
| **Canary** | No | Very Low | Fast (route 100% to old) | Medium | High-traffic services |
| **Feature Flags** | No | Very Low | Instant (toggle flag) | Low | Gradual feature rollout |

### Rolling Update

Gradually replaces old instances with new ones.

```yaml
# Kubernetes rolling update
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1    # At most 1 pod down during update
      maxSurge: 1           # At most 1 extra pod during update
```

**Checklist:**
- [ ] Health check endpoint returns 200 when app is ready
- [ ] Graceful shutdown handles in-flight requests (SIGTERM handler)
- [ ] Database migrations are backward-compatible with previous version
- [ ] New version starts accepting traffic only after health check passes

### Blue-Green Deployment

```
  [Load Balancer]
       |
  +----+----+
  |         |
[Blue]   [Green]
(v1.0)   (v1.1)
active   standby

Deploy v1.1 to Green. Test Green. Swap routing to Green. Blue becomes standby.
If anything goes wrong, swap back to Blue instantly.
```

### Canary Deployment

```
  [Load Balancer / Service Mesh]
       |
  +----+----+
  |         |
[Stable]  [Canary]
 95%       5%
 v1.0      v1.1

Start with 5% traffic to canary. Monitor error rate, latency, CPU.
If metrics are healthy, increase to 25%, 50%, 100%.
If metrics degrade, route 100% back to stable.
```

> See `reference/deployment-strategies.md` for detailed implementation of each strategy.

---

## CI Secret Management

### GitHub Secrets

```yaml
# Repository secrets: Settings > Secrets and variables > Actions
# Access in workflows:
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  API_KEY: ${{ secrets.API_KEY }}

# Organization secrets: shared across repos in the org
# Environment secrets: scoped to a specific environment (production, staging)
```

### Environment Protection Rules

```yaml
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.example.com

    # GitHub enforces these rules before the job runs:
    # - Required reviewers (1+ people must approve)
    # - Wait timer (e.g., 5 minutes after approval)
    # - Branch restrictions (only main can deploy to production)
    steps:
      - run: ./deploy.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

### Secret Hygiene Rules

```
1. Never echo secrets in logs
   BAD:  echo "Deploying with token: $DEPLOY_TOKEN"
   GOOD: echo "Deploying to production..."

2. Use GitHub's automatic masking
   Secrets are automatically masked in logs.
   But be careful with encoded forms (base64 of a secret is NOT masked).

3. Rotate secrets regularly
   Set a reminder to rotate tokens every 90 days.

4. Use OIDC instead of long-lived tokens where possible
   GitHub Actions supports OIDC for AWS, GCP, Azure.
   No static credentials needed.

5. Scope secrets to environments
   Production secrets should not be accessible from PR workflows.
```

### OIDC Authentication (No Static Secrets)

```yaml
# Authenticate to AWS without storing access keys
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-actions
      aws-region: us-east-1
  - run: aws s3 sync ./dist s3://my-bucket
```

---

## PR Automation

### Auto-Labeling

Use `actions/labeler@v5` with a `.github/labeler.yml` config to auto-label PRs by changed file paths (e.g., `src/components/**` -> `frontend`, `**/*.test.*` -> `tests`).

### Required Checks and Merge Strategies

Configure in Settings > Branches > Branch protection rules:

- **Required checks:** lint, typecheck, unit-test, integration-test
- **Merge strategy:** Squash merge for feature branches (clean history), merge commit for release branches
- **Recommendation:** Enable "Squash and merge" as default; require linear history

### PR Size Enforcement

Use `gh pr view` in a workflow to check additions + deletions. If over 500 lines, comment asking to split and add a `large-pr` label.

---

## Build Caching Strategies

### Dependency Caching

Most setup actions have built-in caching:

```yaml
- uses: actions/setup-node@v4          # cache: 'npm'
- uses: actions/setup-python@v5        # cache: 'pip'
- uses: actions/setup-go@v5            # cache: true
```

For manual caching, use `actions/cache@v4` with a key based on lockfile hash:

```yaml
key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
restore-keys: ${{ runner.os }}-node-
```

### Docker Layer Caching

```yaml
- uses: docker/build-push-action@v6
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### Monorepo Caching

- **Turborepo:** `npx turbo build --filter=...[origin/main]` with remote cache (`TURBO_TOKEN`)
- **Nx:** `npx nx affected --target=test --base=origin/main` (only builds/tests what changed)

> See `reference/github-actions-recipes.md` for complete, ready-to-use workflow templates.

---

## Quick Reference

| Topic | Key Rule |
|-------|---------|
| Workflow structure | Use `concurrency` to cancel in-progress runs |
| Matrix builds | Set `fail-fast: false` for CI checks |
| Test pipeline | Fail fast: static analysis first, E2E last |
| Deployment | Blue-green for critical services, rolling for standard apps |
| Secrets | Use OIDC over static tokens; scope to environments |
| PR automation | Auto-label, enforce size limits, require status checks |
| Caching | Cache dependencies with lockfile hash; use Docker layer cache for images |
