# Goldband 行為測試與 Deep module：一次性唯讀審查任務

第一輪已完成；未覆蓋範圍由 `docs/TODO.md` 追蹤。

使用者明確指派時，由既有唯讀 Reviewer 在 Host 內執行一次全 codebase 審查，回報有收益的責任整合候選與綁住內部寫法的測試。這是任務說明，不是新功能；日常審查以本次改動及相關模組為範圍，依 `goldband-loop/review/shared-rubric.md` 與 `checklist.md` 的判準執行。

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

## 報告與結束條件

每個區域回報「採納」或「維持現況」，附 source／test 路徑與理由；沒有候選的區域也有維持現況的紀錄。採納表示建議另案實作，列出公開行為、外漏責任、實際 caller、現有測試、最小整合方式與驗收。Reviewer 回傳結果；採納項目另案實作，結論記入既有決策紀錄。

所有區域完成評估，且沒有會改變取捨的待驗問題時，這次審查結束；不以重構全部完成為條件。來源不可讀、範圍不完整或缺必要證據時，回報受阻／未覆蓋範圍與待查項，不將未檢查區域填成維持現況。固定範圍之外的新議題另案處理。

後續實作的行為驗收：原缺陷或代表性契約違反使測試失敗；相同公開契約下改變內部分工，測試仍通過。替換舊測試前對照原有需求與負向情境，再完成採納模組的既有檢查。

方法參考：[Matt codebase-design](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/codebase-design/SKILL.md)。
