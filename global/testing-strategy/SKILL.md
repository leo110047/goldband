---
name: testing-strategy
description: |
  Comprehensive testing strategy covering unit tests, integration tests, E2E tests, and test-driven development.
  Use when: writing tests, improving test coverage, implementing TDD, fixing flaky tests, setting up testing infrastructure,
  choosing testing frameworks, or establishing testing standards.

  Focus: Test design, coverage, and reliability, not debugging test failures (use systematic-debugging for that).
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash      # Running tests
  - Write     # Creating test files
  - Edit      # Modifying tests
---

# Testing Strategy - Building Reliable Software

## When to Use This Skill

- Writing unit, integration, or E2E tests
- Improving test coverage
- Implementing test-driven development (TDD)
- Fixing flaky or unreliable tests
- Setting up testing infrastructure (Jest, Vitest, Pytest, etc.)
- Choosing testing frameworks and tools
- Establishing testing standards for teams
- Reviewing test quality

**NOT for debugging test failures** - Use `systematic-debugging` skill when tests fail unexpectedly.

## Testing Pyramid

```
        /\
       /E2E\      ← Few, slow, expensive (UI/API tests)
      /------\
     /  INT   \   ← Some, medium speed (API/DB tests)
    /----------\
   /   UNIT     \ ← Many, fast, cheap (function/class tests)
  /--------------\
```

**Golden Rule:** 70% Unit, 20% Integration, 10% E2E

## Core Principles

### 1. F.I.R.S.T. Principles

- **Fast** - Tests should run in milliseconds
- **Independent** - No test depends on another
- **Repeatable** - Same result every time
- **Self-validating** - Pass or fail, no manual checking
- **Timely** - Written before or with production code (TDD)

### 2. Test What, Not How

```typescript
// ❌ Testing implementation details
test('calculates discount by multiplying price by 0.1', () => {
  expect(calculateDiscount(100)).toBe(100 * 0.1)
})

// ✅ Testing behavior
test('VIP users get 10% discount', () => {
  const user = { type: 'VIP' }
  const finalPrice = calculatePrice(100, user)
  expect(finalPrice).toBe(90)
})
```

### 3. Arrange-Act-Assert (AAA) Pattern

```typescript
test('user can add item to cart', () => {
  // Arrange - Set up test data
  const cart = new ShoppingCart()
  const item = { id: '1', name: 'Coffee', price: 5 }

  // Act - Execute the behavior
  cart.addItem(item)

  // Assert - Verify the outcome
  expect(cart.items).toHaveLength(1)
  expect(cart.total).toBe(5)
})
```

## Unit Testing

### What to Test

**DO test:**
- Business logic
- Edge cases and boundary conditions
- Error handling
- Data transformations
- Algorithms

**DON'T test:**
- Framework internals (React, Express, etc.)
- Third-party libraries
- Trivial getters/setters
- Auto-generated code

### Example: TypeScript/Jest

```typescript
// user.service.ts
export class UserService {
  constructor(private db: Database) {}

  async createUser(email: string, password: string) {
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email')
    }
    if (password.length < 8) {
      throw new Error('Password too short')
    }
    return this.db.users.create({ email, password })
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }
}

// user.service.test.ts
describe('UserService', () => {
  let service: UserService
  let mockDb: jest.Mocked<Database>

  beforeEach(() => {
    mockDb = {
      users: {
        create: jest.fn().mockResolvedValue({ id: '1', email: 'test@example.com' })
      }
    } as any
    service = new UserService(mockDb)
  })

  describe('createUser', () => {
    it('creates user with valid credentials', async () => {
      const user = await service.createUser('test@example.com', 'password123')

      expect(mockDb.users.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      })
      expect(user).toEqual({ id: '1', email: 'test@example.com' })
    })

    it('rejects invalid email', async () => {
      await expect(
        service.createUser('invalid-email', 'password123')
      ).rejects.toThrow('Invalid email')
    })

    it('rejects short password', async () => {
      await expect(
        service.createUser('test@example.com', 'pass')
      ).rejects.toThrow('Password too short')
    })
  })
})
```

### Example: Python/Pytest

```python
# calculator.py
class Calculator:
    def divide(self, a: float, b: float) -> float:
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b

# test_calculator.py
import pytest
from calculator import Calculator

class TestCalculator:
    def setup_method(self):
        self.calc = Calculator()

    def test_divide_normal_case(self):
        result = self.calc.divide(10, 2)
        assert result == 5.0

    def test_divide_by_zero_raises_error(self):
        with pytest.raises(ValueError, match="Cannot divide by zero"):
            self.calc.divide(10, 0)

    @pytest.mark.parametrize("a,b,expected", [
        (10, 2, 5),
        (9, 3, 3),
        (100, 4, 25),
        (-10, 2, -5),
    ])
    def test_divide_multiple_cases(self, a, b, expected):
        assert self.calc.divide(a, b) == expected
```

## Integration Testing

### Database Integration Tests

```typescript
// user.repository.integration.test.ts
describe('UserRepository Integration Tests', () => {
  let db: Database
  let repository: UserRepository

  beforeAll(async () => {
    // Use test database
    db = await setupTestDatabase()
    repository = new UserRepository(db)
  })

  afterAll(async () => {
    await db.close()
  })

  beforeEach(async () => {
    // Clean database before each test
    await db.users.deleteMany({})
  })

  it('creates and retrieves user from database', async () => {
    // Create
    const created = await repository.create({
      email: 'test@example.com',
      name: 'Test User'
    })

    // Retrieve
    const retrieved = await repository.findById(created.id)

    expect(retrieved).toMatchObject({
      email: 'test@example.com',
      name: 'Test User'
    })
  })

  it('enforces unique email constraint', async () => {
    await repository.create({ email: 'test@example.com', name: 'User 1' })

    await expect(
      repository.create({ email: 'test@example.com', name: 'User 2' })
    ).rejects.toThrow('Email already exists')
  })
})
```

### API Integration Tests

```typescript
// app.integration.test.ts
import request from 'supertest'
import { app } from '../app'

describe('POST /api/users', () => {
  it('creates new user and returns 201', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({
        email: 'test@example.com',
        password: 'password123'
      })
      .expect(201)

    expect(response.body).toMatchObject({
      id: expect.any(String),
      email: 'test@example.com'
    })
    expect(response.body.password).toBeUndefined() // Don't leak password
  })

  it('returns 400 for invalid email', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({
        email: 'invalid-email',
        password: 'password123'
      })
      .expect(400)

    expect(response.body.error).toContain('Invalid email')
  })
})
```

## E2E Testing

### Playwright Example

```typescript
// e2e/checkout.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Checkout Flow', () => {
  test('user can complete purchase', async ({ page }) => {
    // Login
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')

    // Add item to cart
    await page.goto('/products')
    await page.click('[data-testid="product-1"] button:has-text("Add to Cart")')
    await expect(page.locator('[data-testid="cart-count"]')).toHaveText('1')

    // Checkout
    await page.click('[data-testid="cart-icon"]')
    await page.click('button:has-text("Checkout")')

    // Fill payment info
    await page.fill('[name="cardNumber"]', '4242424242424242')
    await page.fill('[name="expiry"]', '12/25')
    await page.fill('[name="cvc"]', '123')

    // Submit
    await page.click('button:has-text("Pay Now")')

    // Verify success
    await expect(page.locator('h1')).toHaveText('Order Confirmed')
    await expect(page.locator('[data-testid="order-id"]')).toBeVisible()
  })
})
```

## Test-Driven Development (TDD)

### Red-Green-Refactor Cycle

```
1. RED    - Write failing test first
2. GREEN  - Write minimal code to pass
3. REFACTOR - Improve code while keeping tests green
```

### TDD Example

```typescript
// Step 1: RED - Write failing test
describe('FizzBuzz', () => {
  it('returns "Fizz" for multiples of 3', () => {
    expect(fizzBuzz(3)).toBe('Fizz')
    expect(fizzBuzz(6)).toBe('Fizz')
  })
})

// Test fails: fizzBuzz is not defined

// Step 2: GREEN - Minimal implementation
function fizzBuzz(n: number): string {
  if (n % 3 === 0) return 'Fizz'
  return String(n)
}

// Test passes ✓

// Step 3: Add more tests (RED again)
it('returns "Buzz" for multiples of 5', () => {
  expect(fizzBuzz(5)).toBe('Buzz')
  expect(fizzBuzz(10)).toBe('Buzz')
})

// Extend implementation (GREEN)
function fizzBuzz(n: number): string {
  if (n % 3 === 0) return 'Fizz'
  if (n % 5 === 0) return 'Buzz'
  return String(n)
}

// Add FizzBuzz test (RED)
it('returns "FizzBuzz" for multiples of both 3 and 5', () => {
  expect(fizzBuzz(15)).toBe('FizzBuzz')
  expect(fizzBuzz(30)).toBe('FizzBuzz')
})

// Final implementation (GREEN)
function fizzBuzz(n: number): string {
  if (n % 15 === 0) return 'FizzBuzz'
  if (n % 3 === 0) return 'Fizz'
  if (n % 5 === 0) return 'Buzz'
  return String(n)
}

// Step 4: REFACTOR
function fizzBuzz(n: number): string {
  let result = ''
  if (n % 3 === 0) result += 'Fizz'
  if (n % 5 === 0) result += 'Buzz'
  return result || String(n)
}
```

## Fixing Flaky Tests

### Common Causes and Fixes

**1. Timing Issues**

```typescript
// ❌ Flaky - guessing at timing
test('shows loading then data', async () => {
  render(<UserList />)
  await new Promise(r => setTimeout(r, 100)) // Guess
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  await new Promise(r => setTimeout(r, 1000)) // Guess
  expect(screen.getByText('John Doe')).toBeInTheDocument()
})

// ✅ Reliable - wait for actual conditions
test('shows loading then data', async () => {
  render(<UserList />)
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  expect(await screen.findByText('John Doe')).toBeInTheDocument()
})
```

**2. Test Interdependence**

```typescript
// ❌ Tests depend on each other
let userId: string

test('creates user', async () => {
  const user = await createUser({ email: 'test@example.com' })
  userId = user.id // Shared state
})

test('deletes user', async () => {
  await deleteUser(userId) // Depends on previous test
})

// ✅ Independent tests
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
// ❌ Global state contamination
const cache = {}

test('caches user data', () => {
  cache['user1'] = { name: 'John' }
  expect(cache['user1']).toBeDefined()
})

test('cache is empty initially', () => {
  expect(Object.keys(cache)).toHaveLength(0) // Fails! Previous test left data
})

// ✅ Clean slate for each test
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

## Test Coverage

### What Coverage Means

```
Line Coverage:    % of code lines executed
Branch Coverage:  % of if/else branches tested
Function Coverage: % of functions called
Statement Coverage: % of statements executed
```

### Target Coverage

- **Critical paths:** 100% (auth, payment, security)
- **Business logic:** 90%+
- **Utilities:** 80%+
- **UI components:** 70%+

### Measuring Coverage

```bash
# Jest
npm test -- --coverage

# Pytest
pytest --cov=src --cov-report=html

# Vitest
vitest --coverage
```

### Coverage ≠ Quality

```typescript
// 100% coverage, but terrible test
function add(a: number, b: number) {
  return a + b
}

test('add function exists', () => {
  add(1, 2) // Covers line, but doesn't verify behavior!
})

// Good test
test('add returns sum of two numbers', () => {
  expect(add(2, 3)).toBe(5)
  expect(add(-1, 1)).toBe(0)
  expect(add(0, 0)).toBe(0)
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

## Anti-Patterns to Avoid

### 1. Testing Implementation Details

```typescript
// ❌ Breaks when refactoring
test('uses useState for count', () => {
  const { result } = renderHook(() => useCounter())
  expect(result.current.count).toBe(0) // Implementation detail
})

// ✅ Tests behavior
test('increments counter', () => {
  const { result } = renderHook(() => useCounter())
  act(() => result.current.increment())
  expect(result.current.count).toBe(1)
})
```

### 2. Overly Complex Tests

```typescript
// ❌ Too complex, hard to understand
test('complex scenario', async () => {
  const user = await createUser()
  const org = await createOrg()
  await addUserToOrg(user, org)
  const project = await createProject(org)
  await assignUser(project, user)
  const task = await createTask(project)
  const result = await completeTask(task, user)
  expect(result.status).toBe('completed')
})

// ✅ Break into multiple focused tests
test('user can complete assigned task', async () => {
  const { user, task } = await setupUserWithTask()
  const result = await completeTask(task, user)
  expect(result.status).toBe('completed')
})
```

### 3. Not Testing Edge Cases

```typescript
// ❌ Only happy path
test('divides two numbers', () => {
  expect(divide(10, 2)).toBe(5)
})

// ✅ Tests edge cases
describe('divide', () => {
  it('divides positive numbers', () => {
    expect(divide(10, 2)).toBe(5)
  })

  it('handles division by zero', () => {
    expect(() => divide(10, 0)).toThrow('Cannot divide by zero')
  })

  it('handles negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5)
  })

  it('handles floating point', () => {
    expect(divide(10, 3)).toBeCloseTo(3.333, 3)
  })
})
```

## Quick Reference Checklist

**Before writing tests:**
- [ ] Understand what behavior you're testing
- [ ] Identify happy path and edge cases
- [ ] Choose appropriate test type (unit/integration/E2E)
- [ ] Set up test data and mocks

**While writing tests:**
- [ ] Use AAA pattern (Arrange, Act, Assert)
- [ ] Test one thing per test
- [ ] Make tests independent
- [ ] Use descriptive test names
- [ ] Avoid testing implementation details

**After writing tests:**
- [ ] Run tests and verify they pass
- [ ] Check test coverage
- [ ] Ensure tests are fast
- [ ] Clean up test data
- [ ] Review for flakiness

## Remember

- **Write tests first** (TDD) when possible
- **Test behavior, not implementation**
- **Keep tests simple and focused**
- **Make tests fast and reliable**
- **Use the testing pyramid** (many unit, few E2E)
- **Don't chase 100% coverage** - chase valuable tests
- **When tests fail, use systematic-debugging skill**

