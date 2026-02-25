# API Design Patterns - Reference

Detailed code examples for Repository, Service Layer, and Middleware patterns.

## Repository Pattern

### TypeScript

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

### C# Equivalent

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

---

## Service Layer Pattern

### TypeScript

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

### C# Equivalent

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

---

## Middleware Pattern

### TypeScript

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

### C# Equivalent (ASP.NET Core)

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
