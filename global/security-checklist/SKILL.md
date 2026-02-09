---
name: security-checklist
description: |
  Security best practices and vulnerability prevention for web applications.
  Covers OWASP Top 10, authentication, authorization, input validation, and secure coding practices.

  Use when: implementing authentication, handling user input, storing sensitive data, building APIs,
  deploying applications, reviewing security, or conducting security audits.

  Focus: Preventing common vulnerabilities, not penetration testing or ethical hacking.
allowed-tools:
  - Read
  - Grep
  - Glob
  - WebFetch  # Check security advisories
---

# Security Checklist - Building Secure Applications

## When to Use This Skill

- Implementing authentication and authorization
- Handling user input and file uploads
- Storing sensitive data (passwords, tokens, PII)
- Building APIs and web services
- Deploying applications to production
- Reviewing code for security vulnerabilities
- Conducting security audits
- Responding to security advisories

## OWASP Top 10 (2021)

### 1. Broken Access Control

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

### 2. Cryptographic Failures

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

### 3. Injection (SQL, NoSQL, Command)

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

### 4. Insecure Design

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

### 5. Security Misconfiguration

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

### 6. Vulnerable and Outdated Components

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

### 7. Identification and Authentication Failures

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

### 8. Software and Data Integrity Failures

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

### 9. Security Logging and Monitoring Failures

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
- ✅ Authentication attempts (success and failure)
- ✅ Authorization failures
- ✅ Input validation failures
- ✅ Suspicious activity patterns
- ❌ Passwords or tokens
- ❌ Personal identifiable information (PII)

**Prevention:**
- Log security-relevant events
- Monitor logs for suspicious patterns
- Set up alerts for critical events
- Centralize logging
- Retain logs appropriately

### 10. Server-Side Request Forgery (SSRF)

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

## Input Validation

### Always Validate on Server-Side

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

### Sanitize HTML Input (XSS Prevention)

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

## File Upload Security

```typescript
import multer from 'multer'
import path from 'path'
import crypto from 'crypto'

// ❌ Insecure file upload
app.post('/upload', upload.single('file'), (req, res) => {
  // No validation! Attacker can upload .exe, .php, etc.
  res.json({ filename: req.file.filename })
})

// ✅ Secure file upload
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    // Generate random filename to prevent path traversal
    const randomName = crypto.randomBytes(16).toString('hex')
    const ext = path.extname(file.originalname)
    cb(null, `${randomName}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'))
    }
    cb(null, true)
  }
})

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  res.json({
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype
  })
})
```

**File Upload Checklist:**
- [ ] Validate file type (check MIME type AND file extension)
- [ ] Limit file size
- [ ] Generate random filenames
- [ ] Store files outside web root
- [ ] Scan for malware (if possible)
- [ ] Don't execute uploaded files

## Environment Variables

```typescript
// ❌ Hardcoded secrets
const JWT_SECRET = 'my-super-secret-key' // Never!

// ❌ Committed .env file
// .env file should be in .gitignore!

// ✅ Use environment variables
import dotenv from 'dotenv'
dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET
const DATABASE_URL = process.env.DATABASE_URL

if (!JWT_SECRET || !DATABASE_URL) {
  throw new Error('Missing required environment variables')
}
```

**.env.example (commit this):**
```
JWT_SECRET=your-secret-here
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

**.gitignore:**
```
.env
.env.local
```

## Security Checklist

### Authentication & Authorization
- [ ] Passwords hashed with bcrypt (12+ rounds)
- [ ] Strong password requirements (12+ chars, mixed case, numbers, symbols)
- [ ] Rate limiting on login/signup
- [ ] Account lockout after failed attempts
- [ ] Multi-factor authentication (MFA)
- [ ] Secure session management
- [ ] JWT tokens expire (short-lived)
- [ ] Proper access control (RBAC)
- [ ] Verify user owns resource before modifying

### Input Validation
- [ ] Validate all user input server-side
- [ ] Use schema validation (Zod, Joi, etc.)
- [ ] Sanitize HTML input (prevent XSS)
- [ ] Parameterized queries (prevent SQL injection)
- [ ] Validate file uploads (type, size, name)
- [ ] Check input length limits

### Data Protection
- [ ] Use HTTPS everywhere
- [ ] Encrypt sensitive data at rest
- [ ] Don't log passwords or tokens
- [ ] Implement CORS properly
- [ ] Set secure cookie flags (httpOnly, secure, sameSite)
- [ ] Use Content Security Policy (CSP)
- [ ] Set security headers (helmet)

### Dependencies & Configuration
- [ ] Run `npm audit` regularly
- [ ] Update dependencies frequently
- [ ] Remove unused dependencies
- [ ] Don't expose error stack traces in production
- [ ] Remove default credentials
- [ ] Disable directory listing
- [ ] Use environment variables for secrets

### Monitoring & Logging
- [ ] Log authentication attempts
- [ ] Log authorization failures
- [ ] Monitor for suspicious patterns
- [ ] Set up security alerts
- [ ] Don't log sensitive data (passwords, PII)

### API Security
- [ ] Rate limiting on all endpoints
- [ ] Validate Content-Type header
- [ ] Implement CSRF protection
- [ ] Use API versioning
- [ ] Document security requirements

## Tools & Resources

**Security Scanners:**
- `npm audit` - Check for known vulnerabilities
- Snyk - Continuous security monitoring
- OWASP ZAP - Web application security testing
- SonarQube - Code quality and security

**Best Practices:**
- OWASP Top 10: https://owasp.org/Top10/
- CWE Top 25: https://cwe.mitre.org/top25/
- Security Headers: https://securityheaders.com/

**Libraries:**
- helmet - Security headers
- express-rate-limit - Rate limiting
- bcrypt - Password hashing
- jsonwebtoken - JWT authentication
- zod - Schema validation
- DOMPurify - HTML sanitization

## Remember

- **Security is not optional** - Build it in from the start
- **Defense in depth** - Multiple layers of security
- **Principle of least privilege** - Grant minimum necessary access
- **Never trust user input** - Validate and sanitize everything
- **Keep dependencies updated** - Run npm audit regularly
- **Use security headers** - helmet is your friend
- **Log security events** - But don't log secrets
- **Test security** - Include security tests in your test suite

