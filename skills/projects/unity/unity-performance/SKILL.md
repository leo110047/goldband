---
name: unity-performance
description: |
  Unity 性能優化專項指南，涵蓋 CPU/GPU/Memory/渲染/物理優化。
  使用 Profiler 分析瓶頸，應用針對性優化策略。

  Use when: 遊戲 FPS 低、卡頓、內存占用高、加載慢、GC 頻繁、
  使用 Profiler、優化渲染、優化物理、減少 Draw Calls。

  CRITICAL: 必須先使用 Profiler 測量，不要猜測瓶頸。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity Performance Optimization

## Core Principle: Measure First, Optimize Second

永遠先用 Profiler 測量 → 找出真正瓶頸 → 針對性優化 → 再次測量驗證。

## When to Use

- FPS 低於目標（<30 Switch, <60 PC）
- 卡頓或掉幀
- 內存占用過高
- GC 頻繁觸發
- 分析 Profiler 數據

**NOT for:** 架構設計（use unity-architecture）、通用代碼品質（use unity-best-practices）

> GPU/渲染/UI/Loading/Mobile 詳細優化見 [references/](references/) 目錄

## 關鍵指標

| 指標 | Switch | PC |
|------|--------|-----|
| FPS | 30+ | 60+ |
| CPU Main Thread | <33ms | <16ms |
| GC Alloc/Frame | 0 KB | 0 KB |
| Draw Calls | <500 | <1000 |

## Profiling 工作流

```csharp
// 在代碼中插入自定義 Profiler 標記
using Unity.Profiling;

private static readonly ProfilerMarker s_Marker = new("MySystem.Update");

void Update()
{
    using (s_Marker.Auto())
    {
        // 被測量的代碼
    }
}
```

## CPU Optimization

### 1. 緩存 Reference

```csharp
// ❌ 每幀查找
void Update() { GameObject.Find("Player"); }

// ✅ 緩存
private GameObject player;
void Start() { player = GameObject.FindGameObjectWithTag("Player"); }
```

### 2. 降低 Update 頻率

```csharp
// ❌ 每幀執行昂貴操作
void Update() { CheckForEnemies(); }

// ✅ 計時器降頻
private float nextCheckTime;
void Update()
{
    if (Time.time >= nextCheckTime)
    {
        CheckForEnemies();
        nextCheckTime = Time.time + 0.5f;
    }
}
```

### 3. 對象池

```csharp
// ❌ 頻繁 Instantiate/Destroy → GC 壓力
// ✅ 使用 UnityEngine.Pool.ObjectPool（詳見 unity-object-pooling skill）
```

### 4. 避免 Camera.main

```csharp
// ❌ 每次 Find
void Update() { Camera.main.WorldToScreenPoint(pos); }

// ✅ 緩存
private Camera mainCam;
void Start() { mainCam = Camera.main; }
```

### 5. CompareTag

```csharp
// ❌ 字符串比較（慢）
if (other.gameObject.tag == "Player")
// ✅ CompareTag（快）
if (other.gameObject.CompareTag("Player"))
```

## Memory Optimization

### 1. 避免 GC Allocation

```csharp
// ❌ 每幀產生垃圾
void Update()
{
    string text = "Score: " + score;           // 字符串拼接
    List<Enemy> enemies = GetEnemies();        // 每次新 List
}

// ✅ 重用
private StringBuilder sb = new StringBuilder();
private List<Enemy> enemyList = new List<Enemy>();

void Update()
{
    sb.Clear(); sb.Append("Score: "); sb.Append(score);
    enemyList.Clear(); GetEnemies(enemyList);
}
```

### 2. 避免裝箱 (Boxing)

```csharp
// ❌ 裝箱
object obj = 42;

// ✅ 避免裝箱
int value = 42;
Debug.Log($"Value: {value}");
```

### 3. 緩存 WaitForSeconds

```csharp
// ✅ 緩存
private WaitForSeconds wait = new WaitForSeconds(1f);
IEnumerator Attack()
{
    while (true) { yield return wait; }
}
```

### 4. 卸載資源

```csharp
// 場景切換時
Resources.UnloadUnusedAssets();
// Addressables
Addressables.Release(handle);
```

## Physics Optimization

### 1. Fixed Timestep

```csharp
// 降低物理更新頻率（預設 0.02 = 50Hz）
Time.fixedDeltaTime = 0.03f; // 33Hz，Switch 適用
```

### 2. 使用簡單 Collider

```csharp
// ✅ Primitive Colliders（快）
BoxCollider, SphereCollider, CapsuleCollider

// ❌ Mesh Collider（最慢）
```

### 3. Layer Collision Matrix

```
Edit → Project Settings → Physics → Layer Collision Matrix
只啟用必要的碰撞層
```

### 4. RaycastNonAlloc

```csharp
// ✅ 預分配陣列，零 GC
private RaycastHit[] results = new RaycastHit[10];
int hitCount = Physics.RaycastNonAlloc(origin, dir, results, 10f, layerMask);
```

## GPU & Rendering（簡要）

| 技術 | 說明 |
|------|------|
| Static Batching | 標記靜態物體，減少 Draw Calls |
| GPU Instancing | 同材質大量物體 |
| LOD | 遠處用低模 |
| Occlusion Culling | 剔除不可見物體 |
| Texture Compression | 平台適配壓縮格式 |

→ 詳見 [references/gpu-rendering.md](references/gpu-rendering.md)

## UI Optimization（簡要）

- **分割 Canvas** — Static / Dynamic / Overlay 分離
- **禁用 Raycast Target** — 不需交互的元素
- **UI 對象池** — 列表項目
- **避免 Layout Group 頻繁重算**

→ 詳見 [references/ui-loading-mobile.md](references/ui-loading-mobile.md)

## Quick Wins（十大快速優化）

1. 啟用 Static Batching
2. 啟用 GPU Instancing
3. 對象池化
4. 緩存 Component
5. 降低 Shadow Distance
6. Occlusion Culling
7. LOD
8. 壓縮紋理
9. Layer Collision Matrix
10. 降低物理頻率

## Profiling Checklist

### CPU:
- [ ] Update/FixedUpdate < 5ms
- [ ] 無每幀 Find/GetComponent
- [ ] GC.Alloc = 0 KB
- [ ] Coroutine < 100 個

### GPU:
- [ ] Draw Calls < 500 (Switch) / < 1000 (PC)
- [ ] SetPass Calls < 50
- [ ] Overdraw 合理

### Memory:
- [ ] 總內存 < 3 GB (Switch)
- [ ] GC < 1次/秒
- [ ] Texture/Mesh Memory 合理

### Physics:
- [ ] Physics.Processing < 5ms
- [ ] 使用 Layer Collision Matrix

## Remember

- **Measure First** — 永遠先 Profile
- **找真正瓶頸** — 不要優化不重要的 1%
- **一次優化一個** — 才能驗證效果
- **CPU vs GPU** — 確定瓶頸在哪裡
- **GC = 0** — 運行時零 GC Allocation
- **對象池** — 頻繁創建/銷毀必須池化
