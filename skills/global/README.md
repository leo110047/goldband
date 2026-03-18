# Global Claude Code Skills

這是你的全域 Claude Code skills 集合，優化過以避免衝突並防止 AI 幻覺。

## 📁 安裝方式

```bash
# 將整個 skills 資料夾複製到 .claude 目錄
cp -r skills ~/.claude/

# 或者符號連結（推薦，方便更新）
ln -s $(pwd)/skills ~/.claude/skills
```

## 🎯 Skills 概覽

### 核心開發 Skills

| Skill | 用途 | 優先級 |
|-------|------|--------|
| **systematic-debugging** | 系統性調試，避免猜測式修復 | 🔴 CRITICAL |
| **evidence-based-coding** | 防止 AI 幻覺，要求證據支持所有聲明 | 🔴 CRITICAL |
| **code-review-skill** | 代碼審查，多語言支援 | 🟡 Medium |
| **backend-patterns** | 後端架構模式 | 🟡 Medium |
| **performance-optimization** | 性能優化（前端+後端） | 🟡 Medium |
| **claude-config-verification** | Claude Code 配置 repo 驗證、hook replay、plugin data probe | 🟡 Medium |

### 專業領域 Skills

| Skill | 用途 |
|-------|------|
| **testing-strategy** | 測試策略（Unit/Integration/E2E） |
| **security-checklist** | 安全最佳實踐（OWASP Top 10） |
| **commit-conventions** | Git commit 規範（Conventional Commits） |
| **decision-log** | 架構決策記錄（ADR） |
| **file-search** | 代碼搜尋（ripgrep + ast-grep） |

### 工具 Skills

| Skill | 用途 |
|-------|------|
| **skill-developer** | 管理和創建 skills |

## ⚙️ 配置文件

### `skill-rules.json`

全域衝突處理和優先級規則：

- **防止衝突**: 當多個 skills 可能同時觸發時，自動選擇最合適的
- **優先級管理**: `systematic-debugging` 和 `evidence-based-coding` 擁有最高優先級
- **反幻覺規則**: 強制要求證據支持所有聲明

## 🔍 Skill 衝突解決

### 已解決的衝突

#### 1. `backend-patterns` vs `performance-optimization`

**衝突場景**: 用戶說「優化資料庫查詢」

**解決方案**:
- 如果提到「慢」、「優化」→ 使用 `performance-optimization`
- 如果提到「設計」、「架構」→ 使用 `backend-patterns`

#### 2. `code-review-skill` vs `systematic-debugging`

**衝突場景**: 用戶說「Review 這個 PR，測試一直失敗」

**解決方案**:
- `systematic-debugging` 優先處理 bug
- 修復完成後，`code-review-skill` 才接手審查

## 🛡️ AI 幻覺防護機制

### 三層防護

1. **`evidence-based-coding` skill (新增)**
   - 強制要求每個聲明都有證據
   - 禁止使用「可能」、「應該」等推測性詞語
   - 要求使用 Read/Grep/Glob 驗證所有聲明

2. **`systematic-debugging` skill (已有)**
   - 禁止猜測式修復
   - 要求完整的根因分析
   - 第 64 行: "If not reproducible → gather more data, don't guess"

3. **`skill-rules.json` 反幻覺規則**
   - `verify_before_claim`: 工具操作後驗證結果
   - `no_assumed_apis`: 禁止假設 API 簽名
   - `evidence_based_debugging`: 只基於證據做聲明

### 實際效果

**沒有防護時 (❌)**:
```
用戶：「getUserById 函數在哪裡？」
Claude：「getUserById 函數可能在 src/services/user.service.ts，
        它應該接受一個 ID 參數並返回 User 對象。」
[完全是猜測！]
```

**有防護時 (✅)**:
```
用戶：「getUserById 函數在哪裡？」
Claude：[使用 Grep 搜尋 "getUserById"]
        [找到 src/api/user.ts:45]
        [使用 Read 讀取實際代碼]
        「我在 src/api/user.ts:45 找到了 getUserById。
        它接受 (id: string, includeDeleted?: boolean) 參數，
        返回 Promise<User | null>。這是實際代碼：
        [顯示代碼]」
[基於實際證據！]
```

## 📋 使用指南

### 調試 Bug 時

1. **自動觸發**: `systematic-debugging` (CRITICAL 優先級)
2. **流程**:
   - Phase 1: Root Cause Investigation (不要猜測)
   - Phase 2: Pattern Analysis
   - Phase 3: Hypothesis and Testing
   - Phase 4: Implementation

### Code Review 時

1. **自動觸發**: `code-review-skill`
2. **如果發現 bug**: 自動轉交給 `systematic-debugging`
3. **如果發現性能問題**: 標記並建議使用 `performance-optimization`

### 性能優化時

1. **自動觸發**: `performance-optimization` (當提到「慢」、「優化」)
2. **原則**: Measure First, Optimize Second
3. **排除**: 架構設計（那是 `backend-patterns` 的職責）

### 寫測試時

1. **手動調用**: `/testing-strategy`
2. **涵蓋**: Unit/Integration/E2E, TDD, 修復 flaky tests
3. **不包括**: 調試失敗的測試（用 `systematic-debugging`）

### 安全審查時

1. **手動調用**: `/security-checklist`
2. **涵蓋**: OWASP Top 10, 輸入驗證, 認證授權
3. **不包括**: 滲透測試（僅防禦性安全）

## 🚀 最佳實踐

### DO ✅

- **依賴 `evidence-based-coding`**: 讓它強制你驗證所有聲明
- **讓 `systematic-debugging` 接管 bug**: 不要猜測式修復
- **明確指定 skill**: 當自動選擇不對時，用 `/skill-name`
- **提供上下文**: 詳細描述問題，幫助正確觸發 skill

### DON'T ❌

- **不要跳過證據收集**: 即使看起來「顯而易見」
- **不要繞過 systematic-debugging**: 即使是「簡單的 bug」
- **不要同時處理架構和性能**: 分開處理
- **不要在有 bug 時 review**: 先修 bug

## 📊 Skill 優先級圖

```
CRITICAL (紅色警報 - 絕對優先)
├─ systematic-debugging (遇到 bug 時)
└─ evidence-based-coding (全局強制)

HIGH (高優先級)
├─ security-checklist (安全問題)
└─ performance-optimization (性能問題)

MEDIUM (中等優先級)
├─ code-review-skill
├─ backend-patterns
└─ testing-strategy

LOW (低優先級 - 工具性質)
├─ commit-conventions
├─ decision-log
└─ file-search
```

## 🔧 自訂和擴展

### 新增專案級 Skill

在專案根目錄創建 `.claude/skills/`：

```bash
my-project/
├─ .claude/
│  └─ skills/
│     ├─ react-patterns/        # 專案特定的 React 模式
│     ├─ api-conventions/        # 專案的 API 規範
│     └─ database-schemas/       # 資料庫 schema 文檔
└─ src/
```

**專案 skill 優先於全域 skill**，可以覆蓋全域設定。

### 修改現有 Skill

1. 編輯 `skills/{skill-name}/SKILL.md`
2. 修改 frontmatter (---之間的部分)
3. 調整內容

### 調整優先級

編輯 `skill-rules.json` 中的 `priority_rules`:

```json
{
  "priority_rules": [
    {
      "name": "your-custom-rule",
      "when": { "user_mentions_any": ["keyword"] },
      "then": { "primary_skill": "your-skill" }
    }
  ]
}
```

## 🧪 測試場景

### 測試衝突解決

```bash
# 測試 1: Performance vs Architecture
"這個 API 查詢很慢，幫我優化"
→ 應該觸發: performance-optimization

"設計一個 API 架構來處理大量請求"
→ 應該觸發: backend-patterns

# 測試 2: Review vs Debugging
"Review 這個 PR"
→ 應該觸發: code-review-skill

"Review 這個 PR，測試一直失敗"
→ 應該觸發: systematic-debugging (優先)
→ 然後: code-review-skill (修復後)
```

### 測試反幻覺

```bash
# 測試 3: 禁止假設
"getUserById 函數在哪裡？"
→ Claude 應該使用 Grep 搜尋，而不是猜測

# 測試 4: 要求證據
"這個函數做什麼？"
→ Claude 應該先 Read 代碼，然後基於實際代碼回答

# 測試 5: 驗證修復
"修復這個 bug"
→ Claude 應該修改後運行測試，驗證修復成功
```

## 📚 參考資料

- **Conventional Commits**: https://www.conventionalcommits.org/
- **OWASP Top 10**: https://owasp.org/Top10/
- **Testing Pyramid**: https://martinfowler.com/articles/practical-test-pyramid.html
- **Systematic Debugging**: `skills/systematic-debugging/SKILL.md`

## 🆘 故障排除

### Skill 沒有觸發

1. 檢查觸發關鍵字是否在 `description` 中
2. 查看 `skill-rules.json` 是否有衝突規則
3. 嘗試手動調用: `/skill-name`

### 多個 Skills 同時觸發

1. 這是正常的（如果它們互補）
2. 如果衝突，檢查 `skill-rules.json` 的 `conflict_resolution`
3. 可能需要手動指定: `/systematic-debugging` 或 `/code-review`

### AI 仍然在猜測

1. 確認 `evidence-based-coding` skill 已安裝
2. 檢查 `skill-rules.json` 中的 `anti_hallucination_rules`
3. 在提示中明確要求：「請先用 Grep 找到實際代碼」

## 🎓 學習路徑

### 新手 (第 1-2 週)

專注使用:
- `systematic-debugging` - 學習不猜測
- `evidence-based-coding` - 學習要求證據
- `commit-conventions` - 學習寫好的 commit message

### 中級 (第 3-4 週)

開始使用:
- `testing-strategy` - 學習寫測試
- `code-review-skill` - 學習審查代碼
- `security-checklist` - 學習安全最佳實踐

### 高級 (第 5+ 週)

精通:
- `backend-patterns` - 掌握架構模式
- `performance-optimization` - 掌握優化技巧
- `skill-developer` - 創建自己的 skills

## 📝 更新日誌

### 2026-02-09 - v1.0.0

- ✅ 創建完整的全域 skills 集合
- ✅ 解決 backend-patterns vs performance-optimization 衝突
- ✅ 解決 code-review-skill vs systematic-debugging 衝突
- ✅ 新增 `evidence-based-coding` skill 防止 AI 幻覺
- ✅ 新增 `testing-strategy` skill
- ✅ 新增 `security-checklist` skill
- ✅ 新增 `commit-conventions` skill
- ✅ 創建 `skill-rules.json` 衝突處理配置
- ✅ 修改現有 skills 的 description 避免衝突

## 💬 反饋和貢獻

遇到問題或有改進建議？

1. 記錄在 `docs/DECISIONS.md` (使用 `/decision-log`)
2. 或者在專案 repo 提 issue

---

**記住**: Skills 是工具，不是規則。如果某個 skill 的建議不適合當前情況，可以選擇忽略。但 `evidence-based-coding` 和 `systematic-debugging` 的原則應該始終遵守。

**Never assume. Always verify. No claims without evidence.** 🎯
