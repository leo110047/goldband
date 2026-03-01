---
name: unity-best-practices
description: |
  Unity 資深工程師最佳實踐和代碼規範。
  涵蓋 C# 編碼標準、Unity 特定模式、組件設計、ScriptableObject 使用、Prefab 管理等。

  Use when: 編寫 Unity C# 代碼、設計組件、架構 Unity 專案、重構 Unity 代碼、
  建立編碼規範、優化 Unity 工作流程。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity Best Practices 指南

## When to Use

- 編寫 Unity C# 代碼
- 設計 MonoBehaviour 組件
- 使用 ScriptableObject
- 管理 Prefabs 和場景
- 重構 Unity 代碼

> 完整程式碼範例見 [references/](references/) 目錄

## Core Principles

### 1. 單一職責組件

```csharp
// ✅ 好 - 單一職責
public class PlayerMovement : MonoBehaviour { /* 只處理移動 */ }
public class PlayerHealth : MonoBehaviour { /* 只處理血量 */ }

// ❌ 壞 - God Object
public class Player : MonoBehaviour
{
    // Movement + Health + Inventory + Animation + Sound + UI 全部混在一起
}
```

### 2. SerializeField vs Public

```csharp
// ✅ 使用 SerializeField - 封裝且 Inspector 可編輯
[SerializeField] private float speed = 5f;
[SerializeField] private Transform target;

// ✅ Public 只用於 API
public void Attack() { }
public int GetHealth() => health;

// ❌ 避免不必要的 public 欄位
public float speed; // 破壞封裝
```

### 3. ScriptableObject 數據驅動

```csharp
[CreateAssetMenu(fileName = "New Weapon", menuName = "Game/Weapon")]
public class WeaponData : ScriptableObject
{
    [Header("基本屬性")]
    public string weaponName;
    public Sprite icon;

    [Header("戰鬥屬性")]
    public int damage;
    public float attackSpeed;
}

// 使用：設計師可以創建新武器不需改代碼
[SerializeField] private WeaponData weaponData;
```

### 4. Prefab 規則

```csharp
// ✅ 使用 Prefab Variant：Base → Fast/Tank/Flying Variants
// ✅ 使用直接 Reference 或 Addressables
[SerializeField] private GameObject enemyPrefab;
Instantiate(enemyPrefab, spawnPoint.position, Quaternion.identity);

// ❌ 硬編碼路徑
Resources.Load<GameObject>("Enemies/FastEnemy"); // 慢且脆弱
```

### 5. 生命週期順序

| 方法 | 用途 | 注意 |
|------|------|------|
| `Awake` | 初始化自己、設定 Singleton | 不訪問其他組件 |
| `OnEnable` | 註冊事件 | |
| `Start` | 訪問其他組件（它們已 Awake） | |
| `OnDisable` | 取消事件註冊 | |

### 6. Update 使用規則

| 方法 | 用途 |
|------|------|
| `Update` | 輸入處理、非物理移動 |
| `FixedUpdate` | 物理相關（Rigidbody） |
| `LateUpdate` | 相機跟隨（在所有 Update 後） |

## Component Patterns

### 組合 > 繼承

```csharp
// ✅ 組合模式
public class Enemy : MonoBehaviour
{
    [SerializeField] private Health health;
    [SerializeField] private Movement movement;
    [SerializeField] private Attack attack;
}

// ❌ 太深繼承：Character → Enemy → MeleeEnemy → AxeEnemy
```

### Interface-Based Design

```csharp
public interface IDamageable { void TakeDamage(int damage); }
public interface IInteractable { void Interact(GameObject interactor); }

// 使用
IDamageable d = hit.collider.GetComponent<IDamageable>();
d?.TakeDamage(10);
```

→ 完整事件系統範例見 [references/component-patterns.md](references/component-patterns.md)

## C# 命名規範

```csharp
private int currentHealth;                    // 私有欄位: camelCase
[SerializeField] private float moveSpeed;     // SerializeField: camelCase
public int MaxHealth { get; private set; }    // 屬性: PascalCase
public void TakeDamage(int damage) { }       // 方法: PascalCase
private const int MaxPlayers = 4;             // 常量: PascalCase
public event Action OnPlayerDeath;            // 事件: On + PascalCase
```

## Common Pitfalls

```csharp
// ❌ 每幀 Find（慢）
void Update() { GameObject.Find("Player"); }
// ✅ Start 中快取
private GameObject player;
void Start() { player = GameObject.FindGameObjectWithTag("Player"); }

// ❌ SendMessage（慢且易錯）
gameObject.SendMessage("TakeDamage", 10);
// ✅ 直接調用或 Interface
GetComponent<IDamageable>()?.TakeDamage(10);

// ❌ tag == 比較（慢）
if (other.gameObject.tag == "Player")
// ✅ CompareTag（快）
if (other.gameObject.CompareTag("Player"))

// ✅ RequireComponent 確保組件存在
[RequireComponent(typeof(Rigidbody))]
public class PlayerController : MonoBehaviour { }
```

## Asset Organization

```
Assets/
├── Scripts/          # 按 feature/domain 分
│   ├── Player/
│   ├── Enemies/
│   ├── Managers/
│   └── UI/
├── Prefabs/
├── ScriptableObjects/
├── Scenes/
├── Materials/
├── Textures/
├── Audio/
├── Plugins/          # 第三方
└── Resources/        # 盡量少用
```

→ 性能最佳實踐見 [references/performance-tips.md](references/performance-tips.md)

## Remember

- **單一職責** — 一個組件一個職責
- **數據驅動** — 用 ScriptableObject 存配置
- **緩存 Component** — 不要在 Update 中 GetComponent
- **對象池** — 頻繁創建/銷毀的對象要池化
- **Events > Find** — 用事件系統而不是查找
- **組合 > 繼承**
- **Profile** — 用 Profiler 找問題，不要猜測
