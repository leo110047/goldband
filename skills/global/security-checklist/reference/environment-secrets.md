# Environment Variables & Secrets Management - Detailed Examples

## Never Hardcode Secrets

Hardcoded secrets in source code get committed to version control, leaked in logs, and exposed to anyone with repository access.

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

## Template for Required Variables

Commit an `.env.example` file so team members know which variables are needed, without exposing actual values.

**.env.example (commit this):**
```
JWT_SECRET=your-secret-here
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

## Git Configuration

Always exclude secret files from version control.

**.gitignore:**
```
.env
.env.local
```

## Key Principles

- **Never commit `.env` files** - Only commit `.env.example` with placeholder values
- **Validate on startup** - Fail fast if required environment variables are missing
- **Use different secrets per environment** - Dev, staging, and production should each have unique secrets
- **Rotate secrets regularly** - Especially after team member departures or suspected breaches
- **Use a secrets manager in production** - AWS Secrets Manager, HashiCorp Vault, or platform-native solutions
