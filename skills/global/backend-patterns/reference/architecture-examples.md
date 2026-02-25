# Architecture Examples - Reference

Authentication, authorization, rate limiting, background jobs, and logging patterns.

## Authentication & Authorization

### JWT Token Validation

#### TypeScript

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

#### C# (ASP.NET Core)

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

### Role-Based Access Control (RBAC)

#### TypeScript

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

#### C# (ASP.NET Core)

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

### Simple In-Memory Rate Limiter (TypeScript)

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

### C# (ASP.NET Core with AspNetCoreRateLimit)

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

### Simple Queue Pattern (TypeScript)

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

### C# (Background Service)

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

### Structured Logging (TypeScript)

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

### C# (Serilog)

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
