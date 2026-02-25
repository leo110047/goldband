# Leo's Claude Code Config

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**我的完整 Claude Code 設定集合 — Skills、Commands、Rules、Contexts、Hooks。**

經過日常密集使用演化而來的生產級配置，核心設計理念：**防止 AI 幻覺、系統性除錯、證據驅動開發**。

---

## 目錄

- [包含什麼](#包含什麼)
- [快速參考卡](#快速參考卡)
- [快速開始](#快速開始)
- [目錄結構](#目錄結構)
- [Skills — 核心能力](#skills--核心能力)
- [Commands — 工作流命令](#commands--工作流命令)
- [Rules — 永遠生效的底線](#rules--永遠生效的底線)
- [Contexts — 模式切換](#contexts--模式切換)
- [Permissions — 權限設定](#permissions--權限設定)
- [Hooks — 自動化守護](#hooks--自動化守護)
- [Unity 專案 Skills](#unity-專案-skills)
- [使用指南](#使用指南)
- [建議工作流](#建議工作流)
- [疑難排解](#疑難排解)
- [自訂與擴展](#自訂與擴展)
- [License](#license)

---

## 包含什麼

| 組件 | 數量 | 說明 |
|------|------|------|
| **Skills** | 14 全域 + 5 Unity | 涵蓋除錯、安全、架構、測試、效能、API、資料庫、CI/CD 等 |
| **Commands** | 5 | `/plan`、`/verify`、`/checkpoint`、`/code-review`、`/verify-config` |
| **Rules** | 3 | coding-style、security、git-workflow |
| **Contexts** | 4 | dev、review、research、debug 模式切換 |
| **Hooks** | 10 | 秘鑰偵測、自動格式化、型別檢查、console.log 警告、桌面通知等 |

---

## 快速參考卡

### 全域 Skills（14 個）

| Skill | 觸發情境 | 優先級 |
|-------|---------|--------|
| `systematic-debugging` | bug、error、test fail、壞了 | CRITICAL |
| `evidence-based-coding` | 全域強制，所有主張必須有證據 | CRITICAL |
| `security-checklist` | 安全檢查、OWASP、漏洞掃描 | HIGH |
| `performance-optimization` | 慢、優化、瓶頸、延遲 | HIGH |
| `code-review-skill` | review PR、看 code、審查 | MEDIUM |
| `backend-patterns` | 設計 API、架構、實作 | MEDIUM |
| `testing-strategy` | 寫測試、提高覆蓋率、TDD | MEDIUM |
| `database-patterns` | Schema 設計、查詢優化、Migration | MEDIUM |
| `api-design` | REST 設計、Error format、Pagination | MEDIUM |
| `ci-cd-integration` | GitHub Actions、部署策略、Pipeline | MEDIUM |
| `commit-conventions` | Git commit 格式 | LOW |
| `decision-log` | 架構決策記錄 | LOW |
| `file-search` | 找檔案、找程式碼 | LOW |
| `skill-developer` | 建立/管理 skills | LOW |

### Commands（5 個）

| 命令 | 用途 |
|------|------|
| `/plan` | 開始新功能前的規劃，需確認才動工 |
| `/verify` | build + types + lint + tests + console.log 審計 |
| `/checkpoint` | 建立/比對工作回復點 |
| `/code-review` | 按 CRITICAL/HIGH/MEDIUM 分級的安全+品質審查 |
| `/verify-config` | 檢查配置安裝狀態（symlinks、hooks、skills） |

---

## 快速開始

```bash
# 1. Clone
git clone https://github.com/leo110047/Skills.git
cd Skills

# 2. 一鍵安裝（含 hooks 自動合併）
./install.sh

# 3. 重啟 Claude Code，完成！
```

### 選擇性安裝

```bash
./install.sh skills        # 只裝 skills
./install.sh commands      # 只裝 commands
./install.sh skills rules  # 裝 skills + rules
./install.sh unity         # 在 Unity 專案中安裝專案 skills
./install.sh status        # 檢查安裝狀態
./install.sh uninstall     # 移除所有安裝
```

> **Note**: hooks 安裝需要 `jq`。若未安裝，會顯示手動合併提示。macOS 安裝: `brew install jq`

---

## 目錄結構

```
├── skills/
│   ├── global/                 # 14 個全域 skills
│   │   ├── systematic-debugging/
│   │   ├── evidence-based-coding/
│   │   ├── code-review-skill/
│   │   ├── backend-patterns/
│   │   ├── performance-optimization/
│   │   ├── testing-strategy/
│   │   ├── security-checklist/
│   │   ├── commit-conventions/
│   │   ├── database-patterns/
│   │   ├── api-design/
│   │   ├── ci-cd-integration/
│   │   ├── decision-log/
│   │   ├── file-search/
│   │   ├── skill-developer/
│   │   └── skill-rules.json    # 衝突解決 + 防幻覺規則（參考文件）
│   └── projects/
│       └── unity/              # 5 個 Unity 專案 skills
├── commands/                   # 5 個斜線命令
├── contexts/                   # 4 個模式切換
├── rules/                      # 3 個永遠生效的規則
├── hooks/                      # Hook 配置 + 10 個腳本
│   ├── hooks.json
│   └── scripts/
├── examples/                   # 範例 CLAUDE.md
├── install.sh                  # 安裝腳本
└── README.md
```

---

## Skills — 核心能力

### Skill 優先級

```
CRITICAL（絕對優先）
├─ systematic-debugging    有 bug/error 時自動觸發
└─ evidence-based-coding   全域強制，防止 AI 幻覺

HIGH
├─ security-checklist      安全問題
└─ performance-optimization 效能問題

MEDIUM
├─ code-review-skill       代碼審查
├─ backend-patterns        架構設計
├─ testing-strategy        測試策略
├─ database-patterns       資料庫設計
├─ api-design              API 設計
└─ ci-cd-integration       CI/CD 流程

LOW（工具性質）
├─ commit-conventions      Git commit 規範
├─ decision-log            架構決策記錄
├─ file-search             代碼搜尋
└─ skill-developer         Skill 開發工具
```

### 三層防幻覺機制

1. **evidence-based-coding** — 全域強制驗證，所有主張必須有證據
2. **systematic-debugging** — 禁止猜測式修復，必須系統性除錯
3. **skill-rules.json** — 衝突解決 + 防幻覺規則

**效果**: AI 回答時會先用 Grep/Read 搜尋驗證，再引用具體 file:line，不會猜測。

### 智能衝突解決

```
"API 很慢"           → performance-optimization（效能優先）
"設計 API"           → backend-patterns（架構優先）
"Review PR，測試失敗" → systematic-debugging（先修 bug）→ code-review-skill
```

---

## Commands — 工作流命令

| 命令 | 用途 | 參數 |
|------|------|------|
| `/plan` | 功能規劃，需確認才動工 | 需求描述 |
| `/verify` | 完整品質檢查 | `quick`、`pre-commit`、`pre-pr` |
| `/checkpoint` | 建立/比對工作回復點 | `create`、`verify`、`list` |
| `/code-review` | 安全+品質審查 | - |
| `/verify-config` | 配置健康檢查 | `quick` |

---

## Rules — 永遠生效的底線

| Rule | 內容 |
|------|------|
| `coding-style.md` | 不可變性、檔案 <800 行、函數 <50 行、錯誤處理 |
| `security.md` | 每次 commit 前的安全檢查清單（OWASP） |
| `git-workflow.md` | Conventional commits、PR 流程 |

Rules 和 Skills 的差異：Rules **每次對話自動載入**，Skills 需要觸發。

---

## Contexts — 模式切換

| Context | 行為 | 重點 |
|---------|------|------|
| `dev.md` | 先做出來、再做對、再做乾淨 | 實作優先 |
| `review.md` | 按嚴重度排序、附修復建議 | 品質優先 |
| `research.md` | 先理解再動手、多用搜尋工具 | 理解優先 |
| `debug.md` | 系統性除錯、一次一假設 | 根因分析 |

---

## Permissions — 權限設定

預設模式為 `acceptEdits`，搭配安全的 allow/deny 規則：

- **Allow**: 常用的安全指令（git、npm、node、ls、cat 等）自動放行
- **Deny**: 危險指令（sudo、dd、chmod 777 等）直接封鎖

透過 `install.sh hooks` 安裝，會自動合併到 `~/.claude/settings.json`。

---

## Hooks — 自動化守護

| Hook | 觸發時機 | 功能 |
|------|---------|------|
| Dev server blocker | PreToolUse (Bash) | 阻止在 tmux 外跑 dev server |
| Git push reminder | PreToolUse (Bash) | push 前提醒檢查 |
| Doc file blocker | PreToolUse (Write) | 阻止建立無用的 .md 檔 |
| **Secret detector** | **PreToolUse (Edit\|Write)** | **偵測 13+ 種秘鑰並封鎖** |
| Strategic compact | PreToolUse (Edit\|Write) | 50 次工具呼叫後提醒 compact |
| Prettier format | PostToolUse (Edit) | 編輯後自動格式化 |
| TypeScript check | PostToolUse (Edit) | 編輯 .ts 後自動型別檢查 |
| Console.log warn | PostToolUse + Stop | 警告 console.log 殘留 |
| **Desktop notification** | **Stop** | **回覆完成時桌面通知（僅在離開終端時）** |

---

## Unity 專案 Skills

專為 Unity 遊戲開發的 5 個 skills：

| Skill | 用途 |
|-------|------|
| `unity-best-practices` | MonoBehaviour 設計、ScriptableObject、組件架構 |
| `unity-multiplatform` | iOS/Android/WebGL 多平台開發 |
| `unity-performance` | Profiler、GC 優化、渲染優化 |
| `unity-architecture` | MVC/ECS/Service Locator |
| `unity-app-store-deployment` | Google Play + App Store 雙平台上架 |

```bash
cd /path/to/your-unity-project
/path/to/Skills/install.sh unity
```

---

## 使用指南

### Skills 觸發方式

**自動觸發**（用對關鍵字即可）：

```
「這個 test 一直 fail」   → systematic-debugging
「API 很慢」              → performance-optimization
「設計一個 API」          → backend-patterns
「review 這個 PR」        → code-review-skill
「Schema 怎麼設計」       → database-patterns
「設定 GitHub Actions」   → ci-cd-integration
```

**強制觸發**（用 `/` 指定 skill 名稱）：

```
/systematic-debugging 這個 API 回傳 500 但 log 沒有錯誤
/security-checklist 幫我檢查這個 API 的安全性
/testing-strategy 這個模組該怎麼寫測試
```

### Contexts 切換

```
用 dev 模式，幫我實作使用者登入功能
用 debug 模式，找出這個 500 error 的根因
用 review 模式，幫我看這次的改動
```

---

## 建議工作流

```
新功能 ───→ /plan 需求描述
             ↓ 確認
寫 code ──→ （rules 自動生效、skills 自動觸發）
             ↓
中途存檔 ─→ /checkpoint create 名稱
             ↓
遇到 bug ─→ 直接說「這個 test fail 了」或 /systematic-debugging
             ↓
寫完 ─────→ /code-review
             ↓
修完問題 ─→ /verify pre-pr
             ↓
全 PASS ──→ commit & push
```

---

## 疑難排解

| 問題 | 可能原因 | 解決方法 |
|------|---------|---------|
| Skill 沒有自動觸發 | 關鍵字不夠明確 | 使用 `/skill-name` 強制觸發，或在描述中加入觸發關鍵字 |
| Hook 沒有執行 | hooks 未合併到 settings.json | 執行 `./install.sh hooks`，確認 jq 已安裝 |
| `jq` 未安裝 | macOS 預設無 jq | `brew install jq`，然後重新 `./install.sh hooks` |
| Skill 載入但內容不完整 | reference 檔案未跟隨 symlink | 確認 `~/.claude/skills` 是正確的 symlink（`./install.sh status`） |
| `/verify-config` 報告 ERROR | 安裝不完整 | 執行 `./install.sh` 全部重裝 |
| Hooks 路徑錯誤 | `${HOOKS_DIR}` 未替換 | 重新執行 `./install.sh hooks`（自動替換）或手動編輯 settings.json |
| TypeScript 檢查沒有跑 | 無 tsconfig.json | Hook 只在找到 tsconfig.json 的專案中執行 |
| Prettier 格式化失敗 | Prettier 未安裝 | Hook 靜默失敗，無影響。可用 `npm i -D prettier` 安裝 |

---

## 自訂與擴展

### 新增 Skill

```bash
mkdir skills/global/your-new-skill
# 建立 SKILL.md（參考 skill-developer skill，遵守 500 行規則）
```

### 新增專案類型

```bash
mkdir -p skills/projects/react
# 建立專案專用 skills + skill-rules.json
```

### 修改 Hook

編輯 `hooks/hooks.json`，然後執行 `./install.sh hooks` 自動合併。

---

## License

MIT License — 自由使用、修改和分發。
