# ECS / Service Locator / DI / Event System 完整程式碼範例

## ECS (Unity DOTS)

```csharp
using Unity.Entities;
using Unity.Transforms;
using Unity.Mathematics;

// Component（純數據）
public struct MoveSpeed : IComponentData
{
    public float Value;
}

public struct Target : IComponentData
{
    public float3 Position;
}

// System（純邏輯）
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
EntityManager em = World.DefaultGameObjectInjectionWorld.EntityManager;
Entity entity = em.CreateEntity(typeof(Translation), typeof(MoveSpeed), typeof(Target));
em.SetComponentData(entity, new Translation { Value = float3.zero });
em.SetComponentData(entity, new MoveSpeed { Value = 5f });
em.SetComponentData(entity, new Target { Position = new float3(10, 0, 0) });
```

### 何時使用 ECS？

- **適合：** 大量同類實體（>1000）、需要 Burst + Job System
- **不適合：** 小型專案、複雜遊戲邏輯、團隊不熟悉 ECS

---

## Service Locator

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

// Service Locator 實現
public class ServiceLocator
{
    private static readonly Dictionary<Type, object> services = new();

    public static void Register<T>(T service) => services[typeof(T)] = service;

    public static T Get<T>()
    {
        if (services.TryGetValue(typeof(T), out object service))
            return (T)service;
        throw new Exception($"Service {typeof(T)} not registered");
    }

    public static void Unregister<T>() => services.Remove(typeof(T));
    public static void Clear() => services.Clear();
}

// 註冊
void Awake()
{
    ServiceLocator.Register<IAudioService>(new AudioService());
    ServiceLocator.Register<IDataService>(new PlayerPrefsDataService());
}

// 使用
void Attack()
{
    ServiceLocator.Get<IAudioService>().PlaySound("Attack");
}
```

---

## Dependency Injection

### 手動 DI (Constructor Injection)

```csharp
public class Player
{
    private readonly IAudioService audioService;
    private readonly IDataService dataService;

    public Player(IAudioService audioService, IDataService dataService)
    {
        this.audioService = audioService;
        this.dataService = dataService;
    }

    public void Attack() => audioService.PlaySound("Attack");
}
```

### VContainer (推薦框架)

```csharp
using VContainer;
using VContainer.Unity;

public class GameLifetimeScope : LifetimeScope
{
    protected override void Configure(IContainerBuilder builder)
    {
        builder.Register<IAudioService, AudioService>(Lifetime.Singleton);
        builder.Register<IDataService, PlayerPrefsDataService>(Lifetime.Singleton);
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
}
```

---

## Event System

### 方法 1：C# Static Events

```csharp
public static class GameEvents
{
    public static event Action<int> OnScoreChanged;
    public static event Action OnGameOver;
    public static event Action<Enemy> OnEnemyKilled;

    public static void RaiseScoreChanged(int newScore) => OnScoreChanged?.Invoke(newScore);
    public static void RaiseGameOver() => OnGameOver?.Invoke();
}

// 發布
void Die() => GameEvents.RaiseScoreChanged(100);

// 訂閱
void OnEnable() => GameEvents.OnScoreChanged += UpdateScore;
void OnDisable() => GameEvents.OnScoreChanged -= UpdateScore;
```

### 方法 2：ScriptableObject Events

```csharp
[CreateAssetMenu(menuName = "Events/Game Event")]
public class GameEvent : ScriptableObject
{
    private List<GameEventListener> listeners = new();

    public void Raise()
    {
        for (int i = listeners.Count - 1; i >= 0; i--)
            listeners[i].OnEventRaised();
    }

    public void RegisterListener(GameEventListener l) => listeners.Add(l);
    public void UnregisterListener(GameEventListener l) => listeners.Remove(l);
}

public class GameEventListener : MonoBehaviour
{
    [SerializeField] private GameEvent gameEvent;
    [SerializeField] private UnityEvent response;

    void OnEnable() => gameEvent.RegisterListener(this);
    void OnDisable() => gameEvent.UnregisterListener(this);
    public void OnEventRaised() => response?.Invoke();
}
```

### 方法 3：Event Bus（強類型消息）

```csharp
public class PlayerDiedMessage { public Player Player { get; set; } }
public class ScoreChangedMessage { public int NewScore { get; set; } }

public class EventBus
{
    private static Dictionary<Type, List<Delegate>> subscribers = new();

    public static void Subscribe<T>(Action<T> handler)
    {
        var type = typeof(T);
        if (!subscribers.ContainsKey(type))
            subscribers[type] = new List<Delegate>();
        subscribers[type].Add(handler);
    }

    public static void Unsubscribe<T>(Action<T> handler)
    {
        if (subscribers.TryGetValue(typeof(T), out var list))
            list.Remove(handler);
    }

    public static void Publish<T>(T message)
    {
        if (subscribers.TryGetValue(typeof(T), out var list))
            foreach (var handler in list)
                ((Action<T>)handler).Invoke(message);
    }
}

// 使用
void Die() => EventBus.Publish(new PlayerDiedMessage { Player = this });
void OnEnable() => EventBus.Subscribe<PlayerDiedMessage>(OnPlayerDied);
void OnDisable() => EventBus.Unsubscribe<PlayerDiedMessage>(OnPlayerDied);
```
