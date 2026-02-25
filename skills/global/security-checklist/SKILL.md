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

The OWASP Top 10 represents the most critical web application security risks. Each item below
includes a summary and key prevention measures. See `reference/owasp-top10.md` for detailed
code examples showing vulnerable (bad) and secure (good) patterns for every category.

### 1. Broken Access Control

Users accessing resources or actions beyond their intended permissions. This is the most
common web application vulnerability.

- Deny access by default
- Implement role-based access control (RBAC)
- Verify resource ownership before every modification
- Never rely on client-side access control

### 2. Cryptographic Failures

Sensitive data exposed due to weak or missing encryption. Includes storing passwords in
plain text, using base64 as "encryption," or transmitting data without TLS.

- Use bcrypt (12+ rounds) or Argon2 for password hashing -- never MD5 or SHA1
- Use AES-256-GCM for encrypting data at rest
- Enforce HTTPS/TLS for all data in transit
- Generate random values with `crypto.randomBytes`, never `Math.random`
- Rotate encryption keys on a regular schedule

### 3. Injection (SQL, Command, NoSQL)

Untrusted data sent to an interpreter as part of a query or command. Attackers can
execute unintended commands or access unauthorized data.

- Always use parameterized queries or prepared statements
- Use ORMs (Prisma, Sequelize) with built-in escaping
- Validate input types strictly (string, number, enum)
- Never concatenate user input into SQL, shell commands, or NoSQL queries
- Avoid `exec()` and `eval()` with any user-controlled input

### 4. Insecure Design

Missing or ineffective security controls at the architecture level. Unlike implementation
bugs, these are flaws in the design itself.

- Perform threat modeling during design phase
- Implement rate limiting on sensitive endpoints (login, password reset, signup)
- Use CAPTCHA for actions vulnerable to automation
- Apply the principle of least privilege throughout

### 5. Security Misconfiguration

Default credentials, verbose error messages, exposed stack traces, missing security
headers, or unnecessary features left enabled.

- Use `helmet` to set security headers automatically
- Return generic error messages in production (never stack traces)
- Remove default credentials and sample applications
- Disable directory listing and unnecessary HTTP methods
- Keep all frameworks and libraries on supported versions

### 6. Vulnerable and Outdated Components

Using libraries, frameworks, or other software modules with known security vulnerabilities.

- Run `npm audit` regularly and fix findings
- Set up automated dependency updates (Dependabot, Renovate)
- Use `npm ci` in CI/CD pipelines to lock exact versions
- Monitor security advisories for your stack
- Remove dependencies you no longer use

### 7. Identification and Authentication Failures

Weak password policies, predictable session tokens, misconfigured JWT, and missing
multi-factor authentication.

- Enforce strong passwords (12+ chars, mixed case, digits, symbols)
- Use cryptographically secure session IDs (`crypto.randomBytes`)
- Set secure cookie flags: `httpOnly`, `secure`, `sameSite: 'strict'`
- Issue short-lived JWT tokens with proper `issuer` and `audience` claims
- Implement account lockout after repeated failed login attempts
- Support multi-factor authentication (MFA)

### 8. Software and Data Integrity Failures

Using unverified updates, plugins, or dependencies without integrity checks. Includes
CI/CD pipeline compromises and unsigned packages.

- Always commit and use `package-lock.json` or `yarn.lock`
- Run `npm ci` (not `npm install`) in CI/CD for deterministic builds
- Verify checksums and signatures on downloaded artifacts
- Review new dependencies before adding them to the project

### 9. Security Logging and Monitoring Failures

Insufficient logging of security-relevant events, making it impossible to detect attacks
or perform forensic analysis after a breach.

- Log all authentication attempts (success and failure)
- Log authorization failures and input validation errors
- Record IP address, user agent, and timestamp for security events
- Set up alerts for suspicious patterns (brute force, unusual access)
- Centralize logs for analysis and retain them appropriately
- Never log passwords, tokens, or personally identifiable information (PII)

### 10. Server-Side Request Forgery (SSRF)

The server fetches attacker-controlled URLs, potentially accessing internal services,
cloud metadata endpoints, or private network resources.

- Whitelist allowed destination domains
- Block requests to localhost, 127.x.x.x, 10.x.x.x, 192.168.x.x, and 169.254.x.x
- Validate and parse URLs before fetching
- Use network segmentation to limit server-side access

## Input Validation

Always validate on the server side -- client-side validation (HTML `required`, `type="email"`)
is trivially bypassed with curl, Postman, or browser dev tools.

**Key practices:**
- Use schema validation libraries (Zod, Joi, Yup) to enforce types, ranges, and formats
- Validate input lengths, numeric ranges, and date boundaries
- Use enums or whitelists for constrained values (roles, statuses, categories)
- Sanitize HTML output with DOMPurify to prevent Cross-Site Scripting (XSS)
- Modern frameworks (React, Vue, Angular) auto-escape by default, but be cautious with
  `dangerouslySetInnerHTML` (React) or `v-html` (Vue) -- these bypass auto-escaping
- Prefer whitelisting acceptable input over blacklisting known-bad input

See `reference/input-validation.md` for Zod validation examples, DOMPurify usage, and
XSS prevention patterns.

## File Upload Security

Unrestricted file uploads can lead to remote code execution, storage exhaustion, and
serving malicious content to users.

**Key practices:**
- Validate both MIME type and file extension (attackers can spoof one but rarely both)
- Enforce file size limits appropriate to your use case
- Generate random filenames with `crypto.randomBytes` to prevent path traversal
- Store uploaded files outside the web root so they cannot be directly executed
- Scan files for malware when feasible
- Never execute or interpret uploaded file contents

See `reference/file-upload-security.md` for secure multer configuration and the full
file upload checklist.

## Environment Variables & Secrets

Never hardcode secrets (API keys, JWT secrets, database credentials) in source code.
Hardcoded secrets get committed to version control, leaked in logs, and exposed to
anyone with repository access.

**Key practices:**
- Load secrets from environment variables using `dotenv` or platform-native mechanisms
- Validate that all required environment variables are present on startup -- fail fast
- Commit `.env.example` with placeholder values so the team knows what is needed
- Add `.env` and `.env.local` to `.gitignore` immediately
- Use different secrets for each environment (dev, staging, production)
- In production, use a dedicated secrets manager (AWS Secrets Manager, HashiCorp Vault,
  or your platform's native solution)
- Rotate secrets regularly, especially after team member departures

See `reference/environment-secrets.md` for code examples, `.env.example` template, and
`.gitignore` configuration.

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
