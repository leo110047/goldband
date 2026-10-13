# Global Skills Validation

這份文件只放驗證與測試觀點，不放一般導覽。

## 驗證重點

### skill 結構健康

```bash
bash scripts/check-skills.sh
```

用途：
- 驗證 `SKILL.md` frontmatter
- 檢查 skill 檔案是否存在
- 提醒過長文件

### skill 選擇行為

Skill 由 host 依 description 選擇，hook 不再依關鍵字推薦。修改 description 後，
建議至少用這些場景做人工 spot check：

```text
這個查詢很慢，幫我優化
→ 應偏向 performance-optimization

Review 這個 PR
→ 應偏向 Goldband review workflow

Review 這個 PR，測試一直失敗
→ 應先偏向 systematic-debugging
```

### anti-hallucination 行為

```text
getUserById 函數在哪裡？
→ 應先查找實際代碼，不應猜測

這個函數做什麼？
→ 應先讀檔，再依實際實作回答

修復這個 bug
→ 應改完後跑驗證，而不是只說應該修好了
```

### prompt hygiene 行為

```text
幫我寫一個每日新聞 briefing prompt
→ 應先做成該類 briefing 的 authoring prompt，保留目標、可見背景、硬邊界與成果標準

幫我寫交給另一個 coding agent 的 prompt
→ 應明確 source of truth、實作範圍、測試、驗證與回報要求；這類執行型 prompt 可以有必要步驟

幫我改 Discord cron 報告 prompt
→ 應寫清楚讀者、可見輸入、訊息用途與必要邊界，並用可觀察標準描述訊息品質
```

## 什麼算異常

- 明顯該進 debug 卻被帶去 review
- recommendation 沒有 assumptions / failure modes / alternatives
- prompt 任務沒有觸發 `prompt-hygiene`，或輸出含無根據的「不要怎樣」規則
- mode state 說法與 `status` 不一致
- 直接對 repo 內容做未驗證 claim

## 文件與 inventory 檢查

當 skill catalog、操作方式或 mode 腳本路徑變更時，至少同步檢查：

- `skills/global/README.md`
- `skills/global/OPERATIONS.md`
- `skills/global/LEARNING_PATH.md`
- 對應 skill 的 `SKILL.md`
