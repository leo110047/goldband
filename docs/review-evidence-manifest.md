# Review evidence manifest authoring

`goldband.review-evidence.json` 是專案擁有的行為與驗證 contract。Goldband 在啟動 semantic review 前，會先用它決定哪些行為必須成立、哪些 deterministic checks 適用，以及目前 evidence 是否足以繼續。

Manifest 合法不代表測試已通過、review 已完成或可以部署。真正的 evidence 仍必須由同一個 candidate-bound runtime 執行並讀回。

## Automatic project lookup

日常審查直接執行 `goldband review code --host codex` 或 `--host claude`，
不需要 Agent 提供設定檔路徑。Goldband 以目前 Git common directory 識別專案，
自動讀取 `~/.goldband/review-contracts/<repository-hash>.json` 的登記內容。
若設定了 Goldband state root，registry 也使用該位置。沙箱改用暫存目錄存放
執行結果時，設定仍從原本的 durable registry 讀取。

`goldband review contract inspect` 是唯讀操作，不要求 state root 可寫；
即使尚未登記，也會回報預期的 registry 路徑。先檢查這個結果與實際權限錯誤，
不能只因專案根目錄沒有檔案就判斷未設定。

Goldband 本機的 authoring 檔統一放在
`~/.goldband/review-contracts/goldband/review-evidence.json`，修改後以 `import`
明確更新登記。舊的 loop 子目錄設定保留為同目錄的
`legacy-loop-review-evidence.json`；loop 與根目錄屬於同一 Git 專案，使用同一份
根目錄 contract。Repository 內的 `test/fixtures/review-contracts` 只供回歸測試。

既有 committed manifest 仍作為相容性 baseline。搬移期間只有已登記內容與
reviewed base 的 digest 完全相同，才允許 candidate 移除舊 manifest；
未登記、內容不同或登記無效仍會阻擋，避免搬移降低驗證要求。

## Quick start

先查看目前安裝所附的 guide、example 與 schema 路徑：

```bash
goldband review contract help
```

在 Git repository 任意 tracked subdirectory 執行：

```bash
goldband review contract init
```

`init` 會在 canonical repository root 建立 `goldband.review-evidence.json`。它使用 exclusive create，既有檔案不會被覆寫。產生的內容只有一格 high-risk `unsupported` behavior，因此格式合法但仍會阻擋 semantic review；這可避免 scaffold 被誤認成完整證據。

接著依專案真正的 contract 修改 behavior、provider、paths 與 command。可參考 [minimal local gate example](../examples/review-evidence/minimal-local-gate.json)，但必須把 TypeScript／npm 範例值換成該專案實際擁有的 check。

修改後只驗證 manifest，不執行 provider、不啟動 host，也不寫入 runtime store：

```bash
goldband review contract validate --manifest goldband.review-evidence.json
```

`validate` exit 0 只表示 installed runtime 接受這份 contract。輸出中的 `evidenceExecuted: false` 與 `completionAuthorized: false` 是刻意的，不是待補的成功訊號。

最後選擇 contract ownership：

- 專案共同擁有：將 repo-root `goldband.review-evidence.json` 納入 Git。Reviewed base 中的檔案是 authoritative baseline。
- 僅本機持有：repository 沒有 committed manifest 時，執行 `goldband review contract import --manifest <path>`，把完整 contract 註冊到 runtime-owned per-repository store。
- 單次 candidate extension：以 `review code --evidence-manifest <path>` 傳入完整 manifest；必要 coverage 與執行邊界不能縮小。檢查指令與行為描述的修正須經同一次獨立審查確認。

用下列命令讀回實際 resolution、tracking state、source 與 digest：

```bash
goldband review contract inspect
```

## 最小 local gate

受支援的 public example 宣告一格 TypeScript contract，並以 path-scoped `npm run typecheck` provider 覆蓋它：

```json
{
  "schemaVersion": 2,
  "behaviorMatrix": [
    {
      "id": "typescript-contracts",
      "behavior": "The project preserves its declared TypeScript contracts.",
      "kind": "boundary",
      "input": "a candidate that changes TypeScript source, tests, or project configuration",
      "preconditions": "dependencies are installed in the isolated candidate snapshot",
      "expected": "the project typecheck exits successfully",
      "risk": "high",
      "disposition": "static",
      "providerIds": ["typescript-typecheck"]
    }
  ],
  "providers": [
    {
      "id": "typescript-typecheck",
      "owner": "package.json#scripts.typecheck",
      "kind": "project-gate",
      "lifecycle": "persistent",
      "cellIds": ["typescript-contracts"],
      "applicability": {
        "kind": "paths",
        "pathPrefixes": ["src", "test", "package.json", "tsconfig.json"]
      },
      "executionContext": {
        "sandboxOwner": "review-runtime",
        "runner": "sealed"
      },
      "operations": [
        {
          "id": "candidate-typecheck",
          "target": "candidate",
          "argv": ["npm", "run", "typecheck"],
          "expectedExit": "zero",
          "timeoutMs": 120000,
          "maxOutputBytes": 65536,
          "network": "deny",
          "evidenceLevel": "local"
        }
      ]
    }
  ],
  "authorizations": []
}
```

這只是 contract 形狀範例，不是 universal preset。只有當專案真的由 `package.json#scripts.typecheck` 擁有該行為，而且 command 可在 isolated snapshot 執行時，這些值才成立。

## Top-level fields

| Field | Contract |
| --- | --- |
| `schemaVersion` | 必須是 `2`。Runtime 不會替安全欄位猜預設值。 |
| `behaviorMatrix` | 非空行為清單。每格描述一個必須被評估的 domain／engineering fact。 |
| `providers` | Typed deterministic evidence owners。可以是空陣列，但 high-risk uncovered behavior 會 fail closed。 |
| `authorizations` | 外部 network／credential／shared-environment operation 的 typed approvals。Local runner 本身仍是 network-deny。 |

Unknown fields 會被拒絕。Manifest 目前不接受 instance-level `$schema` property；編輯器若需要 JSON Schema association，請把 `goldband.review-evidence.json` filename 對應到 installed 或 repository 內的 `review-evidence-manifest.schema.json`。

## Behavior cells

每個 cell 必須有：

- `id`：manifest 內唯一且穩定的 ID。
- `behavior`：要成立的行為事實。
- `kind`：`normal`、`branch`、`exception` 或 `boundary`。
- `input`、`preconditions`、`expected`：可被 reviewer 與 evidence owner理解的 contract。
- `risk`：`low`、`medium` 或 `high`。
- `disposition`：如何處理這格 evidence。
- `providerIds`：能證明此 cell 的 provider IDs。

Disposition：

| Value | Meaning |
| --- | --- |
| `automated` | 由自動化 behavior／regression check 證明。 |
| `static` | 由 typecheck、lint、schema、generated drift 等 static/project gate 證明。 |
| `runtime-readback` | 需要 runtime integration readback。 |
| `manual` | 目前只有人工證據；必須有 `reason`，仍是 coverage gap。 |
| `not-applicable` | 對這個 contract 確定不適用；必須有可判定的 `reason`。不要用它跳過尚未設計的 checks。 |
| `unsupported` | 目前無法提供 evidence；必須有 `reason`。High-risk 時阻擋 semantic host。 |

`automated`、`static` 與 `runtime-readback` 至少需要一個 provider。Cell 的 `providerIds` 與 provider 的 `cellIds` 必須雙向一致；單邊宣告會被 runtime 拒絕。

## Providers

每個 provider 必須宣告：

- `id`：manifest 全域唯一 provider ID。
- `owner`：實際 contract owner，例如 `package.json#scripts.typecheck`。
- `kind`：`regression`、`static`、`project-gate`、`property-fuzz` 或 `runtime-integration`。
- `lifecycle`：`persistent` 或 `transition`。
- `cellIds`：由此 provider 證明的 cells，且需與 cell 端 reciprocal。
- `applicability`：哪些 candidate paths 使它適用。
- `executionContext`：誰擁有 sandbox 與 runner。
- `operations`：至少一個 typed argv operation。

### Lifecycle

Repository-owned manifest 只接受 `persistent` providers。Persistent operation 應對 successor candidate 保持有效，不能保存會過期的 base RED。

一次性 bugfix RED／GREEN 使用 `transition` provider，並以 `transitionBinding` 綁定 exact repository、base、candidate、scope 與 operation contract digest。Transition evidence 屬於當次 artifact，不應手寫進 repository manifest。

### Applicability

Path scope：

```json
{ "kind": "paths", "pathPrefixes": ["src", "test", "package.json"] }
```

至少要有一個 non-empty prefix。Prefix 必須是 normalized repo-root coordinate：不以 `/`、drive prefix 開頭或 `/` 結尾，不含 `.`／`..`／empty segments，不用 `\\`，也不在前後留空白。寫 `src`，不要寫 `./src`、`../src`、`C:/src` 或 invocation subdirectory 的相對座標。

Global scope：

```json
{ "kind": "global", "reason": "The repository-wide policy must hold for every candidate." }
```

Global provider 每次都適用，必須說明原因。不要為了省下 path design 把所有 gates 設成 global。

### Execution context

一般 local evidence 使用 runtime-owned sealed runner：

```json
{ "sandboxOwner": "review-runtime", "runner": "sealed" }
```

需要 provider-owned macOS Seatbelt lane 時：

```json
{
  "sandboxOwner": "provider",
  "runner": "host-seatbelt",
  "lane": "the-owned-lane-id"
}
```

如果正式 producer／consumer handoff 不存在，runtime 會回報 `runtime-incomplete`，不會把 nested sandbox failure 當成 candidate failure。

### Goldband 推送前的本機自測

Goldband 的三組 sandbox 自測在推送前使用固定本機 lane：

```json
{ "sandboxOwner": "provider", "runner": "local-host", "lane": "goldband-local-review-host" }
```

只接受 `review-evidence-tests`、`work-map-review-tests`、`installed-runtime-tests`
既有的完整測試指令。每組測試在這次未提交變更的獨立副本執行，使用暫時的
HOME 與 Goldband state，不繼承登入憑證或審查簽章設定；結果仍綁定專案、
base、candidate、scope、manifest、指令與依賴 digest，並由既有 receipt 簽署。

這些測試需要自行啟動 Seatbelt，故外層是原生本機程序，不再包另一層 sandbox。
它使用主機權限與可寫候選副本，operation 必須明寫 `network: host`，
不宣稱 OS network deny 或敵對程式隔離。一般 providers 仍走 sealed runner。
本機 lane 必須由已安裝的 Claude/Codex runtime 授權，無法以任意 argv 使用。
真正的測試失敗會阻擋審查；缺少必要工具、外層沙箱限制、逾時或副本遭修改則回報 runtime-incomplete。

專案 registry 可將三個固定 CI recipes 遷移到本機，僅允許上述 runner/network
變更與增加逾時上限；所有測試、cells 與其他驗證要求須完全保留。舊 receipt
仍透過 evidence-repair/closure 重新驗證，遷移本身不代表通過。
CI 繼續在 push 後執行，不再是 Goldband 本機審查的前置條件。

### 既有 CI 證據 adapter（非推送前預設）

Goldband 的 `review-evidence-tests`、`work-map-review-tests` 與
`installed-runtime-tests` 既有設定可使用固定 CI lane：

```json
{ "sandboxOwner": "provider", "runner": "github-actions", "lane": "goldband-macos-review-host" }
```

這不是通用 CI 設定介面。Shared runtime 的 `review-ci-evidence.ts` 擁有三組
provider／原始 argv 與受信任 workflow digest；Claude、Codex 的 installer
都將此 adapter 納入既有 runtime bundle，沒有新增 launcher、token 或上傳入口。

Consumer 只以唯讀 GitHub API 查詢公開的 `leo110047/goldband`：既有
`validate.yml`、`push dev`、同一 commit、最新 run 及精確 attempt 的三個獨立
step。它同時比對完整 materialized candidate 的 Git tree、本機 commit tree
與 GitHub 原生 commit tree，並在讀回 job 後重新核對 run attempt。
Workflow 必須符合已安裝 runtime 內的固定 digest；修改執行配方時必須一起
審查並更新該 digest，不能從 candidate 自行接受新的配方。

證據表示指定 commit 在受信任 macOS CI 的**可寫 checkout** 上執行指定測試
step 成功。它不宣稱唯讀 snapshot、命令 exit code、OS network deny 或完整
CI pipeline 成功。CI 可使用網路；operation 的 `network: deny` 不授權 consumer
替 candidate 執行外部操作，且不代表 CI 的網路隔離政策。Consumer 的平台
metadata 查詢由固定 adapter 擁有，不執行 candidate 的 argv 或接受手寫結果。

未提交的 candidate、缺少結果、API 失敗、step 失敗／跳過／timeout、配方不符
或重跑競態都會留下 `runtime-incomplete`。只有符合條件的成功結果可以標記
`verified-pass`；失敗的 step metadata 不足以宣稱原命令的 `verified-failure`。
因此尚未推送並跑完 CI 時，semantic host 仍會被 evidence completeness 擋住。

若已提交版本的 CI 尚在執行，請在完成後沿用相同 base／scope 與最新
`--closure-artifact` 重驗。當原紀錄尚未呼叫 semantic host、所有未解 finding
皆為 `runtime-incomplete`，且 candidate 與 behavior contract 未改變時，既有
`evidence-repair` 允許刷新相同版本的證據，不要求為此修改程式。Runtime 仍會
重新查證原 finding 對應的 providers；證據未完成時維持 blocker 與零 host calls，
必須使用該次產生的最新 artifact 繼續重驗。Receipt、lineage、candidate binding
及 freshness 檢查均保留。真正的 `verified-failure` 或已執行 semantic review
仍走原本需要修復 candidate 的流程。

既有三組 provider 可由舊 `macos-review-contract-host` 單向遷移到此固定 lane，
但不得改掉 operation、降低證據等級或移除 cell。舊 receipt／lineage／finding
保留，仍須透過原有 evidence-repair／closure 驗證 fresh evidence；契約遷移本身
不會關閉 finding。其他 providers 仍使用原本的 sealed 或 host-seatbelt runner。

## Operations

Operation 的主要欄位：

| Field | Contract |
| --- | --- |
| `id` | Provider 內唯一 operation ID；被 authorization 引用時，該 operation／authorization 配對在 manifest 內必須只解析到一組。 |
| `target` | `candidate`，或 transition regression provider 的 `base`。 |
| `argv` | 非空 argument array。第一項必須是由 `PATH` 解析的 command name，不能含 `/` 或 `\\`。 |
| `expectedExit` | `zero` 或 `nonzero`。後者必須提供 exact `expectedExitCode`。 |
| `timeoutMs` | `100` 至 `900000`。 |
| `maxOutputBytes` | `1` 至 `65536`。 |
| `network` | `deny` 或 `authorized`。 |
| `authorizationId` | `network: authorized` 時必填；deny 時禁止。 |
| `evidenceLevel` | `fixture`、`local`、`sandboxed-service`、`live-provider`、`device-platform` 或 `production-readback`。 |
| `requiredSystemTools` | 可選的 PATH tool names；不會因此放寬任意 filesystem access。 |
| `pythonRuntime` | Python gate 必填，非 Python operation 才可省略的 runtime contract；目前只接受 Python 3.14、`uv`、`pyproject.toml` 與 `uv.lock`。 |
| `seed`、`iterations` | `property-fuzz` operations 必填，用於 replay。 |

Script launcher 必須把 interpreter 寫進 argv，例如：

```json
{ "argv": ["bash", "scripts/check-contract.sh"] }
```

不要只寫 `scripts/check-contract.sh`。Runtime 會拒絕 path-shaped executable，避免 shebang／interpreter 與依賴邊界變成隱含 contract。

### Writable build caches

程式快照唯讀；`HOME`、`TMPDIR`、`TMP`、`TEMP` 是每個 operation 專屬的可寫暫存目錄。
TypeScript 啟用 `incremental` 時，`--noEmit` 仍會寫快取；請在原 compiler 指令加上
`--tsBuildInfoFile "$TMPDIR/typecheck.tsbuildinfo"`（須由 shell 展開，不同 project 使用不同檔名）。
`TS5033` 寫入權限失敗屬於 `runtime-incomplete`，不能充當 RED 通過或程式缺陷證據。

### Python 3.14 + uv runtime

直接 Python 指令（`python`、`python3`、`python3.14` 等數字版本，以及 `d`／`t`／`w`、`.exe` 變體，不分大小寫）缺少 `pythonRuntime` 時，validator 會在執行前拒絕。只有精確的 `python3.14` 指令與下列契約受支援；其他版本或變體必須改成受支援的宣告，不能只補欄位。

`requiredSystemTools` 的 Python interpreter 也會被拒絕：該入口只提供通用子工具投影，不能準備 Python environment。請把 Python gate 宣告為獨立 operation。工具不解析 shell 字串或猜測 project scripts；不要藉由 wrapper 取代必要的 Python runtime 宣告。

Python gate 必須明確宣告，不能猜測專案路徑或 lockfile：

```json
{
  "id": "python-project-gate",
  "target": "candidate",
  "argv": ["python3.14", "-c", "import app, sqlalchemy, pydantic"],
  "expectedExit": "zero",
  "timeoutMs": 120000,
  "maxOutputBytes": 8192,
  "network": "deny",
  "evidenceLevel": "local",
  "pythonRuntime": {
    "interpreter": "python3.14",
    "resolver": "uv",
    "projectFile": "pyproject.toml",
    "lockFile": "uv.lock"
  }
}
```

`projectFile` 與 `lockFile` 是 repo-relative normalized paths，必須位於同一個
project directory。`argv` 第一項必須和 declared interpreter 相同；目前不接受
其他 Python 版本、resolver 或 online mode。

Runtime 只從受信任的 macOS system／Homebrew package roots 選取 host
`python3.14` 與 `uv`，先 attestation，再在 Seatbelt 內執行 interpreter inspection
與 cache discovery；不會直接執行 caller `PATH` 的任意 shim。驗證 candidate
lockfiles 後，把 ambient uv cache clone 到 operation 專屬 writable root，以 `--frozen --offline
--no-install-project --no-editable --link-mode copy` 建立一次性 environment。執行
identity 綁定 interpreter、uv、兩個 contract files、materialized environment
與實際安裝到 `site-packages` 的 package name/version、`WHEEL`、`RECORD`、
installed tree，以及 candidate-local direct source digest。Registry package 另以
安裝後 `WHEEL` tag 唯一對應 lockfile 的 wheel filename/hash；無法唯一對應會 fail closed；
未被選用的 ambient cache entry 不作為 identity 或 failure condition。Project 自身不安裝進 environment；gate 從 materialized
candidate working directory import source。

Interpreter 的原生 stdlib modules（`lib-dynload/*.so`）也會沿用 Mach-O
dependency attestation，逐檔授權其 transitive dylibs 並綁定 execution identity。
這涵蓋 coverage 所需的 `_sqlite3`／SQLite 等依賴，不授權整個 Homebrew
package directory；native module 本身不得逃出已宣告的 stdlib。

在 project gate 前，runtime 會用 materialized interpreter 執行 isolated
bootstrap／stdlib preflight，並拒絕 source checkout 的 `.venv` 或 tool、跨
repository symlink、editable/local external install、未知的 `.pth`、`.egg-link`、
`sitecustomize`、`usercustomize` 與 ambient `PYTHONPATH`。缺 interpreter、`uv`、
lockfile、offline artifact，或 environment/bootstrap 完整性失敗，都會產生
typed `runtime-incomplete`，不執行 project gate，也不啟動 semantic host。只有
preflight 通過後，gate 的 declared exit mismatch 才是 fresh
`verified-failure`。

`.pth` 只支援已核對內容的 coverage conditional startup hook（coverage 7.15.4
的 `a1_coverage.pth`）：必須位於 environment 的 `site-packages` 根目錄、內容
符合 runtime 固定的 SHA-256，且唯一的 coverage distribution metadata 與
`RECORD` 必須吻合。檔案會保留，讓 coverage 的子程序收集功能正常運作；
這項內容檢查不取代既有的 lock/artifact identity 與 sandbox 邊界。變更過的
hook 仍會拒絕，不能只靠同名檔案或 package metadata 放行。uv 自帶且內容為
`import _virtualenv` 的 `_virtualenv.pth` 則沿用既有移除處理。

缺 offline wheel 時，在審查外依 candidate 的 `uv.lock` 備齊 macOS／Python 相容的
uv cache 後重跑；Linux container 已安裝的套件不能替代它，gate 仍維持 network deny。

## Network 與 authorizations

`live-provider`、`device-platform` 與 `production-readback` evidence 必須使用 `network: authorized` 與 matching `authorizationId`。Authorization 包含：

- `id`
- `operation`
- `scope`
- `approvedBy`
- `approvedAt`
- `expiresAt`

`expiresAt` 必須晚於 `approvedAt`。每個 `authorizationId` 必須找到同 ID、且 `operation` 相符的 authorization；每個 authorization 也必須被恰好一個 operation 引用。

一般 sealed review runner 仍是 deny-only；上述固定本機自測 lane 另以 `network: host` 明示主機執行。即使 manifest 與 authorization 格式合法，network operation 也需要 operation-specific external runner；缺少 runner 時會 fail closed。不要把 fixture 或 local green 結果描述成 live／device／production proof。

## Contract resolution

Runtime 在 evidence execution、lineage admission 與 semantic dispatch 前先解析：

```text
authoritative baseline + boundary-preserving candidate changes = effective contract
```

Resolution order：

1. Reviewed base 的 repo-root manifest。
2. Base 沒有 manifest 時，明確 import 的 runtime-owned per-repository contract。
3. 都沒有時 fail closed。

Working-tree、index 與 `--evidence-manifest` 內容是 candidate-controlled extension。
Runtime 直接阻擋刪除必要 cell／provider／operation、縮小 applicability、降低風險或
evidence level，以及改變既有 target、expected exit 或執行權限。

`argv` 與行為描述不再以字串完全相同作為安全證明。Runtime 會將既有與修正後的內容
完整交給同一次 semantic review，要求明確的 `contractReview` 判斷。審查須確認原本
驗收目的仍被涵蓋，包括正常案例能通過、錯誤案例仍被拒絕；新指令跑綠本身不足以證明。
缺少判斷會明確失敗；審查不接受時，初審保留 blocking finding，closure 保留未結案狀態。
`inspect` 的 `candidateCompatibility.valid` 只代表結構邊界合法，
`requiresSemanticReview` 會指出仍待審查的指令／描述修正。

修正前的命令、digest 與問題紀錄仍保留。不同命令不宣稱是相同命令重跑；只有經審查
接受的修正、相同操作識別與執行座標、以及 fresh passing evidence 才能結案。
未執行審查或尚未接受的修正，不會提前覆蓋 lineage 中的既有標準。

Semantic finding 的驗證關聯由同一個 runtime resolver 處理：優先保留明確的 cell／evidence
關聯；舊紀錄未提供時，依 finding 的檔案與 project-declared provider applicability 選擇。
不會因 severity 高就綁定所有測試，也不會替 deterministic failure 猜關聯。
找不到宣告的涵蓋範圍時仍是 evidence-incomplete；無關測試通過不能結案。

## Platform boundary

- macOS：sealed executable evidence 由 Seatbelt owner 執行；evidence complete 後才能啟動 semantic review。
- Linux／Windows：目前沒有等價的 sealed evidence runner。需要 executable evidence 時回報 typed `runtime-incomplete`，不啟動 semantic host，也沒有 completion／closure authority。

Bubblewrap managed worktree boundary 不是 `review/code` evidence parity。

## Schema 與 runtime authority

JSON Schema 協助 editor 與 local structural validation，能描述 enums、required fields、局部 conditional rules與 unknown-field rejection。

以下規則需要 runtime graph／candidate context，因此 runtime validator 才是最終 authority：

- provider／cell reciprocal ownership；
- unknown provider／cell references；
- operation ID 與 authorization cross-reference；
- persistent RED 與 transition binding lifecycle；
- authoritative baseline monotonicity；
- exact repository／base／candidate／scope binding；
- authorization freshness與 external runner availability。

因此不要以「JSON Schema 通過」替代 `goldband review contract validate`，也不要以 `validate` 通過替代真正的 candidate-bound evidence run。

## 常見錯誤

### `review/code evidence contract is required`

Repository 沒有 committed baseline，也沒有 runtime-store baseline。先執行 `review contract init` 並完成 project-owned contract，或 validate 後明確 import 外部 manifest。

### `disposition ... requires a reason`

`manual`、`not-applicable` 與 `unsupported` 必須說明原因。若其實已有自動化 owner，改成相符 disposition 並宣告 provider。

### `must authorize each other`

Cell 的 `providerIds` 與 provider 的 `cellIds` 不一致。兩邊都必須引用對方。

### `persistent ... stale-prone`

Persistent provider 含 base RED。把一次性 RED／GREEN 移到 exact-bound transition artifact，或改成 successor-safe candidate check。

### `requires typed authorization`

Network operation 缺少 matching authorization。補上格式不代表 local runner會連網；仍需正式 external runner。

### `runtime-incomplete`

Manifest 合法，但目前 platform、sandbox、tool、dependency 或 provider lane 無法完成 evidence。不要改成 `not-applicable` 或降低 risk 來消除訊號。
