# Project: [專案名稱]

## Overview

[一句話描述這個專案做什麼]

## Tech Stack

- Language: [TypeScript / Python / Go / C#]
- Framework: [Next.js / Django / Gin]
- Database: [PostgreSQL / MongoDB / SQLite]
- Deployment: [Vercel / Railway / Docker]

## Project Structure

```
src/
├── components/    # UI 組件
├── lib/           # 核心邏輯
├── api/           # API 路由
└── utils/         # 工具函數
```

## Critical Rules

- 不要修改 `src/config/` 下的檔案，除非明確要求
- 所有 API 回應必須使用統一格式：`{ success: boolean, data?: T, error?: string }`
- 環境變數在 `.env.local`，不要 hardcode 任何 secret

## Code Style

- 使用 immutable patterns，不要直接修改物件
- 檔案保持在 400 行以內
- 函數保持在 50 行以內
- 錯誤必須明確處理，不要 silent catch

## Testing

- 新功能必須有對應測試
- 測試指令：`npm test` / `pytest` / `go test ./...`
- 目標覆蓋率：80%+

## Available Commands

- `/goldband-plan` - 開始新功能前的規劃
- `/verify` - Claude Code 內建的變更驗證，提交前執行
- `/goldband` - 列出並執行 Goldband workflows，例如 `/goldband review code`

## Git Workflow

- Commit 格式：`feat|fix|refactor|docs|test|chore: 描述`
- 不要直接 push 到 main
- PR 前必須跑 `/verify`
