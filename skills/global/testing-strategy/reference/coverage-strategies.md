# Test Coverage and Anti-Patterns

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

### Coverage != Quality

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

## Anti-Patterns to Avoid

### 1. Testing Implementation Details

```typescript
// BAD - Breaks when refactoring
test('uses useState for count', () => {
  const { result } = renderHook(() => useCounter())
  expect(result.current.count).toBe(0) // Implementation detail
})

// GOOD - Tests behavior
test('increments counter', () => {
  const { result } = renderHook(() => useCounter())
  act(() => result.current.increment())
  expect(result.current.count).toBe(1)
})
```

### 2. Overly Complex Tests

```typescript
// BAD - Too complex, hard to understand
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

// GOOD - Break into multiple focused tests
test('user can complete assigned task', async () => {
  const { user, task } = await setupUserWithTask()
  const result = await completeTask(task, user)
  expect(result.status).toBe('completed')
})
```

### 3. Not Testing Edge Cases

```typescript
// BAD - Only happy path
test('divides two numbers', () => {
  expect(divide(10, 2)).toBe(5)
})

// GOOD - Tests edge cases
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
