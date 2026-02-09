---
name: unity-architecture
description: |
  Unity 專案架構模式：MVC, MVP, MVVM, ECS, Service Locator, Event System, Dependency Injection。
  大型專案的代碼組織、解耦、可測試性、可維護性。

  Use when: 設計大型 Unity 專案架構、重構混亂的代碼、提高可測試性、
  解耦系統、選擇架構模式、組織團隊協作。

  Focus: Unity 專案架構，不是通用軟件架構。
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Unity Architecture Patterns

## When to Use This Skill

- 設計大型 Unity 專案（>10 個場景，>100 個腳本）
- 重構混亂的「上帝組件」代碼
- 提高代碼可測試性
- 系統解耦（UI、邏輯、數據分離）
- 選擇架構模式（MVC vs MVP vs ECS）
- 團隊協作，需要明確的代碼結構
- 建立可擴展的系統

## Architecture Patterns Overview

| Pattern | 優點 | 缺點 | 適用場景 |
|---------|------|------|---------|
| **MVC** | 經典，易理解 | Unity 中不太自然 | 小型專案 |
| **MVP** | View 完全被動，易測試 | 代碼量大 | 複雜 UI 邏輯 |
| **MVVM** | Data Binding，減少代碼 | 需要 Binding 框架 | 數據驅動 UI |
| **ECS** | 極致性能，數據導向 | 學習曲線陡，範式轉變 | 大量實體（>1000） |
| **Service Locator** | 解耦，易於替換 | 隱藏依賴 | 全局服務 |
| **Event System** | 完全解耦 | 難以追蹤流程 | 跨系統通信 |

## MVC (Model-View-Controller)

### 結構

```
Model      ← 數據和業務邏輯
  ↕
Controller ← 處理輸入，更新 Model
  ↕
View       ← 顯示 UI
```

### 實現

```csharp
// Model - 純數據類
public class PlayerModel
{
    private int health;
    private int maxHealth;

    public int Health
    {
        get => health;
        set
        {
            health = Mathf.Clamp(value, 0, maxHealth);
            OnHealthChanged?.Invoke(health);
        }
    }

    public event Action<int> OnHealthChanged;

    public PlayerModel(int maxHealth)
    {
        this.maxHealth = maxHealth;
        this.health = maxHealth;
    }

    public void TakeDamage(int damage)
    {
        Health -= damage;
    }

    public void Heal(int amount)
    {
        Health += amount;
    }
}

// View - MonoBehaviour，只負責顯示
public class PlayerView : MonoBehaviour
{
    [SerializeField] private Image healthBar;
    [SerializeField] private Text healthText;

    public void UpdateHealth(int health, int maxHealth)
    {
        healthBar.fillAmount = (float)health / maxHealth;
        healthText.text = $"{health}/{maxHealth}";
    }

    public void ShowDamageEffect()
    {
        // 播放受傷動畫
        StartCoroutine(DamageFlash());
    }

    private IEnumerator DamageFlash()
    {
        // 紅色閃爍效果
        yield return null;
    }
}

// Controller - 連接 Model 和 View
public class PlayerController : MonoBehaviour
{
    private PlayerModel model;
    private PlayerView view;

    void Start()
    {
        model = new PlayerModel(maxHealth: 100);
        view = GetComponent<PlayerView>();

        // 訂閱 Model 事件
        model.OnHealthChanged += OnHealthChanged;

        // 初始化 View
        OnHealthChanged(model.Health);
    }

    void OnHealthChanged(int health)
    {
        view.UpdateHealth(health, 100);
    }

    public void TakeDamage(int damage)
    {
        model.TakeDamage(damage);
        view.ShowDamageEffect();
    }
}
```

## MVP (Model-View-Presenter)

### 特點
- View 完全被動（只有 setter/getter）
- Presenter 包含所有邏輯
- 易於單元測試（不需要 Unity）

### 實現

```csharp
// Model
public class InventoryModel
{
    private List<Item> items = new List<Item>();

    public IReadOnlyList<Item> Items => items.AsReadOnly();

    public void AddItem(Item item)
    {
        items.Add(item);
    }

    public void RemoveItem(Item item)
    {
        items.Remove(item);
    }
}

// View Interface
public interface IInventoryView
{
    void DisplayItems(List<Item> items);
    void ShowItemAdded(Item item);
    void ShowItemRemoved(Item item);
}

// View Implementation (MonoBehaviour)
public class InventoryView : MonoBehaviour, IInventoryView
{
    [SerializeField] private Transform itemContainer;
    [SerializeField] private GameObject itemPrefab;

    public void DisplayItems(List<Item> items)
    {
        // 清空現有 UI
        foreach (Transform child in itemContainer)
        {
            Destroy(child.gameObject);
        }

        // 顯示所有物品
        foreach (var item in items)
        {
            GameObject itemUI = Instantiate(itemPrefab, itemContainer);
            itemUI.GetComponent<ItemUI>().SetItem(item);
        }
    }

    public void ShowItemAdded(Item item)
    {
        // 播放添加動畫
    }

    public void ShowItemRemoved(Item item)
    {
        // 播放移除動畫
    }
}

// Presenter
public class InventoryPresenter
{
    private readonly InventoryModel model;
    private readonly IInventoryView view;

    public InventoryPresenter(InventoryModel model, IInventoryView view)
    {
        this.model = model;
        this.view = view;
    }

    public void Initialize()
    {
        UpdateView();
    }

    public void AddItem(Item item)
    {
        model.AddItem(item);
        view.ShowItemAdded(item);
        UpdateView();
    }

    public void RemoveItem(Item item)
    {
        model.RemoveItem(item);
        view.ShowItemRemoved(item);
        UpdateView();
    }

    private void UpdateView()
    {
        view.DisplayItems(model.Items.ToList());
    }
}

// Unity Entry Point
public class InventoryController : MonoBehaviour
{
    private InventoryPresenter presenter;

    void Start()
    {
        var model = new InventoryModel();
        var view = GetComponent<IInventoryView>();
        presenter = new InventoryPresenter(model, view);
        presenter.Initialize();
    }
}
```

### MVP 的可測試性

```csharp
// 單元測試（不需要 Unity）
[Test]
public void AddItem_ShouldUpdateView()
{
    // Arrange
    var model = new InventoryModel();
    var mockView = new MockInventoryView(); // Mock View
    var presenter = new InventoryPresenter(model, mockView);

    var item = new Item("Sword");

    // Act
    presenter.AddItem(item);

    // Assert
    Assert.IsTrue(mockView.DisplayItemsCalled);
    Assert.IsTrue(mockView.ShowItemAddedCalled);
}
```

## MVVM (Model-View-ViewModel)

### 特點
- Data Binding（數據綁定）
- View 自動更新（當 ViewModel 改變時）
- 需要 Binding 框架

### 使用第三方框架

**Unity UI Toolkit + MVVM:**

```csharp
// ViewModel
public class PlayerViewModel : INotifyPropertyChanged
{
    private int health;
    public int Health
    {
        get => health;
        set
        {
            if (health != value)
            {
                health = value;
                OnPropertyChanged(nameof(Health));
            }
        }
    }

    public event PropertyChangedEventHandler PropertyChanged;

    protected void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

// View (UXML + Binding)
// Health Label 自動更新當 ViewModel.Health 改變
```

## ECS (Entity Component System)

### Unity DOTS (Data-Oriented Technology Stack)

```csharp
using Unity.Entities;
using Unity.Transforms;
using Unity.Mathematics;

// Component (純數據)
public struct MoveSpeed : IComponentData
{
    public float Value;
}

public struct Target : IComponentData
{
    public float3 Position;
}

// System (純邏輯)
public partial class MoveToTargetSystem : SystemBase
{
    protected override void OnUpdate()
    {
        float deltaTime = Time.DeltaTime;

        Entities.ForEach((ref Translation translation, in MoveSpeed speed, in Target target) =>
        {
            float3 direction = math.normalize(target.Position - translation.Value);
            translation.Value += direction * speed.Value * deltaTime;

        }).ScheduleParallel();
    }
}

// 創建 Entity
EntityManager entityManager = World.DefaultGameObjectInjectionWorld.EntityManager;

Entity entity = entityManager.CreateEntity(
    typeof(Translation),
    typeof(MoveSpeed),
    typeof(Target)
);

entityManager.SetComponentData(entity, new Translation { Value = float3.zero });
entityManager.SetComponentData(entity, new MoveSpeed { Value = 5f });
entityManager.SetComponentData(entity, new Target { Position = new float3(10, 0, 0) });
```

### 何時使用 ECS？

**✅ 適合：**
- 大量同類實體（>1000 敵人，>10000 粒子）
- 性能關鍵（需要 Burst Compiler 和 Job System）
- 數據導向設計

**❌ 不適合：**
- 小型專案
- 複雜的遊戲邏輯（狀態機、AI）
- 團隊不熟悉 ECS

## Service Locator Pattern

### 實現

```csharp
// 服務接口
public interface IAudioService
{
    void PlaySound(string soundName);
    void PlayMusic(string musicName);
}

public interface IDataService
{
    void SaveData(string key, string value);
    string LoadData(string key);
}

// 實現
public class AudioService : IAudioService
{
    public void PlaySound(string soundName)
    {
        // 播放音效
    }

    public void PlayMusic(string musicName)
    {
        // 播放音樂
    }
}

// Service Locator
public class ServiceLocator
{
    private static readonly Dictionary<Type, object> services = new Dictionary<Type, object>();

    public static void Register<T>(T service)
    {
        services[typeof(T)] = service;
    }

    public static T Get<T>()
    {
        if (services.TryGetValue(typeof(T), out object service))
        {
            return (T)service;
        }

        throw new Exception($"Service of type {typeof(T)} not registered");
    }

    public static void Unregister<T>()
    {
        services.Remove(typeof(T));
    }

    public static void Clear()
    {
        services.Clear();
    }
}

// 使用
public class GameManager : MonoBehaviour
{
    void Awake()
    {
        // 註冊服務
        ServiceLocator.Register<IAudioService>(new AudioService());
        ServiceLocator.Register<IDataService>(new PlayerPrefsDataService());
    }

    void OnDestroy()
    {
        ServiceLocator.Clear();
    }
}

public class Player : MonoBehaviour
{
    void Attack()
    {
        // 使用服務
        ServiceLocator.Get<IAudioService>().PlaySound("Attack");
    }
}
```

### 優點
- 解耦（組件不需要直接引用服務）
- 易於替換實現（測試時用 Mock）
- 全局訪問

### 缺點
- 隱藏依賴（不易看出依賴關係）
- 運行時錯誤（服務未註冊）

## Dependency Injection

### 手動 DI (Constructor Injection)

```csharp
// 不依賴 Service Locator
public class Player
{
    private readonly IAudioService audioService;
    private readonly IDataService dataService;

    // Constructor Injection
    public Player(IAudioService audioService, IDataService dataService)
    {
        this.audioService = audioService;
        this.dataService = dataService;
    }

    public void Attack()
    {
        audioService.PlaySound("Attack");
    }
}

// 創建時注入
public class GameManager : MonoBehaviour
{
    void Start()
    {
        var audioService = new AudioService();
        var dataService = new PlayerPrefsDataService();

        var player = new Player(audioService, dataService);
    }
}
```

### 使用 DI 框架 (VContainer, Zenject)

```csharp
using VContainer;
using VContainer.Unity;

// 安裝：Package Manager → VContainer

public class GameLifetimeScope : LifetimeScope
{
    protected override void Configure(IContainerBuilder builder)
    {
        // 註冊服務
        builder.Register<IAudioService, AudioService>(Lifetime.Singleton);
        builder.Register<IDataService, PlayerPrefsDataService>(Lifetime.Singleton);

        // 註冊 MonoBehaviour
        builder.RegisterComponentInHierarchy<Player>();
    }
}

public class Player : MonoBehaviour
{
    private IAudioService audioService;

    [Inject]
    public void Construct(IAudioService audioService)
    {
        this.audioService = audioService;
    }

    public void Attack()
    {
        audioService.PlaySound("Attack");
    }
}
```

## Event System

### 1. C# Events

```csharp
// 事件管理器
public static class GameEvents
{
    public static event Action<int> OnScoreChanged;
    public static event Action OnGameOver;
    public static event Action<Enemy> OnEnemyKilled;

    public static void RaiseScoreChanged(int newScore)
    {
        OnScoreChanged?.Invoke(newScore);
    }

    public static void RaiseGameOver()
    {
        OnGameOver?.Invoke();
    }
}

// 發布者
public class Enemy : MonoBehaviour
{
    void Die()
    {
        GameEvents.RaiseScoreChanged(100);
        GameEvents.OnEnemyKilled?.Invoke(this);
        Destroy(gameObject);
    }
}

// 訂閱者
public class ScoreUI : MonoBehaviour
{
    void OnEnable()
    {
        GameEvents.OnScoreChanged += UpdateScore;
    }

    void OnDisable()
    {
        GameEvents.OnScoreChanged -= UpdateScore;
    }

    void UpdateScore(int score)
    {
        scoreText.text = $"Score: {score}";
    }
}
```

### 2. ScriptableObject Event System

```csharp
// Event ScriptableObject
[CreateAssetMenu(menuName = "Events/Game Event")]
public class GameEvent : ScriptableObject
{
    private List<GameEventListener> listeners = new List<GameEventListener>();

    public void Raise()
    {
        for (int i = listeners.Count - 1; i >= 0; i--)
        {
            listeners[i].OnEventRaised();
        }
    }

    public void RegisterListener(GameEventListener listener)
    {
        listeners.Add(listener);
    }

    public void UnregisterListener(GameEventListener listener)
    {
        listeners.Remove(listener);
    }
}

// Listener
public class GameEventListener : MonoBehaviour
{
    [SerializeField] private GameEvent gameEvent;
    [SerializeField] private UnityEvent response;

    void OnEnable()
    {
        gameEvent.RegisterListener(this);
    }

    void OnDisable()
    {
        gameEvent.UnregisterListener(this);
    }

    public void OnEventRaised()
    {
        response?.Invoke();
    }
}

// 使用
public class GameManager : MonoBehaviour
{
    [SerializeField] private GameEvent onGameStartEvent;

    void Start()
    {
        onGameStartEvent.Raise();
    }
}
```

### 3. Message Bus / Event Aggregator

```csharp
// 消息
public class PlayerDiedMessage
{
    public Player Player { get; set; }
}

public class ScoreChangedMessage
{
    public int NewScore { get; set; }
}

// Event Bus
public class EventBus
{
    private static Dictionary<Type, List<Delegate>> subscribers = new Dictionary<Type, List<Delegate>>();

    public static void Subscribe<T>(Action<T> handler)
    {
        Type messageType = typeof(T);

        if (!subscribers.ContainsKey(messageType))
        {
            subscribers[messageType] = new List<Delegate>();
        }

        subscribers[messageType].Add(handler);
    }

    public static void Unsubscribe<T>(Action<T> handler)
    {
        Type messageType = typeof(T);

        if (subscribers.ContainsKey(messageType))
        {
            subscribers[messageType].Remove(handler);
        }
    }

    public static void Publish<T>(T message)
    {
        Type messageType = typeof(T);

        if (subscribers.ContainsKey(messageType))
        {
            foreach (var handler in subscribers[messageType])
            {
                ((Action<T>)handler).Invoke(message);
            }
        }
    }
}

// 使用
public class Player : MonoBehaviour
{
    void Die()
    {
        EventBus.Publish(new PlayerDiedMessage { Player = this });
    }
}

public class GameOverUI : MonoBehaviour
{
    void OnEnable()
    {
        EventBus.Subscribe<PlayerDiedMessage>(OnPlayerDied);
    }

    void OnDisable()
    {
        EventBus.Unsubscribe<PlayerDiedMessage>(OnPlayerDied);
    }

    void OnPlayerDied(PlayerDiedMessage message)
    {
        ShowGameOverScreen();
    }
}
```

## State Machine

### 簡單狀態機

```csharp
public enum EnemyState
{
    Idle,
    Patrol,
    Chase,
    Attack
}

public class EnemyAI : MonoBehaviour
{
    private EnemyState currentState;

    void Update()
    {
        switch (currentState)
        {
            case EnemyState.Idle:
                IdleState();
                break;
            case EnemyState.Patrol:
                PatrolState();
                break;
            case EnemyState.Chase:
                ChaseState();
                break;
            case EnemyState.Attack:
                AttackState();
                break;
        }
    }

    void IdleState()
    {
        // Idle 邏輯
        if (ShouldPatrol())
            ChangeState(EnemyState.Patrol);
    }

    void ChangeState(EnemyState newState)
    {
        ExitState(currentState);
        currentState = newState;
        EnterState(newState);
    }

    void EnterState(EnemyState state) { /* ... */ }
    void ExitState(EnemyState state) { /* ... */ }
}
```

### OOP 狀態機

```csharp
// 基類
public abstract class State
{
    public abstract void Enter();
    public abstract void Execute();
    public abstract void Exit();
}

// 具體狀態
public class IdleState : State
{
    private EnemyAI enemy;

    public IdleState(EnemyAI enemy)
    {
        this.enemy = enemy;
    }

    public override void Enter()
    {
        enemy.StopMoving();
    }

    public override void Execute()
    {
        if (enemy.CanSeePlayer())
        {
            enemy.ChangeState(new ChaseState(enemy));
        }
    }

    public override void Exit() { }
}

public class ChaseState : State
{
    private EnemyAI enemy;

    public ChaseState(EnemyAI enemy)
    {
        this.enemy = enemy;
    }

    public override void Enter()
    {
        enemy.SetSpeed(10f);
    }

    public override void Execute()
    {
        enemy.MoveTowards(enemy.Player.position);

        if (enemy.IsInAttackRange())
        {
            enemy.ChangeState(new AttackState(enemy));
        }
        else if (!enemy.CanSeePlayer())
        {
            enemy.ChangeState(new IdleState(enemy));
        }
    }

    public override void Exit() { }
}

// 狀態機
public class EnemyAI : MonoBehaviour
{
    private State currentState;

    void Start()
    {
        ChangeState(new IdleState(this));
    }

    void Update()
    {
        currentState?.Execute();
    }

    public void ChangeState(State newState)
    {
        currentState?.Exit();
        currentState = newState;
        currentState.Enter();
    }
}
```

## Project Structure

### 推薦的文件夾結構

```
Assets/
├── _Project/
│   ├── Art/
│   │   ├── Models/
│   │   ├── Textures/
│   │   ├── Materials/
│   │   └── Animations/
│   │
│   ├── Audio/
│   │   ├── Music/
│   │   ├── SFX/
│   │   └── Mixers/
│   │
│   ├── Prefabs/
│   │   ├── Characters/
│   │   ├── Enemies/
│   │   ├── Environment/
│   │   └── UI/
│   │
│   ├── Scenes/
│   │   ├── MainMenu.unity
│   │   ├── Level01.unity
│   │   └── Level02.unity
│   │
│   ├── Scripts/
│   │   ├── Core/               # 核心系統
│   │   │   ├── GameManager.cs
│   │   │   └── ServiceLocator.cs
│   │   │
│   │   ├── Gameplay/           # 遊戲邏輯
│   │   │   ├── Player/
│   │   │   ├── Enemies/
│   │   │   └── Items/
│   │   │
│   │   ├── UI/                 # UI 相關
│   │   │   ├── MainMenu/
│   │   │   └── HUD/
│   │   │
│   │   ├── Services/           # 服務層
│   │   │   ├── IAudioService.cs
│   │   │   └── AudioService.cs
│   │   │
│   │   └── Utilities/          # 工具類
│   │       ├── Extensions/
│   │       └── Helpers/
│   │
│   ├── ScriptableObjects/
│   │   ├── Events/
│   │   ├── GameData/
│   │   └── Config/
│   │
│   └── Settings/
│       ├── InputActions.inputactions
│       └── QualitySettings.asset
│
└── Plugins/                    # 第三方插件
    ├── VContainer/
    └── DOTween/
```

## Anti-Patterns to Avoid

### 1. God Object (上帝對象)

```csharp
// ❌ 一個類做所有事情
public class GameManager : MonoBehaviour
{
    // Player 相關
    public int playerHealth;
    public float playerSpeed;

    // Enemy 相關
    public List<Enemy> enemies;

    // UI 相關
    public Text scoreText;

    // Audio 相關
    public AudioSource bgm;

    // 數百行代碼...
}

// ✅ 拆分職責
public class PlayerManager { }
public class EnemySpawner { }
public class UIManager { }
public class AudioManager { }
```

### 2. Singleton 濫用

```csharp
// ❌ 所有東西都是 Singleton
public class PlayerManager : Singleton<PlayerManager> { }
public class EnemyManager : Singleton<EnemyManager> { }
public class ItemManager : Singleton<ItemManager> { }
// 全局狀態，難以測試

// ✅ 使用 DI 或 Service Locator
// 只對真正全局的管理器使用 Singleton
```

### 3. 緊耦合

```csharp
// ❌ 直接引用具體實現
public class Player : MonoBehaviour
{
    private AudioManager audioManager; // 緊耦合

    void Awake()
    {
        audioManager = FindObjectOfType<AudioManager>();
    }
}

// ✅ 依賴接口
public class Player : MonoBehaviour
{
    private IAudioService audioService;

    public void Initialize(IAudioService service)
    {
        this.audioService = service;
    }
}
```

## Architecture Decision Criteria

選擇架構模式時考慮：

1. **團隊規模** - 小團隊選簡單的，大團隊需要更嚴格的架構
2. **專案規模** - 小遊戲不需要複雜架構，大型專案必須
3. **性能要求** - 需要極致性能考慮 ECS
4. **可測試性** - 需要大量測試選 MVP/MVVM
5. **團隊經驗** - 團隊熟悉的模式更好
6. **維護週期** - 長期維護需要更好的架構

## Remember

- **不要過度設計** - 小專案不需要複雜架構
- **逐步重構** - 不要一開始就完美
- **解耦是關鍵** - UI、邏輯、數據分離
- **依賴接口而非實現** - Interface-based design
- **Event 解耦** - 跨系統通信用事件
- **單一職責** - 一個類一個職責
- **測試驅動** - 可測試的架構更好
- **團隊共識** - 架構要團隊都理解

