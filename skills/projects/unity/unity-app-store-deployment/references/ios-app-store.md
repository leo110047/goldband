# iOS (App Store) 詳細指南

## iOS Build Settings

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
        PlayerSettings.companyName = "YourCompany";
        PlayerSettings.productName = "YourGame";
        PlayerSettings.applicationIdentifier = "com.yourcompany.yourgame";

        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.iOS.buildNumber = "1";

        PlayerSettings.iOS.targetOSVersionString = "12.0";
        PlayerSettings.SetArchitecture(BuildTargetGroup.iOS, 2); // ARM64

        PlayerSettings.iOS.appleEnableAutomaticSigning = true;
        PlayerSettings.iOS.appleDeveloperTeamID = "YOUR_TEAM_ID";

        PlayerSettings.stripEngineCode = true;
        PlayerSettings.SetManagedStrippingLevel(BuildTargetGroup.iOS, ManagedStrippingLevel.High);
        PlayerSettings.iOS.scriptCallOptimization = ScriptCallOptimizationLevel.FastButNoExceptions;

        // 權限描述（如需要）
        PlayerSettings.iOS.cameraUsageDescription = "需要相機權限";
        PlayerSettings.iOS.microphoneUsageDescription = "需要麥克風權限";
        PlayerSettings.iOS.locationUsageDescription = "需要位置權限";

        Debug.Log("iOS Build Settings Configured");
    }
}
```

---

## iOS 包體限制

### App Store 限制
```
✅ App Store 單一 IPA: < 4GB
📦 On-Demand Resources: 可擴展到 20GB
✅ iOS 13+ 已移除 200MB OTA 限制
⚠️ 建議初始下載 < 500MB (用戶體驗)
```

### 優化策略

#### 1. Texture 優化
```csharp
// ASTC 壓縮 (iOS 最佳)
ASTC 4x4: 8 bpp (高品質, 大文件)
ASTC 6x6: 3.56 bpp (平衡, 推薦)
ASTC 8x8: 2 bpp (高壓縮, 低品質)

Max Size: 2048
Format: ASTC 6x6
Override for iOS: Enabled
```

#### 2. Audio 優化
```csharp
// BGM: MP3, Quality 70, Streaming
// SFX: Vorbis, Quality 70-80, Compressed In Memory
```

#### 3. IL2CPP + Stripping
```
Scripting Backend: IL2CPP
Managed Stripping Level: Medium (iOS 推薦 Medium 而非 High)
Script Call Optimization: Fast but no Exceptions
效果: 減少 30-40% 包體大小
```

#### 4. On-Demand Resources (ODR)
```csharp
// 適合放入 ODR: 高清貼圖、額外關卡、DLC、教學視頻

// Xcode 配置:
// Build Phases → Enable On Demand Resources
// 設定 Resource Tags
// 設定 Download Priority: Initial/Prefetched/Hosted

Assets/ODR/
├── HighResTextures/  (Tag: highres)
├── Level2_5/         (Tag: level2-5)
└── DLC1/             (Tag: dlc1)
```

---

## iOS 簽名與 Provisioning

### Apple Developer 帳號設定
```
1. https://developer.apple.com/account
2. Certificates, Identifiers & Profiles

3. 創建 App ID:
   - Identifier: com.yourcompany.yourgame
   - Explicit App ID (不要用 wildcard)
   - Capabilities: In-App Purchase, Game Center, Push Notifications

4. 創建 Provisioning Profile:
   a. Development: iOS App Development
   b. Distribution: App Store

5. 下載 .mobileprovision
```

### Xcode 簽名配置
```
Unity Build → 生成 Xcode Project

1. 打開 Unity-iPhone.xcodeproj
2. 選擇 Unity-iPhone target
3. Signing & Capabilities:
   [✅] Automatically manage signing (推薦)
   Team: Your Team Name

4. Bundle Identifier 必須與 App ID 一致
5. 添加需要的 Capabilities
```

### 常見簽名問題
```
"Failed to create provisioning profile"
→ 確認 Bundle ID 與 App ID 一致
→ 確認設備已添加到 Profile
→ 重新下載 Provisioning Profile

"Code signing entitlements file does not contain valid data"
→ 檢查 Capabilities 是否與 App ID 匹配

"No signing certificate found"
→ Xcode → Preferences → Accounts → Manage Certificates → +
```

---

## App Store Connect 配置

### 創建應用
```
1. https://appstoreconnect.apple.com
2. My Apps → + → New App
3. Platform: iOS
   Name: YourGame (30 chars)
   Primary Language: Traditional Chinese / English
   Bundle ID: com.yourcompany.yourgame
   SKU: yourgame-001
```

### App 資訊
```
必填:
✅ Name (30 chars)
✅ Subtitle (30 chars, 可選)
✅ Privacy Policy URL
✅ Category: Games → 子類別
✅ Age Rating
```

### 定價與供應
```
Price: Free 或 Paid ($0.99+)
Availability: All territories 或指定地區
Pre-Order: 可選
```

### 準備提交
```
1. Screenshots (必須):
   iPhone 6.7": 1290x2796, 至少 3 張
   iPad Pro 12.9": 2048x2732, 至少 3 張
   (提供 6.7" + iPad Pro，其他自動縮放)

2. App Preview: 最多 3 個 15-30 秒視頻 (可選)
3. Promotional Text: 170 chars (可隨時更新)
4. Description: 4000 chars (必填)
5. Keywords: 100 chars, 逗號分隔 (必填)
6. Support URL (必填)
7. Marketing URL (可選)
```

### Upload Build
```
1. Xcode → Product → Archive
2. Organizer → Distribute App → App Store Connect
3. Upload (含 bitcode + symbols)
4. App Store Connect → 等待處理 (10-30 分鐘)
5. 選擇 Build
```

### App Privacy
```
必須詳細填寫:
- Contact Info, Financial Info, Location
- Identifiers (User ID, Device ID)
- Usage Data (Product Interaction, Advertising Data)
- Diagnostics (Crash Data, Performance Data)

每項需說明用途 + 是否關聯用戶身份

如有追蹤，必須實現 ATTrackingManager (iOS 14.5+)
```

### Age Rating
```
問卷: Violence, Sexual Content, Profanity, Drugs, Gambling, Horror
→ 自動計算: 4+ / 9+ / 12+ / 17+
```

### 提交審核
```
確認完成:
✅ All App Information
✅ Screenshots + Description + Keywords
✅ Build selected
✅ App Privacy + Age Rating
✅ Export Compliance

Export Compliance:
- 大多數遊戲: No custom encryption
- 使用 HTTPS: Yes, standard encryption

Submit for Review
審核: 通常 1-3 天，首次可能 5-7 天
```

---

## TestFlight 與發佈

### TestFlight 內測
```
Internal Testing:
- 最多 100 人 (App Store Connect 團隊成員)
- 無需審核，立即可測試

External Testing:
- 最多 10,000 人 (Email 邀請)
- 需要 Beta Review (通常 1 天)
- 測試者通過 TestFlight App 安裝
```

### 正式發佈
```
方式 1: 立即發佈 — 審核通過後自動上架
方式 2: 手動發佈 — 審核通過後手動點擊發佈
方式 3: 定時發佈 — 設定日期時間

分階段發佈 (Phased Release):
Day 1: 1% → Day 2: 2% → Day 3: 5% → Day 4: 10%
Day 5: 20% → Day 6: 50% → Day 7: 100%
可隨時暫停或繼續
```

### 版本更新
```
1. App Store Connect → Create New Version
2. Version Number: 1.0.1 (遞增)
3. What's New 更新說明
4. 上傳新 Build (Build Number 必須遞增)
5. Submit for Review

Build Number 全局遞增，永不重複:
v1.0.0: Build 1,2,3 (TestFlight) → Build 4 (正式)
v1.0.1: Build 5,6 (TestFlight) → Build 7 (正式)
```
