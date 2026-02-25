# Verification & Evidence Collection Workflows

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
// HALLUCINATION
"The calculateDiscount function applies a 10% discount to VIP users"
[Never read the actual code]

// EVIDENCE-BASED
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
# HALLUCINATION
"The configuration is in config/database.ts"
[File doesn't exist - was guessing]

# EVIDENCE-BASED
[Glob: "**/database*"]
[Results show: src/config/db.config.ts]
[Read: src/config/db.config.ts]
"The database configuration is in src/config/db.config.ts"
```

## Evidence Collection Workflows

### Workflow 1: Understanding a Function

```bash
# 1. Find the function
Grep: "function calculatePrice"
-> Found in: src/pricing/calculator.ts:45

# 2. Read the function
Read: src/pricing/calculator.ts (lines 45-60)

# 3. Find its tests
Grep: "calculatePrice" in **/*.test.ts
-> Found in: tests/pricing.test.ts

# 4. Read the tests to understand behavior
Read: tests/pricing.test.ts

# 5. Check for type definitions
Grep: "CalculatePrice" in **/*.ts
-> Found in: src/pricing/types.ts

# 6. Now you have complete evidence:
# - Implementation
# - Tests showing expected behavior
# - Type definitions
# -> Make informed suggestions
```

### Workflow 2: Proposing an API Change

```bash
# 1. Find the endpoint
Grep: "app.post('/api/orders"
-> Found in: src/api/orders.ts:23

# 2. Read current implementation
Read: src/api/orders.ts

# 3. Find validation schema
Grep: "OrderSchema"
-> Found in: src/api/schemas/order.schema.ts

# 4. Read validation rules
Read: src/api/schemas/order.schema.ts

# 5. Find existing tests
Glob: "**/*order*.test.ts"
-> Found: tests/api/orders.test.ts

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
-> Multiple matches

# 3. Narrow down with stack trace
[User provides: "at getUserProfile (src/user.service.ts:89)"]

# 4. Read the actual line
Read: src/user.service.ts (around line 89)

# 5. Check what called it
Grep: "getUserProfile" in src/**/*.ts

# 6. Read the caller
Read: [calling file]

# 7. Check the data flow
# -> Identify where 'undefined' is introduced

# 8. Verify with tests
Grep: "getUserProfile" in tests/**/*.ts
Read: [test file]

# Now you have evidence-based understanding
```
