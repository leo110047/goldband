const fs = require('fs');

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function scopedByDays(rows, days) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const recordedAt = Date.parse(row.recordedAt || '');
    return Number.isFinite(recordedAt) && recordedAt >= cutoffMs;
  });
}

function eventRunId(event) {
  return (
    event.run_id || event.runId || event.sessionId || event.session_id || null
  );
}

function increment(map, key, fields) {
  const current = map.get(key) || { ...fields, count: 0 };
  current.count += 1;
  map.set(key, current);
}

function sortedCounts(map, limit) {
  return [...map.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        String(left.name || '').localeCompare(String(right.name || '')),
    )
    .slice(0, limit);
}

function summarizeWorkflowEntries(events, confidence, limit) {
  const counts = new Map();
  for (const event of events) {
    if (
      event.category !== 'workflow-entry' ||
      event.confidence !== confidence
    ) {
      continue;
    }

    const host = event.host || 'unknown';
    const name = event.name || 'unknown';
    const action = event.action || 'unknown';
    increment(counts, `${host}|${name}|${action}`, {
      host,
      name,
      action,
      confidence,
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeUsageCategory(events, category, action, limit) {
  const counts = new Map();
  for (const event of events) {
    if (event.category !== category || event.action !== action) continue;

    const name = event.name || 'unknown';
    const host = event.detail?.host || event.host || 'unknown';
    increment(counts, `${host}|${name}`, { host, name, action });
  }
  return sortedCounts(counts, limit);
}

function summarizeTopEvents(events, limit) {
  const counts = new Map();
  for (const event of events) {
    const category = event.category || 'unknown';
    const name = event.name || 'unknown';
    const action = event.action || 'unknown';
    increment(counts, `${category}|${name}|${action}`, {
      category,
      name,
      action,
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeMetrics(metrics, limit) {
  const blocked = new Map();
  for (const metric of metrics) {
    if (metric.decision !== 'block') continue;

    const name = metric.blockedBy || metric.phase || 'unknown';
    increment(blocked, name, {
      name,
      action: 'deny',
      phase: metric.phase || 'unknown',
    });
  }

  return {
    totalEvents: metrics.length,
    hookDenies: sortedCounts(blocked, limit),
  };
}

function dataWindow(rows) {
  const timestamps = rows
    .map((row) => Date.parse(row.recordedAt || ''))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return { firstRecordedAt: null, lastRecordedAt: null };
  }

  return {
    firstRecordedAt: new Date(timestamps[0]).toISOString(),
    lastRecordedAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

function summarizeEvents(options, paths, rows) {
  const events = scopedByDays(rows.usageEvents, options.days);
  const metrics = scopedByDays(rows.metrics, options.days);
  const sessions = new Set(events.map(eventRunId).filter(Boolean));

  return {
    generatedAt: new Date().toISOString(),
    days: options.days,
    paths,
    dataWindow: dataWindow([...events, ...metrics]),
    usage: {
      totalEvents: events.length,
      uniqueSessions: sessions.size,
      topEvents: summarizeTopEvents(events, options.limit),
    },
    workflowEntries: {
      confirmed: summarizeWorkflowEntries(events, 'confirmed', options.limit),
      inferred: summarizeWorkflowEntries(events, 'inferred', options.limit),
    },
    hooks: {
      denies: summarizeUsageCategory(
        events,
        'hook-decision',
        'deny',
        options.limit,
      ),
      advisories: summarizeUsageCategory(
        events,
        'hook-advisory',
        'emit',
        options.limit,
      ),
    },
    metrics: summarizeMetrics(metrics, options.limit),
  };
}

function queryUsageTelemetry(events, options) {
  const filtered = filterUsageEvents(
    scopedByDays(events, options.days),
    options,
  );
  const counts =
    options.groupBy === 'skill'
      ? countSkillEvents(filtered)
      : countRuleEvents(filtered);
  return {
    generatedAt: new Date().toISOString(),
    days: options.days,
    eventType: options.eventType,
    groupBy: options.groupBy,
    totalEvents: filtered.length,
    results: sortedCounts(counts, options.limit).map(({ name, count }) => ({
      name,
      count,
    })),
  };
}

function filterUsageEvents(events, options) {
  if (options.eventType === 'all') return events;
  return events.filter((event) => event.category === options.eventType);
}

function countRuleEvents(events) {
  const counts = new Map();
  for (const event of events) {
    if (event.category !== 'hook-decision') continue;
    increment(counts, event.name || 'unknown', {
      name: event.name || 'unknown',
    });
  }
  return counts;
}

function countSkillEvents(events) {
  const counts = new Map();
  for (const event of events) {
    if (!isSkillEvent(event)) continue;
    increment(counts, event.name || 'unknown', {
      name: event.name || 'unknown',
    });
  }
  return counts;
}

function isSkillEvent(event) {
  return (
    event.category === 'workflow-entry' || event.category === 'prompt-trigger'
  );
}

module.exports = {
  dataWindow,
  loadJsonl,
  queryUsageTelemetry,
  sortedCounts,
  summarizeEvents,
  summarizeWorkflowEntries,
};
