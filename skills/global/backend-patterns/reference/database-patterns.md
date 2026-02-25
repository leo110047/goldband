# Database Patterns - Reference

Query optimization, N+1 prevention, transactions, and caching strategies.

## Query Optimization

### TypeScript

```typescript
// GOOD: Select only needed columns
const { data } = await supabase
  .from('markets')
  .select('id, name, status, volume')
  .eq('status', 'active')
  .order('volume', { ascending: false })
  .limit(10)

// BAD: Select everything
const { data } = await supabase
  .from('markets')
  .select('*')
```

### C# (EF Core)

```csharp
// GOOD: Select only needed columns
var markets = await _context.Markets
    .Where(m => m.Status == "active")
    .OrderByDescending(m => m.Volume)
    .Take(10)
    .Select(m => new { m.Id, m.Name, m.Status, m.Volume })
    .ToListAsync();

// BAD: Select everything
var markets = await _context.Markets.ToListAsync();
```

---

## N+1 Query Prevention

### TypeScript

```typescript
// BAD: N+1 query problem
const markets = await getMarkets()
for (const market of markets) {
  market.creator = await getUser(market.creator_id)  // N queries
}

// GOOD: Batch fetch
const markets = await getMarkets()
const creatorIds = markets.map(m => m.creator_id)
const creators = await getUsers(creatorIds)  // 1 query
const creatorMap = new Map(creators.map(c => [c.id, c]))

markets.forEach(market => {
  market.creator = creatorMap.get(market.creator_id)
})
```

### C# (EF Core)

```csharp
// BAD: N+1 query problem
var markets = await _context.Markets.ToListAsync();
foreach (var market in markets)
{
    market.Creator = await _context.Users
        .FirstOrDefaultAsync(u => u.Id == market.CreatorId);  // N queries
}

// GOOD: Eager loading with Include
var markets = await _context.Markets
    .Include(m => m.Creator)
    .ToListAsync();

// GOOD: Or use projection
var markets = await _context.Markets
    .Select(m => new MarketDto
    {
        Id = m.Id,
        Name = m.Name,
        CreatorName = m.Creator.Name
    })
    .ToListAsync();
```

---

## Transaction Pattern

### TypeScript

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

### C# (EF Core)

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

#### TypeScript

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

#### C# (StackExchange.Redis)

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

#### TypeScript

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
