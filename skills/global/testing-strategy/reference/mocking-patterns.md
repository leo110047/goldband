# Mocking Patterns, Flaky Tests, and Framework Comparison

## Fixing Flaky Tests

### Common Causes and Fixes

**1. Timing Issues**

```typescript
// BAD - Flaky - guessing at timing
test('shows loading then data', async () => {
  render(<UserList />)
  await new Promise(r => setTimeout(r, 100)) // Guess
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  await new Promise(r => setTimeout(r, 1000)) // Guess
  expect(screen.getByText('John Doe')).toBeInTheDocument()
})

// GOOD - Reliable - wait for actual conditions
test('shows loading then data', async () => {
  render(<UserList />)
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  expect(await screen.findByText('John Doe')).toBeInTheDocument()
})
```

**2. Test Interdependence**

```typescript
// BAD - Tests depend on each other
let userId: string

test('creates user', async () => {
  const user = await createUser({ email: 'test@example.com' })
  userId = user.id // Shared state
})

test('deletes user', async () => {
  await deleteUser(userId) // Depends on previous test
})

// GOOD - Independent tests
test('creates user', async () => {
  const user = await createUser({ email: 'test@example.com' })
  expect(user.id).toBeDefined()
  await cleanup(user.id)
})

test('deletes user', async () => {
  const user = await createUser({ email: 'test2@example.com' })
  await deleteUser(user.id)
  expect(await findUser(user.id)).toBeNull()
})
```

**3. Shared State**

```typescript
// BAD - Global state contamination
const cache = {}

test('caches user data', () => {
  cache['user1'] = { name: 'John' }
  expect(cache['user1']).toBeDefined()
})

test('cache is empty initially', () => {
  expect(Object.keys(cache)).toHaveLength(0) // Fails! Previous test left data
})

// GOOD - Clean slate for each test
describe('Cache', () => {
  let cache: Record<string, any>

  beforeEach(() => {
    cache = {} // Fresh cache for each test
  })

  test('caches user data', () => {
    cache['user1'] = { name: 'John' }
    expect(cache['user1']).toBeDefined()
  })

  test('cache is empty initially', () => {
    expect(Object.keys(cache)).toHaveLength(0)
  })
})
```

## Mocking Best Practices

### When to Mock

**DO mock:**
- External APIs
- Databases
- File system
- Date/time
- Random values
- Expensive operations

**DON'T mock:**
- Code under test
- Simple utilities
- Data structures

### Mocking Examples

```typescript
// Mock external API
import { fetchUser } from './api'

jest.mock('./api')
const mockFetchUser = fetchUser as jest.MockedFunction<typeof fetchUser>

test('handles API error', async () => {
  mockFetchUser.mockRejectedValue(new Error('Network error'))

  const result = await getUserProfile('123')

  expect(result.error).toBe('Failed to load user')
})

// Mock Date
beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2024-01-01'))
})

afterEach(() => {
  jest.useRealTimers()
})

test('generates daily report for today', () => {
  const report = generateDailyReport()
  expect(report.date).toBe('2024-01-01')
})
```

## Testing Frameworks Comparison

| Framework | Language | Best For | Speed |
|-----------|----------|----------|-------|
| **Jest** | JavaScript/TypeScript | React, Node.js, general purpose | Fast |
| **Vitest** | JavaScript/TypeScript | Vite projects, modern apps | Very Fast |
| **Pytest** | Python | Python projects, data science | Fast |
| **RSpec** | Ruby | Rails apps, BDD style | Medium |
| **JUnit** | Java | Java/Kotlin apps | Fast |
| **Go testing** | Go | Go services | Very Fast |
| **Playwright** | Any | E2E, cross-browser | Slow |
| **Cypress** | JavaScript | E2E, frontend-focused | Slow |
