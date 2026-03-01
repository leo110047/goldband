# Android (Google Play) 詳細指南

## AAB 200MB 限制

### Google Play 規則
```
✅ 允許: AAB (Android App Bundle) ≤ 200MB
❌ 超過 200MB: 必須使用 Play Asset Delivery (PAD)
📦 總大小上限: 150MB (base) + 8GB (asset packs)
```

### 檢查 AAB 大小
```bash
ls -lh /path/to/your-game.aab

# 使用 bundletool 分析
java -jar bundletool.jar build-apks \
  --bundle=your-game.aab \
  --output=output.apks \
  --mode=universal

unzip -l your-game.aab | grep -E "\.(dex|so|png|jpg)"
```

### Android Build Settings

```csharp
// File: Editor/AndroidBuildConfig.cs
using UnityEditor;
using UnityEngine;

public class AndroidBuildConfig
{
    [MenuItem("Build/Configure Android for Google Play")]
    public static void ConfigureAndroid()
    {
        PlayerSettings.companyName = "YourCompany";
        PlayerSettings.productName = "YourGame";
        PlayerSettings.applicationIdentifier = "com.yourcompany.yourgame";

        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.Android.bundleVersionCode = 1;

        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
        PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34;

        EditorUserBuildSettings.buildAppBundle = true;

        PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

        PlayerSettings.stripEngineCode = true;
        PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.Android, ManagedStrippingLevel.High);

        PlayerSettings.Android.useCustomKeystore = true;
        PlayerSettings.Android.keystoreName = "path/to/your.keystore";
        PlayerSettings.Android.keystorePass = "your-keystore-password";
        PlayerSettings.Android.keyaliasName = "your-key-alias";
        PlayerSettings.Android.keyaliasPass = "your-alias-password";

        Debug.Log("Android Build Settings Configured");
    }
}
```

### AAB 瘦身

#### 策略 1: 資產壓縮
```csharp
// Texture
Max Size: 2048
Compression: ASTC (ARM64 最佳)
Format: ASTC 6x6 (平衡) 或 ASTC 8x8 (高壓縮)
Override for Android: Enabled

// Audio
Load Type: Compressed In Memory
Compression Format: Vorbis
Quality: 70

// Model
Read/Write Enabled: OFF
Optimize Mesh: ON
Mesh Compression: High
```

#### 策略 2: IL2CPP + Stripping
```
效果: 減少 30-50% 代碼大小

Player Settings → Other Settings
→ Scripting Backend: IL2CPP
→ Target Architectures: ARM64 only
→ Managed Stripping Level: High

⚠️ High Stripping 可能導致反射問題，需真機完整測試
```

#### 策略 3: 資源分離
```csharp
// 將大資源移到 StreamingAssets（運行時加載）
Assets/StreamingAssets/
├── Videos/
├── Audio/Music/
└── HighResTextures/

// Android 運行時加載
string path = Path.Combine(Application.streamingAssetsPath, "Videos/intro.mp4");
#if UNITY_ANDROID
    UnityWebRequest request = UnityWebRequest.Get(path);
    yield return request.SendWebRequest();
    byte[] data = request.downloadHandler.data;
#endif
```

---

## Play Asset Delivery (PAD)

### 安裝 Google Play Plugins
```bash
# https://github.com/google/play-unity-plugins/releases
# 導入: Google.Play.Core, Google.Play.AssetDelivery, Google.Play.Common
```

### Asset Pack 結構
```
Assets/AssetPacks/
├── HighResTextures/     → install-time (與 base 一起安裝，最多 1GB)
├── Level2_5/            → fast-follow (安裝後自動下載，≤512MB/pack)
└── DLCContent/          → on-demand (需要時下載，≤512MB/pack)

配置: Window → Google → Android App Bundle → Asset Delivery Settings
```

### PAD 代碼實現

```csharp
using Google.Play.AssetDelivery;
using Google.Play.Common;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;

public class AssetPackManager : MonoBehaviour
{
    [SerializeField] private Slider progressBar;
    [SerializeField] private Text statusText;
    private PlayAssetPackRequest downloadRequest;

    public IEnumerator DownloadAssetPack(string packName)
    {
        statusText.text = $"檢查 {packName}...";
        var checkRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);
        yield return checkRequest;

        if (checkRequest.Error != AssetDeliveryErrorCode.NoError)
        {
            statusText.text = "下載失敗，請檢查網路連接";
            yield break;
        }

        if (checkRequest.Status == AssetDeliveryStatus.Available)
        {
            LoadAssetsFromPack(packName, checkRequest);
            yield break;
        }

        downloadRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);
        while (!downloadRequest.IsDone)
        {
            if (downloadRequest.Status == AssetDeliveryStatus.WaitingForWifi)
            {
                var confirmRequest = PlayAssetDelivery.ShowCellularDataConfirmation();
                yield return confirmRequest;
                if (confirmRequest.Error != AssetDeliveryErrorCode.NoError ||
                    confirmRequest.Result != ConfirmationDialogResult.Accepted)
                {
                    yield break;
                }
            }

            progressBar.value = downloadRequest.DownloadProgress;
            statusText.text = $"下載中: {downloadRequest.DownloadProgress:P0}";
            yield return null;
        }

        if (downloadRequest.Error == AssetDeliveryErrorCode.NoError)
        {
            LoadAssetsFromPack(packName, downloadRequest);
        }
    }

    private void LoadAssetsFromPack(string packName, PlayAssetPackRequest request)
    {
        string assetBundlePath = request.GetAssetBundlePath();
        if (!string.IsNullOrEmpty(assetBundlePath))
        {
            AssetBundle bundle = AssetBundle.LoadFromFile(assetBundlePath);
        }
    }

    public IEnumerator DownloadWithRetry(string packName, int maxRetries = 3)
    {
        for (int i = 0; i < maxRetries; i++)
        {
            yield return DownloadAssetPack(packName);
            if (downloadRequest != null &&
                downloadRequest.Error == AssetDeliveryErrorCode.NoError)
                yield break;
            yield return new WaitForSeconds(3f);
        }
    }

    public void RemoveAssetPack(string packName)
    {
        PlayAssetDelivery.RemoveAssetPack(packName);
    }
}
```

### PAD 分配策略
```
Base AAB (<200MB):
  Core gameplay scripts, Essential UI, First level/tutorial, SFX, Low-res textures

install-time (0-1GB):
  High-res textures (必須的), 前幾個關卡, Core characters/models

fast-follow (<512MB/pack):
  Additional levels, Characters, BGM, Optional high-quality assets

on-demand (<512MB/pack):
  DLC content, Special events, Language packs, Cosmetics
```

---

## Keystore 簽名

### 生成 Keystore
```bash
# 方法 1: Unity 生成
# Edit → Project Settings → Player → Publishing Settings → Keystore Manager

# 方法 2: keytool
keytool -genkey -v \
  -keystore your-game.keystore \
  -alias your-key-alias \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

### 安全管理
```bash
# 備份至少 3 個位置
cp your-game.keystore ~/Dropbox/Secure/
cp your-game.keystore /external-drive/backups/

# 記錄資訊
keytool -list -v -keystore your-game.keystore

# ⚠️ Keystore 丟失 = 永遠無法更新應用！
```

### Play App Signing (強烈推薦)
```
首次上傳 AAB 時:
[✅] Let Google manage my app signing key
  - Google 保管發佈密鑰
  - 上傳密鑰丟失可聯繫 Google 重置
```

---

## Google Play Console 配置

### 創建應用
```
1. https://play.google.com/console → Create app
2. App name, Language, App/Game, Free/Paid
3. Agree to policies → Create app
```

### 商店資訊
```
必填:
- App name (30 chars)
- Short description (80 chars)
- Full description (4000 chars)
- App icon (512x512 PNG, 32-bit, 無透明)
- Feature graphic (1024x500)
- Phone screenshots (至少 2 張, 推薦 1080x1920)
- Tablet screenshots (至少 2 張)
- Category: Games → 子類別
- Contact email + Privacy Policy URL
```

### 內容分級
```
Dashboard → Content rating → IARC 問卷
填寫: 暴力/性/語言/藥物/賭博/互動/位置/購買
→ 獲得 ESRB/PEGI/USK/台灣 分級
```

### 數據安全
```
Dashboard → Data safety
常見 Unity 遊戲需聲明:
- User IDs, Purchase history
- App interactions, Crash logs, Diagnostics
- Device IDs
- 用途: App functionality, Analytics
- 第三方: Google Analytics, Firebase, Unity Analytics
```

---

## 測試與發佈

### Build AAB

```csharp
using UnityEditor;
using UnityEditor.Build.Reporting;
using System.IO;

public class BuildAAB
{
    [MenuItem("Build/Build AAB for Google Play")]
    public static void Build()
    {
        string buildPath = "Builds/Android/YourGame.aab";
        Directory.CreateDirectory(Path.GetDirectoryName(buildPath));
        EditorUserBuildSettings.buildAppBundle = true;

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = buildPath,
            target = BuildTarget.Android,
            options = BuildOptions.None
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result == BuildResult.Succeeded)
        {
            float sizeInMB = report.summary.totalSize / (1024f * 1024f);
            if (sizeInMB > 200)
                Debug.LogWarning($"AAB ({sizeInMB:F2} MB) > 200MB! Use PAD.");
        }
    }

    private static string[] GetScenePaths()
    {
        var scenes = EditorBuildSettings.scenes;
        string[] paths = new string[scenes.Length];
        for (int i = 0; i < scenes.Length; i++)
            paths[i] = scenes[i].path;
        return paths;
    }
}
```

### 測試軌道
```
1. Internal Testing:  最多 100 人, 數小時審核
2. Closed Testing:    自定義名單, 數小時審核
3. Open Testing:      任何人可加入, 1-2 天審核
4. Production:        1-7 天審核, 可分階段 10%→50%→100%
```

### 版本管理
```
Version: 1.0.0 (語義化，給用戶看)
Bundle Version Code: 1 (內部識別，必須嚴格遞增)

v1.0.0 (Code 1) → v1.0.1 (Code 2) → v1.1.0 (Code 3) → ...
⚠️ Version Code 不能重複或回退！
```
