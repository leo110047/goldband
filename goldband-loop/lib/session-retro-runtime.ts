import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
	createKnowledgeEntry,
	currentCanonicalRemote,
	currentProjectSlug,
	detectSecretLikeContent,
	knowledgeRoot,
	writeKnowledgeCandidate,
} from "./knowledge";
import { writePrivateText } from "./managed-worktree-contract";
import { analyzeRetroSession } from "./session-retro-analysis";
import {
	listClaudeSessions,
	locateClaudeSession,
	readClaudeSession,
} from "./session-retro-claude";
import {
	RETRO_RULE_RE,
	RETRO_SESSION_ID_RE,
	RETRO_SHA256_RE,
	type RetroEvidenceV1,
	type RetroFacet,
	type RetroReportV1,
	retroSnapshotKey,
	retroSnapshotRecords,
	validateRetroEvidence,
	validateRetroRefs,
	validateRetroReport,
} from "./session-retro-evidence";
import { stableJson } from "./stable-json";

/**
 * `session-retro-evidence` owner: snapshots a session, persists its measured
 * report, and turns reviewed-shape proposals into knowledge candidates.
 */

export type RetroEvidenceResult =
	| {
			status: "completed";
			report: RetroReportV1;
			reportPath: string;
			recordPath: string;
	  }
	| { status: "blocked"; reason: string };

type RetroRangeSession =
	| {
			sessionId: string;
			status: "completed";
			sha256: string;
			records: number;
			evidence: number;
			reportPath: string;
			recordPath: string;
	  }
	| { sessionId: string; status: "failed"; reason: string };

export type RetroRangeResult =
	| {
			status: "completed";
			days: number;
			sessions: RetroRangeSession[];
			unlocated: number;
			unreadableProjects: number;
	  }
	| { status: "blocked"; reason: string };

type RetroProposalOutcome = {
	facet: string;
	rule: string;
	severity: string;
	status: "written" | "duplicate" | "rejected";
	id?: string;
	reason?: string;
};

export type RetroProposalResult =
	| { status: "completed"; outcomes: RetroProposalOutcome[] }
	| { status: "blocked"; reason: string };

type ProposalContext = {
	report: RetroReportV1;
	key: string;
	root: string;
	project: { slug: string; remote: string };
};

type Proposal = {
	facet: RetroFacet;
	rule: string;
	severity: (typeof SEVERITIES)[number];
	target: string;
	summary: string;
	practice: string;
	context: string;
	refs: string[];
	estimatedBytes?: number;
	checkClass?: CheckClass;
	evidence: RetroEvidenceV1[];
};

type CheckClass = keyof typeof CHECK_CLASS_TARGETS;

const SEVERITIES = ["high", "medium", "low"] as const;
/** Where an adopted proposal may land, per facet. */
const ADOPTION_TARGETS: Partial<Record<RetroFacet, readonly string[]>> = {
	"file-search": ["instruction-path-guidance", "file-structure"],
	"tool-cost": ["command-usage", "mcp-config", "tool-retirement"],
	"auto-checks": [
		"lint",
		"hook",
		"ci",
		"test",
		"semantic-review-criteria",
		"repo-review-standard",
	],
	"info-access": ["read-only-permission", "access-guidance"],
	"ineffective-instructions": [
		"instruction-removal",
		"instruction-consolidation",
	],
};
/** An `auto-checks` error a deterministic check can catch lands in one; the rest go to review criteria. */
const CHECK_CLASS_TARGETS = {
	mechanical: ["lint", "hook", "ci", "test"],
	judgement: ["semantic-review-criteria", "repo-review-standard"],
} as const;
/** Days a range run may cover, and the sessions it may analyze. */
export const RETRO_MAX_RANGE_DAYS = 90;
const MAX_RANGE_SESSIONS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PROPOSALS = 20;
const MAX_CITATIONS = 20;
const MAX_INFERRED_EVIDENCE = 5;
const TEXT_LIMITS = { summary: 160, practice: 1200, context: 600 } as const;
const TEXT_REJECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[
		/^ {0,3}(?:#|=+\s*$|-{2,}\s*$|\*{3,}\s*$|_{3,}\s*$)/m,
		"a heading or section break",
	],
	[/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"],
	[
		/(?:\/Users|\/home|[A-Za-z]:\\Users)[\\/][^\s\\/]+/,
		"a home-directory path",
	],
];
const PROPOSAL_KEYS = [
	"facet",
	"rule",
	"severity",
	"target",
	"summary",
	"practice",
	"context",
	"refs",
	"estimatedBytes",
	"checkClass",
	"evidence",
];

export function runRetroEvidence(options: {
	host: string;
	sessionId?: string;
	stateRoot: string;
	env?: NodeJS.ProcessEnv;
}): RetroEvidenceResult {
	if (options.host !== "claude") {
		return {
			status: "blocked",
			reason: `context/retro has no ${options.host} session adapter`,
		};
	}
	const location = locateClaudeSession(options.sessionId, options.env);
	if (location.status === "blocked") return location;
	return {
		status: "completed",
		...analyzeSession(location.path, location.sessionId, options.stateRoot),
	};
}

/**
 * Analyzes every session in a worktree of the current repository whose record
 * changed in the last `days` days, each under its own snapshot and report. A session
 * that fails to read is reported as failed; the others still complete.
 */
export function runRetroRange(options: {
	host: string;
	days: number;
	cwd: string;
	stateRoot: string;
	env?: NodeJS.ProcessEnv;
	now?: number;
}): RetroRangeResult {
	if (
		!Number.isSafeInteger(options.days) ||
		options.days < 1 ||
		options.days > RETRO_MAX_RANGE_DAYS
	) {
		throw new Error(
			`days must be an integer from 1 to ${RETRO_MAX_RANGE_DAYS}`,
		);
	}
	if (options.host !== "claude") {
		return {
			status: "blocked",
			reason: `context/retro has no ${options.host} session adapter`,
		};
	}
	const worktrees = repositoryWorktrees(options.cwd);
	const listed = listClaudeSessions({
		since: (options.now ?? Date.now()) - options.days * DAY_MS,
		env: options.env,
	});
	const located = listed.sessions.filter(
		(session): session is typeof session & { cwd: string } =>
			session.cwd !== undefined,
	);
	const inRange = located.filter((session) =>
		worktrees.some((root) => isInWorktree(root, session.cwd)),
	);
	if (inRange.length > MAX_RANGE_SESSIONS) {
		return {
			status: "blocked",
			reason: `${inRange.length} sessions in the last ${options.days} days exceed ${MAX_RANGE_SESSIONS}; use fewer days`,
		};
	}
	const sessions = rangeSessions(
		inRange,
		new Set(listed.ambiguous),
		options.stateRoot,
	);
	return {
		status: "completed",
		days: options.days,
		sessions,
		unlocated: listed.sessions.length - located.length,
		unreadableProjects: listed.unreadableProjects,
	};
}

/**
 * One entry per session id. An id recorded in more than one project directory
 * is ambiguous, as it is for a named session, and is not read.
 */
function rangeSessions(
	selected: Array<{ sessionId: string; path: string }>,
	ambiguous: Set<string>,
	stateRoot: string,
): RetroRangeSession[] {
	const seen = new Set<string>();
	return selected.flatMap(({ sessionId, path }): RetroRangeSession[] => {
		if (!ambiguous.has(sessionId))
			return [rangeSession(path, sessionId, stateRoot)];
		if (seen.has(sessionId)) return [];
		seen.add(sessionId);
		return [
			{
				sessionId,
				status: "failed",
				reason: `Claude session id is ambiguous: ${sessionId}`,
			},
		];
	});
}

/** One range entry; a session that fails to read is reported, not thrown. */
function rangeSession(
	path: string,
	sessionId: string,
	stateRoot: string,
): RetroRangeSession {
	try {
		const { report, reportPath, recordPath } = analyzeSession(
			path,
			sessionId,
			stateRoot,
		);
		const [snapshot] = report.snapshots;
		return {
			sessionId,
			status: "completed",
			sha256: snapshot.sha256,
			records: snapshot.recordCount,
			evidence: report.evidence.length,
			reportPath,
			recordPath,
		};
	} catch (error) {
		// Read errors may name the record path, which is not persisted.
		const reason = error instanceof Error ? error.message : String(error);
		return {
			sessionId,
			status: "failed",
			reason: reason.split(path).join("<session record>"),
		};
	}
}

function analyzeSession(
	path: string,
	sessionId: string,
	stateRoot: string,
): { report: RetroReportV1; reportPath: string; recordPath: string } {
	const session = readClaudeSession(path, sessionId);
	const report = analyzeRetroSession(session);
	const reportPath = reportFile(stateRoot, retroSnapshotKey(session.snapshot));
	writePrivateText(reportPath, stableJson(report));
	return { report, reportPath, recordPath: session.path };
}

/**
 * An absolute `cwd` is `root` or below it with no other worktree or repository between:
 * no directory from `cwd` up to `root` holds `.git`. A removed directory keeps
 * its recorded path and is judged by the directories that remain.
 */
function isInWorktree(root: string, cwd: string): boolean {
	if (!isAbsolute(cwd)) return false;
	let resolved = cwd;
	try {
		resolved = realpathSync(cwd);
	} catch {
		// Keep the recorded path.
	}
	const rel = relative(root, resolved);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		return false;
	for (
		let dir = resolved;
		dir !== root && dirname(dir) !== dir;
		dir = dirname(dir)
	) {
		if (existsSync(join(dir, ".git"))) return false;
	}
	return true;
}

/**
 * Every worktree of the Git repository containing `cwd` that still exists,
 * resolved through links, or `cwd` alone outside a repository.
 */
function repositoryWorktrees(cwd: string): string[] {
	// NUL-separated fields keep a path with a newline whole.
	const result = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return [realpathSync(cwd)];
	return result.stdout
		.split("\0")
		.filter((field) => field.startsWith("worktree "))
		.flatMap((field) => {
			try {
				return [realpathSync(field.slice("worktree ".length))];
			} catch {
				return [];
			}
		});
}

export function runRetroProposals(
	input: unknown,
	options: { stateRoot: string; knowledgeRoot?: string; cwd: string },
): RetroProposalResult {
	const request = object(input, "retro proposal input");
	only(request, "retro proposal input", ["sessionId", "sha256", "proposals"]);
	if (
		typeof request.sessionId !== "string" ||
		!RETRO_SESSION_ID_RE.test(request.sessionId)
	) {
		throw new Error("retro proposal input sessionId is invalid");
	}
	if (
		typeof request.sha256 !== "string" ||
		!RETRO_SHA256_RE.test(request.sha256)
	) {
		throw new Error("retro proposal input sha256 is invalid");
	}
	if (
		!Array.isArray(request.proposals) ||
		request.proposals.length > MAX_PROPOSALS
	) {
		throw new Error(
			`retro proposal input proposals must be an array of at most ${MAX_PROPOSALS}`,
		);
	}
	const key = retroSnapshotKey({
		sessionId: request.sessionId,
		sha256: request.sha256,
	});
	const file = reportFile(options.stateRoot, key);
	if (!existsSync(file))
		return {
			status: "blocked",
			reason: `no retro report for snapshot ${key}; run evidence first`,
		};
	const report = validateRetroReport(JSON.parse(readFileSync(file, "utf8")));
	const context: ProposalContext = {
		report,
		key,
		root: options.knowledgeRoot ?? knowledgeRoot(),
		project: {
			slug: currentProjectSlug(options.cwd),
			remote: currentCanonicalRemote(options.cwd),
		},
	};
	const outcomes = request.proposals.map((item, index) => ({
		index,
		outcome: proposalOutcome(item, context),
	}));
	outcomes.sort(
		(a, b) =>
			severityRank(a.outcome.severity) - severityRank(b.outcome.severity) ||
			a.index - b.index,
	);
	return { status: "completed", outcomes: outcomes.map((row) => row.outcome) };
}

function proposalOutcome(
	item: unknown,
	context: ProposalContext,
): RetroProposalOutcome {
	const { report, key, root, project } = context;
	const label = labelOf(item);
	let proposal: Proposal;
	try {
		proposal = validateProposal(item, report, key);
	} catch (error) {
		return { ...label, status: "rejected", reason: message(error) };
	}
	const id = `retro-${sha256(`${report.snapshots[0].sha256}\n${proposal.facet}\n${proposal.rule}`).slice(0, 16)}`;
	try {
		const entry = createKnowledgeEntry({
			id,
			title: `Retro ${proposal.facet}: ${proposal.summary}`.slice(0, 120),
			type: "practice",
			domains: ["general"],
			scope: "project",
			project_slug: project.slug,
			canonical_remote: project.remote,
			status: "candidate",
			confidence: 4,
			source: "retro",
			source_evidence: `retro:${key}`,
			staleness: "needs-review",
			check_class: proposal.checkClass ?? "",
			// No eval has shown the instruction change leaves behavior unchanged.
			eval_status:
				proposal.facet === "ineffective-instructions" ? "unproven" : "",
			summary: proposal.summary,
			body: candidateBody(proposal, report, key),
		});
		const result = writeKnowledgeCandidate(entry, root);
		return { ...label, status: result.skipped ? "duplicate" : "written", id };
	} catch (error) {
		return { ...label, status: "rejected", reason: message(error) };
	}
}

function validateProposal(
	item: unknown,
	report: RetroReportV1,
	key: string,
): Proposal {
	const proposal = object(item, "proposal");
	only(proposal, "proposal", PROPOSAL_KEYS);
	const facet = proposal.facet as RetroFacet;
	if (report.facets[facet]?.status !== "covered")
		throw new Error(`facet is not covered: ${String(facet)}`);
	if (!isLabel(proposal.rule)) throw new Error("rule is invalid");
	if (!SEVERITIES.includes(proposal.severity as Proposal["severity"]))
		throw new Error("severity must be high, medium, or low");
	validateTarget(proposal, facet);
	validateCheckClass(proposal, facet);
	validateText(proposal);
	const snapshots = retroSnapshotRecords(report.snapshots);
	// Refs and evidence are rendered into the candidate body, so both are bounded.
	if (Array.isArray(proposal.refs) && proposal.refs.length > MAX_CITATIONS)
		throw new Error(`refs must cite at most ${MAX_CITATIONS} records`);
	validateRetroRefs(proposal.refs, snapshots);
	validateInferredEvidence(proposal.evidence, facet, snapshots);
	return proposal as unknown as Proposal;
}

function validateTarget(
	proposal: Record<string, unknown>,
	facet: RetroFacet,
): void {
	const targets = ADOPTION_TARGETS[facet] ?? [];
	if (!targets.includes(proposal.target as string)) {
		throw new Error(
			`target for ${facet} must be one of: ${targets.join(", ")}`,
		);
	}
	const needsEstimate =
		proposal.target === "instruction-path-guidance" ||
		proposal.estimatedBytes !== undefined;
	if (
		needsEstimate &&
		!(
			Number.isSafeInteger(proposal.estimatedBytes) &&
			(proposal.estimatedBytes as number) > 0
		)
	) {
		throw new Error(
			"estimatedBytes must be a positive integer for instruction-path-guidance",
		);
	}
}

/** `auto-checks` proposals classify the error, and the class limits the target; other facets have no class. */
function validateCheckClass(
	proposal: Record<string, unknown>,
	facet: RetroFacet,
): void {
	if (facet !== "auto-checks") {
		if (proposal.checkClass !== undefined)
			throw new Error("checkClass applies only to auto-checks proposals");
		return;
	}
	const targets: readonly string[] | undefined =
		typeof proposal.checkClass === "string" &&
		Object.hasOwn(CHECK_CLASS_TARGETS, proposal.checkClass)
			? CHECK_CLASS_TARGETS[proposal.checkClass as CheckClass]
			: undefined;
	if (!targets) throw new Error("checkClass must be mechanical or judgement");
	if (!targets.includes(proposal.target as string)) {
		throw new Error(
			`target for a ${proposal.checkClass} error must be one of: ${targets.join(", ")}`,
		);
	}
}

/**
 * Proposal text is model prose inside fixed candidate sections: it may not open
 * its own sections or carry addresses or home-directory paths from the session.
 */
function validateText(proposal: Record<string, unknown>): void {
	for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
		const value = proposal[field];
		if (typeof value !== "string" || !value.trim() || value.length > limit) {
			throw new Error(
				`${field} must be non-empty text of at most ${limit} characters`,
			);
		}
		const rejected = TEXT_REJECTIONS.find(([pattern]) => pattern.test(value));
		if (rejected) throw new Error(`${field} must not contain ${rejected[1]}`);
	}
}

/** The model may add only `inferred` evidence; `measured` evidence comes from the report. */
function validateInferredEvidence(
	value: unknown,
	facet: RetroFacet,
	snapshots: Map<string, number>,
): void {
	if (!Array.isArray(value) || value.length > MAX_INFERRED_EVIDENCE)
		throw new Error(
			`evidence must be an array of at most ${MAX_INFERRED_EVIDENCE} items`,
		);
	for (const item of value) {
		const evidence = validateRetroEvidence(item);
		if (evidence.grade !== "inferred")
			throw new Error(
				"proposal evidence must be inferred; measured evidence comes from the report",
			);
		if (evidence.facet !== facet)
			throw new Error("proposal evidence must share the proposal facet");
		if (evidence.refs.length > MAX_CITATIONS)
			throw new Error(
				`evidence refs must cite at most ${MAX_CITATIONS} records`,
			);
		validateRetroRefs(evidence.refs, snapshots);
	}
}

/** What a measured line is about: its tool, or the instruction source kind and content hash prefix. */
function measuredLabel(item: RetroEvidenceV1): string {
	const parts = [
		item.tool,
		item.sourceKind,
		item.contentSha256 && `sha256:${item.contentSha256.slice(0, 12)}`,
	].filter(Boolean);
	return parts.length > 0 ? ` (${parts.join(" ")})` : "";
}

/** Review conditions an adopted proposal carries, by facet and target. */
function adoptionNotes(proposal: Proposal): string[] {
	const notes: string[] = [];
	if (proposal.checkClass)
		notes.push(`- 錯誤分類（推論）：${proposal.checkClass}`);
	if (proposal.target === "read-only-permission")
		notes.push("- 需安全審查：只提議唯讀存取，不授予寫入權限或密鑰");
	if (proposal.facet === "ineffective-instructions")
		notes.push("- 驗證狀態：unproven（未經 eval，不可直接刪除或合併）");
	return notes;
}

function candidateBody(
	proposal: Proposal,
	report: RetroReportV1,
	key: string,
): string {
	const cited = new Set(proposal.refs);
	const measured = report.evidence.filter(
		(item) =>
			item.facet === proposal.facet && item.refs.some((ref) => cited.has(ref)),
	);
	const ordinals = (refs: string[]) =>
		refs.map((ref) => `#${ref.slice(ref.lastIndexOf("#") + 1)}`).join(", ");
	const estimate =
		proposal.estimatedBytes === undefined
			? ""
			: `（預估${proposal.facet === "ineffective-instructions" ? "減少" : "新增"} ${proposal.estimatedBytes} bytes）`;
	return [
		"## 做法",
		"",
		proposal.practice.trim(),
		"",
		"## 適用情境",
		"",
		proposal.context.trim(),
		"",
		"## 驗證證據",
		"",
		`- 採用目標：${proposal.target}${estimate}`,
		...adoptionNotes(proposal),
		`- 嚴重度：${proposal.severity}`,
		`- 快照：${key}；引用為紀錄序號 ${ordinals(proposal.refs)}`,
		"",
		"### 實測（measured）",
		"",
		...(measured.length > 0
			? measured.map(
					(item) =>
						`- ${item.rule}: ${item.metric ? `${item.metric.value} ${item.metric.unit}` : "-"}` +
						`${measuredLabel(item)}，${ordinals(item.refs)}`,
				)
			: ["- 沒有與引用位置重疊的實測證據"]),
		"",
		"### 推論（inferred，未經驗證）",
		"",
		...(proposal.evidence.length > 0
			? proposal.evidence.map(
					(item) => `- ${item.rule}，${ordinals(item.refs)}`,
				)
			: ["- 無"]),
	].join("\n");
}

function reportFile(stateRoot: string, key: string): string {
	return join(stateRoot, "retro", "reports", `${key}.json`);
}

function labelOf(
	item: unknown,
): Pick<RetroProposalOutcome, "facet" | "rule" | "severity"> {
	const value =
		item && typeof item === "object" ? (item as Record<string, unknown>) : {};
	const text = (field: string) =>
		isLabel(value[field]) ? (value[field] as string) : "invalid";
	return {
		facet: text("facet"),
		rule: text("rule"),
		severity: text("severity"),
	};
}

/** A rule-shaped value that does not look like a secret. */
function isLabel(value: unknown): value is string {
	return (
		typeof value === "string" &&
		RETRO_RULE_RE.test(value) &&
		detectSecretLikeContent(value).length === 0
	);
}

function severityRank(severity: string): number {
	const rank = SEVERITIES.indexOf(severity as Proposal["severity"]);
	return rank === -1 ? SEVERITIES.length : rank;
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function only(
	value: Record<string, unknown>,
	label: string,
	allowed: readonly string[],
): void {
	for (const field of Object.keys(value)) {
		if (!allowed.includes(field))
			throw new Error(`${label} has unsupported field: ${field}`);
	}
}

/** Validation messages may quote proposal input, so secret-shaped ones are withheld. */
function message(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return detectSecretLikeContent(text).length > 0
		? "rejected; the reason quotes secret-shaped input"
		: text;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
