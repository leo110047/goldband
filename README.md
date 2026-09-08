# goldband

> Claude Code / Codex 的本機工程守則、安裝器與 workflow runtime 配套。

[English](README.en.md) | 中文（目前主入口）

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 這是什麼

goldband 是給 Claude Code 和 Codex 用的本機工程配套。它把 shared policy、
hooks、rules、commands、portable skills、Codex config，以及可選的
Goldband Loop workflow runtime 裝到同一個 checkout 管理。

這個 repo 分兩層：

- root `goldband`：安裝器、Claude/Codex adapters、shared policy、hooks、
  rules、commands、portable skills、plugin/app distribution。
- `goldband-loop/`：first-party workflow runtime，提供 review、investigate、
  QA、browser、planning 等公開 capability actions；未完成的高風險能力另列為
  hidden experimental inventory。

更細的 ownership 和 runtime contract 看 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 安裝路徑

| 需求 | 建議路徑 |
| --- | --- |
| Claude Code core guardrails | Claude plugin：`goldband@goldband` |
| Codex full setup | `./install.sh codex-full` |
| Claude Code + Codex | `./install.sh all-tools` |
| Claude Code + Codex + Goldband Loop | `./install.sh all-with-workflow` |
| Codex portable plugin subset | repo marketplace：`.agents/plugins/marketplace.json` |
| Claude Desktop app subset | `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb` |
| Claude web/mobile app subset | `app-adapters/claude-remote/goldband-connector.template.json` |

Claude plugin 是 Claude Code core guardrails 的主路徑；它不包含
Goldband Loop、Playwright/browser/iOS tooling、或 Codex full setup。需要
workflow runtime 時，使用 installer。

## Quickstart

Claude Code plugin：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
./install.sh status
```

Codex 或雙工具安裝：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
./install.sh all-tools
./install.sh status
```

需要 Goldband Loop workflow runtime：

```bash
./install.sh all-with-workflow
```

Windows 不維護 native PowerShell installer。請用 Git Bash 或 WSL 從完整
git checkout 執行同一組 POSIX 指令。

## 常用命令

```bash
./install.sh status            # 檢查安裝狀態
./install.sh pack-quality      # Claude Code core quality pack，不含 workflow runtime
./install.sh codex-full        # Codex full setup
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + Goldband Loop
./install.sh uninstall         # 移除 installer-managed assets
```

Plugin 移除：

```bash
claude plugin uninstall goldband@goldband
```

更新：

```bash
git pull --ff-only
./install.sh status
```

更新後重跑原本的安裝組合，例如 `pack-quality`、`all-tools` 或
`all-with-workflow`。

## 重要邊界

- 請使用完整 git checkout；不要只複製 `install.sh`。
- Claude plugin、Codex plugin、Claude app adapters、installer full setup 是不同
  distribution surface，不要互相宣稱替代。
- `./install.sh status` 會 read back 安裝狀態；若 plugin 和 installer-managed
  Claude assets 同時存在，它會回報 duplicate asset。
- Workflow status 會分開驗證 installer-owned source-input digest、trusted
  runtime artifact manifest 與 bounded dispatch probe；source 已更新、installed
  bytes/inventory 被修改，或 launcher 行為不符宣告時都會非零失敗並要求重裝。
- hooks、rules、cross-review gate、sandbox 是防誤操作與 evidence gate，不是
  抵抗同權限 host 使用者的安全邊界。managed worktree 是較窄的例外：它用
  OS sandbox 限制 agent process 的 Git metadata 寫入；host 使用者仍可在
  sandbox 外管理與完成工作。
- `all-with-workflow` 會安裝並驗證 Goldband Loop browser runtime；離線或 CI
  可用 `GOLDBAND_SKIP_PLAYWRIGHT=1` 明確跳過 browser workflows。

## Workflow 入口

安裝 Goldband Loop 後：

- Claude Code：`/goldband <capability> <action>`
- Codex：`$goldband <capability> <action>`

目前支援的 capability/action 清單以
[docs/generated/capabilities.md](docs/generated/capabilities.md) 為準。

### `review/code` 平台邊界

第一次在其他專案建立 evidence contract 時，先執行
`goldband review contract help` 找到 installed guide、public example 與 JSON
Schema。`review contract init` 會在 canonical repo root 建立不覆寫既有檔案的
fail-closed scaffold；完成 project-owned behavior/provider 後，以
`review contract validate --manifest <path>` 呼叫正式 runtime validator。Validate
不執行 evidence、不寫入 contract store，也不代表 review 或 deploy 已完成。完整欄位與
安全邊界見 [manifest authoring guide](docs/review-evidence-manifest.md)。

| 平台 | Goldband Loop 安裝 | executable sealed evidence | `review/code` 結果 |
| --- | --- | --- | --- |
| macOS | 支援 | 由 Seatbelt 執行 | evidence complete 後才可啟動 semantic review |
| Linux | 支援其他 workflow 能力 | **不支援** | typed `runtime-incomplete`；不啟動 semantic review，也沒有 completion/closure authority |
| Windows | Git Bash/WSL 可安裝部分能力 | **不支援** | 與 Linux 相同，fail closed |

Linux 的 Bubblewrap 目前只負責 managed worktree boundary，**不是**
`review/code` 的 sealed evidence runner，也不代表 review parity。若 effective
contract 需要執行 executable evidence，請在受支援的 macOS Seatbelt host 執行。

`review/code` 會先解析不可降級的 evidence contract。Repo 內的
review 以 canonical Git repo root 作為 diff、snapshot、scope 與 contract 的
共同座標；從 tracked subdirectory 啟動只會留下 execution offset，不會改變
baseline。reviewed base 的 repo-root `goldband.review-evidence.json` 是
authoritative baseline；base 沒有 manifest 時，才會使用使用者明確以
`goldband review contract import --manifest <path>` 註冊的 runtime-owned
per-repository contract。working-tree、index 或 caller 傳入的 manifest 都只能是
完整、monotonic 的 candidate extension，不能取代或縮小 baseline。`inspect`
可讀回 repo root、invocation offset、base/candidate tracking state、sources 與
digests；`remove` 只移除 central entry。manifest contract 使用 `schemaVersion:
2`。唯一的 v1 過渡路徑是已提交的 v1 base 搭配 v2 candidate，而且該 base
必須在只改版本號後就能通過完整 v2 驗證；其他 v1 輸入會 fail closed 並回報
migration 指引，不會猜測安全欄位的預設值。

Goldband 自身三組需要建立 Seatbelt 邊界的自測，改由既有 `push dev` macOS CI
執行，審查讀回相同 commit／tree 的指定 step 結果。未提交或尚無 CI 證據時仍
回報未完成；不在外層隔離內重跑這三組自測，也不把 CI 當成本機 sealed evidence。
Claude 與 Codex 共用此 runtime adapter，須經各自既有 installer 更新後才生效。
詳見 [CI 證據契約](docs/review-evidence-manifest.md#goldband-自身的-macos-ci-自測)。

解析完成後，runtime 在隔離、
預設以每個 operation 各自獨立、唯讀且 read/write/network default-deny 的 snapshot 執行 typed checks，
並驗證執行前後 tree digest、provider/cell 雙向 ownership 與 exact RED exit，確認 evidence completeness 與
candidate provenance 後，才啟動一次 semantic review。script launcher 必須在 manifest 明確寫出 interpreter；
repository-owned manifest 只接受 `persistent` provider；一次性的 RED/GREEN
`transition` evidence 必須綁定 exact repository、base、candidate、scope 與
operation contract digest，且只存在當次 artifact。Provider applicability 必須
明確選擇非空 path prefixes 或附理由的 `global`，execution context 也必須宣告
sandbox owner 與 runner；path applicability 會同時縮小 provider 與 effective
behavior cells，無關的 high-risk cells 不會被誤算成 coverage gap。明確傳入的
transition manifest 與 persisted review artifact 都會用當前 candidate binding
走 production validator。需要 provider-owned Seatbelt 的 operation 在 sealed
review runner 會先產生 typed `runtime-incomplete`，不會把 nested sandbox exit
誤報成 candidate failure，也不具 completion/closure authority。
macOS sandbox 會載入 Apple 的 common system process baseline，並精確重新封鎖 baseline 的 syslog、Mach service、
shared-memory、network 與 system socket 通道。含非系統 dylib 的 Mach-O runtime 會先複製到私有 sealed projection，
將已驗證的 load commands 改寫到 projection、ad-hoc sign 並重新雜湊最終 bytes；operation 不能讀原始 host package tree，
也不能修改 projection。明確宣告 `pythonRuntime` 的 operation 另支援 Python 3.14 + `uv`：runtime 會在 operation
專屬目錄以 frozen/offline lockfile 建立 candidate-bound environment，先完成 interpreter、stdlib、path 與
dependency integrity preflight；準備失敗是 typed `runtime-incomplete` 且不啟動 semantic host，preflight 後的 gate
exit mismatch 才是 `verified-failure`。Python／uv 只從 bounded system／Homebrew roots 選取並在 Seatbelt
內檢查；registry package 會以安裝後的 `WHEEL` tag 唯一選出 lock 內實際使用的 wheel filename/hash，無法唯一對應就 fail closed，未使用 cache entry 不影響 identity。除此之外只允許 candidate 與必要 dependency roots，
不會因此允許任意 HOME、其他 workspace 或 `/tmp` 內容。初審有 findings 且
候選內容修正後，可用 `--closure-artifact <initial-artifact>` 做一次只看 repair
delta、原 finding IDs 與 rerun evidence 的 closure；修正版 manifest 新增或修改的
affected cells 也會重跑，且沒有 fresh passing evidence 就不能標成 `closed`。初審無
findings 時不會啟動 closure；closure 也必須讀回 installed runtime authority 簽發的 receipt，caller
只靠修改 JSON、跨 Work Map scope 或重播舊 claim attempt 都會 fail closed。這個邊界把 reviewed
candidate、model output 與 artifact input 視為不可信，但信任同一 OS account 下的 Goldband installer/runtime；
若同一 host user 已惡意控制 authority store，需另加 privileged helper 或 OS-backed key 才能隔離。
Closure receipt 採 at-most-once：repair binding 與 Work Map 因果鏈驗證完成後會以 atomic claim 消耗；
claim 後若 process crash 或後續失敗，必須重新做 initial review，不能重播同一 receipt。
若 authoritative artifact 的 `hostCallCount=0` 且只有 deterministic findings，同一
`--closure-artifact` 入口會明確路由成 pre-semantic evidence repair，而不是 semantic closure。
它保留原 lineage、receipt、finding IDs 與 contract authority，只重跑受修復或 monotonic strengthening
影響的 typed cells；evidence 仍不完整時維持零 host calls 與未關閉 blockers，通過後才執行該
lineage 唯一一次 initial semantic review。新 artifact 會讀得出 predecessor digests 與 affected cells。
被 secret redaction 隱藏的 untracked 檔仍會以 digest 綁定並經非 prompt 通道放入 executable snapshot。Fixture/local/live/device/production evidence 會分開標示，green gate 不會
被解讀成整體 deploy readiness。

跨次 review 由 installed runtime 的 signed acceptance lineage 管理。新
manifest 只能增加 coverage，不能刪除、反轉或降低既有 required cells；`manual`／`unsupported`
可以 strengthening 成有 typed provider 的 disposition，反向或不同 evidence 模式間的替換仍會被拒絕。
有未關閉 finding 時，只能依 artifact state 走 evidence repair 或 scoped closure。空的 initial candidate 會在建立 lineage 前被拒絕；
standalone lineage 會綁定正規化 changed-file scope，舊 signed record 也只有在
authoritative artifact 證明 scope 相同時才會遷移；若 artifact 無法驗證，signed
candidate digest 完全相同仍會保留 blocker，但不會讓無關候選繼承不可判定的 broad scope。
同一 collection scope 下，只要新 initial candidate 與未關閉 changed-file scope 有重疊，
包含新增或移除修復檔，都必須走 closure；排序後的 per-path authority locks 讓 overlap
scan 到 finalize 保持原子性，而完全 disjoint 的 scope 仍可獨立執行。
專案可在 base commit 提交 typed
`goldband.review-policy.json`，設定 minimum evidence level 或有歸責、期限的
waiver；model prose 與 candidate 臨時檔沒有 waiver 權限。`No new findings`
也不等於完成，report 會分開列出 contract completeness、prior blockers、closure
與 completion authority。

平行 agent worktree 使用兩個 user-triggered 指令：

```bash
goldband worktree create task-name
# managed shell 內擇一啟動；外層 Goldband sandbox 仍是 hard boundary
claude --settings '{"sandbox":{"enabled":false}}'
codex --sandbox danger-full-access
# 完成後 exit
goldband worktree finish task-name -m "feat: integrate task"
```

`create` 只接受乾淨、位於正常 branch 的 source worktree，並建立 detached
worktree；不建立 task branch。managed shell 內工作檔可寫，但 Git index、
objects、refs、broker runtime 與 Git config/hook inputs 由 OS sandbox 保持唯讀。
`finish` 必須在退出 managed shell 後執行；broker 使用固定 Git executable、隔離
config environment 與 create 時記錄的 source-owned hook contract，且 source 的
ignored content 若與 candidate tree 衝突就停止。只有驗證、整合與 durable commit
都成功才會移除 worktree。macOS 使用 Seatbelt、Linux 使用 bubblewrap；boundary
不可用時會 fail closed。Windows 目前不宣稱有 hard enforcement。agent 的內建 OS
sandbox 必須依上例停用，避免 macOS 不支援的 nested sandbox；一般 permission
prompts 與 Goldband hooks 不會因此停用，Git 寫入權仍由外層 managed boundary
封鎖。

## 開發

Repo root 的預設聚合測試入口是：

```bash
npm run bootstrap:test # 首次 clone、更新 lockfile 或 installer migration 後執行
npm test
# or
bun run test
```

`bootstrap:test` 會安裝 root、`mcp/server` 與 `goldband-loop` 各自宣告的
dependencies，並只清除舊 installer 留在 ignored host skill roots 下的
generated entries；ownership 必須由 tracked retired inventory 或 managed marker
證明，同前綴的未知 skill 會保留。`npm test` 本身不會連網或偷偷修改 checkout；
它會先檢查 dependencies、Bun minimum 與 legacy artifacts，再跑一組明確列出的
package-owned suites，最後輸出 per-suite summary。查看清單：

```bash
npm run test:repo:list
```

不要把 repo root 裸跑 `bun test` 當作 repo 驗證；那會繞過子專案自己的測試
合約，改成讓 Bun 遞迴掃檔，輸出也沒有 per-package summary。

常用 targeted gates：

```bash
npm run test:plugin-distribution
npm run test:app-support
npm run test:hook-router
npm run test:cross-review
npm run lint:style
```

改到會餵進 Claude plugin 的來源後：

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

改到 Codex plugin 或 Claude app adapter 來源後：

```bash
npm run sync:app-support
npm run test:app-support
```

更多貢獻流程看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文件地圖

- [ARCHITECTURE.md](ARCHITECTURE.md)：root goldband、Claude/Codex surfaces、
  Goldband Loop 的 ownership 和 runtime contract。
- [OPERATIONS.md](OPERATIONS.md)：安裝維運、Codex overlay、style gate、MCP、
  telemetry。
- [CONTRIBUTING.md](CONTRIBUTING.md)：開發流程與 plugin distribution checks。
- [docs/generated/capabilities.md](docs/generated/capabilities.md)：Goldband Loop
  capability/action catalog。
- [goldband-loop/README.md](goldband-loop/README.md)：workflow runtime 入口。
- [mcp/README.md](mcp/README.md)：MCP templates 和 first-party
  `goldband-mcp`。
- [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md)：container sandbox 的保護
  範圍與不保護項目。
- [docs/knowledge-system.md](docs/knowledge-system.md)：local knowledge layer。
- [docs/DECISIONS.md](docs/DECISIONS.md)：重要決策紀錄。

## License

MIT License.
