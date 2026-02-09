# C# Code Review Guide

> C# 代碼審查指南，涵蓋 .NET 8+、LINQ、async/await、記憶體管理、EF Core、依賴注入、現代 C# 模式等核心主題。

## 目錄

- [語言特性與最佳實踐](#語言特性與最佳實踐)
- [Nullable Reference Types](#nullable-reference-types)
- [LINQ 優化](#linq-優化)
- [Async/Await 模式](#asyncawait-模式)
- [記憶體效能](#記憶體效能)
- [Entity Framework Core](#entity-framework-core)
- [依賴注入與生命週期](#依賴注入與生命週期)
- [異常處理](#異常處理)
- [安全性](#安全性)
- [測試最佳實踐](#測試最佳實踐)
- [Review Checklist](#review-checklist)

---

## 語言特性與最佳實踐

### Modern C# Patterns (C# 10+)

```csharp
// ❌ 舊式寫法
namespace MyApp.Services
{
    public class UserService
    {
        private readonly ILogger<UserService> _logger;
        
        public UserService(ILogger<UserService> logger)
        {
            _logger = logger;
        }
    }
}

// ✅ File-scoped namespaces + Primary constructors (C# 12)
namespace MyApp.Services;

public class UserService(ILogger<UserService> logger)
{
    public async Task<User?> GetUserAsync(int id)
    {
        logger.LogInformation("Fetching user {UserId}", id);
        return await _repository.GetByIdAsync(id);
    }
}

// ✅ Record types for immutable data
public record User(int Id, string Name, string Email);

// ✅ Init-only properties
public class UserDto
{
    public int Id { get; init; }
    public required string Name { get; init; }
    public string? Email { get; init; }
}
```

### Pattern Matching

```csharp
// ❌ 冗長的 if-else 鏈
public decimal CalculateDiscount(Customer customer)
{
    if (customer.Type == "Premium")
        return customer.TotalSpent > 1000 ? 0.2m : 0.1m;
    else if (customer.Type == "Regular")
        return 0.05m;
    else
        return 0m;
}

// ✅ Switch expression with patterns
public decimal CalculateDiscount(Customer customer) => customer switch
{
    { Type: "Premium", TotalSpent: > 1000 } => 0.2m,
    { Type: "Premium" } => 0.1m,
    { Type: "Regular" } => 0.05m,
    _ => 0m
};

// ✅ Type patterns
public string Describe(object obj) => obj switch
{
    int n when n > 0 => "Positive number",
    int n when n < 0 => "Negative number",
    string { Length: > 10 } s => $"Long string: {s[..10]}...",
    IEnumerable<int> numbers => $"Collection with {numbers.Count()} items",
    _ => "Unknown"
};
```

### String Handling

```csharp
// ❌ String concatenation in loops
string result = "";
foreach (var item in items)
{
    result += item + ",";  // Creates new string each iteration
}

// ✅ Use StringBuilder
var sb = new StringBuilder();
foreach (var item in items)
{
    sb.Append(item).Append(',');
}
string result = sb.ToString();

// ✅ Or String.Join
string result = string.Join(",", items);

// ✅ String interpolation (readable)
string message = $"User {user.Name} has {user.Orders.Count} orders";

// ⚠️ FormattableString for SQL (防止注入)
FormattableString query = $"SELECT * FROM Users WHERE Id = {userId}";
```

---

## Nullable Reference Types

### Enable Nullable Context

```csharp
// ✅ 在 .csproj 啟用
<PropertyGroup>
    <Nullable>enable</Nullable>
</PropertyGroup>

// ❌ 未檢查 null
public string GetUserName(User user)
{
    return user.Name;  // Warning: user 可能為 null
}

// ✅ Null check
public string GetUserName(User? user)
{
    if (user is null)
        throw new ArgumentNullException(nameof(user));
    
    return user.Name;
}

// ✅ Null-coalescing operator
public string GetDisplayName(User? user) 
    => user?.Name ?? "Anonymous";

// ✅ Null-forgiving operator (確定不為 null 時)
public void Initialize()
{
    _logger = GetLogger()!;  // 確定 GetLogger() 不會返回 null
}
```

### Nullable Value Types

```csharp
// ❌ 使用特殊值表示"無值"
public int GetAge()
{
    return hasAge ? age : -1;  // -1 作為無效標誌
}

// ✅ 使用 Nullable<T> 或 T?
public int? GetAge()
{
    return hasAge ? age : null;
}

// ✅ Pattern matching with nullable
public string Describe(int? value) => value switch
{
    null => "No value",
    0 => "Zero",
    > 0 => "Positive",
    < 0 => "Negative"
};
```

---

## LINQ 優化

### Deferred Execution 陷阱

```csharp
// ❌ Multiple enumeration
IEnumerable<User> activeUsers = users.Where(u => u.IsActive);
int count = activeUsers.Count();           // Enumerate 1
var first = activeUsers.FirstOrDefault();  // Enumerate 2
// WHERE clause 執行了兩次！

// ✅ Materialize once
List<User> activeUsers = users.Where(u => u.IsActive).ToList();
int count = activeUsers.Count;           // O(1)
var first = activeUsers.FirstOrDefault(); // O(1)

// ✅ Or use Count() only when you need the number
int count = users.Count(u => u.IsActive);  // Single query
```

### Avoid N+1 Queries

```csharp
// ❌ N+1 query problem
var orders = await context.Orders.ToListAsync();
foreach (var order in orders)
{
    // Each iteration = 1 database query!
    var customer = await context.Customers
        .FirstOrDefaultAsync(c => c.Id == order.CustomerId);
}

// ✅ Eager loading with Include
var orders = await context.Orders
    .Include(o => o.Customer)
    .ToListAsync();

// ✅ Or project to DTO with Join
var orderDtos = await context.Orders
    .Select(o => new OrderDto
    {
        Id = o.Id,
        CustomerName = o.Customer.Name
    })
    .ToListAsync();
```

### LINQ Performance Patterns

```csharp
// ❌ Inefficient filtering
var result = users
    .Where(u => u.IsActive)
    .ToList()
    .Where(u => u.Age > 18);  // Filter in-memory after ToList()

// ✅ Filter before materializing
var result = users
    .Where(u => u.IsActive && u.Age > 18)
    .ToList();

// ❌ Unnecessary ordering
var users = context.Users
    .OrderBy(u => u.Name)
    .ToList();
// ... 後續沒有用到排序結果

// ✅ Only order if needed
var users = context.Users.ToList();

// ✅ Use Any() instead of Count() > 0
// ❌ Slow
if (users.Count() > 0) { }

// ✅ Fast (stops at first match)
if (users.Any()) { }
```

---

## Async/Await 模式

### Async Best Practices

```csharp
// ❌ Async void (僅用於 event handlers)
public async void ProcessData()  // ⚠️ 異常無法被捕獲
{
    await Task.Delay(1000);
}

// ✅ Async Task
public async Task ProcessDataAsync()
{
    await Task.Delay(1000);
}

// ✅ Async Task<T> for return value
public async Task<User> GetUserAsync(int id)
{
    return await _repository.GetByIdAsync(id);
}

// ❌ Async over sync (unnecessary)
public async Task<int> GetCountAsync()
{
    return await Task.Run(() => _list.Count);  // 浪費線程
}

// ✅ Synchronous when no I/O
public int GetCount() => _list.Count;
```

### ConfigureAwait Usage

```csharp
// ✅ Library code: Use ConfigureAwait(false)
public async Task<string> FetchDataAsync()
{
    var response = await _httpClient
        .GetAsync(url)
        .ConfigureAwait(false);  // 不需要回到原 context
    
    return await response.Content
        .ReadAsStringAsync()
        .ConfigureAwait(false);
}

// ✅ UI code: Don't use ConfigureAwait (需要 UI context)
private async void Button_Click(object sender, EventArgs e)
{
    var data = await FetchDataAsync();
    textBox.Text = data;  // 需要在 UI thread
}

// ❌ Mixing
var data = await FetchDataAsync().ConfigureAwait(false);
textBox.Text = data;  // ⚠️ 可能在錯誤的 thread！
```

### Async Anti-patterns

```csharp
// ❌ Blocking on async (deadlock risk)
public User GetUser(int id)
{
    return GetUserAsync(id).Result;  // ⚠️ Deadlock in UI/ASP.NET
}

// ✅ Async all the way
public async Task<User> GetUserAsync(int id)
{
    return await _repository.GetByIdAsync(id);
}

// ❌ Unnecessary async/await
public async Task<User> GetUserAsync(int id)
{
    return await _repository.GetByIdAsync(id);  // 直接轉發
}

// ✅ Return Task directly
public Task<User> GetUserAsync(int id)
{
    return _repository.GetByIdAsync(id);  // 省略 async/await
}

// ⚠️ Exception: 需要 using 或 try-catch 時必須用 await
public async Task<User> GetUserAsync(int id)
{
    using var scope = _scopeFactory.CreateScope();
    return await scope.ServiceProvider
        .GetRequiredService<IRepository>()
        .GetByIdAsync(id);
}
```

### Parallel Async Operations

```csharp
// ❌ Sequential execution (slow)
var user = await GetUserAsync(userId);
var orders = await GetOrdersAsync(userId);
var settings = await GetSettingsAsync(userId);

// ✅ Concurrent execution
var userTask = GetUserAsync(userId);
var ordersTask = GetOrdersAsync(userId);
var settingsTask = GetSettingsAsync(userId);

await Task.WhenAll(userTask, ordersTask, settingsTask);

var user = await userTask;
var orders = await ordersTask;
var settings = await settingsTask;

// ✅ Or with Task.WhenAll
var (user, orders, settings) = await Task.WhenAll(
    GetUserAsync(userId),
    GetOrdersAsync(userId),
    GetSettingsAsync(userId)
);
```

---

## 記憶體效能

### Span<T> and Memory<T>

```csharp
// ❌ Creating substring (allocates new string)
public string GetPrefix(string input)
{
    return input.Substring(0, 10);  // 分配新字串
}

// ✅ Use Span<char> (no allocation)
public ReadOnlySpan<char> GetPrefix(ReadOnlySpan<char> input)
{
    return input[..10];  // 零分配
}

// ❌ Array slicing (allocates)
public byte[] GetSlice(byte[] data, int start, int length)
{
    var slice = new byte[length];
    Array.Copy(data, start, slice, 0, length);
    return slice;
}

// ✅ Use Span<T>
public Span<byte> GetSlice(Span<byte> data, int start, int length)
{
    return data.Slice(start, length);  // 零分配
}
```

### ArrayPool<T>

```csharp
// ❌ 頻繁分配大陣列
public void ProcessData(int size)
{
    byte[] buffer = new byte[size];  // 每次分配
    // ... use buffer
}  // GC 回收

// ✅ 使用 ArrayPool
public void ProcessData(int size)
{
    byte[] buffer = ArrayPool<byte>.Shared.Rent(size);
    try
    {
        // ... use buffer
    }
    finally
    {
        ArrayPool<byte>.Shared.Return(buffer);
    }
}
```

### String Pooling

```csharp
// ❌ 每次創建新字串
public string GetStatus(bool isActive)
{
    return isActive ? "Active" : "Inactive";  // 字串字面值已被池化
}

// ✅ 但對於動態字串，考慮 string.Intern
public void CacheKey(string userId, string action)
{
    string key = string.Intern($"{userId}:{action}");
    // key 現在被池化，相同值共享記憶體
}
```

### ValueTask<T> for Hot Paths

```csharp
// ❌ Task<T> 即使結果已快取也會分配
private readonly Dictionary<int, User> _cache = new();

public async Task<User> GetUserAsync(int id)
{
    if (_cache.TryGetValue(id, out var user))
        return user;  // 仍然分配 Task
    
    user = await _repository.GetByIdAsync(id);
    _cache[id] = user;
    return user;
}

// ✅ ValueTask<T> 避免快取命中時的分配
public async ValueTask<User> GetUserAsync(int id)
{
    if (_cache.TryGetValue(id, out var user))
        return user;  // 零分配
    
    user = await _repository.GetByIdAsync(id);
    _cache[id] = user;
    return user;
}
```

---

## Entity Framework Core

### Query Optimization

```csharp
// ❌ Select * (over-fetching)
var users = await context.Users.ToListAsync();

// ✅ Project only needed columns
var userNames = await context.Users
    .Select(u => new { u.Id, u.Name })
    .ToListAsync();

// ❌ Client-side evaluation (slow)
var users = await context.Users
    .Where(u => IsValidUser(u))  // ⚠️ 在記憶體中過濾
    .ToListAsync();

// ✅ Server-side filtering
var users = await context.Users
    .Where(u => u.IsActive && u.Age > 18)  // SQL WHERE clause
    .ToListAsync();
```

### AsNoTracking for Read-Only

```csharp
// ❌ 唯讀查詢也追蹤變更
var users = await context.Users.ToListAsync();  // 追蹤所有實體

// ✅ Read-only query
var users = await context.Users
    .AsNoTracking()  // 不追蹤，性能提升 30-50%
    .ToListAsync();

// ✅ 全域設定
protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
{
    optionsBuilder
        .UseSqlServer(connectionString)
        .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
}
```

### Batch Operations

```csharp
// ❌ 逐一儲存 (N 次資料庫往返)
foreach (var user in users)
{
    context.Users.Add(user);
    await context.SaveChangesAsync();  // ⚠️ 每次 round-trip
}

// ✅ Batch insert
context.Users.AddRange(users);
await context.SaveChangesAsync();  // 單次 round-trip

// ✅ 或使用 BulkExtensions (第三方)
await context.BulkInsertAsync(users);  // 極快
```

### Avoiding Cartesian Explosion

```csharp
// ❌ Multiple Includes (笛卡爾積)
var blogs = await context.Blogs
    .Include(b => b.Posts)       // 1:N
    .Include(b => b.Comments)    // 1:N
    .ToListAsync();
// 結果: 如果 10 posts, 5 comments → 50 rows (10 * 5)

// ✅ Split queries
var blogs = await context.Blogs
    .Include(b => b.Posts)
    .AsSplitQuery()  // 多個查詢
    .ToListAsync();

// ✅ Or separate queries
var blogs = await context.Blogs.ToListAsync();
var blogIds = blogs.Select(b => b.Id).ToList();
var posts = await context.Posts
    .Where(p => blogIds.Contains(p.BlogId))
    .ToListAsync();
```

---

## 依賴注入與生命週期

### Service Lifetimes

```csharp
// ❌ Capturing Scoped in Singleton
public class SingletonService
{
    private readonly ScopedService _scoped;  // ⚠️ Captive dependency
    
    public SingletonService(ScopedService scoped)
    {
        _scoped = scoped;  // scoped service 變成 singleton!
    }
}

// ✅ Use IServiceScopeFactory
public class SingletonService
{
    private readonly IServiceScopeFactory _scopeFactory;
    
    public SingletonService(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }
    
    public async Task ProcessAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var scoped = scope.ServiceProvider
            .GetRequiredService<ScopedService>();
        await scoped.DoWorkAsync();
    }
}
```

### DbContext Lifetime

```csharp
// ❌ DbContext 作為 Singleton
services.AddSingleton<AppDbContext>();  // ⚠️ 不是 thread-safe

// ✅ DbContext 應該是 Scoped
services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString));

// ✅ 或在 Singleton 中動態建立
public class DataService
{
    private readonly IDbContextFactory<AppDbContext> _factory;
    
    public async Task ProcessAsync()
    {
        await using var context = await _factory.CreateDbContextAsync();
        // ... use context
    }
}
```

### Dispose Patterns

```csharp
// ❌ 手動 new + dispose (依賴注入失效)
public class Controller
{
    public IActionResult Get()
    {
        using var service = new MyService();  // ⚠️ 不要這樣做
        return Ok(service.GetData());
    }
}

// ✅ 注入 + framework 管理生命週期
public class Controller
{
    private readonly MyService _service;
    
    public Controller(MyService service)  // DI container 管理
    {
        _service = service;
    }
}

// ✅ 實作 IDisposable
public class MyService : IDisposable
{
    private readonly HttpClient _httpClient = new();
    
    public void Dispose()
    {
        _httpClient?.Dispose();
    }
}

// ✅ 或 IAsyncDisposable
public class MyService : IAsyncDisposable
{
    private readonly DbContext _context;
    
    public async ValueTask DisposeAsync()
    {
        if (_context != null)
            await _context.DisposeAsync();
    }
}
```

---

## 異常處理

### Exception Best Practices

```csharp
// ❌ 捕獲但不處理
try
{
    await ProcessAsync();
}
catch (Exception)
{
    // Swallow exception (隱藏問題)
}

// ✅ 記錄並重新拋出
try
{
    await ProcessAsync();
}
catch (Exception ex)
{
    _logger.LogError(ex, "Failed to process");
    throw;  // 保留 stack trace
}

// ❌ 拋出內部異常
catch (Exception ex)
{
    throw ex;  // ⚠️ 會重設 stack trace
}

// ✅ 使用 throw (無參數)
catch (Exception ex)
{
    _logger.LogError(ex, "Error occurred");
    throw;  // 保留原始 stack trace
}
```

### Custom Exceptions

```csharp
// ✅ 自定義異常
public class UserNotFoundException : Exception
{
    public int UserId { get; }
    
    public UserNotFoundException(int userId)
        : base($"User with ID {userId} not found")
    {
        UserId = userId;
    }
    
    public UserNotFoundException(int userId, Exception innerException)
        : base($"User with ID {userId} not found", innerException)
    {
        UserId = userId;
    }
}

// ✅ 使用
var user = await _repository.GetByIdAsync(id)
    ?? throw new UserNotFoundException(id);
```

### Exception Filters

```csharp
// ✅ ASP.NET Core exception filter
public class ApiExceptionFilterAttribute : ExceptionFilterAttribute
{
    private readonly ILogger<ApiExceptionFilterAttribute> _logger;
    
    public override void OnException(ExceptionContext context)
    {
        var exception = context.Exception;
        
        var response = exception switch
        {
            UserNotFoundException ex => new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "User not found",
                Detail = ex.Message
            },
            ValidationException ex => new ValidationProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Errors = ex.Errors
            },
            _ => new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An error occurred"
            }
        };
        
        _logger.LogError(exception, "Exception handled by filter");
        
        context.Result = new ObjectResult(response)
        {
            StatusCode = response.Status
        };
        
        context.ExceptionHandled = true;
    }
}
```

---

## 安全性

### SQL Injection Prevention

```csharp
// ❌ String interpolation in SQL
string sql = $"SELECT * FROM Users WHERE Id = {userId}";
var user = context.Users.FromSqlRaw(sql).FirstOrDefault();  // ⚠️ SQL Injection

// ✅ Parameterized query
var user = context.Users
    .FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {userId}")
    .FirstOrDefault();

// ✅ Or LINQ (最安全)
var user = await context.Users
    .FirstOrDefaultAsync(u => u.Id == userId);
```

### Secret Management

```csharp
// ❌ Hardcoded secrets
var connectionString = "Server=prod;Database=Users;User=admin;Password=P@ssw0rd";

// ✅ Configuration
var connectionString = _configuration.GetConnectionString("DefaultConnection");

// ✅ Azure Key Vault
builder.Configuration.AddAzureKeyVault(
    new Uri("https://myvault.vault.azure.net/"),
    new DefaultAzureCredential());

// ✅ User Secrets (development)
dotnet user-secrets set "ConnectionStrings:Default" "Server=..."
```

### Input Validation

```csharp
// ❌ 未驗證輸入
public async Task<IActionResult> CreateUser(UserDto dto)
{
    var user = new User { Name = dto.Name };  // dto.Name 可能是 null/空
    await _repository.AddAsync(user);
}

// ✅ Data Annotations
public class UserDto
{
    [Required]
    [StringLength(100, MinimumLength = 2)]
    public required string Name { get; init; }
    
    [EmailAddress]
    public string? Email { get; init; }
    
    [Range(0, 150)]
    public int Age { get; init; }
}

// ✅ FluentValidation
public class UserDtoValidator : AbstractValidator<UserDto>
{
    public UserDtoValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .Length(2, 100);
        
        RuleFor(x => x.Email)
            .EmailAddress()
            .When(x => !string.IsNullOrEmpty(x.Email));
        
        RuleFor(x => x.Age)
            .InclusiveBetween(0, 150);
    }
}
```

---

## 測試最佳實踐

### Unit Testing Patterns

```csharp
// ✅ AAA Pattern (Arrange-Act-Assert)
[Fact]
public async Task GetUserAsync_WhenUserExists_ReturnsUser()
{
    // Arrange
    var userId = 1;
    var expectedUser = new User { Id = userId, Name = "John" };
    _mockRepository
        .Setup(r => r.GetByIdAsync(userId))
        .ReturnsAsync(expectedUser);
    
    // Act
    var result = await _service.GetUserAsync(userId);
    
    // Assert
    Assert.NotNull(result);
    Assert.Equal(expectedUser.Id, result.Id);
}

// ✅ 測試異常
[Fact]
public async Task GetUserAsync_WhenUserNotFound_ThrowsException()
{
    // Arrange
    _mockRepository
        .Setup(r => r.GetByIdAsync(It.IsAny<int>()))
        .ReturnsAsync((User?)null);
    
    // Act & Assert
    await Assert.ThrowsAsync<UserNotFoundException>(
        () => _service.GetUserAsync(999));
}
```

### Integration Testing

```csharp
// ✅ WebApplicationFactory for API testing
public class UsersControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;
    
    public UsersControllerTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }
    
    [Fact]
    public async Task GetUser_ReturnsUser()
    {
        // Act
        var response = await _client.GetAsync("/api/users/1");
        
        // Assert
        response.EnsureSuccessStatusCode();
        var user = await response.Content.ReadFromJsonAsync<UserDto>();
        Assert.NotNull(user);
    }
}
```

### Test Data Builders

```csharp
// ✅ Builder pattern for test data
public class UserBuilder
{
    private int _id = 1;
    private string _name = "Test User";
    private string? _email = null;
    
    public UserBuilder WithId(int id)
    {
        _id = id;
        return this;
    }
    
    public UserBuilder WithName(string name)
    {
        _name = name;
        return this;
    }
    
    public UserBuilder WithEmail(string email)
    {
        _email = email;
        return this;
    }
    
    public User Build() => new()
    {
        Id = _id,
        Name = _name,
        Email = _email
    };
}

// 使用
var user = new UserBuilder()
    .WithId(42)
    .WithEmail("test@example.com")
    .Build();
```

---

## Review Checklist

### 語言特性
- [ ] 使用 file-scoped namespaces (C# 10+)
- [ ] 使用 primary constructors 簡化程式碼 (C# 12)
- [ ] Record types 用於不可變資料
- [ ] Pattern matching 取代冗長的 if-else
- [ ] Nullable reference types 已啟用
- [ ] 避免 string concatenation in loops

### LINQ & EF Core
- [ ] 避免多次 enumeration (使用 .ToList())
- [ ] 使用 .Any() 而非 .Count() > 0
- [ ] Include/Select 避免 N+1 queries
- [ ] 唯讀查詢使用 .AsNoTracking()
- [ ] 批次操作而非逐一 SaveChanges
- [ ] 注意笛卡爾積 (考慮 .AsSplitQuery())

### Async/Await
- [ ] 避免 async void (除了 event handlers)
- [ ] 不要 .Result 或 .Wait() (deadlock risk)
- [ ] Library code 使用 ConfigureAwait(false)
- [ ] 並行操作使用 Task.WhenAll
- [ ] Hot path 考慮 ValueTask<T>

### 記憶體
- [ ] 大字串操作使用 StringBuilder
- [ ] 考慮 Span<T>/Memory<T> 避免分配
- [ ] 大陣列使用 ArrayPool<T>
- [ ] 檢查 IDisposable/IAsyncDisposable 實作

### 依賴注入
- [ ] 避免 captive dependencies (Scoped in Singleton)
- [ ] DbContext 生命週期正確 (Scoped)
- [ ] 使用 IServiceScopeFactory 在 Singleton 中建立 scope
- [ ] 不要手動 new 可注入的服務

### 安全性
- [ ] 使用參數化查詢 (FromSqlInterpolated)
- [ ] Secret 不硬編碼 (Configuration/Key Vault)
- [ ] 輸入驗證 (Data Annotations/FluentValidation)
- [ ] 避免資訊洩漏 (exception details in production)

### 測試
- [ ] 單元測試覆蓋核心邏輯
- [ ] 整合測試覆蓋 API 端點
- [ ] 使用 Builder pattern 建立測試資料
- [ ] Mock external dependencies

---

## 常見反模式

### Anti-pattern 1: Sync over Async
```csharp
// ❌ 阻塞 async
public User GetUser(int id)
{
    return _service.GetUserAsync(id).Result;  // Deadlock!
}

// ✅ Async all the way
public async Task<User> GetUserAsync(int id)
{
    return await _service.GetUserAsync(id);
}
```

### Anti-pattern 2: Exception-driven Flow
```csharp
// ❌ 用 exception 控制流程
public User? FindUser(int id)
{
    try
    {
        return _users.First(u => u.Id == id);
    }
    catch (InvalidOperationException)
    {
        return null;  // 正常情況不該用 exception
    }
}

// ✅ 使用 FirstOrDefault
public User? FindUser(int id)
{
    return _users.FirstOrDefault(u => u.Id == id);
}
```

### Anti-pattern 3: God Class
```csharp
// ❌ God class (做太多事)
public class UserService
{
    public void CreateUser() { }
    public void SendEmail() { }
    public void ProcessPayment() { }
    public void GenerateReport() { }
    // 違反 Single Responsibility Principle
}

// ✅ 拆分責任
public class UserService { }
public class EmailService { }
public class PaymentService { }
public class ReportService { }
```

---

## 參考資源

- [C# Coding Conventions (Microsoft)](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions)
- [.NET Performance Tips](https://learn.microsoft.com/en-us/dotnet/framework/performance/)
- [EF Core Performance](https://learn.microsoft.com/en-us/ef/core/performance/)
- [Async/Await Best Practices](https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming)
