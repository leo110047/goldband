import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	classifyShellCommand,
	isEmptyShellSearch,
} from "./session-retro-analysis";
import {
	RETRO_SESSION_ID_RE,
	type RetroSnapshotRefV1,
	type RetroToolCategory,
	type RetroToolEventV1,
	type RetroUsageTotalsV1,
	validateRetroToolEvent,
} from "./session-retro-evidence";
import { readSessionSnapshot } from "./session-retro-snapshot";
import { stableJson } from "./stable-json";

/**
 * Claude Code session adapter. Claude records live at
 * `<claude home>/projects/<project>/<session id>.jsonl`; this module is the only
 * place that knows their record shapes.
 */

type JsonRecord = Record<string, unknown>;

export type ClaudeSessionLocation =
	| { status: "found"; sessionId: string; path: string }
	| { status: "blocked"; reason: string };

export type ClaudeSessionEvidence = {
	snapshot: RetroSnapshotRefV1;
	path: string;
	tools: RetroToolEventV1[];
	/** Ordinals of tool calls with no result inside the snapshot. */
	unfinished: number[];
	usage?: RetroUsageTotalsV1;
};

type PendingCall = {
	ordinal: number;
	name: string;
	inputSha256: string;
	command?: string;
};

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export function locateClaudeSession(
	sessionId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): ClaudeSessionLocation {
	const id = sessionId ?? env.CLAUDE_CODE_SESSION_ID;
	if (!id) {
		return {
			status: "blocked",
			reason: "no current Claude session id; pass a session id",
		};
	}
	if (!RETRO_SESSION_ID_RE.test(id))
		return { status: "blocked", reason: "invalid Claude session id" };
	const projects = join(
		env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"),
		"projects",
	);
	const matches = existsSync(projects)
		? readdirSync(projects, { withFileTypes: true })
				// A symlinked project directory could point outside the Claude home.
				.filter((project) => project.isDirectory())
				.map((project) => join(projects, project.name, `${id}.jsonl`))
				.filter((file) => existsSync(file) && lstatSync(file).isFile())
		: [];
	if (matches.length === 0)
		return { status: "blocked", reason: `Claude session not found: ${id}` };
	if (matches.length > 1)
		return {
			status: "blocked",
			reason: `Claude session id is ambiguous: ${id}`,
		};
	return { status: "found", sessionId: id, path: matches[0] };
}

/** Reads one Claude session snapshot; a record that does not match the known format fails the read. */
export function readClaudeSession(
	path: string,
	sessionId: string,
): ClaudeSessionEvidence {
	const pending = new Map<string, PendingCall>();
	const usage = new Map<
		string,
		{ ordinal: number; input: number; output: number }
	>();
	const tools: RetroToolEventV1[] = [];
	let ownRecords = 0;
	const snapshot = readSessionSnapshot(
		path,
		{ host: "claude", sessionId },
		(value, ordinal) => {
			const record = asRecord(value, `claude session record ${ordinal}`);
			if (typeof record.type !== "string")
				throw formatError(ordinal, "has no type");
			if (record.sessionId !== undefined) {
				if (record.sessionId !== sessionId)
					throw formatError(ordinal, "belongs to another session");
				ownRecords += 1;
			}
			if (record.type === "assistant")
				readAssistant(record, ordinal, pending, usage);
			if (record.type === "user") readUser(record, ordinal, pending, tools);
		},
	);
	if (ownRecords === 0)
		throw new Error(
			`claude session record has no entries for session ${sessionId}`,
		);
	tools.sort((a, b) => a.ordinal - b.ordinal);
	const unfinished = [...pending.values()]
		.map((call) => call.ordinal)
		.sort((a, b) => a - b);
	return { snapshot, path, tools, unfinished, usage: usageTotals(usage) };
}

function readAssistant(
	record: JsonRecord,
	ordinal: number,
	pending: Map<string, PendingCall>,
	usage: Map<string, { ordinal: number; input: number; output: number }>,
): void {
	const message = asRecord(
		record.message,
		`claude session record ${ordinal} message`,
	);
	// Claude writes one record per content block; blocks of one message repeat its usage.
	if (message.usage !== undefined && typeof message.id === "string") {
		const tokens = asRecord(
			message.usage,
			`claude session record ${ordinal} usage`,
		);
		usage.set(message.id, {
			ordinal,
			input:
				tokenCount(tokens.input_tokens) +
				tokenCount(tokens.cache_creation_input_tokens) +
				tokenCount(tokens.cache_read_input_tokens),
			output: tokenCount(tokens.output_tokens),
		});
	}
	for (const block of contentBlocks(message, ordinal)) {
		if (block.type !== "tool_use") continue;
		if (typeof block.id !== "string" || typeof block.name !== "string") {
			throw formatError(ordinal, "has a tool_use block without id or name");
		}
		const input = block.input ?? {};
		pending.set(block.id, {
			ordinal,
			name: block.name,
			inputSha256: sha256(stableJson(input)),
			command:
				block.name === "Bash" &&
				typeof (input as JsonRecord).command === "string"
					? ((input as JsonRecord).command as string)
					: undefined,
		});
	}
}

function readUser(
	record: JsonRecord,
	ordinal: number,
	pending: Map<string, PendingCall>,
	tools: RetroToolEventV1[],
): void {
	if (typeof record.message !== "object" || record.message === null) return;
	const results = contentBlocks(record.message as JsonRecord, ordinal).filter(
		(block) => block.type === "tool_result",
	);
	// toolUseResult describes the record's result only when the record holds exactly one.
	const detail =
		results.length === 1 &&
		typeof record.toolUseResult === "object" &&
		record.toolUseResult !== null
			? (record.toolUseResult as JsonRecord)
			: undefined;
	for (const result of results) {
		const call =
			typeof result.tool_use_id === "string"
				? pending.get(result.tool_use_id)
				: undefined;
		if (!call)
			throw formatError(
				ordinal,
				"has a tool_result without a matching tool_use",
			);
		pending.delete(result.tool_use_id as string);
		tools.push(
			validateRetroToolEvent(
				toolEvent(call, result, detail, record.permissionDecision),
			),
		);
	}
}

function toolEvent(
	call: PendingCall,
	result: JsonRecord,
	detail: JsonRecord | undefined,
	permission: unknown,
): RetroToolEventV1 {
	const text = resultText(result.content);
	const failed = result.is_error === true;
	const event: RetroToolEventV1 = {
		ordinal: call.ordinal,
		tool: call.name,
		category: category(call, detail),
		inputSha256: call.inputSha256,
		outputBytes: resultBytes(result.content),
		failed,
	};
	if (call.name === "Bash") {
		const exitCode = bashExitCode(text, failed);
		if (exitCode !== undefined) event.exitCode = exitCode;
		if (detail)
			event.truncated = typeof detail.persistedOutputPath === "string";
	}
	const blockedBy = blocker(permission);
	if (blockedBy) event.blockedBy = blockedBy;
	if (call.name === "Grep" && detail && typeof detail.truncated === "boolean")
		event.truncated = detail.truncated;
	const empty = emptyResult(call, event, detail);
	if (empty !== undefined) event.emptyResult = empty;
	return event;
}

/** Claude prefixes `Exit code N` only to failed results; success is 0. */
function bashExitCode(text: string, failed: boolean): number | undefined {
	if (!failed) return 0;
	const exit = /^Exit code (\d+)(?:\n|$)/.exec(text);
	return exit ? Number(exit[1]) : undefined;
}

function category(
	call: PendingCall,
	detail: JsonRecord | undefined,
): RetroToolCategory {
	if (EDIT_TOOLS.has(call.name)) return "edit";
	if (call.name === "Grep") return "search";
	if (call.name === "Glob" || call.name === "LS") return "list";
	if (call.name === "Read") return "read";
	if (call.name.startsWith("mcp__")) return "mcp";
	if (call.name !== "Bash") return "other";
	const diff = detail?.bashEditDiff as JsonRecord | undefined;
	if (Array.isArray(diff?.changedFiles) && diff.changedFiles.length > 0)
		return "edit";
	return call.command === undefined
		? "command"
		: classifyShellCommand(call.command);
}

function emptyResult(
	call: PendingCall,
	event: RetroToolEventV1,
	detail: JsonRecord | undefined,
): boolean | undefined {
	if (call.name === "Bash") {
		return event.category === "search"
			? isEmptyShellSearch(call.command ?? "", event)
			: undefined;
	}
	if (!detail || event.failed) return undefined;
	const counter = matchCounter(call.name, detail);
	return typeof counter === "number" ? counter === 0 : undefined;
}

/** The result field that counts matches: files for Glob, and per output mode for Grep. */
function matchCounter(tool: string, detail: JsonRecord): unknown {
	if (tool === "Glob") return detail.numFiles;
	if (tool !== "Grep") return undefined;
	if (detail.mode === "content") return detail.numLines;
	return detail.mode === "count" ? detail.numMatches : detail.numFiles;
}

function blocker(permission: unknown): RetroToolEventV1["blockedBy"] {
	if (typeof permission !== "object" || permission === null) return undefined;
	const decision = permission as JsonRecord;
	if (decision.decision !== "reject") return undefined;
	return decision.source === "hook" ? "hook" : "permission";
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && typeof part.text === "string"
				? part.text
				: "",
		)
		.join("");
}

/** Text parts count their UTF-8 bytes; other parts, such as images, their serialized size. */
function resultBytes(content: unknown): number {
	if (typeof content === "string") return Buffer.byteLength(content);
	if (!Array.isArray(content)) return 0;
	return content.reduce(
		(total: number, part) =>
			total +
			(part && typeof part === "object" && typeof part.text === "string"
				? Buffer.byteLength(part.text)
				: Buffer.byteLength(JSON.stringify(part) ?? "")),
		0,
	);
}

function usageTotals(
	usage: Map<string, { ordinal: number; input: number; output: number }>,
): RetroUsageTotalsV1 | undefined {
	let totals: RetroUsageTotalsV1 | undefined;
	for (const row of usage.values()) {
		totals = {
			firstOrdinal: Math.min(totals?.firstOrdinal ?? row.ordinal, row.ordinal),
			lastOrdinal: Math.max(totals?.lastOrdinal ?? row.ordinal, row.ordinal),
			inputTokens: (totals?.inputTokens ?? 0) + row.input,
			outputTokens: (totals?.outputTokens ?? 0) + row.output,
		};
	}
	return totals;
}

function contentBlocks(message: JsonRecord, ordinal: number): JsonRecord[] {
	if (typeof message.content === "string") return [];
	if (!Array.isArray(message.content))
		throw formatError(ordinal, "has message content that is not a list");
	return message.content.filter(
		(block): block is JsonRecord => typeof block === "object" && block !== null,
	);
}

function tokenCount(value: unknown): number {
	return Number.isSafeInteger(value) && (value as number) > 0
		? (value as number)
		: 0;
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} is not an object`);
	return value as JsonRecord;
}

function formatError(ordinal: number, detail: string): Error {
	return new Error(`claude session record ${ordinal} ${detail}`);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
