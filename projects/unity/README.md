# Unity Project Skills

Unity 遊戲開發專案專用的 Claude Code skills，涵蓋多平台開發、性能優化、架構設計等。

## 📦 包含的 Skills

### 1. **unity-best-practices** (核心)
資深 Unity 工程師的最佳實踐和代碼規範

**涵蓋**:
- MonoBehaviour 設計原則
- ScriptableObject 數據驅動
- Component-based 架構
- Unity C# 編碼標準
- Prefab Workflow
- 性能最佳實踐（緩存、對象池等）

**使用時機**: 編寫任何 Unity 代碼時

### 2. **unity-multiplatform**
多平台開發指南（iOS/Android/WebGL/PC）

**涵蓋**:
- 條件編譯指令
- 輸入系統（觸控/鍵鼠/手柄）
- 平台特定優化
- Build Configuration
- 平台特定功能（權限、通知等）

**使用時機**: 開發跨平台遊戲時

### 3. **unity-performance** (進行中)
Unity 性能優化專項

**涵蓋**:
- Profiler 使用
- GC 優化
- 渲染優化
- 物理優化
- 腳本優化

**使用時機**: 遊戲性能出現問題時

### 4. **unity-architecture**
Unity 專案架構模式

**涵蓋**:
- MVC/MVP/MVVM
- ECS (Entity Component System)
- Service Locator
- Event System
- Dependency Injection

**使用時機**: 設計大型 Unity 專案架構時

### 5. **unity-app-store-deployment**
Google Play 和 iOS App Store 雙平台上架完整指南

**涵蓋**:
- **Android**: AAB 200MB 限制、Play Asset Delivery、Keystore 簽名、Google Play Console
- **iOS**: IPA 優化、On-Demand Resources、Provisioning Profile、App Store Connect、TestFlight
- **雙平台通用**: 資產優化策略、隱私政策合規、審核注意事項、GDPR/ATT

**使用時機**: 準備上架 Google Play 或 App Store、處理包體過大、審核被拒、隱私合規

## 🚀 安裝方式

### 方法 1: 複製到專案 (推薦)

```bash
cd /path/to/your-unity-project
mkdir -p .claude
cp -r /path/to/claude-code-skills/projects/unity .claude/skills
```

### 方法 2: 符號連結

```bash
cd /path/to/your-unity-project
mkdir -p .claude
ln -s /path/to/claude-code-skills/projects/unity .claude/skills
```

## 🎯 使用場景

### 場景 1: 編寫新的 Unity 組件

```
你: "幫我寫一個敵人 AI 組件"

自動觸發: unity-best-practices

會做什麼:
  - 使用單一職責原則
  - 正確使用 SerializeField
  - 緩存 Component references
  - 使用 Interface-based design
  - 遵循 Unity C# 命名規範
```

### 場景 2: 處理多平台輸入

```
你: "如何處理觸控和鍵鼠輸入？"

自動觸發: unity-multiplatform

會做什麼:
  - 建議使用 New Input System
  - 提供統一的輸入抽象層
  - 處理平台特定輸入差異
  - 使用條件編譯
```

### 場景 3: 性能優化

```
你: "遊戲 FPS 很低，幫我優化"

自動觸發: unity-performance

會做什麼:
  - 要求提供 Profiler 數據
  - 分析瓶頸（CPU/GPU/Memory）
  - 提供針對性優化建議
  - 使用對象池、緩存等技術
```

### 場景 4: 雙平台上架

```
你: "要上架 Google Play 和 App Store，AAB 超過 200MB 怎麼辦？"

自動觸發: unity-app-store-deployment

會做什麼:
  - 檢查 AAB/IPA 大小
  - Android: 提供瘦身技巧、配置 Play Asset Delivery
  - iOS: 配置 Xcode 簽名、TestFlight 測試、On-Demand Resources
  - 雙平台: 資產優化、隱私政策、審核準備
  - 提供完整的 Build 和上架流程 (兩個平台)
```

## 🎮 Unity 特定的反幻覺機制

這些 skills 會強制驗證：

1. **Component 存在性** - 不會假設組件存在，會檢查
2. **Platform API** - 不會猜測 Unity API，會查文檔
3. **性能數據** - 不會猜測瓶頸，要求 Profiler 數據

## 📚 與全域 Skills 的協作

| 全域 Skill | Unity Skills | 協作方式 |
|-----------|--------------|---------|
| systematic-debugging | unity-best-practices | 調試 Unity 特定問題時結合 |
| testing-strategy | unity-best-practices | Unity Test Framework 結合 |
| performance-optimization | unity-performance | 通用性能 + Unity 特定 |
| code-review-skill | unity-best-practices | C# review + Unity 規範 |

## 🔧 配置說明

### skill-rules.json

定義了 Unity 專案特定的優先級：

- 提到「Unity 慢/FPS 低」→ 觸發 `unity-performance`
- 提到「iOS/Android/觸控」→ 觸發 `unity-multiplatform`
- 提到「架構/設計模式」→ 觸發 `unity-architecture`

## 💡 最佳實踐

### DO ✅

- **每個 Unity 專案都安裝這些 skills**
- **結合全域 skills 使用**（不衝突）
- **提供具體的 Unity 場景**（腳本名、組件類型）
- **提供 Profiler 數據**（性能問題時）

### DON'T ❌

- **不要期望 skills 解決非 Unity 問題**（用全域 skills）
- **不要跳過最佳實踐**（即使是小腳本）
- **不要在沒有數據時猜測性能問題**

## 📊 Skill 優先級

```
HIGH (Unity 特定問題)
├─ unity-performance (性能問題)
├─ unity-multiplatform (平台問題)
└─ unity-app-store-deployment (雙平台上架)

MEDIUM (架構設計)
└─ unity-architecture

ALWAYS ACTIVE (通用)
└─ unity-best-practices
```

## 🆘 常見問題

### Q: 這些 skills 會和全域 skills 衝突嗎？

**A**: 不會。Unity skills 是**專案級別**的，只在 Unity 專案中啟用。全域 skills 仍然工作，兩者互補。

### Q: 我需要全部安裝嗎？

**A**: 建議全部安裝。`unity-best-practices` 是核心，其他按需使用。

### Q: 如何更新？

**A**: 如果用符號連結，自動同步。如果是複製，重新複製即可。

---

**開始使用：** 複製這個資料夾到你的 Unity 專案的 `.claude/skills/`，然後在 Claude Code 中開始編碼！🎮
