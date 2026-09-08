# goldband

Claude Code 與 Codex 的本機工程配套，集中管理開發守則、工具設定與工作流程。

[English](README.en.md) | 中文

## 能做什麼

- 安裝共用開發守則、hooks 與 skills，減少每個專案重複設定。
- 管理 Claude Code／Codex 的本機設定，提供安裝狀態檢查與移除入口。
- 選裝 Goldband Loop，使用程式碼審查、問題調查、規劃、QA 等工作流程。

## 安裝前

- 準備 Git、Node.js，以及要使用的 Claude Code 或 Codex CLI。
- 使用 installer 安裝 Claude 設定另需 `jq`；Codex 設定檢查需要 Python **3.11 以上**。
- 使用完整 Git checkout；請勿只下載 `install.sh`。
- Goldband Loop 另需 Bun **1.3.11 以上**。瀏覽器工作流程需要 Playwright Chromium，安裝器會處理其安裝與驗證。
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

程式碼審查需要先為目標專案設定驗證契約；請從[審查入門](docs/review-evidence-manifest.md#quick-start)開始。需要本機隔離執行測試的正式審查目前僅支援 macOS；Linux／Windows 缺少這類證據時會回報未完成。測試或安裝成功也不代表審查、部署已完成。

## 更新與移除

在原本的 checkout 更新來源：

```bash
git pull --ff-only
```

接著依原本的安裝方式更新：

- **Installer**：重跑上表中原本使用的安裝指令，例如 Codex 使用者執行 `./install.sh codex-full`。
- **Claude plugin**：執行 `claude plugin update goldband@goldband`。

更新後執行 `./install.sh status`，再重新啟動工具。

移除時也依安裝方式擇一：

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
