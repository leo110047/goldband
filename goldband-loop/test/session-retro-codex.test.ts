import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseKnowledgeFile } from "../lib/knowledge";
import { analyzeRetroSession } from "../lib/session-retro-analysis";
import { listCodexSessions, locateCodexSession, readCodexSession } from "../lib/session-retro-codex";
import type { RetroReportV1 } from "../lib/session-retro-evidence";
import { runRetroEvidence, runRetroProposals, runRetroRange } from "../lib/session-retro-runtime";
import { stableJson } from "../lib/stable-json";
import { getWorkflow } from "../workflows/registry";
import { runWorkflow } from "../workflows/runtime";

const ROOT = path.resolve(import.meta.dir, "..");
const THREAD = "01a15337-dd05-73d2-8994-c31c0e989222";
// Canary values are assembled at runtime so secret scanners never see them in source.
const CANARY = {
	prompt: "CANARY-PROMPT-7f3a",
	file: "CANARY-FILE-CONTENT-9c1e",
	email: ["canary.person", "example.com"].join("@"),
	secret: `AKIA${"Q7".repeat(8)}`,
};
const SHARED = "Use plain Traditional Chinese for discussion and English for code.";
const RULE = "Never weaken, skip, or delete a test to make it pass.";
const cleanup: string[] = [];

afterEach(() => {
	for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

function tempHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "goldband-retro-codex-"));
	cleanup.push(home);
	return home;
}

function meta(id = THREAD, extra: Json = {}): Json {
	return { type: "session_meta", payload: { id, session_id: id, cwd: "/repo", source: "cli", ...extra } };
}

function completed(item: Json, times: [number, number] = [0, 0]): Json {
	return { type: "event_msg", payload: { type: "item_completed", item, started_at_ms: times[0], completed_at_ms: times[1] } };
}

function command(script: string, exitCode = 0, output = "", times?: [number, number]): Json {
	return completed({
		type: "CommandExecution",
		command: ["/bin/zsh", "-lc", script],
		cwd: "/repo",
		parsed_cmd: [{ type: "unknown", cmd: script }],
		status: exitCode === 0 ? "completed" : "failed",
		aggregated_output: output,
		exit_code: exitCode,
	}, times);
}

function patch(file: string, content: string, times?: [number, number]): Json {
	return completed({ type: "FileChange", changes: { [file]: { type: "add", content } }, status: "completed", stdout: "ok", stderr: "" }, times);
}

function call(id: string, recordedAt = 0): Json {
	return {
		timestamp: new Date(recordedAt).toISOString(),
		type: "response_item",
		payload: { type: "custom_tool_call", call_id: id, name: "exec", input: CANARY.prompt },
	};
}

function output(id: string, text: string, recordedAt = 0): Json {
	return {
		timestamp: new Date(recordedAt).toISOString(),
		type: "response_item",
		payload: { type: "custom_tool_call_output", call_id: id, output: [{ type: "input_text", text }] },
	};
}

function usage(response: string, input: number, out: number): Json {
	return { type: "token_usage_record", payload: { response_id: response, usage: { input_tokens: input, output_tokens: out } } };
}

function message(role: string, text: string): Json {
	return { type: "response_item", payload: { type: "message", role, content: [{ type: "input_text", text }] } };
}

function agents(directory: string, body: string): Json {
	return message("user", `# AGENTS.md instructions for ${directory}\n\n<INSTRUCTIONS>\n${body}\n</INSTRUCTIONS>`);
}

/**
 * Ordinals: an exec call at 1 runs searches at 2 and 3, a listing at 4, and
 * an empty search at 5, and its output at 6 is truncated; a second call at 7
 * runs a read at 8, edits at 9 and 11 around a failing `npm test` at 10 that
 * passes at 12, and a failed MCP call at 13, closing at 14. Usage at 15-17
 * repeats response r1. `npm run lint` fails at 18 outside a call, a call at 19
 * never closes, then a web search at 20 and an image view at 21.
 */
function sessionRecords(): Json[] {
	return [
		meta(),
		call("x1"),
		command("rg foo src", 0, "a.ts\nb.ts"),
		command("rg foo src", 0, "a.ts\nb.ts"),
		command("ls src", 0, "a.ts"),
		command("rg missing src", 1),
		output("x1", "Exit code 0\n…120 tokens truncated…"),
		call("x2"),
		command("cat src/a.ts", 0, `export const value = "${CANARY.file}";`),
		patch("/repo/a.ts", CANARY.file),
		command("npm test", 1, `mail ${CANARY.email} key ${CANARY.secret}`),
		patch("/repo/b.ts", "fixed"),
		command("npm test", 0, "ok"),
		completed({ type: "McpToolCall", server: "docs", tool: "read", arguments: { id: "doc" }, status: "failed", result: { content: [{ type: "text", text: "denied" }], isError: true } }),
		output("x2", "done"),
		usage("r1", 100, 10),
		usage("r1", 120, 12),
		usage("r2", 50, 5),
		command("npm run lint", 2, "lint error"),
		call("x3"),
		completed({ type: "Extension", kind: "web.search", action: { type: "search", query: "x" }, results: [{ title: "t" }] }),
		completed({ type: "ImageView", path: "/repo/shot.png" }),
	];
}

/**
 * Instruction loads: AGENTS.md for /repo at 1 joins the user's file (SHARED,
 * RULE) and the project docs (SHARED); one for /repo/sub at 2 has no
 * separator (RULE); skills at 3; AGENTS.md for /repo again at 4 with new
 * project docs (SHARED and more).
 */
function instructionRecords(): Json[] {
	const user = `# Global\n\n${SHARED}\n\n- ${RULE}`;
	return [
		meta(),
		agents("/repo", `${user}\n\n--- project-doc ---\n\n${SHARED}`),
		agents("/repo/sub", `1. ${RULE}`),
		message("developer", "<skills_instructions>\n## Skills\n- alpha: Alpha skill description that is long enough (file: /s/a)\n</skills_instructions>"),
		agents("/repo", `${user}\n\n--- project-doc ---\n\n${SHARED}\n\nProject guidance that is long enough to count as a paragraph.`),
		command("ls", 0, "a"),
	];
}

function writeSession(home: string, records: Json[], options: { id?: string; day?: string; tail?: string } = {}): string {
	const id = options.id ?? THREAD;
	const dir = path.join(home, ".codex", "sessions", ...(options.day ?? "2026/10/19").split("/"));
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `rollout-2026-10-19T16-12-12-${id}.jsonl`);
	fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n${options.tail ?? ""}`);
	return file;
}

function env(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const base = { ...process.env };
	for (const key of ["CODEX_HOME", "CODEX_THREAD_ID", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_SESSION_ID"]) delete base[key];
	return { ...base, HOME: home, GOLDBAND_HOME: path.join(home, ".goldband"), ...extra };
}

function retroCli(home: string, cwd: string, args: string[]) {
	return spawnSync("bun", [path.join(ROOT, "bin", "goldband-retro.ts"), ...args], { cwd, env: env(home), encoding: "utf8" });
}

function filesUnder(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name));
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ordinals = (refs: string[]) => refs.map((ref) => Number(ref.slice(ref.lastIndexOf("#") + 1)));

const metrics = (report: RetroReportV1, rule: string) => report.evidence.filter((item) => item.rule === rule).map((item) => item.metric);

function pick(report: RetroReportV1, rule: string) {
	return report.evidence.filter((item) => item.rule === rule).map((item) => ({
		value: item.metric?.value,
		refs: ordinals(item.refs),
		...(item.tool ? { tool: item.tool } : {}),
		...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
	}));
}

describe("Codex session adapter", () => {
	test("locates a thread by id or the current thread and blocks missing or ambiguous ids", () => {
		const home = tempHome();
		const file = writeSession(home, sessionRecords());
		expect(locateCodexSession(THREAD, env(home))).toEqual({ status: "found", sessionId: THREAD, path: file });
		expect(locateCodexSession(undefined, env(home, { CODEX_THREAD_ID: THREAD }))).toEqual({ status: "found", sessionId: THREAD, path: file });
		expect(locateCodexSession(undefined, env(home))).toMatchObject({ status: "blocked", reason: "no current Codex thread id; pass a session id" });
		expect(locateCodexSession("../x", env(home))).toMatchObject({ status: "blocked", reason: "invalid Codex session id" });
		expect(locateCodexSession(THREAD.toUpperCase(), env(home))).toMatchObject({ status: "blocked", reason: "invalid Codex session id" });
		expect(locateCodexSession("01a15337-dd05-73d2-8994-000000000000", env(home))).toMatchObject({ status: "blocked", reason: expect.stringContaining("not found") });
		const custom = path.join(home, "custom");
		fs.cpSync(path.join(home, ".codex"), custom, { recursive: true });
		expect(locateCodexSession(THREAD, env(home, { CODEX_HOME: custom }))).toMatchObject({ status: "found", path: expect.stringContaining(custom) });
		writeSession(home, sessionRecords(), { day: "2026/10/20" });
		expect(locateCodexSession(THREAD, env(home))).toMatchObject({ status: "blocked", reason: `Codex session id is ambiguous: ${THREAD}` });
	});

	test("does not follow a linked date directory", () => {
		const home = tempHome();
		const outside = tempHome();
		writeSession(outside, sessionRecords());
		fs.mkdirSync(path.join(home, ".codex", "sessions", "2026"), { recursive: true });
		fs.symlinkSync(path.join(outside, ".codex", "sessions", "2026", "10"), path.join(home, ".codex", "sessions", "2026", "10"));
		expect(locateCodexSession(THREAD, env(home))).toMatchObject({ status: "blocked", reason: expect.stringContaining("not found") });
	});

	test("does not follow a linked sessions directory", () => {
		const home = tempHome();
		const outside = tempHome();
		writeSession(outside, sessionRecords());
		fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
		fs.symlinkSync(path.join(outside, ".codex", "sessions"), path.join(home, ".codex", "sessions"));
		expect(locateCodexSession(THREAD, env(home))).toEqual({
			status: "blocked",
			reason: `Codex session not found: ${THREAD}; 1 record directories could not be listed`,
		});
		expect(listCodexSessions({ since: 0, env: env(home) })).toMatchObject({ sessions: [], unreadableDirectories: 1 });
	});

	test("marks truncation only for the call that ran an operation", () => {
		const home = tempHome();
		const mcp = (id: string) => ({ ...completed({ type: "McpToolCall", id, server: "docs", tool: "read", arguments: {}, status: "completed", result: { content: [] } }, [5, 6]) });
		const records = [
			meta(),
			call("a"),
			call("b"),
			// Two calls open: a command is unattributed, an MCP item names its call.
			command("ls", 0, "x"),
			mcp("b"),
			output("a", "full"),
			output("b", "…9 tokens truncated…"),
			// A background command that started before the only open call was recorded.
			call("c", 2000),
			command("sleep 9", 0, "late", [1000, 2500]),
			command("ls", 0, "x", [2100, 2200]),
			output("c", "…9 tokens truncated…", 2300),
			// Started while d and e were open; d closed before it finished.
			call("d", 3000),
			call("e", 3000),
			output("d", "full", 3600),
			command("ls", 0, "x", [3500, 3700]),
			output("e", "…9 tokens truncated…", 3800),
		];
		const tools = readCodexSession(writeSession(home, records), THREAD).tools;
		expect(tools.map((event) => [event.ordinal, event.truncated])).toEqual([
			[3, undefined],
			[4, true],
			[8, undefined],
			[9, true],
			[14, undefined],
		]);
	});

	test("reads only the operations of its own thread", () => {
		const home = tempHome();
		const foreign = command("npm test", 1, "fail");
		(foreign.payload as Json).thread_id = "01a15337-dd05-73d2-8994-000000000000";
		const own = command("ls", 0, "x");
		(own.payload as Json).thread_id = THREAD;
		const records = [meta(), foreign, own, { type: "toString", payload: {} }, { type: "__proto__", payload: {} }, { type: "constructor" }];
		expect(readCodexSession(writeSession(home, records), THREAD).tools.map((event) => event.ordinal)).toEqual([2]);
	});

	test("counts lookups that started before the first edit finished as before it", () => {
		const home = tempHome();
		const records = [
			meta(),
			// Started first and finished first; the edit started while it ran.
			command("rg foo", 0, "a.ts", [10, 50]),
			patch("/repo/a.ts", "fixed", [20, 100]),
			// Started before the edit finished and finished after it.
			command("rg baz", 0, "a.ts", [0, 110]),
			command("rg bar", 0, "a.ts", [120, 130]),
		];
		const report = analyzeRetroSession(readCodexSession(writeSession(home, records), THREAD));
		expect(pick(report, "first-edit")).toEqual([{ value: 2, refs: [2] }]);
		expect(pick(report, "pre-edit-searches")).toEqual([{ value: 2, refs: [1, 3] }]);
	});

	test("marks command output Codex persisted only in part as a lower bound", () => {
		const home = tempHome();
		const capped = `${"a".repeat(100)}\n... command output truncated for persistence ...\n${"b".repeat(100)}`;
		const records = [meta(), command("git diff", 0, capped), command("git status", 0, "clean")];
		const session = readCodexSession(writeSession(home, records), THREAD);
		expect(session.tools.map((event) => event.outputCapped)).toEqual([true, false]);
		const report = analyzeRetroSession(session);
		expect(metrics(report, "top-output")).toEqual([
			{ value: Buffer.byteLength(capped), unit: "bytes", lowerBound: true },
			{ value: 5, unit: "bytes" },
		]);
		expect(metrics(report, "output-by-tool")).toEqual([{ value: Buffer.byteLength(capped) + 5, unit: "bytes", lowerBound: true }]);
	});

	test("reads a user message with the AGENTS.md heading but no INSTRUCTIONS block as user text", () => {
		const home = tempHome();
		const records = [meta(), message("user", "# AGENTS.md instructions for /repo\n\nloose text"), command("ls", 0, "x")];
		const session = readCodexSession(writeSession(home, records), THREAD);
		expect(session.instructions).toEqual([]);
		expect(session.tools).toHaveLength(1);
	});

	test("orders a start against completion times that never decrease", () => {
		const home = tempHome();
		const untimed = command("ls", 0, "x");
		delete (untimed.payload as Json).started_at_ms;
		delete (untimed.payload as Json).completed_at_ms;
		// The check started at 50, before the edit finished at 100; the untimed
		// completion recorded after the edit finished no earlier than it.
		const records = [meta(), patch("/repo/a.ts", "fixed", [20, 100]), untimed, command("npm test", 0, "ok", [50, 130]), command("npm test", 1, "fail", [90, 80])];
		const session = readCodexSession(writeSession(home, records), THREAD);
		expect(session.tools.map((event) => [event.ordinal, event.startOrdinal])).toEqual([
			[1, undefined],
			[2, undefined],
			[3, 0],
			[4, 0],
		]);
		expect(pick(analyzeRetroSession(session), "commands-after-last-edit")).toEqual([{ value: 0, refs: [1] }]);
	});

	test("takes an earlier completion without a recorded time to precede a start", () => {
		const home = tempHome();
		const untimed = patch("/repo/a.ts", "fixed");
		delete (untimed.payload as Json).started_at_ms;
		delete (untimed.payload as Json).completed_at_ms;
		const records = [meta(), command("npm test", 1, "fail", [0, 100]), untimed, command("ls", 0, "x", [110, 120]), command("npm test", 0, "ok", [105, 130])];
		const session = readCodexSession(writeSession(home, records), THREAD);
		expect(session.tools.map((event) => [event.ordinal, event.startOrdinal])).toEqual([
			[1, undefined],
			[2, undefined],
			[3, undefined],
			[4, 3],
		]);
		expect(pick(analyzeRetroSession(session), "commands-after-last-edit")).toEqual([{ value: 1, refs: [4] }]);
	});

	test("does not count a check that started before an edit finished as after it", () => {
		const home = tempHome();
		const records = [
			meta(),
			command("npm test", 1, "fail", [0, 10]),
			patch("/repo/a.ts", "fixed", [20, 30]),
			// Started at 25, before the edit finished at 30.
			command("npm test", 0, "ok", [25, 40]),
			command("npm run lint", 0, "ok", [50, 60]),
		];
		const session = readCodexSession(writeSession(home, records), THREAD);
		expect(session.tools.map((event) => [event.ordinal, event.startOrdinal])).toEqual([
			[1, undefined],
			[2, undefined],
			[3, 2],
			[4, undefined],
		]);
		const report = analyzeRetroSession(session);
		expect(pick(report, "commands-after-last-edit")).toEqual([{ value: 1, refs: [4] }]);
		expect(pick(report, "failed-then-passed")).toEqual([]);
		expect(pick(report, "failed-then-passed-groups")).toEqual([]);
	});

	test("maps operations to events with exit codes, categories, and call truncation", () => {
		const home = tempHome();
		const session = readCodexSession(writeSession(home, sessionRecords()), THREAD);
		expect(session.tools.map((event) => [event.ordinal, event.tool, event.category, event.failed, event.exitCode, event.truncated, event.emptyResult])).toEqual([
			// One shortened call ran these four, so none is known to be shortened.
			[2, "exec_command", "search", false, 0, undefined, false],
			[3, "exec_command", "search", false, 0, undefined, false],
			[4, "exec_command", "list", false, 0, undefined, undefined],
			[5, "exec_command", "search", true, 1, undefined, true],
			[8, "exec_command", "read", false, 0, false, undefined],
			[9, "apply_patch", "edit", false, undefined, false, undefined],
			[10, "exec_command", "command", true, 1, false, undefined],
			[11, "apply_patch", "edit", false, undefined, false, undefined],
			[12, "exec_command", "command", false, 0, false, undefined],
			[13, "mcp__docs__read", "mcp", true, undefined, false, undefined],
			[18, "exec_command", "command", true, 2, undefined, undefined],
			[20, "web_search", "other", false, undefined, undefined, undefined],
			[21, "view_image", "read", false, undefined, undefined, undefined],
		]);
		expect(session.tools.every((event) => event.resultOrdinal === event.ordinal)).toBe(true);
		// The same hash as a Claude Bash call with this command.
		expect(session.tools[0].inputSha256).toBe(sha(stableJson({ command: "rg foo src" })));
		expect(session.unfinished).toEqual([19]);
		expect(session.usage).toEqual({ firstOrdinal: 16, lastOrdinal: 17, inputTokens: 170, outputTokens: 17 });
	});

	test("fails on records that do not match the known format", () => {
		const home = tempHome();
		const read = (records: Json[], id = THREAD) => () => readCodexSession(writeSession(home, records), id);
		expect(read([meta(), { payload: {} }])).toThrow("codex session record 1 has no type");
		expect(read([meta(), { type: "event_msg" }])).toThrow("codex session record 1 has no payload");
		expect(read([meta(), meta("01a15337-dd05-73d2-8994-000000000000")])).toThrow("codex session record 1 belongs to another session");
		expect(read([{ type: "turn_context", payload: {} }])).toThrow(`codex session record has no session_meta for session ${THREAD}`);
		expect(read([meta(), { type: "response_item", payload: { type: "custom_tool_call", name: "exec" } }])).toThrow("has a tool call without call_id");
		expect(read([meta(), output("x9", "late")])).toThrow("codex session record 1 has a tool output without a matching call");
		expect(read([meta(), completed({ type: "CommandExecution", command: "ls", status: "completed" })])).toThrow("has a command without an argument list");
		expect(read([meta(), completed({ type: "FileChange", status: "completed" })])).toThrow("has a file change without changes");
		expect(read([meta(), { type: "world_state", payload: null }, completed({ type: "Reasoning" })])().tools).toEqual([]);
	});

	test("parses the de-identified sampled session", () => {
		const fixture = path.join(import.meta.dir, "fixtures", "session-retro", "codex-session.jsonl");
		const session = readCodexSession(fixture, "id-000003");
		expect(session.tools.length).toBe(81);
		expect(session.tools.filter((event) => event.category === "edit")).toHaveLength(3);
		expect(session.tools.filter((event) => event.exitCode !== undefined && event.exitCode !== 0)).toHaveLength(10);
		expect(session.usage).toBeDefined();
		const report = analyzeRetroSession(session);
		for (const facet of ["file-search", "auto-checks", "tool-cost", "info-access"] as const) expect(report.facets[facet]).toEqual({ status: "covered" });
		// The sampled window's instruction messages were scrubbed to filler.
		expect(report.facets["ineffective-instructions"]).toEqual({ status: "unavailable", reason: "not-recorded" });
	});
});

describe("measured Codex retro evidence", () => {
	function report(records = sessionRecords()) {
		const home = tempHome();
		return analyzeRetroSession(readCodexSession(writeSession(home, records), THREAD));
	}

	test("measures file search before the first edit and tool cost", () => {
		const value = report();
		expect(pick(value, "first-edit")).toEqual([{ value: 5, refs: [9] }]);
		expect(pick(value, "pre-edit-searches")).toEqual([{ value: 4, refs: [2, 3, 4, 5] }]);
		expect(pick(value, "pre-edit-reads")).toEqual([{ value: 1, refs: [8] }]);
		expect(pick(value, "duplicate-search")).toEqual([{ value: 2, refs: [2, 3], tool: "exec_command" }]);
		expect(pick(value, "empty-search")).toEqual([{ value: 1, refs: [5] }]);
		expect(pick(value, "truncated-output")).toEqual([]);
		expect(pick(value, "unfinished-call")).toEqual([{ value: 1, refs: [19] }]);
		expect(pick(value, "session-input-tokens")).toEqual([{ value: 170, refs: [16, 17] }]);
		expect(pick(value, "session-output-tokens")).toEqual([{ value: 17, refs: [16, 17] }]);
		expect(pick(value, "output-by-tool").map((item) => item.tool)).toEqual(expect.arrayContaining(["exec_command", "apply_patch", "mcp__docs__read", "web_search"]));
	});

	test("measures auto-checks and info-access over operations", () => {
		const value = report();
		expect(pick(value, "last-edit")).toEqual([{ value: 2, refs: [11] }]);
		expect(pick(value, "commands-after-last-edit")).toEqual([{ value: 2, refs: [12, 18] }]);
		expect(pick(value, "failed-then-passed")).toEqual([{ value: 1, refs: [10, 12], tool: "exec_command", exitCode: 1 }]);
		expect(pick(value, "unresolved-failure")).toEqual([{ value: 1, refs: [18], tool: "exec_command", exitCode: 2 }]);
		expect(pick(value, "nonzero-exit")).toEqual([{ value: 2, refs: [10, 18] }]);
		expect(pick(value, "exit-code")).toEqual([
			{ value: 1, refs: [10], exitCode: 1 },
			{ value: 1, refs: [18], exitCode: 2 },
		]);
		expect(pick(value, "failed-call")).toEqual([{ value: 1, refs: [13], tool: "mcp__docs__read" }]);
		expect(pick(value, "hook-blocked")).toEqual([]);
		expect(pick(value, "permission-blocked")).toEqual([]);
	});

	test("lists AGENTS.md and skills sources and their repeated paragraphs, covering all five facets", () => {
		const value = report(instructionRecords());
		expect(Object.values(value.facets).every((facet) => facet.status === "covered")).toBe(true);
		const user = `# Global\n\n${SHARED}\n\n- ${RULE}`;
		const project = `${SHARED}\n\nProject guidance that is long enough to count as a paragraph.`;
		const skills = "<skills_instructions>\n## Skills\n- alpha: Alpha skill description that is long enough (file: /s/a)\n</skills_instructions>";
		expect(value.evidence.filter((item) => item.rule === "instruction-source").map((item) => [item.sourceKind, ordinals(item.refs), item.contentSha256])).toEqual([
			["user", [1, 4], sha(user)],
			["project", [1, 4], sha(project)],
			["other", [2], sha(`1. ${RULE}`)],
			["skills", [3], sha(skills)],
		]);
		expect(value.evidence.filter((item) => item.rule === "duplicate-paragraph").map((item) => [item.contentSha256, item.metric?.value, ordinals(item.refs)])).toEqual([
			[sha(SHARED), 2, [4]],
			[sha(RULE), 2, [2, 4]],
		]);
	});
});

describe("Codex retro owner", () => {
	test("persists no session text, paths, or instruction text and writes candidates from a Codex snapshot", () => {
		const home = tempHome();
		const recordPath = writeSession(home, [...sessionRecords(), ...instructionRecords().slice(1)]);
		const stateRoot = path.join(home, ".goldband");
		const evidence = runRetroEvidence({ host: "codex", stateRoot, env: env(home, { CODEX_THREAD_ID: THREAD }) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		expect(evidence.report.snapshots[0]).toMatchObject({ host: "codex", sessionId: THREAD });
		expect(Object.values(evidence.report.facets).every((facet) => facet.status === "covered")).toBe(true);
		const key = `${THREAD}@${evidence.report.snapshots[0].sha256}`;
		const knowledge = path.join(stateRoot, "knowledge");
		const outcome = runRetroProposals(
			{
				sessionId: THREAD,
				sha256: evidence.report.snapshots[0].sha256,
				proposals: [
					{
						facet: "auto-checks",
						rule: "lint-before-handoff",
						severity: "medium",
						target: "lint",
						checkClass: "mechanical",
						summary: "Run the linter after the last edit",
						practice: "Add the lint command to the pre-commit hook.",
						context: "Sessions that end with a failing lint run.",
						refs: [`${key}#18`],
						evidence: [{ facet: "auto-checks", grade: "inferred", rule: "lint-not-rerun", refs: [`${key}#18`] }],
					},
				],
			},
			{ stateRoot, knowledgeRoot: knowledge, cwd: home },
		);
		if (outcome.status !== "completed") throw new Error(outcome.reason);
		expect(outcome.outcomes).toMatchObject([{ status: "written" }]);
		const entry = parseKnowledgeFile(path.join(knowledge, "entries", `${outcome.outcomes[0].id}.md`));
		expect(entry.body).toContain("- unresolved-failure: 1 count (exec_command)，#18");
		for (const file of filesUnder(stateRoot)) {
			const text = fs.readFileSync(file, "utf8");
			for (const value of [...Object.values(CANARY), recordPath, SHARED, RULE, "/repo", "AGENTS.md", "alpha"]) {
				expect({ file, value, leaked: text.includes(value) }).toEqual({ file, value, leaked: false });
			}
		}
	});
});

describe("Codex retro range", () => {
	function rangeHome() {
		const home = tempHome();
		const repo = path.join(home, "repo");
		fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
		expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
		return { home, repo: fs.realpathSync(repo) };
	}
	const id = (n: number) => `01a15337-dd05-73d2-8994-${String(n).padStart(12, "0")}`;
	const session = (home: string, n: number, cwd: string, extra: Json = {}, day = "2026/10/19") =>
		writeSession(home, [meta(id(n), { cwd, ...extra }), command("ls", 0, "a")], { id: id(n), day });

	test("analyzes this repository's threads, leaving out subagents, other directories, and old records", () => {
		const { home, repo } = rangeHome();
		session(home, 1, repo);
		session(home, 2, path.join(repo, "sub"));
		session(home, 3, path.join(home, "elsewhere"));
		session(home, 4, repo, { source: { subagent: "review" } });
		const old = session(home, 5, repo);
		fs.utimesSync(old, new Date(0), new Date(0));
		session(home, 6, repo);
		session(home, 6, repo, {}, "2026/10/20");
		writeSession(home, [{ type: "turn_context", payload: {} }], { id: id(7) });
		writeSession(home, [meta(id(1), { cwd: repo })], { id: id(8) });
		const compressed = writeSession(home, [meta(id(9), { cwd: repo })], { id: id(9) });
		fs.renameSync(compressed, `${compressed}.zst`);
		const result = runRetroRange({ host: "codex", days: 1, cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home) });
		if (result.status !== "completed") throw new Error(result.reason);
		expect(result.sessions.map((entry) => [entry.sessionId, entry.status, entry.status === "failed" ? entry.reason : ""])).toEqual([
			[id(1), "completed", ""],
			[id(2), "completed", ""],
			[id(6), "failed", `Codex session id is ambiguous: ${id(6)}`],
		]);
		expect(result).toMatchObject({ unlocated: 2, unreadableDirectories: 0, unreadRecords: 1 });
		expect(locateCodexSession(id(9), env(home))).toEqual({ status: "blocked", reason: `Codex session record is compressed and is not read: ${id(9)}` });
	});

	test("counts a date directory that cannot be listed", () => {
		if (process.getuid?.() === 0) return;
		const { home, repo } = rangeHome();
		session(home, 1, repo);
		const locked = path.dirname(session(home, 2, repo, {}, "2026/10/20"));
		fs.chmodSync(locked, 0o000);
		try {
			const result = runRetroRange({ host: "codex", days: 1, cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home) });
			expect(result).toMatchObject({ status: "completed", unreadableDirectories: 1, sessions: [{ sessionId: id(1), status: "completed" }] });
			expect(listCodexSessions({ since: 0, env: env(home) }).unreadableDirectories).toBe(1);
		} finally {
			fs.chmodSync(locked, 0o700);
		}
	});

	test("runs the CLI and the workflow for the Codex host", async () => {
		const { home, repo } = rangeHome();
		session(home, 1, repo);
		const cli = retroCli(home, repo, ["evidence", "--host", "codex", "--days", "1"]);
		expect(cli.status).toBe(0);
		expect(JSON.parse(cli.stdout)).toMatchObject({ status: "completed", sessions: [{ sessionId: id(1), status: "completed" }] });
		const single = retroCli(home, repo, ["evidence", "--host", "codex", "--session", id(1)]);
		expect(JSON.parse(single.stdout)).toMatchObject({ status: "completed", report: { snapshots: [{ host: "codex", sessionId: id(1) }] } });
		const missing = retroCli(home, repo, ["evidence", "--host", "codex"]);
		expect({ status: missing.status, out: JSON.parse(missing.stdout) }).toMatchObject({ status: 3, out: { reason: "no current Codex thread id; pass a session id" } });

		const goldbandHome = path.join(home, ".goldband");
		const inputFile = path.join(home, "input.json");
		fs.writeFileSync(inputFile, JSON.stringify({ mode: "evidence", sessionId: id(1) }));
		const saved = process.env.HOME;
		process.env.HOME = home;
		try {
			const run = await runWorkflow(getWorkflow("context/retro"), { mode: "real", host: "codex", cwd: repo, goldbandHome, inputFile });
			expect(run.output).toMatchObject({ status: "completed", report: { snapshots: [{ host: "codex" }] } });
		} finally {
			process.env.HOME = saved;
		}
	});
});
