# goldband

Claude Code 與 Codex 的本機工程配套，集中管理開發守則、工具設定與工作流程。

[English](README.en.md) | 中文

## 能做什麼

- 安裝共用開發守則、hooks 與 skills，減少每個專案重複設定。
- 管理 Claude Code／Codex 的本機設定，提供安裝狀態檢查與移除入口。
- 選裝 Goldband Loop，使用程式碼審查、問題調查、規劃、QA 等工作流程。

Claude 與 Codex 的 hook 分工與刻意保留的差異見[hook 分工](ARCHITECTURE.md#shared-hook-policy-and-host-adapters)。Review 啟動失敗時，hook 提示讀取已安裝的啟動契約；環境證據未完成時提示查看該次報告，不自動重跑。

## 安裝前

- 準備 Git、Node.js，以及要使用的 Claude Code 或 Codex CLI。
- 使用 installer 安裝 Claude 設定另需 `jq`；Codex 設定安裝與檢查需要 Python **3.11 以上**。
- 使用完整 Git checkout；請勿只下載 `install.sh`。
- Goldband Loop 另需 Bun **1.3.11 以上**。`make-pdf` 需要 Playwright Chromium，安裝器會處理其安裝與驗證。瀏覽器 QA 使用 Claude Code／Codex 自己的瀏覽器工具；`all-with-workflow` 會替兩邊設定 Playwright MCP，已有設定則保留，可用 `GOLDBAND_SKIP_PLAYWRIGHT_MCP=1` 跳過（見 [mcp/README.md](mcp/README.md)）。
- macOS／Linux 使用 Bash；Windows 請用 Git Bash 或 WSL，沒有原生 PowerShell 安裝器。各工作流程的平台限制見下方說明。

Installer 會修改家目錄內的工具設定、hooks 與 skills。Claude plugin 與 installer 的 Claude 核心設定請擇一安裝，避免重複載入。

## 安裝

先取得專案：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

依需求選一種方式：

| 需求 | 安裝方式 |
| --- | --- |
| Claude Code 核心守則 | 下方 Claude plugin 指令 |
| Codex 完整設定 | `./install.sh codex-full` |
| Claude Code 與 Codex 完整設定 | `./install.sh all-tools` |
| 兩個工具與 Goldband Loop 工作流程 | `./install.sh all-with-workflow` |

Claude plugin 安裝指令：

```bash
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
```

Claude plugin 不含 Goldband Loop。只想替單一工具加裝工作流程，或需要 Codex portable plugin、Claude Desktop／web／mobile 整合，請看[其他安裝選項](OPERATIONS.md#additional-install-options)。

安裝後檢查狀態，並重新啟動 Claude Code／Codex：

```bash
./install.sh status
```

所選組件應顯示 `[OK]`；若顯示過時、損壞或重複安裝，先依輸出指引處理。

## 第一次使用工作流程

安裝 Goldband Loop 後，可先檢查本機安裝狀態。在對應工具的對話中輸入：

```text
Claude Code: /goldband system health
Codex:       $goldband system health
```

其他用途與指令見[工作流程清單](docs/generated/capabilities.md)。

涉及大量處理、資料實體化、快取、平行執行或效能改善宣稱的實作，套用共用 `performance-optimization` skill。它不自動量測 CPU／RAM，也不要求每次修改都跑 benchmark。

`review/code` 預設對目前 worktree 執行一次獨立語意審查。reviewer 會讀取 diff、相關程式與規則，並回報具體觸發條件、影響和建議驗證方式；不執行專案測試，也不授權結案或變更工作票狀態。

Claude 使用 `/goldband review code`，Codex 使用 `$goldband review code`。可用 `--base <ref>`、`--staged` 或 `--diff-file <file>` 指定範圍。修正後以相同入口重新審查；每次都檢查目前範圍。

專案原有的 test、lint、typecheck、CI 及需要的實際環境驗證仍須照常執行。報告中的「無 findings」不代表這些驗證已通過。

## 更新與移除

在原本的 checkout 更新來源：

```bash
git pull --ff-only
```

接著依原本的安裝方式更新：

- **Installer**：重跑上表中原本使用的安裝指令；已安裝 Goldband Loop 時，同時重跑原本的工作流程安裝指令以更新其 runtime 副本。
- **Claude plugin**：執行 `claude plugin update goldband@goldband`。

更新後執行 `./install.sh status`，再重新啟動工具。

Codex 只在 `~/.codex/config.toml` 不存在時建立預設值。重裝與更新保留既有檔案的值、刪除的 key、註解與換行，不會自動套用後續範本變更。Claude 保留模型、權限模式、自訂 hooks 與狀態列。Config 無效或缺少 Python 3.11+ 時，`codex-core`／`codex-full` 仍處理其他元件，最後回傳非零並將背景更新記為 partial。

`shell_environment_policy` 是建議預設，不是強制政策；與範本不同時，`status` 會提示人工檢查，不會覆寫。`codex-requirements` 必須另外安裝，只強制其列出的欄位，不涵蓋環境變數排除清單。Goldband hooks、專用 `goldband.rules` 與 named profiles 仍獨立更新；個人規則放在 `default.rules`。

兩邊的 Goldband 狀態列皆為選配。以下指令會取代目前樣式；一般安裝與背景更新不會重設狀態列：

```bash
./install.sh claude-statusline
./install.sh codex-statusline
```

顯式套用 Codex 狀態列只變更 `tui.status_line` 的值，不會加入其他預設，但可能重新排版 TOML 並移除註解。兩邊修改個人設定前保留最近兩份原檔：`.bak` 與 `.bak.previous`；無變更不輪替，舊版留下的其他備份不自動刪除。

卸載會保留 Codex 主設定、個人規則、Claude 自訂 hooks 與非 Goldband 狀態列；可辨識的 Goldband 連結／副本才移除，已修改或未知檔案保留。若 Claude 設定無法解析或缺少 `jq`，保留其設定與引用的 Claude 檔案，仍卸載獨立的 Codex 元件，最後回傳非零。依安裝方式擇一：

```bash
./install.sh uninstall                       # 移除 installer 管理的組件
claude plugin uninstall goldband@goldband    # 移除 Claude plugin
```

## 文件與協助

- [操作與疑難排解](OPERATIONS.md)：其他安裝選項、managed worktree、MCP 與維運。
- [Goldband Loop](goldband-loop/README.md)：工作流程的設定與使用。
- [開發與貢獻](CONTRIBUTING.md)：開發環境、測試與套件更新流程。
- [架構說明](ARCHITECTURE.md)：元件分工與隔離、驗證機制。
- [回報問題](https://github.com/leo110047/goldband/issues)：請附使用平台、安裝方式及相關錯誤輸出，移除金鑰等敏感資訊。

## 授權

[MIT License](LICENSE)。
