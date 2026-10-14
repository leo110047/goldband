# Global Skills Validation

## 結構

`bash scripts/check-skills.sh` 驗證 `SKILL.md` frontmatter、引用檔案存在與檔案大小預算。

## 異常判準

- 該除錯的任務被導向 review。
- recommendation 沒有 assumptions / failure modes / alternatives。
- prompt 撰寫任務未使用 `prompt-hygiene`，或輸出含無根據的禁止規則。
- mode 狀態描述與 `status` 輸出不一致。
- 對 repo 內容的 claim 未經查證。

Skill 由 host 依 description 選擇；修改 description 後，以適用與不適用情境人工確認選擇結果。

## 同步範圍

skill catalog、操作方式或 mode 腳本路徑變更時，同步 `skills/global/README.md`、
`skills/global/OPERATIONS.md` 與對應 `SKILL.md`。
