---
name: unity-object-pooling
description: |
  Unity 對象池模式與零分配策略。
  涵蓋 GameObject 池、集合池（ListPool）、StringBuilder 池、Unity 內建 ObjectPool、預熱策略。

  Use when: 需要對象池、減少 GC 分配、頻繁創建/銷毀物件、
  池化投射物/特效/音效、零分配模式、Switch 記憶體優化。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity 對象池指南

## 何時使用對象池

- 頻繁生成的物件（投射物、粒子、敵人）
- UI 列表項目
- 音效來源
- 任何高頻 Instantiate/Destroy 的物件
- **Elemenzy 必須池化：投射物、元素特效、區域 Zone、傷害數字**

## Unity 內建 ObjectPool (Unity 2021+)

### 基本用法

```csharp
using UnityEngine.Pool;

public class ProjectileSpawner : MonoBehaviour
{
    [SerializeField] private Projectile _prefab;

    private ObjectPool<Projectile> _pool;

    private void Awake()
    {
        _pool = new ObjectPool<Projectile>(
            createFunc: () =>
            {
                var proj = Instantiate(_prefab);
                proj.SetPool(_pool);
                return proj;
            },
            actionOnGet: proj => proj.gameObject.SetActive(true),
            actionOnRelease: proj => proj.gameObject.SetActive(false),
            actionOnDestroy: proj => Destroy(proj.gameObject),
            collectionCheck: true,
            defaultCapacity: 20,
            maxSize: 100
        );
    }

    public Projectile Spawn(Vector3 position, Quaternion rotation)
    {
        var proj = _pool.Get();
        proj.transform.SetPositionAndRotation(position, rotation);
        return proj;
    }
}
```

### 可池化物件基底類別

```csharp
public abstract class PooledObject<T> : MonoBehaviour where T : PooledObject<T>
{
    private IObjectPool<T> _pool;

    public void SetPool(IObjectPool<T> pool) => _pool = pool;

    public void ReturnToPool()
    {
        if (_pool != null)
            _pool.Release((T)this);
        else
            Destroy(gameObject);
    }

    public virtual void OnSpawn() { }
    public virtual void OnDespawn() { }
}

// 使用範例
public class ElementProjectile : PooledObject<ElementProjectile>
{
    private float _spawnTime;

    public override void OnSpawn()
    {
        _spawnTime = Time.time;
    }

    public override void OnDespawn()
    {
        // 重置所有狀態
    }
}
```

## 多 Prefab 池管理器

```csharp
public class PoolManager : MonoBehaviour
{
    public static PoolManager Instance { get; private set; }

    private readonly Dictionary<GameObject, ObjectPool<GameObject>> _pools = new();

    private void Awake() => Instance = this;

    public GameObject Spawn(
        GameObject prefab, Vector3 position, Quaternion rotation)
    {
        if (!_pools.TryGetValue(prefab, out var pool))
        {
            pool = CreatePool(prefab);
            _pools[prefab] = pool;
        }

        var obj = pool.Get();
        obj.transform.SetPositionAndRotation(position, rotation);
        return obj;
    }

    public void Despawn(GameObject obj, GameObject prefab)
    {
        if (_pools.TryGetValue(prefab, out var pool))
            pool.Release(obj);
        else
            Destroy(obj);
    }

    public void PrewarmPool(GameObject prefab, int count)
    {
        if (_pools.ContainsKey(prefab)) return;
        _pools[prefab] = CreatePool(prefab, count);
    }

    private ObjectPool<GameObject> CreatePool(
        GameObject prefab, int initialSize = 10)
    {
        var poolParent = new GameObject($"Pool_{prefab.name}").transform;
        poolParent.SetParent(transform);

        return new ObjectPool<GameObject>(
            createFunc: () =>
            {
                var obj = Instantiate(prefab, poolParent);
                obj.SetActive(false);
                return obj;
            },
            actionOnGet: obj => obj.SetActive(true),
            actionOnRelease: obj => obj.SetActive(false),
            actionOnDestroy: obj => Destroy(obj),
            defaultCapacity: initialSize,
            maxSize: 200
        );
    }
}
```

## 集合池（零 GC 分配關鍵）

### ListPool

```csharp
using UnityEngine.Pool;

// Unity 內建 ListPool
public void ProcessNearbyEnemies()
{
    // 從池中借用 List
    var list = ListPool<Enemy>.Get();
    try
    {
        GetEnemiesInRange(list);
        foreach (var enemy in list)
        {
            // 處理
        }
    }
    finally
    {
        // 歸還到池
        ListPool<Enemy>.Release(list);
    }
}
```

### 自訂 Disposable 包裝

```csharp
public struct PooledList<T> : IDisposable
{
    public List<T> List { get; }

    public PooledList(List<T> list) => List = list;

    public void Dispose() => ListPool<T>.Release(List);
}

// 使用：using 自動歸還
using (var pooled = new PooledList<Enemy>(ListPool<Enemy>.Get()))
{
    GetEnemiesInRange(pooled.List);
    foreach (var enemy in pooled.List)
    {
        // 處理
    }
} // 自動歸還
```

### StringBuilder Pool

```csharp
public static class SBPool
{
    private static readonly ObjectPool<StringBuilder> s_Pool = new(
        createFunc: () => new StringBuilder(256),
        actionOnRelease: sb => sb.Clear(),
        defaultCapacity: 5,
        maxSize: 50
    );

    public static StringBuilder Get() => s_Pool.Get();
    public static void Release(StringBuilder sb) => s_Pool.Release(sb);

    public static string GetStringAndRelease(StringBuilder sb)
    {
        string result = sb.ToString();
        Release(sb);
        return result;
    }
}
```

## 音效池

```csharp
public class AudioPool : MonoBehaviour
{
    [SerializeField] private AudioSource _prefab;

    private ObjectPool<AudioSource> _pool;

    private void Awake()
    {
        _pool = new ObjectPool<AudioSource>(
            createFunc: () =>
            {
                var source = Instantiate(_prefab, transform);
                source.gameObject.SetActive(false);
                return source;
            },
            actionOnGet: s => s.gameObject.SetActive(true),
            actionOnRelease: s =>
            {
                s.Stop();
                s.clip = null;
                s.gameObject.SetActive(false);
            },
            defaultCapacity: 20,
            maxSize: 40
        );
    }

    public void PlayOneShot(AudioClip clip, Vector3 position, float volume = 1f)
    {
        var source = _pool.Get();
        source.transform.position = position;
        source.clip = clip;
        source.volume = volume;
        source.Play();
        StartCoroutine(ReturnAfterPlay(source, clip.length));
    }

    private IEnumerator ReturnAfterPlay(AudioSource source, float delay)
    {
        yield return new WaitForSeconds(delay + 0.1f);
        _pool.Release(source);
    }
}
```

## 預熱策略

```csharp
public class PoolWarmer : MonoBehaviour
{
    [System.Serializable]
    public struct WarmupConfig
    {
        public GameObject Prefab;
        public int Count;
    }

    [SerializeField] private WarmupConfig[] _configs;

    private IEnumerator Start()
    {
        foreach (var config in _configs)
        {
            PoolManager.Instance.PrewarmPool(config.Prefab, config.Count);

            // 分散到多幀，避免加載卡頓
            if (config.Count > 10)
                yield return null;
        }
    }
}
```

## Elemenzy 專案池化需求

| 物件類型 | 預熱數量 | 最大數量 | 備註 |
|---------|---------|---------|------|
| ElementProjectile | 20 | 100 | 4 種元素各 25 |
| ZoneEffect | 10 | 50 | 火焰區、水域等 |
| DamageNumber | 15 | 60 | UI 傷害數字 |
| ParticleEffect | 20 | 80 | 元素特效 |
| AudioSource | 20 | 40 | 音效 |

## Best Practices

1. **預熱池** — 在載入畫面預建，避免運行時卡頓
2. **設定合理上限** — maxSize 防止記憶體無限增長
3. **在 Release 時重置狀態** — 不是在 Get 時
4. **使用 using 模式** — 集合池搭配 Disposable 自動歸還
5. **追蹤命中率** — 監控池是否大小適當
6. **場景切換時清理** — 防止記憶體洩漏
7. **使用 Unity 內建 Pool** — 優先使用 UnityEngine.Pool
8. **確定性模擬中禁止動態建立** — 只能從預熱池取用
