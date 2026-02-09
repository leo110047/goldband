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
| `feat` | New feature | ✅ Yes | Minor (0.x.0) |
| `fix` | Bug fix | ✅ Yes | Patch (0.0.x) |
| `docs` | Documentation only | ❌ No | None |
| `style` | Code style (formatting, semicolons) | ❌ No | None |
| `refactor` | Code change that neither fixes bug nor adds feature | ❌ No | None |
| `perf` | Performance improvement | ✅ Yes | Patch |
| `test` | Adding or updating tests | ❌ No | None |
| `build` | Build system or dependencies | ❌ No | None |
| `ci` | CI/CD configuration | ❌ No | None |
| `chore` | Other changes (tooling, config) | ❌ No | None |
| `revert` | Revert previous commit | ✅ Yes | Depends |

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

### Documentation

```
docs: update API authentication examples

Add examples for OAuth2 flow and improve JWT documentation.
```

### Refactor

```
refactor(database): extract query builders into separate module

No functional changes. Improves code organization and testability.
```

### Performance

```
perf(api): add Redis caching for user profile queries

Reduces database load by 60% for frequently accessed profiles.
Cache TTL set to 5 minutes.
```

### Multiple Issues

```
fix(auth): resolve session timeout and cookie issues

- Fix session timeout not being respected
- Set secure flag on cookies in production
- Add SameSite=Strict for CSRF protection

Fixes #123, #124, #125
```

## Quick Reference

### Good Commits

```bash
✅ feat(auth): add password reset functionality
✅ fix(api): prevent race condition in order processing
✅ docs(readme): add installation instructions
✅ perf(database): optimize user search query
✅ test(auth): add integration tests for login flow
✅ refactor(ui): extract button component
```

### Bad Commits

```bash
❌ Fixed bug                           # Not descriptive
❌ WIP                                 # Work in progress, not final
❌ Updated stuff                       # Too vague
❌ feat(auth): Added password reset.   # Don't use past tense or period
❌ FEAT: add feature                   # Don't capitalize type
❌ fix: this fixes the bug that was causing the app to crash when users tried to login with invalid credentials  # Too long (>50 chars)
```

## Commit Message Rules

### DO:
- ✅ Use imperative mood ("add" not "added")
- ✅ Keep subject line under 50 characters
- ✅ Separate subject from body with blank line
- ✅ Wrap body at 72 characters
- ✅ Reference issues in footer
- ✅ Explain WHY, not WHAT (code shows what)
- ✅ Use body to provide context

### DON'T:
- ❌ Don't capitalize first letter of subject
- ❌ Don't end subject with period
- ❌ Don't use past tense ("added", "fixed")
- ❌ Don't be vague ("fix bug", "update code")
- ❌ Don't include multiple unrelated changes
- ❌ Don't commit commented-out code

## Advanced Examples

### With Issue References

```
feat(payment): integrate Stripe payment gateway

Add Stripe SDK and implement payment processing flow.
Support credit cards and Apple Pay.

Relates to #123
Closes #234
```

### Revert Commit

```
revert: feat(auth): add JWT token refresh

This reverts commit abc123def456.

Reverting due to security concerns discovered in code review.
Will reimplement with proper validation in next sprint.

Reopens #234
```

### Multiple Scopes

```
feat(api,ui): add real-time notifications

Backend:
- Add WebSocket server
- Implement notification queue

Frontend:
- Add notification component
- Connect to WebSocket

Closes #345
```

## Setting Up Commitlint

**Install:**

```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional
```

**commitlint.config.js:**

```javascript
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert'
      ]
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case']],
    'subject-max-length': [2, 'always', 50],
    'body-max-line-length': [2, 'always', 72]
  }
}
```

**Husky Hook (.husky/commit-msg):**

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no -- commitlint --edit "$1"
```

## Git Best Practices

### Commit Often

```bash
# ❌ One giant commit
git add .
git commit -m "feat: implement entire user management system"

# ✅ Multiple focused commits
git add src/auth/
git commit -m "feat(auth): add user registration"

git add src/auth/login.ts
git commit -m "feat(auth): add login functionality"

git add tests/auth/
git commit -m "test(auth): add authentication tests"
```

### Atomic Commits

Each commit should:
- Contain one logical change
- Pass all tests
- Leave codebase in working state
- Be independently revertable

### Commit Early, Commit Often

```bash
# Good workflow
git add src/user.service.ts
git commit -m "feat(user): add getUserById method"

git add src/user.service.ts
git commit -m "feat(user): add updateUser method"

git add tests/user.service.test.ts
git commit -m "test(user): add user service tests"
```

## Interactive Staging

```bash
# Stage specific changes
git add -p src/user.service.ts

# Stage specific files
git add src/user.service.ts tests/user.test.ts

# Review what will be committed
git diff --staged
```

## Amending Commits (Local Only!)

```bash
# Forgot to add a file
git add forgotten-file.ts
git commit --amend --no-edit

# Fix commit message
git commit --amend -m "feat(auth): add password validation"
```

⚠️ **Never amend pushed commits** - This rewrites history!

## Squashing Commits (Before Merging)

```bash
# Interactive rebase to squash multiple commits
git rebase -i HEAD~3

# In editor, change "pick" to "squash" (or "s") for commits to combine:
pick abc123 feat(auth): add login form
squash def456 fix(auth): fix form validation
squash ghi789 style(auth): improve button styling

# Result: one clean commit
feat(auth): add login form with validation
```

## Using Git Templates

**Create template (~/.gitmessage):**

```
# <type>(<scope>): <subject>
# |<----  Using a Maximum Of 50 Characters  ---->|


# Explain why this change is being made
# |<----   Try To Limit Each Line to a Maximum Of 72 Characters   ---->|


# Provide links or keys to any relevant tickets, articles or other resources
# Example: Fixes #23

# --- COMMIT END ---
# Type can be
#    feat     (new feature)
#    fix      (bug fix)
#    refactor (refactoring code)
#    style    (formatting, missing semicolons, etc; no code change)
#    docs     (changes to documentation)
#    test     (adding or refactoring tests; no production code change)
#    chore    (updating build tasks, package manager configs, etc)
# --------------------
# Remember to:
#   - Use imperative mood in the subject line
#   - Do not end the subject line with a period
#   - Separate subject from body with a blank line
#   - Use the body to explain what and why vs. how
#   - Reference issues and pull requests after the body
# --------------------
```

**Configure Git:**

```bash
git config --global commit.template ~/.gitmessage
```

## Changelog Generation

**With conventional-changelog:**

```bash
npm install --save-dev conventional-changelog-cli

# Generate changelog
npx conventional-changelog -p angular -i CHANGELOG.md -s
```

**CHANGELOG.md output:**

```markdown
# Changelog

## [1.2.0] - 2024-01-15

### Features
- **auth**: add JWT token refresh mechanism (#234)
- **payment**: integrate Stripe payment gateway (#345)

### Bug Fixes
- **api**: handle null values in user profile endpoint (#456)
- **auth**: resolve session timeout issues (#123, #124)

### Performance Improvements
- **database**: optimize user search query

## [1.1.0] - 2024-01-01
...
```

## Semantic Versioning

Conventional commits enable automatic versioning:

```
Given version 1.2.3:

feat:     1.3.0 (minor bump)
fix:      1.2.4 (patch bump)
perf:     1.2.4 (patch bump)
BREAKING: 2.0.0 (major bump)
```

**With semantic-release:**

```bash
npm install --save-dev semantic-release

# Automatically:
# - Determine version bump
# - Generate changelog
# - Create git tag
# - Publish to npm
npx semantic-release
```

## Team Workflow Example

```bash
# Create feature branch
git checkout -b feat/user-authentication

# Make focused commits
git commit -m "feat(auth): add user model and schema"
git commit -m "feat(auth): implement registration endpoint"
git commit -m "test(auth): add registration tests"
git commit -m "docs(auth): add API documentation"

# Push branch
git push origin feat/user-authentication

# Create PR with title matching commit convention
# PR title: "feat(auth): add user authentication"

# After review, squash and merge
# Final commit in main: "feat(auth): add user authentication (#789)"
```

## Tips for Writing Good Commits

### 1. Commit the WHY, not the WHAT

```bash
# ❌ Describes WHAT
git commit -m "fix(api): change status code from 500 to 404"

# ✅ Explains WHY
git commit -m "fix(api): return 404 instead of 500 for missing resources

Previously returned 500 which triggered error monitoring alerts.
404 is semantically correct for missing resources."
```

### 2. Use Present Tense, Imperative Mood

```bash
# ❌ Past tense
git commit -m "feat(auth): added login feature"

# ❌ Present continuous
git commit -m "feat(auth): adding login feature"

# ✅ Imperative mood
git commit -m "feat(auth): add login feature"
```

Think: "This commit will **add login feature**"

### 3. Separate Concerns

```bash
# ❌ Multiple unrelated changes
git commit -m "feat(auth): add login and fix database and update docs"

# ✅ Separate commits
git commit -m "feat(auth): add login functionality"
git commit -m "fix(database): resolve connection timeout"
git commit -m "docs: update authentication guide"
```

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

