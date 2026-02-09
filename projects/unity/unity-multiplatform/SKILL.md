---
name: unity-multiplatform
description: |
  Unity 多平台開發指南：iOS, Android, WebGL, PC (Windows/Mac/Linux), Console。
  涵蓋平台差異處理、條件編譯、輸入系統、性能優化、打包配置。

  Use when: 開發跨平台 Unity 遊戲、處理平台特定功能、優化不同平台性能、
  配置平台建置設定、處理輸入差異。

  Focus: 平台差異和最佳實踐，不是通用 Unity 開發。
allowed-tools:
  - Read
  - Grep
  - Glob
---

# Unity Multiplatform Development

## When to Use This Skill

- 開發需要支援多平台的遊戲
- 處理平台特定功能（觸控 vs 鍵鼠）
- 優化不同平台的性能
- 配置 Build Settings
- 處理平台相關的 Bug

## Platform-Specific Code

### 1. 條件編譯指令

```csharp
public class PlatformManager : MonoBehaviour
{
    void Start()
    {
#if UNITY_STANDALONE
        Debug.Log("Running on PC");
        SetupDesktopControls();
#elif UNITY_IOS
        Debug.Log("Running on iOS");
        SetupTouchControls();
        RequestIOSPermissions();
#elif UNITY_ANDROID
        Debug.Log("Running on Android");
        SetupTouchControls();
        RequestAndroidPermissions();
#elif UNITY_WEBGL
        Debug.Log("Running in Browser");
        SetupWebGLControls();
#endif
    }

#if UNITY_EDITOR
    // 只在編輯器中執行
    [MenuItem("Tools/Debug/Print Platform")]
    static void PrintPlatform()
    {
        Debug.Log($"Current Platform: {Application.platform}");
    }
#endif
}
```

**常用編譯符號：**
- `UNITY_EDITOR` - Unity 編輯器
- `UNITY_STANDALONE` - PC 平台（Windows/Mac/Linux）
- `UNITY_STANDALONE_WIN` - Windows
- `UNITY_STANDALONE_OSX` - macOS
- `UNITY_STANDALONE_LINUX` - Linux
- `UNITY_IOS` - iOS
- `UNITY_ANDROID` - Android
- `UNITY_WEBGL` - WebGL

### 2. Runtime Platform Detection

```csharp
public class RuntimePlatformCheck : MonoBehaviour
{
    void Start()
    {
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
    }

    bool IsMobilePlatform()
    {
        return Application.platform == RuntimePlatform.IPhonePlayer ||
               Application.platform == RuntimePlatform.Android;
    }
}
```

## Input Handling

### 1. New Input System (推薦)

**安裝：** Package Manager → Input System

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

        // 自動適配不同輸入設備
        moveAction = playerInput.actions["Move"];
        jumpAction = playerInput.actions["Jump"];
    }

    void Update()
    {
        // 讀取輸入（鍵盤/手柄/觸控自動處理）
        Vector2 moveInput = moveAction.ReadValue<Vector2>();

        if (jumpAction.WasPressedThisFrame())
        {
            Jump();
        }
    }
}
```

**Input Actions Asset 配置：**
- Control Schemes: Keyboard&Mouse, Gamepad, Touch
- Actions: Move, Jump, Attack, Look
- Bindings: 為每個平台配置不同綁定

### 2. 觸控輸入 (Mobile)

```csharp
public class TouchInput : MonoBehaviour
{
    void Update()
    {
        // 多點觸控
        if (Input.touchCount > 0)
        {
            Touch touch = Input.GetTouch(0);

            switch (touch.phase)
            {
                case TouchPhase.Began:
                    OnTouchBegan(touch.position);
                    break;

                case TouchPhase.Moved:
                    OnTouchMoved(touch.position, touch.deltaPosition);
                    break;

                case TouchPhase.Ended:
                    OnTouchEnded(touch.position);
                    break;
            }
        }

        // 兩指縮放
        if (Input.touchCount == 2)
        {
            Touch touch1 = Input.GetTouch(0);
            Touch touch2 = Input.GetTouch(1);

            Vector2 touch1PrevPos = touch1.position - touch1.deltaPosition;
            Vector2 touch2PrevPos = touch2.position - touch2.deltaPosition;

            float prevMagnitude = (touch1PrevPos - touch2PrevPos).magnitude;
            float currentMagnitude = (touch1.position - touch2.position).magnitude;

            float difference = currentMagnitude - prevMagnitude;
            Zoom(difference * 0.01f);
        }
    }
}
```

### 3. 統一輸入抽象層

```csharp
public interface IInputProvider
{
    Vector2 GetMovementInput();
    bool GetJumpInput();
    Vector2 GetLookInput();
}

public class KeyboardMouseInput : IInputProvider
{
    public Vector2 GetMovementInput()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        return new Vector2(h, v);
    }

    public bool GetJumpInput()
    {
        return Input.GetKeyDown(KeyCode.Space);
    }

    public Vector2 GetLookInput()
    {
        return new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"));
    }
}

public class TouchInput : IInputProvider
{
    private Joystick joystick; // Virtual joystick UI

    public Vector2 GetMovementInput()
    {
        return joystick.Direction;
    }

    public bool GetJumpInput()
    {
        return jumpButton.IsPressed; // Virtual button
    }

    public Vector2 GetLookInput()
    {
        if (Input.touchCount > 0)
        {
            return Input.GetTouch(0).deltaPosition * 0.1f;
        }
        return Vector2.zero;
    }
}

// 使用
public class Player : MonoBehaviour
{
    private IInputProvider input;

    void Start()
    {
#if UNITY_STANDALONE
        input = new KeyboardMouseInput();
#elif UNITY_IOS || UNITY_ANDROID
        input = new TouchInput();
#endif
    }

    void Update()
    {
        Vector2 movement = input.GetMovementInput();
        if (input.GetJumpInput())
        {
            Jump();
        }
    }
}
```

## Platform-Specific Optimizations

### 1. Mobile Optimization

```csharp
public class MobileOptimizer : MonoBehaviour
{
    void Start()
    {
#if UNITY_IOS || UNITY_ANDROID
        // 降低目標幀率節省電量
        Application.targetFrameRate = 30;

        // 關閉不必要的功能
        QualitySettings.shadows = ShadowQuality.Disable;
        QualitySettings.antiAliasing = 0;

        // 降低解析度
        Screen.SetResolution(1280, 720, true);

        // 降低粒子效果
        ParticleSystem[] particles = FindObjectsOfType<ParticleSystem>();
        foreach (var ps in particles)
        {
            var main = ps.main;
            main.maxParticles = Mathf.Min(main.maxParticles, 50);
        }
#endif
    }
}
```

### 2. WebGL Optimization

```csharp
public class WebGLOptimizer : MonoBehaviour
{
    void Start()
    {
#if UNITY_WEBGL
        // WebGL 不支援多線程
        // 避免使用 System.Threading

        // 減少內存使用
        QualitySettings.streamingMipmapsActive = true;

        // 壓縮紋理
        // 在 Build Settings 啟用 Texture Compression

        // 不要使用 Resources.Load (增加包體)
        // 使用 Addressables

        // 禁用音頻壓縮（WebGL 不支援某些格式）
#endif
    }

#if UNITY_WEBGL
    // WebGL 特定：與 JavaScript 通信
    [System.Runtime.InteropServices.DllImport("__Internal")]
    private static extern void SyncFiles();

    public void SaveData()
    {
        // 保存數據
        PlayerPrefs.Save();

        // 同步到 IndexedDB
        if (Application.platform == RuntimePlatform.WebGLPlayer)
        {
            SyncFiles();
        }
    }
#endif
}
```

### 3. PC High-End Graphics

```csharp
public class GraphicsSettings : MonoBehaviour
{
    void Start()
    {
#if UNITY_STANDALONE
        // PC 可以支援更高品質
        if (SystemInfo.graphicsMemorySize > 4000) // > 4GB VRAM
        {
            QualitySettings.SetQualityLevel(5, true); // Ultra
            Screen.SetResolution(1920, 1080, FullScreenMode.FullScreenWindow);
        }
        else
        {
            QualitySettings.SetQualityLevel(3, true); // Medium
        }
#endif
    }

    public void ApplyQualityPreset(int level)
    {
        switch (level)
        {
            case 0: // Low
                QualitySettings.shadows = ShadowQuality.Disable;
                QualitySettings.antiAliasing = 0;
                break;

            case 1: // Medium
                QualitySettings.shadows = ShadowQuality.HardOnly;
                QualitySettings.antiAliasing = 2;
                break;

            case 2: // High
                QualitySettings.shadows = ShadowQuality.All;
                QualitySettings.antiAliasing = 4;
                break;

            case 3: // Ultra
                QualitySettings.shadows = ShadowQuality.All;
                QualitySettings.antiAliasing = 8;
                QualitySettings.shadowResolution = ShadowResolution.VeryHigh;
                break;
        }
    }
}
```

## Platform-Specific Features

### 1. iOS Specific

```csharp
#if UNITY_IOS
using UnityEngine.iOS;

public class iOSFeatures : MonoBehaviour
{
    void Start()
    {
        // 請求通知權限
        UnityEngine.iOS.NotificationServices.RegisterForNotifications(
            NotificationType.Alert | NotificationType.Badge | NotificationType.Sound
        );

        // 檢查設備型號
        if (Device.generation == DeviceGeneration.iPhone12)
        {
            // iPhone 12 特定優化
        }

        // Haptic Feedback
        Handheld.Vibrate();
    }

    // 防止螢幕休眠
    void PreventSleep()
    {
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
    }
}
#endif
```

### 2. Android Specific

```csharp
#if UNITY_ANDROID
using UnityEngine;

public class AndroidFeatures : MonoBehaviour
{
    void Start()
    {
        // 請求權限
        if (!Permission.HasUserAuthorizedPermission(Permission.Camera))
        {
            Permission.RequestUserPermission(Permission.Camera);
        }

        // 檢查 Android 版本
        if (SystemInfo.operatingSystem.Contains("Android 11"))
        {
            // Android 11+ 特定處理
        }

        // 返回鍵處理
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Escape))
        {
            // Android 返回鍵
            OnBackButtonPressed();
        }
    }

    void OnBackButtonPressed()
    {
        if (CanGoBack())
        {
            GoToPreviousScreen();
        }
        else
        {
            // 顯示退出確認
            ShowExitDialog();
        }
    }

    // 調用 Android 原生代碼
    void CallAndroidNative()
    {
        AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
        AndroidJavaObject currentActivity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
        currentActivity.Call("someNativeMethod");
    }
}
#endif
```

## Build Configuration

### 1. Build Settings Per Platform

```csharp
#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.Build.Reporting;

public class BuildScript
{
    [MenuItem("Build/Build All Platforms")]
    static void BuildAllPlatforms()
    {
        BuildWindows();
        BuildMac();
        BuildLinux();
        BuildAndroid();
        BuildIOS();
        BuildWebGL();
    }

    static void BuildWindows()
    {
        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = GetScenes(),
            locationPathName = "Builds/Windows/Game.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result == BuildResult.Succeeded)
        {
            Debug.Log("Windows build succeeded");
        }
    }

    static void BuildAndroid()
    {
        // Android 特定設定
        PlayerSettings.Android.bundleVersionCode = 1;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = GetScenes(),
            locationPathName = "Builds/Android/Game.apk",
            target = BuildTarget.Android,
            options = BuildOptions.None
        };

        BuildPipeline.BuildPlayer(options);
    }

    static string[] GetScenes()
    {
        return new[] { "Assets/Scenes/MainMenu.unity", "Assets/Scenes/Game.unity" };
    }
}
#endif
```

### 2. Quality Settings Per Platform

在 Edit → Project Settings → Quality：

```
iOS/Android:
- Low/Medium quality tier
- Shadow Distance: 20
- Anti-Aliasing: Disabled
- Texture Quality: Half Res

PC:
- High/Ultra quality tier
- Shadow Distance: 150
- Anti-Aliasing: 4x/8x
- Texture Quality: Full Res

WebGL:
- Medium quality tier
- Shadow Distance: 50
- Anti-Aliasing: 2x
```

## Asset Bundles and Addressables

### 1. Platform-Specific Asset Variants

```
Assets/
└── Graphics/
    ├── Textures_PC/
    │   └── HighRes.png
    ├── Textures_Mobile/
    │   └── LowRes.png
    └── Textures_WebGL/
        └── Compressed.png
```

### 2. Addressables 配置

```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class AssetLoader : MonoBehaviour
{
    async void Start()
    {
        // 自動根據平台加載正確的資源
        AsyncOperationHandle<GameObject> handle =
            Addressables.InstantiateAsync("Enemy");

        await handle.Task;

        if (handle.Status == AsyncOperationStatus.Succeeded)
        {
            GameObject enemy = handle.Result;
        }
    }
}
```

## Testing on Multiple Platforms

### 1. Unity Remote (iOS/Android 測試)

```csharp
public class RemoteDebug : MonoBehaviour
{
#if UNITY_EDITOR
    void OnGUI()
    {
        GUILayout.Label($"Touch Count: {Input.touchCount}");
        GUILayout.Label($"Accelerometer: {Input.acceleration}");
    }
#endif
}
```

### 2. WebGL 本地測試

```bash
# 在 Build 後使用本地伺服器
cd Builds/WebGL
python3 -m http.server 8000

# 瀏覽器打開 http://localhost:8000
```

## Common Platform Issues

### 1. File Paths

```csharp
// ❌ 錯誤 - 硬編碼路徑分隔符
string path = "Assets\\Data\\config.json"; // Windows only

// ✅ 正確 - 使用 Path.Combine
using System.IO;
string path = Path.Combine(Application.dataPath, "Data", "config.json");

// ✅ Persistent Data Path (跨平台)
string savePath = Path.Combine(Application.persistentDataPath, "save.json");
```

### 2. Threading

```csharp
// ❌ WebGL 不支援
#if !UNITY_WEBGL
using System.Threading;

Thread thread = new Thread(DoWork);
thread.Start();
#endif

// ✅ 使用 Coroutine (所有平台支援)
StartCoroutine(DoWorkCoroutine());
```

### 3. Plugins

```
Assets/
└── Plugins/
    ├── Android/
    │   └── plugin.aar
    ├── iOS/
    │   └── plugin.framework
    ├── x86_64/
    │   └── plugin.dll
    └── WebGL/
        └── plugin.jslib
```

## Platform-Specific UI

### 1. Safe Area (iOS/Android)

```csharp
public class SafeAreaHandler : MonoBehaviour
{
    void Start()
    {
        ApplySafeArea();
    }

    void ApplySafeArea()
    {
        RectTransform panel = GetComponent<RectTransform>();
        Rect safeArea = Screen.safeArea;

        Vector2 anchorMin = safeArea.position;
        Vector2 anchorMax = safeArea.position + safeArea.size;

        anchorMin.x /= Screen.width;
        anchorMin.y /= Screen.height;
        anchorMax.x /= Screen.width;
        anchorMax.y /= Screen.height;

        panel.anchorMin = anchorMin;
        panel.anchorMax = anchorMax;
    }
}
```

### 2. Resolution Scaling

```csharp
using UnityEngine.UI;

[RequireComponent(typeof(CanvasScaler))]
public class ResponsiveUI : MonoBehaviour
{
    void Start()
    {
        CanvasScaler scaler = GetComponent<CanvasScaler>();

        float aspectRatio = (float)Screen.width / Screen.height;

        if (aspectRatio > 1.7f) // Wide screen (PC/Tablet landscape)
        {
            scaler.matchWidthOrHeight = 1; // Match height
        }
        else // Phone portrait
        {
            scaler.matchWidthOrHeight = 0; // Match width
        }
    }
}
```

## Remember

- **條件編譯** - 用 `#if` 處理平台特定代碼
- **Input System** - 使用新 Input System 自動處理多種輸入
- **測試實機** - 盡早在真實設備上測試
- **性能優化** - 移動平台需要激進優化
- **Safe Area** - iOS/Android 需處理螢幕缺口
- **WebGL 限制** - 無多線程、無大文件
- **Addressables** - 用於平台特定資源
- **Build Pipeline** - 自動化多平台構建

