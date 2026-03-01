---
name: unity-profiling
description: |
  Unity 效能分析與優化工具指南。
  涵蓋 ProfilerMarker、FrameTimingManager、記憶體分析、GC 追蹤、Hitch 偵測、效能預算。

  Use when: 效能分析、使用 Profiler、追蹤 GC 分配、偵測卡頓、
  設定效能預算、記憶體分析、Switch/PC 平台優化。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity 效能分析指南

## 核心原則：先測量，再優化

絕對不要猜測效能瓶頸。永遠先用 Profiler 測量 → 找出真正瓶頸 → 針對性優化 → 再次測量驗證。

## 目標效能指標

| 指標 | Switch (Dock) | Switch (Handheld) | PC |
|------|--------------|-------------------|-----|
| FPS | 30 穩定 | 30 穩定 | 60 |
| CPU 主線程 | <33ms | <33ms | <16ms |
| GC Alloc/Frame | 0 KB | 0 KB | 0 KB |
| Memory | <3 GB | <3 GB | <4 GB |

## ProfilerMarker

### 基本用法

```csharp
using Unity.Profiling;

public class CombatSystem
{
    private static readonly ProfilerMarker s_UpdateMarker = new(
        ProfilerCategory.Scripts,
        "CombatSystem.Update"
    );

    public void Update()
    {
        using (s_UpdateMarker.Auto())
        {
            ProcessCombat();
        }
    }
}
```

### 巢狀標記（分析子系統）

```csharp
public class GameLoop
{
    private static readonly ProfilerMarker s_UpdateMarker = new("GameLoop.Update");
    private static readonly ProfilerMarker s_PhysicsMarker = new("GameLoop.Physics");
    private static readonly ProfilerMarker s_AIMarker = new("GameLoop.AI");

    public void Update()
    {
        using (s_UpdateMarker.Auto())
        {
            using (s_PhysicsMarker.Auto())
                UpdatePhysics();

            using (s_AIMarker.Auto())
                UpdateAI();
        }
    }
}
```

## FrameTimingManager

### 持續監控

```csharp
public class PerformanceMonitor : MonoBehaviour
{
    private readonly FrameTiming[] _frameTimings = new FrameTiming[30];
    private float _avgCpuTime;
    private float _avgGpuTime;
    private float _maxFrameTime;

    private void Update()
    {
        if (!FrameTimingManager.IsFeatureEnabled()) return;

        FrameTimingManager.CaptureFrameTimings();
        var count = FrameTimingManager.GetLatestTimings(
            _frameTimings.Length, _frameTimings);

        if (count > 0)
        {
            float totalCpu = 0, totalGpu = 0;
            _maxFrameTime = 0;
            int gpuCount = 0;

            for (int i = 0; i < count; i++)
            {
                totalCpu += _frameTimings[i].cpuFrameTime;
                if (_frameTimings[i].gpuFrameTime > 0)
                {
                    totalGpu += _frameTimings[i].gpuFrameTime;
                    gpuCount++;
                }
                _maxFrameTime = Mathf.Max(_maxFrameTime,
                    Mathf.Max(_frameTimings[i].cpuFrameTime,
                              _frameTimings[i].gpuFrameTime));
            }

            _avgCpuTime = totalCpu / count;
            _avgGpuTime = gpuCount > 0 ? totalGpu / gpuCount : 0;
        }
    }
}
```

## 記憶體分析

### 記憶體快照

```csharp
using UnityEngine.Profiling;

public readonly struct MemorySnapshot
{
    public readonly long TotalAllocated;
    public readonly long MonoUsed;
    public readonly long MonoHeap;
    public readonly long GfxDriver;

    public long TotalMB => TotalAllocated / 1_000_000;
    public long MonoMB => MonoUsed / 1_000_000;

    public static MemorySnapshot Capture()
    {
        return new MemorySnapshot(
            Profiler.GetTotalAllocatedMemoryLong(),
            Profiler.GetMonoUsedSizeLong(),
            Profiler.GetMonoHeapSizeLong(),
            Profiler.GetAllocatedMemoryForGraphicsDriver()
        );
    }
}
```

### GC 分配追蹤

```csharp
public class GCAllocationTracker
{
    private long _lastGCMemory;
    private int _lastGCCount;

    public void BeginFrame()
    {
        _lastGCMemory = GC.GetTotalMemory(false);
        _lastGCCount = GC.CollectionCount(0);
    }

    public (long allocated, bool gcOccurred) EndFrame()
    {
        var currentMemory = GC.GetTotalMemory(false);
        var currentGCCount = GC.CollectionCount(0);

        var allocated = currentMemory - _lastGCMemory;
        var gcOccurred = currentGCCount > _lastGCCount;

        if (allocated > 1024)
            Debug.LogWarning($"Frame allocated {allocated} bytes");

        return (allocated, gcOccurred);
    }
}
```

## Hitch 偵測

### 卡頓偵測器

```csharp
public class HitchDetector : MonoBehaviour
{
    // Switch 以 30 FPS 為目標
    private const float MinorHitchMs = 40f;   // < 25 FPS
    private const float MajorHitchMs = 66f;   // < 15 FPS
    private const float SevereHitchMs = 100f;  // < 10 FPS

    public event Action<float, HitchSeverity> OnHitchDetected;

    private void Update()
    {
        var frameTimeMs = Time.unscaledDeltaTime * 1000f;

        if (frameTimeMs >= SevereHitchMs)
            OnHitchDetected?.Invoke(frameTimeMs, HitchSeverity.Severe);
        else if (frameTimeMs >= MajorHitchMs)
            OnHitchDetected?.Invoke(frameTimeMs, HitchSeverity.Major);
        else if (frameTimeMs >= MinorHitchMs)
            OnHitchDetected?.Invoke(frameTimeMs, HitchSeverity.Minor);
    }
}

public enum HitchSeverity { Minor, Major, Severe }
```

## 效能預算系統

### Frame Budget

```csharp
public class FrameBudgetManager
{
    private readonly Dictionary<string, float> _budgets = new();
    private readonly Dictionary<string, float> _actuals = new();

    // Switch Dock: 30 FPS = 33.33ms
    public float TotalBudgetMs { get; } = 33.33f;

    public void SetBudget(string system, float budgetMs)
    {
        _budgets[system] = budgetMs;
    }

    public void RecordActual(string system, float actualMs)
    {
        _actuals[system] = actualMs;
        if (_budgets.TryGetValue(system, out var budget) && actualMs > budget)
            Debug.LogWarning($"{system} over budget: {actualMs:F2}ms / {budget:F2}ms");
    }

    public bool IsWithinBudget()
    {
        float total = 0;
        foreach (var v in _actuals.Values) total += v;
        return total <= TotalBudgetMs;
    }
}
```

### Elemenzy 建議預算分配（Switch 30 FPS）

| 系統 | 預算 (ms) |
|------|----------|
| Simulation Tick | 8.0 |
| Physics | 4.0 |
| Rendering | 12.0 |
| Networking | 3.0 |
| UI | 2.0 |
| 其他 | 4.33 |
| **合計** | **33.33** |

## 自訂 Profiler Counter

```csharp
using Unity.Profiling;

public static class ElemenzyProfilerCounters
{
    public static readonly ProfilerCounter<int> ActiveProjectiles = new(
        ProfilerCategory.Scripts, "Active Projectiles",
        ProfilerMarkerDataUnit.Count);

    public static readonly ProfilerCounter<int> ActiveZones = new(
        ProfilerCategory.Scripts, "Active Zones",
        ProfilerMarkerDataUnit.Count);

    public static readonly ProfilerCounter<int> ChainReactionDepth = new(
        ProfilerCategory.Scripts, "Chain Depth",
        ProfilerMarkerDataUnit.Count);
}

// 在 Update 中取樣
ElemenzyProfilerCounters.ActiveProjectiles.Sample(projectileCount);
```

## 確定性模擬效能注意事項

- **FixedUpdate tick 必須在預算內完成**，否則累積延遲
- **禁止在模擬邏輯中分配 GC**（使用 struct、預分配陣列）
- **ProfilerMarker 包裹每個子系統**（InteractionResolver、ChainReaction 等）
- **Switch 上一定要用 Development Build 測量**，Editor 不準確

## Profiling Checklist

### CPU:
- [ ] FixedUpdate tick < 8ms (Switch)
- [ ] 無每幀 Find/GetComponent
- [ ] GC.Alloc = 0 KB
- [ ] 無不必要的 LINQ / string 拼接

### Memory:
- [ ] 總記憶體 < 3 GB (Switch)
- [ ] GC 不頻繁觸發
- [ ] 對象池正常回收

### 網路:
- [ ] 狀態同步 < 3ms
- [ ] 封包大小合理

## Best Practices

1. **使用 ProfilerMarker** — 為自定義系統加標記
2. **Zero-alloc 運行時** — 模擬期間零 GC 分配
3. **在目標設備上測** — Switch Development Build
4. **設定效能預算** — 開發初期就定義
5. **追蹤最差幀** — 記錄 worst-case frames
6. **逐一優化** — 每次只改一個變量，才能驗證效果
