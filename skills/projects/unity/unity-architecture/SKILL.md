---
name: unity-architecture
description: |
  Unity 專案架構模式：MVC, MVP, MVVM, ECS, Service Locator, Event System, Dependency Injection。
  大型專案的代碼組織、解耦、可測試性、可維護性。

  Use when: 設計大型 Unity 專案架構、重構混亂的代碼、提高可測試性、
  解耦系統、選擇架構模式、組織團隊協作。
allowed-tools: Read, Grep, Glob
---

# Unity Architecture Patterns

## When to Use This Skill

- 設計大型 Unity 專案（>10 場景，>100 腳本）
- 重構「上帝組件」代碼
- 提高可測試性
- 系統解耦（UI、邏輯、數據分離）
- 選擇架構模式
- 團隊協作，需要明確結構

## 模式比較

| Pattern | 優點 | 缺點 | 適用場景 |
|---------|------|------|---------|
| **MVC** | 經典，易理解 | Unity 中不太自然 | 小型專案 |
| **MVP** | View 完全被動，易測試 | 代碼量大 | 複雜 UI 邏輯 |
| **MVVM** | Data Binding | 需要 Binding 框架 | 數據驅動 UI |
| **ECS** | 極致性能 | 學習曲線陡 | 大量實體（>1000） |
| **Service Locator** | 解耦，易替換 | 隱藏依賴 | 全局服務 |
| **Event System** | 完全解耦 | 難追蹤流程 | 跨系統通信 |

> 完整程式碼範例見 [references/](references/) 目錄

## 模式簡述

### MVC (Model-View-Controller)

```
Model（數據）↔ Controller（輸入+邏輯）↔ View（顯示）
```

- Model：純數據 + 業務邏輯，透過事件通知變化
- View：MonoBehaviour，只負責顯示，被動接收
- Controller：連接 Model 和 View，處理輸入

→ 詳見 [references/mvc-mvp-mvvm.md](references/mvc-mvp-mvvm.md)

### MVP (Model-View-Presenter)

- View 完全被動（只有 setter），透過 Interface 定義
- Presenter 包含所有邏輯 → **易於單元測試（不需 Unity）**
- 適合複雜 UI：Mock View 就能測試所有邏輯

→ 詳見 [references/mvc-mvp-mvvm.md](references/mvc-mvp-mvvm.md)

### MVVM (Model-View-ViewModel)

- ViewModel 實現 `INotifyPropertyChanged`
- View 透過 Data Binding 自動更新
- 需要框架支持（Unity UI Toolkit）

→ 詳見 [references/mvc-mvp-mvvm.md](references/mvc-mvp-mvvm.md)

### ECS (Entity Component System)

- Component = 純數據 (struct IComponentData)
- System = 純邏輯 (SystemBase)
- 適合大量同類實體，搭配 Burst + Job System

→ 詳見 [references/ecs-services-events.md](references/ecs-services-events.md)

### Service Locator

- 全局服務註冊/查找，透過 Interface 解耦
- 優：易替換（測試用 Mock）；缺：隱藏依賴關係

→ 詳見 [references/ecs-services-events.md](references/ecs-services-events.md)

### Dependency Injection

- Constructor Injection 或框架（VContainer / Zenject）
- 依賴顯式聲明，易測試
- VContainer 推薦用於 Unity 專案

→ 詳見 [references/ecs-services-events.md](references/ecs-services-events.md)

### Event System

三種實作方式：
1. **C# Events** — `static event Action<T>`，簡單直接
2. **ScriptableObject Events** — Inspector 可配置，設計師友好
3. **Event Bus / Message Bus** — 強類型消息，完全解耦

→ 詳見 [references/ecs-services-events.md](references/ecs-services-events.md)

### State Machine

- 簡單：switch-case + enum
- 進階：抽象 State 類 + Enter/Execute/Exit

→ 詳見 [references/state-machine.md](references/state-machine.md)

## 推薦專案結構

```
Assets/
├── Scripts/
│   ├── Core/               # 核心系統（GameManager, ServiceLocator）
│   ├── Gameplay/           # 遊戲邏輯
│   │   ├── Player/
│   │   ├── Enemies/
│   │   └── Items/
│   ├── UI/                 # UI 相關
│   ├── Services/           # 服務層（Interface + 實現）
│   └── Utilities/          # 工具類
├── Prefabs/
├── ScriptableObjects/
│   ├── Events/
│   ├── GameData/
│   └── Config/
├── Scenes/
└── Settings/
```

## Anti-Patterns

1. **God Object** — 一個類做所有事 → 拆分成多個單一職責組件
2. **Singleton 濫用** — 所有東西都 Singleton → 改用 DI 或 Service Locator
3. **緊耦合** — 直接引用具體類 → 依賴 Interface
4. **深層繼承** — 4+ 層繼承 → 組合優於繼承

## 選擇標準

| 考量 | 建議 |
|------|------|
| 小團隊/小專案 | MVC 或直接 Component-based |
| 複雜 UI | MVP |
| 數據驅動 UI | MVVM |
| 極致性能（>1000 實體） | ECS (DOTS) |
| 全局服務 | Service Locator 或 DI |
| 跨系統通信 | Event System |
| 需要大量測試 | MVP + DI |

## Remember

- **不要過度設計** — 小專案不需要複雜架構
- **逐步重構** — 不要一開始就完美
- **解耦是關鍵** — UI、邏輯、數據分離
- **依賴接口而非實現**
- **組合 > 繼承**
- **測試驅動** — 可測試的架構更好
