---
name: unity-performance
description: |
  Unity 性能優化專項指南，涵蓋 CPU/GPU/Memory/渲染/物理優化。
  使用 Profiler 分析瓶頸，應用針對性優化策略。

  Use when: 遊戲 FPS 低、卡頓、內存占用高、加載慢、GC 頻繁、
  使用 Profiler、優化渲染、優化物理、減少 Draw Calls。

  CRITICAL: 必須先使用 Profiler 測量，不要猜測瓶頸。
  Focus: Unity 特定性能優化，不是通用代碼優化。
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Unity Performance Optimization

## Core Principle: Measure First, Optimize Second

```
⚠️ 絕對不要猜測性能瓶頸！
✅ 永遠先用 Profiler 測量
✅ 找出真正的瓶頸
✅ 應用針對性優化
✅ 再次測量驗證效果
```

## When to Use This Skill

- 遊戲 FPS 低於目標（<30 FPS mobile, <60 FPS PC）
- 出現卡頓或掉幀
- 內存占用過高或 OOM
- 加載時間過長
- GC（垃圾回收）頻繁觸發
- 分析 Profiler 數據
- 優化 Draw Calls
- 減少 SetPass Calls

**NOT for:**
- 架構設計（use unity-architecture）
- 通用代碼品質（use unity-best-practices）

## Profiling 工作流

### 1. Window → Analysis → Profiler

```csharp
// 在代碼中插入自定義 Profiler 標記
using UnityEngine.Profiling;

public class EnemySpawner : MonoBehaviour
{
    void Update()
    {
        Profiler.BeginSample("Spawn Enemies");
        SpawnEnemies();
        Profiler.EndSample();

        Profiler.BeginSample("Update Enemy AI");
        UpdateEnemyAI();
        Profiler.EndSample();
    }
}
```

### 2. 關鍵指標

| 指標 | 目標值（Mobile） | 目標值（PC） |
|------|-----------------|------------|
| FPS | 30+ | 60+ |
| CPU Main Thread | <33ms | <16ms |
| Rendering | <10ms | <5ms |
| GC Alloc/Frame | 0 KB | 0 KB |
| Draw Calls | <100 | <1000 |
| Batches | <100 | <500 |

### 3. Profiler 模塊

- **CPU Usage** - 找出耗時的腳本和系統
- **GPU Usage** - 找出渲染瓶頸
- **Memory** - 找出內存泄漏
- **Rendering** - 分析 Draw Calls, Batches
- **Physics** - 物理計算耗時

## CPU Optimization

### 1. 避免每幀調用的昂貴操作

```csharp
// ❌ 非常慢 - 每幀查找
void Update()
{
    GameObject player = GameObject.Find("Player");
    Transform enemy = transform.Find("Enemy");
}

// ✅ 緩存 Reference
private GameObject player;
private Transform enemy;

void Start()
{
    player = GameObject.FindGameObjectWithTag("Player");
    enemy = transform.Find("Enemy");
}

void Update()
{
    // 使用緩存的 reference
}
```

### 2. 減少 Update/FixedUpdate 頻率

```csharp
// ❌ 每幀執行（60 FPS = 60次/秒）
void Update()
{
    CheckForEnemies(); // 昂貴的操作
}

// ✅ 使用計時器降低頻率
private float checkInterval = 0.5f; // 每 0.5 秒
private float nextCheckTime = 0f;

void Update()
{
    if (Time.time >= nextCheckTime)
    {
        CheckForEnemies();
        nextCheckTime = Time.time + checkInterval;
    }
}

// ✅ 或使用 InvokeRepeating
void Start()
{
    InvokeRepeating(nameof(CheckForEnemies), 0f, 0.5f);
}
```

### 3. 對象池 (Object Pooling)

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
        // 池子用完了，動態創建
        return Instantiate(bulletPrefab);
    }

    public void ReturnBullet(GameObject bullet)
    {
        bullet.SetActive(false);
        pool.Enqueue(bullet);
    }
}

// 使用
void Fire()
{
    GameObject bullet = bulletPool.GetBullet();
    bullet.transform.position = firePoint.position;
    bullet.transform.rotation = firePoint.rotation;

    // 3 秒後歸還
    StartCoroutine(ReturnAfterDelay(bullet, 3f));
}

IEnumerator ReturnAfterDelay(GameObject bullet, float delay)
{
    yield return new WaitForSeconds(delay);
    bulletPool.ReturnBullet(bullet);
}
```

### 4. 避免 Camera.main

```csharp
// ❌ 每次都用 Find 查找
void Update()
{
    Camera.main.WorldToScreenPoint(transform.position);
}

// ✅ 緩存
private Camera mainCamera;

void Start()
{
    mainCamera = Camera.main; // 只查找一次
}

void Update()
{
    mainCamera.WorldToScreenPoint(transform.position);
}
```

### 5. 使用 CompareTag 而不是 ==

```csharp
// ❌ 字符串比較（慢）
if (other.gameObject.tag == "Player")

// ✅ 使用 CompareTag（快）
if (other.gameObject.CompareTag("Player"))
```

## GPU & Rendering Optimization

### 1. 減少 Draw Calls

**Static Batching:**

```csharp
// 標記為 Static
// Inspector → Static → Batching Static

// 或代碼中設置
gameObject.isStatic = true;
```

**Dynamic Batching:**
- 同材質的小網格自動批處理
- <300 頂點
- 同 material, 同 shader

**GPU Instancing:**

```csharp
// 材質啟用 GPU Instancing
// Shader → Enable GPU Instancing

// 使用 Graphics.DrawMeshInstanced
public void DrawInstanced()
{
    Matrix4x4[] matrices = new Matrix4x4[count];
    for (int i = 0; i < count; i++)
    {
        matrices[i] = Matrix4x4.TRS(positions[i], rotations[i], scales[i]);
    }

    Graphics.DrawMeshInstanced(mesh, 0, material, matrices);
}
```

**SRP Batcher (URP/HDRP):**

```csharp
// 使用 SRP 兼容的 Shader
// 避免每個 Material 都不同
// 確保 Material Properties 在 Shader 中使用 CBUFFER
```

### 2. LOD (Level of Detail)

```csharp
// 添加 LOD Group 組件
LODGroup lodGroup = gameObject.AddComponent<LODGroup>();

LOD[] lods = new LOD[3];

// LOD 0 - 近距離 (100% - 50%)
Renderer[] lod0Renderers = new Renderer[] { highPolyRenderer };
lods[0] = new LOD(0.5f, lod0Renderers);

// LOD 1 - 中距離 (50% - 20%)
Renderer[] lod1Renderers = new Renderer[] { mediumPolyRenderer };
lods[1] = new LOD(0.2f, lod1Renderers);

// LOD 2 - 遠距離 (20% - 0%)
Renderer[] lod2Renderers = new Renderer[] { lowPolyRenderer };
lods[2] = new LOD(0.05f, lod2Renderers);

lodGroup.SetLODs(lods);
lodGroup.RecalculateBounds();
```

### 3. Occlusion Culling

```
Window → Rendering → Occlusion Culling

1. 標記場景物件為 Occluder Static
2. 烘培 Occlusion Data
3. 運行時自動剔除看不見的物體
```

### 4. 優化 Fill Rate

```csharp
// ❌ 透明物體太多（Overdraw 嚴重）
// ❌ 全屏後處理太多

// ✅ 減少透明物體
// ✅ 使用 Alpha Test 而不是 Alpha Blend
// ✅ 降低後處理品質或解析度

// Scene View → Overdraw 模式查看重繪
```

### 5. 紋理優化

```csharp
// ✅ 使用 Texture Compression
// Android: ASTC, ETC2
// iOS: ASTC, PVRTC
// PC: DXT (BC)

// ✅ 使用 Mipmap
texture.mipmapBias = -0.5f;

// ✅ 降低紋理解析度
// Max Size: 2048 → 1024 (移動端)

// ✅ 使用 Texture Atlas
// 合併多個小紋理到一張大紋理
```

### 6. Shader 優化

```hlsl
// ❌ 昂貴的操作
float4 frag() {
    // 避免在 Fragment Shader 中計算
    float3 worldPos = mul(unity_ObjectToWorld, input.vertex);
    float dist = length(worldPos - _WorldSpaceLightPos0);
}

// ✅ 移到 Vertex Shader
v2f vert() {
    output.worldPos = mul(unity_ObjectToWorld, input.vertex);
    output.lightDist = length(output.worldPos - _WorldSpaceLightPos0);
}

float4 frag(v2f input) {
    // 直接使用
    float dist = input.lightDist;
}
```

## Memory Optimization

### 1. 避免 GC Allocation

```csharp
// ❌ 每幀產生垃圾
void Update()
{
    string text = "Score: " + score; // 字符串拼接
    List<Enemy> enemies = GetEnemies(); // 每次創建新 List
}

// ✅ 減少分配
private StringBuilder sb = new StringBuilder();
private List<Enemy> enemyList = new List<Enemy>();

void Update()
{
    // 使用 StringBuilder
    sb.Clear();
    sb.Append("Score: ");
    sb.Append(score);

    // 重用 List
    enemyList.Clear();
    GetEnemies(enemyList); // 傳入已存在的 List
}
```

### 2. 避免裝箱 (Boxing)

```csharp
// ❌ 裝箱（值類型 → 引用類型）
object obj = 42; // int 裝箱
Debug.Log("Value: " + obj); // 再次裝箱

// ✅ 避免裝箱
int value = 42;
Debug.Log($"Value: {value}"); // 使用插值字符串
```

### 3. 緩存 WaitForSeconds

```csharp
// ❌ 每次創建新的
IEnumerator Attack()
{
    while (true)
    {
        yield return new WaitForSeconds(1f); // 產生垃圾
    }
}

// ✅ 緩存
private WaitForSeconds attackDelay = new WaitForSeconds(1f);

IEnumerator Attack()
{
    while (true)
    {
        yield return attackDelay; // 重用
    }
}

// ✅ 全局緩存常用值
public static class WaitCache
{
    public static readonly WaitForSeconds Wait01 = new WaitForSeconds(0.1f);
    public static readonly WaitForSeconds Wait05 = new WaitForSeconds(0.5f);
    public static readonly WaitForSeconds Wait1 = new WaitForSeconds(1f);
    public static readonly WaitForEndOfFrame WaitForEndOfFrame = new WaitForEndOfFrame();
}
```

### 4. 卸載不需要的資源

```csharp
// ✅ 場景切換時卸載
void LoadNextLevel()
{
    // 卸載未使用的資源
    Resources.UnloadUnusedAssets();

    // 強制 GC（慎用，會造成卡頓）
    System.GC.Collect();

    SceneManager.LoadScene("NextLevel");
}

// ✅ 使用 Addressables 管理資源生命週期
await Addressables.LoadAssetAsync<GameObject>("Enemy").Task;
// 使用後釋放
Addressables.Release(enemyHandle);
```

### 5. Audio Clip Settings

```
Load Type:
- Decompress On Load: 小文件，頻繁播放（SFX）
- Compressed In Memory: 中等文件（背景音樂）
- Streaming: 大文件（長音樂）

Compression Format:
- Vorbis: 高壓縮率（背景音樂）
- ADPCM: 低延遲（SFX）
- PCM: 無壓縮（短音效）
```

## Physics Optimization

### 1. Fixed Timestep 調整

```csharp
// Edit → Project Settings → Time

// 降低物理更新頻率
Time.fixedDeltaTime = 0.02f; // 50 Hz (默認)
// 改為
Time.fixedDeltaTime = 0.03f; // 33 Hz (移動端)
```

### 2. 使用簡單 Collider

```csharp
// ❌ Mesh Collider (最慢)
MeshCollider meshCollider;

// ✅ Primitive Colliders (快)
BoxCollider boxCollider;
SphereCollider sphereCollider;
CapsuleCollider capsuleCollider;

// 複雜形狀使用多個 primitive
```

### 3. Layer-based Collision

```
Edit → Project Settings → Physics → Layer Collision Matrix

只啟用必要的碰撞檢測：
- Player ↔ Enemy ✓
- Player ↔ Bullet ✓
- Bullet ↔ Bullet ✗ (不需要)
```

### 4. Rigidbody 優化

```csharp
// ✅ 靜止物體設為 Kinematic
if (!isMoving)
{
    rb.isKinematic = true;
}

// ✅ 使用 Continuous Detection 時謹慎
rb.collisionDetectionMode = CollisionDetectionMode.Discrete; // 默認，最快

// 只在需要時使用 Continuous (避免高速穿透)
rb.collisionDetectionMode = CollisionDetectionMode.Continuous;

// ✅ 減少 Rigidbody 數量
// 合併多個靜態物體到一個 Mesh + 一個 Collider
```

### 5. Raycast 優化

```csharp
// ❌ 無限距離
if (Physics.Raycast(origin, direction))

// ✅ 限制距離
if (Physics.Raycast(origin, direction, maxDistance: 10f))

// ✅ 使用 Layer Mask
int layerMask = LayerMask.GetMask("Enemy", "Environment");
if (Physics.Raycast(origin, direction, out hit, 10f, layerMask))

// ✅ 使用 RaycastNonAlloc 避免分配
private RaycastHit[] results = new RaycastHit[10];

int hitCount = Physics.RaycastNonAlloc(origin, direction, results, 10f);
for (int i = 0; i < hitCount; i++)
{
    // 處理 results[i]
}
```

## UI Optimization

### 1. Canvas 分割

```csharp
// ❌ 所有 UI 在一個 Canvas
// 任何元素改變都會重建整個 Canvas

// ✅ 分割成多個 Canvas
// - Static Canvas (背景、框架)
// - Dynamic Canvas (經常變動的元素，如 HP bar)
// - Overlay Canvas (彈窗)

// 設置不同的 Canvas
staticCanvas.sortingOrder = 0;
dynamicCanvas.sortingOrder = 1;
overlayCanvas.sortingOrder = 2;
```

### 2. 禁用 Raycast Target

```csharp
// ✅ 不需要交互的元素禁用 Raycast Target
// Image, Text → Raycast Target = false

// 減少 UI Raycast 計算
```

### 3. 使用 Object Pool for UI

```csharp
// ❌ 每次創建新的 UI 元素
GameObject item = Instantiate(itemPrefab, scrollView.content);

// ✅ UI 對象池
public class UIPool : MonoBehaviour
{
    [SerializeField] private GameObject itemPrefab;
    private Stack<GameObject> pool = new Stack<GameObject>();

    public GameObject Get()
    {
        if (pool.Count > 0)
        {
            GameObject item = pool.Pop();
            item.SetActive(true);
            return item;
        }
        return Instantiate(itemPrefab, transform);
    }

    public void Return(GameObject item)
    {
        item.SetActive(false);
        pool.Push(item);
    }
}
```

### 4. 避免 Layout Group 在運行時重算

```csharp
// ✅ Layout Group 昂貴，避免頻繁觸發
// 禁用不必要的 Layout Component

// 批量更新後再啟用
layoutGroup.enabled = false;
// 添加多個子物件
for (int i = 0; i < 100; i++)
{
    AddItem();
}
layoutGroup.enabled = true;
LayoutRebuilder.ForceRebuildLayoutImmediate(rectTransform);
```

## Loading Time Optimization

### 1. Asynchronous Loading

```csharp
// ✅ 異步加載場景
IEnumerator LoadSceneAsync(string sceneName)
{
    AsyncOperation operation = SceneManager.LoadSceneAsync(sceneName);
    operation.allowSceneActivation = false;

    while (operation.progress < 0.9f)
    {
        loadingBar.value = operation.progress;
        yield return null;
    }

    // 顯示 "Press any key to continue"
    yield return new WaitUntil(() => Input.anyKeyDown);

    operation.allowSceneActivation = true;
}
```

### 2. Addressables

```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

// ✅ 異步加載資源
AsyncOperationHandle<GameObject> handle = Addressables.LoadAssetAsync<GameObject>("Enemy");
yield return handle;

if (handle.Status == AsyncOperationStatus.Succeeded)
{
    GameObject enemy = handle.Result;
    Instantiate(enemy);
}

// 釋放
Addressables.Release(handle);
```

### 3. 預加載

```csharp
// ✅ 在加載畫面預加載常用資源
IEnumerator PreloadAssets()
{
    // 預加載音效
    AudioClip[] clips = Resources.LoadAll<AudioClip>("Audio/SFX");

    // 預實例化對象池
    yield return bulletPool.Initialize();

    // 預加載 Shader
    Shader.WarmupAllShaders();
}
```

## Mobile-Specific Optimization

### 1. Quality Settings

```
Edit → Project Settings → Quality

Mobile (iOS/Android):
- Shadow Distance: 20
- Shadow Resolution: Low
- Texture Quality: Half Res / Quarter Res
- Anti Aliasing: Disabled
- Soft Particles: Disabled
- Realtime Reflection Probes: Disabled
```

### 2. 降低目標幀率

```csharp
// ✅ 移動設備目標 30 FPS 節省電量
Application.targetFrameRate = 30;

// ✅ PC 目標 60 FPS
#if UNITY_STANDALONE
    Application.targetFrameRate = 60;
#elif UNITY_IOS || UNITY_ANDROID
    Application.targetFrameRate = 30;
#endif
```

### 3. 使用移動端優化的 Shader

```
// ✅ 使用 Mobile Shaders
Mobile/Diffuse
Mobile/Bumped Specular
Mobile/Unlit (最快)

// 避免標準 Shader（太重）
```

## Profiling Checklist

使用 Profiler 時檢查：

### CPU:
- [ ] Update/FixedUpdate 耗時 < 5ms
- [ ] 沒有每幀執行的 Find/GetComponent
- [ ] GC.Alloc = 0 KB
- [ ] Coroutine 不超過 100 個

### GPU:
- [ ] Draw Calls < 100 (mobile) / < 1000 (PC)
- [ ] Batches < 100 (mobile) / < 500 (PC)
- [ ] Overdraw 合理（Scene View → Overdraw 模式）
- [ ] SetPass Calls < 50

### Memory:
- [ ] 總內存 < 512MB (mobile) / < 2GB (PC)
- [ ] GC 不頻繁觸發（< 1次/秒）
- [ ] Texture Memory 合理
- [ ] Mesh Memory 合理

### Physics:
- [ ] Physics.Processing < 5ms
- [ ] Rigidbody 數量 < 100 (mobile)
- [ ] 使用 Layer Collision Matrix

## Quick Wins (快速優化)

1. **啟用 Static Batching** - 標記靜態物體
2. **啟用 GPU Instancing** - 材質上勾選
3. **對象池** - 頻繁創建/銷毀的物體
4. **緩存 Component** - 不在 Update 中 GetComponent
5. **降低 Shadow Distance** - Quality Settings
6. **Occlusion Culling** - 大場景必備
7. **LOD** - 遠處物體使用低模
8. **壓縮紋理** - 啟用 Texture Compression
9. **Layer Collision Matrix** - 只啟用必要的碰撞
10. **降低物理頻率** - Fixed Timestep 提高到 0.03

## Remember

- **Measure First** - 永遠先 Profile，不要猜測
- **找真正的瓶頸** - 不要優化不重要的 1%
- **一次優化一個** - 才能驗證效果
- **再次測量** - 確認優化有效
- **CPU vs GPU** - 確定瓶頸在哪裡
- **移動端更嚴格** - 目標更低，限制更多
- **對象池** - 頻繁創建/銷毀必須池化
- **GC = 0** - 運行時不應有任何 GC Allocation

