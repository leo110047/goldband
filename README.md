# goldband

> Shared engineering guardrails for Claude Code and Codex.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

我的 AI coding agent 配置集合，同時支援 **Claude Code** 與 **Codex**。核心設計理念：**防止 AI 幻覺、系統性除錯、證據驅動開發、流程編排強制設計先行**。

---

## 包含什麼

| 組件 | 數量 | 說明 |
|------|------|------|
| **Skills** | 20 全域 + 10 Unity | 除錯、安全、架構、測試、效能、API、資料庫、CI/CD、規劃、Subagent 等 |
| **Commands** | 7 | `/plan`、`/verify`、`/checkpoint`、`/code-review`、`/discuss`、`/map-codebase`、`/verify-config` |
| **Rules** | 3 | coding-style、security、git-workflow（每次對話自動載入） |
| **Contexts** | 4 | dev、review、research、debug |
| **Hooks** | Router + 6 phases | Skill 建議、careful/freeze 模式阻擋、context 監控、async format/typecheck、桌面通知 |
| **Codex** | global AGENTS + config + rules + 15 portable skills | 全域模板安裝到 `~/.codex/` 與 `~/.agents/skills` |

---

## 快速開始

```bash
# 1. Clone
git clone https://github.com/leo110047/goldband.git
cd goldband

# 2. 安裝 Claude Code（預設 copy 模式，路徑移動不影響）
./install.sh            # pack-core（最小 token，推薦）
./install.sh pack-quality   # core + commands/contexts
./install.sh all-full       # 全量

# 3. 安裝 Codex（可選）
./install.sh codex-full

# 4. 安裝內建 gstack workflow pack（可選）
./install.sh gstack
./install.sh gstack-codex
./install.sh all-with-gstack

# 5. 重啟 Claude Code / Codex，完成
```

**升級**：重新執行相同指令即可覆蓋更新。

> **Note**: hooks 安裝需要 `jq`。macOS: `brew install jq`
>
> **--dev 模式**：`./install.sh --dev` 改用 symlink 指向 repo，適合正在修改 goldband 本身時使用。

### Skills Profile

```
core  →  evidence-based-coding、systematic-debugging、file-search、
         planning-workflow、security-checklist、performance-optimization

dev   →  core + api-design、backend-patterns、careful-mode、freeze-mode、
         claude-config-verification、code-review-skill、database-patterns、testing-strategy

full  →  dev + ci-cd-integration、commit-conventions、decision-log、
         new-skill-scaffold、skill-developer、subagent-development
```

```bash
./install.sh skills-core   # 最低 token
./install.sh skills-dev    # 開發推薦
./install.sh skills-full   # 全量
./install.sh status        # 檢查安裝狀態
./install.sh uninstall     # 移除
```

---

## 快速參考卡

### 全域 Skills（20 個）

| Skill | 觸發情境 | 優先級 |
|-------|---------|--------|
| `systematic-debugging` | bug、error、test fail、壞了 | CRITICAL |
| `evidence-based-coding` | 全域強制，所有主張必須有證據 + Iron Law 完成驗證 | CRITICAL |
| `security-checklist` | 安全檢查、OWASP、漏洞掃描 | HIGH |
| `performance-optimization` | 慢、優化、瓶頸、延遲 | HIGH |
| `careful-mode` | force-push、destroy、delete、prod CLI 前 | MEDIUM |
| `freeze-mode` | prod/敏感系統調查，鎖成唯讀 session | MEDIUM |
| `code-review-skill` | review PR、看 code、審查 | MEDIUM |
| `backend-patterns` | 設計 API、架構、實作 | MEDIUM |
| `testing-strategy` | 寫測試、提高覆蓋率、TDD | MEDIUM |
| `database-patterns` | Schema 設計、查詢優化、Migration | MEDIUM |
| `api-design` | REST 設計、Error format、Pagination | MEDIUM |
| `ci-cd-integration` | GitHub Actions、部署策略、Pipeline | MEDIUM |
| `planning-workflow` | `/plan` 時觸發，結構化任務拆解 | MEDIUM |
| `subagent-development` | Subagent 調度、兩階段 review | MEDIUM |
| `claude-config-verification` | 驗證 goldband + Claude/Codex 配置 | MEDIUM |
| `commit-conventions` | Git commit 格式 | LOW |
| `decision-log` | 架構決策記錄 | LOW |
| `file-search` | 找檔案、找程式碼 | LOW |
| `new-skill-scaffold` | 產生新 skill scaffold | LOW |
| `skill-developer` | 建立/管理 skills | LOW |

### Commands（7 個）

| 命令 | 用途 | 參數 |
|------|------|------|
| `/discuss` | 辨識灰色地帶、結構化決策 | 目標描述 |
| `/plan` | 功能規劃，Hard Gate 強制確認才動工 | 需求描述 |
| `/verify` | build + types + lint + tests 完整檢查 | `quick`、`pre-commit`、`pre-pr`、`--goal "目標"` |
| `/checkpoint` | 建立/比對工作回復點，跨 session 續接 | `create`、`verify`、`pause`、`resume` |
| `/code-review` | 兩階段安全+品質審查 | `--spec`、`--spec <file>` |
| `/map-codebase` | 產出 codebase 結構分析文件 | `tech`、`arch`、`quality`、`conventions`、`testing` |
| `/verify-config` | Claude + Codex 配置健康檢查 | `quick` |

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

---

## Hooks

單一入口 `hook-router.js` 分派所有 lifecycle：

| Phase | 行為 |
|-------|------|
| `UserPromptSubmit` | 根據 prompt 建議相關 skill |
| `PreToolUse` | careful/freeze 模式阻擋高風險操作；secrets/dev-server 阻擋 |
| `PostToolUse` | context 監控；async format/typecheck（有 tsconfig.json 才跑）|
| `Stop` | console.log 稽核 + 桌面通知 |
| `SubagentStop` | subagent 輸出證據檢查 |

**Careful Mode**（高風險操作前）/ **Freeze Mode**（prod 唯讀調查）可透過對話觸發，或用 `/careful-mode`、`/freeze-mode` 強制啟用。

---

## Codex

安裝到 `~/.codex/`（config、AGENTS.md、rules）與 `~/.agents/skills`（15 個 portable skills）：

```bash
./install.sh codex-core   # 核心設定 + core skills
./install.sh codex-full   # 完整設定 + 15 個 portable skills
./install.sh all-tools    # Claude Code + Codex 一次全裝
./install.sh gstack
./install.sh gstack-codex
./install.sh all-with-gstack
```

Claude runtime 綁定的 skills（`careful-mode`、`freeze-mode` 等）不安裝到 Codex 端。

### 與 gstack 整合

goldband 現在內建 vendor 版 gstack 於 `vendor/gstack/`，預設安裝時不再依賴外部 `/Users/.../gstack` repo。
若你要測試自己的 gstack fork，可用 `GSTACK_REPO_DIR=/path/to/gstack` 覆寫來源。

goldband 管全域 guardrails / host adapter，gstack 管高階 workflow skills。

- goldband `careful-mode`: 全域硬阻擋 destructive Bash
- goldband `freeze-mode`: inspection-only / read-only session
- gstack `/careful`: workflow-local warning layer
- gstack `/freeze`: 限制 Edit/Write 到指定目錄
- gstack `/guard`: `/careful` + `/freeze`

建議：
- prod、shared env、唯讀調查 → 用 goldband 模式
- scoped edit、review / QA / ship workflow → 用 gstack skills

---

## Unity 專案 Skills

```bash
cd /path/to/your-unity-project
/path/to/goldband/install.sh unity
```

| Skill | 用途 |
|-------|------|
| `unity-best-practices` | MonoBehaviour、ScriptableObject、組件架構 |
| `unity-multiplatform` | iOS/Android/WebGL |
| `unity-performance` | Profiler、GC 優化、渲染優化 |
| `unity-architecture` | MVC/ECS/Service Locator |
| `unity-app-store-deployment` | Google Play + App Store 雙平台上架 |
| `unity-job-system` | Job System、Burst、NativeContainer |
| `unity-networking` | NGO、NetworkVariable、RPC |
| `unity-object-pooling` | ObjectPool、零分配策略 |
| `unity-profiling` | ProfilerMarker、FrameTiming、GC/Hitch 分析 |
| `unity-testing` | Unity Test Framework、EditMode/PlayMode、CI |

---

## 疑難排解

| 問題 | 解決方法 |
|------|---------|
| Skill 沒有觸發 | 用 `/skill-name` 強制觸發，或在描述加入觸發關鍵字 |
| Hook 沒有執行 | `./install.sh hooks`，確認 `jq` 已安裝（`brew install jq`） |
| Skill 內容不完整 | `./install.sh status` 檢查，必要時重跑 `./install.sh pack-core` |
| `/verify-config` 報告 ERROR | 重跑 `./install.sh all-full` 或 `./install.sh all-tools` |
| TypeScript 檢查沒跑 | Hook 只在有 `tsconfig.json` 的專案執行 |
| Prettier 格式化失敗 | Hook 靜默失敗，無影響；需要則 `npm i -D prettier` |

---

## 自訂與擴展

- **新增 Skill**：`mkdir skills/global/your-skill`，建立 `SKILL.md`（參考 `skill-developer` skill）
- **修改 Hook**：編輯 `hooks/hooks.json`，執行 `./install.sh hooks` 自動合併
- **新增專案類型**：`mkdir -p skills/projects/your-type`

---

## License

MIT License — 自由使用、修改和分發。
