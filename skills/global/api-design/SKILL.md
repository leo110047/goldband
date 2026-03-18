---
name: api-design
description: |
  Use when defining HTTP endpoints, request/response contracts, error formats,
  pagination, versioning, or OpenAPI for a public or internal API.

  Best fit for interface contracts and cross-endpoint consistency.
  EXCLUDE: backend implementation patterns (use backend-patterns skill)
  EXCLUDE: database schema/query design (use database-patterns skill)
allowed-tools:
  - Read
  - Grep
  - Glob
---

# API Design Patterns

Best practices for building consistent, predictable, and well-documented REST APIs.

## REST Conventions

### Resource Naming Rules

```
1. Use nouns, not verbs (resources, not actions)
   /users           (not /getUsers)
   /orders          (not /createOrder)

2. Use plural nouns
   /users            (not /user)
   /order-items      (not /order-item)

3. Use kebab-case for multi-word resources
   /order-items      (not /orderItems or /order_items)

4. Nest for clear parent-child relationships (max 2 levels deep)
   /users/42/orders          (orders belonging to user 42)
   /orders/99/items          (items in order 99)
   NOT: /users/42/orders/99/items/3/options   (too deep)

5. Use query parameters for filtering, not path segments
   /orders?status=pending    (not /orders/pending)
   /products?category=tools  (not /products/tools)
```

### URL Structure

```
https://api.example.com/v1/resources?filter=value&sort=field&page=1

Anatomy:
  api.example.com   - API subdomain (or /api prefix on main domain)
  /v1               - Version prefix
  /resources        - Plural noun for the collection
  ?filter=value     - Query parameters for filtering
  &sort=field       - Sorting parameter
  &page=1           - Pagination parameter
```

### HTTP Method Selection Matrix

| Operation | Method | Path | Request Body | Response Code | Response Body |
|-----------|--------|------|-------------|---------------|---------------|
| List resources | `GET` | `/orders` | None | `200 OK` | Array of resources |
| Get single resource | `GET` | `/orders/42` | None | `200 OK` | Single resource |
| Create resource | `POST` | `/orders` | Resource data | `201 Created` | Created resource + `Location` header |
| Full replace | `PUT` | `/orders/42` | Complete resource | `200 OK` | Updated resource |
| Partial update | `PATCH` | `/orders/42` | Fields to update | `200 OK` | Updated resource |
| Delete resource | `DELETE` | `/orders/42` | None | `204 No Content` | None |
| Check existence | `HEAD` | `/orders/42` | None | `200` or `404` | None (headers only) |
| List allowed methods | `OPTIONS` | `/orders` | None | `204` | `Allow` header |

### Method Semantics

```
GET     - Safe (no side effects) + Idempotent (same result if repeated)
PUT     - Idempotent (same result if repeated)
DELETE  - Idempotent (same result if repeated)
PATCH   - Neither safe nor idempotent
POST    - Neither safe nor idempotent

Idempotent means: calling it 1 time or 10 times produces the same server state.
This matters for retry logic and network failures.
```

### Actions That Do Not Map to CRUD

Sometimes you need endpoints that are not simple CRUD operations. Options:

```
Option 1: Treat the action as a sub-resource
  POST /orders/42/cancellation        (create a cancellation)
  POST /users/42/password-reset       (create a password reset)
  POST /payments/42/refund            (create a refund)

Option 2: Use a verb as a controller endpoint (last resort)
  POST /orders/42/cancel
  POST /reports/generate
  POST /emails/send

Prefer option 1 when the action creates a trackable resource.
Use option 2 when the action is truly a one-shot command.
```

---

## Error Response Format

### RFC 7807 Problem Details

Use a consistent error format across the entire API. RFC 7807 (Problem Details for HTTP APIs) is the standard.

```json
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains invalid fields.",
  "instance": "/orders",
  "errors": [
    {
      "field": "email",
      "message": "Must be a valid email address",
      "code": "invalid_format"
    },
    {
      "field": "quantity",
      "message": "Must be greater than 0",
      "code": "out_of_range"
    }
  ]
}
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | URI | A URI reference that identifies the error type. Can be a URL to documentation. |
| `title` | string | Short, human-readable summary. Should be the same for all instances of this type. |
| `status` | integer | HTTP status code |

**Optional fields:**

| Field | Type | Description |
|-------|------|-------------|
| `detail` | string | Human-readable explanation specific to this occurrence |
| `instance` | string | URI of the specific resource or request path |

**Custom extensions:** Add any additional fields relevant to your API (e.g., `errors` array for validation, `retry_after` for rate limiting).

### HTTP Status Code Usage

| Code | Name | When to Use |
|------|------|------------|
| `200` | OK | Successful GET, PUT, PATCH, or DELETE |
| `201` | Created | Successful POST that created a resource |
| `204` | No Content | Successful DELETE with no response body |
| `301` | Moved Permanently | Resource URL has permanently changed |
| `304` | Not Modified | Client cache is still valid (ETag/If-None-Match) |
| `400` | Bad Request | Malformed request syntax, invalid JSON |
| `401` | Unauthorized | Missing or invalid authentication credentials |
| `403` | Forbidden | Authenticated but not authorized for this action |
| `404` | Not Found | Resource does not exist |
| `405` | Method Not Allowed | HTTP method not supported on this endpoint |
| `409` | Conflict | Request conflicts with current state (duplicate, version conflict) |
| `422` | Unprocessable Entity | Request is well-formed but semantically invalid (validation errors) |
| `429` | Too Many Requests | Rate limit exceeded. Include `Retry-After` header. |
| `500` | Internal Server Error | Unexpected server error. Never expose internal details. |
| `503` | Service Unavailable | Server is temporarily overloaded or in maintenance |

### Error Response Rules

1. **Always return JSON** even for errors (set `Content-Type: application/problem+json`)
2. **Never expose stack traces** or internal details in production
3. **Use consistent structure** across all endpoints
4. **Include machine-readable error codes** (not just human-readable messages)
5. **Log the full error server-side** with a correlation ID; return the correlation ID to the client

> See `reference/error-formats.md` for complete examples of every status code and custom extensions.

---

## Pagination Strategies

### Decision Tree

```
START: What kind of data are you paginating?

  REAL-TIME or frequently changing data (feeds, notifications)
    --> Cursor-based pagination
    --> Stable results, no skipped/duplicated items
    --> Cannot jump to arbitrary page

  STATIC or slowly changing data (search results, admin tables)
    --> Offset pagination
    --> Simple, allows jumping to any page
    --> Deep pages are slow, items may shift

  HIGH-VOLUME sequential data (logs, events, time-series)
    --> Keyset pagination
    --> Uses indexed column (timestamp, ID) as cursor
    --> Very fast even at depth, but requires sortable key
```

### Cursor-Based Pagination

```
Request:
  GET /orders?limit=20&after=eyJpZCI6NDJ9

Response:
{
  "data": [ ... ],
  "pagination": {
    "has_next": true,
    "has_previous": true,
    "next_cursor": "eyJpZCI6NjJ9",
    "previous_cursor": "eyJpZCI6NDN9"
  }
}

Cursor is an opaque, base64-encoded token (e.g., {"id": 62}).
Client does not decode it; just passes it back.
```

### Offset Pagination

```
Request:
  GET /products?page=3&per_page=20

Response:
{
  "data": [ ... ],
  "pagination": {
    "page": 3,
    "per_page": 20,
    "total_items": 542,
    "total_pages": 28
  }
}
```

### Comparison

| Feature | Cursor | Offset |
|---------|--------|--------|
| Jump to page N | No | Yes |
| Consistent results during inserts/deletes | Yes | No |
| Performance at depth | Constant (fast) | Degrades (slow at page 5000) |
| Implementation complexity | Medium | Low |
| Requires sequential key | Yes | No |

> See `reference/pagination-patterns.md` for implementation code, SQL queries, and response envelope formats.

---

## API Versioning

### Approaches and Trade-offs

| Approach | Example | Pros | Cons |
|----------|---------|------|------|
| **URL path** | `/v1/users` | Explicit, easy to route, cacheable | Breaks URLs, duplicates routes |
| **Query parameter** | `/users?version=1` | Easy to add, optional | Easy to forget, less visible |
| **Header** | `Accept: application/vnd.api+json;version=1` | Clean URLs, content negotiation | Hidden, harder to test in browser |
| **Content negotiation** | `Accept: application/vnd.example.v1+json` | Standards-compliant | Complex, poor tooling support |

### Recommendation

**Use URL path versioning** (`/v1/`, `/v2/`) for public APIs. It is the most visible, easiest to understand, and simplest to implement.

### Versioning Rules

```
1. Only increment the major version for BREAKING changes:
   - Removing a field
   - Renaming a field
   - Changing a field's type
   - Changing error response format
   - Removing an endpoint

2. Non-breaking changes do NOT need a new version:
   - Adding a new field to a response
   - Adding a new optional query parameter
   - Adding a new endpoint
   - Adding a new enum value (if clients handle unknown values)

3. Support at most 2 versions simultaneously (current + previous)

4. Announce deprecation at least 6 months before removal

5. Return a Sunset header on deprecated versions:
   Sunset: Sat, 01 Mar 2025 00:00:00 GMT
   Deprecation: true
```

### Migration Strategy

```
Phase 1: Build v2 alongside v1
  - Both versions run in production
  - v2 may share code with v1 (adapter pattern)

Phase 2: Deprecate v1
  - Return Sunset and Deprecation headers on v1 responses
  - Log v1 usage to track migration progress
  - Notify consumers via email/dashboard

Phase 3: Remove v1
  - Return 410 Gone on all v1 endpoints
  - Include migration guide URL in response body
```

---

## Rate Limiting

### Response Headers

```
X-RateLimit-Limit: 100          # Max requests per window
X-RateLimit-Remaining: 73       # Requests remaining in current window
X-RateLimit-Reset: 1704067200   # Unix timestamp when window resets
Retry-After: 30                 # Seconds until client can retry (on 429)
```

### Rate Limiting Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| Fixed window | N requests per minute/hour | Simple APIs |
| Sliding window | N requests in any rolling 60-second period | Smoother throttling |
| Token bucket | Tokens regenerate at fixed rate, burst allowed | APIs with burst traffic |
| Leaky bucket | Requests processed at fixed rate, excess queued | Consistent throughput |

### Per-Endpoint Limits

```
Authentication endpoints:
  POST /auth/login        - 5 per minute (prevent brute force)
  POST /auth/register     - 3 per minute
  POST /auth/reset-password - 3 per hour

Standard CRUD endpoints:
  GET  /resources         - 100 per minute
  POST /resources         - 30 per minute
  PUT/PATCH /resources/:id - 30 per minute
  DELETE /resources/:id   - 10 per minute

Expensive operations:
  POST /reports/generate  - 5 per hour
  POST /exports           - 3 per hour
```

### 429 Response Format

```json
{
  "type": "https://api.example.com/errors/rate-limit-exceeded",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "You have exceeded the rate limit of 100 requests per minute.",
  "retry_after": 30
}
```

---

## OpenAPI / Swagger Checklist

Every API should have an OpenAPI 3.x specification for documentation, client SDK generation, and validation middleware.

### Spec Quality Checklist

- [ ] Every endpoint has a `summary` and `operationId`
- [ ] Every parameter has a `description`, `type`, and example
- [ ] Every response code is documented (200, 400, 401, 404, 500)
- [ ] Error responses use the Problem Details schema
- [ ] Authentication is documented in `securitySchemes`
- [ ] Request/response examples are included
- [ ] Schemas use `$ref` for reuse (no duplication)
- [ ] Enum values are documented with descriptions
- [ ] Pagination parameters and response format are consistent
- [ ] The spec validates with `openapi-generator validate` or `spectral lint`

---

## Request/Response Design

### Response Envelope

```json
// Single resource
{ "data": { "id": "ord_42", "status": "pending", "total": 59.99 } }

// Collection
{ "data": [ ... ], "pagination": { "has_next": true, "next_cursor": "eyJpZCI6NjJ9" } }

// Empty collection (always return empty array, never null)
{ "data": [], "pagination": { "has_next": false } }
```

### Field Naming and Conventions

```
Case:      Pick snake_case or camelCase and use it everywhere
Dates:     ISO 8601 with timezone: "2024-06-15T10:30:00Z"
IDs:       Prefixed strings: "usr_abc123", "ord_xyz789"
Booleans:  Positive names: "is_active" (not "is_inactive")
Nulls:     Return null for absent optional fields (not empty string or 0)
```

### Filtering, Sorting, and Field Selection

```
GET /orders?status=pending&user_id=42              (filtering)
GET /orders?sort=-created_at                       (descending sort)
GET /orders?sort=-total,created_at                 (multi-field sort)
GET /orders?fields=id,status,total                 (sparse fieldsets)
GET /products?q=wireless+keyboard                  (full-text search)
```

---

## Quick Reference

| Topic | Key Rule |
|-------|---------|
| Resource naming | Plural nouns, kebab-case, max 2 nesting levels |
| HTTP methods | GET=read, POST=create, PUT=replace, PATCH=update, DELETE=remove |
| Error format | RFC 7807 Problem Details for every error |
| Pagination | Cursor-based for real-time data, offset for static data |
| Versioning | URL path (`/v1/`) for public APIs |
| Rate limiting | Always return X-RateLimit headers and Retry-After on 429 |
| OpenAPI | Every API needs a spec; validate it in CI |
| Dates | ISO 8601 with timezone (`2024-06-15T10:30:00Z`) |
| Field names | Consistent case (snake_case or camelCase) across entire API |
