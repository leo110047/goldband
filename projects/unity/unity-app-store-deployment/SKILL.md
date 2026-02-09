---
description: |
  Unity 遊戲上架 Google Play 和 iOS App Store 完整流程，包含平台特定限制、資產優化、
  簽名配置、審核準備和發佈策略。

  Use when: 準備上架 Google Play 或 App Store、處理包體過大問題、配置資產分發、
  設置簽名證書、TestFlight/內測發佈、處理應用審核、隱私政策配置。

  PRIORITY: 當用戶提到「上架」、「Google Play」、「App Store」、「AAB」、「IPA」、
  「審核」、「TestFlight」時優先觸發。

  涵蓋：Google Play (AAB 200MB、Play Asset Delivery)、iOS App Store (On-Demand Resources、
  Provisioning Profile)、雙平台通用優化、審核注意事項、隱私合規。

triggers:
  keywords:
    - 上架
    - app store
    - google play
    - testflight
    - aab
    - ipa
    - 發佈
    - 審核
    - provisioning
    - keystore
    - 200mb
    - app bundle
  intent_patterns:
    - "上架 google play"
    - "上架 app store"
    - "ios 上架"
    - "android 上架"
    - "AAB 太大"
    - "IPA 太大"
    - "審核被拒"
    - "testflight 測試"
  file_patterns:
    - "**/ProjectSettings/ProjectSettings.asset"
    - "**/gradle.properties"
    - "**/*.keystore"
    - "**/*.mobileprovision"
    - "**/Podfile"

enforcement: suggest
---

# Unity App Store 上架完整指南

## 📋 目錄

### 🤖 Android (Google Play)
1. [AAB 200MB 限制與優化](#android-aab-200mb-限制)
2. [Play Asset Delivery (PAD)](#play-asset-delivery-pad)
3. [Keystore 簽名管理](#android-keystore-簽名)
4. [Google Play Console 配置](#google-play-console-配置)
5. [Android 測試與發佈](#android-測試與發佈)

### 🍎 iOS (App Store)
6. [iOS Build Settings](#ios-build-settings)
7. [App Store 包體限制與優化](#ios-包體限制)
8. [Xcode 簽名與 Provisioning](#ios-簽名與-provisioning)
9. [App Store Connect 配置](#app-store-connect-配置)
10. [TestFlight 與發佈](#testflight-與發佈)

### 🌐 雙平台通用
11. [資產優化通用策略](#雙平台資產優化)
12. [隱私政策與合規](#隱私政策與合規)
13. [審核注意事項](#審核注意事項)
14. [常見問題處理](#常見問題處理)

---

# 🤖 Android (Google Play)

## Android: AAB 200MB 限制

### Google Play 規則
```
✅ 允許: AAB (Android App Bundle) ≤ 200MB
❌ 超過 200MB: 必須使用 Play Asset Delivery (PAD)
📦 總大小上限: 150MB (base) + 8GB (asset packs)
```

### 檢查當前 AAB 大小
```bash
# Build AAB 後檢查大小
ls -lh /path/to/your-game.aab

# 使用 bundletool 分析
# 下載: https://github.com/google/bundletool/releases
java -jar bundletool.jar build-apks \
  --bundle=your-game.aab \
  --output=output.apks \
  --mode=universal

# 查看各模塊大小
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
        // ===== 基本設定 =====
        PlayerSettings.companyName = "YourCompany";
        PlayerSettings.productName = "YourGame";
        PlayerSettings.applicationIdentifier = "com.yourcompany.yourgame";

        // ===== Version =====
        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.Android.bundleVersionCode = 1; // 每次上傳遞增

        // ===== SDK Version =====
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24; // API 24 (Android 7.0)
        PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34; // API 34 (Android 14)

        // ===== 必須啟用 AAB =====
        EditorUserBuildSettings.buildAppBundle = true;

        // ===== IL2CPP + ARM64 (推薦) =====
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64; // 僅 ARM64

        // ===== Stripping 優化 =====
        PlayerSettings.stripEngineCode = true;
        PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.Android, ManagedStrippingLevel.High);

        // ===== Keystore =====
        PlayerSettings.Android.useCustomKeystore = true;
        PlayerSettings.Android.keystoreName = "path/to/your.keystore";
        PlayerSettings.Android.keystorePass = "your-keystore-password";
        PlayerSettings.Android.keyaliasName = "your-key-alias";
        PlayerSettings.Android.keyaliasPass = "your-alias-password";

        Debug.Log("✅ Android Build Settings Configured");
    }
}
```

### AAB 瘦身技巧

#### 策略 1: 資產壓縮
```csharp
// Texture 壓縮
// Select all textures in Android platform
Max Size: 2048 (或更小)
Compression: ASTC (ARM64 最佳壓縮)
Format: ASTC 6x6 (平衡) 或 ASTC 8x8 (高壓縮)
Override for Android: ✅ Enabled

// Audio 壓縮
Load Type: Compressed In Memory
Compression Format: Vorbis
Quality: 70 (根據需求調整)

// Model 優化
Read/Write Enabled: ❌ 關閉
Optimize Mesh: ✅ 啟用
Mesh Compression: High
```

#### 策略 2: IL2CPP + Stripping
```
效果: 可減少 30-50% 的代碼大小

Player Settings → Other Settings
→ Scripting Backend: IL2CPP
→ Target Architectures: ARM64 only
→ Managed Stripping Level: High

⚠️ 注意: High Stripping 可能導致反射問題
測試方法: 在真機上完整測試所有功能
```

#### 策略 3: 資源分離
```csharp
// 將大資源移到 StreamingAssets（運行時加載）
Assets/StreamingAssets/
├── Videos/           (教學視頻、過場動畫)
├── Audio/Music/      (背景音樂)
└── HighResTextures/  (可選的高清材質)

// 運行時加載示例
string path = Path.Combine(Application.streamingAssetsPath, "Videos/intro.mp4");
#if UNITY_ANDROID
    // Android 需要使用 UnityWebRequest
    UnityWebRequest request = UnityWebRequest.Get(path);
    yield return request.SendWebRequest();
    byte[] data = request.downloadHandler.data;
#endif
```

---

## Play Asset Delivery (PAD)

### 當 AAB > 200MB 時必須使用

### 步驟 1: 安裝 Google Play Plugins

```bash
# 下載 Play Plugins for Unity
# https://github.com/google/play-unity-plugins/releases

# 導入 Unity Package:
# 1. Google.Play.Core
# 2. Google.Play.AssetDelivery
# 3. Google.Play.Common
```

### 步驟 2: 創建 Asset Packs

```
Assets/
└── AssetPacks/
    ├── HighResTextures/     → install-time (立即下載)
    ├── Level2_5/            → fast-follow (安裝後下載)
    └── DLCContent/          → on-demand (需要時下載)

配置方式:
Window → Google → Android App Bundle → Asset Delivery Settings

Delivery Modes:
- install-time: 與 base AAB 一起安裝（最多 1GB）
- fast-follow: 應用啟動後自動下載（最多 512MB/pack）
- on-demand: 玩家需要時才下載（最多 512MB/pack）
```

### 步驟 3: PAD 完整代碼實現

```csharp
// File: AssetPackManager.cs
using Google.Play.AssetDelivery;
using Google.Play.Common;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;

public class AssetPackManager : MonoBehaviour
{
    [Header("UI")]
    [SerializeField] private Slider progressBar;
    [SerializeField] private Text statusText;

    private PlayAssetPackRequest downloadRequest;

    /// <summary>
    /// 下載 Asset Pack 並顯示進度
    /// </summary>
    public IEnumerator DownloadAssetPack(string packName)
    {
        statusText.text = $"檢查 {packName}...";

        // 檢查 pack 狀態
        var checkRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);
        yield return checkRequest;

        if (checkRequest.Error != AssetDeliveryErrorCode.NoError)
        {
            Debug.LogError($"❌ 檢查失敗: {checkRequest.Error}");
            statusText.text = "下載失敗，請檢查網路連接";
            yield break;
        }

        // 已下載，直接使用
        if (checkRequest.Status == AssetDeliveryStatus.Available)
        {
            Debug.Log($"✅ {packName} 已可用");
            LoadAssetsFromPack(packName, checkRequest);
            yield break;
        }

        // 開始下載
        statusText.text = $"準備下載 {packName}...";
        downloadRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);

        while (!downloadRequest.IsDone)
        {
            // 處理需要蜂窩網路確認
            if (downloadRequest.Status == AssetDeliveryStatus.WaitingForWifi)
            {
                statusText.text = "需要WiFi連接，或使用流量下載？";

                var confirmRequest = PlayAssetDelivery.ShowCellularDataConfirmation();
                yield return confirmRequest;

                if (confirmRequest.Error != AssetDeliveryErrorCode.NoError ||
                    confirmRequest.Result != ConfirmationDialogResult.Accepted)
                {
                    Debug.Log("⚠️ 用戶拒絕使用流量下載");
                    statusText.text = "下載已取消";
                    yield break;
                }
            }

            // 更新進度
            float progress = downloadRequest.DownloadProgress;
            long downloaded = downloadRequest.BytesDownloaded;
            long total = downloadRequest.Size;

            progressBar.value = progress;
            statusText.text = $"下載中: {progress:P0}\n({FormatBytes(downloaded)} / {FormatBytes(total)})";

            Debug.Log($"📥 {packName}: {progress:P0} ({downloaded}/{total} bytes)");

            yield return null;
        }

        // 檢查下載結果
        if (downloadRequest.Error != AssetDeliveryErrorCode.NoError)
        {
            Debug.LogError($"❌ 下載失敗: {downloadRequest.Error}");
            statusText.text = $"下載失敗: {downloadRequest.Error}";
            yield break;
        }

        Debug.Log($"✅ {packName} 下載完成");
        statusText.text = "下載完成！正在加載資源...";
        LoadAssetsFromPack(packName, downloadRequest);
    }

    private void LoadAssetsFromPack(string packName, PlayAssetPackRequest request)
    {
        // 方法 1: 從 AssetBundle 加載
        string assetBundlePath = request.GetAssetBundlePath();
        if (!string.IsNullOrEmpty(assetBundlePath))
        {
            AssetBundle bundle = AssetBundle.LoadFromFile(assetBundlePath);
            if (bundle != null)
            {
                // 加載資源
                // GameObject prefab = bundle.LoadAsset<GameObject>("MyPrefab");
                Debug.Log($"✅ AssetBundle 加載成功: {bundle.name}");
            }
        }

        // 方法 2: 使用 Addressables (推薦)
        // Addressables 會自動處理 Asset Pack
        // var handle = Addressables.LoadAssetAsync<GameObject>("MyAsset");

        statusText.text = "資源加載完成！";
    }

    /// <summary>
    /// 下載失敗時重試
    /// </summary>
    public IEnumerator DownloadWithRetry(string packName, int maxRetries = 3)
    {
        for (int i = 0; i < maxRetries; i++)
        {
            yield return DownloadAssetPack(packName);

            if (downloadRequest != null &&
                downloadRequest.Error == AssetDeliveryErrorCode.NoError)
            {
                yield break; // 成功
            }

            Debug.LogWarning($"⚠️ 下載失敗，重試 {i + 1}/{maxRetries}");
            yield return new WaitForSeconds(3f);
        }

        Debug.LogError($"❌ {packName} 下載失敗，已達最大重試次數");
    }

    /// <summary>
    /// 清理 on-demand pack（釋放空間）
    /// </summary>
    public void RemoveAssetPack(string packName)
    {
        PlayAssetDelivery.RemoveAssetPack(packName);
        Debug.Log($"🗑️ 已移除 asset pack: {packName}");
    }

    /// <summary>
    /// 獲取所有 Asset Pack 的狀態
    /// </summary>
    public IEnumerator GetAllPacksStatus()
    {
        string[] packNames = { "HighResTextures", "Level2_5", "DLCContent" };

        foreach (string pack in packNames)
        {
            var request = PlayAssetDelivery.RetrieveAssetPackAsync(pack);
            yield return request;

            if (request.Error == AssetDeliveryErrorCode.NoError)
            {
                Debug.Log($"📦 {pack}: {request.Status} ({FormatBytes(request.Size)})");
            }
        }
    }

    private string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024f:F1} KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / (1024f * 1024f):F1} MB";
        return $"{bytes / (1024f * 1024f * 1024f):F1} GB";
    }
}
```

### PAD 推薦分配策略

```
Base AAB (<200MB):
✅ Core gameplay scripts
✅ Essential UI assets
✅ First level/tutorial
✅ Sound effects (SFX)
✅ Low-res textures

install-time pack (0-1GB):
✅ High-res textures (必須的)
✅ 前幾個關卡
✅ Core characters/models

fast-follow pack (<512MB per pack):
✅ Additional levels (2-5)
✅ Additional characters
✅ Background music
✅ Optional high-quality assets

on-demand packs (<512MB per pack):
✅ DLC content
✅ Special events
✅ Language packs (非英文)
✅ Optional cosmetics
```

---

## Android: Keystore 簽名

### 生成 Keystore

```bash
# 方法 1: 使用 Unity 生成（推薦新手）
# Edit → Project Settings → Player → Publishing Settings
# → Keystore Manager → Create New Keystore

# 方法 2: 使用 keytool 生成（推薦專業）
keytool -genkey -v \
  -keystore your-game.keystore \
  -alias your-key-alias \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# 輸入資訊:
Enter keystore password: ******
Re-enter new password: ******
Enter key password for <your-key-alias>: ******
What is your first and last name? [Your Name]
What is the name of your organizational unit? [Your Company]
...
```

### ⚠️ Keystore 安全管理（極其重要）

```bash
# 1. 立即備份 Keystore（至少 3 個位置）
cp your-game.keystore ~/Dropbox/Secure/
cp your-game.keystore /external-drive/backups/
cp your-game.keystore ~/iCloud/Secure/

# 2. 記錄 Keystore 資訊
keytool -list -v -keystore your-game.keystore

# 輸出（保存這些資訊）:
# Alias name: your-key-alias
# Creation date: Feb 9, 2024
# Entry type: PrivateKeyEntry
# Certificate fingerprints:
#   SHA1: AA:BB:CC:DD:EE:FF:...
#   SHA256: 11:22:33:44:55:66:...

# 3. 創建密碼管理文件（加密保存）
# keystore-info.txt (加密後保存)
Keystore Path: /path/to/your-game.keystore
Keystore Password: ******
Key Alias: your-key-alias
Key Password: ******
SHA1: AA:BB:CC:DD:...
SHA256: 11:22:33:44:...
Created: 2024-02-09

# ⚠️ 警告: Keystore 丟失 = 永遠無法更新應用！
# 只能發佈新應用，舊應用無法更新。
```

### Play App Signing (強烈推薦)

```
首次上傳 AAB 時，Google Play Console 會詢問:

[✅] Let Google manage my app signing key (推薦)
    - Google 保管發佈密鑰（release key）
    - 你只需保管上傳密鑰（upload key）
    - 即使上傳密鑰丟失，可聯繫 Google 重置

[ ] Keep my signing key (不推薦)
    - 你自己管理發佈密鑰
    - 丟失 = 永遠無法更新

✅ 優點:
- 更安全（Google 管理發佈密鑰）
- 可重置上傳密鑰（聯繫 Google）
- 支援 App Bundle 優化
- 支援 Play Feature Delivery
```

---

## Google Play Console 配置

### 步驟 1: 創建應用

```
1. 訪問 https://play.google.com/console
2. 點擊「Create app」
3. 填寫:
   - App name: YourGame
   - Default language: 繁體中文 / 英文
   - App or game: Game
   - Free or paid: Free (通常)
   - Developer Program Policy: ✅ Agree
   - US export laws: ✅ Agree
4. 點擊「Create app」
```

### 步驟 2: 設置商店資訊

```
Dashboard → Store presence → Main store listing

必填項目:
✅ App name (30 characters max)
   "你的遊戲名稱 - 副標題"

✅ Short description (80 characters max)
   簡潔有力的一句話描述

✅ Full description (4000 characters max)
   詳細介紹：
   - 遊戲特色（3-5 個亮點）
   - 玩法說明
   - 遊戲特色
   - 系統需求（可選）

✅ App icon (512 x 512 PNG, 32-bit)
   - 無透明度
   - 圓角會自動添加

✅ Feature graphic (1024 x 500 JPG/PNG)
   - 主視覺橫幅

✅ Screenshots:
   Phone screenshots (JPEG/PNG, 16:9 或 9:16):
   - 至少 2 張，最多 8 張
   - 最小尺寸: 320px
   - 最大尺寸: 3840px
   - 推薦: 1080x1920 或 1920x1080

   7-inch tablet screenshots:
   - 至少 2 張

   10-inch tablet screenshots:
   - 至少 2 張（如果支援平板）

✅ App category:
   Games → Action / Puzzle / Strategy / etc.

✅ Contact details:
   - Email: support@yourcompany.com (必填)
   - Website: https://yourcompany.com (可選)
   - Privacy Policy URL: https://yourcompany.com/privacy (必填)
```

### 步驟 3: 內容分級

```
Dashboard → Content rating → Start questionnaire

選擇分級機構: IARC (國際年齡分級聯盟)

填寫問卷:
1. App category: Game
2. 是否包含暴力? Yes/No
   - 如果 Yes，描述暴力程度
3. 是否包含性內容? Yes/No
4. 是否包含粗俗語言? Yes/No
5. 是否包含藥物使用? Yes/No
6. 是否包含賭博? Yes/No
7. 是否包含現實賭博? Yes/No (Important!)
8. 是否用戶可以互動? Yes/No
9. 是否用戶可以分享位置? Yes/No
10. 是否可以購買數位商品? Yes/No

完成後獲得分級:
- ESRB (美國): E, E10+, T, M
- PEGI (歐洲): 3, 7, 12, 16, 18
- USK (德國): 0, 6, 12, 16, 18
- 台灣: 普遍級, 保護級, 輔12, 輔15, 限18
```

### 步驟 4: 目標受眾

```
Dashboard → Target audience and content

1. Target age groups:
   [✅] Ages 5 and under
   [✅] Ages 6-8
   [✅] Ages 9-12
   [ ] Ages 13-17
   [ ] Ages 18+

2. Does your app appeal to children?
   ( ) Yes, my app appeals primarily to children
   ( ) Yes, my app appeals to children and older audiences
   (●) No, my app does not appeal to children

3. Does your app contain ads?
   (●) Yes, my app contains ads
   ( ) No, my app does not contain ads

   如果 Yes:
   [✅] Do ads contain alcohol, tobacco, or gambling content? No
   [✅] Are ads shown to users who have opted out? No

4. In-app purchases:
   (●) Yes, my app has in-app purchases
   ( ) No
```

### 步驟 5: 數據安全

```
Dashboard → Data safety

⚠️ 這是最複雜的部分，必須仔細填寫

1. Does your app collect or share user data?
   (●) Yes  ( ) No

2. Data collection (常見 Unity 遊戲):

   Personal info:
   [ ] Name
   [ ] Email address
   [✅] User IDs (Device ID, Firebase ID)

   Financial info:
   [✅] Purchase history (如果有 IAP)

   Location:
   [ ] Approximate location
   [ ] Precise location

   App activity:
   [✅] App interactions (遊戲內行為)
   [✅] In-app search history
   [✅] Other user-generated content

   App info and performance:
   [✅] Crash logs
   [✅] Diagnostics

   Device or other IDs:
   [✅] Device or other IDs (Analytics)

3. Data usage purpose:
   [✅] App functionality
   [✅] Analytics
   [✅] Advertising or marketing
   [ ] Fraud prevention, security, and compliance

4. Data sharing:
   Do you share data with third parties?
   (●) Yes (如果使用 Google Analytics, Firebase, AdMob)

   Third parties:
   - Google Analytics
   - Firebase
   - AdMob (如果有廣告)
   - Unity Analytics

5. Data security:
   [✅] Data is encrypted in transit
   [✅] Users can request data deletion
   [ ] Data is encrypted at rest
```

### 步驟 6: Privacy Policy (必須)

```
必須提供 Privacy Policy URL

最低要求包含:
1. 收集的數據類型
2. 數據使用目的
3. 數據共享對象（第三方服務）
4. 用戶權利（查看、刪除數據）
5. 聯繫方式

範例:
https://yourcompany.com/privacy-policy

可以使用生成器:
- https://www.privacypolicygenerator.info/
- https://www.freeprivacypolicy.com/
```

---

## Android: 測試與發佈

### Build AAB

```csharp
// File: Editor/BuildAAB.cs
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using System.IO;

public class BuildAAB
{
    [MenuItem("Build/Build AAB for Google Play")]
    public static void Build()
    {
        string buildPath = "Builds/Android/YourGame.aab";
        Directory.CreateDirectory(Path.GetDirectoryName(buildPath));

        // 確保生成 AAB
        EditorUserBuildSettings.buildAppBundle = true;

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = buildPath,
            target = BuildTarget.Android,
            options = BuildOptions.None
        };

        Debug.Log("🔨 Building AAB...");
        BuildReport report = BuildPipeline.BuildPlayer(options);

        if (report.summary.result == BuildResult.Succeeded)
        {
            long sizeInBytes = report.summary.totalSize;
            float sizeInMB = sizeInBytes / (1024f * 1024f);

            Debug.Log($"✅ Build succeeded!");
            Debug.Log($"📦 AAB size: {sizeInMB:F2} MB");
            Debug.Log($"⏱️ Build time: {report.summary.totalTime}");

            if (sizeInMB > 200)
            {
                Debug.LogWarning($"⚠️ AAB size ({sizeInMB:F2} MB) exceeds 200MB!");
                Debug.LogWarning("You must use Play Asset Delivery (PAD)");
            }
            else
            {
                Debug.Log($"✅ AAB size is within limit ({sizeInMB:F2} / 200 MB)");
            }

            EditorUtility.RevealInFinder(buildPath);
        }
        else
        {
            Debug.LogError($"❌ Build failed: {report.summary.result}");
            foreach (var step in report.steps)
            {
                if (step.messages.Length > 0)
                {
                    foreach (var message in step.messages)
                    {
                        Debug.LogError($"  {message.content}");
                    }
                }
            }
        }
    }

    private static string[] GetScenePaths()
    {
        var scenes = EditorBuildSettings.scenes;
        string[] paths = new string[scenes.Length];
        for (int i = 0; i < scenes.Length; i++)
        {
            paths[i] = scenes[i].path;
        }
        return paths;
    }
}
```

### 測試軌道

```
1. Internal Testing (內部測試)
   - 測試者: 最多 100 人
   - 審核時間: 數小時內
   - 用途: 快速驗證 Build

2. Closed Testing (封閉測試)
   - 測試者: 自定義名單（電子郵件）
   - 審核時間: 數小時
   - 用途: Beta 測試，收集反饋

3. Open Testing (開放測試)
   - 測試者: 任何人都可加入
   - 審核時間: 1-2 天
   - 用途: 公開 Beta

4. Production (正式發佈)
   - 審核時間: 1-7 天（通常 2-3 天）
   - 可選分階段發佈: 10% → 50% → 100%
```

### 上傳 AAB

```
方法 1: 手動上傳（推薦首次）

1. Google Play Console → 選擇應用
2. Release → Production → Create new release
3. 上傳 AAB:
   - 點擊「Upload」
   - 選擇你的 .aab 文件
   - 等待處理（數分鐘）

4. 填寫 Release notes:
   What's new in this version (繁體中文):
   - 新功能 1
   - 新功能 2
   - Bug 修復

5. 設定發佈選項:
   - Staged rollout: 建議先 10%
   - Countries/regions: 選擇發佈地區

6. Review and roll out:
   - 檢查所有設定
   - 點擊「Start rollout to Production」

7. 等待審核（1-7 天）
```

### 版本管理

```csharp
// 每次發佈必須遞增 Version Code

// Player Settings:
Version: 1.0.0 (給用戶看，語義化版本)
Bundle Version Code: 1 (內部識別，必須遞增)

// 版本號規則範例:
v1.0.0 (Code 1)   - 初版發佈
v1.0.1 (Code 2)   - Bug 修復
v1.0.2 (Code 3)   - 小修復
v1.1.0 (Code 4)   - 新功能
v1.2.0 (Code 5)   - 更多功能
v2.0.0 (Code 6)   - 大版本更新

⚠️ Version Code 必須嚴格遞增，不能重複或回退！
```

---

# 🍎 iOS (App Store)

## iOS: Build Settings

### Unity iOS Player Settings

```csharp
// File: Editor/iOSBuildConfig.cs
using UnityEditor;
using UnityEngine;

public class iOSBuildConfig
{
    [MenuItem("Build/Configure iOS for App Store")]
    public static void ConfigureiOS()
    {
        // ===== 基本設定 =====
        PlayerSettings.companyName = "YourCompany";
        PlayerSettings.productName = "YourGame";
        PlayerSettings.applicationIdentifier = "com.yourcompany.yourgame";

        // ===== Version =====
        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.iOS.buildNumber = "1"; // 每次上傳遞增

        // ===== Target iOS Version =====
        PlayerSettings.iOS.targetOSVersionString = "12.0"; // iOS 12.0+

        // ===== Architecture =====
        PlayerSettings.SetArchitecture(BuildTargetGroup.iOS, 2); // ARM64

        // ===== 簽名 (Xcode 會處理) =====
        PlayerSettings.iOS.appleEnableAutomaticSigning = true;
        PlayerSettings.iOS.appleDeveloperTeamID = "YOUR_TEAM_ID"; // 從 Apple Developer 獲取

        // ===== 優化 =====
        PlayerSettings.stripEngineCode = true;
        PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.iOS, ManagedStrippingLevel.High);
        PlayerSettings.iOS.scriptCallOptimization = ScriptCallOptimizationLevel.FastButNoExceptions;

        // ===== Camera/Microphone Usage (如果需要) =====
        PlayerSettings.iOS.cameraUsageDescription = "我們需要相機權限來拍照功能";
        PlayerSettings.iOS.microphoneUsageDescription = "我們需要麥克風權限來語音聊天";
        PlayerSettings.iOS.locationUsageDescription = "我們需要位置權限來顯示附近玩家";

        // ===== Capabilities (根據需求) =====
        // PlayerSettings.iOS.iOSManualProvisioningProfileID = "YOUR_PROVISIONING_PROFILE_ID";
        // PlayerSettings.iOS.iOSManualProvisioningProfileType = ProvisioningProfileType.Distribution;

        Debug.Log("✅ iOS Build Settings Configured");
    }
}
```

---

## iOS: 包體限制

### App Store 限制

```
✅ 蜂窩網路下載: < 200MB (iOS 13+: 已移除限制)
✅ App Store 單一 IPA: < 4GB
📦 使用 On-Demand Resources: 可擴展到 20GB

⚠️ 注意:
- iOS 13+ 已移除 200MB OTA 限制
- 但建議初始下載 < 500MB (用戶體驗)
- 大資源使用 On-Demand Resources (ODR)
```

### iOS 優化策略

#### 1. Texture 優化 (iOS)
```csharp
// Select textures → Inspector → iOS tab

Compression: ASTC (iOS 最佳)
- ASTC 4x4: 高品質 (8 bpp)
- ASTC 6x6: 平衡 (3.56 bpp)
- ASTC 8x8: 高壓縮 (2 bpp)

Max Size: 2048 (或更小)
Format: ASTC 6x6 (推薦)
Override for iOS: ✅ Enabled
```

#### 2. Audio 優化 (iOS)
```csharp
// iOS 音頻配置
Compression Format: MP3 或 Vorbis
Quality: 70-80
Load Type: Compressed In Memory

背景音樂:
- Compression: MP3
- Quality: 70
- Load Type: Streaming (節省內存)
```

#### 3. IL2CPP + Stripping
```
Player Settings → Other Settings
→ Scripting Backend: IL2CPP
→ Managed Stripping Level: Medium (iOS 推薦 Medium 而非 High)
→ Script Call Optimization: Fast but no Exceptions

效果: 減少 30-40% 包體大小
```

#### 4. On-Demand Resources (ODR)

```csharp
// Unity 支援有限，主要通過 Xcode 配置

// 適合放入 ODR:
// - 高清貼圖
// - 額外關卡
// - DLC 內容
// - 教學視頻

// Xcode 配置:
// 1. Build Phases → Enable On Demand Resources
// 2. 設定 Resource Tags
// 3. 設定 Download Priority: Initial/Prefetched/Hosted

// Unity 側準備:
Assets/ODR/
├── HighResTextures/  (Tag: highres)
├── Level2_5/         (Tag: level2-5)
└── DLC1/             (Tag: dlc1)

// Build Settings:
// Enable On Demand Resources: Yes
```

---

## iOS: 簽名與 Provisioning

### Apple Developer 帳號設定

```
1. 訪問 https://developer.apple.com/account

2. Certificates, Identifiers & Profiles

3. 創建 App ID:
   - Identifier: com.yourcompany.yourgame
   - Explicit App ID (不要用 wildcard)
   - Capabilities:
     [✅] In-App Purchase (如果有 IAP)
     [✅] Game Center (如果用)
     [✅] Push Notifications (如果用)
     [ ] Sign in with Apple (根據需求)

4. 創建 Provisioning Profile:
   a. Development Profile (開發測試):
      - Type: iOS App Development
      - Select App ID: com.yourcompany.yourgame
      - Select Certificates: 你的開發證書
      - Select Devices: 測試設備

   b. Distribution Profile (上架):
      - Type: App Store
      - Select App ID: com.yourcompany.yourgame
      - Select Certificate: Distribution Certificate

5. 下載 Provisioning Profile (.mobileprovision)
```

### Xcode 簽名配置

```
Unity Build 後會生成 Xcode 項目

1. 打開 Xcode 項目:
   /path/to/Builds/iOS/Unity-iPhone.xcodeproj

2. 選擇 Unity-iPhone target

3. Signing & Capabilities:
   [✅] Automatically manage signing (推薦)
   Team: Your Team Name (選擇你的團隊)

   或手動簽名:
   [ ] Automatically manage signing
   Provisioning Profile: 選擇你的 Distribution Profile
   Signing Certificate: Apple Distribution

4. 檢查 Bundle Identifier:
   com.yourcompany.yourgame (必須與 App ID 一致)

5. 檢查 Capabilities:
   根據需求添加:
   + In-App Purchase
   + Game Center
   + Push Notifications
```

### 常見簽名問題

```
問題 1: "Failed to create provisioning profile"
解決:
- 確認 Bundle ID 與 App ID 一致
- 確認設備已添加到 Provisioning Profile
- 重新下載 Provisioning Profile

問題 2: "Code signing entitlements file does not contain valid data"
解決:
- 檢查 Capabilities 是否與 App ID 匹配
- 在 Xcode 中重新配置 Capabilities

問題 3: "No signing certificate found"
解決:
- Xcode → Preferences → Accounts
- 選擇 Apple ID → Manage Certificates
- 點擊 "+" → Apple Distribution
```

---

## App Store Connect 配置

### 步驟 1: 創建應用

```
1. 訪問 https://appstoreconnect.apple.com

2. My Apps → + → New App

3. 填寫:
   - Platform: iOS
   - Name: YourGame (最多 30 字符)
   - Primary Language: Traditional Chinese / English
   - Bundle ID: com.yourcompany.yourgame
   - SKU: yourgame-001 (內部識別碼)
   - User Access: Full Access

4. 點擊 Create
```

### 步驟 2: App 資訊

```
App Store → App Information

必填項目:
✅ Name: 你的遊戲名稱 (30 characters)
✅ Subtitle: 副標題 (30 characters, 可選)
✅ Privacy Policy URL: https://yourcompany.com/privacy (必填)

Category:
✅ Primary: Games → Action / Puzzle / etc.
✅ Secondary: Games → Casual (可選)

Content Rights:
( ) Contains third-party content
(●) Does not contain third-party content

Age Rating: (根據內容)
- 4+: 無不當內容
- 9+: 輕度卡通暴力
- 12+: 中度暴力或性暗示
- 17+: 強烈暴力或成人內容
```

### 步驟 3: 定價與供應狀況

```
App Store → Pricing and Availability

Price:
( ) Paid: $0.99 / $1.99 / $2.99 / ...
(●) Free

Availability:
[✅] Make this app available in all territories
或選擇特定地區:
[✅] Taiwan
[✅] Hong Kong
[✅] United States
[✅] Japan
...

Pre-Order:
( ) Make available for pre-order (可選)
```

### 步驟 4: 準備提交

```
App Store → [Version 1.0] → Prepare for Submission

1. Screenshots (必須，所有設備尺寸):

   iPhone 6.7" (required):
   - 1290 x 2796 pixels
   - 至少 3 張，最多 10 張

   iPhone 6.5":
   - 1242 x 2688 pixels
   - 至少 3 張

   iPhone 5.5":
   - 1242 x 2208 pixels
   - 至少 3 張 (如果支援舊設備)

   iPad Pro (12.9"):
   - 2048 x 2732 pixels
   - 至少 3 張 (如果支援 iPad)

   提示: 可以只提供 6.7" 和 iPad Pro，其他會自動縮放

2. App Preview (可選，視頻預覽):
   - 最多 3 個視頻
   - 15-30 秒
   - 必須使用實機錄製

3. Promotional Text (可選):
   - 170 characters
   - 可以隨時更新，不需審核

4. Description (必填):
   - 4000 characters max
   - 詳細介紹:
     * 遊戲特色
     * 玩法說明
     * 獨特賣點
     * 社群連結

5. Keywords (必填):
   - 100 characters
   - 用逗號分隔
   - 範例: "action,puzzle,strategy,casual,offline"

6. Support URL (必填):
   - https://yourcompany.com/support

7. Marketing URL (可選):
   - https://yourcompany.com/yourgame
```

### 步驟 5: Build

```
上傳 Build 到 App Store Connect (使用 Xcode):

1. Xcode → Product → Archive
2. 等待 Archive 完成
3. Organizer → Select your archive → Distribute App
4. App Store Connect → Upload → Next
5. 選擇 Distribution options:
   [✅] Include bitcode (推薦)
   [✅] Upload your app's symbols (for crash reports)
   [✅] Manage Version and Build Number (自動遞增)
6. Select Distribution Certificate and Provisioning Profile
7. Upload (等待數分鐘)

8. 回到 App Store Connect:
   - App Store → [Version 1.0] → Build
   - 等待 Build 處理完成（10-30 分鐘）
   - 選擇你的 Build
```

### 步驟 6: App Privacy (隱私詳情)

```
App Store → App Privacy

⚠️ iOS 必須詳細填寫隱私資訊

1. Privacy Policy URL: (已在 App Info 填寫)

2. Data Collection:

   Contact Info:
   [ ] Name
   [ ] Email Address
   [ ] Phone Number

   Health & Fitness:
   [ ] Health
   [ ] Fitness

   Financial Info:
   [✅] Purchase History (如果有 IAP)

   Location:
   [ ] Precise Location
   [ ] Coarse Location

   Identifiers:
   [✅] User ID
   [✅] Device ID (for analytics)

   Usage Data:
   [✅] Product Interaction (遊戲內行為)
   [✅] Advertising Data (如果有廣告)
   [✅] Other Usage Data

   Diagnostics:
   [✅] Crash Data
   [✅] Performance Data

3. Data Usage:
   每個數據類型必須說明用途:
   [✅] App Functionality
   [✅] Analytics
   [✅] Product Personalization
   [✅] Advertising or Marketing

4. Data Linking:
   Is data linked to user identity?
   ( ) Yes - 數據與用戶身份關聯
   (●) No - 匿名數據

5. Tracking:
   Does your app track users?
   (●) Yes - 如果使用 IDFA 做廣告追蹤
   ( ) No

   如果 Yes，必須實現 ATTrackingManager:

   // iOS 14.5+ 必須請求追蹤授權
   #import <AppTrackingTransparency/AppTrackingTransparency.h>

   [ATTrackingManager requestTrackingAuthorizationWithCompletionHandler:^(ATTrackingManagerAuthorizationStatus status) {
       if (status == ATTrackingManagerAuthorizationStatusAuthorized) {
           // 用戶同意追蹤
       }
   }];
```

### 步驟 7: Age Rating

```
App Store → Age Rating

填寫問卷 (與 Google Play 類似):
1. Cartoon or Fantasy Violence: None / Infrequent / Frequent
2. Realistic Violence: None / Infrequent / Frequent
3. Sexual Content or Nudity: None / Infrequent / Frequent
4. Profanity or Crude Humor: None / Infrequent / Frequent
5. Alcohol, Tobacco, or Drug Use: None / Infrequent / Frequent
6. Mature/Suggestive Themes: None / Infrequent / Frequent
7. Gambling: None / Infrequent / Frequent
8. Horror/Fear Themes: None / Infrequent / Frequent

完成後獲得分級:
- 4+: 無不當內容
- 9+: 輕度不當內容
- 12+: 中度不當內容
- 17+: 強烈不當內容
```

### 步驟 8: 提交審核

```
App Store → [Version 1.0]

確認所有項目完成:
✅ App Information
✅ Pricing and Availability
✅ Screenshots (all sizes)
✅ Description
✅ Keywords
✅ Build selected
✅ App Privacy
✅ Age Rating
✅ Export Compliance: 選擇適當選項

Export Compliance:
- "Is your app designed to use cryptography?"
  大多數遊戲: No (unless you implement custom encryption)
  如果使用 HTTPS: Yes, but only standard encryption

準備好後:
1. 點擊「Add for Review」
2. 填寫 Review Notes (可選):
   - 測試帳號 (如果需要)
   - 特殊說明
3. 點擊「Submit for Review」

審核時間:
- 通常 1-3 天
- 首次審核可能需要 5-7 天
- 節假日會更久
```

---

## TestFlight 與發佈

### TestFlight 內測

```
TestFlight 是 iOS 的內測平台

1. 上傳 Build 到 App Store Connect (同上)

2. TestFlight → [Your App] → Internal Testing:
   - 自動創建 Internal Group
   - 最多 100 個測試者
   - 必須是你的 App Store Connect 團隊成員
   - 無需審核，立即可測試

3. TestFlight → External Testing:
   - 創建新組 (Group)
   - 添加測試者 (Email)
   - 最多 10,000 個測試者
   - 需要 Beta Review (通常 1 天)

4. 測試者接收邀請:
   - Email 邀請 → 下載 TestFlight App
   - 輸入邀請碼 → 安裝遊戲
   - 提供反饋

5. 收集反饋:
   - TestFlight → Feedback
   - 查看崩潰報告
   - 查看截圖和評論
```

### 正式發佈

```
發佈方式 1: 立即發佈
- Submit for Review → 審核通過後自動上架

發佈方式 2: 手動發佈
- Submit for Review
- App Store Connect → Version →
  Release this version: Manually release this version
- 審核通過後，手動點擊 "Release this version"

發佈方式 3: 定時發佈
- 設定發佈日期和時間
- 審核通過後，在指定時間自動上架

分階段發佈 (Phased Release):
App Store → Version → Phased Release
[✅] Release this version over a 7-day period

Day 1: 1%
Day 2: 2%
Day 3: 5%
Day 4: 10%
Day 5: 20%
Day 6: 50%
Day 7: 100%

可以隨時暫停或繼續
```

### 版本更新

```
發佈新版本:

1. App Store Connect → My Apps → [Your App]
2. 點擊 "+" → Create New Version
3. Version Number: 1.0.1 (遞增)
4. What's New: 更新說明
5. 上傳新 Build (Build Number 必須遞增)
6. Submit for Review

⚠️ Build Number 管理:
Version 1.0.0:
  Build 1, 2, 3 (TestFlight 測試)
  Build 4 (正式發佈)

Version 1.0.1:
  Build 5, 6 (TestFlight)
  Build 7 (正式發佈)

Version 1.1.0:
  Build 8, 9, 10 (TestFlight)
  Build 11 (正式發佈)

規則: Build Number 全局遞增，永不重複
```

---

# 🌐 雙平台通用

## 雙平台資產優化

### 通用 Texture 優化

```csharp
// 雙平台 Texture 設定策略

// 高品質 (UI, Characters):
Android (ASTC):
- Format: ASTC 6x6
- Max Size: 2048
iOS (ASTC):
- Format: ASTC 6x6
- Max Size: 2048

// 中品質 (Environment, Props):
Android: ASTC 6x6, Max 1024
iOS: ASTC 6x6, Max 1024

// 低品質 (Background, Effects):
Android: ASTC 8x8, Max 512
iOS: ASTC 8x8, Max 512

// 壓縮對比:
ASTC 4x4: 8 bpp (高品質, 大文件)
ASTC 6x6: 3.56 bpp (平衡, 推薦)
ASTC 8x8: 2 bpp (高壓縮, 低品質)
```

### 通用 Audio 優化

```csharp
// 音效 (SFX):
Compression: Vorbis
Quality: 70-80
Load Type: Decompress On Load (頻繁播放)

// 背景音樂 (BGM):
Compression: Vorbis / MP3
Quality: 80-90
Load Type: Streaming (節省內存)

// 語音 (Voice):
Compression: Vorbis
Quality: 50-60 (語音可以低品質)
Load Type: Compressed In Memory
```

### 通用 Mesh 優化

```csharp
// 所有 Model:
Read/Write Enabled: ❌ 關閉 (節省內存)
Optimize Mesh: ✅ 啟用
Mesh Compression: High
Normals: Calculate (如果不需要自定義法線)
Tangents: Calculate (只在使用法線貼圖時)

// 減少頂點數:
// Blender/Maya: 使用 Decimate Modifier
// Unity: Import Settings → Mesh Compression
```

### 使用 Addressables 管理資源

```csharp
// 安裝 Addressables Package
// Window → Package Manager → Addressables

// 標記資源為 Addressable
// Select asset → Inspector → Addressable

// 遠程資源配置
// Window → Asset Management → Addressables → Groups

// 創建遠程組
Group Name: RemoteAssets
Build & Load Paths: Remote

// 運行時加載
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class AssetLoader : MonoBehaviour
{
    async void Start()
    {
        // 異步加載
        AsyncOperationHandle<GameObject> handle =
            Addressables.LoadAssetAsync<GameObject>("MyAsset");

        await handle.Task;

        if (handle.Status == AsyncOperationStatus.Succeeded)
        {
            GameObject asset = handle.Result;
            Instantiate(asset);
        }
    }
}
```

---

## 隱私政策與合規

### 必須的隱私政策內容

```
Privacy Policy 必須包含 (雙平台):

1. 公司資訊
   - 公司名稱
   - 聯絡方式
   - 地址

2. 收集的數據
   ✅ 設備識別碼 (Device ID)
   ✅ IP 地址
   ✅ 遊戲進度
   ✅ 購買記錄 (如果有 IAP)
   ✅ 崩潰日誌
   ✅ 性能數據
   ✅ 廣告識別碼 (如果有廣告)

3. 數據用途
   ✅ 遊戲功能
   ✅ 數據分析
   ✅ 改善體驗
   ✅ 廣告投放 (如果有)
   ✅ 客戶支援

4. 第三方服務
   列出所有使用的第三方 SDK:
   - Unity Analytics
   - Google Analytics / Firebase
   - AdMob / Unity Ads (如果有廣告)
   - Facebook SDK (如果有社交功能)
   - GameAnalytics
   - AppsFlyer (如果有)

5. 數據安全
   ✅ 傳輸加密 (HTTPS)
   ✅ 存儲安全措施
   ✅ 數據保留期限

6. 用戶權利
   ✅ 查看數據的權利
   ✅ 刪除數據的權利
   ✅ 退出追蹤的權利
   ✅ 聯繫方式

7. 兒童隱私 (如果目標受眾包含兒童)
   - COPPA 合規 (美國)
   - GDPR-K 合規 (歐盟)

8. 政策更新
   - 最後更新日期
   - 如何通知用戶更新

9. 聯繫資訊
   - Email: privacy@yourcompany.com
   - Website: https://yourcompany.com/contact
```

### iOS 特殊要求: App Tracking Transparency (ATT)

```objc
// iOS 14.5+ 必須實現 ATT

// Info.plist 添加:
<key>NSUserTrackingUsageDescription</key>
<string>我們會使用您的資料來為您提供個人化廣告</string>

// 在 Unity 中請求授權:
#if UNITY_IOS
using UnityEngine.iOS;

void RequestTracking()
{
    // iOS 14.5+
    if (Application.RequestAdvertisingIdentifierAsync != null)
    {
        Application.RequestAdvertisingIdentifierAsync(
            (string advertisingId, bool trackingEnabled, string error) => {
                if (trackingEnabled)
                {
                    Debug.Log("✅ 用戶同意追蹤");
                    // 可以使用 IDFA
                }
                else
                {
                    Debug.Log("❌ 用戶拒絕追蹤");
                    // 不能使用 IDFA
                }
            }
        );
    }
}
#endif
```

### GDPR 合規 (歐盟)

```csharp
// 必須提供用戶同意機制

public class GDPRConsent : MonoBehaviour
{
    void Start()
    {
        if (IsEUUser())
        {
            ShowGDPRConsent();
        }
    }

    bool IsEUUser()
    {
        // 檢查地區
        string countryCode = RegionInfo.CurrentRegion.TwoLetterISORegionName;
        string[] euCountries = { "DE", "FR", "IT", "ES", "NL", "BE", "AT", ... };
        return Array.Exists(euCountries, c => c == countryCode);
    }

    void ShowGDPRConsent()
    {
        // 顯示同意對話框
        // "我們使用 Cookie 和類似技術來..."
        // [接受] [拒絕] [了解更多]

        // 保存用戶選擇
        if (userAccepts)
        {
            PlayerPrefs.SetInt("GDPRConsent", 1);
            InitializeAnalytics();
        }
        else
        {
            PlayerPrefs.SetInt("GDPRConsent", 0);
            // 不初始化追蹤
        }
    }
}
```

---

## 審核注意事項

### Google Play 常見拒絕原因

```
1. 隱私政策問題
   ❌ 缺少 Privacy Policy URL
   ❌ Privacy Policy 不完整
   ❌ 未聲明數據收集
   ✅ 解決: 提供完整的隱私政策，正確填寫 Data Safety

2. 目標 API 過低
   ❌ Target SDK < 31 (Android 12)
   ✅ 解決: 更新 Target SDK 到 33 或 34

3. 權限問題
   ❌ 使用敏感權限但未說明理由
   ❌ 請求過多不必要的權限
   ✅ 解決: 只請求必要權限，提供清晰說明

4. 內容問題
   ❌ Icon 或截圖包含誤導性內容
   ❌ 描述與實際功能不符
   ✅ 解決: 確保宣傳材料真實反映遊戲

5. 元數據問題
   ❌ App 名稱包含關鍵字堆砌
   ❌ 描述中包含競品名稱
   ✅ 解決: 使用清晰、專業的名稱和描述

6. 技術問題
   ❌ 應用崩潰或無法啟動
   ❌ 主要功能損壞
   ✅ 解決: 徹底測試後再提交

7. 違反政策
   ❌ 包含未成年人不當內容但年齡分級過低
   ❌ 賭博內容但未申報
   ✅ 解決: 正確設置內容分級，如實申報
```

### App Store 常見拒絕原因

```
1. Performance - App Completeness (2.1)
   ❌ 應用崩潰或有明顯 bug
   ❌ Placeholder 內容
   ❌ 功能不完整
   ✅ 解決: 確保應用完整且穩定

2. Business - In-App Purchase (3.1.1)
   ❌ 使用非 Apple IAP 系統購買虛擬物品
   ❌ 價格不當 (過高或誤導)
   ✅ 解決: 使用 Apple IAP，合理定價

3. Design - User Interface (4.0)
   ❌ UI 與 iOS Human Interface Guidelines 不符
   ❌ 分辨率問題或適配問題
   ❌ 控制元素太小或難以點擊
   ✅ 解決: 遵循 iOS 設計規範

4. Legal - Privacy (5.1)
   ❌ 未提供隱私政策
   ❌ 未實現 ATT (App Tracking Transparency)
   ❌ 未說明數據收集目的
   ✅ 解決: 完整實現隱私要求

5. Legal - Intellectual Property (5.2)
   ❌ 使用未授權的素材
   ❌ 仿冒其他應用
   ✅ 解決: 確保所有資源有授權

6. Safety - Objectionable Content (1.1)
   ❌ 包含不當內容但未正確分級
   ❌ 用戶生成內容未過濾
   ✅ 解決: 正確設置年齡分級，實現內容過濾

7. Performance - Accurate Metadata (2.3)
   ❌ 截圖或視頻與實際不符
   ❌ 描述誤導用戶
   ❌ Hidden features
   ✅ 解決: 真實呈現應用功能

8. Safety - Kids Category (1.3)
   ❌ 標記為兒童應用但包含不當內容
   ❌ 包含第三方廣告或追蹤
   ✅ 解決: 兒童應用有更嚴格要求

9. Design - Minimum Functionality (4.2)
   ❌ 應用過於簡單
   ❌ 主要功能是網頁查看器
   ✅ 解決: 提供足夠的原生功能

10. Guideline 4.3 - Spam
    ❌ 大量相似應用
    ❌ 複製模板應用
    ✅ 解決: 確保應用有獨特價值
```

### 審核加速技巧

```
Google Play:
1. 首次提交使用內部測試軌道（數小時審核）
2. 確保所有元數據完整
3. 提供高質量截圖
4. 及時回應審核團隊

App Store:
1. 提供詳細的 Review Notes
2. 如果需要登錄，提供測試帳號
3. 如果有特殊功能，提供使用說明
4. 回應審核被拒後，立即修復並重新提交
5. 使用 Expedited Review (緊急審核):
   - App Store Connect → Contact Us
   - Request Expedited Review
   - 說明緊急原因（如修復嚴重 bug）
   - 通常 1-2 天審核
```

---

## 常見問題處理

### Q1: Android AAB 超過 200MB

```
解決方案優先級:

1️⃣ 資產優化 (見上文)
   - Texture: ASTC 壓縮, Max 2048
   - Audio: Vorbis 70-80 quality
   - Mesh: High compression
   - IL2CPP + High Stripping
   - 結果: 通常可減少 30-50%

2️⃣ 如果仍超過 200MB
   → 使用 Play Asset Delivery (PAD)
   - 將大資產移到 Asset Packs
   - install-time: 必須的高品質資源
   - fast-follow: 額外關卡
   - on-demand: DLC

3️⃣ 極端情況
   → 拆分為多個應用
   - 主程式 + DLC 應用
```

### Q2: iOS Build 失敗

```
常見錯誤:

錯誤: "No valid code signing"
解決:
- Xcode → Preferences → Accounts
- 重新下載 Provisioning Profile
- 確認 Bundle ID 正確

錯誤: "Framework not found"
解決:
- Xcode → Build Phases → Link Binary
- 檢查缺少的 Framework
- 添加必要的系統 Framework

錯誤: "Symbol(s) not found for architecture arm64"
解決:
- 檢查 Plugin 是否支援 ARM64
- 更新或移除不相容的 Plugin
- 確認 Build Settings → Architecture = ARM64

錯誤: "The bundle identifier cannot be changed"
解決:
- 無法更改已上架應用的 Bundle ID
- 如需更改，必須發佈新應用
```

### Q3: 審核被拒後如何處理

```
Google Play:

1. 閱讀拒絕原因（Email 通知）
2. 進入 Play Console → Policy Status
3. 查看詳細違規內容
4. 修復問題
5. 上傳新 AAB（Version Code 遞增）
6. 在「Review summary」說明修改內容
7. 重新提交

App Store:

1. 閱讀 Resolution Center 的拒絕原因
2. 理解具體違反的條款
3. 修復問題:
   - 如果是代碼問題: 修復並重新 Build
   - 如果是元數據問題: 直接修改
4. 回覆 Resolution Center:
   - 說明已修改的內容
   - 提供額外說明（如果需要）
5. 重新提交審核

如果不同意拒絕:
- 可以申訴 (Appeal)
- 提供詳細說明和證據
- 引用相關條款
```

### Q4: 如何處理不同國家/地區的要求

```
中國大陸特殊要求:
❌ Google Play 不可用
✅ 需要上架其他商店:
   - TapTap (不需要版號)
   - 小米應用商店
   - 華為應用市場
   - 等等
⚠️ 遊戲類需要版號（複雜且耗時）

歐盟 GDPR:
✅ 必須實現同意機制
✅ 允許用戶刪除數據
✅ 數據可攜權

美國 COPPA (兒童應用):
✅ 13 歲以下需要家長同意
✅ 不得收集個人資訊
✅ 不得針對兒童投放廣告

韓國:
✅ 必須提供韓文本地化（App Store）
✅ 實名認證系統（某些類型）

日本:
✅ 遵守日本個人資訊保護法
✅ 提供日文支援
```

### Q5: 跨平台帳號系統

```csharp
// 實現跨平台雲存檔和帳號

public class CloudSaveManager : MonoBehaviour
{
    void Start()
    {
        #if UNITY_ANDROID
            InitializeGooglePlayGames();
        #elif UNITY_IOS
            InitializeGameCenter();
        #endif
    }

    #if UNITY_ANDROID
    void InitializeGooglePlayGames()
    {
        PlayGamesPlatform.Activate();
        Social.localUser.Authenticate((bool success) => {
            if (success)
            {
                Debug.Log("✅ Google Play Games 登入成功");
                LoadCloudSave();
            }
        });
    }
    #endif

    #if UNITY_IOS
    void InitializeGameCenter()
    {
        Social.localUser.Authenticate((bool success) => {
            if (success)
            {
                Debug.Log("✅ Game Center 登入成功");
                LoadCloudSave();
            }
        });
    }
    #endif

    void LoadCloudSave()
    {
        // 從雲端加載存檔
        // 合併本地和雲端數據
    }

    void SaveToCloud()
    {
        // 上傳存檔到雲端
    }
}

// 或使用統一的後端服務:
// - Firebase (推薦)
// - PlayFab
// - Custom REST API
```

---

## 📋 完整上架 Checklist

### Android (Google Play)

```
構建階段:
✅ Bundle Identifier 正確
✅ Version Code 遞增
✅ Target SDK ≥ 33 (Android 13)
✅ IL2CPP + ARM64
✅ Keystore 配置正確
✅ AAB ≤ 200MB 或 PAD 配置完成
✅ 所有功能測試通過

商店資訊:
✅ App icon (512x512)
✅ Feature graphic (1024x500)
✅ Screenshots (所有尺寸)
✅ Short description
✅ Full description
✅ Privacy Policy URL
✅ Content rating 完成
✅ Data safety 完整
✅ Target audience 設定

發佈:
✅ 選擇發佈軌道 (Internal/Closed/Open/Production)
✅ Release notes 準備
✅ 分階段發佈設定 (建議 10% → 50% → 100%)
✅ 選擇發佈地區
```

### iOS (App Store)

```
構建階段:
✅ Bundle Identifier 正確 (與 App ID 一致)
✅ Version + Build Number 正確
✅ Minimum iOS Version: 12.0+
✅ IL2CPP + ARM64
✅ Xcode 簽名配置正確
✅ 所有 Capabilities 配置
✅ 所有功能測試通過 (真機)
✅ 實現 ATT (如果追蹤用戶)

商店資訊:
✅ App icon (1024x1024)
✅ Screenshots (6.7", iPad Pro)
✅ App Preview (可選)
✅ Description
✅ Keywords
✅ Privacy Policy URL
✅ Support URL
✅ App Privacy 詳情完整
✅ Age Rating 正確

發佈:
✅ Build 上傳並處理完成
✅ Build 選擇
✅ Export Compliance 填寫
✅ Release 方式選擇 (立即/手動/定時)
✅ Phased Release (可選)
```

---

## 🎯 最佳實踐總結

### 雙平台通用

1. **永遠備份簽名文件**
   - Android: Keystore 至少 3 份備份
   - iOS: Certificate + Provisioning Profile 備份

2. **使用平台簽名服務**
   - Android: Play App Signing
   - iOS: Automatic Signing (Xcode)

3. **資產優化優先**
   - 先優化再考慮資產分發
   - 目標: Android < 200MB, iOS < 500MB

4. **隱私合規第一**
   - 完整的 Privacy Policy
   - 正確的數據聲明
   - GDPR / COPPA / ATT 合規

5. **分階段發佈**
   - 降低風險
   - 快速發現問題
   - 逐步擴大用戶

6. **監控和回應**
   - 監控崩潰率
   - 監控用戶評價
   - 快速修復嚴重 bug

7. **版本管理規範**
   - 語義化版本號
   - Version Code/Build Number 嚴格遞增
   - 詳細的 Release Notes

8. **測試覆蓋**
   - 多設備測試
   - 不同 OS 版本測試
   - 弱網環境測試

---

## 📚 參考資源

### Android
- [Android App Bundle 文檔](https://developer.android.com/guide/app-bundle)
- [Play Asset Delivery](https://developer.android.com/guide/playcore/asset-delivery)
- [Play Console Help](https://support.google.com/googleplay/android-developer)
- [Unity Android Build](https://docs.unity3d.com/Manual/android-BuildProcess.html)
- [Play Plugins for Unity](https://github.com/google/play-unity-plugins)

### iOS
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)
- [Unity iOS Build](https://docs.unity3d.com/Manual/iphone-GettingStarted.html)
- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [TestFlight Guide](https://developer.apple.com/testflight/)

### 隱私合規
- [GDPR Official Site](https://gdpr.eu/)
- [COPPA Rule](https://www.ftc.gov/enforcement/rules/rulemaking-regulatory-reform-proceedings/childrens-online-privacy-protection-rule)
- [ATT Framework](https://developer.apple.com/documentation/apptrackingtransparency)

---

## ⏱️ 時間估計

```
首次上架:
- Android (Google Play):
  * 配置: 2-3 小時
  * Build: 30 分鐘
  * 上傳: 15 分鐘
  * 審核: 1-7 天 (通常 2-3 天)
  * 總計: 約 3-4 天

- iOS (App Store):
  * 配置: 3-4 小時 (包含 Xcode)
  * Build: 30-60 分鐘
  * Archive + Upload: 30 分鐘
  * 審核: 1-7 天 (通常 2-3 天)
  * 總計: 約 3-5 天

版本更新:
- Android: 1 小時 + 1-3 天審核
- iOS: 1-2 小時 + 1-3 天審核
```

---

**記住:**
1. 第一次最費時，後續更新快很多
2. 使用 TestFlight / Internal Testing 先測試
3. 備份所有簽名文件
4. 隱私合規非常重要
5. 耐心等待審核，不要頻繁重新提交

**祝您上架順利！** 🚀📱
