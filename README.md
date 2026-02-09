# Claude Code Skills Repository

完整的 Claude Code skills 集合，包含**全域 skills**（所有專案通用）和**專案特定 skills**（Unity、React 等）。

## 📁 倉庫結構

```
claude-code-skills/
│
├── global/                    # 全域 skills
│   ├── systematic-debugging/
│   ├── evidence-based-coding/
│   ├── code-review-skill/
│   ├── backend-patterns/
│   ├── performance-optimization/
│   ├── testing-strategy/
│   ├── security-checklist/
│   ├── commit-conventions/
│   ├── decision-log/
│   ├── file-search/
│   ├── skill-developer/
│   ├── skill-rules.json
│   └── README.md
│
├── projects/                  # 專案特定 skills
│   └── unity/                 # Unity 遊戲開發
│       ├── unity-best-practices/
│       ├── unity-multiplatform/
│       ├── unity-performance/
│       ├── unity-architecture/
│       ├── skill-rules.json
│       └── README.md
│
├── install.sh                 # 安裝腳本
└── README.md                  # 本文件
```

## 🚀 快速開始

### 1. 克隆倉庫

```bash
git clone https://github.com/your-username/claude-code-skills.git
cd claude-code-skills
```

### 2. 安裝全域 Skills

```bash
# 方法 A: 符號連結 (推薦 - 自動同步更新)
ln -s $(pwd)/global ~/.claude/skills

# 方法 B: 複製
cp -r global ~/.claude/skills
```

### 3. 安裝專案 Skills (以 Unity 為例)

```bash
cd /path/to/your-unity-project

# 創建 .claude 目錄
mkdir -p .claude

# 方法 A: 符號連結
ln -s /path/to/claude-code-skills/projects/unity .claude/skills

# 方法 B: 複製
cp -r /path/to/claude-code-skills/projects/unity .claude/skills
```

## 📦 Global Skills (全域)

適用於**所有專案類型**的通用 skills：

| Skill | 用途 | 優先級 |
|-------|------|--------|
| **systematic-debugging** | 系統性調試，禁止猜測 | 🔴 CRITICAL |
| **evidence-based-coding** | 防止 AI 幻覺，要求證據 | 🔴 CRITICAL |
| **code-review-skill** | 代碼審查（多語言） | 🟡 MEDIUM |
| **backend-patterns** | 後端架構模式 | 🟡 MEDIUM |
| **performance-optimization** | 性能優化 | 🟡 HIGH |
| **testing-strategy** | 測試策略 (Unit/Integration/E2E) | 🟡 MEDIUM |
| **security-checklist** | 安全檢查 (OWASP Top 10) | 🟡 HIGH |
| **commit-conventions** | Git commit 規範 | 🟢 LOW |
| **decision-log** | 架構決策記錄 (ADR) | 🟢 LOW |
| **file-search** | 代碼搜尋 | 🟢 LOW |
| **skill-developer** | Skill 開發工具 | 🟢 LOW |

詳細說明請查看 [global/README.md](global/README.md)

## 🎮 Project Skills (專案特定)

### Unity Game Development

專為 Unity 遊戲開發優化的 skills：

| Skill | 用途 |
|-------|------|
| **unity-best-practices** | Unity 資深工程師最佳實踐 |
| **unity-multiplatform** | 多平台開發 (iOS/Android/WebGL/PC) |
| **unity-performance** | Unity 性能優化 |
| **unity-architecture** | Unity 專案架構模式 |

詳細說明請查看 [projects/unity/README.md](projects/unity/README.md)

### 其他專案類型 (未來)

- **React** - React 19 最佳實踐
- **Node.js** - Node.js 後端開發
- **Python/Django** - Python Web 開發
- **Mobile (React Native)** - 跨平台移動開發

## 🎯 核心特性

### 1. 三層反幻覺防護

**防止 AI 猜測，強制證據驗證：**

- ✅ `evidence-based-coding` - 全局強制驗證
- ✅ `systematic-debugging` - 禁止猜測式修復
- ✅ `skill-rules.json` - 強制驗證規則

**效果對比：**

❌ **沒有防護**:
```
你: "getUserById 函數在哪裡？"
AI: "getUserById 可能在 src/services/user.service.ts"
```

✅ **有防護**:
```
你: "getUserById 函數在哪裡？"
AI: [用 Grep 搜尋 "getUserById"]
    [用 Read 讀取實際代碼]
    "我在 src/api/user.ts:45 找到了 getUserById..."
```

### 2. 智能衝突解決

**自動選擇正確的 skill：**

```
"API 很慢" → performance-optimization
"設計 API" → backend-patterns
"Review PR，測試失敗" → systematic-debugging (優先) → code-review-skill
```

### 3. 專案級別覆蓋

**專案 skills 可以覆蓋全域 skills：**

```
全域: performance-optimization (通用性能)
Unity 專案: unity-performance (Unity 特定)
→ Unity 專案中兩者協作，不衝突
```

## 📚 使用指南

### 場景 1: 修復 Bug

```
你: "測試失敗：Expected 90, got 80"

自動觸發: systematic-debugging (CRITICAL 優先級)

會做什麼:
  1. 要求更多信息（哪個測試？）
  2. 用 Grep 找到測試文件
  3. 用 Read 讀取實際代碼
  4. 分析根本原因（不猜測！）
  5. 提出修復方案
  6. 運行測試驗證
```

### 場景 2: Unity 專案開發

```
你: "幫我寫一個 Unity 敵人 AI"

自動觸發: unity-best-practices

會做什麼:
  - 使用 MonoBehaviour 最佳實踐
  - 單一職責組件設計
  - 正確使用 SerializeField
  - 緩存 Component references
  - 遵循 Unity C# 命名規範
```

### 場景 3: Code Review

```
你: "Review 這個 PR"

自動觸發: code-review-skill

如果發現 bug:
  → 自動轉交 systematic-debugging
  → 修復後繼續 review
```

## 🔧 進階配置

### 自訂全域 skill-rules.json

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

### 添加新的專案類型

```bash
mkdir -p projects/your-project-type
# 創建 skills...
# 創建 skill-rules.json
# 創建 README.md
```

## 📊 Skill 優先級總覽

```
🔴 CRITICAL (絕對優先)
   ├─ systematic-debugging (有 bug 時)
   └─ evidence-based-coding (全局強制)

🟡 HIGH (高優先級)
   ├─ security-checklist (安全問題)
   ├─ performance-optimization (性能問題)
   └─ unity-performance (Unity 性能)

🟢 MEDIUM (中等優先級)
   ├─ code-review-skill
   ├─ backend-patterns
   ├─ testing-strategy
   ├─ unity-best-practices
   └─ unity-multiplatform

🔵 LOW (工具性質)
   ├─ commit-conventions
   ├─ decision-log
   ├─ file-search
   └─ skill-developer
```

## 🧪 驗證安裝

### 測試全域 Skills

```
你: "getUserById 函數在哪裡？"

期望: Claude 使用 Grep 搜尋，不會猜測
```

### 測試 Unity Skills (在 Unity 專案中)

```
你: "幫我寫一個 Unity 組件"

期望: Claude 使用 Unity 最佳實踐，不會寫通用 C#
```

## 🤝 貢獻

歡迎貢獻新的 skills 或改進現有 skills！

### 新增專案類型

1. Fork 倉庫
2. 創建 `projects/your-project/`
3. 添加 skills
4. 創建 skill-rules.json 和 README.md
5. 提交 Pull Request

### 改進現有 Skills

1. 編輯對應的 SKILL.md
2. 更新 README.md
3. 提交 Pull Request

## 📝 更新日誌

### v1.0.0 (2026-02-09)

- ✅ 完整的全域 skills (11 個)
- ✅ Unity 專案 skills (4 個)
- ✅ 三層反幻覺防護
- ✅ 智能衝突解決
- ✅ 完整文檔和安裝指南

## 📄 License

MIT License - 自由使用、修改和分發

## 🆘 需要幫助？

- 查看 [global/README.md](global/README.md) - 全域 skills 詳細說明
- 查看 [projects/unity/README.md](projects/unity/README.md) - Unity skills 詳細說明
- 提交 Issue - [GitHub Issues](https://github.com/your-username/claude-code-skills/issues)

---

**Remember: Never assume. Always verify. No claims without evidence.** 🎯
