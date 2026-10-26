import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
} from "node:fs";
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
/** Bytes read from the start of a record to find its working directory, in steps. */
const HEAD_BYTES = 4 * 1024 * 1024;
const HEAD_STEP = 256 * 1024;
let headBuffer: Buffer | undefined;
const SESSION_FILE_RE = /^([A-Za-z0-9-]{8,64})\.jsonl$/;

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
	const matches = projectDirectories(env)
		.map((project) => join(project, `${id}.jsonl`))
		.filter((file) => existsSync(file) && lstatSync(file).isFile());
	if (matches.length === 0)
		return { status: "blocked", reason: `Claude session not found: ${id}` };
	if (matches.length > 1)
		return {
			status: "blocked",
			reason: `Claude session id is ambiguous: ${id}`,
		};
	return { status: "found", sessionId: id, path: matches[0] };
}

/**
 * Session records changed at or after `since` (epoch ms), oldest first, with
 * the working directory of the first record that has one within HEAD_BYTES.
 * `cwd` is absent when no such record exists or the start cannot be read; a
 * file whose record names another session is left out. A project directory
 * that cannot be listed is counted, not read.
 */
export function listClaudeSessions(options: {
	since: number;
	env?: NodeJS.ProcessEnv;
}): {
	sessions: Array<{ sessionId: string; path: string; cwd?: string }>;
	ambiguous: string[];
	unreadableProjects: number;
} {
	let unreadableProjects = 0;
	const files = projectDirectories(options.env ?? process.env).flatMap(
		(project) => {
			const listed = sessionFiles(project);
			if (!listed) unreadableProjects += 1;
			return listed ?? [];
		},
	);
	const sessions = files
		.filter((file) => file.mtime >= options.since)
		.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path))
		.flatMap(({ sessionId, path }) => {
			const located = firstWorkingDirectory(path);
			if (!located) return [{ sessionId, path }];
			// A record whose entries name another session, such as a sidechain, is not this session.
			return located.sessionId === sessionId
				? [{ sessionId, path, cwd: located.cwd }]
				: [];
		});
	return { sessions, ambiguous: repeatedIds(files), unreadableProjects };
}

type SessionFile = { sessionId: string; path: string; mtime: number };

/** Ids recorded in more than one project directory, at any age, as `--session` counts them. */
function repeatedIds(files: SessionFile[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const { sessionId } of files) {
		if (seen.has(sessionId)) repeated.add(sessionId);
		seen.add(sessionId);
	}
	return [...repeated];
}

/**
 * Regular session record files directly in `project`; a directory removed
 * meanwhile has none, and one that cannot be read is null.
 */
function sessionFiles(project: string): SessionFile[] | null {
	try {
		return readdirSync(project, { withFileTypes: true }).flatMap((entry) => {
			const sessionId = SESSION_FILE_RE.exec(entry.name)?.[1];
			if (!sessionId || !entry.isFile()) return [];
			const path = join(project, entry.name);
			// A record removed after the directory read is no longer a session.
			const mtime = lstatSync(path, { throwIfNoEntry: false })?.mtimeMs;
			return mtime === undefined ? [] : [{ sessionId, path, mtime }];
		});
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
	}
}

/** Project directories under the Claude home; a symlinked one could point outside it. */
function projectDirectories(env: NodeJS.ProcessEnv): string[] {
	const projects = join(
		env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"),
		"projects",
	);
	return existsSync(projects)
		? readdirSync(projects, { withFileTypes: true })
				.filter((project) => project.isDirectory())
				.map((project) => join(projects, project.name))
		: [];
}

type RecordLocation = { cwd: string; sessionId: unknown };

/** The first complete record within HEAD_BYTES that has a `cwd`, if the start can be read. */
function firstWorkingDirectory(path: string): RecordLocation | undefined {
	try {
		const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			return scanHead(fd);
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

/** Reads HEAD_STEP at a time and stops at the first located record. */
function scanHead(fd: number): RecordLocation | undefined {
	headBuffer ??= Buffer.allocUnsafe(HEAD_BYTES);
	let length = 0;
	let parsed = 0;
	while (length < HEAD_BYTES) {
		const read = readSync(
			fd,
			headBuffer,
			length,
			Math.min(HEAD_STEP, HEAD_BYTES - length),
			length,
		);
		if (read === 0) return undefined;
		length += read;
		const end = headBuffer.lastIndexOf(0x0a, length - 1);
		if (end < parsed) continue;
		for (const line of headBuffer.toString("utf8", parsed, end).split("\n")) {
			const located = recordLocation(line);
			if (located) return located;
		}
		parsed = end + 1;
	}
	return undefined;
}

function recordLocation(line: string): RecordLocation | undefined {
	try {
		const record = JSON.parse(line) as unknown;
		return record &&
			typeof record === "object" &&
			typeof (record as JsonRecord).cwd === "string"
			? {
					cwd: (record as JsonRecord).cwd as string,
					sessionId: (record as JsonRecord).sessionId,
				}
			: undefined;
	} catch {
		return undefined;
	}
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
		pending.set(block.id, pendingCall(block.name, block.input ?? {}, ordinal));
	}
}

/** A Bash call is identified by its command, not its description or timeout. */
function pendingCall(
	name: string,
	input: unknown,
	ordinal: number,
): PendingCall {
	const command =
		name === "Bash" && typeof (input as JsonRecord).command === "string"
			? ((input as JsonRecord).command as string)
			: undefined;
	return {
		ordinal,
		name,
		inputSha256: sha256(
			stableJson(command === undefined ? input : { command }),
		),
		command,
	};
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
				toolEvent(
					{ ...call, resultOrdinal: ordinal },
					result,
					detail,
					record.permissionDecision,
				),
			),
		);
	}
}

function toolEvent(
	call: PendingCall & { resultOrdinal: number },
	result: JsonRecord,
	detail: JsonRecord | undefined,
	permission: unknown,
): RetroToolEventV1 {
	const text = resultText(result.content);
	const failed = result.is_error === true;
	const event: RetroToolEventV1 = {
		ordinal: call.ordinal,
		resultOrdinal: call.resultOrdinal,
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
