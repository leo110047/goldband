# Global Skills

goldband 的 `skills/global/` 是可攜式 skill 集合，提供 Claude Code 與 Codex 共用的方法論與專題工作流。

## 這份文件的用途

這份 README 只做三件事：

- 說明這批 global skills 在 repo 裡扮演什麼角色
- 提供 skill inventory 與選用入口
- 導到較細的操作、驗證與學習文件

它不是完整操作手冊，也不是測試腳本說明。

## 安裝與來源

在 goldband repo 內，global skills 通常透過 repo-linked 安裝進使用者目錄，而不是手動 `cp -r`：

```bash
./install.sh skills-core
./install.sh skills-dev
./install.sh skills-full
./install.sh status
```

如果你是在維護這個 repo，請以 root README 與 `install.sh` 為準，不要把這個資料夾當成獨立發佈包。

## 技能分組

### 核心方法論

| Skill | 作用 |
|------|------|
| `evidence-based-coding` | 所有 claim 都要有文件、命令、測試或 log 證據 |
| `systematic-debugging` | bug / test failure 的標準除錯流程 |
| `file-search` | 用 `rg` 建圖與查定位 |
| `planning-workflow` | 多步實作前的可驗證規劃流程 |

### 常用工程決策

| Skill | 作用 |
|------|------|
| `backend-patterns` | service boundary、architecture、backend shape |
| `api-design` | endpoint contract、pagination、versioning、error format |
| `database-patterns` | schema、migration、index、query 結構 |
| `testing-strategy` | coverage、TDD、integration / E2E test strategy |
| `performance-optimization` | profiling、bottleneck、latency / throughput |
| `security-checklist` | auth、input validation、secret handling、OWASP 風險 |
| `frontend-design` | 高品質前端畫面設計與避免 generic AI aesthetics |

### 交付與維運

| Skill | 作用 |
|------|------|
| `code-review-skill` | PR / diff review |
| `ci-cd-integration` | GitHub Actions、CI/CD、cache、deploy gate |
| `commit-conventions` | commit message / changelog 規範 |
| `decision-log` | ADR / 決策記錄 |

### 模式與工具

| Skill | 作用 |
|------|------|
| `careful-mode` | 高風險 Bash 操作防呆 |
| `freeze-mode` | 唯讀調查模式 |
| `claude-config-verification` | Claude config / hook / plugin 驗證 |
| `new-skill-scaffold` | 建立新 skill scaffold |
| `skill-developer` | 維護 skill trigger / structure / references |
| `subagent-development` | 可切給 subagent 的實作 / 審查流程 |

## 什麼時候看哪份文件

- 日常使用與 mode 操作：[`OPERATIONS.md`](OPERATIONS.md)
- 測試、驗證與 conflict 檢查：[`VALIDATION.md`](VALIDATION.md)
- 新人導覽與學習順序：[`LEARNING_PATH.md`](LEARNING_PATH.md)

## 關於 `careful-mode` / `freeze-mode`

這兩個 mode 平常應透過 skill / hook flow 使用，不需要手動找腳本。

如果你真的要從 repo root 直接操作 state，請用完整路徑：

```bash
node skills/global/careful-mode/scripts/careful-mode.js status
node skills/global/freeze-mode/scripts/freeze-mode.js status
```

不要把 `node scripts/careful-mode.js ...` 或 `node scripts/freeze-mode.js ...` 當成 repo root 指令。

## 維護原則

- `SKILL.md` 才是每個 skill 的 source of truth
- 這份 README 只維持高層導覽，不複製長篇操作細節
- 衝突規則與 trigger 行為以 `skill-rules.json`、hook logic、實際測試為準
