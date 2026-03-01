# Component Patterns 完整程式碼範例

## Composition Over Inheritance

```csharp
// ✅ 組合模式
public class Enemy : MonoBehaviour
{
    [SerializeField] private Health health;
    [SerializeField] private Movement movement;
    [SerializeField] private Attack attack;
}

public class Health : MonoBehaviour
{
    [SerializeField] private int maxHealth = 100;
    private int currentHealth;

    public void TakeDamage(int damage) { /* ... */ }
    public void Heal(int amount) { /* ... */ }
}

// ❌ 深層繼承
public class Character : MonoBehaviour { }
public class Enemy : Character { }
public class MeleeEnemy : Enemy { }
public class AxeEnemy : MeleeEnemy { } // 太深！
```

## Interface-Based Design

```csharp
// 定義接口
public interface IDamageable
{
    void TakeDamage(int damage);
}

public interface IInteractable
{
    void Interact(GameObject interactor);
}

// 實現
public class Crate : MonoBehaviour, IDamageable, IInteractable
{
    [SerializeField] private int health = 50;

    public void TakeDamage(int damage)
    {
        health -= damage;
        if (health <= 0) Destroy(gameObject);
    }

    public void Interact(GameObject interactor)
    {
        // 打開箱子
    }
}

// 使用
RaycastHit hit;
if (Physics.Raycast(ray, out hit))
{
    IDamageable damageable = hit.collider.GetComponent<IDamageable>();
    damageable?.TakeDamage(10);
}
```

## Event-Driven Architecture

### UnityEvent（Inspector 可配置）

```csharp
using UnityEngine.Events;

public class Health : MonoBehaviour
{
    public UnityEvent OnDeath;
    public UnityEvent<int> OnHealthChanged;

    public void TakeDamage(int damage)
    {
        currentHealth -= damage;
        OnHealthChanged?.Invoke(currentHealth);

        if (currentHealth <= 0)
            OnDeath?.Invoke();
    }
}
```

### C# Events

```csharp
public class GameManager : MonoBehaviour
{
    public static event Action OnGameStart;
    public static event Action<int> OnScoreChanged;

    public void StartGame() => OnGameStart?.Invoke();
}

// 訂閱/取消
void OnEnable() => GameManager.OnGameStart += HandleGameStart;
void OnDisable() => GameManager.OnGameStart -= HandleGameStart;
```

## 組織代碼（#region）

```csharp
public class Player : MonoBehaviour
{
    #region Serialized Fields
    [Header("Movement")]
    [SerializeField] private float moveSpeed = 5f;
    [SerializeField] private float jumpForce = 10f;

    [Header("References")]
    [SerializeField] private Rigidbody rb;
    [SerializeField] private Animator animator;
    #endregion

    #region Private Fields
    private bool isGrounded;
    private Vector3 velocity;
    #endregion

    #region Properties
    public bool IsAlive { get; private set; } = true;
    #endregion

    #region Unity Lifecycle
    private void Awake() => rb = GetComponent<Rigidbody>();
    private void Update() => HandleInput();
    private void FixedUpdate() => ApplyMovement();
    #endregion

    #region Public Methods
    public void TakeDamage(int damage) { /* ... */ }
    #endregion

    #region Private Methods
    private void HandleInput() { /* ... */ }
    private void ApplyMovement() { /* ... */ }
    #endregion
}
```

## Header 和 Tooltip

```csharp
public class Enemy : MonoBehaviour
{
    [Header("Stats")]
    [Tooltip("敵人的最大生命值")]
    [SerializeField] private int maxHealth = 100;

    [Tooltip("移動速度（單位/秒）")]
    [SerializeField] private float moveSpeed = 3f;

    [Header("References")]
    [SerializeField] private Transform playerTransform;

    [Header("Prefabs")]
    [SerializeField] private GameObject deathEffectPrefab;
}
```
