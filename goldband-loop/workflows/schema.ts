import type {
  QaCheck,
  QaCheckResult,
  ReviewFinding,
  ReviewFindingDiagnostic,
  ReviewFindingSet,
  SchemaValidator,
} from './types';

const severities = new Set(['critical', 'high', 'medium', 'low', 'info']);
const findingKinds = new Set(['defect', 'improvement']);

export const objectSchema: SchemaValidator<Record<string, unknown>> = {
  name: 'object',
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected object output');
    }
    return value as Record<string, unknown>;
  },
};

export const textSchema: SchemaValidator<string> = {
  name: 'text',
  validate(value) {
    if (typeof value !== 'string') throw new Error('expected string output');
    return value;
  },
};

export const findingsSchema: SchemaValidator<ReviewFinding[]> = {
  name: 'review-findings',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('expected findings array');
    return value.map(validateFinding);
  },
};

export const reviewFindingSetSchema: SchemaValidator<ReviewFindingSet> = {
  name: 'review-finding-set',
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected review finding set object');
    }
    const item = value as Record<string, unknown>;
    if (!Array.isArray(item.diagnostics)) throw new Error('expected finding diagnostics array');
    return {
      findings: findingsSchema.validate(item.findings),
      diagnostics: item.diagnostics.map(validateFindingDiagnostic),
    };
  },
};

export const qaChecksSchema: SchemaValidator<QaCheck[]> = {
  name: 'qa-checks',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('expected qa checks array');
    return value.map(validateQaCheck);
  },
};

export const qaCheckResultsSchema: SchemaValidator<QaCheckResult[]> = {
  name: 'qa-check-results',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('expected qa check results array');
    return value.map(validateQaCheckResult);
  },
};

function validateFinding(value: unknown): ReviewFinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('finding must be an object');
  }
  const item = value as Record<string, unknown>;
  const kind = requiredString(item.kind, 'kind');
  if (!findingKinds.has(kind)) throw new Error(`invalid finding kind: ${kind}`);
  const file = requiredString(item.file, 'file');
  const severity = requiredSeverity(item.severity);
  const summary = requiredString(item.summary, 'summary');
  return {
    id: optionalString(item.id),
    kind: kind as ReviewFinding['kind'],
    file,
    line: optionalLine(item.line),
    severity,
    summary,
    evidence: optionalString(item.evidence),
    recommendation: optionalString(item.recommendation),
    category: optionalString(item.category ?? item.rule),
    ruleId: optionalString(item.ruleId),
    policySource: optionalString(item.policySource),
    failureScenario: optionalString(item.failureScenario),
    suggestedVerification: optionalString(item.suggestedVerification),
    blocking: optionalBoolean(item.blocking),
    reproductionStep: optionalString(item.reproductionStep),
  };
}

function validateFindingDiagnostic(value: unknown): ReviewFindingDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('finding diagnostic must be an object');
  }
  const item = value as Record<string, unknown>;
  return {
    file: requiredString(item.file, 'file', 'finding diagnostic'),
    line: optionalLine(item.line),
    severity: requiredSeverity(item.severity),
    summary: requiredString(item.summary, 'summary', 'finding diagnostic'),
    reason: requiredString(item.reason, 'reason', 'finding diagnostic'),
  };
}

function requiredSeverity(value: unknown): ReviewFinding['severity'] {
  const severity = requiredString(value, 'severity');
  if (!severities.has(severity)) throw new Error(`invalid severity: ${severity}`);
  return severity as ReviewFinding['severity'];
}

function validateQaCheck(value: unknown): QaCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('qa check must be an object');
  }
  const item = value as Record<string, unknown>;
  return {
    id: requiredString(item.id, 'id', 'qa check'),
    label: requiredString(item.label, 'label', 'qa check'),
  };
}

function validateQaCheckResult(value: unknown): QaCheckResult {
  const check = validateQaCheck(value);
  const status = (value as Record<string, unknown>).status;
  if (status !== 'pass' && status !== 'fail') {
    throw new Error('qa check status must be pass or fail');
  }
  return {
    ...check,
    status,
    evidence: requiredString((value as Record<string, unknown>).evidence, 'evidence', 'qa check'),
  };
}

function requiredString(value: unknown, field: string, scope = 'finding'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${scope}.${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('optional field must be string');
  return value.trim() || undefined;
}

function optionalLine(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('finding.line must be a positive integer');
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error('optional field must be boolean');
  return value;
}
