# Common Hallucination Patterns & Red Flags

## Common Hallucination Patterns (AVOID!)

### 1. Inventing API Signatures

```typescript
// HALLUCINATION
"Call the API like this:"
fetch('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name, email, password })
})

[Never checked what the API actually expects!]

// EVIDENCE-BASED
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
// HALLUCINATION
"This fix should resolve the issue"
[Didn't run tests]

// EVIDENCE-BASED
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
// HALLUCINATION
"Set the environment variable DATABASE_URL to connect"
[Never checked what env vars are actually used]

// EVIDENCE-BASED
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
// HALLUCINATION
"The error 'User not found' comes from the authentication middleware"
[Never read the actual error source]

// EVIDENCE-BASED
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
// HALLUCINATION
"The components are organized in src/components/ui/"
[Never checked actual structure]

// EVIDENCE-BASED
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

## Red Flags: You're Probably Hallucinating If...

### Red Flag 1: Using Words Like "Probably" or "Should"

```
BAD:
"This probably needs..."
"You should configure..."
"It likely expects..."
"Typically this would..."

GOOD:
"I've read X, and it needs..."
"Based on config.ts:45, configure..."
"According to the API code, it expects..."
"The actual implementation shows..."
```

### Red Flag 2: Haven't Used Read/Grep/Glob Recently

```
If you're making suggestions without recent tool use:
-> STOP
-> Read the actual code
-> THEN make suggestions
```

### Red Flag 3: Describing Code You Haven't Seen

```
BAD:
"The UserService class has methods for CRUD operations"
[How do you know? Did you read it?]

GOOD:
[Read: src/user.service.ts]
"I've read UserService at src/user.service.ts.
It has these methods: create(), findById(), update(), delete().
Note: There's no findAll() method."
```

### Red Flag 4: Assuming Standard Patterns

```
BAD:
"Add the middleware like this:"
app.use(express.json())
[Assuming Express, but what if it's Fastify?]

GOOD:
[Read: src/app.ts or package.json]
[package.json shows: "fastify": "^4.0.0"]
"This project uses Fastify, not Express.
Here's the Fastify equivalent:
app.register(require('@fastify/json'))"
```

### Red Flag 5: Making Absolute Statements Without Evidence

```
BAD:
"This codebase uses Prisma for database access"
[Did you verify this?]

GOOD:
[Read: package.json]
[Shows: "prisma": "^5.0.0"]
[Grep: "import { PrismaClient"]
[Results show usage in src/db.ts]
"Confirmed: This codebase uses Prisma.
PrismaClient is initialized in src/db.ts:5"
```
