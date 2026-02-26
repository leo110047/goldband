# Subagent Prompt Templates — Expanded Examples

## Implementer Prompt: Complete Example

```markdown
You are implementing a specific task. Read all context files before starting.

## Goal
Add a `parseConfig` function that reads YAML config files and returns validated configuration objects.

## Context Files (Read these FIRST)
- `src/config/types.ts` — The Config type definition you must conform to
- `src/config/defaults.ts` — Default values to merge with parsed config
- `src/config/__tests__/validate.test.ts` — Existing validation tests to understand the pattern
- `package.json` — Check if yaml parsing library is already installed

## Existing Patterns to Follow
- Error handling pattern: see `src/utils/file-reader.ts:15-30` (try/catch with custom error class)
- Validation pattern: see `src/config/validate.ts:8-25` (schema-based with zod)
- Export pattern: named exports, no default exports (consistent across codebase)

## Requirements
1. Export `parseConfig(filePath: string): Promise<Config>` from `src/config/parser.ts`
2. Read YAML file using existing `readFileAsync` from `src/utils/file-reader.ts`
3. Validate against ConfigSchema (zod schema in `src/config/types.ts`)
4. Merge with defaults from `src/config/defaults.ts` (parsed values override defaults)
5. Throw `ConfigError` (from `src/errors.ts`) with descriptive message on:
   - File not found
   - Invalid YAML syntax
   - Schema validation failure
6. Handle all edge cases: empty file (use all defaults), partial config (merge with defaults)

## Deliverables
- Create: `src/config/parser.ts` — The parseConfig implementation
- Create: `src/config/__tests__/parser.test.ts` — Tests covering all 6 requirements
- Modify: `src/config/index.ts` — Add `export { parseConfig } from './parser'`

## Verification
After implementation, run:
- `npx tsc --noEmit` → expected: no errors
- `npx jest src/config/__tests__/parser.test.ts` → expected: all tests pass
- `npx jest --coverage src/config/` → expected: parser.ts > 90% coverage

## Boundaries
- Do NOT modify existing config files (types.ts, defaults.ts, validate.ts)
- Do NOT install new dependencies (use existing yaml library)
- Do NOT add CLI interface or config watching — just the parser function
```

## Spec Reviewer Prompt: Complete Example

```markdown
You are reviewing code for spec compliance. Your job is to verify that the
implementation matches the requirements. Do Not Trust the Report — read actual code.

## Original Requirements
1. Export `parseConfig(filePath: string): Promise<Config>` from `src/config/parser.ts`
2. Read YAML file using existing `readFileAsync` from `src/utils/file-reader.ts`
3. Validate against ConfigSchema (zod schema in `src/config/types.ts`)
4. Merge with defaults from `src/config/defaults.ts` (parsed values override defaults)
5. Throw `ConfigError` with descriptive message on: file not found, invalid YAML, schema failure
6. Handle edge cases: empty file (use all defaults), partial config (merge with defaults)

## Files to Review
- `src/config/parser.ts` (new)
- `src/config/__tests__/parser.test.ts` (new)
- `src/config/index.ts` (modified)

## Review Process
For each of the 6 requirements:
1. FIND the implementation in actual code (grep for relevant function calls, read the code)
2. READ the logic — not just the function signature, the actual implementation
3. VERIFY correctness:
   - Req 1: Is the function exported with the correct signature?
   - Req 2: Does it actually call readFileAsync? (not fs.readFileSync or something else)
   - Req 3: Does it validate with ConfigSchema? (not just parse YAML without validation)
   - Req 4: Does merging work correctly? (parsed overrides defaults, not the other way)
   - Req 5: Are all three error cases handled with ConfigError? (not generic Error)
   - Req 6: Test with empty string input — does it return defaults?
4. Check tests: Does each requirement have at least one test case?

## Output Format
| # | Requirement | Status | Location | Notes |
|---|-------------|--------|----------|-------|
| 1 | ... | Implemented/Partial/Missing/Incorrect | file:line | ... |

Verdict: PASS / FAIL
If FAIL: list specific items that must be fixed.
```

## Code Quality Reviewer Prompt: Complete Example

```markdown
You are reviewing code quality for recently created/modified files.
Read each file carefully and provide a structured assessment.

## Files to Review
- `src/config/parser.ts` (~45 lines, new file)
- `src/config/__tests__/parser.test.ts` (~120 lines, new file)
- `src/config/index.ts` (~8 lines, 1 line added)

## Context
These files implement YAML config parsing. The spec review has already passed —
the implementation is functionally correct. Your job is to assess code quality.

## Review Checklist

### Critical (must fix before merge)
- [ ] Security: Can `filePath` be used for path traversal?
- [ ] Correctness: Any race conditions in file reading?
- [ ] Data integrity: Can parsed config contain unexpected types?

### Important (should fix)
- [ ] Error messages: Are they helpful for debugging? Do they include file path?
- [ ] Performance: Any unnecessary re-parsing or re-validation?
- [ ] Patterns: Does it follow existing codebase conventions?
- [ ] Types: Are types specific enough? (no `any`, no unnecessary type assertions)

### Minor (nice to have)
- [ ] Naming: Are variable/function names clear and consistent?
- [ ] Comments: Is complex logic explained? (don't require comments for obvious code)
- [ ] Test quality: Are test descriptions clear? Are edge cases covered?

## Output Format

### Strengths
- [what was done well]

### Critical Issues
- [issue]: [file:line] — [description] — [suggested fix]

### Important Issues
- [issue]: [file:line] — [description] — [suggested fix]

### Minor Issues
- [issue]: [file:line] — [description] — [suggested fix]

### Assessment
ACCEPT / REVISE (list items) / REJECT (rationale)
```

## Dispatch Patterns

### Single Task Dispatch

Use when: one well-defined task.

```javascript
// In orchestrator:
const result = await dispatchSubagent({
  type: 'general-purpose',
  prompt: implementerPrompt,
});
// Review result
await reviewSpec(result);
await reviewQuality(result);
```

### Sequential Pipeline

Use when: tasks have dependencies.

```
Task 1: Create types → Review →
Task 2: Write tests (uses types) → Review →
Task 3: Implement (passes tests) → Review →
Task 4: Integration → Final review
```

### Parallel Batch

Use when: tasks are independent.

```
Dispatch simultaneously:
  Task A: Implement module A
  Task B: Implement module B
  Task C: Write shared tests

Wait for all → Review each → Integrate
```

## Common Prompt Mistakes

| Mistake | Effect | Fix |
|---------|--------|-----|
| No context files listed | Agent guesses at patterns | List every file to read |
| Requirements not numbered | Hard to track in review | Number each requirement |
| No boundaries section | Agent makes extra changes | Explicitly state what NOT to do |
| No verification commands | Agent can't self-check | Include exact commands + expected output |
| Vague "implement X" goal | Ambiguous deliverables | Specify exact functions, files, behaviors |
