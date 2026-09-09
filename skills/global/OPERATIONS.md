# Global Skills Operations

這份文件專注於「怎麼使用」與「怎麼手動操作 mode / telemetry」。

## 常見使用方式

### bug / test failure

- 先用 `systematic-debugging`
- 再視需要補 `testing-strategy`
- 若任務只要求 review，查證並回報問題；不要自行切換成修復

### 架構 / 方向 / 設計決策

- 用 `planning-workflow`，需要完整規劃時走 `/plan`
- recommendation 應附：assumptions、failure modes、warning signals、best alternative、unknowns

### 安全 / 效能 / 測試策略

- 安全：`security-checklist`
- 效能：`performance-optimization`
- 測試設計：`testing-strategy`

### Prompt / agent instruction authoring

- 寫 prompt、system prompt、cron prompt、Discord/report prompt、design-tool prompt 或交給另一個 AI agent 的 handoff prompt 時，用 `prompt-hygiene`
- 這是產出前的 authoring skill；重點是先用正確工作模式寫出 prompt
- prompt 應優先寫正向目標、可見背景、硬邊界與成果標準；不要補沒有根據的 negative rules 或固定 SOP

## On-Demand Modes（僅 Claude Code hooks 安裝）

### `careful-mode`

用途：
- 高風險 shell window
- force-push / hard reset / destroy / delete 類操作前

平常：
- 直接用 skill / mode flow，不必手動跑 script

若要從 repo root 手動檢查：

```bash
node skills/global/careful-mode/scripts/careful-mode.js status
node skills/global/careful-mode/scripts/careful-mode.js enable
node skills/global/careful-mode/scripts/careful-mode.js disable
```

### `freeze-mode`

用途：
- read-only investigation
- incident triage / audit / evidence collection

若要從 repo root 手動檢查：

```bash
node skills/global/freeze-mode/scripts/freeze-mode.js status
node skills/global/freeze-mode/scripts/freeze-mode.js enable
node skills/global/freeze-mode/scripts/freeze-mode.js disable
```

## Telemetry

目前會記錄的主要類型：

- prompt-trigger match 與 suggestion emission
- code-backed skill script execution
- on-demand mode enable / disable
- mode enforcement block 事件

彙總查看：

```bash
node hooks/scripts/tools/report-usage-summary.js --days 30
```

限制：

- 現有資料偏向 prompt-trigger telemetry，不是完整 skill adoption truth
- 純 markdown skill 是否真的被採用，無法只靠目前 hook data 完整判定

## 故障排除

### skill 沒有觸發

- 先檢查 prompt 是否真的命中對應 trigger
- 再看 `skill-rules.json` 和 hook logic 是否有 conflict resolution
- 必要時直接手動指定 skill

### mode 狀態不確定

- 不要靠記憶
- 先跑 `status`
- 再決定要不要 enable / disable
