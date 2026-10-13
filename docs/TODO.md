# TODO

待辦項目只記錄尚未完成的工作：要做什麼、為什麼、依賴與完成條件。完成或退役的項目直接刪除，由 Git 保留紀錄。

## P0

### `qa/app` real-mode 驗證

- **內容：** 以 host 瀏覽器工具（Playwright MCP 或 Claude in Chrome）執行 `qa/app` 真實 E2E，驗證 iteration context、stop reason 與 artifact readback。
- **理由：** typed adapter 只有 mock；mock check 不能代表 runtime 支援。
- **完成條件：** real mode 產生可重跑的 pass、blocked 或 unsupported evidence；registry 狀態、runtime 行為與文件一致。

## P1

### Compatibility actions 改為 typed

- **內容：** 將其餘 compatibility actions 逐一換成 action-specific typed schema 與 owner。
- **理由：** compatibility dispatch 沒有 runtime 驗證輸入與輸出。
- **完成條件：** 每個 action 在 registry 標示 typed、有 owner 與 JSONL evidence；尚不能執行的部分 fail closed。

### Release 的原生核准與 readback

- **內容：** 依既有 safety gate 契約，為 `release/setup`、`release/land` 建立原生 approval、deployment readback 與 rollback owner。
- **理由：** 這兩個 action 目前隱藏為 experimental，且在 runtime 前即被阻擋。
- **依賴：** release owner 實作。

### Agent observability 消費端與 session trace

- **範圍界定：** 文件需區分 hook telemetry、OTLP export、離線 mining、本機 report 與完整 session replay；OTLP exporter 不是內建 observability 介面。
- **內容：**
  - 本機 report：依 `run_id` 展開 hook、workflow、deny／advisory 時間線，可依時間、rule、workflow、host 篩選。
  - Session trace schema：在 `goldband.telemetry.v1` 之外定義 session 層級事件，包含 turn、tool call、經清理的 input／output 摘要、路徑、結束狀態、時間、錯誤、父子關聯與 redaction 狀態。
  - Transcript 匯入：只讀取 host 提供的 metadata 或清理後的摘錄；host 未提供時標記為 unsupported。
  - Redaction：預設只存本機並 fail closed；未標記 `redaction_status: clean` 的內容不得匯出。
  - OTLP 對應：以 turn、tool、hook、workflow span 表達父子關係；資料不足時標記 partial。
- **完成條件：** 可由單一 `run_id` 重建時間線；每個 session 標示 `hook-only`、`partial-session-trace` 或 `full-session-trace`；`npm run test:telemetry` 涵蓋 parser、redactor、相容性與 partial 狀態。
- **限制：** hook path 不做 network I/O；不預設上傳；host 未提供的模型推理標記為 unavailable；inferred workflow signal 不視為完成。

### 專案健康度

- **內容：** 執行 type-check、lint、測試與 dead code 掃描，回報分項結果並保存歷史；可選擇在 `release/land` 前比較健康度並警告下降。
- **理由：** 開工前缺少整體程式品質的快速判讀。
- **依賴：** 以 capability action 形式加入 manifest，並有 runtime owner。

## P2

### 全 codebase 審查未覆蓋範圍

任務定義見 `docs/plans/codebase-behavior-and-deep-modules.md`。下列區域尚未逐檔閱讀 source 與測試：

- `goldband-loop/scripts/` 的開發與評估工具：`question-registry.ts`、`task-emission-schema.ts`、`output-throughput-comparison.ts`、`eval-*`、`psychographic-signals.ts`、`archetypes.ts` 等。
- `goldband-loop/bin/` 中除 `goldband.ts`、`goldband-knowledge.ts`、`goldband-analytics`、`goldband-telemetry-log` 之外的工具：`goldband-global-discover.ts`、`goldband-developer-profile`、`goldband-brain-sync`、`goldband-next-version` 等。
- `goldband-loop/design/src` 中 daemon 以外的模組：`compare.ts`、`variants.ts`、`cli.ts`、`daemon-client.ts` 等。
- `goldband-loop/test/helpers/`（`eval-store.ts`、`session-runner.ts`），以及 root `scripts/check-*.mjs`、`scripts/test-*.mjs` 的內部結構。
- `app-adapters/`、`sandbox/`、`codex/local/`、`codex/profiles/`。

### Learnings 改用 SQLite

- **內容：** 將 `~/.goldband/projects/<slug>/learnings.jsonl` 改為 `bun:sqlite`，並提供一次性遷移。
- **理由：** JSONL 作為多寫入者的狀態，會有覆寫遺失與部分寫入的問題；SQLite 提供交易、索引與當機安全。
- **影響範圍：** `goldband-learnings-log` 等讀寫端與 artifact 同步。

### GitLab release 支援

- **內容：** 為 `release/land` 加入 `glab` adapter，涵蓋 MR 合併與 CI 輪詢。
- **依賴：** release owner 實作。

### QA 歷史比較與 CI 閘門

- **內容：** 比較歷次 QA baseline 以偵測退步；可在 CI 中於健康分數低於門檻時讓 PR 失敗。
- **依賴：** `qa/app` real-mode 驗證；CI 需提供 headless browser 與模型憑證。

## P3

### QA 便利功能

- 依使用者過去的選擇預設 QA 層級。
- 提供聚焦於無障礙的檢查模式。

### Design daemon 維護

- `design/src/cli.ts`、`design/src/serve.ts` 重複的 `openBrowser` 抽成共用模組。
- `design/src/daemon-client.ts` 未命名的逾時與輪詢數值改為具名常數。
- 待出現對應使用情境後再評估：每個 daemon 的獨立授權 token、board 歷史持久化、Windows 支援、單一 board 的 list／stop 指令、跨 worktree 共用 daemon。

### 測試與評估工具

- `runSkillTest()` 提供 worktree 模式，讓 E2E 測試可使用完整 repo 內容。
- 本機 eval dashboard：呈現成本、偵測率與通過率趨勢。

### 重構前清理

- **內容：** 依專案語言執行 dead code 偵測，移除未使用的 import、export 與程式，並以獨立 commit 提交。
- **理由：** 降低重構時的 context 消耗。

## 限制

- 個人化功能若要加入，必須是明確、可檢視的 runtime 或使用者設定，不得注入每個 workflow prompt。
