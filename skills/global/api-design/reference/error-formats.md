# Error Formats Reference

Complete RFC 7807 Problem Details specification with examples for every common HTTP error status code.

## RFC 7807 Problem Details Full Spec

### Media Type

Error responses should use `Content-Type: application/problem+json`.

### Standard Members

```json
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Order with ID ord_999 was not found.",
  "instance": "/v1/orders/ord_999"
}
```

| Member | Required | Type | Description |
|--------|----------|------|-------------|
| `type` | Yes | URI | Identifies the problem type. Should be a stable URL. Use `about:blank` if no specific type. |
| `title` | Yes | string | Short, human-readable summary. Same for all instances of this `type`. |
| `status` | Yes | integer | HTTP status code. Must match the actual HTTP response status. |
| `detail` | No | string | Human-readable explanation specific to this occurrence. |
| `instance` | No | URI | Identifies the specific occurrence. Typically the request path. |

### Custom Extensions

You may add any additional members relevant to your API:

```json
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains 2 invalid fields.",
  "instance": "/v1/orders",
  "errors": [
    {
      "field": "email",
      "message": "Must be a valid email address",
      "code": "invalid_format",
      "value": "not-an-email"
    }
  ],
  "request_id": "req_abc123def456",
  "documentation_url": "https://docs.example.com/errors/validation-error"
}
```

---

## Error Response Examples by Status Code

### 400 Bad Request

Use when the request is syntactically malformed (invalid JSON, missing required headers).

```json
{
  "type": "https://api.example.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "The request body contains invalid JSON. Unexpected token at position 42.",
  "instance": "/v1/orders"
}
```

```json
{
  "type": "https://api.example.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Missing required header: Content-Type.",
  "instance": "/v1/orders"
}
```

### 401 Unauthorized

Use when authentication is missing or invalid. The client must authenticate to proceed.

```json
{
  "type": "https://api.example.com/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "The access token is missing. Include an Authorization header with a valid Bearer token.",
  "instance": "/v1/users/me"
}
```

```json
{
  "type": "https://api.example.com/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "The access token has expired. Request a new token from POST /auth/token.",
  "instance": "/v1/orders",
  "expired_at": "2024-06-15T10:30:00Z"
}
```

### 403 Forbidden

Use when the client is authenticated but does not have permission for this action.

```json
{
  "type": "https://api.example.com/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You do not have permission to delete this order. Only admins can delete confirmed orders.",
  "instance": "/v1/orders/ord_42",
  "required_role": "admin",
  "current_role": "member"
}
```

### 404 Not Found

Use when the requested resource does not exist.

```json
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Order with ID ord_999 was not found.",
  "instance": "/v1/orders/ord_999"
}
```

**Security note:** For sensitive resources, you may return 404 instead of 403 to avoid revealing that the resource exists. Document this behavior for your team.

### 409 Conflict

Use when the request conflicts with the current state of the resource.

```json
{
  "type": "https://api.example.com/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "A user with email 'alice@example.com' already exists.",
  "instance": "/v1/users",
  "conflicting_field": "email",
  "conflicting_value": "alice@example.com"
}
```

```json
{
  "type": "https://api.example.com/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "This order has been modified since you last retrieved it. Fetch the latest version and retry.",
  "instance": "/v1/orders/ord_42",
  "current_version": 5,
  "your_version": 3
}
```

### 422 Unprocessable Entity

Use when the request is well-formed JSON but semantically invalid (validation errors).

```json
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains 3 validation errors.",
  "instance": "/v1/orders",
  "errors": [
    {
      "field": "items",
      "message": "Must contain at least one item",
      "code": "min_length",
      "minimum": 1,
      "actual": 0
    },
    {
      "field": "shipping_address.zip",
      "message": "Must be a valid US ZIP code (5 or 9 digits)",
      "code": "invalid_format",
      "value": "ABC",
      "pattern": "^\\d{5}(-\\d{4})?$"
    },
    {
      "field": "coupon_code",
      "message": "Coupon 'SUMMER50' has expired",
      "code": "expired",
      "expired_at": "2024-06-01T00:00:00Z"
    }
  ]
}
```

**Validation error object fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `field` | Yes | Dot-notation path to the invalid field (`shipping_address.zip`) |
| `message` | Yes | Human-readable description of the problem |
| `code` | Yes | Machine-readable error code for programmatic handling |
| Additional | No | Context-specific data (`minimum`, `maximum`, `pattern`, `value`) |

### 429 Too Many Requests

Use when the client has exceeded the rate limit.

```json
{
  "type": "https://api.example.com/errors/rate-limit-exceeded",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "You have exceeded the rate limit of 100 requests per minute. Please wait 23 seconds before retrying.",
  "instance": "/v1/orders",
  "retry_after": 23,
  "limit": 100,
  "window": "1 minute",
  "current_usage": 100
}
```

**Always include these response headers with a 429:**

```
Retry-After: 23
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718452800
```

### 500 Internal Server Error

Use for unexpected server errors. Never expose internal details.

```json
{
  "type": "https://api.example.com/errors/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred. Please try again later. If the problem persists, contact support with the request ID.",
  "instance": "/v1/orders",
  "request_id": "req_abc123def456"
}
```

**Rules for 500 errors:**
- Log the full stack trace, query, and request body server-side
- Return only the `request_id` to the client for correlation
- Never expose database errors, file paths, or stack traces
- Monitor 500 error rate and alert on spikes

---

## Error Message Best Practices

### Writing Good Error Messages

```
Rule 1: Tell the user WHAT went wrong
  Bad:  "Invalid input"
  Good: "The 'email' field must be a valid email address"

Rule 2: Tell the user HOW to fix it
  Bad:  "Authentication failed"
  Good: "The access token has expired. Request a new token from POST /auth/token"

Rule 3: Be specific, not generic
  Bad:  "Validation error"
  Good: "The 'quantity' field must be between 1 and 100. You provided 0."

Rule 4: Use consistent language
  Bad:  "Field is required" (one endpoint) vs "Missing field" (another)
  Good: "The '{field}' field is required" (everywhere)

Rule 5: Include relevant context
  Bad:  "Duplicate entry"
  Good: "A user with email 'alice@example.com' already exists"
```

### Machine-Readable Error Codes

Define a consistent set of error codes that clients can switch on:

```
Validation codes:
  required           - Field is required but missing
  invalid_format     - Field does not match expected format
  invalid_type       - Field is wrong type (string instead of integer)
  min_length         - String/array too short
  max_length         - String/array too long
  out_of_range       - Number outside min/max bounds
  not_unique         - Value already exists (duplicate)
  expired            - Value (token, coupon) has expired
  not_found          - Referenced resource does not exist

Authentication codes:
  token_missing      - No auth token provided
  token_invalid      - Token cannot be decoded
  token_expired      - Token has expired
  insufficient_scope - Token does not have required scope

Business logic codes:
  insufficient_funds - Not enough balance for operation
  already_processed  - Resource has already been processed
  limit_exceeded     - Usage limit reached
  not_allowed        - Operation not allowed in current state
```

---

## Error Handling in TypeScript

### Server-Side Error Classes

```typescript
// Base error class
class ApiError extends Error {
  constructor(
    public readonly type: string,
    public readonly title: string,
    public readonly status: number,
    public readonly detail: string,
    public readonly extensions: Record<string, unknown> = {}
  ) {
    super(detail);
  }

  toJSON() {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...this.extensions,
    };
  }
}

// Specific error classes
class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super(
      'https://api.example.com/errors/not-found',
      'Not Found',
      404,
      `${resource} with ID ${id} was not found.`
    );
  }
}

class ValidationError extends ApiError {
  constructor(errors: Array<{ field: string; message: string; code: string }>) {
    super(
      'https://api.example.com/errors/validation-error',
      'Validation Error',
      422,
      `The request body contains ${errors.length} validation error(s).`,
      { errors }
    );
  }
}

class ConflictError extends ApiError {
  constructor(detail: string, extensions?: Record<string, unknown>) {
    super(
      'https://api.example.com/errors/conflict',
      'Conflict',
      409,
      detail,
      extensions
    );
  }
}
```

### Client-Side Error Handling

```typescript
interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: Array<{ field: string; message: string; code: string }>;
  retry_after?: number;
  request_id?: string;
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const problem: ProblemDetail = await response.json();

    switch (problem.status) {
      case 401:
        // Redirect to login or refresh token
        throw new AuthenticationError(problem);
      case 422:
        // Show field-level validation errors in the UI
        throw new ValidationError(problem);
      case 429:
        // Wait and retry
        if (problem.retry_after) {
          await delay(problem.retry_after * 1000);
          return apiRequest<T>(url, options);
        }
        throw new RateLimitError(problem);
      default:
        throw new ApiError(problem);
    }
  }

  return response.json();
}
```
