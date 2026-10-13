# TODO

## P0 - 補完 QA convergence loop real-mode 驗證

目前狀態：`review/code` 已改為強制 single-pass，避免完整 diff 被多輪重送；
convergence loop 只保留給 `qa/app`。剩餘 P0 是把 QA mock coverage 推進到真實
browser evidence，不可用 fixture 冒充 real-mode E2E。

### 已完成

- [x] runtime 自主驅動多輪，不需要 caller 手動提供 iteration 或 blocker 狀態。
- [x] `target-met`、`iteration-cap`、`same-blocker-repeated`、
  `no-improvement` stop predicates 與 regression tests。
- [x] `qa/app` typed mock adapter 只重跑 failed checks，並驗證 check schema。
- [x] `review/code` launcher 與 typed workflow 都拒絕 `--loop`。
- [x] QA 的 `--max-iterations` 不可超過 registry cap。
- [x] 每輪 JSONL evidence 包含 `iteration` 與 `signalSnapshot`。
- [x] `goldband-loop/workflows/README.md` 已描述目前實際 loop 行為。

### 待辦

- [ ] 執行 `qa/app` real browser E2E。`browse` 與 `browser/session` 已於
  2026-10-13 退役，真實 QA 改由 host 的瀏覽器工具（Playwright MCP 或
  Claude in Chrome）執行；typed adapter 維持 mock，不可把 mock check 當成
  runtime 支援。2026-10-12 以 `goldband-loop/test/fixtures/qa-eval*.html`
  的 15 個預埋 bug 評估：Playwright MCP 15/15，Claude in Chrome 尚未測。
- [ ] 對 live runs 驗證 iteration context、stop reason 與 artifact readback，並把
  結果同步到 architecture / coverage 文件。

### 驗收標準

- [x] runtime 能在無 caller 介入下自主多輪執行並停在正確 stop condition。
- [x] `qa/app` mock 多輪整合測試有逐輪 evidence。
- [ ] real-mode 驗證結果有可重跑的 pass、blocked 或 unsupported evidence。
- [ ] live evidence、registry 狀態、runtime 行為與文件一致。

## P1 - Experimental high-risk owners and compatibility migration

公開 surface 已從 51 個 actions 收斂成 19 個；另有 4 個 high-risk actions
只留在 experimental inventory。公開 actions 現為 15 個 typed、4 個
compatibility、0 個 registered-only。

### 背景

`goldband-loop/workflows/COVERAGE.md` 是 runtime 覆蓋清單，不是一般 TODO 檔。
每個 runnable action 現在必須在 manifest 宣告 runtime owner；experimental
action 不得宣告 owner，也不會出現在 router 或 activation hints。

### 已完成

- [x] 刪除 28 個重疊 action，不保留 alias；功能折回 review、plan、browser、
  document、iOS 等 owner 的 mode 或階段。
- [x] `browser/session`、`design/consult`、三個 safety actions、兩個 context
  actions、`knowledge/recall`、`benchmark/workflow`、兩個 system actions 與
  `ios/qa` 接上 typed owner steps、JSONL evidence 與 fail-closed input validation。
- [x] `context/retro` 接上 compatibility runtime；`document/generate` 已升級為
  typed audit owner，產生 coverage / PR-section artifacts，PR 更新停在原生核准邊界。
- [x] `release/land`、`release/setup` 隱藏為 experimental，明確不可執行；
  `knowledge/setup`、`knowledge/sync` 已退休，不保留 action。
- [x] `system/upgrade` 只做 preflight/readback；`git pull` 與 setup 必須經過
  host 原生核准與工具執行，不藏在 workflow 子程序中。
- [x] 收斂前仍保留的 7 個 high-risk operation 已有 manifest-owned safety gate：
  5 個未有 owner 的 operation 維持 `blocked-before-runtime`；`system/upgrade`
  與唯讀 `ios/qa` 只有在 operation-specific verifier 驗證 owner output 與 trusted
  readback artifact 後才寫入 `verified`；mock 或尚待原生核准只會是 `pending`。
  已刪除的
  `release/canary`、`browser/cookies`、`ios/sync` 只作內部 operation inventory，
  不恢復為公開 alias。

### 優先順序

1. 把 `qa/app` real mode 接到 typed browser evidence，完成 browser E2E。
2. 將 3 個 compatibility actions 逐一替換成 action-specific typed schemas。
3. 依既有 safety gate contract 為 release setup/land 建立原生 approval、
   deployment readback 與 rollback owner。

### 驗收標準

- [x] `goldband-loop/workflows/registry.ts` 的 `integrationStatus`、lifecycle、owner
  與 runtime 實作一致。
- [x] 新接上的 workflow 能透過正式 CLI 產生 JSONL evidence。
- [x] 若還不能 real mode 執行，會 fail closed，不可假裝已支援。
- [x] 每個 high-risk action 都有 primary gate；nested high-risk mode 也有獨立
  operation gate，缺 gate、owner mismatch、declared contract 與 verifier drift，或
  提早接 runtime 都會驗證失敗。
- [x] `goldband-loop/workflows/COVERAGE.md` 由 manifest-generated capability report
  投影，不維護第二份狀態。

## P1 - 補完 agent observability 消費端與 session trace

目前狀態：goldband 已有 local-first telemetry producer，也有 opt-in OTLP
exporter，但 observability 還是半套。Hook 會把事件寫成 JSONL，
`scripts/export-telemetry-otlp.mjs` 能把 JSONL 轉成 OTLP trace 送到
collector；`report-usage-summary.js`、`goldband_telemetry_query`、以及
`scripts/mine-telemetry.mjs` 能讀本機 JSONL 做統計或離線 mining。這代表
「發送端、schema、基本查詢」是有的。

缺口是：repo 沒有內建、常駐、可日常使用的消費端 UI 或 dashboard；Jaeger
只是一個手動外接 demo，不是 goldband 產品的一部分。更大的缺口是目前資料是
hook event 級別，例如 workflow entry、hook advisory、hook deny，而不是完整
agent session trace。它不能事後完整回放一輪對話中 agent 讀了哪些檔、呼叫了
哪些工具、tool input/output 是什麼、模型如何從多個事件走到最後結論。換句話說，
現在是「關卡打點」，不是 LangSmith / Braintrust 那類完整 session replay。

### 已確認的現有能力

- JSONL producer：Claude/Codex hooks 會寫 `schema_version`、`run_id`、
  `event_id`、`category`、`name`、`action`、`source`、`host`、`detail`、
  `recordedAt` 等欄位。
- OTLP exporter：`scripts/export-telemetry-otlp.mjs` 會把一個 `run_id`
  映射成一條 trace，把每個 JSONL event 映射成一個 span；export 是手動執行，
  不是 hook、daemon、或 installer default。
- 輕量 consumer：`hooks/scripts/tools/report-usage-summary.js`、
  MCP 的 `goldband_telemetry_query`、以及 `scripts/mine-telemetry.mjs`
  能做 aggregate query、failure taxonomy、replay fixture candidate、
  eval candidate、knowledge candidate。
- 外接 UI demo：`docs/observability.md` 記錄了用 Jaeger all-in-one
  收 OTLP 並查看 trace 的流程。
- 目前驗證：2026-07-06 跑過 `npm run test:telemetry`，schema、hook
  telemetry、OTLP exporter、telemetry miner 測試通過。

### 待辦

- [ ] 先寫清楚產品邊界：
  `docs/observability.md` / `ARCHITECTURE.md` 要明確區分
  `hook telemetry`、`OTLP export`、`offline mining`、`dashboard/UI`、
  `full session replay`，不可把 trace exporter 包裝成完整 agent
  observability。

- [ ] 補一個內建 consumption surface 的設計：
  最小版可以是 CLI/TUI/static HTML report，不一定一開始就做 web app；
  但要能從本機 JSONL 依 `run_id` 展開一個 session 的事件時間線、deny/advisory、
  workflow entry、cross-review events、以及相關 metadata。

- [ ] 定義 session trace schema v2：
  在現有 `goldband.telemetry.v1` 旁邊補一個明確的 session-level event
  contract，至少包含 `turn_id`、`tool_call_id`、`tool_name`、
  sanitized `tool_input` summary、sanitized `tool_output` summary、
  file/path references、exit status、duration、error shape、parent/child
  linkage、redaction status。

- [ ] 補 transcript / tool trace ingestion 邊界：
  Claude 若提供 `transcript_path`，只讀取必要 metadata 或 sanitized excerpts；
  Codex 若沒有穩定 transcript hook input，要明確記為 unsupported/unknown，
  不能假裝能完整回放。必要時支援 explicit import，例如從 host session
  JSONL 或 user-provided transcript 檔匯入。

- [ ] 補 redaction policy：
  session trace 會碰到 prompt、tool input/output、file paths、env、error logs；
  必須預設 local-only、fail closed、可 dry-run，並重用既有
  `secret-patterns.js` / sanitizer。未標記 `redaction_status: clean` 的內容
  不可 export 到 OTLP 或寫入 fixture/eval candidate。

- [ ] 補 OTLP mapping 升級：
  現在每個 hook event 是一個 span；新設計要能表達 turn span、tool span、
  hook decision span、workflow span 的 parent-child 關係。若資料不足，只能輸出
  partial trace，並標記 `trace_completeness: partial`。

- [ ] 補本機 dashboard/report：
  至少支援依時間、`run_id`、rule、workflow、host 篩選；能回答
  「這輪為什麼被 deny / blocked」、「哪個 workflow 被 inferred vs confirmed」、
  「有沒有 missing workflow evidence」、「哪些 session trace 不完整」。

- [ ] 補測試與 fixtures：
  加 session trace parser/redactor tests、JSONL backward compatibility tests、
  OTLP parent-child mapping tests、dashboard/report snapshot tests、以及缺資料時的
  partial/unsupported 狀態測試。

- [ ] 補 operational docs：
  說明資料在哪裡、如何匯出、如何清除、如何啟動 local UI/report、如何確認沒有
  network upload、如何判斷資料只是 hook-level 而不是 full replay。

### 驗收標準

- [ ] 使用者能從一個 `run_id` 重建至少 hook/workflow/tool summary 時間線。
- [ ] UI/report 明確標示每個 session 的 completeness：`hook-only`、
  `partial-session-trace`、或 `full-session-trace`。
- [ ] OTLP export 對完整 trace 與 partial trace 有不同標記，不誤導 collector/UI。
- [ ] 所有 prompt/tool/output 相關資料都有 redaction status；未清理資料不會外送。
- [ ] 文件不再把 Jaeger demo 或 OTLP exporter 說成內建 observability dashboard。
- [ ] `npm run test:telemetry` 通過，並補上 session trace / report 相關新測試。

### Non-goals

- 不在 hook path 做 network I/O。
- 不預設上傳 telemetry 到第三方服務。
- 不把模型 reasoning 當成 goldband 一定可取得的資料；host 沒提供就標記 unavailable。
- 不把 inferred workflow signal 當成 confirmed workflow completion。
