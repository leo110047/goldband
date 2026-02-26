---
description: Generate structured codebase analysis documents for planning and onboarding.
---

# Map Codebase Command

Analyze the current codebase and generate structured documentation in `.planning/codebase/`.

## Usage

`/map-codebase [section]`

## Output Directory

All output goes to `.planning/codebase/` in the project root.

## Sections

### STACK.md — Technology Stack

Analyze and document:
- Language(s) and version(s) (from package.json, pyproject.toml, go.mod, etc.)
- Framework(s) and version(s)
- Key dependencies and their purposes
- Dev dependencies (testing, linting, building)
- Runtime requirements (Node version, Python version, etc.)

### CONVENTIONS.md — Code Conventions

Analyze and document:
- File naming patterns (kebab-case, camelCase, PascalCase)
- Directory structure conventions
- Import/export patterns
- Error handling patterns
- Logging patterns
- Configuration patterns
- Type definition patterns

### ARCHITECTURE.md — Architecture Analysis

Analyze and document:
- High-level architecture (monolith, microservices, serverless, etc.)
- Entry points (main files, route definitions, CLI commands)
- Module/package boundaries
- Data flow (request → handler → service → data layer)
- External service integrations
- Key design patterns in use

### TESTING.md — Testing Patterns

Analyze and document:
- Test framework(s) in use
- Test file location conventions
- Test naming patterns
- Coverage configuration
- Mocking patterns
- Fixture patterns
- E2E test setup

### CONCERNS.md — Technical Debt & Issues

Analyze and document:
- TODO/FIXME/HACK comments (with locations)
- Files over 500 lines
- Functions over 50 lines
- Deep nesting (> 4 levels)
- console.log statements in source (non-test) files
- Unused exports (if detectable)
- Known security concerns
- Dependency freshness (outdated packages)

## Process

For each section:

1. **Search**: Use Grep and Glob to find relevant files and patterns
2. **Read**: Read key files to understand patterns (don't just list files — understand them)
3. **Analyze**: Identify patterns, conventions, and concerns
4. **Write**: Generate structured markdown in `.planning/codebase/[SECTION].md`

Each document should be:
- Factual (backed by actual file evidence)
- Actionable (useful for someone starting work on the codebase)
- Concise (focus on patterns, not exhaustive file lists)

## Arguments

$ARGUMENTS can be:
- (none) — Generate all 5 sections
- `tech` — Only STACK.md
- `arch` — Only ARCHITECTURE.md
- `quality` — Only CONCERNS.md
- `conventions` — Only CONVENTIONS.md
- `testing` — Only TESTING.md

Multiple sections can be specified: `/map-codebase tech arch`

## CRITICAL Rules

- **Evidence-based only** — Every claim must reference actual files/lines
- Do NOT guess at architecture — read the code and trace execution paths
- Do NOT assume frameworks — read package.json / config files
- If a section has nothing to report (e.g., no tests exist), say so explicitly
- Output files go to `.planning/codebase/`, NEVER modify source code
- If `.planning/codebase/` already exists, overwrite files (fresh analysis each time)
