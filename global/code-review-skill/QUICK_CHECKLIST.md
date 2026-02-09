# 核心語言快速 Checklist

快速參考 - 審查 C#, Python, TypeScript 程式碼時的核心檢查點

## C# (.NET 8+)

### 必查項目 ⭐
- [ ] **Nullable Reference Types** 已啟用 (`<Nullable>enable</Nullable>`)
- [ ] 避免 `async void` (除了 event handlers)
- [ ] 不要用 `.Result` 或 `.Wait()` (deadlock risk)
- [ ] EF Core 唯讀查詢使用 `.AsNoTracking()`
- [ ] 避免 N+1 queries (使用 `.Include()` 或 projection)
- [ ] String concatenation in loops → StringBuilder
- [ ] Captive dependency 檢查 (Scoped in Singleton)

### 現代化檢查
- [ ] 使用 file-scoped namespaces
- [ ] 使用 primary constructors (C# 12)
- [ ] Record types for immutable data
- [ ] Pattern matching 取代 if-else chains
- [ ] `required` modifier for mandatory properties

### 效能
- [ ] 考慮 `Span<T>`/`Memory<T>` for large data
- [ ] Hot path 考慮 `ValueTask<T>`
- [ ] 大陣列使用 `ArrayPool<T>`
- [ ] `.Any()` instead of `.Count() > 0`

### 安全
- [ ] 使用參數化查詢 (`FromSqlInterpolated`)
- [ ] Secrets 不硬編碼 (Configuration/KeyVault)
- [ ] Input validation (Data Annotations/FluentValidation)

---

## Python (3.10+)

### 必查項目 ⭐
- [ ] **Type hints** 使用 (function signatures)
- [ ] 避免 mutable default arguments (`def func(items=[]):`)
- [ ] Exception handling 不要 bare `except:`
- [ ] Async 函數使用 `async def` + `await`
- [ ] Context managers 用於資源管理 (`with` statement)
- [ ] List comprehensions 優於 `for` loops (when appropriate)

### 現代化檢查
- [ ] 使用 `|` for Union types (Python 3.10+)
- [ ] `match` statement for pattern matching (Python 3.10+)
- [ ] f-strings for formatting
- [ ] `dataclasses` or `pydantic` for data models
- [ ] Type aliases with `TypeAlias`

### 效能
- [ ] 避免 `+` concatenation in loops → `''.join()`
- [ ] Generator expressions for large datasets
- [ ] `__slots__` for memory-heavy classes
- [ ] `functools.lru_cache` for expensive computations

### 常見陷阱
- [ ] ❌ `if x:` → ✅ `if x is not None:`
- [ ] ❌ `except Exception:` → ✅ 具體的 exception types
- [ ] ❌ `from module import *` → ✅ Explicit imports
- [ ] ❌ Late imports → ✅ Top-level imports

---

## TypeScript (5.0+)

### 必查項目 ⭐
- [ ] **Strict mode** 啟用 (`"strict": true`)
- [ ] 避免 `any` type (使用 `unknown` + type guards)
- [ ] 避免 type assertions (`as Type`) 除非必要
- [ ] Promise rejection handling (`.catch()` or `try-catch`)
- [ ] Immutability patterns (`readonly`, `as const`)
- [ ] 明確的 return types on functions

### 現代化檢查
- [ ] 使用 `interface` for object shapes
- [ ] `type` for unions/intersections
- [ ] Generic types where appropriate
- [ ] Utility types (`Partial`, `Pick`, `Omit`, `Record`)
- [ ] Discriminated unions for complex types

### 效能
- [ ] 避免在 render/loops 中創建 functions/objects
- [ ] Memoization (`useMemo`, `useCallback` in React)
- [ ] Lazy loading for large modules
- [ ] Tree-shaking friendly imports

### 常見陷阱
- [ ] ❌ `== null` → ✅ `=== null` or `== null` (strict equality)
- [ ] ❌ `arr.forEach()` with async → ✅ `for...of` or `Promise.all()`
- [ ] ❌ `new Promise()` without reject → ✅ Handle rejections
- [ ] ❌ Optional chaining overuse → ✅ Proper null checks

---

## 跨語言通用檢查

### 架構
- [ ] Single Responsibility Principle
- [ ] Dependency Injection (not `new` everywhere)
- [ ] Interface segregation
- [ ] Clear separation of concerns

### 測試
- [ ] Unit tests for business logic
- [ ] Integration tests for I/O operations
- [ ] Test edge cases and error paths
- [ ] Meaningful test names

### 安全
- [ ] Input validation
- [ ] Output encoding
- [ ] SQL injection prevention
- [ ] XSS prevention (web apps)
- [ ] Secrets management

### 可維護性
- [ ] Clear naming (functions, variables, classes)
- [ ] Comments explain "why", not "what"
- [ ] Magic numbers → named constants
- [ ] Error messages are actionable
- [ ] Logging at appropriate levels

---

## 審查優先級

### 🔴 Critical (必須修正)
- Security vulnerabilities
- Null reference errors
- Resource leaks
- Data corruption risks
- Deadlocks/race conditions

### 🟡 Important (應該修正)
- Performance issues (N+1, memory leaks)
- Missing error handling
- Poor naming/structure
- Missing tests for critical paths
- Type safety violations

### 🟢 Nice-to-have (建議)
- Code style improvements
- Additional comments
- Refactoring opportunities
- Performance micro-optimizations

---

## 快速命令

### C# 專案檢查
```bash
# 檢查 nullable warnings
dotnet build /p:TreatWarningsAsErrors=true

# 執行測試
dotnet test

# Code coverage
dotnet test --collect:"XPlat Code Coverage"
```

### Python 專案檢查
```bash
# Type checking
mypy .

# Linting
ruff check .

# Testing
pytest --cov=src
```

### TypeScript 專案檢查
```bash
# Type checking
tsc --noEmit

# Linting
eslint .

# Testing
npm test
```

---

## 使用建議

1. **先掃描 Critical 問題** (安全、null、資源)
2. **再看 Important 問題** (效能、錯誤處理)
3. **最後提 Nice-to-have** (標註 `[nit]`)
4. **每個建議要具體** (不只說"改進"，要說"怎麼改")
5. **給出範例程式碼** (Before/After)

記住：Code review 的目標是**改進程式碼品質**和**知識分享**，不是證明你比別人聰明。
