# TODOS.md Format Reference

Shared reference for the canonical TODOS.md format used by planning and release documentation workflows.

---

## File Structure

```markdown
# TODOS

## <Skill/Component>
<items sorted P0 first, then P1, P2, P3, P4>

## Completed
<finished items with completion annotation>
```

**Sections:** one per skill or component; items sorted by priority, P0 first.

---

## TODO Item Format

Each item is an H3 under its section:

```markdown
### <Title>

**What:** One-line description of the work.

**Why:** The concrete problem it solves or value it unlocks.

**Context:** The motivation, current state, and starting point, sufficient without the original conversation.

**Effort:** S / M / L / XL
**Priority:** P0 / P1 / P2 / P3 / P4
**Depends on:** <prerequisites, or "None">
```

**Required fields:** What, Why, Context, Effort, Priority
**Optional fields:** Depends on, Blocked by

---

## Priority Definitions

- **P0** — Blocking: must be done before next release
- **P1** — Critical: should be done this cycle
- **P2** — Important: do when P0/P1 are clear
- **P3** — Nice-to-have: revisit after adoption/usage data
- **P4** — Someday: good idea, no urgency

---

## Completed Item Format

When an item is completed, move it to the `## Completed` section preserving its original content and appending:

```markdown
**Completed:** vX.Y.Z (YYYY-MM-DD)
```
