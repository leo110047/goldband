# 雙平台通用：資產優化、隱私、審核、FAQ

## 資產優化通用策略

### Texture 優化
```
高品質 (UI/Characters): ASTC 6x6, Max 2048
中品質 (Environment):   ASTC 6x6, Max 1024
低品質 (Background):    ASTC 8x8, Max 512

ASTC 壓縮對比:
ASTC 4x4: 8 bpp (高品質)
ASTC 6x6: 3.56 bpp (平衡, 推薦)
ASTC 8x8: 2 bpp (高壓縮)
```

### Audio 優化
```
SFX:   Vorbis, Quality 70-80, Decompress On Load
BGM:   Vorbis/MP3, Quality 80-90, Streaming
Voice: Vorbis, Quality 50-60, Compressed In Memory
```

### Mesh 優化
```
Read/Write Enabled: OFF (節省內存)
Optimize Mesh: ON
Mesh Compression: High
Normals: Calculate (如不需要自定義法線)
Tangents: Calculate (只在使用法線貼圖時)
```

### Addressables 管理
```csharp
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class AssetLoader : MonoBehaviour
{
    async void Start()
    {
        AsyncOperationHandle<GameObject> handle =
            Addressables.LoadAssetAsync<GameObject>("MyAsset");
        await handle.Task;

        if (handle.Status == AsyncOperationStatus.Succeeded)
        {
            Instantiate(handle.Result);
        }
    }
}

// 配置:
// Window → Package Manager → Addressables
// 標記資源為 Addressable
// Window → Asset Management → Addressables → Groups
// 建立 Remote Group, Build & Load Paths: Remote
```

---

## 隱私政策與合規

### Privacy Policy 必須包含
```
1. 公司資訊 — 名稱、聯絡方式、地址
2. 收集的數據 — Device ID、IP、遊戲進度、購買記錄、崩潰日誌、性能數據
3. 數據用途 — 遊戲功能、分析、改善體驗、廣告、客服
4. 第三方服務 — Unity Analytics, Firebase, AdMob, GameAnalytics 等
5. 數據安全 — HTTPS 傳輸加密、存儲安全、保留期限
6. 用戶權利 — 查看、刪除、退出追蹤
7. 兒童隱私 — COPPA/GDPR-K (如適用)
8. 政策更新 — 最後更新日期、通知方式
9. 聯繫資訊 — Email、Website

隱私政策生成器:
- https://www.privacypolicygenerator.info/
- https://www.freeprivacypolicy.com/
```

### iOS ATT (App Tracking Transparency)
```csharp
// iOS 14.5+ 必須實現

// Info.plist:
// <key>NSUserTrackingUsageDescription</key>
// <string>我們會使用您的資料來為您提供個人化廣告</string>

#if UNITY_IOS
void RequestTracking()
{
    Application.RequestAdvertisingIdentifierAsync(
        (string advertisingId, bool trackingEnabled, string error) => {
            if (trackingEnabled)
            {
                // 可以使用 IDFA
            }
        }
    );
}
#endif
```

### GDPR 合規 (歐盟)
```csharp
public class GDPRConsent : MonoBehaviour
{
    void Start()
    {
        if (IsEUUser())
            ShowGDPRConsent();
    }

    bool IsEUUser()
    {
        string countryCode = RegionInfo.CurrentRegion.TwoLetterISORegionName;
        string[] euCountries = { "DE", "FR", "IT", "ES", "NL", "BE", "AT" };
        return Array.Exists(euCountries, c => c == countryCode);
    }

    void ShowGDPRConsent()
    {
        // 顯示同意對話框: [接受] [拒絕] [了解更多]
        if (userAccepts)
        {
            PlayerPrefs.SetInt("GDPRConsent", 1);
            InitializeAnalytics();
        }
        else
        {
            PlayerPrefs.SetInt("GDPRConsent", 0);
        }
    }
}
```

---

## 審核注意事項

### Google Play 常見拒絕原因
```
1. 隱私政策問題 → 提供完整隱私政策，正確填寫 Data Safety
2. Target API 過低 → 更新 Target SDK 到 33+
3. 權限問題 → 只請求必要權限，提供說明
4. 內容問題 → 截圖真實反映遊戲
5. 元數據問題 → 不要關鍵字堆砌或包含競品名稱
6. 技術問題 → 徹底測試後再提交
7. 內容分級錯誤 → 正確設置，如實申報
```

### App Store 常見拒絕原因
```
1. 2.1 App Completeness → 應用崩潰/不完整
2. 3.1.1 In-App Purchase → 必須使用 Apple IAP
3. 4.0 User Interface → 遵循 iOS HIG
4. 5.1 Privacy → 完整實現隱私要求 + ATT
5. 5.2 Intellectual Property → 確保素材有授權
6. 1.1 Objectionable Content → 正確分級 + 內容過濾
7. 2.3 Accurate Metadata → 截圖/描述必須真實
8. 1.3 Kids Category → 兒童應用更嚴格
9. 4.2 Minimum Functionality → 提供足夠原生功能
10. 4.3 Spam → 確保應用有獨特價值
```

### 審核加速技巧
```
Google Play:
- 首次用 Internal Testing（數小時審核）
- 確保元數據完整
- 及時回應審核團隊

App Store:
- 提供詳細 Review Notes + 測試帳號
- 緊急可用 Expedited Review
  (App Store Connect → Contact Us → Request Expedited Review)
```

---

## 常見問題處理

### Q1: Android AAB 超過 200MB
```
1. 資產優化 (ASTC + Vorbis + IL2CPP + High Stripping) → 減少 30-50%
2. 仍超過 → 使用 PAD (install-time/fast-follow/on-demand)
3. 極端情況 → 拆分為多個應用
```

### Q2: iOS Build 失敗
```
"No valid code signing" → 重新下載 Provisioning Profile，確認 Bundle ID
"Framework not found" → Xcode Build Phases → Link Binary，添加 Framework
"Symbol(s) not found arm64" → 檢查 Plugin ARM64 支援
"Bundle identifier cannot be changed" → 已上架應用無法更改 Bundle ID
```

### Q3: 審核被拒後處理
```
Google Play:
1. 閱讀拒絕原因 → Play Console → Policy Status
2. 修復 → 上傳新 AAB (Version Code 遞增)
3. 在 Review summary 說明修改 → 重新提交

App Store:
1. Resolution Center → 閱讀拒絕原因
2. 修復代碼或元數據
3. 回覆 Resolution Center → 重新提交
4. 不同意可 Appeal (提供證據)
```

### Q4: 不同國家/地區要求
```
中國大陸: Google Play 不可用，需上架 TapTap/小米/華為等，遊戲需版號
歐盟 GDPR: 同意機制 + 數據刪除權 + 數據可攜權
美國 COPPA: 13 歲以下需家長同意
韓國: 韓文本地化 + 實名認證
日本: 個人資訊保護法 + 日文支援
```

### Q5: 跨平台帳號系統
```csharp
public class CloudSaveManager : MonoBehaviour
{
    void Start()
    {
        #if UNITY_ANDROID
            // Google Play Games
            PlayGamesPlatform.Activate();
            Social.localUser.Authenticate((success) => { if (success) LoadCloudSave(); });
        #elif UNITY_IOS
            // Game Center
            Social.localUser.Authenticate((success) => { if (success) LoadCloudSave(); });
        #endif
    }
}

// 或使用統一後端: Firebase (推薦), PlayFab, Custom REST API
```
