import type {
  QaCheck,
  QaCheckResult,
  ReviewFinding,
  SchemaValidator,
} from './types';

const severities = new Set(['critical', 'high', 'medium', 'low', 'info']);

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

export function normalizeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const out: ReviewFinding[] = [];
  for (const finding of findings) {
    const key = [
      finding.file,
      finding.line ?? '',
      finding.severity,
      finding.summary,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function validateFinding(value: unknown): ReviewFinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('finding must be an object');
  }
  const item = value as Record<string, unknown>;
  const file = requiredString(item.file, 'file');
  const severity = requiredString(item.severity, 'severity');
  if (!severities.has(severity)) throw new Error(`invalid severity: ${severity}`);
  const summary = requiredString(item.summary, 'summary');
  return {
    id: optionalString(item.id),
    file,
    line: optionalLine(item.line),
    severity: severity as ReviewFinding['severity'],
    summary,
    evidence: optionalString(item.evidence),
    recommendation: optionalString(item.recommendation),
    category: optionalString(item.category ?? item.rule),
    ruleId: optionalString(item.ruleId),
    policySource: optionalString(item.policySource),
    failureScenario: optionalString(item.failureScenario),
    suggestedVerification: optionalString(item.suggestedVerification),
    blocking: optionalBoolean(item.blocking),
    specialist: optionalString(item.specialist),
    contributingSpecialists: optionalStringArray(item.contributingSpecialists),
    reproductionStep: optionalString(item.reproductionStep),
  };
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

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('optional field must be string array');
  const strings = value.map((item) => {
    if (typeof item !== 'string') throw new Error('optional field must be string array');
    return item.trim();
  }).filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}
