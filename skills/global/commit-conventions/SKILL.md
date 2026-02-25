---
name: commit-conventions
description: |
  Git commit message conventions following Conventional Commits specification.
  Use when: creating commits, reviewing commit history, setting up commit hooks, or establishing team standards.

  Helps generate changelogs, automate versioning, and maintain clean git history.
allowed-tools:
  - Bash  # Git operations
  - Read  # Read git log
---

# Git Commit Conventions - Conventional Commits

## When to Use This Skill

- Writing commit messages
- Reviewing commit history
- Setting up commit hooks (commitlint)
- Establishing team commit standards
- Generating changelogs automatically
- Implementing semantic versioning

## Conventional Commits Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type (Required)

| Type | Description | Changelog | Version Bump |
|------|-------------|-----------|--------------|
| `feat` | New feature | Yes | Minor (0.x.0) |
| `fix` | Bug fix | Yes | Patch (0.0.x) |
| `docs` | Documentation only | No | None |
| `style` | Code style (formatting, semicolons) | No | None |
| `refactor` | Code change that neither fixes bug nor adds feature | No | None |
| `perf` | Performance improvement | Yes | Patch |
| `test` | Adding or updating tests | No | None |
| `build` | Build system or dependencies | No | None |
| `ci` | CI/CD configuration | No | None |
| `chore` | Other changes (tooling, config) | No | None |
| `revert` | Revert previous commit | Yes | Depends |

### Scope (Optional)

Component or module affected:
- `api`, `ui`, `auth`, `database`, `docs`
- `user-profile`, `payment`, `analytics`

### Subject (Required)

- Use imperative mood ("add" not "added" or "adds")
- Don't capitalize first letter
- No period at the end
- Keep under 50 characters

### Body (Optional)

- Explain WHAT and WHY, not HOW
- Wrap at 72 characters
- Separate from subject with blank line

### Footer (Optional)

- Reference issues: `Fixes #123`, `Closes #456`
- Breaking changes: `BREAKING CHANGE: description`

## Examples

### Feature

```
feat(auth): add JWT token refresh mechanism

Implement automatic token refresh when access token expires.
Refresh tokens are valid for 30 days and stored in httpOnly cookies.

Closes #234
```

### Bug Fix

```
fix(api): handle null values in user profile endpoint

Previously, null values in optional fields caused 500 errors.
Now returns proper defaults for missing fields.

Fixes #456
```

### Breaking Change

```
feat(api)!: change user creation endpoint from POST to PUT

BREAKING CHANGE: The /api/users endpoint now uses PUT instead of POST
for creating users. This aligns with RESTful conventions for idempotent operations.

Migration guide:
- Update client code to use PUT instead of POST
- Ensure user ID is included in request body

Closes #789
```

## Quick Reference

### Good Commits

```bash
feat(auth): add password reset functionality
fix(api): prevent race condition in order processing
docs(readme): add installation instructions
perf(database): optimize user search query
test(auth): add integration tests for login flow
refactor(ui): extract button component
```

### Bad Commits

```bash
Fixed bug                           # Not descriptive
WIP                                 # Work in progress, not final
Updated stuff                       # Too vague
feat(auth): Added password reset.   # Don't use past tense or period
FEAT: add feature                   # Don't capitalize type
fix: this fixes the bug that was causing the app to crash when users tried to login with invalid credentials  # Too long (>50 chars)
```

## Commit Message Rules

### DO:
- Use imperative mood ("add" not "added")
- Keep subject line under 50 characters
- Separate subject from body with blank line
- Wrap body at 72 characters
- Reference issues in footer
- Explain WHY, not WHAT (code shows what)
- Use body to provide context

### DON'T:
- Don't capitalize first letter of subject
- Don't end subject with period
- Don't use past tense ("added", "fixed")
- Don't be vague ("fix bug", "update code")
- Don't include multiple unrelated changes
- Don't commit commented-out code

See [reference/message-examples.md](reference/message-examples.md) for advanced examples (issue references, reverts, multiple scopes), commitlint setup, git best practices (atomic commits, interactive staging, amending, squashing), git templates, changelog generation, semantic versioning, team workflows, and tips for writing good commits.

## Quick Checklist

Before committing, verify:

- [ ] Commit follows conventional format
- [ ] Type is correct (feat, fix, etc.)
- [ ] Scope is meaningful (if included)
- [ ] Subject is imperative mood, lowercase, <50 chars
- [ ] Subject doesn't end with period
- [ ] Body explains WHY (if needed)
- [ ] Footer references issues (if applicable)
- [ ] Commit is atomic (one logical change)
- [ ] Tests pass
- [ ] No commented code or debug statements

## Remember

- **Commit messages are documentation** - Write for future developers
- **One commit = one change** - Keep commits atomic
- **Explain WHY, not WHAT** - Code shows what, commits explain why
- **Use conventional format** - Enables automation (changelogs, versioning)
- **Commit often** - Small, focused commits are easier to review and revert
- **Think before you commit** - Good commits = good git history
