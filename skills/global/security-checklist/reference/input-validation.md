# Input Validation - Detailed Examples

## Always Validate on Server-Side

Client-side validation (HTML `required`, `type="email"`, etc.) can always be bypassed with curl, Postman, or browser dev tools. Server-side validation is mandatory.

```typescript
// ❌ Client-side only validation
// <input type="email" required>
// Attacker can bypass with curl/Postman!

// ✅ Server-side validation with Zod
import { z } from 'zod'

const UserSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18).max(120),
  password: z.string().min(12),
  role: z.enum(['user', 'admin'])
})

app.post('/users', async (req, res) => {
  try {
    const validated = UserSchema.parse(req.body)
    const user = await createUser(validated)
    res.json(user)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
    }
    throw error
  }
})
```

## Sanitize HTML Input (XSS Prevention)

Cross-Site Scripting (XSS) occurs when user-supplied data is rendered as HTML without sanitization, allowing attackers to inject malicious scripts.

```typescript
// ❌ Directly rendering user input
app.get('/profile/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id)
  res.send(`<h1>${user.bio}</h1>`)
  // If bio contains: <script>alert('XSS')</script>
  // It will execute!
})

// ✅ Sanitize HTML
import DOMPurify from 'isomorphic-dompurify'

app.get('/profile/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id)
  const safeBio = DOMPurify.sanitize(user.bio)
  res.send(`<h1>${safeBio}</h1>`)
})

// ✅ Use templating engines with auto-escaping
// React, Vue, Angular auto-escape by default
const Profile = ({ user }) => <h1>{user.bio}</h1> // Automatically escaped
```

## Key Principles

- **Validate types** - Ensure inputs match expected types (string, number, enum)
- **Validate ranges** - Check min/max lengths, numeric ranges, date bounds
- **Validate format** - Use regex or schema validators for emails, URLs, phone numbers
- **Sanitize output** - Even after validation, sanitize when rendering as HTML
- **Use established libraries** - Zod, Joi, Yup for validation; DOMPurify for sanitization
- **Reject by default** - Whitelist acceptable input rather than blacklisting bad input
