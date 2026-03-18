# goldband

> Claude Code 的緊箍咒 — Skills, hooks & guardrails that keep your AI disciplined.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

我的 Claude Code 配置集合，經過日常密集使用演化而來。核心設計理念：**防止 AI 幻覺、系統性除錯、證據驅動開發、流程編排強制設計先行**。

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
| **Skills** | 20 全域 + 10 Unity | 涵蓋除錯、安全、架構、測試、效能、API、資料庫、CI/CD、規劃、Subagent、按需安全模式、skill scaffolding 等 |
| **Commands** | 7 | `/plan`、`/verify`、`/checkpoint`、`/code-review`、`/discuss`、`/map-codebase`、`/verify-config` |
| **Rules** | 3 | coding-style、security、git-workflow |
| **Contexts** | 4 | dev、review、research、debug 模式切換 |
| **Hooks** | Router + 5 phase hooks | 單一路由分派：阻斷策略、context 監控、async format/typecheck、console 稽核、桌面通知 |

---

## 快速參考卡

### 全域 Skills（20 個）

| Skill | 觸發情境 | 優先級 |
|-------|---------|--------|
| `systematic-debugging` | bug、error、test fail、壞了 | CRITICAL |
| `evidence-based-coding` | 全域強制，所有主張必須有證據 + 完成驗證 Iron Law | CRITICAL |
| `security-checklist` | 安全檢查、OWASP、漏洞掃描 | HIGH |
| `performance-optimization` | 慢、優化、瓶頸、延遲 | HIGH |
| `careful-mode` | force-push、destroy、delete、prod CLI 前，啟用按需防呆 | MEDIUM |
| `freeze-mode` | prod/敏感系統調查時，鎖成唯讀 session | MEDIUM |
| `code-review-skill` | review PR、看 code、審查 | MEDIUM |
| `backend-patterns` | 設計 API、架構、實作 | MEDIUM |
| `testing-strategy` | 寫測試、提高覆蓋率、TDD | MEDIUM |
| `database-patterns` | Schema 設計、查詢優化、Migration | MEDIUM |
| `api-design` | REST 設計、Error format、Pagination | MEDIUM |
| `ci-cd-integration` | GitHub Actions、部署策略、Pipeline | MEDIUM |
| `claude-config-verification` | 驗證 Claude Code config/plugin repo、hooks、skills 與 plugin data | MEDIUM |
| `planning-workflow` | `/plan` 時自動觸發，結構化任務拆解 | MEDIUM |
| `subagent-development` | Subagent 調度、兩階段 review、prompt 工程 | MEDIUM |
| `commit-conventions` | Git commit 格式 | LOW |
| `decision-log` | 架構決策記錄 | LOW |
| `file-search` | 找檔案、找程式碼 | LOW |
| `new-skill-scaffold` | 產生符合 repo 慣例的新 skill scaffold（含 `reference/`、`scripts/`、`config.json`） | LOW |
| `skill-developer` | 建立/管理 skills | LOW |

### Commands（7 個）

| 命令 | 用途 |
|------|------|
| `/plan` | 開始新功能前的規劃，含 Hard Gate 強制設計先行 |
| `/discuss` | 辨識灰色地帶、結構化決策，在 `/plan` 前使用 |
| `/verify` | build + types + lint + tests + console.log 審計，支援 `--goal` 三層驗證 |
| `/checkpoint` | 建立/比對工作回復點，支援 `pause`/`resume` 跨 session 續接 |
| `/code-review` | 兩階段審查：Stage 1 Spec Compliance（`--spec`）+ Stage 2 品質審查 |
| `/map-codebase` | 產出 STACK / CONVENTIONS / ARCHITECTURE / TESTING / CONCERNS 分析 |
| `/verify-config` | 檢查配置安裝狀態（symlinks、hooks、skills） |

---

## 快速開始

```bash
# 1. Clone
git clone https://github.com/leo110047/goldband.git
cd goldband

# 2. 一鍵安裝（含 hooks 自動合併）
./install.sh   # 預設 pack-core（core-security，最低 token）

# 3. 重啟 Claude Code，完成！
```

### 選擇性安裝

```bash
./install.sh pack-core         # core-security（skills-core + rules + hooks）
./install.sh pack-quality      # core-quality（skills-dev + commands/contexts/rules/hooks）
./install.sh pack-unity        # unity-pack（pack-quality + unity skills）
./install.sh skills-core       # 核心常駐 skills（最低 token）
./install.sh skills-dev        # 開發常用 skills（core + auto，推薦）
./install.sh skills-full       # 全量 skills（20 個）
./install.sh all               # 相容舊用法，等同 pack-quality
./install.sh commands          # 只裝 commands
./install.sh all-full          # 全組件 + skills-full（舊行為）
./install.sh skills-dev rules  # 裝 dev profile + rules
./install.sh unity             # 在 Unity 專案中安裝專案 skills
./install.sh status            # 檢查安裝狀態
./install.sh uninstall         # 移除所有安裝
```

### Skills Profile 分層

- `core`: `evidence-based-coding`、`systematic-debugging`、`file-search`、`planning-workflow`、`security-checklist`、`performance-optimization`
- `dev`: `core` + `api-design`、`backend-patterns`、`careful-mode`、`freeze-mode`、`claude-config-verification`、`code-review-skill`、`database-patterns`、`testing-strategy`
- `full`: `dev` + `ci-cd-integration`、`commit-conventions`、`decision-log`、`new-skill-scaffold`、`skill-developer`、`subagent-development`

> **Note**: hooks 安裝需要 `jq`。若未安裝，會顯示手動合併提示。macOS 安裝: `brew install jq`

---

## 目錄結構

```
├── skills/
│   ├── global/                         # 20 個全域 skills
│   │   ├── systematic-debugging/
│   │   │   ├── reference/
│   │   │   ├── examples/
│   │   │   └── scripts/
│   │   ├── evidence-based-coding/
│   │   │   └── reference/              # Iron Law、驗證流程、幻覺模式、目標驗證
│   │   ├── code-review-skill/
│   │   │   └── reference/              # 語言指南、Spec Review 模板
│   │   ├── planning-workflow/
│   │   │   └── reference/              # 計畫模板（Single File / Multi-File / Refactoring / Bug Fix）
│   │   ├── subagent-development/
│   │   │   └── reference/              # Prompt 模板（Implementer / Reviewer）
│   │   ├── backend-patterns/
│   │   ├── performance-optimization/
│   │   ├── testing-strategy/
│   │   ├── security-checklist/
│   │   ├── commit-conventions/
│   │   ├── careful-mode/
│   │   ├── freeze-mode/
│   │   ├── claude-config-verification/
│   │   ├── database-patterns/
│   │   ├── api-design/
│   │   ├── ci-cd-integration/
│   │   ├── decision-log/
│   │   ├── file-search/
│   │   ├── new-skill-scaffold/
│   │   ├── skill-developer/
│   │   └── skill-rules.json            # 參考文件（Not auto-loaded）
│   └── projects/
│       └── unity/                      # 10 個 Unity 專案 skills
├── commands/                           # 7 個斜線命令
├── contexts/                           # 4 個模式切換
├── rules/                              # 3 個永遠生效的規則
├── hooks/                              # Hook 配置 + router/worker/fixtures
│   ├── hooks.json
│   └── scripts/
│       ├── hooks/hook-router.js        # 單一入口（Pre/Post/Stop/Notification）
│       ├── hooks/post-edit-worker.js
│       └── tools/replay-hook-router.js
├── .claude-plugin/
│   └── plugin.json                     # 產品化 metadata + pack 定義
├── examples/                           # 範例 CLAUDE.md
├── install.sh                          # 安裝腳本
└── README.md
```

---

## Skills — 核心能力

### Skill 優先級

```
CRITICAL（絕對優先）
├─ systematic-debugging      有 bug/error 時自動觸發
└─ evidence-based-coding     全域強制，防止 AI 幻覺 + Iron Law 完成驗證

HIGH
├─ security-checklist        安全問題
└─ performance-optimization  效能問題

MEDIUM
├─ careful-mode              高風險 CLI 操作的按需防呆
├─ freeze-mode               唯讀調查模式，阻擋 edits 與非唯讀 Bash
├─ claude-config-verification Claude Code config/plugin repo 驗證
├─ code-review-skill         代碼審查（含 Spec Compliance Review）
├─ backend-patterns          架構設計
├─ testing-strategy          測試策略
├─ database-patterns         資料庫設計
├─ api-design                API 設計
├─ ci-cd-integration         CI/CD 流程
├─ planning-workflow         結構化任務規劃（2-5 分鐘粒度、TDD 順序）
└─ subagent-development      Subagent 調度 + 兩階段 review

LOW（工具性質）
├─ commit-conventions        Git commit 規範
├─ decision-log              架構決策記錄
├─ file-search               代碼搜尋
├─ new-skill-scaffold        產生新 skill scaffold + config/setup stub
└─ skill-developer           Skill 開發工具
```

### 四層防幻覺機制

1. **evidence-based-coding** — 全域強制驗證，所有主張必須有證據（三定律）
2. **Iron Law 完成驗證** — 5-Step Gate：IDENTIFY → RUN → READ → VERIFY → CLAIM
3. **systematic-debugging** — 禁止猜測式修復，必須系統性除錯
4. **skill-rules.json（設計文檔）** — 衝突解決與治理規則的單一參考來源（由 SKILL.md 與 hooks 實際落地）

**效果**: AI 回答時會先用 Grep/Read 搜尋驗證，再引用具體 file:line，不會猜測。完成時必須提供新鮮的驗證證據。

### 流程編排

```
/discuss  → 辨識灰色地帶、鎖定決策
    ↓
/plan     → Hard Gate 強制設計先行（EXPLORE → CLARIFY → PLAN → APPROVE）
    ↓
實作      → planning-workflow 提供 2-5 分鐘粒度的結構化任務
    ↓
驗證      → /verify --goal 三層驗證（EXISTS → SUBSTANTIVE → WIRED）
    ↓
審查      → /code-review --spec 兩階段（Spec Compliance + 品質）
```

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
| `/discuss` | 辨識灰色地帶、結構化決策 | 目標描述 |
| `/plan` | 功能規劃，Hard Gate 強制確認才動工 | 需求描述 |
| `/verify` | 完整品質檢查 | `quick`、`pre-commit`、`pre-pr`、`--goal "目標"` |
| `/checkpoint` | 建立/比對工作回復點 | `create`、`verify`、`list`、`pause`、`resume` |
| `/code-review` | 兩階段安全+品質審查 | `--spec`、`--spec <file>` |
| `/map-codebase` | 產出結構化 codebase 分析文件 | `tech`、`arch`、`quality`、`conventions`、`testing` |
| `/verify-config` | 配置健康檢查 | `quick` |

```bash
/discuss 我想加一個使用者登入功能                # 先釐清灰色地帶
/plan 實作 OAuth2 登入，支援 Google 和 GitHub  # 設計先行，確認才動工
/verify quick                               # 快速檢查 build + types
/verify --goal "OAuth 登入, token 刷新"      # 三層驗證：EXISTS → SUBSTANTIVE → WIRED
/checkpoint create oauth-done               # 建立回復點
/checkpoint pause                           # 跨 session 存檔
/code-review --spec                         # 兩階段審查：需求對照 + 品質
/map-codebase arch                          # 產出架構分析文件
```

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

預設模式為 `acceptEdits`，搭配完整的 allow/deny 規則：

- **Allow（55+ 指令）**: git 全系列、npm/npx、檔案操作（ls/cd/cp/mv/rm/find/mkdir/touch/chmod）、文字處理（grep/rg/sed/awk/sort/uniq/diff/head/tail）、開發工具（node/python/jq/curl/tar）、shell 工具（echo/printf/export/env/test/xargs/tee）
- **Deny**: 危險指令（sudo、dd、chmod 777、寫入 /dev/）

透過 `install.sh hooks` 安裝，會自動合併到 `~/.claude/settings.json`。

---

## Hooks — 自動化守護

現在使用單一入口 `hooks/scripts/hooks/hook-router.js` 分派策略：

| Phase | 模式 | 行為 |
|------|------|------|
| `PreToolUse` | blocking + non-blocking | `careful-mode`/`freeze-mode` 啟用時會 block 對應高風險行為；`dev-server/doc-file/secret` 會 block；`git push` 只提醒 |
| `PostToolUse` | sync + native async | router 做 context/console 輕量檢查；`format/typecheck` 走官方 `async: true` |
| `Stop` | non-blocking | git diff console.log 稽核 + 桌面通知 |
| `Notification` | non-blocking | 權限詢問/問題提示通知 |
| `SubagentStop` | prompt hook | subagent 輸出證據檢查（spec review） |

### 可證明量測（Replay Harness）

```bash
node hooks/scripts/tools/replay-hook-router.js --iterations 20
```

回報指標：
- hook latency `p50/p95`
- 每次 `Edit` 的 process 成本（avg/p95）
- `block/allow` 比率
- 誤攔截率（expected allow 但被 block）

量測資料由 router 寫入 JSONL metrics（優先使用 `${CLAUDE_PLUGIN_DATA}`；已於 Claude Code `2.1.78` 的 plugin `SessionStart` live probe 驗證可用。若在舊版 runtime 或非 plugin 上下文執行，則退回系統 temp；也可用 `HOOK_ROUTER_METRICS_FILE` 覆寫）。
預設 metrics 關閉（`HOOK_ROUTER_METRICS_ENABLED=0`），只有量測時才建議開啟。

### On-Demand Careful Mode

```bash
node skills/global/careful-mode/scripts/careful-mode.js enable
node skills/global/careful-mode/scripts/careful-mode.js status
node skills/global/careful-mode/scripts/careful-mode.js disable
```

用途：
- 在 force-push、hard reset、destroy/delete 類操作前，先開啟額外保護
- state 依 session 儲存；Claude Code `2.1.78` 的 plugin session 已實測會注入 `${CLAUDE_PLUGIN_DATA}`，但若在非 plugin 上下文執行 script，仍可能退回 temp fallback
- 目前 block 規則聚焦在 `rm -rf`、force-push、`git reset --hard`、`terraform destroy`、`kubectl delete`、`helm uninstall`、destructive SQL

### On-Demand Freeze Mode

```bash
node skills/global/freeze-mode/scripts/freeze-mode.js enable
node skills/global/freeze-mode/scripts/freeze-mode.js status
node skills/global/freeze-mode/scripts/freeze-mode.js disable
```

用途：
- 在 incident triage / prod 調查時，先鎖成 inspection-only session
- 會 block `Edit` / `Write`，Bash 只允許明確 allowlisted 的唯讀 inspection 指令
- 適合「先看清楚，再決定要不要動手」的窗口

### Usage Telemetry

```bash
node hooks/scripts/tools/report-usage-summary.js --days 30
```

目前 telemetry 會追蹤：
- code-backed skills（例如 `claude-config-verification` scripts）
- on-demand modes 的 enable/disable
- mode enforcement block 事件

限制：
- 目前 runtime 的 hook payload 沒有直接給 active skill list，所以純 markdown auto-trigger skills 還無法做完整自動 usage telemetry。

---

## Unity 專案 Skills

專為 Unity 遊戲開發的 10 個 skills：

| Skill | 用途 |
|-------|------|
| `unity-best-practices` | MonoBehaviour 設計、ScriptableObject、組件架構 |
| `unity-multiplatform` | iOS/Android/WebGL 多平台開發 |
| `unity-performance` | Profiler、GC 優化、渲染優化 |
| `unity-architecture` | MVC/ECS/Service Locator |
| `unity-app-store-deployment` | Google Play + App Store 雙平台上架 |
| `unity-job-system` | Job System、Burst、NativeContainer、Sim/Render 並行 |
| `unity-networking` | NGO、NetworkVariable、RPC、Server-Authoritative |
| `unity-object-pooling` | ObjectPool、零分配策略、預熱與池化規劃 |
| `unity-profiling` | ProfilerMarker、FrameTiming、GC/Hitch 分析、效能預算 |
| `unity-testing` | Unity Test Framework、EditMode/PlayMode、CI 測試整合 |

```bash
cd /path/to/your-unity-project
/path/to/Skills/install.sh unity
```

---

## 使用指南

### Skills 觸發方式

**自動觸發**（用對關鍵字即可）：

```
「這個 test 一直 fail」          → systematic-debugging
「API 很慢」                    → performance-optimization
「設計一個 API」                 → backend-patterns
「review 這個 PR」              → code-review-skill
「Schema 怎麼設計」              → database-patterns
「設定 GitHub Actions」         → ci-cd-integration
「這次要 force-push / destroy」 → careful-mode
「先只看 prod，不要改任何東西」    → freeze-mode
```

**強制觸發**（用 `/` 指定 skill 名稱）：

```
/systematic-debugging 這個 API 回傳 500 但 log 沒有錯誤
/security-checklist 幫我檢查這個 API 的安全性
/testing-strategy 這個模組該怎麼寫測試
/careful-mode 這次要對 prod cluster 動手，先上額外保護
/freeze-mode 這次先做唯讀調查，不要允許任何修改
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
需求不明確 ─→ /discuss 辨識灰色地帶、鎖定決策
                ↓
新功能 ─────→ /plan 需求描述（Hard Gate: EXPLORE → CLARIFY → PLAN → APPROVE）
                ↓ 確認
寫 code ────→ （rules 自動生效、skills 自動觸發）
                ↓
中途存檔 ──→ /checkpoint create 名稱
                ↓
跨 session ─→ /checkpoint pause → 下次 /checkpoint resume
                ↓
遇到 bug ──→ 直接說「這個 test fail 了」或 /systematic-debugging
                ↓
寫完 ──────→ /code-review（加 --spec 做 Spec Compliance Review）
                ↓
修完問題 ──→ /verify pre-pr（或 --goal "目標" 做三層驗證）
                ↓
全 PASS ───→ commit & push
```

### Subagent 開發模式

當任務可以獨立拆分時，使用 subagent-development skill：

```
1. 拆任務 → planning-workflow 切成 2-5 分鐘的子任務
2. 派發   → 每個子任務給一個 fresh subagent
3. 審查   → Spec Review（需求對照）→ Quality Review（品質審查）
4. 整合   → ACCEPT / REVISE / REJECT
```

---

## 疑難排解

| 問題 | 可能原因 | 解決方法 |
|------|---------|---------|
| Skill 沒有自動觸發 | 關鍵字不夠明確 | 使用 `/skill-name` 強制觸發，或在描述中加入觸發關鍵字 |
| Hook 沒有執行 | hooks 未合併到 settings.json | 執行 `./install.sh hooks`，確認 jq 已安裝 |
| `jq` 未安裝 | macOS 預設無 jq | `brew install jq`，然後重新 `./install.sh hooks` |
| Skill 載入但內容不完整 | profile links 缺失/破損 | 執行 `./install.sh status` 檢查 `.goldband-profile` 與 skill links，必要時重跑 `./install.sh pack-core` |
| `/verify-config` 報告 ERROR | 安裝不完整 | 執行 `./install.sh` 全部重裝 |
| Hooks 路徑錯誤 | `${HOOKS_DIR}` 未替換 | 重新執行 `./install.sh hooks`（自動替換）或手動編輯 settings.json |
| TypeScript 檢查沒有跑 | 無 tsconfig.json | Hook 只在找到 tsconfig.json 的專案中執行 |
| Prettier 格式化失敗 | Prettier 未安裝 | Hook 靜默失敗，無影響。可用 `npm i -D prettier` 安裝 |
| Router 指標要重跑 | 需要基線量測 | 執行 `node hooks/scripts/tools/replay-hook-router.js --iterations 20` |
| Context monitor 沒警告 | 閾值可調 | 設定 `CONTEXT_WARN_THRESHOLD` / `CONTEXT_CRIT_THRESHOLD` 環境變數 |
| careful-mode 沒生效 | mode state 未啟用或 session 不一致 | 執行 `node skills/global/careful-mode/scripts/careful-mode.js status` 檢查目前 session 與 state file |
| freeze-mode 擋太多 | mode 設計本來就保守 | 先用 `status` 確認是否仍啟用；若要改動，先 `disable` 再執行 |

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

### Plugin Pack 與版本

- plugin metadata 在 `.claude-plugin/plugin.json`
- 預設 pack：`core-security`
- `x-goldband.release` 定義 semver 與發版節奏（major/minor/patch 政策）

### Context Monitor 閾值

```bash
# 在 shell profile 中設定（可選）
export CONTEXT_WARN_THRESHOLD=60   # WARNING 閾值（預設 60）
export CONTEXT_CRIT_THRESHOLD=85   # CRITICAL 閾值（預設 85）
```

---

## License

MIT License — 自由使用、修改和分發。
