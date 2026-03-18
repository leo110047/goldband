---
name: backend-patterns
description: |
  Use when designing backend service boundaries, repository/service layers,
  authentication architecture, error handling structure, microservice seams,
  or overall server-side system shape.

  Best fit for structural decisions, not active bug fixing or performance tuning.
  EXCLUDE: performance optimization (use performance-optimization skill instead)
  EXCLUDE: active debugging (use systematic-debugging skill instead)
---

# Backend Development Patterns

Backend architecture patterns and best practices for scalable server-side applications.

## Priority and Conflict Rules

- **Scope**: Architectural decisions and design patterns
- **Separate from**: Performance tuning (use `performance-optimization` skill)
- **Defers to**: `systematic-debugging` when bugs are present
- Focus on structure and design, not fixing existing problems

---

## Gotchas

- Do not cargo-cult Repository/Service/Middleware layers into small systems that do not have boundary pressure.
- Do not use this skill to paper over an active bug or failing test. Switch to `systematic-debugging` first.
- Do not recommend microservices, queues, or eventing unless there is a concrete operational reason.
- Do not add abstractions whose only justification is "clean architecture" without a real seam to protect.
- Do not move domain logic into controllers/handlers just to keep service files short.

---

## API Design Patterns

### RESTful API Structure

```
GET    /api/resources                 # List resources
GET    /api/resources/:id             # Get single resource
POST   /api/resources                 # Create resource
PUT    /api/resources/:id             # Replace resource
PATCH  /api/resources/:id             # Update resource
DELETE /api/resources/:id             # Delete resource

GET /api/resources?status=active&sort=field&limit=20&offset=0
```

### Repository Pattern

Abstract data access behind an interface so business logic is decoupled from the
database. Define CRUD methods on the interface; swap implementations (Supabase,
EF Core, in-memory) without touching service code.

See [reference/api-patterns.md](reference/api-patterns.md) for full TypeScript and C# examples.

### Service Layer Pattern

Encapsulate business logic in a dedicated service class that depends on repository
interfaces. Keeps controllers thin and logic testable.

See [reference/api-patterns.md](reference/api-patterns.md) for full TypeScript and C# examples.

### Middleware Pattern

Build a request/response processing pipeline for cross-cutting concerns like
authentication, logging, and rate limiting. Compose middleware functions around
route handlers.

See [reference/api-patterns.md](reference/api-patterns.md) for full TypeScript and C# examples.

---

## Database Patterns

Covers query optimization (select only needed columns), N+1 query prevention
(batch fetching, eager loading), and transaction patterns for multi-step writes.
All examples provided in both TypeScript (Supabase) and C# (EF Core).

Key principles:
- Always select specific columns instead of `SELECT *`
- Batch-fetch related records or use eager loading to prevent N+1 queries
- Wrap multi-step mutations in explicit transactions with rollback on failure

See [reference/database-patterns.md](reference/database-patterns.md) for full code examples.

---

## Caching Strategies

Use the decorator/wrapper pattern to add caching transparently around repository
calls. Redis is the standard caching layer; the Cache-Aside pattern (check cache,
fetch on miss, update cache) applies regardless of provider.

Key principles:
- Cache at the repository level using a decorator that implements the same interface
- Set sensible TTLs (e.g., 5 minutes) and invalidate on writes
- Cache-Aside: read-through on miss, write-through on mutation

See [reference/database-patterns.md](reference/database-patterns.md) for Redis Caching Layer and Cache-Aside examples.

---

## Error Handling Patterns

Define a custom `ApiError` class with status code and operational flag. Build a
centralized error handler that maps error types to HTTP responses (ApiError,
ZodError/ValidationException, fallback 500). Use retry with exponential backoff
for transient failures (network, external APIs).

Key principles:
- Centralize all error-to-response mapping in one handler
- Distinguish operational errors (expected) from programmer errors (unexpected)
- Retry transient failures with exponential backoff (1s, 2s, 4s)

See [reference/error-handling-patterns.md](reference/error-handling-patterns.md) for full TypeScript and C# examples.

---

## Authentication & Authorization

JWT token validation with a `verifyToken` helper and `requireAuth` middleware.
Role-Based Access Control (RBAC) maps roles to permission arrays and enforces
via middleware or attributes.

Key principles:
- Validate JWT on every protected request; attach user to context
- Define role-to-permission mappings declaratively
- Use middleware (TypeScript) or attributes (C#) to enforce permissions per route

See [reference/architecture-examples.md](reference/architecture-examples.md) for JWT and RBAC examples.

---

## Rate Limiting

Protect APIs from abuse with sliding-window rate limiters. Track requests per
identifier (IP, user ID) and reject with 429 when limits are exceeded.

Key principles:
- Use in-memory rate limiting for single-instance, Redis for distributed
- Configure per-endpoint limits (e.g., 100 req/min for reads, 10 req/min for writes)
- Return `429 Too Many Requests` with `Retry-After` header

See [reference/architecture-examples.md](reference/architecture-examples.md) for TypeScript and ASP.NET Core examples.

---

## Background Jobs & Queues

Process long-running work asynchronously with a simple queue pattern. Decouple
request handling from expensive operations (email, indexing, notifications).

Key principles:
- Use an in-process queue for simple cases; Redis/RabbitMQ for distributed
- Process jobs sequentially or with controlled concurrency
- Log failures and implement dead-letter handling for poison messages

See [reference/architecture-examples.md](reference/architecture-examples.md) for TypeScript and C# BackgroundService examples.

---

## Logging & Monitoring

Emit structured JSON logs with consistent fields (timestamp, level, message,
context). Attach request ID, user ID, and method/path for traceability.

Key principles:
- Always log as structured JSON, never free-form strings
- Include correlation IDs (request ID) across the request lifecycle
- Log at appropriate levels: info for flow, warn for recoverable, error for failures

See [reference/architecture-examples.md](reference/architecture-examples.md) for TypeScript Logger class and Serilog examples.

---

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

---

**Remember**: Backend patterns enable scalable, maintainable server-side applications. Choose patterns that fit your complexity level.
