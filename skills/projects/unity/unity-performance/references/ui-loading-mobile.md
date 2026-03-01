# UI / Loading / Platform-Specific Optimization

## UI Optimization

### Canvas 分割

```csharp
// ❌ 所有 UI 在一個 Canvas → 任何改變重建整個 Canvas

// ✅ 分割成多個 Canvas
// - Static Canvas（背景、框架）
// - Dynamic Canvas（HP bar 等經常變動元素）
// - Overlay Canvas（彈窗）
staticCanvas.sortingOrder = 0;
dynamicCanvas.sortingOrder = 1;
overlayCanvas.sortingOrder = 2;
```

### 禁用 Raycast Target

```csharp
// ✅ 不需要交互的 Image/Text → Raycast Target = false
// 減少 UI Raycast 計算量
```

### UI 對象池

```csharp
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

### Layout Group 優化

```csharp
// ✅ 批量更新後再啟用 Layout
layoutGroup.enabled = false;
for (int i = 0; i < 100; i++)
    AddItem();
layoutGroup.enabled = true;
LayoutRebuilder.ForceRebuildLayoutImmediate(rectTransform);
```

---

## Loading Time Optimization

### 異步加載場景

```csharp
IEnumerator LoadSceneAsync(string sceneName)
{
    AsyncOperation op = SceneManager.LoadSceneAsync(sceneName);
    op.allowSceneActivation = false;

    while (op.progress < 0.9f)
    {
        loadingBar.value = op.progress;
        yield return null;
    }

    // 顯示 "Press any key"
    yield return new WaitUntil(() => Input.anyKeyDown);
    op.allowSceneActivation = true;
}
```

### Addressables

```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

AsyncOperationHandle<GameObject> handle =
    Addressables.LoadAssetAsync<GameObject>("Enemy");
yield return handle;

if (handle.Status == AsyncOperationStatus.Succeeded)
    Instantiate(handle.Result);

// 使用後釋放
Addressables.Release(handle);
```

### 預加載

```csharp
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

---

## Switch 特定優化

### Quality Settings

```
Shadow Distance: 20
Shadow Resolution: Low
Texture Quality: Half Res
Anti Aliasing: Disabled or FXAA
Soft Particles: Disabled
Realtime Reflection Probes: Disabled
```

### 目標幀率

```csharp
#if UNITY_SWITCH
    Application.targetFrameRate = 30;
#elif UNITY_STANDALONE
    Application.targetFrameRate = 60;
#endif
```

### Audio Settings

```
Load Type:
- Decompress On Load: 小文件，頻繁播放（SFX）
- Compressed In Memory: 中等文件（BGM）
- Streaming: 大文件（長音樂）

Compression Format:
- Vorbis: 高壓縮率（BGM）
- ADPCM: 低延遲（SFX）
```
