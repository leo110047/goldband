---
name: unity-app-store-deployment
description: |
  Unity 遊戲上架 Google Play 和 iOS App Store 完整流程。
  涵蓋平台限制、資產優化、簽名配置、審核準備、發佈策略。

  Use when: 準備上架 Google Play 或 App Store、處理包體過大問題、配置資產分發、
  設置簽名證書、TestFlight/內測發佈、處理應用審核、隱私政策配置。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity App Store 上架完整指南

## 快速導航

| 平台 | 詳細內容 |
|------|----------|
| Android | [references/android-google-play.md](references/android-google-play.md) |
| iOS | [references/ios-app-store.md](references/ios-app-store.md) |
| 通用（隱私/審核/FAQ） | [references/cross-platform-publishing.md](references/cross-platform-publishing.md) |

---

## 平台限制速查

| 項目 | Android (Google Play) | iOS (App Store) |
|------|----------------------|-----------------|
| 包體格式 | AAB (Android App Bundle) | IPA |
| 初始大小限制 | AAB ≤ 200MB | IPA < 4GB |
| 擴展方案 | Play Asset Delivery (PAD) | On-Demand Resources (ODR) |
| 擴展上限 | 150MB base + 8GB asset packs | 20GB (ODR) |
| 建議初始大小 | < 200MB | < 500MB |
| 簽名 | Keystore + Play App Signing | Certificate + Provisioning Profile |
| 測試平台 | Internal/Closed/Open Testing | TestFlight |
| 審核時間 | 1-7 天（通常 2-3 天） | 1-7 天（通常 2-3 天） |

## Build Settings 核心配置

### Android 必須

```
✅ Build App Bundle (AAB): Enabled
✅ Scripting Backend: IL2CPP
✅ Target Architectures: ARM64
✅ Managed Stripping Level: High
✅ Target SDK: ≥ API 34
✅ Min SDK: ≥ API 24
✅ Keystore: 已配置且備份
```

### iOS 必須

```
✅ Architecture: ARM64
✅ Scripting Backend: IL2CPP
✅ Min iOS Version: 12.0+
✅ Automatic Signing: Enabled (推薦)
✅ Team ID: 已配置
✅ Managed Stripping Level: Medium
✅ Script Call Optimization: Fast but no Exceptions
```

## 資產壓縮策略

```
Texture (雙平台):
- 高品質 (UI/Characters): ASTC 6x6, Max 2048
- 中品質 (Environment):   ASTC 6x6, Max 1024
- 低品質 (Background):    ASTC 8x8, Max 512

Audio:
- SFX:  Vorbis, Quality 70-80, Decompress On Load
- BGM:  Vorbis/MP3, Quality 80-90, Streaming
- Voice: Vorbis, Quality 50-60, Compressed In Memory

Mesh:
- Read/Write Enabled: OFF
- Optimize Mesh: ON
- Mesh Compression: High
```

## 簽名管理

### Android Keystore

```
⚠️ Keystore 丟失 = 永遠無法更新應用！

備份至少 3 個位置:
1. 雲端儲存 (Dropbox/iCloud)
2. 外部硬碟
3. 加密 USB

✅ 強烈推薦: 使用 Play App Signing
  - Google 保管發佈密鑰
  - 上傳密鑰丟失可聯繫 Google 重置
```

### iOS 簽名

```
✅ 推薦: Xcode Automatic Signing
  - Xcode 自動管理 Certificate + Provisioning Profile
  - 需要 Apple Developer Team ID

手動簽名（進階）:
  - 需要 Distribution Certificate
  - 需要 App Store Provisioning Profile
  - Bundle ID 必須與 App ID 一致
```

## 發佈流程概覽

### Android

```
1. 配置 Build Settings + Keystore
2. Build AAB
3. 檢查大小（> 200MB → PAD）
4. Google Play Console 建立應用
5. 填寫商店資訊 + 隱私 + 分級
6. 上傳到測試軌道 (Internal → Closed → Open)
7. 提交 Production → 審核 → 發佈
```

### iOS

```
1. 配置 Build Settings + Signing
2. Build → Xcode Project
3. Xcode Archive → Upload to App Store Connect
4. App Store Connect 建立應用
5. 填寫商店資訊 + 隱私 + 分級
6. TestFlight 測試 (Internal → External)
7. Submit for Review → 審核 → 發佈
```

## 隱私合規要點

```
雙平台必須:
✅ Privacy Policy URL
✅ 數據收集聲明
✅ 第三方 SDK 揭露 (Unity Analytics, Firebase, etc.)

iOS 額外:
✅ App Tracking Transparency (ATT) — iOS 14.5+
✅ App Privacy 詳情

歐盟 GDPR:
✅ 用戶同意機制
✅ 數據刪除權
✅ 數據可攜權

美國 COPPA (兒童應用):
✅ 13 歲以下需要家長同意
✅ 不得收集個人資訊
```

## 審核常見拒絕原因

### Google Play

| 原因 | 解決 |
|------|------|
| 缺少/不完整 Privacy Policy | 提供完整隱私政策 |
| Target SDK 過低 | 更新到 API 33+ |
| 過多不必要權限 | 只請求必要權限 |
| 截圖與實際不符 | 真實反映遊戲 |
| 應用崩潰 | 徹底測試 |

### App Store

| 原因 | 條款 | 解決 |
|------|------|------|
| 應用崩潰/bug | 2.1 | 確保穩定 |
| 非 Apple IAP | 3.1.1 | 使用 Apple IAP |
| UI 不符 HIG | 4.0 | 遵循 iOS 設計規範 |
| 缺少隱私 | 5.1 | 完整實現隱私要求 |
| 未授權素材 | 5.2 | 確保資源有授權 |

## 完整 Checklist

### Android

```
構建:
[ ] Bundle Identifier 正確
[ ] Version Code 遞增
[ ] Target SDK ≥ 33
[ ] IL2CPP + ARM64
[ ] Keystore 配置 + 備份
[ ] AAB ≤ 200MB 或 PAD

商店:
[ ] App icon 512x512
[ ] Feature graphic 1024x500
[ ] Screenshots (Phone + Tablet)
[ ] Description + Privacy Policy URL
[ ] Content rating + Data safety
[ ] 選擇發佈軌道 + 地區
```

### iOS

```
構建:
[ ] Bundle Identifier = App ID
[ ] Version + Build Number 遞增
[ ] Min iOS 12.0+
[ ] IL2CPP + ARM64
[ ] Xcode 簽名正確
[ ] ATT 實現 (如有追蹤)

商店:
[ ] Screenshots (6.7" + iPad Pro)
[ ] Description + Keywords
[ ] Privacy Policy URL + Support URL
[ ] App Privacy 詳情
[ ] Age Rating
[ ] Export Compliance
[ ] Build 上傳 + 選擇
```

## 最佳實踐

1. **備份簽名文件** — Keystore / Certificate 至少 3 份
2. **使用平台簽名服務** — Play App Signing / Xcode Auto Signing
3. **資產優化優先** — 先壓縮再考慮資產分發
4. **隱私合規第一** — GDPR / COPPA / ATT
5. **分階段發佈** — 10% → 50% → 100%
6. **監控崩潰率** — 快速修復嚴重 bug
7. **Version Code/Build Number 嚴格遞增**
8. **多設備 + 弱網測試**

## 參考資源

- [Android App Bundle](https://developer.android.com/guide/app-bundle)
- [Play Asset Delivery](https://developer.android.com/guide/playcore/asset-delivery)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Unity Android Build](https://docs.unity3d.com/Manual/android-BuildProcess.html)
- [Unity iOS Build](https://docs.unity3d.com/Manual/iphone-GettingStarted.html)
- [ATT Framework](https://developer.apple.com/documentation/apptrackingtransparency)
