# goldband

> Shared engineering guardrails for Claude Code and Codex.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

goldband 是給 Claude Code 和 Codex 用的共用 guardrails。

## 1. 安裝

### 先 clone

先用 `git clone` 抓完整 repo：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。

goldband 是 `repo-linked install`。

啟動前自動更新也依賴 git metadata，所以一定要保留完整 clone。

### 常用安裝

最常用的安裝方式：

```bash
./install.sh pack-quality
./install.sh all-tools
./install.sh all-with-workflow
```

這三個分別是：

1. `pack-quality`
Claude Code 日常推薦。

2. `all-tools`
Claude Code + Codex。

3. `all-with-workflow`
Claude Code + Codex + 內建 workflow。

### 補裝單項

如果你只想補裝特定部分：

```bash
./install.sh codex-full
./install.sh workflow
./install.sh workflow-codex
./install.sh launchers
./install.sh status
./install.sh uninstall
```

`hooks` 合併需要 `jq`。

macOS 可用 `brew install jq`。

## 2. 更新

### 手動更新

正常更新方式：

```bash
cd /path/to/goldband
git pull --ff-only
./install.sh all-tools
```

### 啟動前自動更新

如果你平常直接輸入 `claude` 或 `codex`，goldband 也會在啟動前先檢查能不能安全更新。

只有在下列條件成立時，才會自動 fast-forward：

- repo 是乾淨工作樹
- branch 是 `main`
- tracking `origin/main`
- 可安全 `git pull --ff-only`

不符合條件時會直接跳過，不會卡住啟動。

## 3. 語言

支援：

- `zh-TW`
- `en`

預設是 `zh-TW`。

### Claude Code

在 Claude Code 裡最簡單的方式是：

```text
/goldband-language
```

它會先問你要切哪個語言。

如果你已經知道目標，也可以直接指定：

```text
/goldband-language zh-TW
/goldband-language en
```

### 直接設定

也可以直接改設定：

```bash
~/.codex/skills/workflow/bin/workflow-config get goldband_language
~/.codex/skills/workflow/bin/workflow-config set goldband_language zh-TW
~/.codex/skills/workflow/bin/workflow-config set goldband_language en
```

切換後如果目前 session 還沒吃到新設定，重開 Claude Code / Codex 一次即可。

## 4. 常用入口

日常最常用的是：

- `/plan`
- `/verify`
- `/goldband-investigate`
- `/goldband-review`
- `/goldband-qa`
- `careful-mode`
- `freeze-mode`

如果你有裝 workflow，日常高階流程直接用 `goldband-*` wrappers 就好。

## 5. FAQ

### workflow 是什麼？

goldband 內建 vendored `workflow` runtime，不需要另外保留外部 workflow repo。

常見安裝：

```bash
./install.sh workflow
./install.sh workflow-codex
./install.sh all-with-workflow
```

安裝後的 canonical surfaces：

- Claude runtime: `~/.claude/skills/workflow`
- Codex runtime: `~/.codex/skills/workflow`
- Shared state: `~/.workflow/`
- 對外入口: `goldband-*`

如果你要測試別的 runtime checkout，才需要覆寫：

```bash
WORKFLOW_REPO_DIR=/path/to/runtime ./install.sh all-with-workflow
```

### Unity 專案怎麼裝？

```bash
cd /path/to/your-unity-project
/path/to/goldband/install.sh unity
```

### 出問題怎麼查？

#### Hook 沒有執行

跑 `./install.sh hooks`，並確認 `jq` 已安裝。

#### 安裝看起來不完整

跑 `./install.sh status`。

#### `/verify-config` 報錯

重跑 `./install.sh all-tools` 或 `./install.sh all-with-workflow`。

#### 語言切換後說明沒變

重開 Claude Code / Codex。

#### 啟動時沒有自動更新

確認這是 `git clone` 的 repo，且 repo 在 `main`、乾淨、tracking `origin/main`。

## License

MIT License.
