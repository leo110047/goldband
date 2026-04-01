# goldband

> Shared engineering guardrails for Claude Code and Codex.

[English](README.en.md) | 中文

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## goldband 是什麼

goldband 是一套給 Claude Code 和 Codex 共用的 engineering guardrails，目標是把 AI coding agent 的工作方式收斂成比較穩定、可驗證、可維護的流程。

goldband 主要提供：
- commands、hooks、rules 和 contexts，用來統一日常規劃、驗證、審查和除錯流程。
- 常駐 claim verification baseline，要求 repo 內事實先驗證、外部最新資訊要有來源、完成宣告要有 fresh evidence。
- 共用 skills，提供 evidence-based coding、systematic debugging、security review、testing strategy 這類可重複使用的工作流。
- vendored workflow runtime，goldband 會把它包成 goldband-* 入口，統一 review、QA、investigation 和 ship 這類高階流程。


## 安裝

要用 `git clone` 抓完整 repo：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。goldband 是 `repo-linked install`，啟動前自動更新也依賴 git metadata。

最常用的安裝方式是：

```bash
./install.sh pack-quality      # Claude Code 日常推薦
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + 內建 workflow
```

如果你只想補裝特定項目，也可以直接跑：

```bash
./install.sh codex-full        # 只安裝 Codex
./install.sh workflow          # 只安裝 Claude 端 workflow
./install.sh workflow-codex    # 只安裝 Codex 端 workflow
./install.sh launchers         # 重裝 claude/codex 啟動入口
./install.sh status            # 檢查安裝狀態
./install.sh uninstall         # 移除安裝
```

`hooks` 合併需要 `jq`。macOS 可用 `brew install jq`。

## 更新

手動更新方式很簡單：

```bash
cd /path/to/goldband
git pull --ff-only
```

更新後，重跑你原本使用的安裝組合即可。例如只裝 Claude Code 就重跑 `./install.sh pack-quality`，有裝 Codex 就重跑 `./install.sh all-tools`，有裝 workflow 就重跑 `./install.sh all-with-workflow`。

如果你平常直接輸入 `claude` 或 `codex`，goldband 也會在啟動前做一次安全的 self-update 檢查。不過它只會在 repo 乾淨、branch 是 `main`、tracking `origin/main`，而且可以安全 `git pull --ff-only` 的情況下才自動 fast-forward；不符合條件時會直接跳過。

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
