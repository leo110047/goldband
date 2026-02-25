# Deployment Strategies Reference

Detailed implementation guides for blue-green, canary, and rolling update deployment strategies.

## Blue-Green Deployment

### Architecture

```
                    ┌─────────────┐
                    │   Router /  │
                    │   Load      │
                    │   Balancer  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        ┌─────┴─────┐            ┌─────┴─────┐
        │   BLUE    │            │   GREEN   │
        │  (active) │            │ (standby) │
        │   v1.0    │            │   v1.1    │
        │           │            │           │
        │ ┌───────┐ │            │ ┌───────┐ │
        │ │App x3 │ │            │ │App x3 │ │
        │ └───────┘ │            │ └───────┘ │
        └───────────┘            └───────────┘
              │                         │
              └────────────┬────────────┘
                           │
                    ┌──────┴──────┐
                    │  Shared DB  │
                    └─────────────┘
```

### Implementation Steps

**Step 1: Deploy to inactive environment**

```bash
#!/bin/bash
# deploy-blue-green.sh

# Determine which environment is active
ACTIVE=$(aws elbv2 describe-listeners \
  --listener-arn "$LISTENER_ARN" \
  --query 'Listeners[0].DefaultActions[0].TargetGroupArn' \
  --output text)

if [ "$ACTIVE" = "$BLUE_TG_ARN" ]; then
  DEPLOY_TO="green"
  DEPLOY_TG="$GREEN_TG_ARN"
  DEPLOY_ASG="$GREEN_ASG"
else
  DEPLOY_TO="blue"
  DEPLOY_TG="$BLUE_TG_ARN"
  DEPLOY_ASG="$BLUE_ASG"
fi

echo "Active: $([ "$ACTIVE" = "$BLUE_TG_ARN" ] && echo 'blue' || echo 'green')"
echo "Deploying to: $DEPLOY_TO"

# Deploy new version to inactive environment
aws ecs update-service \
  --cluster production \
  --service "myapp-$DEPLOY_TO" \
  --task-definition "myapp:$NEW_VERSION" \
  --force-new-deployment

# Wait for deployment to stabilize
aws ecs wait services-stable \
  --cluster production \
  --services "myapp-$DEPLOY_TO"

echo "Deployment to $DEPLOY_TO complete. Ready for traffic swap."
```

**Step 2: Run smoke tests against inactive environment**

```bash
# Test the inactive environment directly (bypass load balancer)
INACTIVE_URL="https://${DEPLOY_TO}.internal.example.com"

# Health check
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$INACTIVE_URL/health")
if [ "$HTTP_STATUS" != "200" ]; then
  echo "Health check failed with status $HTTP_STATUS"
  exit 1
fi

# Smoke tests
npm run test:smoke -- --base-url="$INACTIVE_URL"
```

**Step 3: Swap traffic**

```bash
# Swap the load balancer to point to the new environment
aws elbv2 modify-listener \
  --listener-arn "$LISTENER_ARN" \
  --default-actions "Type=forward,TargetGroupArn=$DEPLOY_TG"

echo "Traffic swapped to $DEPLOY_TO"
```

**Step 4: Rollback (if needed)**

```bash
# Instant rollback: swap traffic back to the old environment
aws elbv2 modify-listener \
  --listener-arn "$LISTENER_ARN" \
  --default-actions "Type=forward,TargetGroupArn=$ACTIVE"

echo "Rolled back to previous environment"
```

### Blue-Green with GitHub Actions

```yaml
# .github/workflows/deploy-blue-green.yml
name: Blue-Green Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Build and push image
        run: |
          docker build -t $ECR_REPO:${{ github.sha }} .
          docker push $ECR_REPO:${{ github.sha }}

      - name: Deploy to inactive environment
        run: ./scripts/deploy-blue-green.sh deploy
        env:
          NEW_VERSION: ${{ github.sha }}

      - name: Run smoke tests
        run: ./scripts/deploy-blue-green.sh smoke-test

      - name: Swap traffic
        run: ./scripts/deploy-blue-green.sh swap

      - name: Verify production
        run: |
          sleep 10
          HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://api.example.com/health")
          if [ "$HTTP_STATUS" != "200" ]; then
            echo "Production health check failed! Rolling back..."
            ./scripts/deploy-blue-green.sh rollback
            exit 1
          fi
```

### Considerations

- **Cost:** Requires 2x the infrastructure (both environments running simultaneously)
- **Database:** Both environments share the same database; migrations must be backward-compatible
- **Session state:** If using sticky sessions, swapping environments will invalidate them; use external session storage (Redis)
- **DNS TTL:** If using DNS-based routing instead of load balancer swap, account for DNS propagation delay

---

## Canary Deployment

### Architecture

```
                    ┌─────────────┐
                    │   Service   │
                    │    Mesh /   │
                    │   Ingress   │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │ 95%                  5% │
        ┌─────┴─────┐            ┌─────┴─────┐
        │  STABLE   │            │  CANARY   │
        │   v1.0    │            │   v1.1    │
        │   x10     │            │   x1      │
        └───────────┘            └───────────┘
```

### Traffic Splitting

**Using Kubernetes and Istio:**

```yaml
# VirtualService for traffic splitting
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp.example.com
  http:
    - route:
        - destination:
            host: myapp-stable
            port:
              number: 80
          weight: 95
        - destination:
            host: myapp-canary
            port:
              number: 80
          weight: 5
```

**Using AWS ALB with weighted target groups:**

```bash
# Set canary weight to 5%
aws elbv2 modify-listener \
  --listener-arn "$LISTENER_ARN" \
  --default-actions '[
    {
      "Type": "forward",
      "ForwardConfig": {
        "TargetGroups": [
          { "TargetGroupArn": "'$STABLE_TG'", "Weight": 95 },
          { "TargetGroupArn": "'$CANARY_TG'", "Weight": 5 }
        ]
      }
    }
  ]'
```

### Metrics to Monitor During Canary

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error rate (5xx) | > 1% higher than stable | Auto-rollback |
| Latency (p99) | > 200ms higher than stable | Auto-rollback |
| CPU usage | > 80% | Investigate before proceeding |
| Memory usage | > 80% | Investigate before proceeding |
| Custom business metrics | Application-specific | Manual review |

### Progressive Rollout Script

```bash
#!/bin/bash
# canary-rollout.sh

CANARY_WEIGHTS=(5 10 25 50 75 100)
OBSERVATION_PERIOD=300  # 5 minutes between each step

for WEIGHT in "${CANARY_WEIGHTS[@]}"; do
  STABLE_WEIGHT=$((100 - WEIGHT))

  echo "Setting canary weight to ${WEIGHT}%..."
  set_traffic_weight "$STABLE_WEIGHT" "$WEIGHT"

  echo "Observing for ${OBSERVATION_PERIOD} seconds..."
  sleep "$OBSERVATION_PERIOD"

  # Check canary health
  ERROR_RATE=$(get_canary_error_rate)
  LATENCY_P99=$(get_canary_latency_p99)

  if (( $(echo "$ERROR_RATE > 1.0" | bc -l) )); then
    echo "Error rate too high (${ERROR_RATE}%). Rolling back!"
    set_traffic_weight 100 0
    exit 1
  fi

  if (( $(echo "$LATENCY_P99 > 500" | bc -l) )); then
    echo "Latency too high (${LATENCY_P99}ms). Rolling back!"
    set_traffic_weight 100 0
    exit 1
  fi

  echo "Canary healthy at ${WEIGHT}%. Proceeding..."
done

echo "Canary rollout complete. 100% traffic on new version."
```

### Auto-Rollback with Prometheus/Grafana

```yaml
# Prometheus alerting rule for canary auto-rollback
groups:
  - name: canary-rollback
    rules:
      - alert: CanaryHighErrorRate
        expr: |
          (
            sum(rate(http_requests_total{deployment="canary", status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{deployment="canary"}[5m]))
          ) > 0.01
        for: 2m
        labels:
          severity: critical
          action: auto-rollback
        annotations:
          summary: "Canary error rate exceeds 1% for 2 minutes"

      - alert: CanaryHighLatency
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket{deployment="canary"}[5m])) by (le)
          ) > 0.5
        for: 2m
        labels:
          severity: critical
          action: auto-rollback
        annotations:
          summary: "Canary p99 latency exceeds 500ms for 2 minutes"
```

---

## Rolling Updates

### Kubernetes Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1    # At most 1 pod down at a time
      maxSurge: 2          # Up to 2 extra pods during rollout
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:v1.1
          ports:
            - containerPort: 8080

          # Readiness probe: must pass before receiving traffic
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3

          # Liveness probe: restart if unhealthy
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3

          # Startup probe: allow slow startup without being killed
          startupProbe:
            httpGet:
              path: /health/live
              port: 8080
            failureThreshold: 30
            periodSeconds: 10

      # Graceful shutdown
      terminationGracePeriodSeconds: 30
```

### Health Check Endpoints

```typescript
// Express.js health check endpoints
app.get('/health/live', (req, res) => {
  // Liveness: is the process running and not deadlocked?
  res.status(200).json({ status: 'alive' });
});

app.get('/health/ready', async (req, res) => {
  // Readiness: can this instance handle traffic?
  try {
    // Check database connection
    await db.query('SELECT 1');
    // Check cache connection
    await redis.ping();
    // Check external dependencies
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      reason: error.message,
    });
  }
});
```

### Graceful Shutdown

```typescript
// Handle SIGTERM for graceful shutdown during rolling update
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Starting graceful shutdown...');

  // Stop accepting new requests
  server.close(async () => {
    console.log('HTTP server closed');

    // Wait for in-flight requests to complete (with timeout)
    await Promise.race([
      waitForInflightRequests(),
      new Promise(resolve => setTimeout(resolve, 25000)), // 25s timeout
    ]);

    // Close database connections
    await db.end();
    await redis.quit();

    console.log('Graceful shutdown complete');
    process.exit(0);
  });
});
```

### Rolling Update Sequence

```
Initial state: 6 pods running v1.0
Target: 6 pods running v1.1
maxUnavailable: 1, maxSurge: 2

Step 1: Start 2 new v1.1 pods (surge)
  v1.0: [1] [2] [3] [4] [5] [6]
  v1.1: [A] [B]                    (starting, not ready)

Step 2: v1.1 pods pass readiness check
  v1.0: [1] [2] [3] [4] [5] [6]
  v1.1: [A] [B]                    (ready, receiving traffic)

Step 3: Terminate 1 v1.0 pod
  v1.0: [1] [2] [3] [4] [5]
  v1.1: [A] [B]

Step 4: Start 1 new v1.1 pod
  v1.0: [1] [2] [3] [4] [5]
  v1.1: [A] [B] [C]

... continues until all pods are v1.1

Final: 6 pods running v1.1
  v1.1: [A] [B] [C] [D] [E] [F]
```

---

## Feature Flags Integration

Feature flags are complementary to deployment strategies. Deploy code that is dormant, then activate features independently of deployments.

### Basic Feature Flag Implementation

```typescript
interface FeatureFlags {
  [key: string]: {
    enabled: boolean;
    rollout_percentage?: number;
    allowed_users?: string[];
  };
}

class FeatureFlagService {
  constructor(private flags: FeatureFlags) {}

  isEnabled(flagName: string, userId?: string): boolean {
    const flag = this.flags[flagName];
    if (!flag) return false;
    if (!flag.enabled) return false;

    // Check user allowlist
    if (flag.allowed_users && userId) {
      if (flag.allowed_users.includes(userId)) return true;
    }

    // Check percentage rollout
    if (flag.rollout_percentage !== undefined && userId) {
      const hash = this.hashUserId(userId);
      return hash < flag.rollout_percentage;
    }

    return flag.enabled;
  }

  private hashUserId(userId: string): number {
    // Simple hash to get a number between 0-100
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) % 100;
    }
    return hash;
  }
}

// Usage
const flags = new FeatureFlagService(await loadFlags());

app.get('/api/dashboard', (req, res) => {
  const data = getDashboardData();

  if (flags.isEnabled('new-dashboard-widget', req.user.id)) {
    data.widgets.push(getNewWidget());
  }

  res.json(data);
});
```

### Feature Flag + Canary Deployment

```
Deploy sequence:
1. Deploy code with feature flag OFF to all instances
2. Enable feature flag for internal users (dogfooding)
3. Enable feature flag for 5% of users (canary)
4. Monitor metrics for 24 hours
5. Increase to 25%, 50%, 100%
6. Remove feature flag code in next release (cleanup)
```

---

## Zero-Downtime Deployment Checklist

Before every production deployment:

- [ ] **Database migrations are backward-compatible** with the currently running version
- [ ] **Health check endpoint** responds correctly on the new version
- [ ] **Graceful shutdown** handles SIGTERM and drains in-flight requests
- [ ] **Smoke tests** pass against the new version before traffic is routed
- [ ] **Rollback plan** is documented and tested
- [ ] **Monitoring dashboards** are open and alerts are configured
- [ ] **Communication** to the team: deployment is starting
- [ ] **Feature flags** are in correct state (off for unreleased features)

After deployment:

- [ ] **Verify** health checks are passing on all instances
- [ ] **Check** error rate and latency dashboards for 15 minutes
- [ ] **Run** production smoke tests
- [ ] **Confirm** no customer-reported issues
- [ ] **Update** deployment log with version, time, and any notes
