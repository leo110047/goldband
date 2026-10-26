import { createHash } from "node:crypto";
import { type Dirent, lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	classifyShellCommand,
	isEmptyShellSearch,
} from "./session-retro-analysis";
import {
	type RetroInstructionLoadV1,
	type RetroSessionListing,
	type RetroSessionLocation,
	type RetroSessionRead,
	type RetroToolEventV1,
	repeatedSessionIds,
	retroContentBytes,
	retroContentText,
	retroTokenCount,
	retroUsageTotals,
	validateRetroToolEvent,
} from "./session-retro-evidence";
import {
	readSessionSnapshot,
	retroDirectoryKind,
	retroUnreadableNote,
	scanSessionHead,
} from "./session-retro-snapshot";
import { stableJson } from "./stable-json";

/**
 * Codex session adapter. Codex records live at
 * `<codex home>/sessions/<YYYY>/<MM>/<DD>/rollout-<time>-<thread id>.jsonl`;
 * this module is the only place that knows their record shapes.
 */

type JsonRecord = Record<string, unknown>;

/** Codex compresses older records to `.jsonl.zst`, which this adapter does not read. */
const SESSION_FILE_RE =
	/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl(\.zst)?$/;
/** Codex thread ids are lowercase UUIDs, as record file names spell them. */
const THREAD_ID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/** Year, month, and day directories under `sessions/`. */
const DATE_DEPTH = 3;
const AGENTS_HEADER = "# AGENTS.md instructions for ";
const AGENTS_BLOCK =
	/^# AGENTS\.md instructions for ([^\n]+)\n\n<INSTRUCTIONS>\n([\s\S]*)\n<\/INSTRUCTIONS>\s*$/;
/** Codex joins the user's AGENTS.md and the project docs with this line. */
const PROJECT_DOC_SEPARATOR = "\n\n--- project-doc ---\n\n";
const SKILLS_TAG = "<skills_instructions>";
/** Codex persists at most 64 KiB of a command's output, marking the cut with this line. */
const PERSISTED_CAP_MARKER =
	"\n... command output truncated for persistence ...\n";
/** Codex marks output it shortened for the model, per tool call. */
const TRUNCATION_MARKER = /…\d+ tokens truncated…/;
const CALL_TYPES = new Set(["custom_tool_call", "function_call"]);
const OUTPUT_TYPES = new Set([
	"custom_tool_call_output",
	"function_call_output",
]);

export function locateCodexSession(
	sessionId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): RetroSessionLocation {
	const id = sessionId ?? env.CODEX_THREAD_ID;
	if (!id) {
		return {
			status: "blocked",
			reason: "no current Codex thread id; pass a session id",
		};
	}
	if (!THREAD_ID_RE.test(id))
		return { status: "blocked", reason: "invalid Codex session id" };
	const listed = sessionFiles(env, id);
	const matches = listed.files;
	if (matches.length === 0)
		return {
			status: "blocked",
			reason: `Codex session not found: ${id}${retroUnreadableNote(listed.unreadable)}`,
		};
	if (matches.length > 1)
		return {
			status: "blocked",
			reason: `Codex session id is ambiguous: ${id}`,
		};
	if (matches[0].compressed)
		return {
			status: "blocked",
			reason: `Codex session record is compressed and is not read: ${id}`,
		};
	return { status: "found", sessionId: id, path: matches[0].path };
}

/**
 * Session records changed at or after `since` (epoch ms), oldest first, with
 * the working directory of their `session_meta` record within the head of the
 * file. `cwd` is absent when the start cannot be read, holds no such record,
 * or names another thread; a record of a subagent thread is left out. A date
 * directory that cannot be listed and a compressed record are counted, not read.
 */
export function listCodexSessions(options: {
	since: number;
	env?: NodeJS.ProcessEnv;
}): RetroSessionListing {
	const listed = sessionFiles(options.env ?? process.env);
	const recent = listed.files.filter((file) => file.mtime >= options.since);
	const compressed = recent.filter((file) => file.compressed);
	const sessions = recent
		.filter((file) => !file.compressed)
		.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path))
		.flatMap(({ sessionId, path }) => {
			const meta = scanSessionHead(path, sessionMeta);
			if (!meta || meta.id !== sessionId) return [{ sessionId, path }];
			return meta.subagent ? [] : [{ sessionId, path, cwd: meta.cwd }];
		});
	return {
		sessions,
		ambiguous: repeatedSessionIds(listed.files),
		unreadableDirectories: listed.unreadable,
		unreadRecords: compressed.length,
	};
}

type SessionFile = {
	sessionId: string;
	path: string;
	mtime: number;
	compressed: boolean;
};

type Collected = { files: SessionFile[]; unreadable: number; id?: string };

/**
 * Regular record files in the date directories under the Codex home, only
 * those of `id` when given, with directories that could not be listed
 * counted. Links are not followed; a linked `sessions` directory, which could
 * point outside the Codex home, counts as one that could not be listed.
 */
function sessionFiles(env: NodeJS.ProcessEnv, id?: string): Collected {
	const root = join(
		env.CODEX_HOME || join(env.HOME || homedir(), ".codex"),
		"sessions",
	);
	const result: Collected = { files: [], unreadable: 0, id };
	const kind = retroDirectoryKind(root);
	if (kind === "directory") collect(root, 0, result);
	else if (kind === "unreadable") result.unreadable += 1;
	return result;
}

function collect(dir: string, depth: number, result: Collected): void {
	const entries = listDirectory(dir, result);
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (depth < DATE_DEPTH) {
			if (entry.isDirectory()) collect(path, depth + 1, result);
		} else {
			const file = sessionFile(path, entry, result.id);
			if (file) result.files.push(file);
		}
	}
}

/** A directory removed meanwhile has no entries; one that cannot be read is counted. */
function listDirectory(dir: string, result: { unreadable: number }): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			result.unreadable += 1;
		return [];
	}
}

function sessionFile(
	path: string,
	entry: Dirent,
	id: string | undefined,
): SessionFile | undefined {
	const match = SESSION_FILE_RE.exec(entry.name);
	if (!match || !entry.isFile() || (id !== undefined && match[1] !== id))
		return undefined;
	// A record removed after the directory read is no longer a session.
	const mtime = lstatSync(path, { throwIfNoEntry: false })?.mtimeMs;
	return mtime === undefined
		? undefined
		: { sessionId: match[1], path, mtime, compressed: match[2] !== undefined };
}

type SessionMeta = { id: unknown; cwd: string; subagent: boolean };

function sessionMeta(record: unknown): SessionMeta | undefined {
	if (!isRecord(record) || record.type !== "session_meta") return undefined;
	const payload = record.payload;
	if (!isRecord(payload) || typeof payload.cwd !== "string") return undefined;
	return {
		id: payload.id,
		cwd: payload.cwd,
		// Codex records a spawned agent's thread with an object source naming it.
		subagent: isRecord(payload.source) && "subagent" in payload.source,
	};
}

/** `openedAt` is the epoch ms Codex recorded the call at, when it did. */
type OpenCall = { ordinal: number; openedAt?: number; events: number[] };

type Completion = { ordinal: number; at?: number };

type ReadState = {
	sessionId: string;
	owned: boolean;
	calls: Map<string, OpenCall>;
	tools: RetroToolEventV1[];
	usage: Map<string, { ordinal: number; input: number; output: number }>;
	instructions: RetroInstructionLoadV1[];
	/** Completion times of operations, in record order; absent when not recorded. */
	completions: Completion[];
	/** Record times of closed calls, in record order; absent when not recorded. */
	closedCalls: Array<{ openedAt?: number; closedAt?: number }>;
};

/** Reads one Codex session snapshot; a record that does not match the known format fails the read. */
export function readCodexSession(
	path: string,
	sessionId: string,
): RetroSessionRead {
	const state: ReadState = {
		sessionId,
		owned: false,
		calls: new Map(),
		closedCalls: [],
		tools: [],
		usage: new Map(),
		instructions: [],
		completions: [],
	};
	const snapshot = readSessionSnapshot(
		path,
		{ host: "codex", sessionId },
		(value, ordinal) => readRecord(value, ordinal, state),
	);
	if (!state.owned)
		throw new Error(
			`codex session record has no session_meta for session ${sessionId}`,
		);
	return {
		snapshot,
		path,
		tools: state.tools.map((event) => validateRetroToolEvent(event)),
		unfinished: [...state.calls.values()]
			.map((call) => call.ordinal)
			.sort((a, b) => a - b),
		usage: retroUsageTotals(state.usage.values()),
		instructions: state.instructions,
	};
}

function readRecord(value: unknown, ordinal: number, state: ReadState): void {
	if (!isRecord(value) || typeof value.type !== "string")
		throw formatError(ordinal, "has no type");
	if (!Object.hasOwn(RECORD_READERS, value.type)) return;
	if (!isRecord(value.payload)) throw formatError(ordinal, "has no payload");
	const recordedAt =
		typeof value.timestamp === "string" ? Date.parse(value.timestamp) : NaN;
	RECORD_READERS[value.type](
		value.payload,
		ordinal,
		state,
		Number.isNaN(recordedAt) ? undefined : recordedAt,
	);
}

const RECORD_READERS: Record<
	string,
	(
		payload: JsonRecord,
		ordinal: number,
		state: ReadState,
		recordedAt: number | undefined,
	) => void
> = {
	session_meta: (payload, ordinal, state) => {
		if (payload.id !== state.sessionId)
			throw formatError(ordinal, "belongs to another session");
		state.owned = true;
	},
	response_item: readResponseItem,
	event_msg: (payload, ordinal, state) => {
		if (payload.type !== "item_completed") return;
		// A thread also records the operations of a thread it started, such as a review.
		if (
			payload.thread_id !== undefined &&
			payload.thread_id !== state.sessionId
		)
			return;
		if (!isRecord(payload.item))
			throw formatError(ordinal, "has a completed item that is not an object");
		const event = operationEvent(payload.item, ordinal);
		if (!event) return;
		orderStart(event, payload, state.completions);
		state.tools.push(event);
		owningCall(payload, payload.item, state)?.events.push(
			state.tools.length - 1,
		);
	},
	token_usage_record: (payload, ordinal, state) => {
		if (!isRecord(payload.usage)) return;
		const key =
			typeof payload.response_id === "string"
				? payload.response_id
				: `#${ordinal}`;
		state.usage.set(key, {
			ordinal,
			input: retroTokenCount(payload.usage.input_tokens),
			output: retroTokenCount(payload.usage.output_tokens),
		});
	},
};

/**
 * The call that ran a completed operation: the open call its item names, else
 * the only call open both when the operation started and when it finished.
 * A background command finishing during an unrelated call belongs to none.
 */
function owningCall(
	payload: JsonRecord,
	item: JsonRecord,
	state: Pick<ReadState, "calls" | "closedCalls">,
): OpenCall | undefined {
	const { calls, closedCalls } = state;
	const named = typeof item.id === "string" ? calls.get(item.id) : undefined;
	if (named || calls.size !== 1) return named;
	const [call] = calls.values();
	const started = payload.started_at_ms;
	if (
		typeof started !== "number" ||
		call.openedAt === undefined ||
		started < call.openedAt
	)
		return undefined;
	// Calls close in record order; one still open at the start makes the owner unknown.
	for (let index = closedCalls.length - 1; index >= 0; index -= 1) {
		const { openedAt, closedAt } = closedCalls[index];
		if (closedAt !== undefined && closedAt <= started) break;
		if (openedAt === undefined || openedAt <= started) return undefined;
	}
	return call;
}

/**
 * Codex records an operation only when it completes. One that started before
 * an earlier operation finished gets a start position right after the latest
 * one that finished by then, so it does not count as starting after the rest.
 * A completion is taken at no earlier than any before it in the record, and
 * one without a recorded time at the latest time before it.
 */
function orderStart(
	event: RetroToolEventV1,
	payload: JsonRecord,
	completions: Completion[],
): void {
	const { started_at_ms: started, completed_at_ms: done } = payload;
	const latest = completions.at(-1)?.at;
	completions.push({
		ordinal: event.ordinal,
		at: typeof done === "number" ? Math.max(done, latest ?? done) : latest,
	});
	if (typeof started !== "number" || latest === undefined) return;
	if (latest <= started) return;
	// Completion times never decrease, so the first at or before the start ends the scan.
	let before: number | undefined;
	for (let index = completions.length - 2; index >= 0; index -= 1) {
		const { ordinal, at } = completions[index];
		if (at === undefined || at <= started) {
			before = ordinal;
			break;
		}
	}
	event.startOrdinal = before === undefined ? 0 : before + 1;
}

/** Model calls open and close; messages may carry instruction sources. */
function readResponseItem(
	payload: JsonRecord,
	ordinal: number,
	state: ReadState,
	recordedAt: number | undefined,
): void {
	if (CALL_TYPES.has(payload.type as string)) {
		if (typeof payload.call_id !== "string")
			throw formatError(ordinal, "has a tool call without call_id");
		state.calls.set(payload.call_id, {
			ordinal,
			openedAt: recordedAt,
			events: [],
		});
		return;
	}
	if (OUTPUT_TYPES.has(payload.type as string)) {
		closeCall(payload, ordinal, state, recordedAt);
		return;
	}
	if (payload.type === "message")
		state.instructions.push(...instructionLoads(payload, ordinal));
}

/**
 * Codex shortens a call's output as a whole: an unshortened output shortened
 * none of its operations, and a shortened one is known to be the operation's
 * only when the call ran one.
 */
function closeCall(
	payload: JsonRecord,
	ordinal: number,
	state: ReadState,
	recordedAt: number | undefined,
): void {
	const call =
		typeof payload.call_id === "string"
			? state.calls.get(payload.call_id)
			: undefined;
	if (!call)
		throw formatError(ordinal, "has a tool output without a matching call");
	state.calls.delete(payload.call_id as string);
	state.closedCalls.push({ openedAt: call.openedAt, closedAt: recordedAt });
	const truncated = TRUNCATION_MARKER.test(retroContentText(payload.output));
	if (truncated && call.events.length !== 1) return;
	for (const index of call.events) state.tools[index].truncated = truncated;
}

/** The operations Codex records as completed items; other items are not tool events. */
function operationEvent(
	item: JsonRecord,
	ordinal: number,
): RetroToolEventV1 | undefined {
	switch (item.type) {
		case "CommandExecution":
			return commandEvent(item, ordinal);
		case "FileChange":
			return fileChangeEvent(item, ordinal);
		case "McpToolCall":
			return mcpEvent(item, ordinal);
		case "ImageView":
			return event({
				ordinal,
				tool: "view_image",
				category: "read",
				input: { path: item.path },
				outputBytes: 0,
				failed: false,
			});
		case "Extension":
			return item.kind === "web.search"
				? event({
						ordinal,
						tool: "web_search",
						category: "other",
						input: item.action ?? {},
						outputBytes: jsonBytes(item.results ?? []),
						failed: false,
					})
				: undefined;
		default:
			return undefined;
	}
}

type Operation = {
	ordinal: number;
	tool: string;
	category: RetroToolEventV1["category"];
	input: unknown;
	outputBytes: number;
	failed: boolean;
};

function event(operation: Operation): RetroToolEventV1 {
	// Codex records an operation once, when it completes.
	return {
		ordinal: operation.ordinal,
		resultOrdinal: operation.ordinal,
		tool: operation.tool,
		category: operation.category,
		inputSha256: sha256(stableJson(operation.input)),
		outputBytes: operation.outputBytes,
		failed: operation.failed,
	};
}

/** A command is identified by its shell script alone, as a Claude Bash call is. */
function commandEvent(item: JsonRecord, ordinal: number): RetroToolEventV1 {
	const argv = item.command;
	if (
		!Array.isArray(argv) ||
		argv.length === 0 ||
		!argv.every((part) => typeof part === "string")
	)
		throw formatError(ordinal, "has a command without an argument list");
	const script =
		argv.length >= 3 && /^-l?c$/.test(argv[1]) ? argv[2] : argv.join(" ");
	const exitCode = Number.isSafeInteger(item.exit_code)
		? (item.exit_code as number)
		: undefined;
	const result = event({
		ordinal,
		tool: "exec_command",
		category: classifyShellCommand(script),
		input: { command: script },
		outputBytes: textBytes(item.aggregated_output),
		failed:
			item.status !== "completed" || (exitCode !== undefined && exitCode !== 0),
	});
	if (exitCode !== undefined) result.exitCode = exitCode;
	result.outputCapped =
		typeof item.aggregated_output === "string" &&
		item.aggregated_output.includes(PERSISTED_CAP_MARKER);
	if (result.category === "search") {
		const empty = isEmptyShellSearch(script, result);
		if (empty !== undefined) result.emptyResult = empty;
	}
	return result;
}

function fileChangeEvent(item: JsonRecord, ordinal: number): RetroToolEventV1 {
	if (!isRecord(item.changes))
		throw formatError(ordinal, "has a file change without changes");
	return event({
		ordinal,
		tool: "apply_patch",
		category: "edit",
		input: item.changes,
		outputBytes: textBytes(item.stdout) + textBytes(item.stderr),
		failed: item.status !== "completed",
	});
}

function mcpEvent(item: JsonRecord, ordinal: number): RetroToolEventV1 {
	if (typeof item.server !== "string" || typeof item.tool !== "string")
		throw formatError(ordinal, "has an MCP call without server or tool");
	const result = isRecord(item.result) ? item.result : {};
	return event({
		ordinal,
		tool: `mcp__${item.server}__${item.tool}`,
		category: "mcp",
		input: { server: item.server, tool: item.tool, arguments: item.arguments },
		outputBytes: retroContentBytes(result.content),
		failed: item.status !== "completed" || result.isError === true,
	});
}

/**
 * Instruction sources in a message: the AGENTS.md message Codex sends as the
 * user, split into the user's file and the project docs, and the skills
 * listing it sends as the developer.
 */
function instructionLoads(
	payload: JsonRecord,
	ordinal: number,
): RetroInstructionLoadV1[] {
	if (!Array.isArray(payload.content)) return [];
	return payload.content.flatMap((part): RetroInstructionLoadV1[] => {
		const text =
			isRecord(part) && typeof part.text === "string" ? part.text : "";
		if (payload.role === "user" && text.startsWith(AGENTS_HEADER))
			return agentsLoads(text, ordinal);
		if (payload.role === "developer" && text.startsWith(SKILLS_TAG))
			return [{ ordinal, source: "skills", kind: "skills", content: text }];
		return [];
	});
}

/**
 * Without the separator the message holds the user's file or the project docs
 * alone, which the record does not distinguish. A message with the heading but
 * no INSTRUCTIONS block is the user's own text, not a source.
 */
function agentsLoads(text: string, ordinal: number): RetroInstructionLoadV1[] {
	const block = AGENTS_BLOCK.exec(text);
	if (!block) return [];
	const [, directory, body] = block;
	const split = body.indexOf(PROJECT_DOC_SEPARATOR);
	if (split === -1)
		return [
			{ ordinal, source: `agents:${directory}`, kind: "other", content: body },
		];
	return [
		{
			ordinal,
			source: "agents:user",
			kind: "user",
			content: body.slice(0, split),
		},
		{
			ordinal,
			source: `agents:${directory}`,
			kind: "project",
			content: body.slice(split + PROJECT_DOC_SEPARATOR.length),
		},
	];
}

function textBytes(value: unknown): number {
	return typeof value === "string" ? Buffer.byteLength(value) : 0;
}

function jsonBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? "");
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(ordinal: number, detail: string): Error {
	return new Error(`codex session record ${ordinal} ${detail}`);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
