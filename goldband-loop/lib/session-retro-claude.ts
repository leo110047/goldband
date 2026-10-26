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
	type RetroInstructionLoadV1,
	type RetroSessionListing,
	type RetroSessionLocation,
	type RetroSessionRead,
	type RetroSourceKind,
	type RetroToolCategory,
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
 * Claude Code session adapter. Claude records live at
 * `<claude home>/projects/<project>/<session id>.jsonl`; this module is the only
 * place that knows their record shapes.
 */

type JsonRecord = Record<string, unknown>;

type PendingCall = {
	ordinal: number;
	name: string;
	inputSha256: string;
	command?: string;
};

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Memory file types Claude records on instruction attachments. */
const SOURCE_KINDS: Record<string, RetroSourceKind> = {
	User: "user",
	Project: "project",
	Local: "local",
	AutoMem: "memory",
	Managed: "managed",
};
/**
 * The skill listing is one source. An initial listing replaces it; a later
 * listing adds skills or replaces the entries of skills it names again.
 */
const SKILL_LISTING = "skill-listing";
const INSTRUCTION_ATTACHMENTS = new Set<unknown>([
	"instructions",
	"nested_memory",
	"skill_listing",
]);
/** A name may hold a plugin namespace, as in `- plugin:skill: description`. */
const SKILL_ENTRY = /^- (\S+):(?:\s|$)/;
const SESSION_FILE_RE = /^([A-Za-z0-9-]{8,64})\.jsonl$/;

export function locateClaudeSession(
	sessionId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): RetroSessionLocation {
	const id = sessionId ?? env.CLAUDE_CODE_SESSION_ID;
	if (!id) {
		return {
			status: "blocked",
			reason: "no current Claude session id; pass a session id",
		};
	}
	if (!RETRO_SESSION_ID_RE.test(id))
		return { status: "blocked", reason: "invalid Claude session id" };
	const listed = projectDirectories(env);
	const matches = listed.projects
		.map((project) => join(project, `${id}.jsonl`))
		.filter((file) => existsSync(file) && lstatSync(file).isFile());
	if (matches.length === 0)
		return {
			status: "blocked",
			reason: `Claude session not found: ${id}${retroUnreadableNote(listed.unreadable)}`,
		};
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
}): RetroSessionListing {
	const listed = projectDirectories(options.env ?? process.env);
	let unreadableDirectories = listed.unreadable;
	const files = listed.projects.flatMap((project) => {
		const listed = sessionFiles(project);
		if (!listed) unreadableDirectories += 1;
		return listed ?? [];
	});
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
	return {
		sessions,
		ambiguous: repeatedSessionIds(files),
		unreadableDirectories,
		unreadRecords: 0,
	};
}

type SessionFile = { sessionId: string; path: string; mtime: number };

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

/**
 * Project directories under the Claude home; a linked one could point outside
 * it. A `projects` directory that is a link or cannot be listed is counted.
 */
function projectDirectories(env: NodeJS.ProcessEnv): {
	projects: string[];
	unreadable: number;
} {
	const projects = join(
		env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"),
		"projects",
	);
	const kind = retroDirectoryKind(projects);
	if (kind !== "directory")
		return { projects: [], unreadable: kind === "unreadable" ? 1 : 0 };
	try {
		return {
			projects: readdirSync(projects, { withFileTypes: true })
				.filter((project) => project.isDirectory())
				.map((project) => join(projects, project.name)),
			unreadable: 0,
		};
	} catch {
		return { projects: [], unreadable: 1 };
	}
}

type RecordLocation = { cwd: string; sessionId: unknown };

/** The first record within the head of the file that has a `cwd`. */
function firstWorkingDirectory(path: string): RecordLocation | undefined {
	return scanSessionHead(path, (record) =>
		record &&
		typeof record === "object" &&
		typeof (record as JsonRecord).cwd === "string"
			? {
					cwd: (record as JsonRecord).cwd as string,
					sessionId: (record as JsonRecord).sessionId,
				}
			: undefined,
	);
}

/** Reads one Claude session snapshot; a record that does not match the known format fails the read. */
export function readClaudeSession(
	path: string,
	sessionId: string,
): RetroSessionRead {
	const state: ReadState = {
		pending: new Map(),
		usage: new Map(),
		tools: [],
		instructions: [],
		skills: new Map(),
	};
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
			readRecord(record, ordinal, state);
		},
	);
	if (ownRecords === 0)
		throw new Error(
			`claude session record has no entries for session ${sessionId}`,
		);
	const tools = state.tools.sort((a, b) => a.ordinal - b.ordinal);
	const unfinished = [...state.pending.values()]
		.map((call) => call.ordinal)
		.sort((a, b) => a - b);
	return {
		snapshot,
		path,
		tools,
		unfinished,
		usage: retroUsageTotals(state.usage.values()),
		instructions: state.instructions,
	};
}

type ReadState = {
	pending: Map<string, PendingCall>;
	usage: Map<string, { ordinal: number; input: number; output: number }>;
	tools: RetroToolEventV1[];
	instructions: RetroInstructionLoadV1[];
	/** Listed skill entries by name, in listing order. */
	skills: Map<string, string>;
};

function readRecord(record: JsonRecord, ordinal: number, state: ReadState) {
	if (record.type === "assistant")
		readAssistant(record, ordinal, state.pending, state.usage);
	if (record.type === "user")
		readUser(record, ordinal, state.pending, state.tools);
	if (record.type === "attachment")
		state.instructions.push(...instructionLoads(record, ordinal, state.skills));
}

/**
 * Instruction loads in an attachment record: `instructions` files, a
 * `nested_memory` file, or a `skill_listing`. Skill listings after the first
 * add skills, so their contents join one source.
 */
function instructionLoads(
	record: JsonRecord,
	ordinal: number,
	skills: Map<string, string>,
): RetroInstructionLoadV1[] {
	// Other attachment kinds are not read, whatever their shape.
	if (
		typeof record.attachment !== "object" ||
		record.attachment === null ||
		!INSTRUCTION_ATTACHMENTS.has((record.attachment as JsonRecord).type)
	)
		return [];
	const attachment = record.attachment as JsonRecord;
	if (attachment.type === "instructions") {
		if (!Array.isArray(attachment.files))
			throw formatError(ordinal, "has instructions without a file list");
		return attachment.files.map((file) => memoryFile(file, ordinal));
	}
	if (attachment.type === "nested_memory")
		return [memoryFile(attachment.content, ordinal)];
	if (typeof attachment.content !== "string")
		throw formatError(ordinal, "has a skill listing without content");
	if (attachment.isInitial !== false) skills.clear();
	for (const [name, entry] of skillEntries(attachment.content)) {
		skills.delete(name);
		skills.set(name, entry);
	}
	return [
		{
			ordinal,
			source: SKILL_LISTING,
			kind: "skills",
			content: [...skills.values()].join("\n"),
		},
	];
}

/** `- name: description` entries, each with the lines that continue it. */
function skillEntries(content: string): [string, string][] {
	const entries: [string, string][] = [];
	for (const line of content.split("\n")) {
		const name = SKILL_ENTRY.exec(line)?.[1];
		const last = entries.at(-1);
		if (name !== undefined) entries.push([name, line]);
		else if (last) last[1] += `\n${line}`;
		else if (line.trim()) entries.push(["", line]);
	}
	return entries;
}

function memoryFile(value: unknown, ordinal: number): RetroInstructionLoadV1 {
	const file = asRecord(value, `claude session record ${ordinal} memory file`);
	if (typeof file.path !== "string" || typeof file.content !== "string")
		throw formatError(ordinal, "has a memory file without path or content");
	return {
		ordinal,
		source: file.path,
		kind: Object.hasOwn(SOURCE_KINDS, String(file.type))
			? SOURCE_KINDS[String(file.type)]
			: "other",
		content: file.content,
	};
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
				retroTokenCount(tokens.input_tokens) +
				retroTokenCount(tokens.cache_creation_input_tokens) +
				retroTokenCount(tokens.cache_read_input_tokens),
			output: retroTokenCount(tokens.output_tokens),
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
	const text = retroContentText(result.content);
	const failed = result.is_error === true;
	const event: RetroToolEventV1 = {
		ordinal: call.ordinal,
		resultOrdinal: call.resultOrdinal,
		tool: call.name,
		category: category(call, detail),
		inputSha256: call.inputSha256,
		outputBytes: retroContentBytes(result.content),
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

function contentBlocks(message: JsonRecord, ordinal: number): JsonRecord[] {
	if (typeof message.content === "string") return [];
	if (!Array.isArray(message.content))
		throw formatError(ordinal, "has message content that is not a list");
	return message.content.filter(
		(block): block is JsonRecord => typeof block === "object" && block !== null,
	);
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
