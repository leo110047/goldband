# Platform Details — 完整代碼範例

## Touch Input (Mobile)

```csharp
public class TouchInput : MonoBehaviour
{
    void Update()
    {
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
            Zoom((currentMagnitude - prevMagnitude) * 0.01f);
        }
    }
}
```

## Input Abstraction Layer

```csharp
public interface IInputProvider
{
    Vector2 GetMovementInput();
    bool GetJumpInput();
    Vector2 GetLookInput();
}

public class KeyboardMouseInput : IInputProvider
{
    public Vector2 GetMovementInput() =>
        new Vector2(Input.GetAxis("Horizontal"), Input.GetAxis("Vertical"));

    public bool GetJumpInput() => Input.GetKeyDown(KeyCode.Space);

    public Vector2 GetLookInput() =>
        new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"));
}

public class TouchInputProvider : IInputProvider
{
    private Joystick joystick;

    public Vector2 GetMovementInput() => joystick.Direction;

    public bool GetJumpInput() => jumpButton.IsPressed;

    public Vector2 GetLookInput()
    {
        if (Input.touchCount > 0)
            return Input.GetTouch(0).deltaPosition * 0.1f;
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
        input = new TouchInputProvider();
#endif
    }

    void Update()
    {
        Vector2 movement = input.GetMovementInput();
        if (input.GetJumpInput())
            Jump();
    }
}
```

---

## Mobile Optimization

```csharp
public class MobileOptimizer : MonoBehaviour
{
    void Start()
    {
#if UNITY_IOS || UNITY_ANDROID
        Application.targetFrameRate = 30;
        QualitySettings.shadows = ShadowQuality.Disable;
        QualitySettings.antiAliasing = 0;
        Screen.SetResolution(1280, 720, true);

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

## WebGL Optimization

```csharp
public class WebGLOptimizer : MonoBehaviour
{
    void Start()
    {
#if UNITY_WEBGL
        // WebGL 不支援多線程
        QualitySettings.streamingMipmapsActive = true;
        // 不要使用 Resources.Load → 使用 Addressables
#endif
    }

#if UNITY_WEBGL
    // 與 JavaScript 通信
    [System.Runtime.InteropServices.DllImport("__Internal")]
    private static extern void SyncFiles();

    public void SaveData()
    {
        PlayerPrefs.Save();
        if (Application.platform == RuntimePlatform.WebGLPlayer)
            SyncFiles();
    }
#endif
}
```

## PC Graphics Settings

```csharp
public class GraphicsSettings : MonoBehaviour
{
    void Start()
    {
#if UNITY_STANDALONE
        if (SystemInfo.graphicsMemorySize > 4000)
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

---

## iOS Specific Features

```csharp
#if UNITY_IOS
using UnityEngine.iOS;

public class iOSFeatures : MonoBehaviour
{
    void Start()
    {
        // 通知權限
        NotificationServices.RegisterForNotifications(
            NotificationType.Alert | NotificationType.Badge | NotificationType.Sound
        );

        // 設備型號
        if (Device.generation == DeviceGeneration.iPhone12)
        {
            // iPhone 12 特定優化
        }

        // Haptic Feedback
        Handheld.Vibrate();
    }

    void PreventSleep()
    {
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
    }
}
#endif
```

## Android Specific Features

```csharp
#if UNITY_ANDROID
using UnityEngine;

public class AndroidFeatures : MonoBehaviour
{
    void Start()
    {
        // 權限請求
        if (!Permission.HasUserAuthorizedPermission(Permission.Camera))
            Permission.RequestUserPermission(Permission.Camera);
    }

    void Update()
    {
        // 返回鍵
        if (Input.GetKeyDown(KeyCode.Escape))
            OnBackButtonPressed();
    }

    void OnBackButtonPressed()
    {
        if (CanGoBack())
            GoToPreviousScreen();
        else
            ShowExitDialog();
    }

    // 調用 Android 原生代碼
    void CallAndroidNative()
    {
        AndroidJavaClass unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
        AndroidJavaObject activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
        activity.Call("someNativeMethod");
    }
}
#endif
```

---

## Build Configuration

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
        BuildPipeline.BuildPlayer(options);
    }

    static void BuildAndroid()
    {
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

---

## Testing

### Unity Remote (iOS/Android)
```csharp
#if UNITY_EDITOR
void OnGUI()
{
    GUILayout.Label($"Touch Count: {Input.touchCount}");
    GUILayout.Label($"Accelerometer: {Input.acceleration}");
}
#endif
```

### WebGL 本地測試
```bash
cd Builds/WebGL
python3 -m http.server 8000
# http://localhost:8000
```

---

## Safe Area Handler

```csharp
public class SafeAreaHandler : MonoBehaviour
{
    void Start() => ApplySafeArea();

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

## Resolution Scaling

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
            scaler.matchWidthOrHeight = 1; // Match height
        else // Phone portrait
            scaler.matchWidthOrHeight = 0; // Match width
    }
}
```

## Addressables 配置

```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class AssetLoader : MonoBehaviour
{
    async void Start()
    {
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

### Platform-Specific Asset Variants
```
Assets/Graphics/
├── Textures_PC/      → HighRes.png
├── Textures_Mobile/  → LowRes.png
└── Textures_WebGL/   → Compressed.png
```
