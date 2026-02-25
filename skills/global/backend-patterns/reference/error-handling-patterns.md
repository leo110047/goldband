# Error Handling Patterns - Reference

Centralized error handling and retry strategies with exponential backoff.

## Centralized Error Handler

### TypeScript

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

### C# (ASP.NET Core)

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

---

## Retry with Exponential Backoff

### TypeScript

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

### C# (Polly)

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
