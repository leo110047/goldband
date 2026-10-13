# Goldband 行為測試與 Deep module：一次性唯讀審查任務

**狀態：** 第一輪審查已執行（部分覆蓋）；A1–A8 與兩項範圍外議題已實作並通過本機檢查。參考基準為 `1f3de4c9df3a8d9e0acd5b39d94af25c3c636769`，2026-10-13；審查時 source 為 `f97c8299af94272781d5aa60afda833ef557d806`。結果與未覆蓋範圍見[審查結果](#審查結果)。

使用者明確指派時，由既有唯讀 Reviewer 在 Host 內執行一次全 codebase 審查，回報有收益的責任整合候選與綁住內部寫法的測試。這是任務說明，不是新功能；日常審查以本次改動及相關模組為範圍，依[主計畫](review-quality-and-engineering-feedback.md)的判準執行。

## 目標與範圍

開始時確認 Goldband 工作樹、適用 AGENTS.md 與第一方檔案 inventory，以本次 Git 候選固定範圍：workflow／Host／CLI、Hook／skill scripts、安裝／分發／生成、MCP、PDF／文件工具、design、iOS QA，以及 inventory 的其他第一方區域。包含相關測試，排除 vendor、生成與分發副本。

優先查看同一事實有多個 owner、caller 必須協調多個內部步驟，以及測試依賴私有步驟的區域。Deep module 用小介面包住完整責任，內部可有多個檔案；收益是 caller 與測試需要理解的細節變少。

Reviewer 使用既有原生唯讀權限，回傳報告，不修改 repo 或執行候選程式。沿用可取得的 inventory／依賴線索，閱讀實際 source 與測試；不新增 capability、分析服務、CLI flag 或每次 Review 的額外模型呼叫。現有 `review/code` 由 diff 驅動，空 diff 不發起模型審查，不能用空 diff 表示全面盤點已完成。

## 判斷標準

- 測試是否保護公開輸出、狀態、錯誤與必要外部效果？預期值是否來自需求、獨立 fixture 或計算？
- 換掉內部分工、helper 名稱或資料排列，而公開契約不變時，測試是否仍應通過？Mock 是否替換掉被測路徑？
- Caller 是否必須理解過多內部細節？同一責任是否分散？小介面能否包住完整責任，並保持安全與錯誤語意？
- 保留有契約依據的純函式、CLI／Host 協定、安裝產物、race／故障注入；文字比對、呼叫次數或檔案長度本身不構成問題。

選定候選後，實作者才決定修改與驗證。可機械驗證的邊界用既有 export／private、lint、tests 保護；未證明整合收益時維持現況。

## 已知檢查起點

Review 範圍接線、Finding 處理與 checker advisory 由主計畫負責。此處以當時程式為準，不重複建立實作流程。

穩定檔案讀取是候選：`goldband-loop/workflows/review.ts`、`review-impact.ts` 重複 descriptor 讀取、大小界限與變動檢查。先對照 `goldband-loop/test/workflows-runtime.test.ts`、`review-impact.test.ts`，確認 deadline、expected stat、symlink／race、大小限制，以及 cache 可降級／diff 必須失敗的差異，再判斷整合是否值得。

`WorkMapStore`、style checker CLI 已把持久化／恢復或檢查細節藏在操作介面後面，除非發現具體外漏責任，維持現況。

## 報告與結束條件

每個區域回報「採納」或「維持現況」，附 source／test 路徑與理由；沒有候選的區域也有維持現況的紀錄。採納表示建議另案實作，列出公開行為、外漏責任、實際 caller、現有測試、最小整合方式與驗收。Reviewer 回傳結果，實作者可將結論整理到本文件。

所有區域完成評估，且沒有會改變取捨的待驗問題時，這次審查結束；不以重構全部完成為條件。來源不可讀、範圍不完整或缺必要證據時，回報受阻／未覆蓋範圍與待查項，不將未檢查區域填成維持現況。固定範圍之外的新議題另案處理。

後續實作的行為驗收：原缺陷或代表性契約違反使測試失敗；相同公開契約下改變內部分工，測試仍通過。替換舊測試前對照原有需求與負向情境，再完成採納模組的既有檢查。

方法參考：[Matt codebase-design](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/codebase-design/SKILL.md)。

## 審查結果

2026-10-13 於 `f97c829` 唯讀執行，沒有修改程式或執行候選。方法：讀取各區 source 與相關測試；以重複函式名稱、export 使用端與 mock／原始碼比對掃描找出起點，再閱讀實際程式碼確認。下列「採納」原為建議另案實作，後續已依使用者指示實作，結果見[實作結果](#實作結果)。

### 採納

**A1. 穩定檔案讀取由單一模組負責**

- 外漏責任：「開啟時不跟隨 symlink、比對 stat、有界分塊讀取、讀後再比對」有 5 份實作：`goldband-loop/workflows/review.ts` 的 `readBoundedRegularFile`／`readDescriptorWithinLimit`／`sameFileVersion`；`review-impact.ts` 的 `readBoundedRegularFile`（cache）與 `readStableSourceFile`；`lib/verification-receipt.ts` 的 untracked 讀取（`readDescriptor`／`sameFileVersion`）；`bin/goldband.ts` 的 `readStablePlanInput`。各份的穩定性條件已出現差異：前四份比對 `mtimeMs`／`ctimeMs`，plan input 另用 bigint ns 與二次讀取。`review.ts` 的 `beforeOpen`、`expectedStat`、`afterFirstRead` 參數沒有 caller 使用。
- 公開行為：diff file 超限或變動時明確失敗；impact cache 讀取失敗降級為診斷；impact source 與 untracked 檔案跳過並留下原因；plan input 明確失敗。這些錯誤處理語意由 caller 保留。
- 最小整合：在 `goldband-loop/lib` 增加一個讀取函式，輸入路徑、上限、選用的預期 stat、deadline 檢查和超限錯誤；回傳 Buffer 或拋出錯誤。stat 比對統一採用最嚴格的現行條件，Caller 只決定 catch 後失敗、跳過或降級。
- 現有測試：`test/workflows-runtime.test.ts` 的 symlink swap（約 1558 行）、diff 上限（約 1666、1689 行）；`test/review-impact.test.ts` 的 cache ignored（約 216 行）；`test/goldband-plan-cli.test.ts` 的 plan input symlink／變動案例；`test/verification-receipt.test.ts`。
- 驗收：新模組用故障注入覆蓋 symlink、讀取中變動、超限與 deadline；上述 caller 測試不修改仍通過；impact source 的讀取中變動目前沒有測試，需新增。

**A2. Hook telemetry 共用一份 host-neutral 實作**

- 外漏責任：`codex/hooks/telemetry.js` 逐函式重寫 `hooks/scripts/lib/hook-router/workflow-telemetry.js` 的 slash command 偵測、shell token 切分、`candidateSkillNames` 與 workflow-entry 事件組裝，以及 `usage-telemetry.js` 的輪替與保留期清理；`metrics.js` 有第三份輪替／清理，`pretool-policy.js` 有第三份 `candidateSkillNames`。資料根目錄（`CLAUDE_PLUGIN_DATA` → `GOLDBAND_DATA_DIR` → XDG → `~/.local/share/goldband`）由 `hooks/scripts/lib/utils.js`、`codex/hooks/telemetry.js`、`goldband-loop/cross-review/core.cjs`、`scripts/lib/telemetry-miner/io.mjs` 各自解析。
- 現有機制：Codex 的 shell／secret／review-launch-advisory／telemetry-schema 模組已由 `scripts/lib/plugin-distribution.mjs` 的 `addSharedAdapterArtifacts` 從單一來源生成，並由 `check-plugin-distribution` 檢查；telemetry 沒有使用這條既有路徑。
- 最小整合：`workflow-telemetry.js` 已接受 host／source 參數；把 session env 也改成參數，加入 `addSharedAdapterArtifacts` 生成到 `codex/hooks`。`codex/hooks/telemetry.js` 只保留 Codex 結果到 deny／advisory 名稱的對應。資料根目錄解析併入同一份生成模組。
- 驗收：`npm run test:hook-router`、`scripts/test-telemetry.mjs`、`scripts/test-hook-policy-parity.mjs`、`npm run test:plugin-distribution` 通過；同一 hook input 在兩個 Host 產生除 host／source 外相同的 workflow-entry 事件；依 root AGENTS.md 完成 temp HOME 安裝檢查。

**A3. Tracker adapter 的投影組裝移回 provider-neutral 模組**

- 外漏責任：`workflows/tracker-adapters/github.ts` 與 `gitlab.ts` 各有一份 `assembleRemote`、`bodyWithRemoteLinks`、`parseArray`、`boundedError`、`requiredString`，差異只有 provider 字面值和錯誤訊息中的名稱。Marker 解析與 digest 已在 `projection.ts`，共用基底是 `cli-adapter.ts` 的 `CliTrackerProjectionAdapter`。
- 最小整合：把 marker → `RemoteProjectionState` 組裝與相依連結替換移入 `projection.ts`，provider 名稱由參數提供；adapter 只保留 CLI 呼叫與 provider issue 解析。
- 驗收：`test/tracker-github.test.ts`、`tracker-gitlab.test.ts`、`tracker-projection.test.ts`、`tracker-runtime.test.ts` 通過；duplicate marker 目前只有 GitHub 有測試（`tracker-github.test.ts` 約 28 行），改由共用投影測試同時覆蓋兩個 provider。

**A4. Knowledge 查詢語意與 home 路徑各留一個 owner**

- 外漏責任：`mcp/server/src/knowledge-query.ts` 重寫 `goldband-loop/lib/knowledge.ts` 的 `searchKnowledge`，原始碼註解要求兩者同步，但語意已不同：MCP 的 `status: 'all'` 會回傳 retired，CLI 未加 `includeRetired` 時排除 retired；MCP 的關鍵字比對不含 `project_slug`／`canonical_remote`，也沒有 scope／project 過濾。Knowledge home 另由 `knowledge.ts` 自行解析（只看 `GOLDBAND_HOME`），沒有使用 `lib/state-root.ts` 的 `resolveGoldbandStateRoot`；MCP 端又有一份。
- 最小整合：把 index rows 的過濾與排序抽成不依賴 Bun 的純函式模組，CLI 與 MCP 共用；MCP 沿用 `telemetry-query.ts` 以 `fromRepo` 載入 repo 模組的既有做法，只負責讀取 index 與輸出格式。Home 解析改用 state-root owner；若 knowledge 與一般 state 有意採不同優先序，在該 owner 內明確表達。
- 驗收：`test/goldband-knowledge.test.ts`、`mcp/server/test/knowledge-query.test.ts` 通過；新增 retired／`status: 'all'`、project slug 關鍵字的同組 fixture，CLI 與 MCP 得到相同結果。

**A5. Knowledge secret 檢查不再靜默降級**

- 外漏責任：`lib/knowledge.ts` 跨目錄 `require("../../hooks/scripts/lib/hook-router/secret-patterns.js")`，失敗時改用較少規則的 `FALLBACK_SECRET_PATTERNS`，不留下任何訊號。`lib/secret-content.ts` 是 workflow 內另一份規則（review receipt 與 tracker 投影使用）。Hook 阻擋與內容排除用途不同，兩組規則可以分開；問題在 knowledge 可能在不知情時改用較弱規則。
- 最小整合：刪除 fallback；scanner 無法載入時明確失敗，或改用安裝產物保證存在的單一來源。
- 驗收：`test/goldband-knowledge.test.ts` 的 secret 案例通過；在安裝後的 runtime 佈局（temp HOME）中，capture-candidate 仍能拒絕 `Stripe Secret Key` 案例。

**A6. 刪除 knip 範圍外 JS 模組的無使用端 export**

- 外漏責任：knip 只涵蓋 `goldband-loop` 的 TS。`hooks/scripts/lib/utils.js` 有 33 個 export，外部使用端集中在 `getPersistentDataPath`、`ensureDir`、`readStdinJson` 等少數項目；`getDateString`、`findFiles`、`replaceInFile`、`grepFile`、`commandExists` 等至少 20 個沒有外部使用端。`goldband-loop/cross-review/core.cjs` 有 29 個 export，CLI 與 hook adapter 只用其中 10 個，`artifactPath`、`canonicalReviewBundle`、`detectHost`、`isBlockingFinding`、`parseMarker`、`stateRoot`、`validateApprovalArtifact` 等 12 個在模組外沒有任何使用端（包含測試）。
- 最小整合：刪除沒有使用端的 export，以及只為它們存在的函式。測試用來建立 contract 狀態的 `writeContract`／`writeArtifact` 屬於 contract 檔案協定，保留。可以把既有 knip project 擴到 `cross-review/**/*.cjs` 作為機械邊界；root `hooks/` 不在 `goldband-loop` 的 knip 範圍內，因此不另建工具。
- 驗收：`npm run test:hook-router`、`scripts/test-cross-review.mjs`、`scripts/test-cross-review-regressions.mjs`、`npm run test:plugin-distribution` 通過；`bun run lint:exports` 通過。

**A7. 改寫綁住內部寫法的測試**

- `goldband-loop/test/workflows-runtime.test.ts` 約 942 行：`system/upgrade` preflight 測試讀取 `workflows/owned-runtime.ts` 原始碼，斷言字串存在，並斷言 `commandResult("git", ["pull", ...` 不存在。調整內部寫法就會讓測試失敗，實際執行 pull 的路徑卻未必能被抓到。改為斷言 `result.output.nextCommands`、`preflight.json` artifact 內容（`preflightId`、`status: "pending"`），並用 fixture repo 的 HEAD 不變證明沒有執行 pull。
- `goldband-loop/make-pdf/test/pdftotext.test.ts` 的 `copyPasteGate — assertion logic`：三個測試把 gate 內的 regex 與計算複製到測試中測試複本，完全沒有呼叫 `copyPasteGate`。repo 內也沒有 production caller 呼叫 `copyPasteGate`。依「先刪除再新增」，刪除 `copyPasteGate` 與這三個假測試；若產品需要這個 gate，先接上真實 caller，再對其判定函式寫行為測試。
- `goldband-loop/design/test/daemon.test.ts`：`idleCheckTick ... (smoke)` 只斷言 `typeof boards.size === "number"`，不保護任何行為，應刪除（真正的 idle 行為已在 `daemon-discovery.test.ts`）。LRU 測試經由 `__testInternals__.boards` 斷言 board 是否存在；保留預先填入狀態的做法，但改用公開的 board GET 路由斷言是否被淘汰。
- 驗收：`bun test test/workflows-runtime.test.ts`、`make-pdf/test`、`design/test` 通過；刻意讓 upgrade 在 preflight 執行 pull 時，新測試失敗。

**A8. Skill usage 分析保留一個讀取端**

- 外漏責任：`bin/goldband-analytics`（inventory 公開的 bin，bash）與 `scripts/analytics.ts`（`package.json` 的 `analytics` script）各自讀取並彙整 `~/.goldband/analytics/skill-usage.jsonl`；後者把路徑寫死為 `os.homedir()`，不支援 `GOLDBAND_STATE_DIR`。
- 最小整合：保留公開的 `goldband-analytics`。比對兩者輸出，確認公開入口已涵蓋 `scripts/analytics.ts` 的報表項目後，刪除 `scripts/analytics.ts`、`test/analytics.test.ts` 與 `analytics` script；有缺少的項目時，先補進公開入口。
- 驗收：`test/telemetry.test.ts` 的 `goldband-analytics` 案例通過；`bun run check:source` 與 complexity baseline 同步。

### 維持現況

| 區域 | 路徑 | 理由 |
| --- | --- | --- |
| Work Map 持久化 | `workflows/work-map-store.ts` | 6 個 export 包住持久化與恢復；沒有發現外漏責任 |
| Style checker | `scripts/lib/code-style/`、`scripts/check-code-style.mjs` | 主計畫第 4 項已讓 checker 擁有 advisory，Host 只負責呈現 |
| Workflow owned runtime | `workflows/owned-runtime.ts` | 只 export `ownedRuntimeSteps`，屬於 deep module；測試問題另列於 A7 |
| Host adapter | `workflows/host-adapter.ts` | export 的參數組裝與輸出解析屬於 Host 協定，相關測試保護 wire 行為 |
| Managed worktree | `lib/managed-worktree*.ts`、`test/managed-worktree.test.ts` | 主模組只 export 5 個項目；測試直接使用 `prepareManagedCommit`／`writeLease` 是為了做 crash 故障注入 |
| Verification receipt | `lib/verification-receipt.ts` | 除 A1 的讀取函式外，export 都有 work map／review 使用端 |
| Codex 共用 hook 模組 | `codex/hooks/shell-*.js`、`secret-patterns.js`、`review-launch-advisory.js`、`telemetry-schema.cjs` | 由 `addSharedAdapterArtifacts` 從單一來源生成，並由 distribution check 驗證 |
| Hook 阻擋政策 | `hooks/.../careful-mode-rules.js`、`codex/hooks/high-risk-policy.js` | 兩者分別對應選用的 careful 模式與 Codex 常駐防護；`test-hook-policy-parity.mjs` 經由兩個 router 重放，驗證共同政策 |
| Cross-review gate adapter | `hooks/.../cross-review-gate.js`、`codex/hooks/cross-review-gate.js` | 只是 Host 端的 core 載入器，邏輯在 `core.cjs`；語意差異另列於範圍外議題 |
| MCP 其他工具 | `mcp/server/src/{telemetry-query,policy-check,health-check}.ts` | 以 `fromRepo` 委派給 repo owner；knowledge 另列於 A4 |
| iOS QA daemon | `ios-qa/daemon/src`、`test` | 整合測試使用真實 StateServer，只在外部邊界 mock tailscaled；沒有找到重複責任 |
| make-pdf render | `make-pdf/src/render.ts`、`test/render.test.ts` | 測試斷言輸出；pdftotext 另列於 A7 |
| 生成與分發 | `scripts/sync-plugin-assets.mjs`、`generate-goldband-surfaces.mjs`、`scripts/lib/*-distribution*.mjs` | 單一生成器加上 `--check`；`stableJson` 同名但語意不同（排版輸出或 canonical digest） |
| 安裝 shell | `shell/install/{profiles,install-state,status,uninstall}.sh` | 元件與來源／目標的對應分散在 4 個檔案，但沒有觀察到漂移缺陷；在 bash 建立元件表的成本高於目前收益。驗證缺口列於範圍外議題 |
| Skill 腳本載入 hook 模組 | `skills/global/*/scripts/*.js` 的 `resolveHookModule` | 每個 skill 獨立分發，複本約 10 行，邏輯在 `mode-cli.js` |
| test-free 分片 | `test/test-free-shards.test.ts` 約 118 行 | 原始碼比對保護 `main` 的接線，timeout 行為已由 `process-supervisor.test.ts` 保護；改成行為測試需要新增 seam，收益不足 |
| Runtime 檔案解析 | `bin/goldband.ts` 的 `resolveWorkflowRuntimeFile`、`resolvePlanRuntimeFile` | 兩者的信任條件刻意不同（plan 拒絕 symlink 與 env 覆寫） |
| Host 設定與升級 migration | `goldband-loop/hosts/`、`goldband-upgrade/migrations/` | 抽查：前者是宣告式 registry，後者是歷史一次性腳本 |

### 範圍外議題

- Cross-review 模組缺席時的語意不一致：Codex adapter 收到明確的 `/cross-review` 請求時會報錯；Claude adapter（`hooks/scripts/lib/hook-router/cross-review-gate.js`）則回傳 `null`，不留下任何訊號。需要確認 Claude plugin 安裝佈局是否包含 `goldband-loop/cross-review/core.cjs`。
- 安裝流程缺少全元件 roundtrip 測試（安裝 → `detect_installed_refresh_targets`／status 偵測 → uninstall 不留殘餘）。只要在 `scripts/test-config-lifecycle.mjs` 補一條，就能保護上表分散的元件對應。

### 未覆蓋範圍

以下區域只做了重複函式名稱與 export 使用端掃描，沒有逐檔閱讀 source 與測試。依結束條件，這些區域不填為維持現況，第一輪審查因此未結束：

- `goldband-loop/scripts/` 的開發與評估工具：`question-registry.ts`、`task-emission-schema.ts`、`output-throughput-comparison.ts`、`eval-*`、`psychographic-signals.ts`、`archetypes.ts` 等。
- `goldband-loop/bin/` 中除 `goldband.ts`、`goldband-knowledge.ts`、`goldband-analytics`、`goldband-telemetry-log` 之外的工具：`goldband-global-discover.ts`、`goldband-developer-profile`、`goldband-brain-sync`、`goldband-next-version` 等。
- `goldband-loop/design/src` 中 daemon 以外的模組：`compare.ts`、`variants.ts`、`cli.ts`、`daemon-client.ts` 等。
- `goldband-loop/test/helpers/`（`eval-store.ts`、`session-runner.ts`），以及 root `scripts/check-*.mjs`、`scripts/test-*.mjs` 的內部結構。
- `app-adapters/`、`sandbox/`、`codex/local/`、`codex/profiles/`。

下一輪從上述清單開始。

## 實作結果

依審查結論實作，驗收以本機測試為準；沒有 live Host、真實 plugin 安裝或 Windows 執行證據。

| 項目 | 實作 | 與原建議的差異 |
| --- | --- | --- |
| A1 | 新增 `goldband-loop/lib/stable-file-read.ts`；`review.ts`、`review-impact.ts`、`verification-receipt.ts`、`bin/goldband.ts` 改用它，各自保留失敗、跳過或降級語意；`review-impact.test.ts` 經由 deadline checkpoint 在讀取中改變來源檔，驗證 caller 接線 | 讀取後比對 ns 精度的 stat，並檢查路徑仍指向同一 inode；只有 plan input 啟用二次讀取比對，以免 review 來源讀取量加倍 |
| A2 | `workflow-telemetry.js` 改為無相依，由 caller 提供 host／source／runId／sessionId；新增 `retained-jsonl.js` 統一輪替與保留期；兩者與精簡後的 `utils.js` 由 `sync-plugin-assets` 生成到 `codex/hooks`；Claude 專屬 outcome 事件移入 `hooks/scripts/hooks/hook-router.js` | Hook 資料根目錄改由 `utils.js` 單一負責，並採用 Codex 的逐一嘗試語意（設定的根目錄無法建立時改試下一個，最後才用 `tmp/goldband`）；Codex 仍刻意忽略 `CLAUDE_SESSION_ID`。Cross-review state root 與 telemetry miner 讀取的是不同 store，重新判定為維持現況 |
| A3 | Marker 組裝、相依連結與讀回缺失檢查移入 `projection.ts`；CLI wire helper 移入 `cli-adapter.ts`；共用測試涵蓋兩個 provider | 無 |
| A4 | 新增 `goldband-loop/lib/knowledge-search.cjs`，CLI 與 MCP 共用篩選、排序與 knowledge home | Home 仍是 `GOLDBAND_HOME` → `~/.goldband`，沒有改用 `state-root`，避免改變既有 knowledge 的存放位置。行為變更：明確指定 `--status retired` 時會回傳 retired 條目；MCP 的 `status: 'all'` 改為排除 retired，與 CLI 相同 |
| A5 | Hook secret 規則由 `sync-plugin-assets` 生成到 `goldband-loop/lib/secret-patterns.cjs`；刪除 fallback 規則 | 不直接報錯，改為讓 link 與 copy 安裝都帶有同一份規則 |
| A6 | `utils.js` 縮減為 5 個有使用端的 export；`core.cjs` 移除 12 個無使用端的 export | 沒有擴充 knip：knip 看不到 `require` 後以成員方式使用的 export，也看不到依路徑動態載入的模組，誤報過多。之後新增 `scripts/check-unused-exports.mjs`，並接進 pre-commit、`npm test` 與 CI；見 `docs/DECISIONS.md`。啟用時另外移除 32 個只在模組內使用的 export |
| A7 | 以行為測試取代 upgrade 原始碼比對（突變為 preflight 執行 pull 時會失敗）；刪除 design 空 smoke 測試，LRU 改用公開路由斷言，fixture 改讓 done board 較新（原 fixture 無法區分淘汰順序） | pdftotext 整組移除：`copyPasteGate` 沒有 caller，`make-pdf setup` 不再檢查 pdftotext，Windows CI 移除對應測試 |
| A8 | 刪除 `scripts/analytics.ts`、`test/analytics.test.ts` 與 `analytics` script | 確認 `goldband-telemetry-log` 不寫 `repo`／`hook_fire`，被刪除的兩個報表段落原本沒有資料來源 |
| Cross-review | `cross-review-gate.js` 與 `module-loader.js` 改為共用模組並生成到 Codex；請求判斷抽成 `goldband-loop/cross-review/cross-review-request.cjs`，由 core 使用並生成到兩個 Host 的 hook 目錄，因此缺少 core 時與 core 判斷相同的 prompt；Claude 也搜尋已安裝的 runtime，明確要求 cross-review 但缺少 core 時會報錯；回歸測試涵蓋 Claude plugin 佈局載入 `~/.claude/skills/goldband` 的 core，以及缺少 core 的情況 | 無 |
| 安裝 roundtrip | `scripts/test-config-lifecycle.mjs` 新增 all-tools → uninstall 測試；測試發現並修正 `read_profile_skill_array` 的區域變數遮蔽，此前 uninstall 與 profile 切換都不會刪除 profile skill 連結 | `codex/local` 的使用者 overlay 依既有設計保留 |

