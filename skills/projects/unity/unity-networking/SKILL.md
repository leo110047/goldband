---
name: unity-networking
description: |
  Unity Netcode for GameObjects (NGO) 網路架構指南。
  涵蓋 NetworkVariable 狀態同步、RPC 模式、權限矩陣、Server-Authoritative 架構、
  確定性模擬同步、客戶端預測、輸入緩衝。

  Use when: 設定多人連線、狀態同步、寫 RPC、建立權限矩陣、
  網路架構設計、客戶端預測、確定性同步。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity NGO (Netcode for GameObjects) 網路指南

## 架構原則

- **Server-Authoritative**：所有遊戲狀態由 Server 決定
- **永遠不信任客戶端輸入** — Server 端驗證所有操作
- **確定性模擬同步** — 相同輸入 + 相同種子 = 相同結果

## NetworkVariable 狀態同步

### 基本用法

```csharp
using Unity.Netcode;

public class PlayerHealth : NetworkBehaviour
{
    private readonly NetworkVariable<int> _health = new(
        100,
        NetworkVariableReadPermission.Everyone,
        NetworkVariableWritePermission.Server
    );

    public override void OnNetworkSpawn()
    {
        _health.OnValueChanged += OnHealthChanged;
    }

    public override void OnNetworkDespawn()
    {
        _health.OnValueChanged -= OnHealthChanged;
    }

    private void OnHealthChanged(int previous, int current)
    {
        // 更新 UI、播放特效
    }

    [Rpc(SendTo.Server)]
    public void TakeDamageServerRpc(int amount)
    {
        if (!IsServer) return;
        _health.Value = Mathf.Max(0, _health.Value - amount);
    }
}
```

### 自訂 NetworkVariable（struct）

```csharp
public struct ElementState : INetworkSerializable, IEquatable<ElementState>
{
    public byte Element;      // Element enum
    public byte StatusFlags;  // 位元遮罩
    public short DamageValue;

    public void NetworkSerialize<T>(BufferSerializer<T> serializer)
        where T : IReaderWriter
    {
        serializer.SerializeValue(ref Element);
        serializer.SerializeValue(ref StatusFlags);
        serializer.SerializeValue(ref DamageValue);
    }

    public bool Equals(ElementState other) =>
        Element == other.Element &&
        StatusFlags == other.StatusFlags &&
        DamageValue == other.DamageValue;
}
```

## RPC 模式

### Server RPC（Client → Server）

```csharp
// 客戶端發送輸入到 Server
[Rpc(SendTo.Server)]
public void SubmitInputServerRpc(InputPayload input)
{
    if (!IsServer) return;

    // Server 驗證輸入合法性
    if (!ValidateInput(input))
    {
        Debug.LogWarning($"Invalid input from client {OwnerClientId}");
        return;
    }

    // 應用到模擬
    ApplyInput(input);
}
```

### Client RPC（Server → Clients）

```csharp
// Server 通知客戶端效果
[Rpc(SendTo.ClientsAndHost)]
public void SpawnEffectClientRpc(
    byte element, Vector3 position, ClientRpcParams rpcParams = default)
{
    // 客戶端播放視覺特效（非遊戲邏輯）
    EffectManager.Instance.SpawnElementEffect((Element)element, position);
}
```

### RPC 命名慣例

| 方向 | Attribute | 命名 |
|------|-----------|------|
| Client → Server | `[Rpc(SendTo.Server)]` | `{Action}ServerRpc` |
| Server → All Clients | `[Rpc(SendTo.ClientsAndHost)]` | `{Action}ClientRpc` |
| Server → Owner | `[Rpc(SendTo.Owner)]` | `{Action}OwnerRpc` |

## Elemenzy 權限矩陣

| 實體 | 擁有者 | 讀取 | 寫入 | 同步方式 |
|------|--------|------|------|---------|
| 玩家位置 | Server | Everyone | Owner (預測) + Server (校正) | NetworkTransform |
| 玩家血量 | Server | Everyone | Server | NetworkVariable |
| 投射物 | Server | Everyone | Server | NetworkObject spawn |
| Zone 狀態 | Server | Everyone | Server | NetworkVariable |
| 元素狀態 | Server | Everyone | Server | NetworkVariable |
| 輸入指令 | Client | Server | Owner | ServerRpc |
| 視覺特效 | Client | Local | Local | ClientRpc trigger |
| 遊戲種子 | Server | Everyone | Server | NetworkVariable (一次) |

## 確定性模擬同步

### 輸入收集 + 同步架構

```
Client A ──[InputRpc]──→ Server
Client B ──[InputRpc]──→ Server
                         ↓
                  Server 收集所有輸入
                         ↓
                  Server 執行確定性 Tick
                         ↓
              Server ──[StateRpc]──→ All Clients
                         ↓
              Clients 用相同輸入 + 種子重現
```

### 輸入封包

```csharp
public struct InputPayload : INetworkSerializable
{
    public uint Tick;           // 模擬 tick 編號
    public byte MoveX;          // 量化方向 (0-255)
    public byte MoveY;
    public byte ActionFlags;    // 位元遮罩：攻擊、跳躍、技能
    public byte ElementSlot;    // 當前選擇的元素

    public void NetworkSerialize<T>(BufferSerializer<T> serializer)
        where T : IReaderWriter
    {
        serializer.SerializeValue(ref Tick);
        serializer.SerializeValue(ref MoveX);
        serializer.SerializeValue(ref MoveY);
        serializer.SerializeValue(ref ActionFlags);
        serializer.SerializeValue(ref ElementSlot);
    }
}
```

### 世界狀態雜湊驗證

```csharp
// Server 每 N tick 發送世界狀態雜湊
[Rpc(SendTo.ClientsAndHost)]
public void SyncWorldHashClientRpc(uint tick, uint worldHash)
{
    var localHash = WorldStateHash.Compute(currentWorldState);

    if (localHash != worldHash)
    {
        Debug.LogError($"Desync at tick {tick}! " +
            $"Server={worldHash:X8} Local={localHash:X8}");
        // 請求完整狀態快照
        RequestFullStateServerRpc(tick);
    }
}
```

## NetworkObject 生命週期

### Spawn / Despawn

```csharp
public class ProjectileSpawner : NetworkBehaviour
{
    [SerializeField] private GameObject _projectilePrefab;

    [Rpc(SendTo.Server)]
    public void FireServerRpc(Vector3 position, Vector3 direction, byte element)
    {
        if (!IsServer) return;

        var go = Instantiate(_projectilePrefab, position, Quaternion.identity);
        var no = go.GetComponent<NetworkObject>();
        no.Spawn(); // Server spawn，自動同步到所有 Client

        var proj = go.GetComponent<NetworkProjectile>();
        proj.Initialize(direction, (Element)element);
    }
}
```

### 場景管理

```csharp
// Server 控制場景載入
NetworkManager.Singleton.SceneManager.LoadScene(
    "GameScene", LoadSceneMode.Single);

// 監聽場景事件
NetworkManager.Singleton.SceneManager.OnLoadComplete +=
    (clientId, sceneName, loadMode) =>
    {
        Debug.Log($"Client {clientId} loaded {sceneName}");
    };
```

## 連線管理

### 大廳 / 連線流程

```csharp
public class ConnectionManager : MonoBehaviour
{
    public void StartHost()
    {
        NetworkManager.Singleton.StartHost();
    }

    public void StartClient(string address, ushort port)
    {
        var transport = NetworkManager.Singleton
            .GetComponent<UnityTransport>();
        transport.SetConnectionData(address, port);
        NetworkManager.Singleton.StartClient();
    }

    private void OnEnable()
    {
        NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnect;
    }

    private void OnClientConnected(ulong clientId)
    {
        Debug.Log($"Client {clientId} connected");
    }

    private void OnClientDisconnect(ulong clientId)
    {
        Debug.Log($"Client {clientId} disconnected");
    }
}
```

## 效能考量

### 頻寬優化

- **量化數值** — 用 byte/short 代替 float/int
- **差量同步** — 只發送變化的欄位
- **更新頻率** — 非關鍵資料降低同步頻率
- **封包大小** — 每個 tick 封包 < 128 bytes

### Switch 網路限制

- 無線延遲較高（WiFi only，無乙太網路 handheld）
- 頻寬有限 — 壓縮同步資料
- NAT 穿透 — 需要 Relay 服務

## Best Practices

1. **Server-Authoritative** — 所有遊戲邏輯在 Server 執行
2. **驗證所有 RPC 輸入** — 防止作弊
3. **最小化封包大小** — 量化、壓縮、差量
4. **NetworkVariable 用於持續狀態** — RPC 用於事件
5. **客戶端只做預測和呈現** — 遊戲真相在 Server
6. **世界狀態雜湊** — 定期驗證同步一致性
7. **優雅斷線處理** — 重連 + 狀態快照恢復
8. **在目標延遲下測試** — 模擬 Switch WiFi 延遲 (50-100ms)
