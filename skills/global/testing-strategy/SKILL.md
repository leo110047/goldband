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
       /E2E\      <- Few, slow, expensive (UI/API tests)
      /------\
     /  INT   \   <- Some, medium speed (API/DB tests)
    /----------\
   /   UNIT     \ <- Many, fast, cheap (function/class tests)
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
// BAD - Testing implementation details
test('calculates discount by multiplying price by 0.1', () => {
  expect(calculateDiscount(100)).toBe(100 * 0.1)
})

// GOOD - Testing behavior
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

## Test Types Overview

Unit tests, integration tests, and E2E tests each serve different purposes in the testing pyramid. Unit tests verify individual functions and classes in isolation. Integration tests verify that components work together correctly (database queries, API endpoints). E2E tests verify complete user workflows through the real UI.

**Key guidance for each type:**

- **Unit tests** - Test business logic, edge cases, error handling. Don't test framework internals or trivial code.
- **Integration tests** - Use test databases, clean state between tests, test real API responses.
- **E2E tests** - Test critical user journeys, use data-testid selectors, keep tests focused on one flow.

For detailed examples (TypeScript/Jest, Python/Pytest, database tests, API tests with supertest, Playwright E2E, and TDD Red-Green-Refactor walkthrough), see [reference/test-types.md](reference/test-types.md).

## Mocking and Test Reliability

### When to Mock

**DO mock:** External APIs, databases, file system, date/time, random values, expensive operations.

**DON'T mock:** Code under test, simple utilities, data structures.

### Fixing Flaky Tests

The three most common causes of flaky tests are:

1. **Timing issues** - Never use arbitrary `setTimeout` delays. Wait for actual conditions (e.g., `findByText` instead of `getByText` after a sleep).
2. **Test interdependence** - Each test must create its own data and clean up after itself. Never share mutable state between tests.
3. **Shared state** - Use `beforeEach` to reset state. Never rely on global variables that persist across tests.

For full mocking examples (jest.mock, fake timers, date mocking), flaky test fix patterns with code, and a testing frameworks comparison table, see [reference/mocking-patterns.md](reference/mocking-patterns.md).

## Test Coverage

### Target Coverage

- **Critical paths:** 100% (auth, payment, security)
- **Business logic:** 90%+
- **Utilities:** 80%+
- **UI components:** 70%+

High coverage does not guarantee test quality. A test that calls a function without asserting on its result achieves coverage but catches no bugs. Always verify behavior, not just execution.

### Anti-Patterns to Avoid

1. **Testing implementation details** - Test behavior and outcomes, not internal state or specific method calls. Tests that mirror implementation break on every refactor.
2. **Overly complex tests** - Extract setup into helpers. Each test should verify one thing and be readable at a glance.
3. **Not testing edge cases** - Always test error paths, boundary values, empty inputs, and negative numbers alongside the happy path.

For coverage measurement commands (Jest, Pytest, Vitest), coverage-vs-quality examples, and full anti-pattern code samples, see [reference/coverage-strategies.md](reference/coverage-strategies.md).

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
