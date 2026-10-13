import type {
  ReviewFinding,
  ReviewFindingDiagnostic,
  ReviewFindingSet,
} from "./types";

const REVIEW_SEVERITIES: ReviewFinding["severity"][] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const FINDING_KINDS: ReviewFinding["kind"][] = ["defect", "improvement"];

export function organizeReviewFindings(
  findings: ReviewFinding[],
): ReviewFindingSet {
  const diagnostics: ReviewFindingDiagnostic[] = [];
  const byKey = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const valid =
      finding.kind === "improvement"
        ? validImprovement(finding, diagnostics)
        : validDefect(finding);
    if (!valid) continue;
    const key = stableFindingKey(valid);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeFindings(existing, valid) : valid);
  }
  const sorted = [...byKey.values()].sort(compareFindings);
  return {
    findings: [
      ...sorted.filter((finding) => finding.kind === "defect"),
      ...sorted.filter((finding) => finding.kind === "improvement"),
    ],
    diagnostics,
  };
}

export function unwrapFindings(parsed: unknown): unknown[] {
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { findings?: unknown }).findings)
  ) {
    return (parsed as { findings: unknown[] }).findings;
  }
  if (Array.isArray(parsed)) return parsed;
  throw new Error("review output must be an array or { findings: [...] }");
}

function validDefect(finding: ReviewFinding): ReviewFinding | undefined {
  const supported =
    finding.line &&
    finding.evidence &&
    finding.failureScenario &&
    (finding.reproductionStep || finding.suggestedVerification);
  return supported
    ? { ...finding, blocking: Boolean(finding.blocking) }
    : undefined;
}

function validImprovement(
  finding: ReviewFinding,
  diagnostics: ReviewFindingDiagnostic[],
): ReviewFinding | undefined {
  const reasons = [
    ...(finding.severity === "critical" || finding.severity === "high"
      ? [`improvement severity cannot be ${finding.severity}`]
      : []),
    ...(finding.evidence ? [] : ["improvement evidence is missing"]),
    ...(finding.recommendation
      ? []
      : ["improvement recommendation is missing"]),
  ];
  // A valid improvement is unpaid design debt: it blocks until fixed.
  if (reasons.length === 0) return { ...finding, blocking: true };
  diagnostics.push({
    file: finding.file,
    ...(finding.line ? { line: finding.line } : {}),
    severity: finding.severity,
    summary: finding.summary,
    reason: reasons.join("; "),
  });
  return undefined;
}

function mergeFindings(a: ReviewFinding, b: ReviewFinding): ReviewFinding {
  return {
    ...a,
    severity: higherSeverity(a.severity, b.severity),
    evidence: mostSpecific(a.evidence, b.evidence),
    recommendation: mostSpecific(a.recommendation, b.recommendation),
    suggestedVerification: mostSpecific(
      a.suggestedVerification,
      b.suggestedVerification,
    ),
    ruleId: mostSpecific(a.ruleId, b.ruleId),
    policySource: mostSpecific(a.policySource, b.policySource),
    blocking: Boolean(a.blocking || b.blocking),
  };
}

function stableFindingKey(finding: ReviewFinding): string {
  return [
    finding.kind,
    finding.file,
    finding.line ?? "",
    finding.category ?? "",
    normalizeKeyText(finding.failureScenario ?? finding.summary),
  ].join("\0");
}

function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  return (
    FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) ||
    REVIEW_SEVERITIES.indexOf(a.severity) -
      REVIEW_SEVERITIES.indexOf(b.severity) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.category ?? "").localeCompare(b.category ?? "")
  );
}

function higherSeverity(
  a: ReviewFinding["severity"],
  b: ReviewFinding["severity"],
): ReviewFinding["severity"] {
  return REVIEW_SEVERITIES.indexOf(a) <= REVIEW_SEVERITIES.indexOf(b) ? a : b;
}

function mostSpecific(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function normalizeKeyText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
