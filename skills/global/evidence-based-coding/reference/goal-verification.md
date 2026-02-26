# Goal-Backward Verification

## Core Principle

```
VERIFY FROM THE GOAL BACKWARD, NOT FROM THE CODE FORWARD.
```

Starting from code and asking "is this correct?" biases toward confirmation. Starting from the goal and asking "is this achieved?" catches gaps.

## Three-Level Verification

Every goal must pass all three levels:

### Level 1: EXISTS

**Question**: Does code exist that addresses this goal?

**How to check**:
- Grep for relevant function names, class names, route handlers
- Glob for expected file paths
- If nothing found → goal is **UNIMPLEMENTED**

```
Example:
  Goal: "User can reset their password"
  Search: grep -r "resetPassword\|reset-password\|password.*reset" src/
  Result: Found → proceed to Level 2
  Result: Nothing → UNIMPLEMENTED
```

### Level 2: SUBSTANTIVE

**Question**: Is the implementation substantive (not a stub, placeholder, or partial)?

**How to check**:
- Read the actual implementation code
- Scan for anti-patterns indicating non-implementation:

```regex
Anti-pattern indicators:
  TODO|FIXME|PLACEHOLDER|HACK|XXX
  return null|return \{\}|return \[\]|return undefined
  => \{\}|=> \{ \}
  throw new Error\('not implemented'\)
  pass  # Python
  unimplemented!  # Rust
  // removed|// deleted|// commented out
```

- If anti-patterns found → goal is **STUBBED** (not truly implemented)
- Verify the function body has real logic, not just a skeleton

```
Example:
  Goal: "User can reset their password"
  Read: src/auth/reset-password.ts
  Found: async function resetPassword() { /* TODO */ return null; }
  Result: STUBBED — not a real implementation
```

### Level 3: WIRED

**Question**: Is the implementation connected to the system? Can a user actually trigger it?

**How to check**:
- Trace from entry point (route, UI button, CLI command) to implementation
- Verify:
  - Route/endpoint is registered
  - UI element triggers the action
  - Function is imported and called (not just defined)
  - Feature flag is enabled (if applicable)

```
Example:
  Goal: "User can reset their password"
  Check route: grep -r "reset-password" src/routes/ → found in auth.routes.ts
  Check UI: grep -r "resetPassword\|reset.*password" src/components/ → found in ForgotPassword.tsx
  Check import: grep -r "from.*reset-password" src/ → imported in auth.controller.ts
  Result: WIRED — implementation is connected
```

## Anti-Pattern Catalog

### Code-Level Anti-Patterns

| Pattern | Regex | What It Means |
|---------|-------|---------------|
| TODO markers | `TODO\|FIXME\|HACK\|XXX` | Acknowledged incomplete work |
| Empty returns | `return null\|return \{\}\|return \[\]` | Stub returning nothing useful |
| Empty functions | `=> \{\}\|=> \{ \}` | No-op placeholder |
| Not implemented errors | `not.implemented\|NotImplemented` | Explicit placeholder |
| Commented code | `// .*return\|# .*return` | Disabled logic |
| Hardcoded values | `return ['admin']\|return 'test'` | Fake implementation |

### Architecture-Level Anti-Patterns

| Pattern | How to Detect | What It Means |
|---------|---------------|---------------|
| Dead code | Function defined but never imported/called | Implementation exists but isn't wired |
| Orphaned routes | Route defined but handler is empty or missing | Endpoint exists but doesn't work |
| Missing middleware | Route exists but auth/validation middleware not applied | Feature works but isn't protected |
| Disconnected UI | Button exists but onClick is empty or commented | UI looks done but isn't functional |

## Verification Output Format

For each goal, report status at all three levels:

```
GOAL VERIFICATION: [goal description]
======================================

| Goal | EXISTS | SUBSTANTIVE | WIRED | Status |
|------|--------|-------------|-------|--------|
| [goal 1] | ✓ file:line | ✓ real logic | ✓ route + UI | VERIFIED |
| [goal 2] | ✓ file:line | ✗ TODO stub | — | STUBBED |
| [goal 3] | ✗ not found | — | — | MISSING |
| [goal 4] | ✓ file:line | ✓ real logic | ✗ not imported | DEAD CODE |

OVERALL: [X/Y goals verified]
BLOCKING: [list of unverified goals]
```

## Complete Walkthrough Example

**Goal**: "Users can export their data as CSV"

### Level 1: EXISTS
```bash
# Search for export/CSV related code
grep -r "export.*csv\|csv.*export\|toCSV\|generateCSV" src/
```
Found: `src/services/export.service.ts:42` — `exportToCSV()` function
→ EXISTS: ✓

### Level 2: SUBSTANTIVE
```bash
# Read the implementation
# Read src/services/export.service.ts lines 42-80
```
Found: Function has 38 lines, processes data rows, formats CSV with headers, handles special characters in cell values.
No TODO/FIXME markers. No stub returns.
→ SUBSTANTIVE: ✓

### Level 3: WIRED
```bash
# Find where it's called
grep -r "exportToCSV\|export.*service" src/routes/ src/controllers/ src/components/
```
Found:
- `src/routes/data.routes.ts:15` — `GET /api/data/export?format=csv`
- `src/controllers/data.controller.ts:67` — calls `exportService.exportToCSV()`
- `src/components/DataTable.tsx:89` — "Export CSV" button with onClick handler

→ WIRED: ✓

**Result**: VERIFIED — goal is fully implemented, substantive, and connected.

## Integration with the Iron Law

Goal-backward verification complements the Iron Law:

- **Iron Law**: "Is this task done?" (completion verification)
- **Goal Verification**: "Does the system achieve the goal?" (outcome verification)

Use both:
1. Run goal verification to confirm all goals are met (EXISTS + SUBSTANTIVE + WIRED)
2. Run the Iron Law 5-Step Gate to confirm completion with fresh evidence
3. Only then claim the work is complete
