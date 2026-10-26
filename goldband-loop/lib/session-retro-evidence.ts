/**
 * Provider-neutral contract for `context/retro` evidence.
 *
 * Host adapters turn one session snapshot into `RetroToolEventV1` values in
 * memory. Only `RetroReportV1` is persisted, and it holds numbers, tool names,
 * input hashes, exit codes, and event positions. Validation rejects unknown
 * keys so that prompt text, tool output, stderr, and file content cannot be
 * persisted through an extra field.
 */

const RETRO_HOSTS = ["claude", "codex"] as const;
export const RETRO_FACETS = [
	"file-search",
	"auto-checks",
	"tool-cost",
	"info-access",
	"ineffective-instructions",
] as const;
const RETRO_EVIDENCE_GRADES = ["measured", "inferred"] as const;
const RETRO_METRIC_UNITS = ["count", "bytes", "tokens"] as const;
const RETRO_UNAVAILABLE_REASONS = [
	"not-implemented",
	"host-unsupported",
] as const;
const RETRO_TOOL_CATEGORIES = [
	"search",
	"read",
	"list",
	"edit",
	"command",
	"mcp",
	"other",
] as const;
const RETRO_BLOCKERS = ["hook", "permission"] as const;

export type RetroHost = (typeof RETRO_HOSTS)[number];
export type RetroFacet = (typeof RETRO_FACETS)[number];
type RetroEvidenceGrade = (typeof RETRO_EVIDENCE_GRADES)[number];
type RetroMetricUnit = (typeof RETRO_METRIC_UNITS)[number];
type RetroUnavailableReason = (typeof RETRO_UNAVAILABLE_REASONS)[number];
export type RetroToolCategory = (typeof RETRO_TOOL_CATEGORIES)[number];

/** Identity of the byte range an analysis reads. The record path stays in memory. */
export type RetroSnapshotRefV1 = {
	host: RetroHost;
	sessionId: string;
	byteLength: number;
	recordCount: number;
	sha256: string;
};

/**
 * One tool call as an adapter reports it. Optional fields are absent when the
 * host does not record them; adapters never default them.
 */
export type RetroToolEventV1 = {
	/** The call's record; refs cite it. */
	ordinal: number;
	/** The result's record, at or after the call; calls issued together finish in any order. */
	resultOrdinal: number;
	tool: string;
	category: RetroToolCategory;
	inputSha256: string;
	outputBytes: number;
	failed: boolean;
	exitCode?: number;
	blockedBy?: (typeof RETRO_BLOCKERS)[number];
	truncated?: boolean;
	emptyResult?: boolean;
};

/** Session token totals from model usage records, absent when the host has none. */
export type RetroUsageTotalsV1 = {
	firstOrdinal: number;
	lastOrdinal: number;
	inputTokens: number;
	outputTokens: number;
};

export type RetroEvidenceV1 = {
	facet: RetroFacet;
	grade: RetroEvidenceGrade;
	rule: string;
	refs: string[];
	metric?: { value: number; unit: RetroMetricUnit };
	tool?: string;
	inputSha256?: string;
	exitCode?: number;
};

export type RetroFacetStatusV1 =
	| { status: "covered" }
	| { status: "unavailable"; reason: RetroUnavailableReason };

export type RetroReportV1 = {
	schemaVersion: 1;
	snapshots: RetroSnapshotRefV1[];
	facets: Record<RetroFacet, RetroFacetStatusV1>;
	evidence: RetroEvidenceV1[];
};

export const RETRO_SHA256_RE = /^[0-9a-f]{64}$/;
export const RETRO_SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const RETRO_RULE_RE = /^[a-z][a-z0-9-]{1,63}$/;
const TOOL_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const REF_RE = /^([A-Za-z0-9-]{8,64})@([0-9a-f]{64})#(0|[1-9][0-9]*)$/;

export function retroSnapshotKey(
	snapshot: Pick<RetroSnapshotRefV1, "sessionId" | "sha256">,
): string {
	return `${snapshot.sessionId}@${snapshot.sha256}`;
}

export function formatRetroRef(
	snapshot: RetroSnapshotRefV1,
	ordinal: number,
): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
		throw new Error(`invalid event ordinal: ${ordinal}`);
	}
	return `${snapshot.sessionId}@${snapshot.sha256}#${ordinal}`;
}

export function validateRetroToolEvent(value: unknown): RetroToolEventV1 {
	const event = record(value, "tool event");
	onlyKeys(event, "tool event", [
		"ordinal",
		"resultOrdinal",
		"tool",
		"category",
		"inputSha256",
		"outputBytes",
		"failed",
		"exitCode",
		"blockedBy",
		"truncated",
		"emptyResult",
	]);
	count(event.ordinal, "tool event ordinal");
	count(event.resultOrdinal, "tool event resultOrdinal");
	if ((event.resultOrdinal as number) < (event.ordinal as number))
		throw new Error("tool event resultOrdinal must not precede its ordinal");
	pattern(event.tool, TOOL_RE, "tool event tool");
	member(event.category, RETRO_TOOL_CATEGORIES, "tool event category");
	pattern(event.inputSha256, RETRO_SHA256_RE, "tool event inputSha256");
	count(event.outputBytes, "tool event outputBytes");
	if (typeof event.failed !== "boolean")
		throw new Error("tool event failed must be a boolean");
	if (event.exitCode !== undefined)
		integer(event.exitCode, "tool event exitCode");
	if (event.blockedBy !== undefined)
		member(event.blockedBy, RETRO_BLOCKERS, "tool event blockedBy");
	for (const flag of ["truncated", "emptyResult"]) {
		if (event[flag] !== undefined && typeof event[flag] !== "boolean") {
			throw new Error(`tool event ${flag} must be a boolean`);
		}
	}
	return event as RetroToolEventV1;
}

export function validateRetroReport(value: unknown): RetroReportV1 {
	const report = record(value, "report");
	onlyKeys(report, "report", [
		"schemaVersion",
		"snapshots",
		"facets",
		"evidence",
	]);
	if (report.schemaVersion !== 1)
		throw new Error("report schemaVersion must be 1");

	if (!Array.isArray(report.snapshots) || report.snapshots.length === 0) {
		throw new Error("report snapshots must be a non-empty array");
	}
	const snapshots = retroSnapshotRecords(
		report.snapshots.map(validateSnapshot),
	);

	const facets = record(report.facets, "report facets");
	onlyKeys(facets, "report facets", RETRO_FACETS);
	for (const facet of RETRO_FACETS) validateFacetStatus(facets[facet], facet);

	if (!Array.isArray(report.evidence))
		throw new Error("report evidence must be an array");
	for (const item of report.evidence) {
		const evidence = validateRetroEvidence(item);
		if ((facets[evidence.facet] as RetroFacetStatusV1).status !== "covered") {
			throw new Error(`evidence for unavailable facet: ${evidence.facet}`);
		}
		validateRetroRefs(evidence.refs, snapshots);
	}
	return report as RetroReportV1;
}

/** Record count by `<session id>@<sha256>` snapshot key. */
export function retroSnapshotRecords(
	snapshots: RetroSnapshotRefV1[],
): Map<string, number> {
	return new Map(
		snapshots.map((snapshot) => [
			retroSnapshotKey(snapshot),
			snapshot.recordCount,
		]),
	);
}

/** Rejects refs that do not cite a record inside one of the given snapshots. */
export function validateRetroRefs(
	refs: unknown,
	snapshots: Map<string, number>,
): void {
	if (!Array.isArray(refs) || refs.length === 0) {
		throw new Error("evidence refs must be a non-empty array");
	}
	for (const ref of refs) {
		const match = typeof ref === "string" ? REF_RE.exec(ref) : null;
		const records = match
			? snapshots.get(`${match[1]}@${match[2]}`)
			: undefined;
		if (records === undefined || Number(match?.[3]) >= records) {
			throw new Error(
				`evidence ref does not cite a report snapshot record: ${ref}`,
			);
		}
	}
}

function validateSnapshot(value: unknown): RetroSnapshotRefV1 {
	const snapshot = record(value, "snapshot");
	onlyKeys(snapshot, "snapshot", [
		"host",
		"sessionId",
		"byteLength",
		"recordCount",
		"sha256",
	]);
	member(snapshot.host, RETRO_HOSTS, "snapshot host");
	pattern(snapshot.sessionId, RETRO_SESSION_ID_RE, "snapshot sessionId");
	count(snapshot.byteLength, "snapshot byteLength");
	count(snapshot.recordCount, "snapshot recordCount");
	pattern(snapshot.sha256, RETRO_SHA256_RE, "snapshot sha256");
	return snapshot as RetroSnapshotRefV1;
}

function validateFacetStatus(value: unknown, facet: RetroFacet): void {
	const status = record(value, `facet ${facet}`);
	if (status.status === "covered") {
		onlyKeys(status, `facet ${facet}`, ["status"]);
		return;
	}
	if (status.status !== "unavailable") {
		throw new Error(`facet ${facet} status must be covered or unavailable`);
	}
	onlyKeys(status, `facet ${facet}`, ["status", "reason"]);
	member(status.reason, RETRO_UNAVAILABLE_REASONS, `facet ${facet} reason`);
}

export function validateRetroEvidence(value: unknown): RetroEvidenceV1 {
	const evidence = record(value, "evidence");
	onlyKeys(evidence, "evidence", [
		"facet",
		"grade",
		"rule",
		"refs",
		"metric",
		"tool",
		"inputSha256",
		"exitCode",
	]);
	member(evidence.facet, RETRO_FACETS, "evidence facet");
	member(evidence.grade, RETRO_EVIDENCE_GRADES, "evidence grade");
	pattern(evidence.rule, RETRO_RULE_RE, "evidence rule");
	if (!Array.isArray(evidence.refs) || evidence.refs.length === 0) {
		throw new Error("evidence refs must be a non-empty array");
	}
	if (evidence.metric !== undefined) {
		const metric = record(evidence.metric, "evidence metric");
		onlyKeys(metric, "evidence metric", ["value", "unit"]);
		if (
			typeof metric.value !== "number" ||
			!Number.isFinite(metric.value) ||
			metric.value < 0
		) {
			throw new Error(
				"evidence metric value must be a finite non-negative number",
			);
		}
		member(metric.unit, RETRO_METRIC_UNITS, "evidence metric unit");
	}
	if (evidence.tool !== undefined)
		pattern(evidence.tool, TOOL_RE, "evidence tool");
	if (evidence.inputSha256 !== undefined)
		pattern(evidence.inputSha256, RETRO_SHA256_RE, "evidence inputSha256");
	if (evidence.exitCode !== undefined)
		integer(evidence.exitCode, "evidence exitCode");
	return evidence as RetroEvidenceV1;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function onlyKeys(
	value: Record<string, unknown>,
	label: string,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key))
			throw new Error(`${label} has unsupported field: ${key}`);
	}
}

function member<T extends string>(
	value: unknown,
	allowed: readonly T[],
	label: string,
): void {
	if (
		typeof value !== "string" ||
		!(allowed as readonly string[]).includes(value)
	) {
		throw new Error(`invalid ${label}: ${String(value)}`);
	}
}

function pattern(value: unknown, re: RegExp, label: string): void {
	if (typeof value !== "string" || !re.test(value))
		throw new Error(`invalid ${label}`);
}

function count(value: unknown, label: string): void {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`${label} must be a non-negative integer`);
	}
}

function integer(value: unknown, label: string): void {
	if (!Number.isSafeInteger(value))
		throw new Error(`${label} must be an integer`);
}
