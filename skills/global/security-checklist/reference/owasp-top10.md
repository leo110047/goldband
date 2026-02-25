# OWASP Top 10 (2021) - Detailed Examples

## 1. Broken Access Control

**Vulnerability:** Users can access resources they shouldn't

```typescript
// ❌ No access control
app.get('/api/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id)
  res.json(user) // Any user can view any other user's data!
})

// ✅ Proper access control
app.get('/api/users/:id', authenticateUser, async (req, res) => {
  const requestedUserId = req.params.id
  const currentUserId = req.user.id

  // Users can only view their own data, or admins can view anyone
  if (requestedUserId !== currentUserId && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Access denied' })
  }

  const user = await db.users.findById(requestedUserId)
  res.json(user)
})
```

**Prevention:**
- Deny by default
- Implement role-based access control (RBAC)
- Verify ownership before modifying resources
- Don't trust client-side access control

## 2. Cryptographic Failures

**Vulnerability:** Sensitive data exposed due to weak crypto

```typescript
// ❌ Storing plain text passwords
await db.users.create({
  email: 'user@example.com',
  password: 'mypassword123' // Plain text!
})

// ✅ Hash passwords with bcrypt
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

await db.users.create({
  email: 'user@example.com',
  password: await hashPassword('mypassword123')
})

// Verifying password
const isValid = await bcrypt.compare(inputPassword, user.password)
```

```typescript
// ❌ Weak encryption
const encrypted = Buffer.from(sensitiveData).toString('base64') // Not encryption!

// ✅ Proper encryption (AES-256-GCM)
import crypto from 'crypto'

function encrypt(text: string, key: Buffer): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex')
  }
}
```

**Prevention:**
- Use bcrypt/Argon2 for passwords (never MD5/SHA1)
- Use TLS/HTTPS for data in transit
- Encrypt sensitive data at rest
- Use strong random values (crypto.randomBytes, not Math.random)
- Rotate encryption keys regularly

## 3. Injection (SQL, NoSQL, Command)

**SQL Injection:**

```typescript
// ❌ SQL Injection vulnerability
app.get('/users', async (req, res) => {
  const search = req.query.search
  const query = `SELECT * FROM users WHERE name = '${search}'`
  // Input: ' OR '1'='1' --
  // Executes: SELECT * FROM users WHERE name = '' OR '1'='1' --'
  const users = await db.raw(query)
  res.json(users)
})

// ✅ Parameterized queries
app.get('/users', async (req, res) => {
  const search = req.query.search
  const users = await db.query('SELECT * FROM users WHERE name = $1', [search])
  res.json(users)
})

// ✅ ORM (Prisma)
const users = await prisma.user.findMany({
  where: { name: search }
})
```

**Command Injection:**

```typescript
// ❌ Command injection
app.post('/convert', (req, res) => {
  const filename = req.body.filename
  exec(`convert ${filename} output.jpg`, (err, stdout) => {
    // Input: "file.png; rm -rf /"
    // Executes: convert file.png; rm -rf / output.jpg
    res.send('Converted')
  })
})

// ✅ Validate and sanitize input
const { z } = require('zod')

const FilenameSchema = z.string().regex(/^[a-zA-Z0-9_\-\.]+$/)

app.post('/convert', (req, res) => {
  try {
    const filename = FilenameSchema.parse(req.body.filename)
    const safePath = path.join('/uploads', path.basename(filename))
    exec(`convert ${JSON.stringify(safePath)} output.jpg`, (err, stdout) => {
      res.send('Converted')
    })
  } catch (error) {
    res.status(400).json({ error: 'Invalid filename' })
  }
})
```

**NoSQL Injection:**

```typescript
// ❌ NoSQL injection
app.post('/login', async (req, res) => {
  const { username, password } = req.body
  const user = await db.users.findOne({ username, password })
  // Input: { username: { $ne: null }, password: { $ne: null } }
  // Finds user without knowing credentials!
})

// ✅ Type validation
app.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid input' })
  }

  const user = await db.users.findOne({ username })
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  res.json({ token: generateToken(user) })
})
```

**Prevention:**
- Always use parameterized queries/prepared statements
- Use ORMs with proper escaping
- Validate input types (string, number, etc.)
- Never concatenate user input into queries
- Avoid exec/eval with user input

## 4. Insecure Design

**Vulnerability:** Security flaws in architecture

```typescript
// ❌ No rate limiting on password reset
app.post('/reset-password', async (req, res) => {
  const { email } = req.body
  await sendResetEmail(email) // Attacker can spam this endpoint
  res.json({ message: 'Reset email sent' })
})

// ✅ Rate limiting
import rateLimit from 'express-rate-limit'

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 attempts per window
  message: 'Too many password reset attempts, please try again later'
})

app.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const { email } = req.body
  await sendResetEmail(email)
  res.json({ message: 'If that email exists, a reset link has been sent' })
})
```

**Prevention:**
- Design with security from the start
- Implement rate limiting
- Use CAPTCHA for sensitive actions
- Add security headers
- Follow principle of least privilege

## 5. Security Misconfiguration

```typescript
// ❌ Exposing sensitive errors
app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack, // Leaks internal paths!
    query: req.query  // May contain sensitive data
  })
})

// ✅ Generic error messages in production
app.use((err, req, res, next) => {
  // Log full error server-side
  logger.error(err, {
    url: req.url,
    method: req.method,
    userId: req.user?.id
  })

  // Return generic message to client
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  })
})
```

**Security Headers:**

```typescript
import helmet from 'helmet'

app.use(helmet()) // Sets multiple security headers

// Or manually:
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Content-Security-Policy', "default-src 'self'")
  next()
})
```

**Prevention:**
- Remove default credentials
- Disable directory listing
- Remove unnecessary features/endpoints
- Keep dependencies updated
- Use security headers (helmet)
- Don't expose stack traces in production

## 6. Vulnerable and Outdated Components

```bash
# ❌ Never checking for vulnerabilities
npm install express

# ✅ Regular security audits
npm audit
npm audit fix

# Check for known vulnerabilities
npx snyk test

# Automated dependency updates
# Use Dependabot or Renovate
```

**Prevention:**
- Run `npm audit` regularly
- Update dependencies frequently
- Use `npm ci` in CI/CD (locks exact versions)
- Monitor security advisories
- Remove unused dependencies

## 7. Identification and Authentication Failures

**Weak Password Policy:**

```typescript
// ❌ Weak password requirements
if (password.length < 6) {
  throw new Error('Password too short')
}

// ✅ Strong password policy
import passwordValidator from 'password-validator'

const schema = new passwordValidator()
schema
  .is().min(12)                                    // Minimum length 12
  .has().uppercase()                               // Must have uppercase
  .has().lowercase()                               // Must have lowercase
  .has().digits(1)                                 // Must have at least 1 digit
  .has().symbols(1)                                // Must have at least 1 symbol
  .has().not().spaces()                            // Should not have spaces
  .is().not().oneOf(['Password123!', 'Admin123!']) // Blacklist common passwords

if (!schema.validate(password)) {
  throw new Error('Password does not meet requirements')
}
```

**Session Management:**

```typescript
// ❌ Predictable session IDs
const sessionId = `${userId}_${Date.now()}` // Predictable!

// ✅ Cryptographically secure session IDs
import crypto from 'crypto'

const sessionId = crypto.randomBytes(32).toString('hex')

// Session expiration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,        // HTTPS only
    httpOnly: true,      // No JavaScript access
    sameSite: 'strict',  // CSRF protection
    maxAge: 3600000      // 1 hour
  }
}))
```

**JWT Best Practices:**

```typescript
// ✅ Secure JWT implementation
import jwt from 'jsonwebtoken'

function generateToken(user: User): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: '1h',
      issuer: 'your-app',
      audience: 'your-app-users'
    }
  )
}

function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!, {
      issuer: 'your-app',
      audience: 'your-app-users'
    }) as TokenPayload
  } catch (error) {
    throw new Error('Invalid token')
  }
}

// Middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.substring(7)

  try {
    req.user = verifyToken(token)
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' })
  }
}
```

**Prevention:**
- Use strong password requirements
- Implement multi-factor authentication (MFA)
- Use secure session management
- Implement account lockout after failed attempts
- Use cryptographically secure random values

## 8. Software and Data Integrity Failures

**Dependency Integrity:**

```json
// package.json
{
  "dependencies": {
    "express": "^4.18.0"  // ❌ Allows minor updates that could introduce vulnerabilities
  }
}

// ✅ Use package-lock.json and verify checksums
npm ci  // Uses exact versions from package-lock.json
```

**Prevention:**
- Use package-lock.json or yarn.lock
- Verify checksums of downloads
- Use code signing
- Implement CI/CD pipeline checks
- Review dependencies before adding

## 9. Security Logging and Monitoring Failures

```typescript
// ❌ No security logging
app.post('/login', async (req, res) => {
  const user = await authenticate(req.body)
  res.json({ token: generateToken(user) })
  // Failed login attempts not logged!
})

// ✅ Comprehensive security logging
import winston from 'winston'

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'security.log' })
  ]
})

app.post('/login', async (req, res) => {
  const { email, password } = req.body

  try {
    const user = await authenticate(email, password)

    logger.info('Login successful', {
      userId: user.id,
      email: user.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date()
    })

    res.json({ token: generateToken(user) })
  } catch (error) {
    logger.warn('Login failed', {
      email: email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date(),
      reason: 'Invalid credentials'
    })

    res.status(401).json({ error: 'Invalid credentials' })
  }
})
```

**What to Log:**
- Authentication attempts (success and failure)
- Authorization failures
- Input validation failures
- Suspicious activity patterns
- NEVER log passwords or tokens
- NEVER log Personal Identifiable Information (PII)

**Prevention:**
- Log security-relevant events
- Monitor logs for suspicious patterns
- Set up alerts for critical events
- Centralize logging
- Retain logs appropriately

## 10. Server-Side Request Forgery (SSRF)

```typescript
// ❌ SSRF vulnerability
app.get('/fetch', async (req, res) => {
  const url = req.query.url
  const response = await fetch(url)
  // Attacker can request: http://localhost:3000/admin
  // Or: http://169.254.169.254/latest/meta-data/ (AWS metadata)
  res.send(await response.text())
})

// ✅ Whitelist allowed domains
const ALLOWED_DOMAINS = ['api.example.com', 'cdn.example.com']

app.get('/fetch', async (req, res) => {
  const url = req.query.url

  try {
    const parsedUrl = new URL(url)

    // Check if domain is whitelisted
    if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
      return res.status(403).json({ error: 'Domain not allowed' })
    }

    // Prevent localhost and private IP access
    if (parsedUrl.hostname === 'localhost' ||
        parsedUrl.hostname.startsWith('127.') ||
        parsedUrl.hostname.startsWith('192.168.') ||
        parsedUrl.hostname.startsWith('10.')) {
      return res.status(403).json({ error: 'Private IP access denied' })
    }

    const response = await fetch(url)
    res.send(await response.text())
  } catch (error) {
    res.status(400).json({ error: 'Invalid URL' })
  }
})
```

**Prevention:**
- Whitelist allowed domains
- Block private IP ranges
- Validate and sanitize URLs
- Use network segmentation
