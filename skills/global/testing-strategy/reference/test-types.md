# Test Types - Detailed Examples and Patterns

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

### TDD Example: FizzBuzz

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

// Test passes

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
