---
name: unity-best-practices
description: |
  Unity 資深工程師最佳實踐和代碼規範。
  涵蓋 C# 編碼標準、Unity 特定模式、組件設計、ScriptableObject 使用、Prefab 管理等。

  Use when: 編寫 Unity C# 代碼、設計組件、架構 Unity 專案、重構 Unity 代碼、
  建立編碼規範、優化 Unity 工作流程。

  Focus: Unity 特定的最佳實踐，不是通用 C# 或通用架構。
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Unity Best Practices - 資深工程師指南

## When to Use This Skill

- 編寫 Unity C# 代碼
- 設計 MonoBehaviour 組件
- 使用 ScriptableObject
- 管理 Prefabs 和場景
- 設計 Unity 專案架構
- 重構 Unity 代碼
- 建立團隊編碼規範

## Core Unity Principles

### 1. MonoBehaviour 設計原則

**DO: 單一職責組件**

```csharp
// ✅ 好 - 單一職責
public class PlayerMovement : MonoBehaviour
{
    [SerializeField] private float moveSpeed = 5f;
    [SerializeField] private Rigidbody rb;

    private void FixedUpdate()
    {
        float horizontal = Input.GetAxis("Horizontal");
        float vertical = Input.GetAxis("Vertical");

        Vector3 movement = new Vector3(horizontal, 0f, vertical);
        rb.MovePosition(transform.position + movement * moveSpeed * Time.fixedDeltaTime);
    }
}

public class PlayerHealth : MonoBehaviour
{
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    private void Start()
    {
        currentHealth = maxHealth;
    }

    public void TakeDamage(int damage)
    {
        currentHealth -= damage;
        if (currentHealth <= 0)
        {
            Die();
        }
    }

    private void Die()
    {
        Destroy(gameObject);
    }
}
```

```csharp
// ❌ 壞 - 上帝組件 (God Object)
public class Player : MonoBehaviour
{
    // Movement
    private float moveSpeed;
    private Rigidbody rb;

    // Health
    private int health;
    private int maxHealth;

    // Inventory
    private List<Item> inventory;

    // Animation
    private Animator animator;

    // Sound
    private AudioSource audioSource;

    // UI
    private Canvas canvas;

    // 太多職責混在一起！
    void Update() { /* ... */ }
    void TakeDamage() { /* ... */ }
    void AddItem() { /* ... */ }
    void PlaySound() { /* ... */ }
}
```

### 2. SerializeField vs Public

```csharp
// ✅ 使用 SerializeField - 封裝且可在 Inspector 編輯
[SerializeField] private float speed = 5f;
[SerializeField] private Transform target;

// ✅ Public 用於需要被其他腳本訪問的 API
public void Attack() { }
public int GetHealth() { return health; }

// ❌ 避免不必要的 public 欄位
public float speed; // 破壞封裝
public Transform target; // 任何人都可以修改
```

### 3. ScriptableObject 數據驅動設計

**武器系統範例**

```csharp
// ScriptableObject 定義
[CreateAssetMenu(fileName = "New Weapon", menuName = "Game/Weapon")]
public class WeaponData : ScriptableObject
{
    [Header("基本屬性")]
    public string weaponName;
    public Sprite icon;
    public GameObject prefab;

    [Header("戰鬥屬性")]
    public int damage;
    public float attackSpeed;
    public float range;

    [Header("音效")]
    public AudioClip attackSound;
    public AudioClip hitSound;
}

// 使用 ScriptableObject
public class Weapon : MonoBehaviour
{
    [SerializeField] private WeaponData weaponData;

    public void Attack()
    {
        // 使用數據
        int finalDamage = weaponData.damage;
        AudioSource.PlayClipAtPoint(weaponData.attackSound, transform.position);
    }
}
```

**為什麼用 ScriptableObject？**
- ✅ 設計師可以創建新武器不需改代碼
- ✅ 減少內存 - 多個實例共享同一數據
- ✅ 方便平衡調整
- ✅ 支持熱重載（Play Mode 修改立即生效）

### 4. Prefab Workflow

```csharp
// ✅ 好 - 使用 Prefab Variant
// Base Prefab: Enemy.prefab
// Variants: FastEnemy.prefab, TankEnemy.prefab, FlyingEnemy.prefab

// ✅ 好 - Prefab 內使用 Reference
public class Enemy : MonoBehaviour
{
    [SerializeField] private Transform firePoint; // Prefab 內部 reference
    [SerializeField] private Animator animator;   // Prefab 內部 reference
}

// ❌ 壞 - 硬編碼路徑
GameObject enemy = Resources.Load<GameObject>("Enemies/FastEnemy"); // 慢且脆弱

// ✅ 好 - 使用 Addressables 或直接 reference
[SerializeField] private GameObject enemyPrefab;
Instantiate(enemyPrefab, spawnPoint.position, Quaternion.identity);
```

### 5. 生命週期方法優化

```csharp
// ✅ 正確的執行順序理解
public class GameManager : MonoBehaviour
{
    private void Awake()
    {
        // 初始化自己的狀態
        // 設定 Singleton
        if (Instance == null) Instance = this;
    }

    private void OnEnable()
    {
        // 註冊事件
        EventManager.OnGameStart += HandleGameStart;
    }

    private void Start()
    {
        // 訪問其他組件（確保它們已 Awake）
        playerHealth = Player.GetComponent<Health>();
    }

    private void OnDisable()
    {
        // 取消註冊事件
        EventManager.OnGameStart -= HandleGameStart;
    }
}

// ❌ 常見錯誤
private void Start()
{
    // 錯誤：Start 中設定 Singleton 可能太晚
    if (Instance == null) Instance = this;
}
```

### 6. Update vs FixedUpdate vs LateUpdate

```csharp
// ✅ Update - 輸入處理、非物理移動
private void Update()
{
    if (Input.GetKeyDown(KeyCode.Space))
    {
        Jump();
    }

    // 相機跟隨（非物理）
    transform.position = Vector3.Lerp(transform.position, target.position, Time.deltaTime * speed);
}

// ✅ FixedUpdate - 物理相關
private void FixedUpdate()
{
    rb.AddForce(Vector3.forward * thrust);
    rb.MovePosition(targetPosition);
}

// ✅ LateUpdate - 相機跟隨（在所有 Update 後）
private void LateUpdate()
{
    // 確保目標已經移動完成
    transform.position = target.position + offset;
}
```

## Component Patterns

### 1. Composition Over Inheritance

```csharp
// ✅ 好 - 組合模式
public class Enemy : MonoBehaviour
{
    [SerializeField] private Health health;
    [SerializeField] private Movement movement;
    [SerializeField] private Attack attack;
}

public class Health : MonoBehaviour
{
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    public void TakeDamage(int damage) { /* ... */ }
    public void Heal(int amount) { /* ... */ }
}

// ❌ 壞 - 深層繼承
public class Character : MonoBehaviour { }
public class Enemy : Character { }
public class MeleeEnemy : Enemy { }
public class AxeEnemy : MeleeEnemy { } // 太深了！
```

### 2. Interface-Based Design

```csharp
// 定義接口
public interface IDamageable
{
    void TakeDamage(int damage);
}

public interface IInteractable
{
    void Interact(GameObject interactor);
}

// 實現
public class Crate : MonoBehaviour, IDamageable, IInteractable
{
    [SerializeField] private int health = 50;

    public void TakeDamage(int damage)
    {
        health -= damage;
        if (health <= 0) Destroy(gameObject);
    }

    public void Interact(GameObject interactor)
    {
        // 打開箱子
    }
}

// 使用
RaycastHit hit;
if (Physics.Raycast(ray, out hit))
{
    IDamageable damageable = hit.collider.GetComponent<IDamageable>();
    if (damageable != null)
    {
        damageable.TakeDamage(10);
    }
}
```

### 3. Event-Driven Architecture

```csharp
// ✅ 使用 UnityEvent
using UnityEngine.Events;

public class Health : MonoBehaviour
{
    public UnityEvent OnDeath; // Inspector 可配置
    public UnityEvent<int> OnHealthChanged; // 帶參數

    public void TakeDamage(int damage)
    {
        currentHealth -= damage;
        OnHealthChanged?.Invoke(currentHealth);

        if (currentHealth <= 0)
        {
            OnDeath?.Invoke();
        }
    }
}

// ✅ 或使用 C# Events
public class GameManager : MonoBehaviour
{
    public static event Action OnGameStart;
    public static event Action<int> OnScoreChanged;

    public void StartGame()
    {
        OnGameStart?.Invoke();
    }
}

// 訂閱
void OnEnable()
{
    GameManager.OnGameStart += HandleGameStart;
}

void OnDisable()
{
    GameManager.OnGameStart -= HandleGameStart;
}
```

## Performance Best Practices

### 1. Avoid GetComponent in Update

```csharp
// ❌ 非常慢 - 每幀調用 GetComponent
void Update()
{
    Rigidbody rb = GetComponent<Rigidbody>();
    rb.AddForce(Vector3.up);
}

// ✅ 緩存 Component
private Rigidbody rb;

void Awake()
{
    rb = GetComponent<Rigidbody>();
}

void Update()
{
    rb.AddForce(Vector3.up);
}
```

### 2. Object Pooling

```csharp
// ✅ 對象池 - 避免頻繁 Instantiate/Destroy
public class ObjectPool : MonoBehaviour
{
    [SerializeField] private GameObject prefab;
    [SerializeField] private int poolSize = 10;

    private Queue<GameObject> pool = new Queue<GameObject>();

    void Start()
    {
        for (int i = 0; i < poolSize; i++)
        {
            GameObject obj = Instantiate(prefab);
            obj.SetActive(false);
            pool.Enqueue(obj);
        }
    }

    public GameObject Get()
    {
        if (pool.Count > 0)
        {
            GameObject obj = pool.Dequeue();
            obj.SetActive(true);
            return obj;
        }
        return Instantiate(prefab);
    }

    public void Return(GameObject obj)
    {
        obj.SetActive(false);
        pool.Enqueue(obj);
    }
}

// 使用
GameObject bullet = bulletPool.Get();
// 使用完畢
bulletPool.Return(bullet);
```

### 3. String Allocation

```csharp
// ❌ 避免在 Update 中創建字符串
void Update()
{
    scoreText.text = "Score: " + score.ToString(); // 每幀產生垃圾
}

// ✅ 只在數值改變時更新
private int lastScore = -1;
void Update()
{
    if (score != lastScore)
    {
        scoreText.text = $"Score: {score}";
        lastScore = score;
    }
}

// ✅ 使用 StringBuilder
using System.Text;
private StringBuilder sb = new StringBuilder();

void UpdateText()
{
    sb.Clear();
    sb.Append("Score: ");
    sb.Append(score);
    scoreText.text = sb.ToString();
}
```

### 4. Coroutine 最佳實踐

```csharp
// ✅ 緩存 WaitForSeconds
private WaitForSeconds wait = new WaitForSeconds(1f);

IEnumerator SpawnEnemies()
{
    while (true)
    {
        SpawnEnemy();
        yield return wait; // 重用，不產生垃圾
    }
}

// ❌ 每次創建新的（產生垃圾）
IEnumerator SpawnEnemies()
{
    while (true)
    {
        SpawnEnemy();
        yield return new WaitForSeconds(1f); // 產生垃圾
    }
}

// ✅ 緩存常用的 yield
private WaitForEndOfFrame waitForEndOfFrame = new WaitForEndOfFrame();
private WaitForFixedUpdate waitForFixedUpdate = new WaitForFixedUpdate();
```

## Unity C# Coding Standards

### 1. 命名規範

```csharp
// ✅ 私有欄位 - camelCase
private int currentHealth;
private Transform playerTransform;

// ✅ SerializeField - camelCase
[SerializeField] private float moveSpeed;

// ✅ Public 屬性 - PascalCase
public int MaxHealth { get; private set; }

// ✅ 方法 - PascalCase
public void TakeDamage(int damage) { }

// ✅ 常量 - PascalCase 或 UPPER_CASE
private const int MaxPlayers = 4;
private const float GRAVITY = -9.81f;

// ✅ Events - PascalCase，以 On 開頭
public event Action OnPlayerDeath;
```

### 2. 組織代碼

```csharp
public class Player : MonoBehaviour
{
    #region Serialized Fields
    [Header("Movement")]
    [SerializeField] private float moveSpeed = 5f;
    [SerializeField] private float jumpForce = 10f;

    [Header("References")]
    [SerializeField] private Rigidbody rb;
    [SerializeField] private Animator animator;
    #endregion

    #region Private Fields
    private bool isGrounded;
    private Vector3 velocity;
    #endregion

    #region Properties
    public bool IsAlive { get; private set; } = true;
    #endregion

    #region Unity Lifecycle
    private void Awake()
    {
        rb = GetComponent<Rigidbody>();
    }

    private void Update()
    {
        HandleInput();
    }

    private void FixedUpdate()
    {
        ApplyMovement();
    }
    #endregion

    #region Public Methods
    public void TakeDamage(int damage)
    {
        // ...
    }
    #endregion

    #region Private Methods
    private void HandleInput()
    {
        // ...
    }

    private void ApplyMovement()
    {
        // ...
    }
    #endregion
}
```

### 3. Header 和 Tooltip

```csharp
public class Enemy : MonoBehaviour
{
    [Header("Stats")]
    [Tooltip("敵人的最大生命值")]
    [SerializeField] private int maxHealth = 100;

    [Tooltip("移動速度（單位/秒）")]
    [SerializeField] private float moveSpeed = 3f;

    [Header("References")]
    [Tooltip("玩家 Transform，用於追蹤")]
    [SerializeField] private Transform playerTransform;

    [Header("Prefabs")]
    [SerializeField] private GameObject deathEffectPrefab;
}
```

## Scene Management

### 1. 場景加載

```csharp
using UnityEngine.SceneManagement;

// ✅ 異步加載場景
public IEnumerator LoadSceneAsync(string sceneName)
{
    AsyncOperation operation = SceneManager.LoadSceneAsync(sceneName);

    while (!operation.isDone)
    {
        float progress = Mathf.Clamp01(operation.progress / 0.9f);
        loadingBar.value = progress;
        yield return null;
    }
}

// ✅ Additive 加載（不卸載當前場景）
SceneManager.LoadScene("UI", LoadSceneMode.Additive);

// ✅ 卸載場景
SceneManager.UnloadSceneAsync("OldLevel");
```

### 2. DontDestroyOnLoad

```csharp
// ✅ Singleton + DontDestroyOnLoad
public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
}
```

## Inspector 技巧

### 1. Custom Property Drawer

```csharp
// 自定義範圍屬性
[System.Serializable]
public class MinMaxRange
{
    public float min;
    public float max;
}

// 使用
[SerializeField] private MinMaxRange damageRange;
```

### 2. 條件顯示

```csharp
// 使用第三方工具如 NaughtyAttributes 或自己實現
public enum WeaponType { Melee, Ranged }

public WeaponType weaponType;

[ShowIf("weaponType", WeaponType.Ranged)]
public float range;

[ShowIf("weaponType", WeaponType.Melee)]
public float attackRadius;
```

## Asset Organization

```
Assets/
├── _Project/                  # 你的專案資產
│   ├── Scripts/
│   │   ├── Player/
│   │   ├── Enemies/
│   │   ├── Managers/
│   │   └── UI/
│   ├── Prefabs/
│   ├── ScriptableObjects/
│   ├── Scenes/
│   ├── Materials/
│   ├── Textures/
│   └── Audio/
├── Plugins/                   # 第三方插件
└── Resources/                 # 盡量少用
```

## Common Pitfalls

### 1. 避免 Find 系列方法

```csharp
// ❌ 非常慢
void Update()
{
    GameObject player = GameObject.Find("Player");
    player.transform.position = ...
}

// ✅ 使用 Reference 或 Tag
[SerializeField] private GameObject player;

// 或者在 Start 中找一次
private GameObject player;
void Start()
{
    player = GameObject.FindGameObjectWithTag("Player");
}
```

### 2. 避免 SendMessage

```csharp
// ❌ 慢且容易出錯
gameObject.SendMessage("TakeDamage", 10);

// ✅ 直接調用
Health health = GetComponent<Health>();
health.TakeDamage(10);

// ✅ 或使用 Interface
IDamageable damageable = GetComponent<IDamageable>();
damageable?.TakeDamage(10);
```

### 3. Null Reference 檢查

```csharp
// ✅ Unity null 檢查
if (myComponent != null)
{
    myComponent.DoSomething();
}

// ✅ Null-conditional operator
myComponent?.DoSomething();

// ✅ RequireComponent 確保組件存在
[RequireComponent(typeof(Rigidbody))]
public class PlayerController : MonoBehaviour
{
    private Rigidbody rb;

    void Awake()
    {
        rb = GetComponent<Rigidbody>(); // 保證存在
    }
}
```

## Testing in Unity

```csharp
// ✅ 使用 Unity Test Framework
using NUnit.Framework;
using UnityEngine.TestTools;

public class HealthTests
{
    [Test]
    public void TakeDamage_ReducesHealth()
    {
        var health = new Health(100);
        health.TakeDamage(30);
        Assert.AreEqual(70, health.CurrentHealth);
    }

    [UnityTest]
    public IEnumerator Player_DiesAfterFiveDamage()
    {
        var player = new GameObject().AddComponent<Player>();

        for (int i = 0; i < 5; i++)
        {
            player.TakeDamage(20);
            yield return null;
        }

        Assert.IsFalse(player.IsAlive);
    }
}
```

## Remember

- **單一職責** - 一個組件一個職責
- **數據驅動** - 用 ScriptableObject 存配置
- **緩存 Component** - 不要在 Update 中 GetComponent
- **對象池** - 頻繁創建/銷毀的對象要池化
- **Events > Find** - 用事件系統而不是查找
- **組合 > 繼承** - 優先使用組件組合
- **測試** - 寫測試確保代碼品質
- **Profile** - 用 Profiler 找性能問題，不要猜測

