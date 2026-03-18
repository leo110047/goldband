---
name: performance-optimization
description: |
  Use when something is slow: page load, render lag, query latency, throughput,
  bundle size, Core Web Vitals, memory pressure, or any measured bottleneck.

  PRIORITY: takes precedence when the request is about slowness, lag, bottlenecks, or optimization.
  EXCLUDE: architectural design without a measured performance problem (use backend-patterns skill instead)
---

# Performance Optimization - Making Software Fast

## When to Use This Skill

- Improving slow page load times and performance
- Reducing JavaScript bundle sizes
- Optimizing React component rendering with memoization
- Implementing code splitting and lazy loading
- Configuring browser and server-side caching
- Optimizing images with next/image or similar
- Profiling performance bottlenecks with DevTools
- Implementing virtual scrolling for large datasets
- Optimizing database queries and N+1 problems
- Improving Core Web Vitals (LCP, FID, CLS)
- Implementing progressive image loading
- Reducing Time to Interactive (TTI)

## Core Principles

1. **Measure First, Optimize Second** - Never guess at bottlenecks
2. **80/20 Rule** - 20% of code causes 80% of performance issues
3. **Premature Optimization is Evil** - Make it work, make it right, then make it fast
4. **Profile, Don't Assume** - Surprises await; your intuition is often wrong
5. **Set Performance Budgets** - Define acceptable limits before optimizing

## Priority and Conflict Rules

- **Scope**: Solving existing performance problems through measurement
- **Separate from**: Architecture discussions (use `backend-patterns` skill)
- **Defers to**: `systematic-debugging` when bugs are present
- Always measure before optimizing -- evidence over intuition

## Gotchas

- Do not optimize before establishing a baseline and identifying the actual bottleneck.
- Do not turn a design discussion into a performance project without measurements.
- Do not apply `useMemo`, caching, indexes, or queueing as default fixes without profiling evidence.
- Do not celebrate benchmark-only wins that make correctness, operability, or complexity worse.
- Do not measure on toy inputs when the complaint is production-scale latency or throughput.

## Performance Measurement

Establish baselines and use profiling tools to identify real bottlenecks before making changes. Covers Web Vitals targets (FCP, LCP, FID, CLS, TTFB), backend metrics (API response time, query time, throughput), and monitoring with `performance.now()` instrumentation.

See [reference/profiling-techniques.md](reference/profiling-techniques.md) for baseline targets, profiling tool lists (frontend, backend, system), and a full monitoring/alerting code example.

## Frontend Performance

Five key optimization areas: reduce bundle size with tree-shaking and code splitting, optimize images with responsive formats and lazy loading, lazy load routes and components, memoize expensive computations with `useMemo`/`useCallback`/`memo`, and virtualize long lists with `react-window`.

See [reference/optimization-patterns.md](reference/optimization-patterns.md) for all 5 frontend patterns with complete before/after code examples.

## Backend Performance

Five key optimization areas: eliminate N+1 queries with joins and indexes, implement caching strategies (in-memory, Redis, HTTP headers), use connection pooling instead of per-query connections, add cursor-based or offset pagination, and offload heavy work to async job queues with BullMQ.

See [reference/optimization-patterns.md](reference/optimization-patterns.md) for all 5 backend patterns with complete before/after code examples.

## Algorithm Optimization

Choose the right data structure (Set for O(1) lookups, proper Queue implementations) and reduce computational complexity (O(n^2) to O(n) with hash-based approaches).

See [reference/optimization-patterns.md](reference/optimization-patterns.md) for data structure and complexity reduction examples.

## Performance Checklist

```
Frontend:
- [ ] Bundle size < 200KB (gzipped)
- [ ] Images optimized (WebP/AVIF)
- [ ] Lazy loading for below-fold content
- [ ] Code splitting for routes
- [ ] Long lists virtualized
- [ ] Expensive computations memoized
- [ ] HTTP caching headers set
- [ ] Critical CSS inlined

Backend:
- [ ] Database queries indexed
- [ ] N+1 queries eliminated
- [ ] Connection pooling configured
- [ ] Responses paginated
- [ ] Heavy operations queued
- [ ] Response caching implemented
- [ ] Gzip compression enabled
- [ ] CDN for static assets

General:
- [ ] Performance budgets defined
- [ ] Monitoring & alerting configured
- [ ] Regular performance testing in CI
- [ ] Profiling done on realistic data
```

## Resources

- [Web Vitals](https://web.dev/vitals/)
- [High Performance Browser Networking](https://hpbn.co/)
- [Database Indexing Explained](https://use-the-index-luke.com/)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)

---

**Remember**: Fast software delights users. Measure, optimize bottlenecks, and monitor continuously.
