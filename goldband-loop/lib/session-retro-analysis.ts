import {
	formatRetroRef,
	RETRO_FACETS,
	type RetroEvidenceV1,
	type RetroFacet,
	type RetroFacetStatusV1,
	type RetroInstructionLoadV1,
	type RetroReportV1,
	type RetroSnapshotRefV1,
	type RetroToolCategory,
	type RetroToolEventV1,
	type RetroUsageTotalsV1,
	validateRetroReport,
} from "./session-retro-evidence";
import { instructionEvidence } from "./session-retro-instructions";

/**
 * Deterministic `measured` evidence over adapter events. Every value here is
 * computed from one snapshot; judgments are left to `inferred` proposals.
 */

/** Facets computed from tool events; `ineffective-instructions` needs instruction loads. */
const TOOL_FACETS: readonly RetroFacet[] = [
	"file-search",
	"auto-checks",
	"tool-cost",
	"info-access",
];
const DEFAULT_TOP_OUTPUTS = 10;
/** Evidence keeps the metric exact and cites at most this many positions, in order. */
const REF_LIMIT = 20;
/** Duplicate rules list at most this many groups, largest first. */
const GROUP_LIMIT = 20;

const SEARCH_PROGRAMS = new Set(["rg", "grep", "egrep", "fgrep", "ag", "ack"]);
const LIST_PROGRAMS = new Set(["ls", "find", "fd", "tree"]);
const READ_PROGRAMS = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"bat",
	"nl",
	"wc",
]);
const FILTER_PROGRAMS = new Set([
	"head",
	"tail",
	"wc",
	"sort",
	"uniq",
	"cut",
	"tr",
	"nl",
	"grep",
	"egrep",
	"fgrep",
	"rg",
]);
/** `find` primaries that act on matches or write files instead of listing them. */
const FIND_ACTIONS = new Set([
	"-delete",
	"-exec",
	"-execdir",
	"-ok",
	"-okdir",
	"-fprint",
	"-fprint0",
	"-fprintf",
	"-fls",
]);
/** Options that make a lookup or filter program run commands or write files. */
const ACTING_OPTIONS: Record<string, readonly string[]> = {
	fd: ["-x", "-X", "--exec", "--exec-batch"],
	"git grep": ["-O", "--open-files-in-pager"],
	rg: ["--pre"],
	tree: ["-o"],
	sort: ["-o", "--output", "--compress-program"],
	less: ["-o", "-O", "--log-file", "--LOG-FILE"],
};
/** `uniq` options whose value is the next argument. */
const UNIQ_VALUE_OPTIONS = new Set([
	"-f",
	"-s",
	"-w",
	"--skip-fields",
	"--skip-chars",
	"--check-chars",
]);
/** `sed -n` prints line ranges or matches; any other script may write or run commands. */
const SED_PRINT_SCRIPT = /^(?:\d+|\$)(?:,(?:\d+|\$))?p$/;
/** A command list of lookups takes the most search-like category it contains. */
const LOOKUP_PRIORITY: readonly RetroToolCategory[] = [
	"search",
	"list",
	"read",
];

type ShellOperator = "|" | "&&" | ";";
type ShellToken = string | { op: ShellOperator };

const GIT_CATEGORIES: Record<string, RetroToolCategory> = {
	grep: "search",
	"ls-files": "list",
};

/**
 * Classifies a shell command as search, list, or read only when it is a list of
 * plain pipelines joined by `;`, `&&`, or newlines, each of which is `cd <dir>`
 * or starts with a known search, list, or read program and only filters after
 * that. Any other command is `command`.
 */
export function classifyShellCommand(command: string): RetroToolCategory {
	const pipelines = shellPipelines(command);
	if (!pipelines) return "command";
	const categories = new Set(pipelines.map(pipelineCategory));
	if (categories.has("command")) return "command";
	return (
		LOOKUP_PRIORITY.find((category) => categories.has(category)) ?? "command"
	);
}

/**
 * A single grep-family search exits 1 when nothing matched. Lists and pipelines
 * report their last program's status, so they stay unknown.
 */
export function isEmptyShellSearch(
	command: string,
	event: Pick<RetroToolEventV1, "exitCode">,
): boolean | undefined {
	const pipelines = shellPipelines(command);
	if (
		pipelines?.length !== 1 ||
		pipelines[0].length !== 1 ||
		programCategory(pipelines[0][0]) !== "search"
	)
		return undefined;
	if (event.exitCode === 1) return true;
	return event.exitCode === 0 ? false : undefined;
}

/** A lookup pipeline's category; `cd` alone is neutral and anything else is `command`. */
function pipelineCategory(segments: string[][]): RetroToolCategory | "cd" {
	if (
		segments.length === 1 &&
		segments[0][0] === "cd" &&
		segments[0].length <= 2
	)
		return "cd";
	const filters = segments.slice(1);
	if (
		!filters.every(
			(segment) =>
				FILTER_PROGRAMS.has(segment[0]) && !actsBeyondOutput(segment),
		)
	)
		return "command";
	return programCategory(segments[0]);
}

function programCategory([program, ...args]: string[]): RetroToolCategory {
	if (program === "git")
		return actsBeyondOutput([`git ${args[0]}`, ...args.slice(1)])
			? "command"
			: (GIT_CATEGORIES[args[0] ?? ""] ?? "command");
	if (program === "sed") return isSedPrint(args) ? "read" : "command";
	if (actsBeyondOutput([program, ...args])) return "command";
	if (SEARCH_PROGRAMS.has(program)) return "search";
	if (LIST_PROGRAMS.has(program)) return "list";
	return READ_PROGRAMS.has(program) ? "read" : "command";
}

/** True when a program's arguments make it run commands or write files. */
function actsBeyondOutput([program, ...args]: string[]): boolean {
	if (program === "find") return args.some((arg) => FIND_ACTIONS.has(arg));
	// `uniq input output` writes its second operand.
	if (program === "uniq") return uniqOperands(args) > 1;
	return args.some((arg) =>
		(ACTING_OPTIONS[program] ?? []).some((option) =>
			option.startsWith("--")
				? arg === option || arg.startsWith(`${option}=`)
				: hasShortOption(arg, option[1]),
		),
	);
}

/** A short-option word such as `-Hx` holds every letter it bundles. */
function hasShortOption(arg: string, letter: string): boolean {
	return /^-[^-]/.test(arg) && arg.includes(letter);
}

/** `uniq` operands, skipping the values of its field and character options. */
function uniqOperands(args: string[]): number {
	let operands = 0;
	for (let index = 0; index < args.length; index += 1) {
		if (UNIQ_VALUE_OPTIONS.has(args[index])) index += 1;
		else if (args[index] === "-" || !args[index].startsWith("-")) operands += 1;
	}
	return operands;
}

/** `sed -n <range>p [file...]` with no other options. */
function isSedPrint(args: string[]): boolean {
	const [flag, script, ...files] = args;
	return (
		flag === "-n" &&
		SED_PRINT_SCRIPT.test(script ?? "") &&
		files.every((file) => !file.startsWith("-"))
	);
}

/** Pipelines of a command list without expansions, other redirections, or control flow; otherwise null. */
function shellPipelines(command: string): string[][][] | null {
	const tokens = shellTokens(command);
	if (!tokens) return null;
	const pipelines: string[][][] = [[[]]];
	for (const token of tokens) {
		const pipeline = pipelines[pipelines.length - 1];
		if (typeof token === "string") pipeline[pipeline.length - 1].push(token);
		else if (token.op === "|") pipeline.push([]);
		else pipelines.push([[]]);
	}
	// A trailing separator leaves one empty pipeline; empty segments elsewhere are malformed.
	const last = pipelines[pipelines.length - 1];
	if (pipelines.length > 1 && last.length === 1 && last[0].length === 0)
		pipelines.pop();
	return pipelines.every((pipeline) =>
		pipeline.every((segment) => segment.length > 0),
	)
		? pipelines
		: null;
}

/**
 * Splits plain words (globs included), single quotes, double quotes without
 * expansions, `|`, `&&`, `;`, newlines, and redirections to `/dev/null` or
 * another standard stream, which are dropped. Any other shell syntax leaves no
 * match.
 */
const SHELL_PIECE =
	/[ \t]+|\n|&&|;|\|(?!\|)|\d?>(?:\/dev\/null|&[12])(?=[\s;|&]|$)|'[^']*'|"(?:[^"\\$`]|\\[^$`])*"|[^\s'"|&;<>`$(){}\\[\]~]+/y;

const REDIRECTION = /^\d?>/;

function shellTokens(command: string): ShellToken[] | null {
	const tokens: ShellToken[] = [];
	const pattern = new RegExp(SHELL_PIECE);
	let word: string | null = null;
	while (pattern.lastIndex < command.length) {
		const piece = pattern.exec(command)?.[0];
		if (piece === undefined) return null;
		const kind = pieceKind(piece);
		if (kind === "word") {
			word = (word ?? "") + unquote(piece);
			continue;
		}
		if (word !== null) tokens.push(word);
		word = null;
		if (kind === "op") tokens.push({ op: operatorOf(piece) });
	}
	if (word !== null) tokens.push(word);
	return tokens;
}

function pieceKind(piece: string): "space" | "op" | "word" {
	if (["|", "&&", ";", "\n"].includes(piece)) return "op";
	return piece.trim() === "" || REDIRECTION.test(piece) ? "space" : "word";
}

/** A newline separates commands as `;` does. */
function operatorOf(piece: string): ShellOperator {
	return piece === "\n" ? ";" : (piece as ShellOperator);
}

function unquote(piece: string): string {
	return piece[0] === "'" || piece[0] === '"' ? piece.slice(1, -1) : piece;
}

export function analyzeRetroSession(input: {
	snapshot: RetroSnapshotRefV1;
	tools: RetroToolEventV1[];
	unfinished?: number[];
	usage?: RetroUsageTotalsV1;
	/** Absent when the host does not record which instructions it loaded. */
	instructions?: RetroInstructionLoadV1[];
	topOutputs?: number;
}): RetroReportV1 {
	const ref = (ordinal: number) => formatRetroRef(input.snapshot, ordinal);
	const unfinished = input.unfinished ?? [];
	const evidence = [
		...fileSearchEvidence(input.tools, ref),
		// Calls without a result are not events; the count keeps the omission visible.
		...(unfinished.length > 0
			? [
					measured(
						"tool-cost",
						"unfinished-call",
						unfinished.slice(0, REF_LIMIT).map(ref),
						{ value: unfinished.length, unit: "count" },
					),
				]
			: []),
		...toolCostEvidence(
			input.tools,
			input.usage,
			input.topOutputs ?? DEFAULT_TOP_OUTPUTS,
			ref,
		),
		...autoCheckEvidence(input.tools, ref),
		...infoAccessEvidence(input.tools, ref),
		...(input.instructions ? instructionEvidence(input.instructions, ref) : []),
	];
	const facets = Object.fromEntries(
		RETRO_FACETS.map((facet): [RetroFacet, RetroFacetStatusV1] => [
			facet,
			facetCoverage(facet, input.instructions),
		]),
	) as Record<RetroFacet, RetroFacetStatusV1>;
	return validateRetroReport({
		schemaVersion: 1,
		snapshots: [input.snapshot],
		facets,
		evidence,
	});
}

/**
 * A host that records instruction loads but recorded none for a session, such
 * as a Claude SDK session, did not show what it loaded.
 */
function facetCoverage(
	facet: RetroFacet,
	instructions: RetroInstructionLoadV1[] | undefined,
): RetroFacetStatusV1 {
	if (TOOL_FACETS.includes(facet)) return { status: "covered" };
	if (facet !== "ineffective-instructions")
		return { status: "unavailable", reason: "not-implemented" };
	if (!instructions)
		return { status: "unavailable", reason: "host-unsupported" };
	if (instructions.length === 0)
		return { status: "unavailable", reason: "not-recorded" };
	return { status: "covered" };
}

type Ref = (ordinal: number) => string;

/** Cost of finding files and information before the first edit, or over the whole snapshot without one. */
function fileSearchEvidence(
	tools: RetroToolEventV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	// A failed or blocked edit changed nothing, so the search window continues.
	const firstEdit = tools.find(isAppliedEdit);
	const window = firstEdit
		? tools.filter((event) => event.ordinal < firstEdit.ordinal)
		: tools;
	const searches = window.filter(
		(event) => event.category === "search" || event.category === "list",
	);
	const reads = window.filter((event) => event.category === "read");
	const lookups = window.filter((event) =>
		["search", "list", "read"].includes(event.category),
	);
	const evidence: RetroEvidenceV1[] = [];
	if (firstEdit) {
		evidence.push(
			measured("file-search", "first-edit", [ref(firstEdit.ordinal)], {
				value: window.length,
				unit: "count",
			}),
		);
	}
	evidence.push(
		...countEvidence("file-search", "pre-edit-searches", searches, ref),
	);
	evidence.push(...countEvidence("file-search", "pre-edit-reads", reads, ref));
	if (lookups.length > 0) {
		evidence.push(
			measured("file-search", "pre-edit-lookup-output", refs(lookups, ref), {
				value: sumBytes(lookups),
				unit: "bytes",
			}),
		);
	}
	evidence.push(
		...duplicateEvidence("file-search", "duplicate-search", searches, ref),
	);
	evidence.push(
		...countEvidence(
			"file-search",
			"empty-search",
			searches.filter((event) => event.emptyResult === true),
			ref,
		),
	);
	return evidence;
}

/** Large, repeated, and truncated tool output; per-call sizes are bytes because hosts record no per-call tokens. */
function toolCostEvidence(
	tools: RetroToolEventV1[],
	usage: RetroUsageTotalsV1 | undefined,
	topOutputs: number,
	ref: Ref,
): RetroEvidenceV1[] {
	const evidence: RetroEvidenceV1[] = [];
	const largest = tools
		.filter((event) => event.outputBytes > 0)
		.sort((a, b) => b.outputBytes - a.outputBytes || a.ordinal - b.ordinal)
		.slice(0, topOutputs);
	for (const event of largest) {
		evidence.push({
			...measured("tool-cost", "top-output", [ref(event.ordinal)], {
				value: event.outputBytes,
				unit: "bytes",
			}),
			...identity(event),
		});
	}
	evidence.push(
		...duplicateEvidence("tool-cost", "duplicate-call", tools, ref),
	);
	evidence.push(
		...countEvidence(
			"tool-cost",
			"truncated-output",
			tools.filter((event) => event.truncated === true),
			ref,
		),
	);
	const byTool = new Map<string, RetroToolEventV1[]>();
	for (const event of tools) appendTo(byTool, event.tool, event);
	const totals = [...byTool.entries()]
		.map(([tool, events]) => ({ tool, events, bytes: sumBytes(events) }))
		.filter((row) => row.bytes > 0)
		.sort((a, b) => b.bytes - a.bytes || a.tool.localeCompare(b.tool));
	for (const row of totals) {
		evidence.push({
			...measured("tool-cost", "output-by-tool", refs(row.events, ref), {
				value: row.bytes,
				unit: "bytes",
			}),
			tool: row.tool,
		});
	}
	if (usage) evidence.push(...usageEvidence(usage, ref));
	return evidence;
}

/**
 * Commands in order and their exit codes relative to edits. A command runs
 * after an edit only when it starts after the edit's result, since calls
 * issued together finish in any order. Which commands are checks, and whether
 * a check could have caught an error, is `inferred`.
 */
function autoCheckEvidence(
	tools: RetroToolEventV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	const edits = tools.filter(isAppliedEdit);
	const commands = tools.filter(
		(event) => event.category === "command" && !event.blockedBy,
	);
	const evidence: RetroEvidenceV1[] = [];
	const lastEdit = edits.reduce<RetroToolEventV1 | undefined>(
		(last, edit) =>
			!last || edit.resultOrdinal > last.resultOrdinal ? edit : last,
		undefined,
	);
	if (lastEdit) {
		const after = commands.filter(
			(event) => event.ordinal > lastEdit.resultOrdinal,
		);
		evidence.push(
			measured("auto-checks", "last-edit", [ref(lastEdit.ordinal)], {
				value: edits.length,
				unit: "count",
			}),
			// No command after the last edit still cites that edit.
			measured(
				"auto-checks",
				"commands-after-last-edit",
				after.length > 0 ? refs(after, ref) : [ref(lastEdit.ordinal)],
				{ value: after.length, unit: "count" },
			),
		);
	}
	const runs = commandRuns(commands, edits);
	evidence.push(
		...runEvidence("failed-then-passed", runs.fixed, ref),
		...runEvidence("unresolved-failure", runs.unresolved, ref),
	);
	return evidence;
}

/** An edit that neither failed nor was blocked. */
function isAppliedEdit(event: RetroToolEventV1): boolean {
	return event.category === "edit" && !event.failed && !event.blockedBy;
}

function isNonZeroExit(event: RetroToolEventV1): boolean {
	return event.exitCode !== undefined && event.exitCode !== 0;
}

/** Failed runs of one command input, with the run that passed after an edit, if any. */
type CommandRun = { failures: RetroToolEventV1[]; passed?: RetroToolEventV1 };

/**
 * Per command input: failures followed by an edit and then a passing run are
 * `fixed`; failures that no later run passes are `unresolved`. A pass with no
 * such edit ends the run without counting it.
 */
function commandRuns(
	commands: RetroToolEventV1[],
	edits: RetroToolEventV1[],
): { fixed: CommandRun[]; unresolved: CommandRun[] } {
	const byInput = new Map<string, RetroToolEventV1[]>();
	for (const event of commands) {
		if (event.exitCode !== undefined)
			appendTo(byInput, `${event.tool}\n${event.inputSha256}`, event);
	}
	const runs = { fixed: [] as CommandRun[], unresolved: [] as CommandRun[] };
	for (const events of byInput.values()) splitRuns(events, edits, runs);
	return runs;
}

function splitRuns(
	events: RetroToolEventV1[],
	edits: RetroToolEventV1[],
	runs: { fixed: CommandRun[]; unresolved: CommandRun[] },
): void {
	let failures: RetroToolEventV1[] = [];
	for (const event of events) {
		if (isNonZeroExit(event)) {
			failures.push(event);
			continue;
		}
		// An edit counts when it starts after the first failure is seen and
		// finishes after the last failing run starts and before this run starts.
		const [first, last] = [failures[0], failures[failures.length - 1]];
		if (
			first &&
			edits.some(
				(edit) =>
					edit.ordinal > first.resultOrdinal &&
					edit.resultOrdinal > last.ordinal &&
					edit.resultOrdinal < event.ordinal,
			)
		)
			runs.fixed.push({ failures, passed: event });
		failures = [];
	}
	if (failures.length > 0) runs.unresolved.push({ failures });
}

/**
 * One item per run, earliest first, up to GROUP_LIMIT, citing its failures and
 * the passing run, then `<rule>-groups` counting every run.
 */
function runEvidence(
	rule: string,
	runs: CommandRun[],
	ref: Ref,
): RetroEvidenceV1[] {
	if (runs.length === 0) return [];
	const ordered = [...runs].sort(
		(a, b) => a.failures[0].ordinal - b.failures[0].ordinal,
	);
	return [
		...ordered.slice(0, GROUP_LIMIT).map((run) => {
			const cited = [
				...run.failures.slice(0, REF_LIMIT - 1),
				...(run.passed ? [run.passed] : []),
			];
			const last = run.failures[run.failures.length - 1];
			return {
				...measured("auto-checks", rule, refs(cited, ref), {
					value: run.failures.length,
					unit: "count" as const,
				}),
				...identity(last),
				exitCode: last.exitCode,
			};
		}),
		measured(
			"auto-checks",
			`${rule}-groups`,
			refs(
				ordered.map((run) => run.failures[0]),
				ref,
			),
			{ value: runs.length, unit: "count" },
		),
	];
}

/**
 * Calls that did not get what they asked for: non-zero exits other than a
 * search that matched nothing, failed calls without an exit code, and blocked
 * calls. Why each failed is `inferred`.
 */
function infoAccessEvidence(
	tools: RetroToolEventV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	const nonZero = tools.filter(
		(event) =>
			isNonZeroExit(event) && !event.blockedBy && event.emptyResult !== true,
	);
	const failedCalls = tools.filter(
		(event) => event.failed && event.exitCode === undefined && !event.blockedBy,
	);
	const evidence: RetroEvidenceV1[] = [
		...countEvidence("info-access", "nonzero-exit", nonZero, ref),
	];
	evidence.push(
		...groupedEvidence("exit-code", nonZero, ref, (event) => ({
			exitCode: event.exitCode,
		})),
		...groupedEvidence("failed-call", failedCalls, ref, (event) => ({
			tool: event.tool,
		})),
	);
	const blocked = tools.filter((event) => event.blockedBy);
	for (const blocker of ["hook", "permission"] as const) {
		evidence.push(
			...countEvidence(
				"info-access",
				`${blocker}-blocked`,
				blocked.filter((event) => event.blockedBy === blocker),
				ref,
			),
		);
	}
	evidence.push(
		...duplicateEvidence(
			"info-access",
			"repeated-failure",
			[...nonZero, ...failedCalls, ...blocked].sort(
				(a, b) => a.ordinal - b.ordinal,
			),
			ref,
		),
	);
	return evidence;
}

/**
 * One `info-access` count per distinct key, the GROUP_LIMIT largest first, then
 * `<rule>-groups` counting every key; the key is the identifying field the
 * item carries, such as an exit code or a tool name.
 */
function groupedEvidence(
	rule: string,
	events: RetroToolEventV1[],
	ref: Ref,
	keyOf: (
		event: RetroToolEventV1,
	) => Pick<RetroEvidenceV1, "exitCode" | "tool">,
): RetroEvidenceV1[] {
	const groups = new Map<string, RetroToolEventV1[]>();
	for (const event of events)
		appendTo(groups, JSON.stringify(keyOf(event)), event);
	const ordered = [...groups.entries()].sort(
		([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : a > b ? 1 : 0),
	);
	if (ordered.length === 0) return [];
	return [
		...ordered.slice(0, GROUP_LIMIT).map(([, group]) => ({
			...measured("info-access", rule, refs(group, ref), {
				value: group.length,
				unit: "count" as const,
			}),
			...keyOf(group[0]),
		})),
		measured(
			"info-access",
			`${rule}-groups`,
			refs(
				ordered
					.map(([, group]) => group[0])
					.sort((a, b) => a.ordinal - b.ordinal),
				ref,
			),
			{ value: ordered.length, unit: "count" },
		),
	];
}

/** Session token totals; the span cites the first and last assistant records that carry usage. */
function usageEvidence(usage: RetroUsageTotalsV1, ref: Ref): RetroEvidenceV1[] {
	const span = [
		ref(usage.firstOrdinal),
		...(usage.lastOrdinal === usage.firstOrdinal
			? []
			: [ref(usage.lastOrdinal)]),
	];
	return [
		measured("tool-cost", "session-input-tokens", span, {
			value: usage.inputTokens,
			unit: "tokens",
		}),
		measured("tool-cost", "session-output-tokens", span, {
			value: usage.outputTokens,
			unit: "tokens",
		}),
	];
}

/**
 * Calls with the same tool and input, two or more times: the largest
 * GROUP_LIMIT groups, then `<rule>-groups` counting every group.
 */
function duplicateEvidence(
	facet: RetroFacet,
	rule: string,
	events: RetroToolEventV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	const byInput = new Map<string, RetroToolEventV1[]>();
	for (const event of events) {
		appendTo(byInput, `${event.tool}\n${event.inputSha256}`, event);
	}
	const groups = [...byInput.values()]
		.filter((group) => group.length > 1)
		.sort((a, b) => b.length - a.length || a[0].ordinal - b[0].ordinal);
	if (groups.length === 0) return [];
	return [
		...groups.slice(0, GROUP_LIMIT).map((group) => ({
			...measured(facet, rule, refs(group, ref), {
				value: group.length,
				unit: "count" as const,
			}),
			...identity(group[0]),
		})),
		measured(
			facet,
			`${rule}-groups`,
			refs(
				groups.map((group) => group[0]).sort((a, b) => a.ordinal - b.ordinal),
				ref,
			),
			{ value: groups.length, unit: "count" },
		),
	];
}

function appendTo<T>(map: Map<string, T[]>, key: string, value: T): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** One count item citing the events, or none when there are no events. */
function countEvidence(
	facet: RetroFacet,
	rule: string,
	events: RetroToolEventV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	return events.length > 0
		? [
				measured(facet, rule, refs(events, ref), {
					value: events.length,
					unit: "count",
				}),
			]
		: [];
}

function measured(
	facet: RetroFacet,
	rule: string,
	citations: string[],
	metric: NonNullable<RetroEvidenceV1["metric"]>,
): RetroEvidenceV1 {
	return { facet, grade: "measured", rule, refs: citations, metric };
}

function identity(
	event: RetroToolEventV1,
): Pick<RetroEvidenceV1, "tool" | "inputSha256"> {
	return { tool: event.tool, inputSha256: event.inputSha256 };
}

function refs(events: RetroToolEventV1[], ref: Ref): string[] {
	return events.slice(0, REF_LIMIT).map((event) => ref(event.ordinal));
}

function sumBytes(events: RetroToolEventV1[]): number {
	return events.reduce((sum, event) => sum + event.outputBytes, 0);
}
