# Pagination Patterns Reference

Implementation details for cursor-based, offset, and keyset pagination with code examples in TypeScript and SQL.

## Cursor-Based Pagination

### How It Works

1. Client requests a page with a `limit` and optional `after` cursor
2. Server decodes the cursor to extract the position (e.g., last ID seen)
3. Server queries for rows after that position
4. Server encodes the new cursor from the last row in the result
5. Client passes the new cursor on the next request

### Cursor Encoding

The cursor is an opaque, base64-encoded string. The client should never parse or construct it.

```typescript
// Encoding: object -> base64 string
function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

// Decoding: base64 string -> object
function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw new ValidationError([{
      field: 'after',
      message: 'Invalid cursor format',
      code: 'invalid_format'
    }]);
  }
}

// Example:
// encodeCursor({ id: 42 })  =>  "eyJpZCI6NDJ9"
// decodeCursor("eyJpZCI6NDJ9")  =>  { id: 42 }
```

### SQL Query

```sql
-- Forward pagination (after cursor)
SELECT id, name, status, created_at
FROM orders
WHERE id > $1    -- $1 = decoded cursor ID
ORDER BY id ASC
LIMIT $2 + 1;    -- $2 = requested limit; fetch one extra to check has_next

-- Backward pagination (before cursor)
SELECT id, name, status, created_at
FROM orders
WHERE id < $1    -- $1 = decoded cursor ID
ORDER BY id DESC
LIMIT $2 + 1;
```

### TypeScript Implementation

```typescript
interface PaginationParams {
  limit: number;
  after?: string;   // forward cursor
  before?: string;  // backward cursor
}

interface PaginatedResult<T> {
  data: T[];
  pagination: {
    has_next: boolean;
    has_previous: boolean;
    next_cursor: string | null;
    previous_cursor: string | null;
  };
}

async function paginateOrders(
  params: PaginationParams
): Promise<PaginatedResult<Order>> {
  const { limit, after, before } = params;
  const fetchLimit = limit + 1; // Fetch one extra to determine has_next/has_previous

  let query: string;
  let values: unknown[];

  if (after) {
    const cursor = decodeCursor(after);
    query = `
      SELECT id, name, status, created_at
      FROM orders
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2
    `;
    values = [cursor.id, fetchLimit];
  } else if (before) {
    const cursor = decodeCursor(before);
    query = `
      SELECT id, name, status, created_at
      FROM orders
      WHERE id < $1
      ORDER BY id DESC
      LIMIT $2
    `;
    values = [cursor.id, fetchLimit];
  } else {
    // First page
    query = `
      SELECT id, name, status, created_at
      FROM orders
      ORDER BY id ASC
      LIMIT $1
    `;
    values = [fetchLimit];
  }

  const rows = await db.query(query, values);

  // If fetching backward, reverse to maintain ascending order
  if (before) rows.reverse();

  // Check if there are more results
  const hasExtra = rows.length > limit;
  if (hasExtra) rows.pop(); // Remove the extra row

  const hasNext = after ? hasExtra : before ? true : hasExtra;
  const hasPrevious = after ? true : before ? hasExtra : false;

  return {
    data: rows,
    pagination: {
      has_next: hasNext,
      has_previous: hasPrevious,
      next_cursor: rows.length > 0
        ? encodeCursor({ id: rows[rows.length - 1].id })
        : null,
      previous_cursor: rows.length > 0
        ? encodeCursor({ id: rows[0].id })
        : null,
    },
  };
}
```

### Multi-Column Cursor (Non-Unique Sort)

When sorting by a non-unique column (e.g., `created_at`), include a unique tiebreaker (e.g., `id`):

```typescript
// Cursor contains both sort column and tiebreaker
const cursor = encodeCursor({
  created_at: '2024-06-15T10:30:00Z',
  id: 42
});
```

```sql
-- SQL for multi-column cursor
SELECT id, name, created_at
FROM orders
WHERE (created_at, id) > ($1, $2)
ORDER BY created_at ASC, id ASC
LIMIT $3;
```

### Trade-offs

**Pros:**
- Stable results even when rows are inserted or deleted during pagination
- Consistent performance regardless of depth (no OFFSET to skip)
- Works well with real-time data (feeds, notifications)

**Cons:**
- Cannot jump to an arbitrary page
- Cannot display total page count without a separate COUNT query
- More complex to implement than offset pagination

---

## Offset Pagination

### SQL Query

```sql
SELECT id, name, status, created_at
FROM orders
ORDER BY created_at DESC
LIMIT $1      -- per_page
OFFSET $2;    -- (page - 1) * per_page

-- Count total for pagination metadata
SELECT COUNT(*) FROM orders;
```

### TypeScript Implementation

```typescript
interface OffsetPaginationParams {
  page: number;     // 1-indexed
  per_page: number; // items per page (max 100)
}

interface OffsetPaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total_items: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
}

async function paginateOrdersOffset(
  params: OffsetPaginationParams
): Promise<OffsetPaginatedResult<Order>> {
  const page = Math.max(1, params.page);
  const perPage = Math.min(100, Math.max(1, params.per_page));
  const offset = (page - 1) * perPage;

  // Run data query and count query in parallel
  const [dataResult, countResult] = await Promise.all([
    db.query(
      `SELECT id, name, status, created_at
       FROM orders
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [perPage, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM orders`),
  ]);

  const totalItems = countResult.rows[0].total;
  const totalPages = Math.ceil(totalItems / perPage);

  return {
    data: dataResult.rows,
    pagination: {
      page,
      per_page: perPage,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_previous: page > 1,
    },
  };
}
```

### Deep Page Performance Problem

```sql
-- Page 1: fast (skip 0 rows)
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 0;
-- Execution time: 1ms

-- Page 5000: slow (skip 99,980 rows, then return 20)
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 99980;
-- Execution time: 450ms

-- The database must scan and discard 99,980 rows before returning 20.
```

**Mitigation strategies:**

1. Cap the maximum page number (e.g., max 500 pages)
2. Switch to cursor-based pagination for deep pages
3. Use keyset pagination (see below)
4. Cache the COUNT query if it is expensive

### Trade-offs

**Pros:**
- Simple to implement and understand
- Allows jumping to any page
- Displays total page count and item count
- Good for admin UIs and search results

**Cons:**
- Performance degrades with depth (OFFSET scans and discards rows)
- Inconsistent results when rows are inserted/deleted during pagination (items can be skipped or duplicated)
- COUNT(*) on large tables can be slow

---

## Keyset Pagination

Keyset pagination uses an indexed column (typically the sort column) as the cursor, avoiding OFFSET entirely.

### SQL Query

```sql
-- First page
SELECT id, name, created_at
FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- Next page (using last row's created_at and id as cursor)
SELECT id, name, created_at
FROM orders
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### How It Differs from Cursor Pagination

Keyset pagination is a specific technique; cursor-based pagination is the API pattern. They are often used together:

```
Cursor pagination = API design pattern (opaque cursor token)
Keyset pagination = Database technique (WHERE col > last_value)

Cursor pagination usually uses keyset pagination under the hood.
```

---

## Response Envelope Format

### Standard Envelope

```json
{
  "data": [
    { "id": "ord_1", "status": "pending" },
    { "id": "ord_2", "status": "shipped" }
  ],
  "pagination": {
    "has_next": true,
    "has_previous": false,
    "next_cursor": "eyJpZCI6Im9yZF8yIn0",
    "previous_cursor": null
  }
}
```

### With Metadata

```json
{
  "data": [ ... ],
  "pagination": {
    "has_next": true,
    "next_cursor": "eyJpZCI6Im9yZF8yMCJ9"
  },
  "meta": {
    "total_count": 1542,
    "filtered_count": 87
  }
}
```

**Note:** `total_count` requires a separate COUNT query which can be expensive. Make it opt-in:

```
GET /orders?include_total=true
```

### Empty Collection

```json
{
  "data": [],
  "pagination": {
    "has_next": false,
    "has_previous": false,
    "next_cursor": null,
    "previous_cursor": null
  }
}
```

Always return an empty array for `data`, never `null` or omit the field.

---

## Link Header Format (RFC 8288)

An alternative to pagination in the response body. Some APIs use both.

```
Link: <https://api.example.com/v1/orders?after=eyJpZCI6NjJ9&limit=20>; rel="next",
      <https://api.example.com/v1/orders?before=eyJpZCI6NDN9&limit=20>; rel="prev",
      <https://api.example.com/v1/orders?limit=20>; rel="first"
```

### TypeScript Helper

```typescript
function buildLinkHeader(
  baseUrl: string,
  pagination: {
    has_next: boolean;
    has_previous: boolean;
    next_cursor: string | null;
    previous_cursor: string | null;
  },
  limit: number
): string {
  const links: string[] = [];

  if (pagination.has_next && pagination.next_cursor) {
    links.push(
      `<${baseUrl}?after=${pagination.next_cursor}&limit=${limit}>; rel="next"`
    );
  }

  if (pagination.has_previous && pagination.previous_cursor) {
    links.push(
      `<${baseUrl}?before=${pagination.previous_cursor}&limit=${limit}>; rel="prev"`
    );
  }

  links.push(`<${baseUrl}?limit=${limit}>; rel="first"`);

  return links.join(', ');
}

// Usage in Express
res.setHeader('Link', buildLinkHeader(
  'https://api.example.com/v1/orders',
  result.pagination,
  20
));
```

---

## Pagination Parameter Validation

Always validate and constrain pagination parameters:

```typescript
function validatePaginationParams(query: Record<string, string>) {
  const errors: Array<{ field: string; message: string; code: string }> = [];

  const limit = parseInt(query.limit || '20', 10);
  if (isNaN(limit) || limit < 1) {
    errors.push({ field: 'limit', message: 'Must be a positive integer', code: 'out_of_range' });
  } else if (limit > 100) {
    errors.push({ field: 'limit', message: 'Maximum value is 100', code: 'out_of_range' });
  }

  const page = parseInt(query.page || '1', 10);
  if (isNaN(page) || page < 1) {
    errors.push({ field: 'page', message: 'Must be a positive integer', code: 'out_of_range' });
  } else if (page > 500) {
    errors.push({ field: 'page', message: 'Maximum page is 500. Use cursor pagination for deeper results.', code: 'out_of_range' });
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return { limit, page };
}
```
