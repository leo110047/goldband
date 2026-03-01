# MVC / MVP / MVVM 完整程式碼範例

## MVC (Model-View-Controller)

### Model — 純數據 + 業務邏輯

```csharp
public class PlayerModel
{
    private int health;
    private int maxHealth;

    public int Health
    {
        get => health;
        set
        {
            health = Mathf.Clamp(value, 0, maxHealth);
            OnHealthChanged?.Invoke(health);
        }
    }

    public event Action<int> OnHealthChanged;

    public PlayerModel(int maxHealth)
    {
        this.maxHealth = maxHealth;
        this.health = maxHealth;
    }

    public void TakeDamage(int damage) => Health -= damage;
    public void Heal(int amount) => Health += amount;
}
```

### View — 只負責顯示

```csharp
public class PlayerView : MonoBehaviour
{
    [SerializeField] private Image healthBar;
    [SerializeField] private Text healthText;

    public void UpdateHealth(int health, int maxHealth)
    {
        healthBar.fillAmount = (float)health / maxHealth;
        healthText.text = $"{health}/{maxHealth}";
    }

    public void ShowDamageEffect()
    {
        StartCoroutine(DamageFlash());
    }

    private IEnumerator DamageFlash()
    {
        // 紅色閃爍效果
        yield return null;
    }
}
```

### Controller — 連接 Model 和 View

```csharp
public class PlayerController : MonoBehaviour
{
    private PlayerModel model;
    private PlayerView view;

    void Start()
    {
        model = new PlayerModel(maxHealth: 100);
        view = GetComponent<PlayerView>();
        model.OnHealthChanged += OnHealthChanged;
        OnHealthChanged(model.Health);
    }

    void OnHealthChanged(int health)
    {
        view.UpdateHealth(health, 100);
    }

    public void TakeDamage(int damage)
    {
        model.TakeDamage(damage);
        view.ShowDamageEffect();
    }
}
```

---

## MVP (Model-View-Presenter)

### View Interface + 實現

```csharp
// View Interface
public interface IInventoryView
{
    void DisplayItems(List<Item> items);
    void ShowItemAdded(Item item);
    void ShowItemRemoved(Item item);
}

// View 實現 (MonoBehaviour)
public class InventoryView : MonoBehaviour, IInventoryView
{
    [SerializeField] private Transform itemContainer;
    [SerializeField] private GameObject itemPrefab;

    public void DisplayItems(List<Item> items)
    {
        foreach (Transform child in itemContainer)
            Destroy(child.gameObject);

        foreach (var item in items)
        {
            GameObject itemUI = Instantiate(itemPrefab, itemContainer);
            itemUI.GetComponent<ItemUI>().SetItem(item);
        }
    }

    public void ShowItemAdded(Item item) { /* 播放添加動畫 */ }
    public void ShowItemRemoved(Item item) { /* 播放移除動畫 */ }
}
```

### Model

```csharp
public class InventoryModel
{
    private List<Item> items = new List<Item>();
    public IReadOnlyList<Item> Items => items.AsReadOnly();

    public void AddItem(Item item) => items.Add(item);
    public void RemoveItem(Item item) => items.Remove(item);
}
```

### Presenter — 包含所有邏輯

```csharp
public class InventoryPresenter
{
    private readonly InventoryModel model;
    private readonly IInventoryView view;

    public InventoryPresenter(InventoryModel model, IInventoryView view)
    {
        this.model = model;
        this.view = view;
    }

    public void Initialize() => UpdateView();

    public void AddItem(Item item)
    {
        model.AddItem(item);
        view.ShowItemAdded(item);
        UpdateView();
    }

    public void RemoveItem(Item item)
    {
        model.RemoveItem(item);
        view.ShowItemRemoved(item);
        UpdateView();
    }

    private void UpdateView()
    {
        view.DisplayItems(model.Items.ToList());
    }
}
```

### MVP 單元測試（不需要 Unity）

```csharp
[Test]
public void AddItem_ShouldUpdateView()
{
    var model = new InventoryModel();
    var mockView = new MockInventoryView();
    var presenter = new InventoryPresenter(model, mockView);

    presenter.AddItem(new Item("Sword"));

    Assert.IsTrue(mockView.DisplayItemsCalled);
    Assert.IsTrue(mockView.ShowItemAddedCalled);
}
```

### Unity Entry Point

```csharp
public class InventoryController : MonoBehaviour
{
    private InventoryPresenter presenter;

    void Start()
    {
        var model = new InventoryModel();
        var view = GetComponent<IInventoryView>();
        presenter = new InventoryPresenter(model, view);
        presenter.Initialize();
    }
}
```

---

## MVVM (Model-View-ViewModel)

### ViewModel

```csharp
public class PlayerViewModel : INotifyPropertyChanged
{
    private int health;
    public int Health
    {
        get => health;
        set
        {
            if (health != value)
            {
                health = value;
                OnPropertyChanged(nameof(Health));
            }
        }
    }

    public event PropertyChangedEventHandler PropertyChanged;

    protected void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

// View (UXML + Binding)
// Health Label 自動更新當 ViewModel.Health 改變
```
