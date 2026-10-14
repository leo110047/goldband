# Global Skills Operations

## 選用

- bug 或 test failure：`systematic-debugging`；review-only 任務只查證並回報，不修復。
- 架構、方向或設計決策：`planning-workflow`，完整規劃用 `/goldband-plan`。
  recommendation 應附：assumptions、failure modes、warning signals、best alternative、unknowns。
- 安全、效能、測試設計：`security-checklist`、`performance-optimization`、`testing-strategy`。
- prompt、system prompt、agent handoff 等交付前撰寫：`prompt-hygiene`。

## On-Demand Modes

僅 Claude Code hooks 安裝提供。從 repo root 操作時使用完整路徑：

```bash
node skills/global/careful-mode/scripts/careful-mode.js status
node skills/global/careful-mode/scripts/careful-mode.js enable
node skills/global/careful-mode/scripts/careful-mode.js disable
node skills/global/freeze-mode/scripts/freeze-mode.js status
node skills/global/freeze-mode/scripts/freeze-mode.js enable
node skills/global/freeze-mode/scripts/freeze-mode.js disable
```

mode 狀態以 `status` 輸出為準。

## Telemetry

記錄 code-backed skill script 執行、mode 啟用與停用、mode enforcement block。
彙總：

```bash
node hooks/scripts/tools/report-usage-summary.js --days 30
```

純 markdown skill 的實際採用無法由 hook 資料判定。舊資料中的 prompt-trigger
推薦事件來自已退役機制，不代表採用。

## 故障排除

Skill 由 host 依 `SKILL.md` 的 `description` 選擇。未觸發時，確認 description
寫明適用與不適用情境，或直接指定 skill。
