---
name: unity-multiplatform
description: |
  Unity 多平台開發指南：iOS, Android, WebGL, PC (Windows/Mac/Linux), Console。
  涵蓋平台差異處理、條件編譯、輸入系統、性能優化、打包配置。

  Use when: 開發跨平台 Unity 遊戲、處理平台特定功能、優化不同平台性能、
  配置平台建置設定、處理輸入差異。

  Focus: 平台差異和最佳實踐，不是通用 Unity 開發。
allowed-tools: Read, Grep, Glob
---

# Unity Multiplatform Development

## When to Use This Skill

- 開發需要支援多平台的遊戲
- 處理平台特定功能（觸控 vs 鍵鼠）
- 優化不同平台的性能
- 配置 Build Settings
- 處理平台相關的 Bug

> 詳細代碼範例見 [references/platform-details.md](references/platform-details.md)

## 條件編譯指令

### 常用編譯符號

| 符號 | 平台 |
|------|------|
| `UNITY_EDITOR` | Unity 編輯器 |
| `UNITY_STANDALONE` | PC (Windows/Mac/Linux) |
| `UNITY_STANDALONE_WIN` | Windows |
| `UNITY_STANDALONE_OSX` | macOS |
| `UNITY_STANDALONE_LINUX` | Linux |
| `UNITY_IOS` | iOS |
| `UNITY_ANDROID` | Android |
| `UNITY_WEBGL` | WebGL |

### 基本用法

```csharp
#if UNITY_STANDALONE
    SetupDesktopControls();
#elif UNITY_IOS
    SetupTouchControls();
    RequestIOSPermissions();
#elif UNITY_ANDROID
    SetupTouchControls();
    RequestAndroidPermissions();
#elif UNITY_WEBGL
    SetupWebGLControls();
#endif
```

### Runtime Platform Detection

```csharp
switch (Application.platform)
{
    case RuntimePlatform.WindowsPlayer:
    case RuntimePlatform.OSXPlayer:
    case RuntimePlatform.LinuxPlayer:
        SetupDesktop();
        break;
    case RuntimePlatform.IPhonePlayer:
        SetupIOS();
        break;
    case RuntimePlatform.Android:
        SetupAndroid();
        break;
    case RuntimePlatform.WebGLPlayer:
        SetupWebGL();
        break;
}

bool IsMobilePlatform() =>
    Application.platform == RuntimePlatform.IPhonePlayer ||
    Application.platform == RuntimePlatform.Android;
```

## Input Handling

### 推薦: New Input System

```csharp
using UnityEngine.InputSystem;

public class PlayerController : MonoBehaviour
{
    private PlayerInput playerInput;
    private InputAction moveAction;
    private InputAction jumpAction;

    void Awake()
    {
        playerInput = GetComponent<PlayerInput>();
        moveAction = playerInput.actions["Move"];
        jumpAction = playerInput.actions["Jump"];
    }

    void Update()
    {
        Vector2 moveInput = moveAction.ReadValue<Vector2>();
        if (jumpAction.WasPressedThisFrame())
            Jump();
    }
}
```

**Input Actions Asset 配置:**
- Control Schemes: Keyboard&Mouse, Gamepad, Touch
- Actions: Move, Jump, Attack, Look
- Bindings: 為每個平台配置不同綁定

### 統一輸入抽象層

```csharp
public interface IInputProvider
{
    Vector2 GetMovementInput();
    bool GetJumpInput();
    Vector2 GetLookInput();
}

// 使用
private IInputProvider input;
void Start()
{
#if UNITY_STANDALONE
    input = new KeyboardMouseInput();
#elif UNITY_IOS || UNITY_ANDROID
    input = new TouchInput();
#endif
}
```

## 平台優化摘要

| 平台 | 幀率 | 品質 | 關鍵優化 |
|------|------|------|----------|
| Mobile | 30 FPS | Low/Medium | 關閉 Shadow/AA、降低解析度、減少粒子 |
| WebGL | 60 FPS | Medium | 無多線程、Streaming Mipmaps、避免 Resources.Load |
| PC | 60 FPS | High/Ultra | 根據 VRAM 動態調整品質 |

### Mobile 核心優化

```csharp
#if UNITY_IOS || UNITY_ANDROID
    Application.targetFrameRate = 30;
    QualitySettings.shadows = ShadowQuality.Disable;
    QualitySettings.antiAliasing = 0;
    Screen.SetResolution(1280, 720, true);
#endif
```

### WebGL 限制

```
❌ 不支援多線程 (System.Threading)
❌ 某些音頻格式不支援
✅ 使用 Coroutine 代替 Thread
✅ 使用 Addressables 代替 Resources.Load
✅ 啟用 Streaming Mipmaps
```

## Build Configuration

### Quality Settings Per Platform

```
iOS/Android:
- Low/Medium tier, Shadow Distance 20, AA Disabled, Texture Half Res

PC:
- High/Ultra tier, Shadow Distance 150, AA 4x/8x, Texture Full Res

WebGL:
- Medium tier, Shadow Distance 50, AA 2x
```

### 自動化構建

```csharp
#if UNITY_EDITOR
using UnityEditor;

public class BuildScript
{
    [MenuItem("Build/Build All Platforms")]
    static void BuildAllPlatforms()
    {
        BuildWindows();
        BuildAndroid();
        BuildIOS();
        BuildWebGL();
    }
    // 詳見 references/platform-details.md
}
#endif
```

## Platform-Specific Features (簡要)

### iOS
- 通知權限: `NotificationServices.RegisterForNotifications`
- 設備型號檢測: `Device.generation`
- 防止休眠: `Screen.sleepTimeout = SleepTimeout.NeverSleep`

### Android
- 權限請求: `Permission.RequestUserPermission`
- 返回鍵: `Input.GetKeyDown(KeyCode.Escape)`
- 原生調用: `AndroidJavaClass` / `AndroidJavaObject`

## Common Issues

### File Paths
```csharp
// ❌ 硬編碼路徑分隔符
string path = "Assets\\Data\\config.json";

// ✅ Path.Combine
string path = Path.Combine(Application.dataPath, "Data", "config.json");

// ✅ Persistent Data (跨平台)
string savePath = Path.Combine(Application.persistentDataPath, "save.json");
```

### Threading
```csharp
// ❌ WebGL 不支援
#if !UNITY_WEBGL
    new Thread(DoWork).Start();
#endif

// ✅ 所有平台支援
StartCoroutine(DoWorkCoroutine());
```

### Plugins
```
Assets/Plugins/
├── Android/    → .aar
├── iOS/        → .framework
├── x86_64/     → .dll
└── WebGL/      → .jslib
```

## Platform-Specific UI

### Safe Area (iOS/Android)
```csharp
void ApplySafeArea()
{
    RectTransform panel = GetComponent<RectTransform>();
    Rect safeArea = Screen.safeArea;
    Vector2 anchorMin = safeArea.position;
    Vector2 anchorMax = safeArea.position + safeArea.size;
    anchorMin.x /= Screen.width;  anchorMin.y /= Screen.height;
    anchorMax.x /= Screen.width;  anchorMax.y /= Screen.height;
    panel.anchorMin = anchorMin;
    panel.anchorMax = anchorMax;
}
```

### Resolution Scaling
```csharp
float aspectRatio = (float)Screen.width / Screen.height;
CanvasScaler scaler = GetComponent<CanvasScaler>();
scaler.matchWidthOrHeight = aspectRatio > 1.7f ? 1 : 0;
// > 1.7 (寬螢幕): Match height
// ≤ 1.7 (手機直式): Match width
```

## Addressables

### Platform-Specific Asset Variants
```
Assets/Graphics/
├── Textures_PC/      → HighRes
├── Textures_Mobile/  → LowRes
└── Textures_WebGL/   → Compressed
```

```csharp
using UnityEngine.AddressableAssets;

// 自動根據平台加載正確資源
var handle = Addressables.InstantiateAsync("Enemy");
await handle.Task;
```

## Remember

- **條件編譯** — 用 `#if` 處理平台特定代碼
- **Input System** — 使用新 Input System 自動處理多種輸入
- **測試實機** — 盡早在真實設備上測試
- **性能優化** — 移動平台需要激進優化
- **Safe Area** — iOS/Android 需處理螢幕缺口
- **WebGL 限制** — 無多線程、無大文件
- **Addressables** — 用於平台特定資源
- **Build Pipeline** — 自動化多平台構建
