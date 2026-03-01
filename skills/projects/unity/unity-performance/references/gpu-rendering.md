# GPU & Rendering Optimization 完整範例

## 減少 Draw Calls

### Static Batching

```csharp
// 標記為 Static（Inspector → Static → Batching Static）
gameObject.isStatic = true;
```

### Dynamic Batching

- 同材質小網格自動批處理
- <300 頂點，同 material, 同 shader

### GPU Instancing

```csharp
// 材質啟用 GPU Instancing
// 使用 Graphics.DrawMeshInstanced
public void DrawInstanced()
{
    Matrix4x4[] matrices = new Matrix4x4[count];
    for (int i = 0; i < count; i++)
    {
        matrices[i] = Matrix4x4.TRS(positions[i], rotations[i], scales[i]);
    }
    Graphics.DrawMeshInstanced(mesh, 0, material, matrices);
}
```

### SRP Batcher (URP/HDRP)

```csharp
// 使用 SRP 兼容 Shader
// 確保 Material Properties 在 Shader 中使用 CBUFFER
```

## LOD (Level of Detail)

```csharp
LODGroup lodGroup = gameObject.AddComponent<LODGroup>();

LOD[] lods = new LOD[3];
lods[0] = new LOD(0.5f, new[] { highPolyRenderer });   // 近距離
lods[1] = new LOD(0.2f, new[] { mediumPolyRenderer }); // 中距離
lods[2] = new LOD(0.05f, new[] { lowPolyRenderer });   // 遠距離

lodGroup.SetLODs(lods);
lodGroup.RecalculateBounds();
```

## Occlusion Culling

```
Window → Rendering → Occlusion Culling
1. 標記場景物件為 Occluder Static
2. 烘培 Occlusion Data
3. 運行時自動剔除看不見的物體
```

## Fill Rate 優化

```csharp
// ❌ 透明物體太多（Overdraw 嚴重）
// ❌ 全屏後處理太多

// ✅ 減少透明物體
// ✅ 使用 Alpha Test 而不是 Alpha Blend
// ✅ 降低後處理解析度

// Scene View → Overdraw 模式查看重繪
```

## 紋理優化

```
壓縮格式:
- Switch: ASTC
- PC: DXT (BC)

✅ 使用 Mipmap
✅ 降低紋理解析度（Switch: 1024 max）
✅ 使用 Texture Atlas（合併小紋理）
```

## Shader 優化

```hlsl
// ❌ Fragment Shader 中昂貴計算
float4 frag() {
    float3 worldPos = mul(unity_ObjectToWorld, input.vertex);
    float dist = length(worldPos - _WorldSpaceLightPos0);
}

// ✅ 移到 Vertex Shader
v2f vert() {
    output.worldPos = mul(unity_ObjectToWorld, input.vertex);
    output.lightDist = length(output.worldPos - _WorldSpaceLightPos0);
}

float4 frag(v2f input) {
    float dist = input.lightDist; // 直接使用插值結果
}
```
