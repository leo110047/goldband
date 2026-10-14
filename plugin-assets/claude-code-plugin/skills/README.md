# Global Skills

`skills/global/` 是 Claude Code 與 Codex 共用的可攜式 skill。每個 skill 的 `SKILL.md`
是其唯一 source of truth；安裝由 root `install.sh` 的 `skills-core`、`skills-dev`、
`skills-full` profile 負責，本目錄不是獨立發佈包。

## Inventory

### 核心方法論

| Skill | 作用 |
|------|------|
| `evidence-based-coding` | claim 以權威程式碼、設定、輸出或 log 為證據 |
| `implementation-contracts` | contract 變更明確失敗，不猜資料、不做未授權副作用或假泛化 |
| `systematic-debugging` | 除錯共用規則；完整調查由 Goldband investigate workflow 負責 |
| `file-search` | 以 `rg` 定位檔案與內容 |
| `planning-workflow` | 規劃共用規則；完整規劃由 `/goldband-plan` 負責 |

### 工程決策

| Skill | 作用 |
|------|------|
| `testing-strategy` | 測試層級選擇、品質標準與 flaky test |
| `performance-optimization` | 工作量與資源陷阱、效能改善證據 |
| `security-checklist` | 防守性安全檢查；深度審查由 `$goldband review code` 指定安全範圍負責 |
| `frontend-design` | UI 設計來源與設計契約 |
| `prompt-hygiene` | prompt 只保留目標、可見背景、硬邊界與成果標準 |

### 交付與維運

| Skill | 作用 |
|------|------|
| `ci-cd-integration` | CI/CD pipeline、權限、secret 與 deploy 契約 |
| `decision-log` | 具長期影響的決策記錄 |

### 模式與工具

| Skill | 作用 |
|------|------|
| `careful-mode` | 封鎖高風險 Bash 操作 |
| `freeze-mode` | 唯讀調查模式 |
| `claude-config-verification` | Claude 與 Codex 設定、hook、plugin 驗證 |
| `skill-developer` | skill trigger、結構與 references 維護；scaffold 由 host 原生 `skill-creator` 負責 |
| `subagent-development` | subagent 委派與結果審查 |

## 相關文件

- [`OPERATIONS.md`](OPERATIONS.md)：mode 手動操作、telemetry、故障排除
- [`VALIDATION.md`](VALIDATION.md)：結構驗證與異常判準

Host 依各 `SKILL.md` 的 `description` 選擇 skill；`skill-rules.json` 只是記錄各 skill owner 的參考索引。
