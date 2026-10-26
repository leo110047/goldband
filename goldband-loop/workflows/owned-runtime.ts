import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stateRoot } from "./evidence";
import { workflowAssetPath } from "./paths";
import { parseIosQaInput, parseSystemUpgradeInput } from "./safety-gates";
import type { SchemaValidator, WorkflowContext, WorkflowStep } from "./types";
import { calculateFrontier, workMapDigest, type WorkMapV1 } from "./work-map";
import { runWorkMapCreate } from "./work-map-runtime";
import { WorkMapStore } from "./work-map-store";

type OwnedStatus = "completed" | "blocked";

type OwnedRuntimeResult = {
	owner: string;
	operation: string;
	status: OwnedStatus;
	summary: string;
	evidence: string[];
	artifacts: string[];
	[key: string]: unknown;
};

type JsonRecord = Record<string, unknown>;

const resultSchema: SchemaValidator<OwnedRuntimeResult> = {
	name: "owned-runtime-result",
	validate(value) {
		const item = record(value, "owned runtime result");
		const status = requiredString(item.status, "status");
		if (!["completed", "blocked"].includes(status)) {
			throw new Error(
				"owned runtime result.status must be completed or blocked",
			);
		}
		return {
			...item,
			owner: requiredString(item.owner, "owner"),
			operation: requiredString(item.operation, "operation"),
			status: status as OwnedStatus,
			summary: requiredString(item.summary, "summary"),
			evidence: stringArray(item.evidence, "evidence"),
			artifacts: stringArray(item.artifacts, "artifacts"),
		};
	},
};

const OWNED_HANDLERS: Record<
	string,
	(ctx: WorkflowContext) => OwnedRuntimeResult
> = {
	"design/consult": runDesignConsult,
	"document/generate": runDocumentGenerate,
	"safety/guard": runSafetyGuard,
	"safety/freeze": runSafetyFreeze,
	"safety/unfreeze": runSafetyUnfreeze,
	"context/save": runContextSave,
	"context/restore": runContextRestore,
	"context/retro": runContextRetro,
	"knowledge/recall": runKnowledgeRecall,
	"benchmark/workflow": runBenchmarkWorkflow,
	"system/health": runSystemHealth,
	"system/upgrade": runSystemUpgrade,
	"ios/qa": runIosQa,
	"plan/create": runWorkMapCreate,
	"plan/sync": runTrackerSync,
};

function runTrackerSync(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = record(ctx.input, "plan/sync input");
	const mode = requiredString(input.mode, "plan/sync input.mode");
	if (!["preview", "inspect", "publish-step"].includes(mode))
		throw new Error(
			"plan/sync input.mode must be preview, inspect, or publish-step",
		);
	const workId = requiredString(input.workId, "plan/sync input.workId");
	const args = [
		"sync",
		mode === "publish-step" ? "publish" : mode,
		"--work-id",
		workId,
		"--host",
		ctx.options.host === "claude" ? "claude" : "codex",
	];
	if (mode === "publish-step") {
		args.push(
			"--operation-digest",
			requiredString(input.operationDigest, "plan/sync input.operationDigest"),
		);
		args.push("--step", requiredString(input.stepId, "plan/sync input.stepId"));
	}
	if (!isReal(ctx))
		return blocked(
			"tracker-runtime",
			mode,
			"Tracker synchronization requires real runtime readback.",
			[`mode=${mode}`, `workId=${workId}`],
		);
	const result = commandResult(
		process.execPath,
		[workflowAssetPath("workflows/work-map-cli.ts"), ...args],
		ctx.cwd,
		120_000,
	);
	if (result.status !== 0)
		return blocked(
			"tracker-runtime",
			mode,
			"Tracker runtime rejected the request.",
			[compact(result.stderr || result.stdout)],
		);
	let readback: unknown;
	try {
		readback = JSON.parse(result.stdout);
	} catch {
		return blocked(
			"tracker-runtime",
			mode,
			"Tracker runtime returned invalid JSON readback.",
			[compact(result.stdout)],
		);
	}
	if (
		mode === "publish-step" &&
		record(readback, "tracker publish readback").blockedReason
	) {
		return blocked(
			"tracker-runtime",
			mode,
			"Tracker publish step is pending readback.",
			[
				compact(
					String(record(readback, "tracker publish readback").blockedReason),
				),
			],
		);
	}
	return completed(
		"tracker-runtime",
		mode,
		`Tracker ${mode} completed.`,
		[`mode=${mode}`, `workId=${workId}`],
		[],
		{ mode, workId, readback },
	);
}

export function ownedRuntimeSteps(name: string): WorkflowStep[] | undefined {
	const handler = OWNED_HANDLERS[name];
	if (!handler) return undefined;
	return [
		{
			name: `run-${name.replace("/", "-")}-owner`,
			kind: "typed",
			produces: resultSchema,
			run: handler,
		},
	];
}

function runDesignConsult(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "design/consult input");
	const brief = isReal(ctx)
		? requiredString(input.brief, "brief")
		: optionalString(input.brief, "brief") ||
			"Mock product design consultation";
	const decisions = isReal(ctx)
		? record(input.decisions, "design/consult input.decisions")
		: optionalRecord(input.decisions, "design/consult input.decisions");
	const fields = ["typography", "color", "spacing", "layout", "motion"];
	const resolved = Object.fromEntries(
		fields.map((field) => [
			field,
			isReal(ctx)
				? requiredString(decisions[field], `decisions.${field}`)
				: optionalString(decisions[field], field) || `Mock ${field} direction`,
		]),
	);
	const artifact = artifactPath(ctx, "design-consult.md");
	const body = [
		"# Design consultation",
		"",
		`Brief: ${brief}`,
		"",
		...fields.flatMap((field) => [
			`## ${title(field)}`,
			"",
			resolved[field],
			"",
		]),
	].join("\n");
	writeArtifact(ctx, artifact, `${body.trim()}\n`);
	return completed(
		"design",
		"consult",
		"Validated and persisted the design decision contract.",
		fields.map((field) => `${field}=declared`),
		[artifact],
	);
}

function runDocumentGenerate(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "document/generate input");
	const operation = optionalString(input.mode, "mode") || "audit";
	const contract = ctx.workflow.runtimeContract;
	if (!contract?.modes.includes(operation)) {
		throw new Error(`document/generate does not support mode: ${operation}`);
	}
	const diffFile =
		ctx.options.diffFile || optionalString(input.diffFile, "diffFile");
	if (!isReal(ctx)) {
		return completed(
			"documentation audit",
			operation,
			"Validated documentation audit without reading a diff or changing a PR.",
			["mode=mock", "prMutation=none"],
		);
	}
	if (!diffFile) {
		throw new Error("diffFile must be a non-empty string");
	}
	const resolvedDiff = resolveInputFile(ctx.cwd, diffFile, "diffFile");
	const changedFiles = changedPathsFromDiff(readFileSync(resolvedDiff, "utf8"));
	if (changedFiles.length === 0) {
		return blocked(
			"documentation audit",
			operation,
			"The supplied diff does not contain changed file paths.",
			[`diffFile=${resolvedDiff}`],
		);
	}
	const documentationFiles = activeMarkdownFiles(ctx.cwd);
	const changedDocumentation = changedFiles.filter((file) =>
		file.endsWith(".md"),
	);
	const changedSource = changedFiles.filter((file) => !file.endsWith(".md"));
	const coverage = {
		schemaVersion: 1,
		mode: "audit",
		diffFile: relative(ctx.cwd, resolvedDiff),
		changedFiles,
		changedSource,
		changedDocumentation,
		diataxis: diataxisCoverage(documentationFiles, changedDocumentation),
		coverageStatus:
			changedSource.length === 0 || changedDocumentation.length > 0
				? "covered"
				: "documentation-review-required",
	};
	const coverageArtifact = artifactPath(ctx, "documentation-coverage.json");
	const prBodyArtifact = artifactPath(ctx, "documentation-pr-section.md");
	writeArtifact(
		ctx,
		coverageArtifact,
		`${JSON.stringify(coverage, null, 2)}\n`,
	);
	writeArtifact(ctx, prBodyArtifact, documentationPrSection(coverage));
	const artifacts = [coverageArtifact, prBodyArtifact];
	if (input.updatePrBody === true) {
		return {
			...blocked(
				"documentation audit",
				operation,
				"Coverage artifacts are ready; updating the PR body requires native host approval.",
				[
					`coverageStatus=${coverage.coverageStatus}`,
					"sideEffect=pr-body-update",
					"authorization=native-host-required",
				],
			),
			artifacts,
			requiresApproval: {
				action: "pr-body-update",
				artifact: prBodyArtifact,
			},
		};
	}
	return completed(
		"documentation audit",
		operation,
		"Audited changed files and prepared documentation coverage artifacts without mutating a PR.",
		[
			`changedFiles=${changedFiles.length}`,
			`changedDocumentation=${changedDocumentation.length}`,
			`coverageStatus=${coverage.coverageStatus}`,
			"prMutation=none",
		],
		artifacts,
		{ coverage },
	);
}

function runSafetyGuard(ctx: WorkflowContext): OwnedRuntimeResult {
	return runClaudeHookMode(ctx, "careful-mode", "enable", "guard");
}

function runSafetyFreeze(ctx: WorkflowContext): OwnedRuntimeResult {
	return runClaudeHookMode(ctx, "freeze-mode", "enable", "freeze");
}

function runSafetyUnfreeze(ctx: WorkflowContext): OwnedRuntimeResult {
	return runClaudeHookMode(ctx, "freeze-mode", "disable", "unfreeze");
}

function runClaudeHookMode(
	ctx: WorkflowContext,
	modeName: "careful-mode" | "freeze-mode",
	action: "enable" | "disable",
	operation: string,
): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, `safety/${operation} input`);
	const expectedActive = action === "enable";
	if (!isReal(ctx)) {
		return completed(
			"claude hook mode state",
			operation,
			`Validated ${modeName} ${action} request without changing hook state.`,
			["mode=mock", `expectedActive=${expectedActive}`],
		);
	}
	const requestedSessionId =
		optionalString(input.sessionId, "sessionId") ||
		optionalString(process.env.CLAUDE_SESSION_ID, "CLAUDE_SESSION_ID");
	if (!requestedSessionId) {
		return blocked(
			"claude hook mode state",
			operation,
			"A Claude sessionId is required to change enforceable hook state.",
			["sessionId=missing"],
		);
	}
	const sessionId = normalizeHookSessionId(requestedSessionId);
	const script = findModeOwnerScript(modeName);
	if (!script) {
		return blocked(
			"claude hook mode state",
			operation,
			`The installed ${modeName} owner script is unavailable.`,
			[`mode=${modeName}`],
		);
	}
	const result = commandResult(
		process.execPath,
		[script, action, "--session", sessionId, "--json"],
		ctx.cwd,
		5_000,
	);
	if (result.status !== 0) {
		return blocked(
			"claude hook mode state",
			operation,
			`${modeName} owner rejected the state change.`,
			[compact(result.stderr || result.stdout)],
		);
	}
	const readback = record(JSON.parse(result.stdout), `${modeName} readback`);
	if (readback.active !== expectedActive || readback.sessionId !== sessionId) {
		return blocked(
			"claude hook mode state",
			operation,
			`${modeName} readback did not match the requested state.`,
			[
				`sessionId=${String(readback.sessionId)}`,
				`active=${String(readback.active)}`,
			],
		);
	}
	const stateFile = requiredString(readback.stateFile, "stateFile");
	ctx.artifacts.push(stateFile);
	return completed(
		"claude hook mode state",
		operation,
		expectedActive
			? `${modeName} is active and enforced by the Claude PreToolUse router.`
			: `${modeName} is inactive in the Claude PreToolUse router.`,
		[
			`sessionId=${sessionId}`,
			`active=${expectedActive}`,
			`stateFile=${stateFile}`,
		],
		[stateFile],
		{ modeName, active: expectedActive },
	);
}

function runContextSave(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "context/save input");
	const summary = isReal(ctx)
		? requiredString(input.summary, "summary")
		: optionalString(input.summary, "summary") || "Mock saved context";
	const snapshot = gitSnapshot(ctx.cwd);
	const activeWorkMap =
		snapshot.head === "unborn"
			? null
			: new WorkMapStore({
					cwd: ctx.cwd,
					goldbandHome: ctx.options.goldbandHome,
				}).readActive();
	const context = {
		schemaVersion: 2,
		savedAt: new Date().toISOString(),
		cwd: realpathSync(ctx.cwd),
		repositoryIdentity: repositoryIdentity(ctx.cwd),
		...snapshot,
		summary,
		decisions: optionalStringArray(input.decisions, "decisions"),
		nextSteps: optionalStringArray(input.nextSteps, "nextSteps"),
		files: optionalStringArray(input.files, "files"),
		...(activeWorkMap
			? {
					activeWorkId: activeWorkMap.id,
					workMapRevision: activeWorkMap.revision,
					workMapDigest: workMapDigest(activeWorkMap),
					activeTicketId: null,
				}
			: {}),
	};
	const latest = contextLatestPath(ctx, snapshot);
	const artifact = join(
		dirname(latest),
		`${context.savedAt.replaceAll(":", "-")}-${ctx.runId}.json`,
	);
	writeJson(artifact, context);
	writeJson(latest, context);
	ctx.artifacts.push(artifact, latest);
	return completed(
		"context checkpoint store",
		"save",
		"Saved current context with git provenance.",
		[
			`branch=${snapshot.branch}`,
			`head=${snapshot.head}`,
			`statusBytes=${snapshot.status.length}`,
			`activeWorkId=${activeWorkMap?.id ?? "(none)"}`,
		],
		[artifact, latest],
	);
}

function runContextRestore(ctx: WorkflowContext): OwnedRuntimeResult {
	const current = gitSnapshot(ctx.cwd);
	const latest = contextLatestPath(ctx, current);
	if (!existsSync(latest)) {
		if (isReal(ctx)) {
			return blocked(
				"context checkpoint store",
				"restore",
				"No saved context exists for this working directory.",
				[`state=${latest}`],
			);
		}
		return completed(
			"context checkpoint store",
			"restore",
			"Loaded mock context.",
			["freshness=mock"],
		);
	}
	const saved = record(
		JSON.parse(readFileSync(latest, "utf8")),
		"saved context",
	);
	const staleReasons = gitStaleReasons(saved, current);
	const workMapState = restoreWorkMapState(ctx, saved, staleReasons);
	const stale = staleReasons.length > 0;
	ctx.artifacts.push(latest);
	return completed(
		"context checkpoint store",
		"restore",
		stale
			? "Loaded saved context and marked it stale against current git state."
			: "Loaded saved context matching current git state.",
		[
			`savedBranch=${String(saved.branch)}`,
			`currentBranch=${current.branch}`,
			`savedHead=${String(saved.head)}`,
			`currentHead=${current.head}`,
			`stale=${stale}`,
			`staleReasons=${staleReasons.join(",") || "(none)"}`,
		],
		[latest],
		{
			saved,
			current,
			stale,
			staleReasons,
			...workMapState,
		},
	);
}

function gitStaleReasons(
	saved: JsonRecord,
	current: { branch: string; head: string; status: string },
): string[] {
	const reasons: string[] = [];
	if (saved.branch !== current.branch) reasons.push("git-branch-changed");
	if (saved.head !== current.head) reasons.push("git-head-changed");
	if (saved.status !== current.status) reasons.push("git-worktree-changed");
	return reasons;
}

function restoreWorkMapState(
	ctx: WorkflowContext,
	saved: JsonRecord,
	staleReasons: string[],
): JsonRecord {
	if (saved.activeWorkId === undefined) {
		return {
			workMap: null,
			frontier: [],
			nextAction: "Continue from the saved context next steps.",
		};
	}
	const activeWorkId = requiredString(saved.activeWorkId, "activeWorkId");
	const savedRevision = positiveInteger(
		saved.workMapRevision,
		"workMapRevision",
	);
	const savedDigest = requiredString(saved.workMapDigest, "workMapDigest");
	let map: WorkMapV1;
	let currentActive: WorkMapV1 | null;
	try {
		const store = new WorkMapStore({
			cwd: ctx.cwd,
			goldbandHome: ctx.options.goldbandHome,
		});
		map = store.read(activeWorkId);
		currentActive = store.readActive();
	} catch (error) {
		if (isMissingWorkMapError(error)) {
			staleReasons.push("work-map-missing");
			return {
				workMap: null,
				frontier: [],
				nextAction: "Recreate or explicitly select the missing Work Map.",
			};
		}
		throw error;
	}
	if (!currentActive || currentActive.id !== activeWorkId) {
		staleReasons.push("active-work-map-changed");
	}
	if (map.revision !== savedRevision) {
		staleReasons.push("work-map-revision-changed");
	}
	const currentDigest = workMapDigest(map);
	if (currentDigest !== savedDigest) {
		staleReasons.push("work-map-digest-changed");
	}
	const frontier = calculateRestoredFrontier(map);
	return {
		workMap: {
			id: map.id,
			savedRevision,
			currentRevision: map.revision,
			savedDigest,
			currentDigest,
			status: map.status,
		},
		frontier,
		nextAction: nextWorkMapAction(map, frontier, staleReasons),
	};
}

function calculateRestoredFrontier(map: WorkMapV1): string[] {
	return calculateFrontier(map.tickets);
}

function nextWorkMapAction(
	map: WorkMapV1,
	frontier: string[],
	staleReasons: string[],
): string {
	if (map.status === "completed") {
		return "Archive the completed Work Map or create a new one for new work.";
	}
	if (map.status === "cancelled") {
		return "Create or select a non-cancelled Work Map before continuing.";
	}
	if (staleReasons.length > 0) {
		return "Refresh the context checkpoint before executing a frontier ticket.";
	}
	if (frontier.length === 0) {
		return "Resolve the Work Map blockers or shape a ready ticket.";
	}
	if (frontier.length === 1) {
		return `Execute frontier ticket ${frontier[0]}.`;
	}
	return "Select one ticket from the complete frontier before execution.";
}

function isMissingWorkMapError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("Work Map state is missing") ||
			error.message.includes("required directory is missing"))
	);
}

function runContextRetro(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "context/retro input");
	const operation = optionalString(input.mode, "mode") || "evidence";
	if (!ctx.workflow.runtimeContract?.modes.includes(operation)) {
		// The rejected value is not echoed: run evidence persists error text.
		throw new Error(
			`context/retro mode must be one of: ${ctx.workflow.runtimeContract?.modes.join(", ")}`,
		);
	}
	if (!isReal(ctx)) {
		return completed(
			"session-retro-evidence",
			operation,
			"Validated retro request without reading session records.",
			[`mode=${operation}`],
		);
	}
	return operation === "evidence"
		? runContextRetroEvidence(ctx, input)
		: runContextRetroProposals(ctx, input);
}

function runContextRetroEvidence(
	ctx: WorkflowContext,
	input: Record<string, unknown>,
): OwnedRuntimeResult {
	const sessionId = optionalString(input.sessionId, "sessionId");
	// runWorkflow admits real mode only with an explicit host.
	const args = ["evidence", "--host", ctx.options.host ?? "mock"];
	if (sessionId) args.push("--session", sessionId);
	const result = retroCommand(ctx, "evidence", args);
	if (result.status === "blocked") return result.blocked;
	const { report, reportPath } = result.output as {
		report: { facets: Record<string, { status: string }>; evidence: unknown[] };
		reportPath: string;
	};
	ctx.artifacts.push(reportPath);
	const facets = Object.entries(report.facets).map(
		([facet, value]) => `${facet}=${value.status}`,
	);
	return completed(
		"session-retro-evidence",
		"evidence",
		"Snapshotted the session and persisted its measured report.",
		[...facets, `evidence=${report.evidence.length}`],
		[reportPath],
		{ report },
	);
}

function runContextRetroProposals(
	ctx: WorkflowContext,
	input: Record<string, unknown>,
): OwnedRuntimeResult {
	const { mode: _mode, ...request } = input;
	const directory = mkdtempSync(join(tmpdir(), "goldband-retro-input-"));
	try {
		const file = join(directory, "proposals.json");
		writeFileSync(file, JSON.stringify(request), { mode: 0o600 });
		const result = retroCommand(ctx, "propose", ["propose", "--input", file]);
		if (result.status === "blocked") return result.blocked;
		const { outcomes } = result.output as {
			outcomes: Array<{ facet: string; rule: string; status: string }>;
		};
		return completed(
			"session-retro-evidence",
			"propose",
			"Validated retro proposals and wrote knowledge candidates.",
			outcomes.map(
				(outcome) => `${outcome.facet}/${outcome.rule}=${outcome.status}`,
			),
			[],
			{ outcomes },
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/**
 * Runs the retro owner CLI, which keeps the knowledge store out of the bundled
 * workflow runtime. Exit 0 is completed and 3 is the owner's blocked result.
 */
function retroCommand(
	ctx: WorkflowContext,
	operation: string,
	args: string[],
):
	| { status: "completed"; output: Record<string, unknown> }
	| { status: "blocked"; blocked: OwnedRuntimeResult } {
	const result = commandResult(
		"bun",
		["run", workflowAssetPath("bin/goldband-retro.ts"), ...args],
		ctx.cwd,
		120_000,
		{ GOLDBAND_HOME: stateRoot(ctx.options) },
	);
	if (result.status === 0 || result.status === 3) {
		const output = record(JSON.parse(result.stdout), "goldband-retro output");
		if (result.status === 0) return { status: "completed", output };
		const reason = String(output.reason);
		return {
			status: "blocked",
			blocked: blocked("session-retro-evidence", operation, reason, [reason]),
		};
	}
	return {
		status: "blocked",
		blocked: blocked(
			"session-retro-evidence",
			operation,
			"Retro owner rejected the request.",
			[compact(result.stderr || result.stdout)],
		),
	};
}

function runKnowledgeRecall(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "knowledge/recall input");
	const query = optionalString(input.query, "query");
	const domain = optionalString(input.domain, "domain");
	const limit = optionalPositiveInteger(input.limit, "limit") || 10;
	if (!isReal(ctx)) {
		return completed(
			"goldband-knowledge",
			"search",
			"Validated knowledge recall query.",
			[`query=${query || "*"}`, `domain=${domain || "*"}`, `limit=${limit}`],
		);
	}
	const args = [
		"run",
		workflowAssetPath("bin/goldband-knowledge.ts"),
		"search",
		"--limit",
		String(limit),
	];
	if (query) args.push("--query", query);
	if (domain) args.push("--domain", domain);
	const result = commandResult("bun", args, ctx.cwd, 15_000, {
		GOLDBAND_HOME: stateRoot(ctx.options),
	});
	if (result.status !== 0) {
		return blocked(
			"goldband-knowledge",
			"search",
			"Knowledge owner rejected the query.",
			[compact(result.stderr || result.stdout)],
		);
	}
	return completed(
		"goldband-knowledge",
		"search",
		"Knowledge owner completed the recall query.",
		[compact(result.stdout)],
	);
}

function runBenchmarkWorkflow(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = optionalRecord(ctx.input, "benchmark/workflow input");
	const label = optionalString(input.label, "label") || "mock-workflow";
	const metric = optionalString(input.metric, "metric") || "duration_ms";
	const conditions =
		optionalString(input.conditions, "conditions") || "mock conditions";
	const sourceEvidence = isReal(ctx)
		? requiredString(input.sourceEvidence, "sourceEvidence")
		: optionalString(input.sourceEvidence, "sourceEvidence") || "mock samples";
	const samples = isReal(ctx)
		? numberArray(input.samples, "samples")
		: input.samples === undefined
			? [12, 11, 13]
			: numberArray(input.samples, "samples");
	if (samples.length < 2) {
		return blocked(
			"benchmark evidence aggregator",
			"aggregate",
			"At least two samples are required.",
			[`samples=${samples.length}`],
		);
	}
	const sorted = [...samples].sort((a, b) => a - b);
	const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	const report = {
		schemaVersion: 1,
		label,
		metric,
		conditions,
		sourceEvidence,
		samples,
		count: samples.length,
		min: sorted[0],
		max: sorted.at(-1),
		mean,
		median: median(sorted),
	};
	const artifact = artifactPath(ctx, "benchmark.json");
	writeJson(artifact, report);
	ctx.artifacts.push(artifact);
	return completed(
		"benchmark evidence aggregator",
		"aggregate",
		"Validated repeatable samples and persisted a conditions-bound report.",
		[`metric=${metric}`, `count=${samples.length}`, `mean=${mean}`],
		[artifact],
		{ report },
	);
}

function runSystemHealth(ctx: WorkflowContext): OwnedRuntimeResult {
	if (!isReal(ctx)) {
		return completed(
			"goldband installation",
			"health",
			"Validated installed-runtime health request without claiming installation health.",
			["mode=mock", "installedState=not-inspected"],
		);
	}
	const host = ctx.options.host;
	if (host !== "claude" && host !== "codex") {
		return blocked(
			"goldband installation",
			"health",
			"Installed-runtime health requires an explicit Claude or Codex host.",
			[`host=${host ?? "missing"}`],
		);
	}
	const runtimeRoot = installedRuntimeRoot(host);
	const checks = inspectInstalledRuntime(runtimeRoot);
	const bun = commandResult("bun", ["--version"], ctx.cwd, 5_000);
	checks.push({
		id: "bun",
		status: bun.status === 0 ? "pass" : "fail",
		evidence: compact(bun.stdout || bun.stderr),
	});
	const failed = checks.filter((check) => check.status === "fail");
	return {
		...completed(
			"goldband installation",
			"health",
			failed.length === 0
				? `Installed Goldband ${host} runtime checks passed.`
				: `Installed Goldband ${host} runtime checks found failures.`,
			checks.map((check) => `${check.id}=${check.status}`),
		),
		status: failed.length === 0 ? "completed" : "blocked",
		version: existsSync(join(runtimeRoot, "VERSION"))
			? readFileSync(join(runtimeRoot, "VERSION"), "utf8").trim()
			: "missing",
		host,
		runtimeRoot,
		checks,
	};
}

function runSystemUpgrade(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = parseSystemUpgradeInput(ctx.input);
	if (!isReal(ctx)) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Mock mode cannot verify an installed-runtime upgrade safety contract.",
			[`phase=${input.phase}`, "authorization=not-consumed"],
		);
	}
	const host = ctx.options.host;
	if (host !== "claude" && host !== "codex") {
		return blocked(
			"goldband setup",
			"upgrade",
			"Upgrade requires an explicit Claude or Codex installed runtime.",
			[`host=${host ?? "missing"}`],
		);
	}
	const runtimeRoot = installedRuntimeRoot(host);
	const installationChecks = inspectInstalledRuntime(runtimeRoot);
	const failedInstallation = installationChecks.filter(
		(check) => check.status === "fail",
	);
	if (failedInstallation.length > 0) {
		return {
			...blocked(
				"goldband setup",
				"upgrade",
				"Installed Goldband runtime failed trusted-installation checks.",
				installationChecks.map((check) => `${check.id}=${check.status}`),
			),
			checks: installationChecks,
			runtimeRoot,
		};
	}
	const sourceRoot = lstatSync(runtimeRoot).isSymbolicLink()
		? realpathSync(runtimeRoot)
		: readFileSync(join(runtimeRoot, ".installed-source"), "utf8").trim();
	const checkout = commandResult(
		"git",
		["rev-parse", "--show-toplevel"],
		sourceRoot,
		5_000,
	);
	const root = checkout.stdout.trim();
	if (checkout.status !== 0 || !root) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Installed Goldband is not a git checkout.",
			[`runtimeRoot=${runtimeRoot}`],
		);
	}
	const dirty = commandResult("git", ["status", "--porcelain"], root, 5_000);
	if (dirty.status !== 0 || dirty.stdout.trim()) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Refused to upgrade a dirty Goldband checkout.",
			[compact(dirty.stderr || dirty.stdout)],
		);
	}
	const oldVersion = readFileSync(join(runtimeRoot, "VERSION"), "utf8").trim();
	const oldHead = git(root, ["rev-parse", "HEAD"]);
	const stateFile = join(
		stateRoot(ctx.options),
		"system-upgrade",
		"preflight.json",
	);
	if (input.phase === "preflight") {
		const preflightId = digest(
			`${root}\0${runtimeRoot}\0${oldVersion}\0${oldHead}\0${ctx.runId}`,
		).slice(0, 24);
		const setupPath = join(sourceRoot, "setup");
		const nextCommands = [
			["git", "-C", root, "pull", "--ff-only"],
			[setupPath, "-q"],
		];
		writeJson(stateFile, {
			schemaVersion: 1,
			status: "pending",
			preflightId,
			root,
			runtimeRoot,
			setupPath,
			oldVersion,
			oldHead,
			trustedInstallation: true,
			cleanWorktree: true,
			installationChecks,
			createdAt: new Date().toISOString(),
			nextCommands,
		});
		ctx.artifacts.push(stateFile);
		return {
			...blocked(
				"goldband setup",
				"upgrade",
				"Preflight passed. Native host approval is required before running the update commands.",
				[
					`root=${root}`,
					`runtimeRoot=${runtimeRoot}`,
					`oldVersion=${oldVersion}`,
					"authorization=native-host-required",
				],
			),
			artifacts: [stateFile],
			preflightId,
			nextCommands,
		};
	}
	if (!existsSync(stateFile) || lstatSync(stateFile).isSymbolicLink()) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Upgrade readback requires a trusted preflight state file.",
			[`state=${stateFile}`],
		);
	}
	const preflight = record(
		JSON.parse(readFileSync(stateFile, "utf8")),
		"system upgrade preflight",
	);
	const preflightId = input.preflightId;
	const expectedOldVersion = input.oldVersion;
	const expectedNewVersion = input.newVersion;
	if (
		preflight.status !== "pending" ||
		preflight.preflightId !== preflightId ||
		preflight.root !== root ||
		preflight.runtimeRoot !== runtimeRoot ||
		preflight.oldVersion !== expectedOldVersion
	) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Upgrade readback does not match the trusted preflight state.",
			[`preflightId=${preflightId}`],
		);
	}
	const currentVersion = readFileSync(
		join(runtimeRoot, "VERSION"),
		"utf8",
	).trim();
	const currentHead = git(root, ["rev-parse", "HEAD"]);
	if (
		expectedOldVersion === expectedNewVersion ||
		currentVersion !== expectedNewVersion ||
		currentHead === preflight.oldHead
	) {
		return blocked(
			"goldband setup",
			"upgrade",
			"Upgrade readback does not match the installed version.",
			[
				`oldVersion=${expectedOldVersion}`,
				`expectedVersion=${expectedNewVersion}`,
				`currentVersion=${currentVersion}`,
				`oldHead=${String(preflight.oldHead)}`,
				`currentHead=${currentHead}`,
			],
		);
	}
	writeJson(stateFile, {
		...preflight,
		status: "completed",
		completedAt: new Date().toISOString(),
		newVersion: currentVersion,
		newHead: currentHead,
	});
	ctx.artifacts.push(stateFile);
	return completed(
		"goldband setup",
		"upgrade",
		"Verified the native-host upgrade and setup readback.",
		[
			`oldVersion=${expectedOldVersion}`,
			`newVersion=${currentVersion}`,
			"setupVerified=true",
		],
		[stateFile],
		{
			preflightId,
			oldVersion: expectedOldVersion,
			newVersion: currentVersion,
			newHead: currentHead,
			setupVerified: true,
		},
	);
}

function runIosQa(ctx: WorkflowContext): OwnedRuntimeResult {
	const input = parseIosQaInput(ctx.input);
	if (!isReal(ctx)) {
		return blocked(
			"ios qa evidence",
			"qa",
			"Mock mode cannot verify macOS, Xcode, or simulator readback.",
			[
				`target=${input.targetScope.project}:${input.targetScope.scheme}`,
				`checks=${input.checks.length}`,
			],
		);
	}
	if (process.platform !== "darwin") {
		return blocked(
			"ios qa evidence",
			"qa",
			"iOS QA requires macOS and Xcode command-line tools.",
			[`platform=${process.platform}`],
		);
	}
	const devices = commandResult(
		"xcrun",
		["simctl", "list", "devices", "available", "-j"],
		ctx.cwd,
		15_000,
	);
	if (devices.status !== 0) {
		return blocked(
			"ios qa evidence",
			"qa",
			"Unable to inspect available iOS simulators.",
			[compact(devices.stderr || devices.stdout)],
		);
	}
	let availableDevices: string[];
	try {
		availableDevices = simulatorDeviceNames(devices.stdout);
	} catch (error) {
		return blocked(
			"ios qa evidence",
			"qa",
			"Unable to validate the iOS simulator inventory readback.",
			[error instanceof Error ? error.message : String(error)],
		);
	}
	const testedDevices = new Set(input.checks.map((check) => check.device));
	const untestedDeviceCoverage = input.targetScope.devices.filter(
		(device) => !testedDevices.has(device),
	);
	const simulatorInventoryDigest = digest(devices.stdout);
	const artifact = artifactPath(ctx, "ios-qa.json");
	writeJson(artifact, {
		schemaVersion: 1,
		targetScope: input.targetScope,
		checks: input.checks,
		darwinPlatform: true,
		xcodeToolchain: true,
		simulatorInventoryDigest,
		availableDevices,
		untestedDeviceCoverage,
	});
	ctx.artifacts.push(artifact);
	const failed = input.checks.filter((check) => check.status === "fail");
	return {
		...completed(
			"ios qa evidence",
			"qa",
			failed.length === 0
				? "iOS QA evidence passed."
				: "iOS QA evidence contains failures.",
			[
				...input.checks.map((check) => `${check.id}=${check.status}`),
				`untestedDevices=${untestedDeviceCoverage.length}`,
			],
			[artifact],
			{
				targetScope: input.targetScope,
				checks: input.checks,
				darwinPlatform: true,
				xcodeToolchain: true,
				simulatorInventoryDigest,
				availableDevices,
				untestedDeviceCoverage,
			},
		),
		status: failed.length === 0 ? "completed" : "blocked",
	};
}

function completed(
	owner: string,
	operation: string,
	summary: string,
	evidence: string[],
	artifacts: string[] = [],
	extra: JsonRecord = {},
): OwnedRuntimeResult {
	return {
		owner,
		operation,
		status: "completed",
		summary,
		evidence,
		artifacts,
		...extra,
	};
}

function blocked(
	owner: string,
	operation: string,
	summary: string,
	evidence: string[],
): OwnedRuntimeResult {
	return {
		owner,
		operation,
		status: "blocked",
		summary,
		evidence,
		artifacts: [],
	};
}

function isReal(ctx: WorkflowContext): boolean {
	return ctx.options.mode === "real";
}

function artifactPath(ctx: WorkflowContext, suffix: string): string {
	return join(
		stateRoot(ctx.options),
		"workflow-runs",
		"artifacts",
		`${ctx.runId}-${suffix}`,
	);
}

function resolveInputFile(cwd: string, file: string, field: string): string {
	const target = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
	const root = realpathSync(cwd);
	const targetParent = realpathSync(dirname(target));
	if (targetParent !== root && !targetParent.startsWith(`${root}/`)) {
		throw new Error(`${field} must stay within cwd`);
	}
	if (!existsSync(target) || !statSync(target).isFile()) {
		throw new Error(`${field} must reference an existing file`);
	}
	return target;
}

function changedPathsFromDiff(diff: string): string[] {
	const paths = new Set<string>();
	for (const line of diff.split("\n")) {
		const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
		if (!match) continue;
		for (const file of match.slice(1)) {
			if (file !== "/dev/null") paths.add(file);
		}
	}
	return [...paths].sort();
}

function activeMarkdownFiles(root: string): string[] {
	const ignored = new Set([
		".git",
		"node_modules",
		"archive",
		"designs",
		"plans",
		"reports",
	]);
	const visit = (directory: string): string[] =>
		readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			if (entry.name.startsWith(".") || ignored.has(entry.name)) return [];
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) return visit(absolute);
			return entry.isFile() && entry.name.endsWith(".md")
				? [relative(root, absolute)]
				: [];
		});
	return visit(root).sort();
}

function diataxisCoverage(allDocs: string[], changedDocs: string[]) {
	const categories = {
		tutorial: /(?:^|\/)tutorial[^/]*\.md$/i,
		howTo: /(?:^|\/)howto[^/]*\.md$/i,
		reference: /(?:^|\/)(?:reference|api)[^/]*\.md$/i,
		explanation: /(?:^|\/)explanation[^/]*\.md$/i,
	};
	return Object.fromEntries(
		Object.entries(categories).map(([category, pattern]) => [
			category,
			{
				available: allDocs.filter((file) => pattern.test(file)),
				changed: changedDocs.filter((file) => pattern.test(file)),
			},
		]),
	);
}

function documentationPrSection(coverage: {
	changedSource: string[];
	changedDocumentation: string[];
	coverageStatus: string;
}): string {
	const lines = [
		"## Documentation audit",
		"",
		`Status: ${coverage.coverageStatus}`,
		"",
		`Changed source files: ${coverage.changedSource.length}`,
		`Changed documentation files: ${coverage.changedDocumentation.length}`,
		"",
		"Generated by `goldband document generate` in audit mode. Review this section before applying it to a PR body.",
	];
	return `${lines.join("\n")}\n`;
}

function writeArtifact(
	ctx: WorkflowContext,
	file: string,
	content: string,
): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, { mode: 0o600 });
	ctx.artifacts.push(file);
}

function writeJson(file: string, value: unknown): void {
	writeSecureText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSecureText(file: string, content: string): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporary, content, { mode: 0o600 });
	renameSync(temporary, file);
}

function contextLatestPath(
	ctx: WorkflowContext,
	snapshot: { branch: string; head: string },
): string {
	const project = digest(repositoryIdentity(ctx.cwd)).slice(0, 16);
	const branchIdentity =
		snapshot.branch === "detached"
			? `detached-${snapshot.head}`
			: snapshot.branch;
	const branch = `${normalizePathSegment(branchIdentity)}-${digest(branchIdentity).slice(0, 10)}`;
	return join(
		stateRoot(ctx.options),
		"contexts",
		project,
		"branches",
		branch,
		"latest.json",
	);
}

function repositoryIdentity(cwd: string): string {
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	const commonDirectory = git(cwd, ["rev-parse", "--git-common-dir"]);
	if (!root || !commonDirectory) return realpathSync(cwd);
	return `${realpathSync(root)}\0${resolve(root, commonDirectory)}`;
}

function normalizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "unknown";
}

function gitSnapshot(cwd: string): {
	branch: string;
	head: string;
	status: string;
} {
	return {
		branch: git(cwd, ["branch", "--show-current"]) || "detached",
		head: git(cwd, ["rev-parse", "HEAD"]) || "unborn",
		status: git(cwd, ["status", "--short", "--untracked-files=all"]),
	};
}

function git(cwd: string, args: string[]): string {
	const result = commandResult("git", args, cwd, 5_000);
	return result.status === 0 ? result.stdout.trim() : "";
}

function findModeOwnerScript(modeName: "careful-mode" | "freeze-mode"): string {
	const scriptName = `${modeName}.js`;
	const candidates = [
		process.env.CLAUDE_PLUGIN_ROOT
			? join(
					process.env.CLAUDE_PLUGIN_ROOT,
					"skills",
					modeName,
					"scripts",
					scriptName,
				)
			: "",
		join(homedir(), ".claude", "skills", modeName, "scripts", scriptName),
		resolve(
			workflowAssetPath("."),
			"..",
			"skills",
			"global",
			modeName,
			"scripts",
			scriptName,
		),
	];
	return (
		candidates.find((candidate) => candidate && existsSync(candidate)) || ""
	);
}

function normalizeHookSessionId(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

type InstalledRuntimeCheck = {
	id: string;
	status: "pass" | "fail";
	evidence: string;
};

function inspectInstalledRuntime(runtimeRoot: string): InstalledRuntimeCheck[] {
	if (!existsSync(runtimeRoot)) {
		return [
			{
				id: "runtime-present",
				status: "fail",
				evidence: `missing:${runtimeRoot}`,
			},
		];
	}
	const required = [
		"VERSION",
		"setup",
		"SKILL.md",
		join("generated", "capability-actions.json"),
	];
	const missing = required.filter(
		(relativePath) => !existsSync(join(runtimeRoot, relativePath)),
	);
	const checks: InstalledRuntimeCheck[] = [
		{
			id: "runtime-present",
			status: "pass",
			evidence: runtimeRoot,
		},
		{
			id: "runtime-files",
			status: missing.length === 0 ? "pass" : "fail",
			evidence:
				missing.length === 0 ? "complete" : `missing:${missing.join(",")}`,
		},
	];
	if (missing.length > 0) return checks;

	if (lstatSync(runtimeRoot).isSymbolicLink()) {
		checks.push({
			id: "runtime-source",
			status: "pass",
			evidence: `live-link:${realpathSync(runtimeRoot)}`,
		});
		return checks;
	}

	const sourceMarker = join(runtimeRoot, ".installed-source");
	const contractMarker = join(runtimeRoot, ".installed-contract");
	if (!existsSync(sourceMarker) || !existsSync(contractMarker)) {
		checks.push({
			id: "install-markers",
			status: "fail",
			evidence: "missing .installed-source or .installed-contract",
		});
		return checks;
	}
	const sourceRoot = readFileSync(sourceMarker, "utf8").trim();
	if (!sourceRoot || !existsSync(sourceRoot)) {
		checks.push({
			id: "source-available",
			status: "fail",
			evidence: sourceRoot || "empty .installed-source",
		});
		return checks;
	}
	const expectedContract = workflowContractFingerprint(sourceRoot);
	const installedContract = readFileSync(contractMarker, "utf8").trim();
	const runtimeContract = workflowContractFingerprint(runtimeRoot);
	checks.push({
		id: "installed-contract",
		status:
			expectedContract && installedContract === expectedContract
				? "pass"
				: "fail",
		evidence:
			expectedContract && installedContract === expectedContract
				? installedContract
				: `stale:installed=${installedContract || "missing"},expected=${expectedContract || "unverifiable"}`,
	});
	checks.push({
		id: "source-install-drift",
		status:
			expectedContract && runtimeContract === expectedContract
				? "pass"
				: "fail",
		evidence:
			expectedContract && runtimeContract === expectedContract
				? "none"
				: `runtime=${runtimeContract || "unverifiable"},source=${expectedContract || "unverifiable"}`,
	});
	return checks;
}

function installedRuntimeRoot(host: "claude" | "codex"): string {
	return join(
		process.env.HOME || homedir(),
		host === "claude" ? ".claude" : ".codex",
		"skills",
		"goldband",
	);
}

function workflowContractFingerprint(root: string): string {
	const entries: string[] = [];
	for (const relativePath of ["setup", "generated/capability-actions.json"]) {
		const file = join(root, relativePath);
		if (!existsSync(file)) return "";
		const result = spawnSync("cksum", [file], { encoding: "utf8" });
		if (result.status !== 0) return "";
		const fields = result.stdout.trim().split(/\s+/);
		if (fields.length < 2) return "";
		entries.push(`${fields[0]}:${fields[1]}`);
	}
	const combined = spawnSync("cksum", [], {
		encoding: "utf8",
		input: `${entries.join("\n")}\n`,
	});
	if (combined.status !== 0) return "";
	const fields = combined.stdout.trim().split(/\s+/);
	return fields.length >= 2 ? `${fields[0]}:${fields[1]}` : "";
}

function commandResult(
	command: string,
	args: string[],
	cwd: string,
	timeout: number,
	extraEnv: Record<string, string> = {},
) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		timeout,
		maxBuffer: 1024 * 1024,
		env: { ...process.env, ...extraEnv },
	});
	return {
		status: result.status,
		stdout: result.stdout || "",
		stderr: result.error?.message || result.stderr || "",
	};
}

function simulatorDeviceNames(value: string): string[] {
	const payload = record(JSON.parse(value), "simulator inventory");
	const runtimes = record(payload.devices, "simulator inventory.devices");
	const names = Object.values(runtimes).flatMap((runtime, runtimeIndex) => {
		if (!Array.isArray(runtime)) {
			throw new Error(
				`simulator inventory.devices[${runtimeIndex}] must be an array`,
			);
		}
		return runtime.map((raw, deviceIndex) => {
			const device = record(
				raw,
				`simulator inventory.devices[${runtimeIndex}][${deviceIndex}]`,
			);
			return requiredString(device.name, "simulator device name");
		});
	});
	const unique = [...new Set(names)].sort();
	if (unique.length === 0) {
		throw new Error("simulator inventory has no available devices");
	}
	return unique;
}

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function optionalRecord(value: unknown, label: string): JsonRecord {
	if (value === undefined) return {};
	return record(value, label);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${field} must be a positive integer`);
	}
	return Number(value);
}

function optionalString(value: unknown, field: string): string {
	if (value === undefined) return "";
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${field} must be a string array`);
	}
	return value as string[];
}

function optionalStringArray(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	return stringArray(value, field);
}

function numberArray(value: unknown, field: string): number[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "number" || !Number.isFinite(item))
	) {
		throw new Error(`${field} must be a finite number array`);
	}
	return value as number[];
}

function optionalPositiveInteger(value: unknown, field: string): number {
	if (value === undefined) return 0;
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new Error(`${field} must be a positive integer`);
	}
	return Number(value);
}

function median(sorted: number[]): number {
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function compact(value: string): string {
	const normalized = value.replaceAll(/\s+/g, " ").trim();
	return normalized.length > 500
		? `${normalized.slice(0, 497)}...`
		: normalized;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function title(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
