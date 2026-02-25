# Query Optimization Reference

Deep reference for interpreting EXPLAIN ANALYZE output, understanding index types, fixing common anti-patterns, and configuring connection pooling and caching.

## EXPLAIN ANALYZE Output Interpretation

### Running EXPLAIN ANALYZE

```sql
-- Basic usage
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';

-- With buffer statistics (I/O information)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT * FROM orders WHERE status = 'pending';

-- JSON format for programmatic parsing
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  SELECT * FROM orders WHERE status = 'pending';
```

### Reading the Output

```
Sort  (cost=1234.56..1234.78 rows=100 width=64) (actual time=12.345..12.456 rows=95 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 32kB
  ->  Index Scan using idx_orders_status on orders  (cost=0.42..1230.12 rows=100 width=64) (actual time=0.045..11.234 rows=95 loops=1)
        Index Cond: (status = 'pending')
        Buffers: shared hit=45 read=12
Planning Time: 0.234 ms
Execution Time: 12.567 ms
```

**Cost fields:**

| Field | Meaning |
|-------|---------|
| `cost=0.42..1230.12` | Estimated startup cost..total cost (arbitrary units) |
| `rows=100` | Estimated number of rows |
| `width=64` | Estimated average row width in bytes |
| `actual time=0.045..11.234` | Real startup..total time in milliseconds |
| `rows=95` | Actual rows returned |
| `loops=1` | Number of times this node executed |

**Estimate accuracy:**
- Compare `rows=100` (estimated) to `rows=95` (actual). If these are far apart (10x or more), statistics are stale. Run `ANALYZE table_name;`

**Buffer statistics:**

| Field | Meaning |
|-------|---------|
| `shared hit=45` | Pages read from PostgreSQL buffer cache |
| `shared read=12` | Pages read from OS/disk |
| `shared written=3` | Pages written (dirty pages flushed) |
| `temp read=0` / `temp written=0` | Temp file I/O (sorts/hashes spilling to disk) |

### Common Node Types

**Scan nodes (leaf nodes that read data):**

| Node | Description | When It Appears |
|------|-------------|-----------------|
| `Seq Scan` | Full table scan, reads every row | No usable index or table is small |
| `Index Scan` | Reads index, then fetches rows from table | Index exists and is selective |
| `Index Only Scan` | Reads only the index (covering index) | All needed columns are in the index |
| `Bitmap Index Scan` + `Bitmap Heap Scan` | Builds bitmap from index, then fetches | Multiple conditions or moderate selectivity |

**Join nodes:**

| Node | Description | Best For |
|------|-------------|----------|
| `Nested Loop` | For each outer row, scan inner side | Small outer set, indexed inner |
| `Hash Join` | Build hash table on inner, probe with outer | Medium-large equi-joins |
| `Merge Join` | Both sides sorted, merge them | Pre-sorted data or index scans |

**Aggregate/Sort nodes:**

| Node | Description | Warning Sign |
|------|-------------|-------------|
| `Sort` | Sorts rows | `Sort Method: external merge Disk: 1234kB` means spilling to disk |
| `HashAggregate` | Groups using hash table | Large memory usage for many groups |
| `GroupAggregate` | Groups from pre-sorted input | Requires sort step if not pre-sorted |

---

## Index Types Deep Dive

### B-tree (Default)

```sql
CREATE INDEX idx_users_email ON users (email);
-- Equivalent to:
CREATE INDEX idx_users_email ON users USING btree (email);
```

**Supports:** `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `IN`, `IS NULL`, `IS NOT NULL`
**Also supports:** `ORDER BY` (can skip sort step), `LIKE 'prefix%'` (but not `LIKE '%suffix'`)
**Best for:** Most use cases. Default choice.

**Internal structure:** Balanced tree with O(log n) lookup. Leaf pages are doubly-linked for range scans.

### Hash

```sql
CREATE INDEX idx_users_email_hash ON users USING hash (email);
```

**Supports:** `=` only
**Does NOT support:** Range queries, ORDER BY, pattern matching
**Best for:** Equality lookups where you never need range queries. Slightly smaller than B-tree for the same data.
**Note:** Since PostgreSQL 10, hash indexes are WAL-logged and crash-safe.

### GIN (Generalized Inverted Index)

```sql
-- Full-text search
CREATE INDEX idx_articles_search ON articles USING gin (to_tsvector('english', body));

-- JSONB containment
CREATE INDEX idx_events_data ON events USING gin (metadata);

-- Array operations
CREATE INDEX idx_posts_tags ON posts USING gin (tags);
```

**Supports:** Containment (`@>`), overlap (`&&`), full-text match (`@@`)
**Best for:** Multi-valued data (arrays, JSONB, tsvector)
**Trade-off:** Slow to update (each insert may touch many index entries), fast to query
**Tip:** Use `gin_pending_list_limit` to tune batch insertion behavior

### GiST (Generalized Search Tree)

```sql
-- PostGIS geometry
CREATE INDEX idx_locations_geom ON locations USING gist (geom);

-- Range types
CREATE INDEX idx_reservations_period ON reservations USING gist (period);

-- Full-text (alternative to GIN, smaller but slower)
CREATE INDEX idx_articles_search ON articles USING gist (search_vector);
```

**Supports:** Geometric operations, range overlaps, nearest-neighbor
**Best for:** Spatial data, range types, exclusion constraints
**Trade-off:** More versatile than GIN for some types, but generally slower for pure containment queries

### BRIN (Block Range Index)

```sql
-- Great for naturally ordered data (e.g., timestamps on append-only tables)
CREATE INDEX idx_events_created ON events USING brin (created_at);
```

**Supports:** Same operators as B-tree
**Best for:** Very large tables where data is physically ordered by the indexed column (append-only logs, time-series)
**Trade-off:** Tiny index size (stores min/max per block range), but less precise than B-tree. May read extra blocks.

**Size comparison on 100M row table:**

| Index Type | Approximate Size |
|-----------|-----------------|
| B-tree | 2.1 GB |
| BRIN | 48 KB |

### Expression Indexes

```sql
-- Index on a function result
CREATE INDEX idx_users_email_lower ON users (LOWER(email));
-- Query must match exactly: WHERE LOWER(email) = 'user@example.com'

-- Index on JSONB field
CREATE INDEX idx_events_type ON events ((metadata->>'type'));
-- Query: WHERE metadata->>'type' = 'click'

-- Index on computed value
CREATE INDEX idx_orders_year ON orders (EXTRACT(YEAR FROM created_at));
-- Query: WHERE EXTRACT(YEAR FROM created_at) = 2024
```

---

## Common Query Anti-Patterns with Fixes

### 1. SELECT * (Fetches Unnecessary Data)

```sql
-- Problem: transfers extra bytes, prevents covering index scans
SELECT * FROM orders WHERE user_id = 42;

-- Fix: select only needed columns
SELECT id, status, total, created_at FROM orders WHERE user_id = 42;

-- Even better with a covering index:
CREATE INDEX idx_orders_user_covering ON orders (user_id)
  INCLUDE (status, total, created_at);
-- Now this is an Index Only Scan
```

### 2. Missing WHERE Clause on Large Tables

```sql
-- Problem: full table scan + sort on millions of rows
SELECT * FROM events ORDER BY created_at DESC LIMIT 10;

-- Fix: add a condition to narrow the scan
SELECT * FROM events
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 10;
```

### 3. Implicit Type Casting

```sql
-- Problem: index on user_id (INT) is not used because literal is TEXT
SELECT * FROM orders WHERE user_id = '42';

-- Fix: use the correct type
SELECT * FROM orders WHERE user_id = 42;

-- Also problematic: comparing TIMESTAMPTZ to TEXT
SELECT * FROM events WHERE created_at > '2024-01-01';
-- Fix: explicit cast
SELECT * FROM events WHERE created_at > '2024-01-01'::TIMESTAMPTZ;
```

### 4. LIKE with Leading Wildcard

```sql
-- Problem: cannot use standard B-tree index
SELECT * FROM products WHERE name LIKE '%widget%';

-- Fix option 1: full-text search
ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', name)) STORED;
CREATE INDEX idx_products_search ON products USING gin (search_vector);
SELECT * FROM products WHERE search_vector @@ to_tsquery('english', 'widget');

-- Fix option 2: trigram index
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
-- Now LIKE '%widget%' uses the index
```

### 5. Correlated Subquery (Runs Once Per Row)

```sql
-- Problem: subquery executes for every row in outer query
SELECT o.*,
  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
WHERE o.status = 'pending';

-- Fix: use JOIN with aggregation
SELECT o.*, COALESCE(oi.item_count, 0) AS item_count
FROM orders o
LEFT JOIN (
  SELECT order_id, COUNT(*) AS item_count
  FROM order_items
  GROUP BY order_id
) oi ON oi.order_id = o.id
WHERE o.status = 'pending';
```

### 6. OFFSET for Deep Pagination

```sql
-- Problem: OFFSET 100000 still scans and discards 100000 rows
SELECT * FROM products ORDER BY id LIMIT 20 OFFSET 100000;

-- Fix: keyset pagination (cursor-based)
SELECT * FROM products
WHERE id > 100000  -- last seen id
ORDER BY id
LIMIT 20;

-- For multi-column sort:
SELECT * FROM products
WHERE (created_at, id) < ('2024-06-15 12:00:00', 50000)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### 7. Unnecessary DISTINCT

```sql
-- Problem: DISTINCT forces sort or hash, often hiding a JOIN issue
SELECT DISTINCT u.id, u.name
FROM users u
JOIN orders o ON o.user_id = u.id;

-- Fix: use EXISTS (no duplicates to remove)
SELECT u.id, u.name
FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

---

## Connection Pooling Configuration

### Why Pool Connections

Each PostgreSQL connection consumes ~5-10 MB of memory. 100 connections = 0.5-1 GB just for connection overhead. Connection pooling reuses a small number of database connections across many application requests.

### PgBouncer Configuration

```ini
; pgbouncer.ini
[databases]
mydb = host=localhost dbname=mydb

[pgbouncer]
; Pool mode:
;   session    - connection assigned for entire client session (safest)
;   transaction - connection assigned per transaction (best for web apps)
;   statement  - connection assigned per statement (limited, no transactions)
pool_mode = transaction

; Pool sizing
default_pool_size = 20        ; connections per user/database pair
min_pool_size = 5             ; minimum idle connections to keep
reserve_pool_size = 5         ; extra connections for burst
reserve_pool_timeout = 3      ; seconds to wait before using reserve

; Connection limits
max_client_conn = 200         ; max client connections to PgBouncer
max_db_connections = 50       ; max connections to actual database

; Timeouts
server_idle_timeout = 300     ; close idle server connections after 5 min
client_idle_timeout = 0       ; 0 = no timeout for idle clients
query_timeout = 30            ; kill queries running longer than 30s
```

### Application-Level Pooling

```typescript
// Node.js with pg-pool
import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  database: 'mydb',
  max: 20,                    // maximum connections in pool
  idleTimeoutMillis: 30000,   // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail if cannot connect in 5s
});

// Always release connections back to pool
const client = await pool.connect();
try {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0];
} finally {
  client.release();  // CRITICAL: always release
}

// Or use pool.query() which handles acquire/release automatically
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
```

### Pool Sizing Formula

```
Optimal pool size = (number of CPU cores * 2) + number of disk spindles

Example:
  4 CPU cores, SSD storage (1 effective spindle)
  Pool size = (4 * 2) + 1 = 9

For most web applications: 10-20 connections is sufficient.
More connections = more lock contention and context switching.
```

---

## Query Caching Strategies

### Application-Level Cache (Redis)

```typescript
async function getUserById(userId: string): Promise<User> {
  const cacheKey = `user:${userId}`;

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Cache miss: query database
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

  // Store in cache with TTL
  await redis.setex(cacheKey, 300, JSON.stringify(user));

  return user;
}

// Invalidate on write
async function updateUser(userId: string, data: Partial<User>): Promise<User> {
  const user = await db.query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
    [data.name, userId]
  );
  await redis.del(`user:${userId}`);  // Invalidate cache
  return user;
}
```

### Materialized Views (Database-Level Cache)

```sql
-- Create materialized view for expensive aggregation
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT
  DATE_TRUNC('month', created_at) AS month,
  product_id,
  SUM(quantity) AS total_quantity,
  SUM(total) AS total_revenue,
  COUNT(*) AS order_count
FROM orders
JOIN order_items ON order_items.order_id = orders.id
GROUP BY DATE_TRUNC('month', created_at), product_id;

-- Add index on materialized view
CREATE INDEX idx_monthly_sales_month ON monthly_sales_summary (month);

-- Refresh (blocks reads during refresh)
REFRESH MATERIALIZED VIEW monthly_sales_summary;

-- Refresh concurrently (no read blocking, requires unique index)
CREATE UNIQUE INDEX idx_monthly_sales_unique
  ON monthly_sales_summary (month, product_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_sales_summary;
```

**Refresh strategies:**

| Strategy | Implementation | Best For |
|----------|---------------|----------|
| Scheduled | Cron job: `REFRESH MATERIALIZED VIEW CONCURRENTLY ...` | Reports, dashboards |
| On write | Trigger after INSERT/UPDATE/DELETE on source table | Small source tables |
| On demand | Application calls refresh when data changes | Infrequent updates |
| Lazy | Check staleness timestamp, refresh if expired | Balanced approach |

### Prepared Statements (Query Plan Cache)

```sql
-- PostgreSQL caches plans for prepared statements after 5 executions
-- In application code, use parameterized queries (not string concatenation)

-- Node.js pg driver automatically uses prepared statements with named queries:
const result = await pool.query({
  name: 'get-user-by-email',
  text: 'SELECT * FROM users WHERE email = $1',
  values: ['user@example.com']
});
```

### pg_stat_statements (Finding Queries to Optimize)

```sql
-- Enable the extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slowest queries by total time
SELECT
  calls,
  round(total_exec_time::numeric, 2) AS total_ms,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 2) AS percent,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Find queries with worst cache hit ratio
SELECT
  calls,
  shared_blks_hit,
  shared_blks_read,
  round(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS hit_ratio,
  query
FROM pg_stat_statements
WHERE calls > 100
ORDER BY hit_ratio ASC
LIMIT 20;
```
