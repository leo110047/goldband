# Global Skills Learning Path

這份文件給第一次接觸 goldband global skills 的人，重點是學習順序，不是操作細節。

## 第 1 階段：先建立底線

先熟悉：

- `evidence-based-coding`
- `implementation-contracts`
- `systematic-debugging`
- `file-search`

目標：
- 不憑印象回答
- 實作 contract 壞掉時要明確失敗，不用猜測或非必要降級補洞
- 知道 bug 要先重現、收證據、再修；完整調查走 Goldband investigate workflow
- 習慣先建 codebase map

## 第 2 階段：學會規劃與審查

加入：

- `planning-workflow`
- `testing-strategy`
- `prompt-hygiene`

目標：
- 寫得出可執行 plan；完整規劃走 `/plan`
- 知道怎麼設計 coverage 與 regression test
- 知道 review 要走 Goldband review workflow，並先看 correctness、risk、missing tests
- 寫 prompt 時能分清目標、背景、硬邊界與成果標準，不用模板或無根據禁令取代判斷

## 第 3 階段：學會做方向判斷

加入：

- `security-checklist`
- `performance-optimization`

目標：
- recommendation 不是只講 tradeoff
- 要能交代 assumptions、failure modes、switch criteria、best alternative；深度安全審查走 `$goldband review code`，並明確指定安全審查範圍

## 第 4 階段：維護 skill 與流程本身

加入：

- `decision-log`
- `skill-developer`
- `claude-config-verification`

目標：
- 能維護 reusable workflow
- 能驗證 hooks / plugin / config surface
- 能把決策沉澱成 ADR，而不是只留在對話裡
