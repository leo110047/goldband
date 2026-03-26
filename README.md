# goldband

> Shared engineering guardrails for Claude Code and Codex.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What Is goldband

goldband 不是單純的 dotfiles repo。它是一套給 Claude Code 和 Codex 共用的 engineering guardrails，目標是把 AI coding agent 的工作方式收斂成比較穩定、可驗證、可維護的流程。

這個 repo 主要提供幾種東西。第一類是直接影響日常互動的 commands、hooks、rules 和 contexts，讓 agent 在規劃、驗證、審查、除錯時走比較一致的路徑。第二類是共用 skills，像是 evidence-based coding、systematic debugging、security review、testing strategy 這些可重複使用的工作流。第三類是 vendored `workflow` runtime，goldband 會把它包成 `goldband-*` 的高階流程入口，讓 review、QA、investigation、ship 這些任務有固定操作面。

它想解決的問題很直接：減少 AI 幻覺、降低憑感覺改 code 的機率、讓規劃和驗證變成預設，而不是事後補救。對使用者來說，安裝 goldband 之後，你看到的不是一堆零散設定，而是一套比較完整的工作方式。

## Installation

一定要用 `git clone` 抓完整 repo：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。goldband 是 `repo-linked install`，啟動前自動更新也依賴 git metadata。

最常用的安裝方式是：

```bash
./install.sh pack-quality
./install.sh all-tools
./install.sh all-with-workflow
```

其中 `pack-quality` 適合只裝 Claude Code，`all-tools` 會一起裝 Claude Code 和 Codex，`all-with-workflow` 則會再加上內建 workflow。

如果你只想補裝特定項目，也可以直接跑：

```bash
./install.sh codex-full
./install.sh workflow
./install.sh workflow-codex
./install.sh launchers
./install.sh status
./install.sh uninstall
```

`hooks` 合併需要 `jq`。macOS 可用 `brew install jq`。

## Updates

手動更新方式很簡單：

```bash
cd /path/to/goldband
git pull --ff-only
./install.sh all-tools
```

如果你平常直接輸入 `claude` 或 `codex`，goldband 也會在啟動前做一次安全的 self-update 檢查。不過它只會在 repo 乾淨、branch 是 `main`、tracking `origin/main`，而且可以安全 `git pull --ff-only` 的情況下才自動 fast-forward；不符合條件時會直接跳過。

## Language

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

也可以直接改設定：

```bash
~/.codex/skills/workflow/bin/workflow-config get goldband_language
~/.codex/skills/workflow/bin/workflow-config set goldband_language zh-TW
~/.codex/skills/workflow/bin/workflow-config set goldband_language en
```

切換後如果目前 session 還沒吃到新設定，重開 Claude Code 或 Codex 一次即可。

## Common Entry Points

日常最常用的入口是 `/plan`、`/verify`、`/goldband-investigate`、`/goldband-review` 和 `/goldband-qa`。如果你要開高風險保護，可以用 `careful-mode`；如果你只想做唯讀調查，可以用 `freeze-mode`。

## workflow

goldband 內建 vendored `workflow` runtime，不需要另外保留外部 workflow repo。最常見的安裝方式是 `./install.sh workflow`、`./install.sh workflow-codex` 或 `./install.sh all-with-workflow`。

安裝後，Claude runtime 會在 `~/.claude/skills/workflow`，Codex runtime 會在 `~/.codex/skills/workflow`，共享 state 會在 `~/.workflow/`，對外入口則是 `goldband-*`。如果你要測試別的 runtime checkout，才需要用 `WORKFLOW_REPO_DIR=/path/to/runtime ./install.sh all-with-workflow` 覆寫來源。

## Troubleshooting

如果 Hook 沒有執行，先跑 `./install.sh hooks`，並確認 `jq` 已安裝。如果安裝看起來不完整，先用 `./install.sh status` 檢查。若 `/verify-config` 報錯，通常重跑 `./install.sh all-tools` 或 `./install.sh all-with-workflow` 就夠了。語言切換後如果說明沒變，重開 Claude Code 或 Codex 一次即可。若啟動時沒有自動更新，先確認這是用 `git clone` 抓下來的 repo，而且目前在 `main`、工作樹乾淨，並且 tracking `origin/main`。

## License

MIT License.
