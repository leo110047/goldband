# Performance Measurement & Monitoring

## Establish Baselines

```bash
# Web Vitals (Frontend)
- FCP (First Contentful Paint): < 1.8s
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1
- TTFB (Time to First Byte): < 600ms

# Backend
- API Response Time: < 200ms (p95)
- Database Query Time: < 50ms (p95)
- Throughput: requests per second
- Error Rate: < 0.1%
```

## Profiling Tools

```bash
# Frontend
- Chrome DevTools Performance tab
- Lighthouse CI
- WebPageTest
- webpack-bundle-analyzer

# Backend
- Node.js: node --prof, clinic.js
- Python: cProfile, py-spy
- Database: EXPLAIN ANALYZE, slow query logs
- APM: New Relic, Datadog, Sentry Performance

# System
- top, htop (CPU/Memory)
- iostat (Disk I/O)
- netstat, iftop (Network)
```

## Monitoring & Alerting

### Add Performance Metrics

```typescript
import { performance } from 'perf_hooks';

async function processOrder(order) {
  const startTime = performance.now();

  try {
    const result = await expensiveProcessing(order);

    const duration = performance.now() - startTime;

    // Log slow operations
    if (duration > 1000) {
      logger.warn('Slow order processing', {
        orderId: order.id,
        duration
      });
    }

    // Send metrics to monitoring service
    metrics.histogram('order_processing_time', duration, {
      status: 'success'
    });

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    metrics.histogram('order_processing_time', duration, {
      status: 'error'
    });
    throw error;
  }
}
```
