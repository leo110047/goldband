---
name: unity-testing
description: |
  Unity Test Framework 測試模式與實踐指南。
  涵蓋 EditMode/PlayMode 測試、參數化測試、Mocking、Assembly Definition 設定、CI 整合。

  Use when: 編寫 Unity 測試、設定 Test Assembly、使用 NUnit 特性、
  建立 EditMode/PlayMode 測試、Mock 依賴、CI/CD 測試整合。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity Test Framework 指南

## Assembly Definition 設定

### EditMode (純邏輯測試，不需 Unity 運行時)

```json
// Tests/EditMode/Elemenzy.Tests.EditMode.asmdef
{
    "name": "Elemenzy.Tests.EditMode",
    "rootNamespace": "Elemenzy.Tests",
    "references": [
        "Elemenzy.Core",
        "Elemenzy.Interaction"
    ],
    "includePlatforms": ["Editor"],
    "overrideReferences": true,
    "precompiledReferences": [
        "nunit.framework.dll"
    ],
    "defineConstraints": ["UNITY_INCLUDE_TESTS"]
}
```

### PlayMode (需要 Unity 生命週期)

```json
// Tests/PlayMode/Elemenzy.Tests.PlayMode.asmdef
{
    "name": "Elemenzy.Tests.PlayMode",
    "references": [
        "Elemenzy.Core",
        "Elemenzy.Interaction"
    ],
    "overrideReferences": true,
    "precompiledReferences": [
        "nunit.framework.dll"
    ],
    "defineConstraints": ["UNITY_INCLUDE_TESTS"]
}
```

## EditMode 測試

### 基本結構 (AAA Pattern)

```csharp
using NUnit.Framework;

[TestFixture]
public class DamageCalculatorTests
{
    private DamageCalculator _calculator;

    [SetUp]
    public void SetUp()
    {
        _calculator = new DamageCalculator();
    }

    [Test]
    public void Calculate_WithCrit_DoublesBaseDamage()
    {
        // Arrange
        var baseDamage = 100;

        // Act
        var result = _calculator.Calculate(baseDamage, isCrit: true);

        // Assert
        Assert.AreEqual(200, result);
    }
}
```

### 參數化測試 (TestCase)

```csharp
[TestCase(100, 0.5f, 50)]
[TestCase(100, 1.0f, 100)]
[TestCase(100, 2.0f, 200)]
[TestCase(0, 1.5f, 0)]
public void ApplyMultiplier_ReturnsCorrectValue(
    float baseValue, float multiplier, float expected)
{
    var result = AttributeCalculator.ApplyMultiplier(baseValue, multiplier);
    Assert.AreEqual(expected, result, 0.001f);
}
```

### TestCaseSource (動態資料來源)

```csharp
[TestCaseSource(nameof(DamageTestCases))]
public void CalculateDamage_WithTestCases(int attack, int defense, int expected)
{
    var result = DamageFormula.Calculate(attack, defense);
    Assert.AreEqual(expected, result);
}

private static IEnumerable<TestCaseData> DamageTestCases()
{
    yield return new TestCaseData(100, 50, 75).SetName("Normal damage");
    yield return new TestCaseData(100, 100, 50).SetName("Equal stats");
    yield return new TestCaseData(50, 100, 25).SetName("High defense");
}
```

### 測試 GameObject（EditMode 中需手動管理）

```csharp
[TestFixture]
public class HealthComponentTests
{
    private GameObject _testObject;
    private HealthComponent _health;

    [SetUp]
    public void SetUp()
    {
        _testObject = new GameObject("TestHealth");
        _health = _testObject.AddComponent<HealthComponent>();
        _health.Initialize(100);
    }

    [TearDown]
    public void TearDown()
    {
        Object.DestroyImmediate(_testObject);
    }

    [Test]
    public void TakeDamage_AtZero_TriggersDeath()
    {
        bool deathTriggered = false;
        _health.OnDeath += () => deathTriggered = true;

        _health.TakeDamage(100);

        Assert.IsTrue(deathTriggered);
        Assert.AreEqual(0, _health.CurrentHealth);
    }
}
```

## PlayMode 測試

### 基本 PlayMode 測試（需要 Unity 生命週期）

```csharp
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

[TestFixture]
public class PlayerMovementTests
{
    private GameObject _player;
    private PlayerMovement _movement;

    [UnitySetUp]
    public IEnumerator SetUp()
    {
        _player = new GameObject("Player");
        _movement = _player.AddComponent<PlayerMovement>();
        yield return null; // 等待 Awake/Start
    }

    [UnityTearDown]
    public IEnumerator TearDown()
    {
        Object.Destroy(_player);
        yield return null;
    }

    [UnityTest]
    public IEnumerator Move_OverTime_ChangesPosition()
    {
        var startPos = _player.transform.position;

        _movement.Move(Vector3.forward);
        yield return new WaitForSeconds(0.5f);

        Assert.AreNotEqual(startPos, _player.transform.position);
    }
}
```

## NUnit 常用 Assertions

```csharp
// 相等
Assert.AreEqual(expected, actual);
Assert.AreNotEqual(unexpected, actual);

// 布林
Assert.IsTrue(condition);
Assert.IsFalse(condition);

// Null
Assert.IsNull(obj);
Assert.IsNotNull(obj);

// 集合
Assert.Contains(item, collection);
Assert.IsEmpty(collection);
CollectionAssert.AreEqual(expected, actual);
CollectionAssert.AreEquivalent(expected, actual); // 順序無關

// 例外
Assert.Throws<ArgumentException>(() => MethodThatThrows());
Assert.DoesNotThrow(() => SafeMethod());

// 浮點（容差）
Assert.AreEqual(1.0f, actual, 0.001f);
```

## 測試分類與過濾

```csharp
[TestFixture]
[Category("Interaction")]
public class InteractionTests
{
    [Test]
    [Category("Critical")]
    public void CriticalInteractionTest() { }

    [Test]
    [Category("Slow")]
    public void SlowInteractionTest() { }
}

// CLI 過濾: -testFilter "Category=Critical"
```

## 測試工具類

### 基底類別（減少重複的 Setup/Teardown）

```csharp
public abstract class GameplayTestBase
{
    protected GameObject TestGameObject { get; private set; }

    [SetUp]
    public virtual void SetUp()
    {
        TestGameObject = new GameObject("Test");
    }

    [TearDown]
    public virtual void TearDown()
    {
        if (TestGameObject != null)
            Object.DestroyImmediate(TestGameObject);
    }

    protected T AddComponent<T>() where T : Component
    {
        return TestGameObject.AddComponent<T>();
    }
}
```

### ScriptableObject 測試 Helper

```csharp
public static class SOTestHelper
{
    public static T Create<T>(Action<T> configure = null) where T : ScriptableObject
    {
        var instance = ScriptableObject.CreateInstance<T>();
        configure?.Invoke(instance);
        return instance;
    }
}
```

## CI/CD 整合

### 命令列執行

```bash
# EditMode 測試
Unity -runTests -batchmode -projectPath /path/to/project \
  -testPlatform EditMode \
  -testResults results.xml

# 指定分類
Unity -runTests -batchmode -projectPath /path/to/project \
  -testPlatform EditMode \
  -testFilter "Category=Critical"
```

## Elemenzy 專案測試慣例

- **純邏輯（lookup table、RNG、排序）→ EditMode 測試**
- **需要 MonoBehaviour 生命週期 → PlayMode 測試**
- **測試方法名使用中文描述意圖**（例如：`火加水_雙方消滅_產生蒸氣雲`）
- **每個系統一個 TestFixture 檔案**
- **完整性測試**：驗證矩陣表所有 cell 都有定義
- **對稱性測試**：驗證碰撞表的邏輯對稱性
- **確定性測試**：使用相同種子驗證位元一致性結果

## Best Practices

1. **命名清晰** - `Method_Scenario_ExpectedResult` 或中文意圖描述
2. **單一斷言為主** - 一個測試驗證一個行為
3. **使用 SetUp/TearDown** - 共通初始化
4. **EditMode 優先** - 純邏輯用 EditMode，只在需要生命週期時用 PlayMode
5. **測試邊界情況** - Null、空、邊界值
6. **保持獨立** - 測試之間不共享狀態
7. **為 bug 寫測試** - 防止回歸
8. **提交前跑測試** - Pre-commit 驗證
