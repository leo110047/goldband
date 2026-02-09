---
name: backend-patterns
description: |
  Backend architecture patterns and best practices for scalable server-side applications.
  Covers API design, repository patterns, authentication strategies, error handling, and microservices.

  Use when: designing REST APIs, implementing authentication, setting up error handling,
  building microservices, creating backend services, API architecture, database schema design.

  EXCLUDE: Performance optimization (use performance-optimization skill instead)
  EXCLUDE: Active debugging (use systematic-debugging skill instead)

  Focus: Architectural decisions and design patterns, not fixing existing bugs or performance issues.
---

# Backend Development Patterns

Backend architecture patterns and best practices for scalable server-side applications.

## API Design Patterns

### RESTful API Structure

```
// ✅ Resource-based URLs
GET    /api/markets                 # List resources
GET    /api/markets/:id             # Get single resource
POST   /api/markets                 # Create resource
PUT    /api/markets/:id             # Replace resource
PATCH  /api/markets/:id             # Update resource
DELETE /api/markets/:id             # Delete resource

// ✅ Query parameters for filtering, sorting, pagination
GET /api/markets?status=active&sort=volume&limit=20&offset=0
```

### Repository Pattern

```typescript
// Abstract data access logic
interface MarketRepository {
  findAll(filters?: MarketFilters): Promise<Market[]>
  findById(id: string): Promise<Market | null>
  create(data: CreateMarketDto): Promise<Market>
  update(id: string, data: UpdateMarketDto): Promise<Market>
  delete(id: string): Promise<void>
}

class SupabaseMarketRepository implements MarketRepository {
  async findAll(filters?: MarketFilters): Promise<Market[]> {
    let query = supabase.from('markets').select('*')
    
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }
    
    if (filters?.limit) {
      query = query.limit(filters.limit)
    }
    
    const { data, error } = await query
    
    if (error) throw new Error(error.message)
    return data
  }
  
  // Other methods...
}
```

**C# Equivalent**:
```csharp
public interface IMarketRepository
{
    Task<IEnumerable<Market>> FindAllAsync(MarketFilters? filters = null);
    Task<Market?> FindByIdAsync(string id);
    Task<Market> CreateAsync(CreateMarketDto data);
    Task<Market> UpdateAsync(string id, UpdateMarketDto data);
    Task DeleteAsync(string id);
}

public class EfCoreMarketRepository : IMarketRepository
{
    private readonly AppDbContext _context;
    
    public async Task<IEnumerable<Market>> FindAllAsync(MarketFilters? filters = null)
    {
        var query = _context.Markets.AsQueryable();
        
        if (filters?.Status != null)
            query = query.Where(m => m.Status == filters.Status);
        
        if (filters?.Limit > 0)
            query = query.Take(filters.Limit.Value);
        
        return await query.ToListAsync();
    }
}
```

### Service Layer Pattern

```typescript
// Business logic separated from data access
class MarketService {
  constructor(private marketRepo: MarketRepository) {}
  
  async searchMarkets(query: string, limit: number = 10): Promise<Market[]> {
    // Business logic
    const embedding = await generateEmbedding(query)
    const results = await this.vectorSearch(embedding, limit)
    
    // Fetch full data
    const markets = await this.marketRepo.findByIds(results.map(r => r.id))
    
    // Sort by similarity
    return markets.sort((a, b) => {
      const scoreA = results.find(r => r.id === a.id)?.score || 0
      const scoreB = results.find(r => r.id === b.id)?.score || 0
      return scoreA - scoreB
    })
  }
  
  private async vectorSearch(embedding: number[], limit: number) {
    // Vector search implementation
  }
}
```

**C# Equivalent**:
```csharp
public class MarketService
{
    private readonly IMarketRepository _marketRepo;
    
    public MarketService(IMarketRepository marketRepo)
    {
        _marketRepo = marketRepo;
    }
    
    public async Task<List<Market>> SearchMarketsAsync(string query, int limit = 10)
    {
        // Business logic
        var embedding = await GenerateEmbeddingAsync(query);
        var results = await VectorSearchAsync(embedding, limit);
        
        // Fetch full data
        var ids = results.Select(r => r.Id).ToList();
        var markets = await _marketRepo.FindByIdsAsync(ids);
        
        // Sort by similarity
        return markets
            .OrderByDescending(m => results.FirstOrDefault(r => r.Id == m.Id)?.Score ?? 0)
            .ToList();
    }
}
```

### Middleware Pattern

```typescript
// Request/response processing pipeline
export function withAuth(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    
    try {
      const user = await verifyToken(token)
      req.user = user
      return handler(req, res)
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}

// Usage
export default withAuth(async (req, res) => {
  // Handler has access to req.user
})
```

**C# Equivalent (ASP.NET Core)**:
```csharp
public class AuthenticationMiddleware
{
    private readonly RequestDelegate _next;
    
    public async Task InvokeAsync(HttpContext context)
    {
        var token = context.Request.Headers.Authorization
            .ToString().Replace("Bearer ", "");
        
        if (string.IsNullOrEmpty(token))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "Unauthorized" });
            return;
        }
        
        try
        {
            var user = await VerifyTokenAsync(token);
            context.Items["User"] = user;
            await _next(context);
        }
        catch
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "Invalid token" });
        }
    }
}

// Register in Program.cs
app.UseMiddleware<AuthenticationMiddleware>();
```

---

## Database Patterns

### Query Optimization

```typescript
// ✅ GOOD: Select only needed columns
const { data } = await supabase
  .from('markets')
  .select('id, name, status, volume')
  .eq('status', 'active')
  .order('volume', { ascending: false })
  .limit(10)

// ❌ BAD: Select everything
const { data } = await supabase
  .from('markets')
  .select('*')
```

**C# (EF Core)**:
```csharp
// ✅ GOOD: Select only needed columns
var markets = await _context.Markets
    .Where(m => m.Status == "active")
    .OrderByDescending(m => m.Volume)
    .Take(10)
    .Select(m => new { m.Id, m.Name, m.Status, m.Volume })
    .ToListAsync();

// ❌ BAD: Select everything
var markets = await _context.Markets.ToListAsync();
```

### N+1 Query Prevention

```typescript
// ❌ BAD: N+1 query problem
const markets = await getMarkets()
for (const market of markets) {
  market.creator = await getUser(market.creator_id)  // N queries
}

// ✅ GOOD: Batch fetch
const markets = await getMarkets()
const creatorIds = markets.map(m => m.creator_id)
const creators = await getUsers(creatorIds)  // 1 query
const creatorMap = new Map(creators.map(c => [c.id, c]))

markets.forEach(market => {
  market.creator = creatorMap.get(market.creator_id)
})
```

**C# (EF Core)**:
```csharp
// ❌ BAD: N+1 query problem
var markets = await _context.Markets.ToListAsync();
foreach (var market in markets)
{
    market.Creator = await _context.Users
        .FirstOrDefaultAsync(u => u.Id == market.CreatorId);  // N queries
}

// ✅ GOOD: Eager loading with Include
var markets = await _context.Markets
    .Include(m => m.Creator)
    .ToListAsync();

// ✅ GOOD: Or use projection
var markets = await _context.Markets
    .Select(m => new MarketDto
    {
        Id = m.Id,
        Name = m.Name,
        CreatorName = m.Creator.Name
    })
    .ToListAsync();
```

### Transaction Pattern

```typescript
async function createMarketWithPosition(
  marketData: CreateMarketDto,
  positionData: CreatePositionDto
) {
  // Use Supabase transaction
  const { data, error } = await supabase.rpc('create_market_with_position', {
    market_data: marketData,
    position_data: positionData
  })
  
  if (error) throw new Error('Transaction failed')
  return data
}
```

**C# (EF Core)**:
```csharp
public async Task<Market> CreateMarketWithPositionAsync(
    CreateMarketDto marketData,
    CreatePositionDto positionData)
{
    using var transaction = await _context.Database.BeginTransactionAsync();
    try
    {
        var market = new Market { /* ... */ };
        _context.Markets.Add(market);
        await _context.SaveChangesAsync();
        
        var position = new Position { MarketId = market.Id, /* ... */ };
        _context.Positions.Add(position);
        await _context.SaveChangesAsync();
        
        await transaction.CommitAsync();
        return market;
    }
    catch
    {
        await transaction.RollbackAsync();
        throw;
    }
}
```

---

## Caching Strategies

### Redis Caching Layer

```typescript
class CachedMarketRepository implements MarketRepository {
  constructor(
    private baseRepo: MarketRepository,
    private redis: RedisClient
  ) {}
  
  async findById(id: string): Promise<Market | null> {
    // Check cache first
    const cached = await this.redis.get(`market:${id}`)
    
    if (cached) {
      return JSON.parse(cached)
    }
    
    // Cache miss - fetch from database
    const market = await this.baseRepo.findById(id)
    
    if (market) {
      // Cache for 5 minutes
      await this.redis.setex(`market:${id}`, 300, JSON.stringify(market))
    }
    
    return market
  }
  
  async invalidateCache(id: string): Promise<void> {
    await this.redis.del(`market:${id}`)
  }
}
```

**C# (StackExchange.Redis)**:
```csharp
public class CachedMarketRepository : IMarketRepository
{
    private readonly IMarketRepository _baseRepo;
    private readonly IConnectionMultiplexer _redis;
    
    public async Task<Market?> FindByIdAsync(string id)
    {
        var db = _redis.GetDatabase();
        var cacheKey = $"market:{id}";
        
        // Check cache first
        var cached = await db.StringGetAsync(cacheKey);
        if (cached.HasValue)
        {
            return JsonSerializer.Deserialize<Market>(cached!);
        }
        
        // Cache miss - fetch from database
        var market = await _baseRepo.FindByIdAsync(id);
        
        if (market != null)
        {
            // Cache for 5 minutes
            await db.StringSetAsync(
                cacheKey,
                JsonSerializer.Serialize(market),
                TimeSpan.FromMinutes(5)
            );
        }
        
        return market;
    }
}
```

### Cache-Aside Pattern

```typescript
async function getMarketWithCache(id: string): Promise<Market> {
  const cacheKey = `market:${id}`
  
  // Try cache
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)
  
  // Cache miss - fetch from DB
  const market = await db.markets.findUnique({ where: { id } })
  
  if (!market) throw new Error('Market not found')
  
  // Update cache
  await redis.setex(cacheKey, 300, JSON.stringify(market))
  
  return market
}
```

---

## Error Handling Patterns

### Centralized Error Handler

```typescript
class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message)
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

export function errorHandler(error: unknown, req: Request): Response {
  if (error instanceof ApiError) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: error.statusCode })
  }
  
  if (error instanceof z.ZodError) {
    return NextResponse.json({
      success: false,
      error: 'Validation failed',
      details: error.errors
    }, { status: 400 })
  }
  
  // Log unexpected errors
  console.error('Unexpected error:', error)
  
  return NextResponse.json({
    success: false,
    error: 'Internal server error'
  }, { status: 500 })
}
```

**C# (ASP.NET Core)**:
```csharp
public class ApiException : Exception
{
    public int StatusCode { get; }
    public bool IsOperational { get; }
    
    public ApiException(int statusCode, string message, bool isOperational = true)
        : base(message)
    {
        StatusCode = statusCode;
        IsOperational = isOperational;
    }
}

// Middleware
public class GlobalExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext context,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var (statusCode, message) = exception switch
        {
            ApiException apiEx => (apiEx.StatusCode, apiEx.Message),
            ValidationException => (400, "Validation failed"),
            _ => (500, "Internal server error")
        };
        
        if (statusCode == 500)
            _logger.LogError(exception, "Unexpected error");
        
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new
        {
            success = false,
            error = message
        }, cancellationToken);
        
        return true;
    }
}
```

### Retry with Exponential Backoff

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (i < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

// Usage
const data = await fetchWithRetry(() => fetchFromAPI())
```

**C# (Polly)**:
```csharp
using Polly;

var retryPolicy = Policy
    .Handle<HttpRequestException>()
    .WaitAndRetryAsync(
        retryCount: 3,
        sleepDurationProvider: attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt)),
        onRetry: (exception, timeSpan, retryCount, context) =>
        {
            _logger.LogWarning("Retry {RetryCount} after {Delay}ms", retryCount, timeSpan.TotalMilliseconds);
        });

var data = await retryPolicy.ExecuteAsync(() => FetchFromApiAsync());
```

---

## Authentication & Authorization

### JWT Token Validation

```typescript
import jwt from 'jsonwebtoken'

interface JWTPayload {
  userId: string
  email: string
  role: 'admin' | 'user'
}

export function verifyToken(token: string): JWTPayload {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
    return payload
  } catch (error) {
    throw new ApiError(401, 'Invalid token')
  }
}

export async function requireAuth(request: Request) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  
  if (!token) {
    throw new ApiError(401, 'Missing authorization token')
  }
  
  return verifyToken(token)
}
```

**C# (ASP.NET Core)**:
```csharp
public class JwtService
{
    private readonly IConfiguration _config;
    
    public ClaimsPrincipal VerifyToken(string token)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.UTF8.GetBytes(_config["Jwt:Secret"]!);
        
        try
        {
            var principal = tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = false,
                ValidateAudience = false
            }, out _);
            
            return principal;
        }
        catch
        {
            throw new ApiException(401, "Invalid token");
        }
    }
}

// Middleware
public async Task InvokeAsync(HttpContext context)
{
    var token = context.Request.Headers.Authorization
        .ToString().Replace("Bearer ", "");
    
    if (string.IsNullOrEmpty(token))
        throw new ApiException(401, "Missing authorization token");
    
    var principal = _jwtService.VerifyToken(token);
    context.User = principal;
    
    await _next(context);
}
```

### Role-Based Access Control

```typescript
type Permission = 'read' | 'write' | 'delete' | 'admin'

interface User {
  id: string
  role: 'admin' | 'moderator' | 'user'
}

const rolePermissions: Record<User['role'], Permission[]> = {
  admin: ['read', 'write', 'delete', 'admin'],
  moderator: ['read', 'write', 'delete'],
  user: ['read', 'write']
}

export function hasPermission(user: User, permission: Permission): boolean {
  return rolePermissions[user.role].includes(permission)
}

export function requirePermission(permission: Permission) {
  return (handler: (request: Request, user: User) => Promise<Response>) => {
    return async (request: Request) => {
      const user = await requireAuth(request)
      
      if (!hasPermission(user, permission)) {
        throw new ApiError(403, 'Insufficient permissions')
      }
      
      return handler(request, user)
    }
  }
}
```

**C# (ASP.NET Core)**:
```csharp
public enum Permission
{
    Read, Write, Delete, Admin
}

public static class RolePermissions
{
    private static readonly Dictionary<string, Permission[]> Permissions = new()
    {
        ["admin"] = new[] { Permission.Read, Permission.Write, Permission.Delete, Permission.Admin },
        ["moderator"] = new[] { Permission.Read, Permission.Write, Permission.Delete },
        ["user"] = new[] { Permission.Read, Permission.Write }
    };
    
    public static bool HasPermission(string role, Permission permission)
    {
        return Permissions.TryGetValue(role, out var perms) && perms.Contains(permission);
    }
}

// Attribute
public class RequirePermissionAttribute : TypeFilterAttribute
{
    public RequirePermissionAttribute(Permission permission)
        : base(typeof(PermissionFilter))
    {
        Arguments = new object[] { permission };
    }
}

// Usage
[HttpDelete]
[RequirePermission(Permission.Delete)]
public async Task<IActionResult> Delete(int id) { }
```

---

## Rate Limiting

### Simple In-Memory Rate Limiter

```typescript
class RateLimiter {
  private requests = new Map<string, number[]>()
  
  async checkLimit(
    identifier: string,
    maxRequests: number,
    windowMs: number
  ): Promise<boolean> {
    const now = Date.now()
    const requests = this.requests.get(identifier) || []
    
    // Remove old requests outside window
    const recentRequests = requests.filter(time => now - time < windowMs)
    
    if (recentRequests.length >= maxRequests) {
      return false  // Rate limit exceeded
    }
    
    // Add current request
    recentRequests.push(now)
    this.requests.set(identifier, recentRequests)
    
    return true
  }
}

const limiter = new RateLimiter()

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  
  const allowed = await limiter.checkLimit(ip, 100, 60000)  // 100 req/min
  
  if (!allowed) {
    return NextResponse.json({
      error: 'Rate limit exceeded'
    }, { status: 429 })
  }
  
  // Continue with request
}
```

**C# (ASP.NET Core with AspNetCoreRateLimit)**:
```csharp
// appsettings.json
{
  "IpRateLimiting": {
    "EnableEndpointRateLimiting": true,
    "GeneralRules": [
      {
        "Endpoint": "*",
        "Period": "1m",
        "Limit": 100
      }
    ]
  }
}

// Program.cs
builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(
    builder.Configuration.GetSection("IpRateLimiting"));
builder.Services.AddInMemoryRateLimiting();
builder.Services.AddSingleton<IRateLimitConfiguration, RateLimitConfiguration>();

app.UseIpRateLimiting();
```

---

## Background Jobs & Queues

### Simple Queue Pattern

```typescript
class JobQueue<T> {
  private queue: T[] = []
  private processing = false
  
  async add(job: T): Promise<void> {
    this.queue.push(job)
    
    if (!this.processing) {
      this.process()
    }
  }
  
  private async process(): Promise<void> {
    this.processing = true
    
    while (this.queue.length > 0) {
      const job = this.queue.shift()!
      
      try {
        await this.execute(job)
      } catch (error) {
        console.error('Job failed:', error)
      }
    }
    
    this.processing = false
  }
  
  private async execute(job: T): Promise<void> {
    // Job execution logic
  }
}
```

**C# (Background Service)**:
```csharp
public interface IBackgroundQueue<T>
{
    void Enqueue(T item);
    Task<T> DequeueAsync(CancellationToken cancellationToken);
}

public class BackgroundQueue<T> : IBackgroundQueue<T>
{
    private readonly Channel<T> _queue = Channel.CreateUnbounded<T>();
    
    public void Enqueue(T item)
    {
        _queue.Writer.TryWrite(item);
    }
    
    public async Task<T> DequeueAsync(CancellationToken cancellationToken)
    {
        return await _queue.Reader.ReadAsync(cancellationToken);
    }
}

public class QueuedHostedService : BackgroundService
{
    private readonly IBackgroundQueue<IndexJob> _queue;
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var job = await _queue.DequeueAsync(stoppingToken);
            await ExecuteJobAsync(job);
        }
    }
}
```

---

## Logging & Monitoring

### Structured Logging

```typescript
interface LogContext {
  userId?: string
  requestId?: string
  method?: string
  path?: string
  [key: string]: unknown
}

class Logger {
  log(level: 'info' | 'warn' | 'error', message: string, context?: LogContext) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    }
    
    console.log(JSON.stringify(entry))
  }
  
  info(message: string, context?: LogContext) {
    this.log('info', message, context)
  }
  
  warn(message: string, context?: LogContext) {
    this.log('warn', message, context)
  }
  
  error(message: string, error: Error, context?: LogContext) {
    this.log('error', message, {
      ...context,
      error: error.message,
      stack: error.stack
    })
  }
}
```

**C# (Serilog)**:
```csharp
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new JsonFormatter())
    .CreateLogger();

// Usage
_logger.LogInformation("Fetching markets {@Context}", new
{
    RequestId = requestId,
    Method = "GET",
    Path = "/api/markets"
});

try
{
    var markets = await FetchMarketsAsync();
}
catch (Exception ex)
{
    _logger.LogError(ex, "Failed to fetch markets {@Context}", new
    {
        RequestId = requestId
    });
}
```

---

**Remember**: Backend patterns enable scalable, maintainable server-side applications. Choose patterns that fit your complexity level.

## Quick Reference

| Pattern | Use Case | Key Benefit |
|---------|----------|-------------|
| Repository | Data access abstraction | Testability, maintainability |
| Service Layer | Business logic separation | Single responsibility |
| Middleware | Cross-cutting concerns | Request pipeline |
| Caching | Performance optimization | Reduced database load |
| RBAC | Authorization | Fine-grained access control |
| Rate Limiting | API protection | Prevent abuse |
| Retry Pattern | Transient failures | Resilience |
| Structured Logging | Observability | Debugging, monitoring |
