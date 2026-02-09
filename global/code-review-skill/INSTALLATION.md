# Code Review Skill - 完整版 (含 C#)

## 新增功能

✅ **完整的 C# Code Review Guide** (25KB)
- .NET 8+ 最佳實踐
- Nullable Reference Types
- LINQ 優化模式
- Async/Await 深度指南
- 記憶體效能 (Span<T>, Memory<T>, ArrayPool)
- Entity Framework Core 優化
- 依賴注入與生命週期管理
- 安全性最佳實踐
- 測試模式

## 支援語言

### 核心語言 (你要求的)
- ✅ **C#** (.NET 8+) - 新增完整指南
- ✅ **Python** (現有完整指南)
- ✅ **TypeScript** (現有完整指南)

### 其他常見語言
- JavaScript
- Java
- Go
- Rust
- C/C++
- React
- Vue

## 快速安裝

### 方法 1: 安裝到全域 (所有專案可用)

```bash
# 複製到 Claude Code 全域 skills 目錄
cp -r code-review-skill ~/.claude/skills/code-review

# 驗證安裝
ls ~/.claude/skills/code-review/reference/csharp.md
```

### 方法 2: 安裝到專案 (僅該專案可用)

```bash
# 在你的專案根目錄
mkdir -p .claude/skills
cp -r code-review-skill .claude/skills/

# 驗證安裝
ls .claude/skills/code-review-skill/reference/csharp.md
```

## 使用方式

安裝後，Claude Code 會在以下情況自動載入：

### 觸發關鍵字
- "code review"
- "review this PR"
- "review code"
- "check this code"
- ".NET code review"
- "Entity Framework review"
- "LINQ review"

### 語言特定觸發
當 Claude 偵測到你正在審查特定語言的程式碼時，會自動載入對應的語言指南。

### 手動調用
```
/code-review-excellence
```

## 檔案結構

```
code-review-skill/
├── SKILL.md                              # 主要 skill 檔案
├── reference/                            # 語言特定指南
│   ├── csharp.md                        # ✨ 新增的 C# 指南
│   ├── python.md                        # 完整的 Python 指南
│   ├── typescript.md                    # 完整的 TypeScript 指南
│   ├── react.md
│   ├── vue.md
│   ├── rust.md
│   ├── java.md
│   ├── go.md
│   ├── c.md
│   ├── cpp.md
│   ├── architecture-review-guide.md
│   ├── performance-review-guide.md
│   ├── security-review-guide.md
│   └── common-bugs-checklist.md
├── assets/
│   ├── review-checklist.md
│   └── pr-review-template.md
└── scripts/
    └── pr-analyzer.py
```

## C# Guide 涵蓋內容

### 1. 現代 C# 特性
- File-scoped namespaces (C# 10)
- Primary constructors (C# 12)
- Record types
- Pattern matching
- String handling 最佳實踐

### 2. Nullable Reference Types
- 啟用 nullable context
- Null check 模式
- Null-coalescing operators
- Nullable value types

### 3. LINQ 優化
- Deferred execution 陷阱
- 避免 N+1 queries
- Materialization 策略
- Performance patterns

### 4. Async/Await
- Async void 避免
- ConfigureAwait 使用
- Anti-patterns 識別
- Parallel async operations

### 5. 記憶體效能
- Span<T> 和 Memory<T>
- ArrayPool<T>
- String pooling
- ValueTask<T>

### 6. Entity Framework Core
- Query optimization
- AsNoTracking
- Batch operations
- Cartesian explosion 避免

### 7. 依賴注入
- Service lifetimes
- DbContext lifetime
- Dispose patterns
- Captive dependency 避免

### 8. 安全性
- SQL injection 防護
- Secret management
- Input validation
- Data Annotations & FluentValidation

### 9. 測試
- AAA pattern
- Integration testing
- Test data builders
- WebApplicationFactory

## 驗證安裝

在 Claude Code 中執行：

```
請使用 code-review-excellence skill 審查這段 C# 程式碼：

public async Task<User> GetUser(int id)
{
    return _users.Where(u => u.Id == id).FirstOrDefault();
}
```

Claude 應該會：
1. 載入 C# guide
2. 指出可以用 `FirstOrDefaultAsync(u => u.Id == id)` 簡化
3. 建議加上 null check 或回傳 `User?`

## 其他 API Design 和 Performance Skills

如果你還需要：
- **API Design Patterns** - 從 SkillHub 或 GitHub 下載
- **Performance Optimization** - 從 SkillHub 或 GitHub 下載

我可以幫你建立客製化版本整合進這個 skill，或作為獨立 skills。

## 下一步

1. **安裝 skill** (選擇全域或專案)
2. **測試觸發** (用上面的範例)
3. **根據實際使用調整** (可以修改 reference/*.md)
4. **考慮新增其他 skills**:
   - api-design-patterns
   - performance-optimization
   - security-best-practices

## 支援

如果有問題或需要：
- 調整 C# guide 內容
- 新增其他語言
- 整合其他 skills
- 客製化觸發條件

隨時告訴我！
