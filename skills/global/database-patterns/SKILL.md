---
name: database-patterns
description: |
  Database design patterns, query optimization, and data management best practices.
  Covers schema design, indexing strategies, N+1 detection, migrations, and transactions.

  Use when: designing database schemas, optimizing queries, planning migrations,
  working with ORMs, troubleshooting slow queries, implementing transactions.

  EXCLUDE: API design (use api-design skill)
  EXCLUDE: Active debugging (use systematic-debugging skill)
allowed-tools:
  - Read
  - Grep
  - Bash
---

# Database Design Patterns

Database design patterns, query optimization, and data management best practices for building reliable, performant data layers.

## Schema Design Principles

### Normalization vs Denormalization Decision Tree

```
START: Do you have write-heavy or read-heavy workload?

  WRITE-HEAVY (transactional systems, OLTP)
    --> Normalize (3NF)
    --> Reduces data duplication
    --> Ensures consistency on writes
    --> Accept JOIN cost on reads

  READ-HEAVY (analytics, reporting, OLAP)
    --> Denormalize selectively
    --> Pre-compute aggregations
    --> Accept write complexity for read speed
    --> Consider materialized views

  MIXED WORKLOAD
    --> Normalize base tables (3NF)
    --> Add denormalized read models (materialized views, cache tables)
    --> Use CQRS pattern: separate write model from read model
```

### When to Denormalize

| Signal | Action |
|--------|--------|
| Frequent JOINs across 3+ tables for common queries | Denormalize into a read-optimized table |
| Aggregations computed on every request | Pre-compute into summary table or materialized view |
| Data rarely changes but is read constantly | Flatten into single table |
| Write performance is fine, reads are slow | Add denormalized read replica |
| Data must be consistent in real-time | Keep normalized, optimize with indexes |

### Key Rules

1. **Start normalized** - denormalize only when you have measured performance problems
2. **Denormalize at the query level** - create views or read models, do not flatten your source of truth
3. **Document every denormalization** - note what is duplicated and how sync is maintained
4. **Use constraints** - NOT NULL, UNIQUE, CHECK, FOREIGN KEY constraints catch bugs early

> See `reference/schema-design.md` for normalization forms, common schema patterns, and naming conventions.

---

## Query Optimization Checklist

### Step-by-Step Process

1. **Identify the slow query** - check application logs, slow query log, or APM tools
2. **Run EXPLAIN ANALYZE** - understand the actual execution plan
3. **Look for table scans** - Seq Scan on large tables is usually the problem
4. **Check for missing indexes** - add indexes on WHERE, JOIN, and ORDER BY columns
5. **Verify index usage** - sometimes indexes exist but are not used (type mismatch, function wrapping)
6. **Check row estimates** - large estimate errors mean stale statistics (run ANALYZE)
7. **Optimize the query** - rewrite to avoid anti-patterns
8. **Measure again** - compare before/after with EXPLAIN ANALYZE

### Reading EXPLAIN ANALYZE Output

```sql
EXPLAIN ANALYZE SELECT u.name, COUNT(o.id) as order_count
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.status = 'active'
GROUP BY u.name
ORDER BY order_count DESC
LIMIT 10;
```

Key things to look for in the output:

| Field | What It Means | Red Flag |
|-------|---------------|----------|
| `Seq Scan` | Full table scan | On tables > 10K rows |
| `actual time` | Real execution time (ms) | First number is startup, second is total |
| `rows` | Actual rows processed | Compare `rows` to `Plan Rows` for estimate accuracy |
| `Nested Loop` | For each row in outer, scan inner | Fine for small sets, bad for large |
| `Hash Join` | Build hash table, probe it | Good for medium-large joins |
| `Sort` | In-memory or disk sort | `Sort Method: external merge` means disk spill |
| `Buffers: shared hit` | Pages from cache | High `shared read` means cold cache or table too big |

### Common Query Anti-Patterns

```sql
-- Anti-pattern 1: SELECT * (fetches unnecessary data, breaks covering indexes)
SELECT * FROM orders WHERE status = 'pending';
-- Fix: select only needed columns
SELECT id, user_id, total, created_at FROM orders WHERE status = 'pending';

-- Anti-pattern 2: Function on indexed column (prevents index use)
SELECT * FROM users WHERE LOWER(email) = 'user@example.com';
-- Fix: use expression index or store normalized
CREATE INDEX idx_users_email_lower ON users (LOWER(email));

-- Anti-pattern 3: Implicit type casting
SELECT * FROM orders WHERE id = '12345';  -- id is integer, literal is text
-- Fix: use correct type
SELECT * FROM orders WHERE id = 12345;

-- Anti-pattern 4: OR on different columns (often prevents index use)
SELECT * FROM products WHERE name = 'Widget' OR category = 'Tools';
-- Fix: use UNION
SELECT * FROM products WHERE name = 'Widget'
UNION
SELECT * FROM products WHERE category = 'Tools';

-- Anti-pattern 5: NOT IN with NULLs (unexpected results)
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM banned_users);
-- Fix: use NOT EXISTS
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM banned_users b WHERE b.user_id = u.id);
```

> See `reference/query-optimization.md` for index types deep dive, connection pooling, and caching strategies.

---

## Index Strategy Decision Tree

### Choosing the Right Index Type

```
What kind of query are you optimizing?

  EQUALITY lookups (WHERE col = value)
    --> B-tree (default, works for everything)
    --> Hash (equality only, slightly faster, no range support)

  RANGE queries (WHERE col > value, BETWEEN, ORDER BY)
    --> B-tree

  FULL-TEXT search (WHERE col @@ to_tsquery('...'))
    --> GIN on tsvector column

  JSONB containment (WHERE col @> '{"key": "value"}')
    --> GIN on JSONB column

  Array operations (WHERE col && ARRAY[1,2,3])
    --> GIN

  Geometric / spatial (PostGIS, nearest neighbor)
    --> GiST

  Very large tables, range scans on naturally ordered data (timestamps)
    --> BRIN (tiny index, good for append-only tables)
```

### Composite Index Rules

```sql
-- Rule 1: Column order matters - put equality columns first, range columns last
-- Query: WHERE status = 'active' AND created_at > '2024-01-01'
CREATE INDEX idx_orders_status_created ON orders (status, created_at);
-- NOT: CREATE INDEX idx_orders_created_status ON orders (created_at, status);

-- Rule 2: The index can serve queries on leading columns
-- This index serves:
--   WHERE status = 'active'
--   WHERE status = 'active' AND created_at > ...
-- But NOT:
--   WHERE created_at > ...  (not the leading column)

-- Rule 3: Include columns for covering indexes (index-only scans)
CREATE INDEX idx_orders_covering ON orders (status, created_at)
  INCLUDE (total, user_id);
-- Now SELECT total, user_id FROM orders WHERE status='active' uses index-only scan

-- Rule 4: Partial indexes for filtered queries
CREATE INDEX idx_orders_pending ON orders (created_at)
  WHERE status = 'pending';
-- Smaller index, only covers rows matching the WHERE clause
```

### Index Maintenance Checklist

- [ ] Run `EXPLAIN ANALYZE` to confirm index is used
- [ ] Check index size vs table size (`pg_relation_size`)
- [ ] Remove unused indexes (`pg_stat_user_indexes` where `idx_scan = 0`)
- [ ] REINDEX periodically for bloated indexes
- [ ] Monitor write overhead (each index slows INSERT/UPDATE/DELETE)

---

## N+1 Detection and Prevention

### The Problem

```
1 query to fetch N parent records
+ N queries to fetch related records for each parent
= N+1 total queries
```

### Detection Signals

- Response time scales linearly with result count
- Database connection pool exhaustion under load
- Query logs show repeated identical queries with different parameters
- ORM debug output shows dozens of queries for a single page load

### Prevention Patterns

**Pattern 1: Eager Loading (JOINs)**

```sql
-- Instead of: 1 query for orders + N queries for users
SELECT o.*, u.name as user_name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 'pending';
```

**Pattern 2: Batch Loading (IN clause)**

```typescript
// Fetch all orders, then batch-fetch all users
const orders = await db.query('SELECT * FROM orders WHERE status = $1', ['pending']);
const userIds = [...new Set(orders.map(o => o.user_id))];
const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds]);
const userMap = new Map(users.map(u => [u.id, u]));
orders.forEach(o => o.user = userMap.get(o.user_id));
```

**Pattern 3: DataLoader (GraphQL / Batching)**

```typescript
const userLoader = new DataLoader(async (userIds: string[]) => {
  const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds]);
  const userMap = new Map(users.map(u => [u.id, u]));
  return userIds.map(id => userMap.get(id) || null);
});

// Each resolve call is batched automatically
const user = await userLoader.load(order.user_id);
```

**ORM-Specific Solutions:**

| ORM | Solution |
|-----|----------|
| Prisma | `include: { user: true }` or `select` with nested |
| TypeORM | `relations: ['user']` or `leftJoinAndSelect` |
| EF Core | `.Include(o => o.User)` |
| Django | `select_related('user')` or `prefetch_related('tags')` |
| SQLAlchemy | `joinedload(Order.user)` or `subqueryload` |

---

## Migration Best Practices

### Safe Migration Checklist

Before deploying any migration:

- [ ] **Backward compatible** - old code can run against new schema
- [ ] **Reversible** - migration has a working rollback (down migration)
- [ ] **Tested on production-size data** - ran against a copy of prod
- [ ] **Estimated duration** - know how long it takes on your data volume
- [ ] **No exclusive locks on hot tables** - avoid `ALTER TABLE ... ADD COLUMN ... DEFAULT` on Postgres < 11
- [ ] **Deployment order** - migrate first, deploy code second (for additive changes)

### Zero-Downtime Migration Rules

**Adding a column:**

```sql
-- Step 1: Add column as nullable (no lock on reads)
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- Step 2: Deploy code that writes to new column (but does not require it)

-- Step 3: Backfill existing rows (in batches)
UPDATE users SET phone = '' WHERE phone IS NULL AND id BETWEEN 1 AND 10000;
UPDATE users SET phone = '' WHERE phone IS NULL AND id BETWEEN 10001 AND 20000;
-- ... continue in batches

-- Step 4: Add NOT NULL constraint (if needed)
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
```

**Renaming a column:**

```sql
-- NEVER: ALTER TABLE users RENAME COLUMN name TO full_name;
-- (breaks all running code instantly)

-- Step 1: Add new column
ALTER TABLE users ADD COLUMN full_name VARCHAR(255);

-- Step 2: Backfill
UPDATE users SET full_name = name WHERE full_name IS NULL;

-- Step 3: Deploy code that writes to both columns, reads from new

-- Step 4: Stop writing to old column

-- Step 5: Drop old column (after verification period)
ALTER TABLE users DROP COLUMN name;
```

**Removing a column:**

```sql
-- Step 1: Deploy code that no longer reads/writes the column
-- Step 2: Wait for all old code instances to drain
-- Step 3: Drop the column
ALTER TABLE users DROP COLUMN legacy_field;
```

### Batch Update Pattern

```sql
-- Never update millions of rows in one transaction
-- Instead, batch by primary key ranges

DO $$
DECLARE
  batch_size INT := 5000;
  max_id INT;
  current_id INT := 0;
BEGIN
  SELECT MAX(id) INTO max_id FROM users;
  WHILE current_id < max_id LOOP
    UPDATE users
    SET status = 'active'
    WHERE id > current_id AND id <= current_id + batch_size
      AND status IS NULL;
    current_id := current_id + batch_size;
    COMMIT;
    PERFORM pg_sleep(0.1);  -- brief pause to reduce lock contention
  END LOOP;
END $$;
```

---

## Transaction Patterns

### Isolation Levels Quick Reference

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | Use Case |
|-------|-----------|-------------------|-------------|----------|
| READ UNCOMMITTED | Yes | Yes | Yes | Almost never appropriate |
| READ COMMITTED | No | Yes | Yes | Default in PostgreSQL; good for most OLTP |
| REPEATABLE READ | No | No | Yes (Postgres: No) | Financial reports, consistent snapshots |
| SERIALIZABLE | No | No | No | Strict correctness (booking systems, inventory) |

### Choosing the Right Level

```
Default (READ COMMITTED): Use for most operations. Each statement sees
the latest committed data. Simple and fast.

REPEATABLE READ: Use when a transaction must see a consistent snapshot
(e.g., generating a report that reads multiple tables).

SERIALIZABLE: Use when concurrent transactions must behave as if they
ran one at a time (e.g., double-booking prevention). Expect and handle
serialization failures with retries.
```

### Deadlock Prevention Rules

1. **Acquire locks in a consistent order** - if transaction A locks table X then Y, transaction B must also lock X then Y
2. **Keep transactions short** - minimize time between first lock and commit
3. **Use row-level locks, not table locks** - `SELECT ... FOR UPDATE` on specific rows
4. **Set lock timeouts** - `SET lock_timeout = '5s'` to fail fast rather than wait forever
5. **Retry on deadlock** - catch deadlock errors and retry the entire transaction

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable =
        error.code === '40001' || // serialization_failure
        error.code === '40P01';   // deadlock_detected
      if (!isRetryable || attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));
    }
  }
  throw new Error('Unreachable');
}

// Usage
const result = await withRetry(async () => {
  return await db.transaction(async (tx) => {
    const balance = await tx.query(
      'SELECT balance FROM accounts WHERE id = $1 FOR UPDATE', [accountId]
    );
    if (balance.rows[0].balance < amount) throw new Error('Insufficient funds');
    await tx.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, accountId]
    );
    await tx.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, targetId]
    );
    return { success: true };
  });
});
```

### Advisory Locks (Application-Level Locking)

```sql
-- Use when you need to serialize access to a logical resource
-- without locking actual rows

-- Acquire lock (blocks until available)
SELECT pg_advisory_lock(hashtext('process-daily-report'));

-- Do work...

-- Release lock
SELECT pg_advisory_unlock(hashtext('process-daily-report'));

-- Try lock (non-blocking, returns true/false)
SELECT pg_try_advisory_lock(hashtext('process-daily-report'));
```

---

## Quick Reference

| Topic | Key Takeaway |
|-------|-------------|
| Schema Design | Start normalized (3NF), denormalize only with measured need |
| Query Optimization | Always use EXPLAIN ANALYZE before and after changes |
| Indexing | B-tree for most cases; composite indexes: equality first, range last |
| N+1 Prevention | Eager load (JOIN) or batch load (IN clause / DataLoader) |
| Migrations | Additive and backward-compatible; batch large updates |
| Transactions | READ COMMITTED for most; SERIALIZABLE for strict correctness |
| Deadlocks | Consistent lock order, short transactions, retry on failure |
