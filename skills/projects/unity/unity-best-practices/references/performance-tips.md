# Performance Tips 完整程式碼範例

## 緩存 Component

```csharp
// ❌ 每幀 GetComponent
void Update()
{
    Rigidbody rb = GetComponent<Rigidbody>();
    rb.AddForce(Vector3.up);
}

// ✅ 緩存
private Rigidbody rb;
void Awake() => rb = GetComponent<Rigidbody>();
void Update() => rb.AddForce(Vector3.up);
```

## 對象池

```csharp
// ❌ 頻繁 Instantiate/Destroy
void Fire()
{
    GameObject bullet = Instantiate(bulletPrefab, firePoint.position, firePoint.rotation);
    Destroy(bullet, 3f);
}

// ✅ 對象池
public class BulletPool : MonoBehaviour
{
    [SerializeField] private GameObject bulletPrefab;
    [SerializeField] private int poolSize = 50;
    private Queue<GameObject> pool = new Queue<GameObject>();

    void Start()
    {
        for (int i = 0; i < poolSize; i++)
        {
            GameObject bullet = Instantiate(bulletPrefab);
            bullet.SetActive(false);
            pool.Enqueue(bullet);
        }
    }

    public GameObject GetBullet()
    {
        if (pool.Count > 0)
        {
            GameObject bullet = pool.Dequeue();
            bullet.SetActive(true);
            return bullet;
        }
        return Instantiate(bulletPrefab);
    }

    public void ReturnBullet(GameObject bullet)
    {
        bullet.SetActive(false);
        pool.Enqueue(bullet);
    }
}
```

## String Allocation

```csharp
// ❌ 每幀創建字符串
void Update()
{
    scoreText.text = "Score: " + score.ToString(); // 每幀垃圾
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
private StringBuilder sb = new StringBuilder();
void UpdateText()
{
    sb.Clear();
    sb.Append("Score: ");
    sb.Append(score);
    scoreText.text = sb.ToString();
}
```

## 緩存 WaitForSeconds

```csharp
// ❌ 每次創建新的（GC 垃圾）
IEnumerator SpawnEnemies()
{
    while (true)
    {
        SpawnEnemy();
        yield return new WaitForSeconds(1f);
    }
}

// ✅ 緩存
private WaitForSeconds wait = new WaitForSeconds(1f);
IEnumerator SpawnEnemies()
{
    while (true)
    {
        SpawnEnemy();
        yield return wait;
    }
}

// ✅ 全局緩存常用值
public static class WaitCache
{
    public static readonly WaitForSeconds Wait01 = new(0.1f);
    public static readonly WaitForSeconds Wait05 = new(0.5f);
    public static readonly WaitForSeconds Wait1 = new(1f);
    public static readonly WaitForEndOfFrame EndOfFrame = new();
}
```

## 避免 Camera.main

```csharp
// ❌ 每次 Find 查找
void Update() => Camera.main.WorldToScreenPoint(transform.position);

// ✅ 緩存
private Camera mainCamera;
void Start() => mainCamera = Camera.main;
void Update() => mainCamera.WorldToScreenPoint(transform.position);
```

## Scene Management

```csharp
using UnityEngine.SceneManagement;

// ✅ 異步加載場景
public IEnumerator LoadSceneAsync(string sceneName)
{
    AsyncOperation op = SceneManager.LoadSceneAsync(sceneName);
    while (!op.isDone)
    {
        float progress = Mathf.Clamp01(op.progress / 0.9f);
        loadingBar.value = progress;
        yield return null;
    }
}

// ✅ Additive 加載
SceneManager.LoadScene("UI", LoadSceneMode.Additive);

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

## Testing

```csharp
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
    public IEnumerator Player_DiesAfterLethalDamage()
    {
        var player = new GameObject().AddComponent<Player>();
        player.TakeDamage(100);
        yield return null;
        Assert.IsFalse(player.IsAlive);
    }
}
```
