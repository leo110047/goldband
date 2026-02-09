---
name: evidence-based-coding
description: |
  Prevent AI hallucinations by enforcing evidence-based coding practices.
  ALWAYS verify assumptions with actual code/files/tests before making claims.

  Use when: suggesting code changes, claiming "this function does X", referencing APIs,
  proposing fixes, or making any statement about the codebase.

  CRITICAL: This skill enforces the principle "Show me the evidence" - never assume, always verify.
priority: CRITICAL
enforced-globally: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Evidence-Based Coding - Eliminating AI Hallucinations

## Core Principle

```
NEVER ASSUME. ALWAYS VERIFY.
NO CLAIMS WITHOUT EVIDENCE.
```

**Golden Rule:** If you haven't read the actual code, you don't know what it does.

## When to Use This Skill

**Always active.** This skill should govern ALL coding activities:

- Before suggesting any code change
- Before claiming "this function does X"
- Before saying "the API expects Y"
- Before proposing a fix
- Before stating "file Z exists at path W"
- Before making ANY claim about the codebase

## The Three Laws of Evidence-Based Coding

### Law 1: Read Before You Speak

**Never make claims about code you haven't read.**

```
❌ WRONG APPROACH:
User: "Fix the getUserById function"
AI: "The getUserById function probably looks like this..."
    [generates code based on assumptions]

✅ EVIDENCE-BASED APPROACH:
User: "Fix the getUserById function"
AI: [Uses Grep to find getUserById]
    [Uses Read to examine actual implementation]
    [Analyzes actual code]
    "I've read the getUserById function at src/user.service.ts:45.
    It currently does X, and the issue is Y. Here's the fix..."
```

### Law 2: Verify Before You Claim

**Every factual statement must be backed by tool evidence.**

```
❌ HALLUCINATION:
"This API endpoint expects a JSON body with userId and email fields."
[Assumption - no evidence]

✅ EVIDENCE-BASED:
[Read API documentation or actual endpoint code]
"Looking at src/api/user.ts:23, the endpoint expects:
{
  userId: string,
  email: string,
  role?: 'user' | 'admin'
}"
[Shows actual code as evidence]
```

### Law 3: Test, Don't Guess

**Uncertainty requires investigation, not speculation.**

```
❌ GUESSING:
"This should probably work if we change X to Y"
[No verification]

✅ EVIDENCE-BASED:
[Make change]
[Run tests]
"I've changed X to Y. Tests show:
- ✓ 15 tests passing
- ✗ 1 test failing: 'should handle null values'
The failing test reveals we need to add null checking."
[Evidence from test output]
```

## Mandatory Verification Workflows

### Before Suggesting Code Changes

**ALWAYS:**

1. **Search for existing code** (Grep/Glob)
2. **Read actual implementation** (Read)
3. **Understand current behavior**
4. **THEN propose changes**

```bash
# Step 1: Find the code
Grep for "function processPayment"

# Step 2: Read it
Read src/payment/processor.ts

# Step 3: Understand dependencies
Read src/payment/types.ts
Grep for "PaymentStatus"

# Step 4: NOW make informed suggestions
```

### Before Claiming "This Function Does X"

**ALWAYS:**

1. **Find the function** (Grep)
2. **Read its implementation** (Read)
3. **Check its tests** (Grep for test files)
4. **THEN describe what it does**

```typescript
// ❌ HALLUCINATION
"The calculateDiscount function applies a 10% discount to VIP users"
[Never read the actual code]

// ✅ EVIDENCE-BASED
[Grep: "function calculateDiscount"]
[Read: src/pricing.ts]
[Actual code shows:]
function calculateDiscount(price: number, userType: string) {
  if (userType === "VIP") return price * 0.85  // 15% discount!
  return price
}

"I've read calculateDiscount at src/pricing.ts:42.
It gives VIP users a 15% discount (multiplies by 0.85), not 10%."
```

### Before Claiming File Paths

**ALWAYS:**

1. **Use Glob to verify file exists**
2. **Use Read to confirm contents**
3. **THEN reference the path**

```bash
# ❌ HALLUCINATION
"The configuration is in config/database.ts"
[File doesn't exist - was guessing]

# ✅ EVIDENCE-BASED
[Glob: "**/database*"]
[Results show: src/config/db.config.ts]
[Read: src/config/db.config.ts]
"The database configuration is in src/config/db.config.ts"
```

## Common Hallucination Patterns (AVOID!)

### 1. Inventing API Signatures

```typescript
// ❌ HALLUCINATION
"Call the API like this:"
fetch('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name, email, password })
})

[Never checked what the API actually expects!]

// ✅ EVIDENCE-BASED
[Read: src/api/users.ts or API documentation]
[Actual endpoint code shows:]
app.post('/api/users', validateBody(UserCreateSchema), ...)

[Check schema:]
const UserCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(['user', 'admin'])
})

"Based on UserCreateSchema at src/api/schemas.ts:15,
the API expects: { email, password, role }.
Note: 'name' is not part of the schema."
```

### 2. Assuming Without Testing

```typescript
// ❌ HALLUCINATION
"This fix should resolve the issue"
[Didn't run tests]

// ✅ EVIDENCE-BASED
[Make fix]
[Run: npm test]
[Output shows:]
  ✓ should process valid payments (23ms)
  ✓ should reject invalid cards (15ms)
  ✗ should handle network errors (45ms)
    Expected: 'Payment failed'
    Received: 'Network error'

"The fix resolves the card validation issue,
but test output shows we need to handle network errors differently."
```

### 3. Guessing at Configuration

```typescript
// ❌ HALLUCINATION
"Set the environment variable DATABASE_URL to connect"
[Never checked what env vars are actually used]

// ✅ EVIDENCE-BASED
[Grep: "process.env"]
[Results in src/config/db.ts:]
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
}

"Based on src/config/db.ts:12, you need these env vars:
DB_HOST, DB_PORT (defaults to 5432), DB_NAME, DB_USER, DB_PASSWORD.
Not DATABASE_URL - that's not used in this codebase."
```

### 4. Fabricating Error Messages

```typescript
// ❌ HALLUCINATION
"The error 'User not found' comes from the authentication middleware"
[Never read the actual error source]

// ✅ EVIDENCE-BASED
[Grep: "User not found"]
[Results show:]
src/api/user.ts:67: throw new Error('User not found')
src/middleware/auth.ts:34: throw new Error('Invalid token')

"The error 'User not found' is thrown in src/api/user.ts:67,
not in the authentication middleware.
The auth middleware throws 'Invalid token' instead."
```

### 5. Inventing File Structures

```typescript
// ❌ HALLUCINATION
"The components are organized in src/components/ui/"
[Never checked actual structure]

// ✅ EVIDENCE-BASED
[Glob: "src/components/**/*"]
[Results show:]
src/components/Button.tsx
src/components/forms/LoginForm.tsx
src/components/forms/SignupForm.tsx
src/ui/Modal.tsx
src/ui/Tooltip.tsx

"The codebase uses two locations:
- src/components/ for business components (Button, forms/)
- src/ui/ for reusable UI elements (Modal, Tooltip)
There's no src/components/ui/ directory."
```

## Evidence Collection Workflows

### Workflow 1: Understanding a Function

```bash
# 1. Find the function
Grep: "function calculatePrice"
→ Found in: src/pricing/calculator.ts:45

# 2. Read the function
Read: src/pricing/calculator.ts (lines 45-60)

# 3. Find its tests
Grep: "calculatePrice" in **/*.test.ts
→ Found in: tests/pricing.test.ts

# 4. Read the tests to understand behavior
Read: tests/pricing.test.ts

# 5. Check for type definitions
Grep: "CalculatePrice" in **/*.ts
→ Found in: src/pricing/types.ts

# 6. Now you have complete evidence:
# - Implementation
# - Tests showing expected behavior
# - Type definitions
# → Make informed suggestions
```

### Workflow 2: Proposing an API Change

```bash
# 1. Find the endpoint
Grep: "app.post('/api/orders"
→ Found in: src/api/orders.ts:23

# 2. Read current implementation
Read: src/api/orders.ts

# 3. Find validation schema
Grep: "OrderSchema"
→ Found in: src/api/schemas/order.schema.ts

# 4. Read validation rules
Read: src/api/schemas/order.schema.ts

# 5. Find existing tests
Glob: "**/*order*.test.ts"
→ Found: tests/api/orders.test.ts

# 6. Read test cases
Read: tests/api/orders.test.ts

# 7. Check for existing issues
Grep: "TODO" or "FIXME" in src/api/orders.ts

# Now propose changes with full context
```

### Workflow 3: Debugging an Error

```bash
# 1. Read the error message carefully
[User provides error: "TypeError: Cannot read property 'id' of undefined"]

# 2. Find where this could occur
Grep: ".id" in src/**/*.ts
→ Multiple matches

# 3. Narrow down with stack trace
[User provides: "at getUserProfile (src/user.service.ts:89)"]

# 4. Read the actual line
Read: src/user.service.ts (around line 89)

# 5. Check what called it
Grep: "getUserProfile" in src/**/*.ts

# 6. Read the caller
Read: [calling file]

# 7. Check the data flow
# → Identify where 'undefined' is introduced

# 8. Verify with tests
Grep: "getUserProfile" in tests/**/*.ts
Read: [test file]

# Now you have evidence-based understanding
```

## Red Flags: You're Probably Hallucinating If...

### 🚩 Red Flag 1: Using Words Like "Probably" or "Should"

```
❌ "This probably needs..."
❌ "You should configure..."
❌ "It likely expects..."
❌ "Typically this would..."

✅ "I've read X, and it needs..."
✅ "Based on config.ts:45, configure..."
✅ "According to the API code, it expects..."
✅ "The actual implementation shows..."
```

### 🚩 Red Flag 2: Haven't Used Read/Grep/Glob Recently

```
If you're making suggestions without recent tool use:
→ STOP
→ Read the actual code
→ THEN make suggestions
```

### 🚩 Red Flag 3: Describing Code You Haven't Seen

```
❌ "The UserService class has methods for CRUD operations"
[How do you know? Did you read it?]

✅ [Read: src/user.service.ts]
"I've read UserService at src/user.service.ts.
It has these methods: create(), findById(), update(), delete().
Note: There's no findAll() method."
```

### 🚩 Red Flag 4: Assuming Standard Patterns

```
❌ "Add the middleware like this:"
app.use(express.json())
[Assuming Express, but what if it's Fastify?]

✅ [Read: src/app.ts or package.json]
[package.json shows: "fastify": "^4.0.0"]
"This project uses Fastify, not Express.
Here's the Fastify equivalent:
app.register(require('@fastify/json'))"
```

### 🚩 Red Flag 5: Making Absolute Statements Without Evidence

```
❌ "This codebase uses Prisma for database access"
[Did you verify this?]

✅ [Read: package.json]
[Shows: "prisma": "^5.0.0"]
[Grep: "import { PrismaClient"]
[Results show usage in src/db.ts]
"Confirmed: This codebase uses Prisma.
PrismaClient is initialized in src/db.ts:5"
```

## The Evidence Chain

Every claim should have a traceable evidence chain:

```
Claim: "The login function validates email format"

Evidence chain:
1. [Grep: "function login"] → Found in src/auth.ts:34
2. [Read: src/auth.ts:34-50] → See implementation
3. [Code shows: z.string().email()] → Zod email validation
4. [Grep: "login.*test"] → Found test file
5. [Read: tests/auth.test.ts:12] → Test confirms validation

✅ VERIFIED: The login function validates email using Zod's .email() validator
```

## Verification Checklist

Before making ANY claim, verify:

**File/Path Claims:**
- [ ] Used Glob to verify file exists
- [ ] Used Read to confirm contents
- [ ] Path is exact, not guessed

**Function/API Claims:**
- [ ] Used Grep to find function
- [ ] Used Read to examine implementation
- [ ] Checked tests to understand behavior

**Configuration Claims:**
- [ ] Read actual config files
- [ ] Checked environment variable usage
- [ ] Verified against documentation

**Error/Bug Claims:**
- [ ] Read error message completely
- [ ] Found error source with Grep
- [ ] Read surrounding context
- [ ] Checked for related issues

**Fix Proposals:**
- [ ] Read code being fixed
- [ ] Understand root cause
- [ ] Ran tests after fix
- [ ] Verified fix resolves issue

## Anti-Hallucination Mantras

Repeat these before every suggestion:

1. **"Have I read the actual code?"**
   - If no → Use Grep + Read first

2. **"Am I making assumptions?"**
   - If yes → Verify with tools

3. **"Can I point to specific files/lines?"**
   - If no → You're probably hallucinating

4. **"Did I test this claim?"**
   - If no → Run tests or verify

5. **"Would this be obvious to someone who read the code?"**
   - If no → Read the code yourself

## Integration with Other Skills

### With `systematic-debugging`

```
When debugging:
1. Use evidence-based-coding to gather facts
2. Use systematic-debugging to analyze systematically
3. Never guess - both skills demand evidence
```

### With `code-review-skill`

```
When reviewing:
1. Read the actual code being reviewed
2. Don't assume - verify behavior with tests
3. Reference specific lines when giving feedback
```

### With `backend-patterns`

```
When suggesting patterns:
1. Read existing codebase patterns first
2. Don't assume standard patterns apply
3. Adapt suggestions to actual codebase structure
```

## Success Metrics

You're following evidence-based coding when:

- ✅ Every suggestion references specific files/lines
- ✅ Claims are backed by tool output
- ✅ You say "I've read..." instead of "This should..."
- ✅ Uncertainty triggers investigation, not guessing
- ✅ File paths are verified with Glob
- ✅ Function behavior is checked by reading tests
- ✅ Fixes are verified by running tests

You're hallucinating when:

- ❌ Using words like "probably", "should", "likely"
- ❌ Haven't used Read/Grep/Glob recently
- ❌ Can't point to specific file:line
- ❌ Making claims without tool evidence
- ❌ Assuming standard patterns
- ❌ Describing code you haven't read

## Remember

- **"Show me the code"** - Read before you speak
- **"Verify, don't trust"** - Even your own assumptions
- **"Test, don't guess"** - Run it to prove it
- **"Evidence over intuition"** - Facts beat hunches
- **"Read the source"** - It's the ultimate truth

## The Ultimate Rule

```
IF YOU HAVEN'T READ IT, YOU DON'T KNOW IT.
IF YOU DON'T KNOW IT, DON'T CLAIM IT.
IF YOU'RE UNCERTAIN, INVESTIGATE.
```

**NO EXCEPTIONS.**

