# goldband

> Shared engineering guardrails for Claude Code and Codex.

[English](README.en.md) | 中文

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## goldband 是什麼

goldband 是一套給 Claude Code 和 Codex 共用的 engineering guardrails，目標是把 AI coding agent 的工作方式收斂成比較穩定、可驗證、可維護的流程。

這個 repo 主要做三件事：

- 管 shared policy：commands、hooks、rules、contexts、portable skills
- 管安裝與更新：把 Claude Code / Codex 的本地設定接到這個 repo，並在啟動前做安全的 self-update / skill sync
- bundle `workflow` runtime：安裝後對外提供 `goldband-*` 入口

## goldband 與 workflow 的邊界

這個 repo 同時包含 goldband 本身，以及 vendored 的 `workflow` runtime source，但兩者責任不同：

- goldband 負責 shared policy、installer、Claude/Codex adapter、repo-linked hooks/commands/contexts/rules，以及 portable skills。
- `vendor/workflow/` 是被 bundle 進來的高階 runtime 原始碼，自己有獨立的 packaging、changelog、architecture 與 runtime docs。
- 安裝時是 goldband 透過 [`shell/install/workflow.sh`](shell/install/workflow.sh) 把 workflow runtime 轉成 `goldband-*` 對外入口與 host-specific install layout。

如果你想看更明確的邊界與維護規則，請讀 [ARCHITECTURE.md](ARCHITECTURE.md)。如果你要看 runtime 自己的產品與內部設計，請讀 [vendor/workflow/README.md](vendor/workflow/README.md) 與 [vendor/workflow/ARCHITECTURE.md](vendor/workflow/ARCHITECTURE.md)。


## 安裝

### 支援平台

目前正式支援：

- macOS / 其他 POSIX shell 環境：`install.sh`
- Windows PowerShell：`install.ps1`

Windows 路徑預設使用 PowerShell 啟動整合；workflow 安裝則需要可用的 `bash`（建議 Git for Windows 內建的 Git Bash）。

### 快速開始

要用 `git clone` 抓完整 repo：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。goldband 是 `repo-linked install`，啟動前自動更新也依賴 git metadata。

macOS / POSIX shell：

```bash
./install.sh pack-quality      # Claude Code 日常推薦
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + 內建 workflow
```

Windows PowerShell：

```powershell
pwsh -File .\install.ps1 all-tools         # Claude Code + Codex
pwsh -File .\install.ps1 all-with-workflow # Claude Code + Codex + 內建 workflow
pwsh -File .\install.ps1 status            # 檢查安裝狀態
```

### 進階安裝選項

如果你只想補裝特定項目，也可以直接跑：

```bash
./install.sh codex-full        # 只安裝 Codex
./install.sh workflow          # 只安裝 Claude 端 workflow
./install.sh workflow-codex    # 只安裝 Codex 端 workflow
./install.sh launchers         # 重裝 claude/codex 啟動入口
./install.sh status            # 檢查安裝狀態
./install.sh uninstall         # 移除安裝
```

依賴補充：

- `hooks` 合併需要 `jq`。macOS 可用 `brew install jq`
- Windows workflow 路徑另外需要 `bash`，建議直接安裝 Git for Windows

## 更新

手動更新方式很簡單：

```bash
cd /path/to/goldband
git pull --ff-only
```

更新後，重跑你原本使用的安裝組合即可。例如只裝 Claude Code 就重跑 `./install.sh pack-quality`，有裝 Codex 就重跑 `./install.sh all-tools`，有裝 workflow 就重跑 `./install.sh all-with-workflow`。

如果你平常直接輸入 `claude` 或 `codex`，goldband 也會在啟動前做一次安全的 self-update 檢查。macOS / POSIX 走 shell launcher，Windows 走 PowerShell launcher。不過它只會在 repo 乾淨、branch 是 `main`、tracking `origin/main`，而且可以安全 `git pull --ff-only` 的情況下才自動 fast-forward；不符合條件時會直接跳過。

## 語言

goldband wrapper 支援 `zh-TW` 和 `en`，預設是 `zh-TW`。

在 Claude Code 裡最簡單的方式是：

```text
/goldband-language
```

如果你已經知道目標，也可以直接輸入：

```text
/goldband-language zh-TW
/goldband-language en
```

如果你在 Codex 或想直接改設定，也可以用：

```bash
~/.codex/skills/workflow/bin/workflow-config set goldband_language zh-TW
~/.codex/skills/workflow/bin/workflow-config set goldband_language en
```

切換後如果目前 session 還沒吃到新設定，重開 Claude Code 或 Codex 一次即可。

## 常用入口

日常最常用的入口是 `/plan`、`/verify`、`/goldband-investigate`、`/goldband-review` 和 `/goldband-qa`。如果你要開高風險保護，可以用 `careful-mode`；如果你只想做唯讀調查，可以用 `freeze-mode`。

## `workflow`

`workflow` 是 goldband 內建的高階流程 runtime。安裝方式是 `./install.sh workflow`、`./install.sh workflow-codex` 或 `./install.sh all-with-workflow`。

安裝後，Claude runtime 會在 `~/.claude/skills/workflow`，Codex runtime 會在 `~/.codex/skills/workflow`，共享 state 會在 `~/.workflow/`，對外入口則是 `goldband-*`。如果你要測試別的 runtime checkout，才需要用 `WORKFLOW_REPO_DIR=/path/to/runtime ./install.sh all-with-workflow` 覆寫來源。

## 什麼情況下不適合用

下列情境通常不值得導入整套 goldband：

- 你不用 Claude Code 或 Codex，只想要一份普通專案模板
- 你現在只是做一次性的 solo prototype，而且不想承受 hooks、wrappers、repo-linked install 的管理成本
- 團隊不接受自訂 hooks、repo-linked user config、或 `goldband-*` 命令入口
- 你只想要 workflow runtime 本身，不需要 goldband 的 shared policy、adapter、installer 與雙工具對齊

如果你只需要 bundled runtime，直接看 [vendor/workflow/README.md](vendor/workflow/README.md) 會比較準。

## 疑難排解

| 問題 | 解法 |
|------|------|
| Hook 沒有執行 | 跑 `./install.sh hooks`，並確認 `jq` 已安裝 |
| 安裝看起來不完整 | 先用 `./install.sh status` 檢查 |
| `/verify-config` 報錯 | 重跑 `./install.sh all-tools` 或 `./install.sh all-with-workflow` |
| 語言切換後說明沒變 | 重開 Claude Code 或 Codex 一次 |
| 啟動時沒有自動更新 | 確認這是用 `git clone` 抓下來的 repo，而且目前在 `main`、工作樹乾淨，並且 tracking `origin/main` |

## 授權

MIT License.
