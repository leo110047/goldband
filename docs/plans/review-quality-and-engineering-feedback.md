# Goldband 審查品質與工程回饋優化計畫

**狀態：** Proposed，尚未實作。基準為 `1f3de4c9df3a8d9e0acd5b39d94af25c3c636769`，2026-10-13。

目標是讓唯讀 Reviewer 同時找出缺陷與值得採用的設計改善，並把審查發現轉成更有效的測試、檢查或責任邊界。實作者負責修改與驗證；Reviewer 提供獨立判斷。

## 工作方式

實作者先完成功能，再檢查重複責任、錯誤分層、不必要抽象及呼叫端負擔，做有具體收益的設計整理，完成相關驗證後交給 Reviewer。Reviewer 檢查需求符合、正確性、測試有效性和設計品質；實作者依證據修正或反駁，再驗證受影響的行為。

基本契約、資料流與安全邊界在實作前釐清；功能完成後可以調整模組切分。設計整理不要求每次都改程式，也不新增階段狀態或完成旗標。

程式負責 finding 契約、改善上限、阻擋資格、規則接線與既有檢查。設計取捨由 Reviewer 判斷。已知可機械檢查的限制，放進原有檢查器、測試或 CI。

## 已確認的問題

| 問題 | 證據 | 本次處理 |
| --- | --- | --- |
| 改動範圍有兩個解析者 | 完整 mock workflow 收集到 fixture 路徑 `goldband-loop/café.ts`，卻漏選 `loop-engineering` | 規則選擇使用已收集的 paths |
| 改善建議無法留下 | `hasConcreteFailurePath` 要求失效情境；只有 evidence／recommendation 的建議被全部過濾 | 增加 kind 與改善分支 |
| 多 specialist 的資料仍在 | finding、去重、signal、telemetry 與測試仍保留舊欄位 | 清理相關遺留物 |
| JSON schema 沒有 runtime 使用端 | `schemas/review-result.schema.json` 未被程式引用 | 刪除孤兒檔 |
| Style advisory 重複 | Claude／Codex 各自解析 checker 結果與格式化 issue | Checker 提供 advisory 摘要 |
| Context 提醒沒有實際用量依據 | PostToolUse 次數累計到 60／85，推論 context 飽和 | 移除 ContextMonitor |

上述兩個 workflow 結果是本機 mock 證據。既有 recorder 已涵蓋 RED／GREEN 順序、seam、命令與 candidate 的負向案例；本計畫沒有新增 recorder 工作。

## 1. 統一 Review 改動範圍

**理由：** 同一份 diff 被收集端與規則選擇端各自解析，兩者已出現不同結果。共用收集結果直接修正責任分裂；完整 workflow 測試保護兩者接線，避免元件測試各自通過、實際審查仍漏規則。

**修改：** `goldband-loop/workflows/review.ts`、`review-rules.ts`；測試放在既有 `goldband-loop/test/review-semantic.test.ts`、`workflows-runtime.test.ts`。

將 collection owner 已產生的 `changedFiles` 傳給規則選擇與 prompt 組裝，移除 consumer 對同一 diff 的重新解析。Freshness 重建 prompt 時也使用同一份收集結果。Impact 已消費收集結果，保持這個接線。

**驗收：** 新增一條完整 workflow 整合測試：以 Git 引號／octal escape 的 `goldband-loop/café.ts` fixture 經 `runWorkflow(getWorkflow('review/code'), ...)`，mock 外部 Host，確認實際 prompt 包含 `loop-engineering`。原版必須失敗，修正後通過。沿用既有 `changedFilesFromPatch` 單元測試及 scope／policy freshness 回歸，不把每個 parser 邊界再複製成完整 workflow 測試。

## 2. 增加有限、可採取的設計改善

**理由：** 設計品質可以有改善空間，即使沒有可達的故障。現在的失效情境門檻會刪掉這類建議。分類讓它們保留下來；三條上限與獨立 signal 防止小建議淹沒缺陷或變成交付阻擋。

**修改：** `goldband-loop/workflows/types.ts`、`schema.ts`、`review.ts`、`review-engine.ts`；同步 `goldband-loop/review/shared-rubric.md`、`checklist.md`、`findings-schema.md`，測試沿用上述兩個檔案。

沿用 `findings`，增加 `kind: "defect" | "improvement"`。Host wire schema 與基礎 validator 同步驗證 envelope、kind、共通欄位型別與既有 severity 值；改善的內容有效性與嚴重度衝突由本地處理，不以 wire schema 提前拒絕整份回應。

| 行為 | defect | improvement |
| --- | --- | --- |
| 有效性 | 保留既有 evidence、失效情境與驗證方式要求 | 保留基本欄位；額外要求非空 evidence、recommendation，不要求失效情境 |
| Blocking | 沿用既有缺陷語意 | 程式固定為 false |
| 數量 | 不受改善上限限制 | 過濾、去重、排序後最多保留 3 條；超過時列出未顯示數量 |
| Signal | 計入 findingCount、severityCounts、blockerKey | 排除於缺陷 signal |
| 報告 | 先顯示缺陷 | 另區顯示改善 |

在 `review-engine.ts` 用一個 operation 集中 finding 的整理、去重、有效性過濾、排序與改善截斷；`review.ts` 負責接線、signal 和報告。移除 `schema.ts`／`review-engine.ts` 的重複去重，去重 key 納入 kind，caller 不再自行協調處理次序。

已識別的 improvement 若缺非空 evidence／recommendation，或 severity 為 high／critical，只丟棄該條；診斷保留位置、summary、原 severity 與原因，其他合法 findings 繼續處理。不猜測錯的是 kind 還是 severity，因此不自動降級或改分類。無法解析回應、無效 envelope、未知 kind 或共通欄位型別錯誤仍明確失敗。

Operation 同時回傳程式產生的診斷與截斷數量，不要求模型填寫。未顯示數量只計有效且去重後的改善，例如「另有 2 條有效改善未列出（上限 3 條）」。無效項目另列診斷；診斷與截斷數量不計入缺陷 signal。兩類均可為空，有診斷時報告仍須呈現。

改善聚焦同一責任重複、複雜度外漏、錯誤分層、無收益的抽象，以及妨礙行為測試的耦合。Evidence 指向實際程式；recommendation 說明最小改法與實際收益。既有 Suppressions 繼續排除純風格、無影響的一致性與無依據建議。Benefit、tradeoff、suggestedVerification 不新增為必填欄位。

**驗收：** Operation 測試驗證缺陷、改善、混合、空結果、跨 kind 去重及精確截斷數量。完整 workflow 的混合案例包含合法缺陷、合法改善、缺 evidence／recommendation 的改善與 high／critical 改善：報告保留合法項目並列出診斷，缺陷 signal 不受影響。超過三條的有效改善顯示正確未列出數量，重複項不重算，缺陷不被截斷；核心契約錯誤仍失敗。Mock 只替換外部 Host，保留實際 finding 處理與 wire schema 驗證。

## 3. 補強設計審查與按需回顧

**理由：** 審查應涵蓋設計與有效的行為測試；作者如何產生錯誤，則需要 session 或操作證據。把程式可見的問題留在 Review，歷史流程歸因放在按需執行的 retro，避免每條 finding 都增加推測與固定負擔。

| 修改位置 | 工作 | 驗收 |
| --- | --- | --- |
| `rules/global-instructions.md.tmpl` | 在既有 Engineering Decisions 補入功能完成後的設計整理時機，保持簡短 | 重新生成後，兩個 Host 的共用指引一致，既有 guidance／manifest checks 通過 |
| `goldband-loop/review/shared-rubric.md`、`checklist.md` | 說明 defect／improvement 判準、檢查行為測試；相關程式／測試／checker 顯示具體缺口時，順帶指出 | 路徑漏選是 defect，責任整合是 improvement；沒有作者紀錄時不歸因作者操作，純風格不回報 |
| `goldband.manifest.json` 的 `context/retro` action prompt contract | 按使用者指定的 session／歷史紀錄追查流程；先確認已有檢查及接線，再提出可採取的改善 | 用本次有紀錄的路徑案例執行 Host 回顧，區分觀測與推論，建議修接線／測試；缺少歷史資料時不編造原因 |

日常 Reviewer 以本次改動與相關模組為範圍，檢查行為測試與模組邊界；必要時追查 diff 外的 caller、consumer、測試與 CI 配置。沿用已提供的 impact context 作為依賴／測試線索，不強制每次做全 codebase 盤點或新增必跑分析功能。

設計判準包含：測試保護什麼可觀察行為、內部重構後是否仍可通過、mock 是否替換了被測路徑、caller 是否必須協調過多內部細節，以及同一責任是否散落多處。值得整合時，說明小介面如何包住完整責任；有價值的判斷沿用 improvement finding。

Reviewer 可以指出程式／測試可見的驗證缺口，明確需求缺少必要驗證時仍可列 verification gap；不以附近已有測試為前提。每條 finding 不必回答作者為何漏掉。選定模組後，可機械驗證的公開／私有邊界、import 限制及行為契約交給既有 compiler、lint 或 tests；設計取捨不以已跑分析工具的旗標代替。

測試以輸出、狀態、錯誤與必要外部效果為斷言，預期值來自需求、獨立 fixture 或計算。純函式介面、CLI／Host 協定、安裝產物與必要 race／故障注入仍保留。調整 Finding operation 的內部分工時，相同公開契約的測試應繼續通過；替換舊測試前對照其需求與負向情境。

Retro 維持 `prompt-contract-dispatch`，按需啟動。機械問題優先修既有檢查或接線；設計問題改善責任邊界或判準。沒有值得採用的提案時結束，不強制新增規則。CLI compatibility real mode 不列入本次 migration；回顧效果以真實 session 結果確認。

## 4. 由 Checker 產生 Style advisory

**理由：** Issue 與檢查錯誤的語意屬於 checker。讓它直接提供限量摘要，兩個 Host 就能移除重複 JSON 解析與 issue 格式化，沿用已有 checker 的分發路徑。

**修改：** `scripts/lib/code-style/cli.mjs`、`output.mjs`、`hooks/scripts/lib/hook-router/posttool-policy.js`、`codex/hooks/hook-router.js`。入口仍為 `scripts/check-code-style.mjs`，不新增 helper 或分發路徑。

新增 `--format advisory`：無問題時不輸出；有問題時 stdout 最多顯示 8 條 issue 與其餘數量，附上僅為 Hook advisory 的說明。沿用 exit code 0／1／2：0 無 blocking 違規但可有 advisory，1 有違規，2 工具或配置錯誤；checker 自身錯誤摘要寫入 stderr。原有 json／text 輸出保持。

Host 保留檔案選擇、checker 路徑、程序啟動與平台呈現，以及啟動失敗或輸出超限的錯誤處理。兩邊目前的 spawnSync 都未設定 timeout，本項不新增 timeout。缺 checker 沿用現有語意；pre-commit 的阻擋行為維持。

**驗收：** 在 `scripts/test-code-style-gate.mjs` 驗證正常靜默、違規摘要、截斷數量、工具錯誤與舊格式；在既有 Hook tests 驗證兩個 Host 的呈現及啟動失敗。保留現有必跑安裝／分發檢查，不新增 helper 的專屬 temp HOME 測試。

## 5. 完整移除 Specialist 遺留物及過時機制

**理由：** 舊 specialist 欄位讓單一 reviewer 繼續負擔過時分支；孤兒 schema 增加契約漂移來源；ContextMonitor 用呼叫次數推論實際 context，提供了不可靠訊息。三者的處理是刪除，不需要新替代機制。

| 修改位置 | 刪除內容 | 驗收 |
| --- | --- | --- |
| `goldband-loop/workflows/run.ts`、`goldband-loop/bin/goldband.ts`、`goldband-loop/workflows/types.ts`、`goldband-loop/lib/review-runtime-contract.ts` | 移除 specialists option 與 no-op／專用驗證；公開 launcher 將旗標加入既有「已移除旗標」判定，禁止轉傳 | 公開入口在建立／啟動子程序前回報 `--specialists was removed`；直接呼叫內部 run.ts 則回報 unknown argument，單一 core reviewer 保持 |
| `goldband-loop/workflows/review-timeouts.ts`、`review.ts` | specialistMode 常數、timeout 訊息與 telemetry 欄位 | 既有 deadline／timeout／預算測試通過，超時訊息不再帶 off mode |
| `goldband-loop/workflows/types.ts`、`schema.ts`、`review.ts`、`review-engine.ts`、`review-rules.ts` | specialist、contributingSpecialists、specialist-skipped 特殊處理、selectedSpecialists telemetry | Typecheck／unused exports 通過；排序、去重與缺陷 signal 維持正確 |
| `goldband-loop/review/findings-schema.md`、`shared-rubric.md`、`goldband-loop/workflows/README.md`、相關 tests／fixtures | 舊欄位、specialist-runtime／specialist-skipped category，以及 CLI／timeout 舊描述 | 活躍文件與 fixture 不再保留該契約，既有行為斷言依新契約更新 |
| `schemas/review-result.schema.json` | 無 runtime 使用端的孤兒 schema | Runtime 仍使用 validator 和 Host wire schema；相關契約測試通過 |
| `hooks/scripts/lib/hook-router/posttool-policy.js`、`hooks/scripts/tools/replay-hook-router.js`、`scripts/test-hook-noise-policy.mjs` | ContextMonitor、計數狀態、兩個門檻環境變數、state-file override 與專屬門檻測試 | 既有 noise／replay tests 確認多次 PostToolUse 不建立 context 計數檔，也不輸出 compact 提醒；其他 advisory 保持 |

**相容性：** `--specialists off` 目前是合法 no-op，移除後在公開入口直接報錯，屬破壞性 CLI 變更。不是單純刪掉處理分支後讓 `forwarded.push(arg)` 轉傳。`--loop` 的既有 single-pass 拒絕路徑維持；Host／pass timeout 數值、deadline 與預算保護不變。

**測試更新：** `goldband-loop/test/goldband-review-cli.test.ts` 的兩個 specialist 拒絕案例改用 was removed，涵蓋 off／auto／all 並確認公開入口拒絕、沒有啟動 Host；`goldband-loop/test/workflows-runtime.test.ts` 的 banana 案例改驗證內部 run.ts 的 unknown argument。移除舊 fixture 欄位及 off mode 訊息斷言，保留原有 timeout／deadline 行為測試。

**決策紀錄：** 實作時同步更新 `docs/DECISIONS.md`。在「Review Runtime Forbids Independent Specialist Agents」及較早 interactive review 決策的相關旗標／specialist timeout 段落，原地加註局部已被取代並連到新的決策紀錄；保留歷史內文。新紀錄說明 off 的破壞性移除、公開入口提前拒絕，以及單一 reviewer／現行 timeout 保持。驗收是舊紀錄可沿連結找到目前契約，且沒有把歷史的 auto／all 預算描述當成現行行為；計畫階段不先標為已實作。

不為舊計數檔建立清理 migration。既有 Review artifact 沒有程式讀取端，不新增 legacy 分類或相容層。

## 順序與檢查

先做 1，讓原缺口有完整行為測試；接著做 2 與相關 specialist／schema 清理，再更新 3。第 4 項與 ContextMonitor 移除可分開處理。每項先跑相關測試，再完成 repo 原有必要檢查。

| 範圍 | 已存在的驗證命令 |
| --- | --- |
| Review／finding／CLI | 在 `goldband-loop/`：`bun test test/review-semantic.test.ts test/review-impact.test.ts test/workflows-runtime.test.ts test/goldband-review-cli.test.ts`、`bun run check:source` |
| 共用指引／workflow contract | Repo root：`npm run check:manifest`、`npm run test:workflow-contracts`、`npm run test:capability-invocations`、`npm run test:decision-guidance` |
| Hook／分發／安裝 | Repo root：`npm run test:hook-router`、`npm run test:style-gate`、`npm run test:plugin-distribution`；依 root AGENTS.md 完成 Claude config verification、Codex rule syntax 與 temp HOME 安裝檢查 |
| 最終必要檢查 | Repo root：`npm test`；`goldband-loop/`：`bun run test:free`、`bun run test:workflows`，依現行測試選擇器執行 |

本次不改 sandbox／allowlist，沿用既有唯讀回歸測試。正式改動完成後進行獨立唯讀審查，修正 finding，再驗證受影響部分。

## 選擇理由與待驗事項

最小方案沿用原有 workflow 與 checker：增加 finding kind、程式產生的診斷／截斷數量及 advisory 格式，集中原有 Finding 處理，刪除過時契約。全 codebase 盤點改為[一次性唯讀審查任務](codebase-behavior-and-deep-modules.md)，不新增 capability／CLI／必跑模型呼叫，也不作為本次交付條件。

前提是單一 core reviewer、唯讀邊界與缺陷 signal 保持。主要風險是改善出錯阻止缺陷報告、截斷資訊消失，以及 CLI no-op 清理不完整；混合案例、精確計數與公開入口拒絕測試分別保護。若實作重新要求新增 helper／分發路徑或泛用錯誤恢復，先查明既有 owner 無法涵蓋的具體原因。

設計建議的實際品質與 Host retro 效果，以真實案例檢查；schema／mock tests 僅驗收其機械契約。沒有批次 retro 或 artifact consumer 需求時，維持既有入口與格式處理，無需新增 migration。

Matt 方法參考：[tdd](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd/SKILL.md) 的介面行為與獨立預期值、[retro](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md) 的環境回饋。採用內容融入既有入口。

本文件只定義後續實作；文件完成不代表上述功能已實作、測試通過或已安裝。
