import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createKnowledgeEntry, parseKnowledgeFile, transitionKnowledgeStatus, writeKnowledgeEntry } from "../lib/knowledge";
import { analyzeRetroSession, classifyShellCommand, isEmptyShellSearch } from "../lib/session-retro-analysis";
import { listClaudeSessions, locateClaudeSession, readClaudeSession } from "../lib/session-retro-claude";
import { RETRO_UNPROVEN_NOTE, runRetroEval } from "../lib/session-retro-eval";
import type { RetroToolEventV1 } from "../lib/session-retro-evidence";
import { readSessionSnapshot } from "../lib/session-retro-snapshot";
import { runRetroEvidence, runRetroProposals, runRetroRange } from "../lib/session-retro-runtime";
import { getWorkflow } from "../workflows/registry";
import { runWorkflow } from "../workflows/runtime";

const ROOT = path.resolve(import.meta.dir, "..");
const SESSION = "11111111-2222-4333-8444-555555555555";
// Canary values are assembled at runtime so secret scanners never see them in source.
const CANARY = {
	prompt: "CANARY-PROMPT-7f3a",
	file: "CANARY-FILE-CONTENT-9c1e",
	email: ["canary.person", "example.com"].join("@"),
	secret: `AKIA${"Q7".repeat(8)}`,
};
const cleanup: string[] = [];

afterEach(() => {
	for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

function tempHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "goldband-retro-"));
	cleanup.push(home);
	return home;
}

function call(message: string, id: string, name: string, input: Json, usage = { input_tokens: 10, output_tokens: 3 }): Json {
	return {
		type: "assistant",
		sessionId: SESSION,
		message: { id: message, role: "assistant", content: [{ type: "tool_use", id, name, input }], usage },
	};
}

function result(id: string, content: unknown, extra: Json = {}, isError = false): Json {
	const { toolUseResult, permissionDecision } = extra;
	return {
		type: "user",
		sessionId: SESSION,
		message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
		...(toolUseResult ? { toolUseResult } : {}),
		...(permissionDecision ? { permissionDecision } : {}),
	};
}

/** Ordinals: tool_use records sit on odd lines 1..21, the first edit at 13. */
function sessionRecords(): Json[] {
	return [
		{ type: "user", sessionId: SESSION, message: { role: "user", content: `please fix ${CANARY.prompt}` } },
		call("m1", "t1", "Grep", { pattern: "foo" }),
		result("t1", "a.ts\nb.ts", { toolUseResult: { mode: "files_with_matches", numFiles: 2 } }),
		call("m2", "t2", "Grep", { pattern: "foo" }),
		result("t2", "a.ts\nb.ts", { toolUseResult: { mode: "files_with_matches", numFiles: 2 } }),
		call("m3", "t3", "Glob", { pattern: "**/*.md" }),
		result("t3", "No files found", { toolUseResult: { numFiles: 0 } }),
		call("m4", "t4", "Bash", { command: "rg missing src" }),
		result("t4", "Exit code 1", { toolUseResult: { stdout: "", stderr: "", interrupted: false } }, true),
		call("m4", "t5", "Read", { file_path: "/repo/secret.ts" }),
		result("t5", `export const value = "${CANARY.file}";`),
		call("m5", "t6", "Bash", { command: "cat big.log | head -n 5" }),
		result("t6", "x".repeat(5000), { toolUseResult: { stdout: "", stderr: "", persistedOutputPath: "/tmp/out" } }),
		call("m6", "t7", "Edit", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }),
		result("t7", "ok"),
		call("m7", "t8", "Bash", { command: "npm test" }),
		result("t8", `Exit code 2\nmail ${CANARY.email} key ${CANARY.secret}`, { toolUseResult: { stdout: "", stderr: "" } }, true),
		call("m8", "t9", "Bash", { command: "git push --no-verify" }),
		result("t9", "PreToolUse:Bash hook denied", { permissionDecision: { decision: "reject", source: "hook" } }, true),
		call("m9", "t10", "mcp__docs__read", { id: "doc" }),
		result("t10", [{ type: "text", text: "mcp out" }]),
		call("m10", "t11", "Bash", { command: "sed -i s/a/b/ x" }),
		result("t11", "", { toolUseResult: { stdout: "", stderr: "", bashEditDiff: { changedFiles: ["x"], files: [], moreFiles: 0 } } }),
	];
}

/**
 * Commands around edits. Ordinals: `npm test` fails at 1 and passes at 5
 * after the edit at 3; `npm run lint` fails at 7 and 9 and never passes; `gh`
 * exits 4 at 11; WebFetch fails without an exit code at 13; an empty `rg` at
 * 15; a permission block at 17 and a hook block at 19; the last edit at 21;
 * then `npm test` at 23 and `curl` failing at 25 and passing at 27 with no
 * edit between.
 */
function checkRecords(): Json[] {
	const bash = (message: string, id: string, command: string) => call(message, id, "Bash", { command });
	const exit = (id: string, code: number) => result(id, `Exit code ${code}\n${CANARY.file}`, { toolUseResult: { stdout: "", stderr: "" } }, true);
	const ok = (id: string) => result(id, "ok", { toolUseResult: { stdout: "ok", stderr: "" } });
	return [
		{ type: "user", sessionId: SESSION, message: { role: "user", content: CANARY.prompt } },
		bash("m1", "c1", "npm test"),
		exit("c1", 1),
		call("m2", "c2", "Edit", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }),
		result("c2", "ok"),
		bash("m3", "c3", "npm test"),
		ok("c3"),
		bash("m4", "c4", "npm run lint"),
		exit("c4", 2),
		bash("m5", "c5", "npm run lint"),
		exit("c5", 2),
		bash("m6", "c6", "gh api repos/x"),
		exit("c6", 4),
		call("m7", "c7", "WebFetch", { url: "https://example.invalid/doc" }),
		result("c7", "Request failed with status 403", {}, true),
		bash("m8", "c8", "rg nothing src"),
		exit("c8", 1),
		call("m9", "c9", "Read", { file_path: "/repo/.env" }),
		result("c9", "Permission denied by user", { permissionDecision: { decision: "reject" } }, true),
		bash("m10", "c10", "./deploy.sh"),
		result("c10", "PreToolUse:Bash hook denied", { permissionDecision: { decision: "reject", source: "hook" } }, true),
		call("m11", "c11", "Write", { file_path: "/repo/b.ts", content: CANARY.file }),
		result("c11", "ok"),
		bash("m12", "c12", "npm test"),
		ok("c12"),
		bash("m13", "c13", "curl -fsS https://example.invalid"),
		exit("c13", 7),
		bash("m14", "c14", "curl -fsS https://example.invalid"),
		ok("c14"),
	];
}

function writeSession(home: string, records: Json[], tail = ""): string {
	const dir = path.join(home, ".claude", "projects", "-repo");
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${SESSION}.jsonl`);
	fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n${tail}`);
	return file;
}

function env(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const base = { ...process.env };
	delete base.CLAUDE_CONFIG_DIR;
	delete base.CLAUDE_CODE_SESSION_ID;
	delete base.CODEX_HOME;
	delete base.CODEX_THREAD_ID;
	return { ...base, HOME: home, GOLDBAND_HOME: path.join(home, ".goldband"), ...extra };
}

function retroCli(home: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
	return spawnSync("bun", [path.join(ROOT, "bin", "goldband-retro.ts"), ...args], {
		cwd: home,
		env: env(home, extra),
		encoding: "utf8",
	});
}

function proposal(report: { snapshots: { sessionId: string; sha256: string }[] }, overrides: Json = {}): Json {
	const key = `${report.snapshots[0].sessionId}@${report.snapshots[0].sha256}`;
	return {
		facet: "file-search",
		rule: "missing-path-guidance",
		severity: "medium",
		target: "instruction-path-guidance",
		summary: "Name the source directory for search entry points",
		practice: "Add one line naming src/ as the search root.",
		context: "Sessions that search the repository before the first edit.",
		refs: [`${key}#1`, `${key}#3`],
		estimatedBytes: 60,
		evidence: [{ facet: "file-search", grade: "inferred", rule: "missing-path-guidance", refs: [`${key}#3`] }],
		...overrides,
	};
}

function filesUnder(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name));
}

describe("session snapshot", () => {
	test("covers complete lines only and hashes exactly that range", () => {
		const home = tempHome();
		const file = path.join(home, "s.jsonl");
		const body = `${JSON.stringify({ type: "a", text: "多位元組" })}\n${JSON.stringify({ type: "b" })}\n`;
		fs.writeFileSync(file, `${body}{"type":"partial"`);
		const seen: number[] = [];
		const snapshot = readSessionSnapshot(file, { host: "claude", sessionId: SESSION }, (_record, ordinal) => seen.push(ordinal), { chunkBytes: 7 });
		expect(seen).toEqual([0, 1]);
		expect(snapshot.byteLength).toBe(Buffer.byteLength(body));
		expect(snapshot.sha256).toBe(createHash("sha256").update(body).digest("hex"));
	});

	test("fails explicitly on blank lines, invalid JSON, and symbolic links", () => {
		const home = tempHome();
		const file = path.join(home, "s.jsonl");
		const read = () => readSessionSnapshot(file, { host: "claude", sessionId: SESSION }, () => {});
		fs.writeFileSync(file, '{"type":"a"}\n\n');
		expect(read).toThrow("claude session record 1 is blank");
		fs.writeFileSync(file, '{"type":"a"}\n{nope\n');
		expect(read).toThrow("claude session record 1 is not valid JSON");
		const link = path.join(home, "link.jsonl");
		fs.symlinkSync(file, link);
		expect(() => readSessionSnapshot(link, { host: "claude", sessionId: SESSION }, () => {})).toThrow();
	});
});

describe("Claude session adapter", () => {
	test("maps tool calls to provider-neutral events", () => {
		const home = tempHome();
		const session = readClaudeSession(writeSession(home, sessionRecords(), '{"type":"assistant"'), SESSION);
		const byOrdinal = Object.fromEntries(session.tools.map((event) => [event.ordinal, event]));
		expect(session.tools.map((event) => [event.ordinal, event.tool, event.category])).toEqual([
			[1, "Grep", "search"],
			[3, "Grep", "search"],
			[5, "Glob", "list"],
			[7, "Bash", "search"],
			[9, "Read", "read"],
			[11, "Bash", "read"],
			[13, "Edit", "edit"],
			[15, "Bash", "command"],
			[17, "Bash", "command"],
			[19, "mcp__docs__read", "mcp"],
			[21, "Bash", "edit"],
		]);
		expect(byOrdinal[1]).toMatchObject({ emptyResult: false, outputBytes: 9, failed: false });
		expect(byOrdinal[5]).toMatchObject({ emptyResult: true });
		expect(byOrdinal[7]).toMatchObject({ exitCode: 1, failed: true, emptyResult: true, truncated: false });
		expect(byOrdinal[11]).toMatchObject({ exitCode: 0, truncated: true, outputBytes: 5000 });
		expect(byOrdinal[15]).toMatchObject({ exitCode: 2, failed: true });
		expect(byOrdinal[17]).toMatchObject({ blockedBy: "hook", failed: true });
		expect(byOrdinal[17].exitCode).toBeUndefined();
		expect(byOrdinal[19]).toMatchObject({ outputBytes: 7 });
		expect(byOrdinal[9].truncated).toBeUndefined();
		// m4 spans two records with the same usage; it counts once.
		expect(session.usage).toEqual({ firstOrdinal: 1, lastOrdinal: 21, inputTokens: 100, outputTokens: 30 });
	});

	test("fails explicitly when records do not match the Claude format", () => {
		const home = tempHome();
		const orphan = [{ type: "user", sessionId: SESSION, message: { role: "user", content: "hi" } }, result("missing", "x")];
		expect(() => readClaudeSession(writeSession(home, orphan), SESSION)).toThrow("tool_result without a matching tool_use");
		const other = [{ type: "user", sessionId: "99999999-0000-4000-8000-000000000000", message: { content: "x" } }];
		expect(() => readClaudeSession(writeSession(home, other), SESSION)).toThrow("belongs to another session");
		expect(() => readClaudeSession(writeSession(home, [{ type: "summary" }]), SESSION)).toThrow("has no entries for session");
		expect(() => readClaudeSession(writeSession(home, [{ sessionId: SESSION }]), SESSION)).toThrow("has no type");
	});

	test("locates the current session, a named session, or reports blocked", () => {
		const home = tempHome();
		const file = writeSession(home, sessionRecords());
		expect(locateClaudeSession(undefined, env(home, { CLAUDE_CODE_SESSION_ID: SESSION }))).toEqual({
			status: "found",
			sessionId: SESSION,
			path: file,
		});
		expect(locateClaudeSession(undefined, env(home))).toMatchObject({ status: "blocked", reason: expect.stringContaining("no current") });
		expect(locateClaudeSession("22222222-2222-4222-8222-222222222222", env(home))).toMatchObject({
			status: "blocked",
			reason: expect.stringContaining("not found"),
		});
		expect(locateClaudeSession("../../etc/passwd", env(home))).toMatchObject({ status: "blocked", reason: "invalid Claude session id" });
		fs.mkdirSync(path.join(home, ".claude", "projects", "-other"));
		fs.copyFileSync(file, path.join(home, ".claude", "projects", "-other", `${SESSION}.jsonl`));
		expect(locateClaudeSession(SESSION, env(home))).toMatchObject({ status: "blocked", reason: expect.stringContaining("ambiguous") });
	});

	test("counts tool calls left without a result in the snapshot", () => {
		const home = tempHome();
		const records = [...sessionRecords(), call("m9", "t9", "Grep", { pattern: "late" })];
		const session = readClaudeSession(writeSession(home, records), SESSION);
		expect(session.unfinished).toEqual([23]);
		const unfinished = analyzeRetroSession(session).evidence.filter((item) => item.rule === "unfinished-call");
		expect(unfinished).toMatchObject([{ facet: "tool-cost", metric: { value: 1, unit: "count" } }]);
		expect(unfinished[0].refs[0].endsWith("#23")).toBe(true);
	});

	test("counts non-text result parts by their serialized size", () => {
		const home = tempHome();
		const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(4000) } };
		const records = [call("m1", "t1", "Read", { file_path: "/repo/shot.png" }), result("t1", [{ type: "text", text: "ok" }, image])];
		const [event] = readClaudeSession(writeSession(home, records), SESSION).tools;
		expect(event.outputBytes).toBe(2 + Buffer.byteLength(JSON.stringify(image)));
	});

	test("reads an exit code only from failed Bash results", () => {
		const home = tempHome();
		const records = [
			call("m1", "t1", "Bash", { command: "grep -n x log" }),
			result("t1", "Exit code 1\nprinted by the log", { toolUseResult: { stdout: "", stderr: "" } }),
		];
		const [event] = readClaudeSession(writeSession(home, records), SESSION).tools;
		expect(event).toMatchObject({ exitCode: 0, failed: false, emptyResult: false });
	});

	test("skips symbolically linked project directories", () => {
		const home = tempHome();
		const outside = tempHome();
		writeSession(outside, sessionRecords());
		const projects = path.join(home, ".claude", "projects");
		fs.mkdirSync(projects, { recursive: true });
		fs.symlinkSync(path.join(outside, ".claude", "projects", "-repo"), path.join(projects, "-linked"));
		expect(locateClaudeSession(SESSION, env(home))).toMatchObject({ status: "blocked", reason: expect.stringContaining("not found") });
	});

	test("skips a symbolically linked projects directory", () => {
		const home = tempHome();
		const outside = tempHome();
		writeSession(outside, sessionRecords());
		fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
		fs.symlinkSync(path.join(outside, ".claude", "projects"), path.join(home, ".claude", "projects"));
		expect(locateClaudeSession(SESSION, env(home))).toEqual({
			status: "blocked",
			reason: `Claude session not found: ${SESSION}; 1 record directories could not be listed`,
		});
		expect(listClaudeSessions({ since: 0, env: env(home) })).toMatchObject({ sessions: [], unreadableDirectories: 1 });
	});

	test("parses the de-identified sampled session", () => {
		const fixture = path.join(import.meta.dir, "fixtures", "session-retro", "claude-session.jsonl");
		const session = readClaudeSession(fixture, "00000000-0000-4000-8000-00000000c1a0");
		expect(session.tools.length).toBe(23);
		expect(session.tools.filter((event) => event.category === "edit").length).toBeGreaterThan(0);
		expect(session.tools.filter((event) => event.exitCode !== undefined && event.exitCode !== 0)).toHaveLength(1);
		const value = analyzeRetroSession(session);
		expect(Object.values(value.facets).every((facet) => facet.status === "covered")).toBe(true);
		expect(new Set(session.instructions.map((load) => load.kind))).toContain("skills");
		expect(value.evidence.filter((item) => item.rule === "instruction-source").length).toBe(new Set(session.instructions.map((load) => load.source)).size);
	});
});

describe("shell command classification", () => {
	test("classifies plain search, list, and read pipelines only", () => {
		expect(classifyShellCommand("rg 'a|b' src")).toBe("search");
		expect(classifyShellCommand("cd /repo && grep -n foo file.ts")).toBe("search");
		expect(classifyShellCommand("git grep -n foo")).toBe("search");
		expect(classifyShellCommand("find . -name '*.ts' | head -20")).toBe("list");
		expect(classifyShellCommand("sed -n 1,40p file.ts")).toBe("read");
		expect(classifyShellCommand("sed -i s/a/b/ file.ts")).toBe("command");
		expect(classifyShellCommand("rg foo > out.txt")).toBe("command");
		expect(classifyShellCommand("rg foo | xargs rm")).toBe("command");
		expect(classifyShellCommand("cat $(ls)")).toBe("command");
		expect(classifyShellCommand("rg foo; rm -rf x")).toBe("command");
		expect(classifyShellCommand("npm test")).toBe("command");
		expect(classifyShellCommand("ls && cat a.md && grep -n x b.json")).toBe("search");
		expect(classifyShellCommand("sed -n 1,9p a.md; cat b.json; ls docs")).toBe("list");
		expect(classifyShellCommand("cd /repo && sed -n 1,80p a.ts; head -40 b.ts")).toBe("read");
		expect(classifyShellCommand("head -5 a\nwc -l b\n")).toBe("read");
		expect(classifyShellCommand('grep -rn "a\\|b" --include=*.ts . 2>/dev/null | grep -v node_')).toBe("search");
		expect(classifyShellCommand("rg foo 2>&1 | head")).toBe("search");
		expect(classifyShellCommand("ls; cd /repo; npm test")).toBe("command");
		expect(classifyShellCommand("cd /repo")).toBe("command");
		expect(classifyShellCommand("rg foo 2>out.txt")).toBe("command");
		expect(classifyShellCommand("rg foo >/dev/nullx")).toBe("command");
		expect(classifyShellCommand("ls ;; cat a")).toBe("command");
		expect(classifyShellCommand('cat "$HOME/a"')).toBe("command");
		expect(classifyShellCommand("find . -name '*.tmp' -delete")).toBe("command");
		expect(classifyShellCommand('grep -n "a>b" src')).toBe("search");
		expect(classifyShellCommand("ls | sort | uniq -c")).toBe("list");
		expect(classifyShellCommand("cat input | uniq -f 1 -s 2")).toBe("read");
		for (const command of [
			"sed -n --in-place 1p f",
			"sed -n 'w out' f",
			"sed -n -i 1p f",
			"find . -fprintf out '%p'",
			"find . -fprint0 out",
			"rg foo | sort -o out",
			"rg foo | sort --output=out",
			"ls | uniq - out",
			"fd -x rm",
			"fd -Hx touch",
			"rg foo | sort -ro out",
			"cat big.log | sort --compress-program=gzip",
			"less -o capture input",
			"rg --pre=cat foo",
			"tree -o out",
			"git grep -Ovim foo",
			"git grep --open-files-in-pager=touch foo",
		]) {
			expect({ command, category: classifyShellCommand(command) }).toEqual({ command, category: "command" });
		}
	});

	test("reads an empty result only from a single grep-family command", () => {
		expect(isEmptyShellSearch("grep -rn foo src", { exitCode: 1 })).toBe(true);
		expect(isEmptyShellSearch("rg foo 2>/dev/null", { exitCode: 0 })).toBe(false);
		expect(isEmptyShellSearch("grep foo a | head", { exitCode: 1 })).toBeUndefined();
		expect(isEmptyShellSearch("cd /repo && grep foo a", { exitCode: 1 })).toBeUndefined();
		expect(isEmptyShellSearch("grep foo a", { exitCode: 2 })).toBeUndefined();
	});
});

describe("measured retro evidence", () => {
	function report(topOutputs?: number) {
		const home = tempHome();
		const session = readClaudeSession(writeSession(home, sessionRecords()), SESSION);
		return { session, report: analyzeRetroSession({ ...session, topOutputs }) };
	}
	const pick = (value: ReturnType<typeof report>["report"], rule: string) =>
		value.evidence.filter((item) => item.rule === rule).map((item) => ({
			value: item.metric?.value,
			unit: item.metric?.unit,
			refs: item.refs.map((ref) => Number(ref.slice(ref.lastIndexOf("#") + 1))),
			...(item.tool ? { tool: item.tool } : {}),
		}));

	test("covers the tool facets and reports unrecorded instruction loads as unavailable", () => {
		expect(report().report.facets).toEqual({
			"file-search": { status: "covered" },
			"auto-checks": { status: "covered" },
			"tool-cost": { status: "covered" },
			"info-access": { status: "covered" },
			"ineffective-instructions": { status: "unavailable", reason: "not-recorded" },
		});
		const { session } = report();
		expect(analyzeRetroSession({ snapshot: session.snapshot, tools: session.tools }).facets["ineffective-instructions"]).toEqual({
			status: "unavailable",
			reason: "host-unsupported",
		});
		expect(report().report.evidence.every((item) => item.grade === "measured")).toBe(true);
	});

	test("measures file search before the first edit", () => {
		const { report: value } = report();
		expect(pick(value, "first-edit")).toEqual([{ value: 6, unit: "count", refs: [13] }]);
		expect(pick(value, "pre-edit-searches")).toEqual([{ value: 4, unit: "count", refs: [1, 3, 5, 7] }]);
		expect(pick(value, "pre-edit-reads")).toEqual([{ value: 2, unit: "count", refs: [9, 11] }]);
		expect(pick(value, "pre-edit-lookup-output")[0]).toMatchObject({ unit: "bytes", refs: [1, 3, 5, 7, 9, 11] });
		expect(pick(value, "duplicate-search")).toEqual([{ value: 2, unit: "count", refs: [1, 3], tool: "Grep" }]);
		expect(pick(value, "empty-search")).toEqual([{ value: 2, unit: "count", refs: [5, 7] }]);
	});

	test("starts the edit window at the first edit that succeeded", () => {
		const snapshot = { host: "claude" as const, sessionId: SESSION, byteLength: 1, recordCount: 100, sha256: "c".repeat(64) };
		const event = (ordinal: number, tool: string, category: RetroToolEventV1["category"], extra = {}): RetroToolEventV1 => ({
			ordinal,
			resultOrdinal: ordinal,
			tool,
			category,
			inputSha256: String(ordinal).padStart(64, "0"),
			outputBytes: 10,
			failed: false,
			...extra,
		});
		const tools = [
			event(1, "Edit", "edit", { failed: true }),
			event(2, "Grep", "search"),
			event(3, "Write", "edit", { failed: true, blockedBy: "hook" }),
			event(4, "Read", "read"),
			event(5, "Edit", "edit"),
		];
		const value = analyzeRetroSession({ snapshot, tools });
		expect(pick(value, "first-edit")).toEqual([{ value: 4, unit: "count", refs: [5] }]);
		expect(pick(value, "pre-edit-searches")).toEqual([{ value: 1, unit: "count", refs: [2] }]);
	});

	test("counts a lookup issued before the first edit's result as before the edit", () => {
		const snapshot = { host: "claude" as const, sessionId: SESSION, byteLength: 1, recordCount: 100, sha256: "c".repeat(64) };
		const event = (ordinal: number, resultOrdinal: number, tool: string, category: RetroToolEventV1["category"]): RetroToolEventV1 => ({
			ordinal,
			resultOrdinal,
			tool,
			category,
			inputSha256: String(ordinal).padStart(64, "0"),
			outputBytes: 10,
			failed: false,
		});
		// The Edits and the first Grep are parallel calls of one message; the later Edit finished first.
		const tools = [
			event(1, 2, "Read", "read"),
			event(3, 8, "Edit", "edit"),
			event(4, 6, "Edit", "edit"),
			event(5, 7, "Grep", "search"),
			event(9, 10, "Grep", "search"),
		];
		const value = analyzeRetroSession({ snapshot, tools });
		expect(pick(value, "first-edit")).toEqual([{ value: 2, unit: "count", refs: [4] }]);
		expect(pick(value, "pre-edit-searches")).toEqual([{ value: 1, unit: "count", refs: [5] }]);
	});

	test("lists the largest duplicate groups and counts every group", () => {
		const snapshot = { host: "claude" as const, sessionId: SESSION, byteLength: 1, recordCount: 400, sha256: "c".repeat(64) };
		const tools: RetroToolEventV1[] = [];
		// Group g has g + 2 calls; group 24 is the largest.
		for (let group = 0; group < 25; group += 1) {
			for (let call = 0; call < group + 2; call += 1) {
				tools.push({
					ordinal: tools.length,
					resultOrdinal: tools.length,
					tool: "Grep",
					category: "search",
					inputSha256: String(group).padStart(64, "0"),
					outputBytes: 1,
					failed: false,
				});
			}
		}
		const value = analyzeRetroSession({ snapshot, tools });
		const groups = value.evidence.filter((item) => item.rule === "duplicate-call");
		expect(groups).toHaveLength(20);
		expect(groups.map((item) => item.metric?.value)).toEqual([...groups.map((item) => item.metric?.value)].sort((a, b) => (b ?? 0) - (a ?? 0)));
		expect(pick(value, "duplicate-call-groups")[0]).toMatchObject({ value: 25, unit: "count" });
		expect(pick(value, "duplicate-search-groups")[0]).toMatchObject({ value: 25, unit: "count" });
		expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(256 * 1024);
	});

	test("measures tool cost in bytes per call and tokens per session", () => {
		const { report: value } = report(2);
		expect(pick(value, "top-output")).toEqual([
			{ value: 5000, unit: "bytes", refs: [11], tool: "Bash" },
			{ value: Buffer.byteLength(`Exit code 2\nmail ${CANARY.email} key ${CANARY.secret}`), unit: "bytes", refs: [15], tool: "Bash" },
		]);
		expect(pick(value, "duplicate-call")).toEqual([{ value: 2, unit: "count", refs: [1, 3], tool: "Grep" }]);
		expect(pick(value, "truncated-output")).toEqual([{ value: 1, unit: "count", refs: [11] }]);
		expect(pick(value, "output-by-tool")[0]).toMatchObject({ tool: "Bash", unit: "bytes" });
		expect(pick(value, "session-input-tokens")).toEqual([{ value: 100, unit: "tokens", refs: [1, 21] }]);
		expect(pick(value, "session-output-tokens")).toEqual([{ value: 30, unit: "tokens", refs: [1, 21] }]);
	});
});

describe("auto-checks and info-access evidence", () => {
	function checkReport() {
		const home = tempHome();
		return analyzeRetroSession(readClaudeSession(writeSession(home, checkRecords()), SESSION));
	}
	const pick = (value: ReturnType<typeof checkReport>, rule: string) =>
		value.evidence.filter((item) => item.rule === rule).map((item) => ({
			facet: item.facet,
			value: item.metric?.value,
			refs: item.refs.map((ref) => Number(ref.slice(ref.lastIndexOf("#") + 1))),
			...(item.tool ? { tool: item.tool } : {}),
			...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
		}));

	test("orders commands and exit codes against edits", () => {
		const value = checkReport();
		expect(pick(value, "last-edit")).toEqual([{ facet: "auto-checks", value: 2, refs: [21] }]);
		expect(pick(value, "commands-after-last-edit")).toEqual([{ facet: "auto-checks", value: 3, refs: [23, 25, 27] }]);
		expect(pick(value, "failed-then-passed")).toEqual([{ facet: "auto-checks", value: 1, refs: [1, 5], tool: "Bash", exitCode: 1 }]);
		expect(pick(value, "failed-then-passed-groups")).toEqual([{ facet: "auto-checks", value: 1, refs: [1] }]);
		expect(pick(value, "unresolved-failure")).toEqual([
			{ facet: "auto-checks", value: 2, refs: [7, 9], tool: "Bash", exitCode: 2 },
			{ facet: "auto-checks", value: 1, refs: [11], tool: "Bash", exitCode: 4 },
		]);
		expect(pick(value, "unresolved-failure-groups")).toEqual([{ facet: "auto-checks", value: 2, refs: [7, 11] }]);
	});

	test("counts a command as after an edit only when it starts after the edit's result", () => {
		// The retry and the edit are issued in one message; the retry passes before the edit's result.
		const bashOk = (id: string) => result(id, "ok", { toolUseResult: { stdout: "ok", stderr: "" } });
		const records: Json[] = [
			{ type: "user", sessionId: SESSION, message: { role: "user", content: "go" } },
			call("m1", "p1", "Bash", { command: "npm test" }),
			result("p1", "Exit code 1", { toolUseResult: { stdout: "", stderr: "" } }, true),
			{
				type: "assistant",
				sessionId: SESSION,
				message: {
					id: "m2",
					role: "assistant",
					content: [
						{ type: "tool_use", id: "p2", name: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" } },
						{ type: "tool_use", id: "p3", name: "Bash", input: { command: "npm test" } },
					],
				},
			},
			bashOk("p3"),
			result("p2", "ok"),
		];
		const value = analyzeRetroSession(readClaudeSession(writeSession(tempHome(), records), SESSION));
		expect(pick(value, "failed-then-passed")).toEqual([]);
		expect(pick(value, "commands-after-last-edit")).toEqual([{ facet: "auto-checks", value: 0, refs: [3] }]);
		// The same retry failing before the edit's result leaves the run open until a later pass.
		const failedRetry = [...records.slice(0, 4), result("p3", "Exit code 1", { toolUseResult: { stdout: "", stderr: "" } }, true), records[5]];
		const later = analyzeRetroSession(
			readClaudeSession(writeSession(tempHome(), [...failedRetry, call("m3", "p4", "Bash", { command: "npm test" }), bashOk("p4")]), SESSION),
		);
		expect(pick(later, "failed-then-passed")).toEqual([{ facet: "auto-checks", value: 2, refs: [1, 3, 6], tool: "Bash", exitCode: 1 }]);
		expect(pick(later, "commands-after-last-edit")).toEqual([{ facet: "auto-checks", value: 1, refs: [6] }]);
	});

	test("identifies a Bash call by its command, not its description", () => {
		const records: Json[] = [
			{ type: "user", sessionId: SESSION, message: { role: "user", content: "go" } },
			call("m1", "d1", "Bash", { command: "bun test", description: "Run tests" }),
			result("d1", "Exit code 1", { toolUseResult: { stdout: "", stderr: "" } }, true),
			call("m2", "d2", "Edit", { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }),
			result("d2", "ok"),
			call("m3", "d3", "Bash", { command: "bun test", description: "Re-run tests after the fix", timeout: 60000 }),
			result("d3", "ok", { toolUseResult: { stdout: "ok", stderr: "" } }),
		];
		const value = analyzeRetroSession(readClaudeSession(writeSession(tempHome(), records), SESSION));
		expect(pick(value, "failed-then-passed")).toEqual([{ facet: "auto-checks", value: 1, refs: [1, 5], tool: "Bash", exitCode: 1 }]);
		expect(pick(value, "unresolved-failure")).toEqual([]);
	});

	test("lists at most 20 failed-call tools and counts every tool", () => {
		const snapshot = { host: "claude" as const, sessionId: SESSION, byteLength: 1, recordCount: 100, sha256: "c".repeat(64) };
		const tools: RetroToolEventV1[] = Array.from({ length: 25 }, (_, n) => ({
			ordinal: n,
			resultOrdinal: n,
			tool: `mcp__s__t${n}`,
			category: "mcp",
			inputSha256: String(n).padStart(64, "0"),
			outputBytes: 1,
			failed: true,
		}));
		const value = analyzeRetroSession({ snapshot, tools });
		expect(pick(value, "failed-call")).toHaveLength(20);
		expect(pick(value, "failed-call-groups")).toEqual([{ facet: "info-access", value: 25, refs: Array.from({ length: 20 }, (_, n) => n) }]);
	});

	test("cites the last edit when no command follows it", () => {
		const records = checkRecords().slice(0, 23);
		const value = analyzeRetroSession(readClaudeSession(writeSession(tempHome(), records), SESSION));
		expect(pick(value, "commands-after-last-edit")).toEqual([{ facet: "auto-checks", value: 0, refs: [21] }]);
		expect(value.evidence.some((item) => item.rule === "last-edit")).toBe(true);
		const noEdits = analyzeRetroSession(readClaudeSession(writeSession(tempHome(), records.slice(0, 3)), SESSION));
		expect(noEdits.evidence.filter((item) => item.facet === "auto-checks").map((item) => item.rule)).toEqual([
			"unresolved-failure",
			"unresolved-failure-groups",
		]);
	});

	test("counts failed, non-zero, and blocked calls without an empty search", () => {
		const value = checkReport();
		expect(pick(value, "nonzero-exit")).toEqual([{ facet: "info-access", value: 5, refs: [1, 7, 9, 11, 25] }]);
		expect(pick(value, "exit-code")).toEqual([
			{ facet: "info-access", value: 2, refs: [7, 9], exitCode: 2 },
			{ facet: "info-access", value: 1, refs: [1], exitCode: 1 },
			{ facet: "info-access", value: 1, refs: [11], exitCode: 4 },
			{ facet: "info-access", value: 1, refs: [25], exitCode: 7 },
		]);
		expect(pick(value, "failed-call")).toEqual([{ facet: "info-access", value: 1, refs: [13], tool: "WebFetch" }]);
		expect(pick(value, "permission-blocked")).toEqual([{ facet: "info-access", value: 1, refs: [17] }]);
		expect(pick(value, "hook-blocked")).toEqual([{ facet: "info-access", value: 1, refs: [19] }]);
		expect(pick(value, "repeated-failure")).toEqual([{ facet: "info-access", value: 2, refs: [7, 9], tool: "Bash" }]);
		expect(pick(value, "repeated-failure-groups")).toEqual([{ facet: "info-access", value: 1, refs: [7] }]);
	});

	test("keeps session text out of the persisted report", () => {
		const home = tempHome();
		writeSession(home, checkRecords());
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot: path.join(home, ".goldband"), env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const persisted = fs.readFileSync(evidence.reportPath, "utf8");
		for (const text of [...Object.values(CANARY), "npm test", "example.invalid", "403"]) expect(persisted).not.toContain(text);
	});
});

describe("auto-checks and info-access proposals", () => {
	function setup() {
		const home = tempHome();
		writeSession(home, checkRecords());
		const stateRoot = path.join(home, ".goldband");
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const snapshot = evidence.report.snapshots[0];
		const key = `${snapshot.sessionId}@${snapshot.sha256}`;
		const knowledge = path.join(stateRoot, "knowledge");
		const submit = (proposals: Json[]) => {
			const outcome = runRetroProposals(
				{ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals },
				{ stateRoot, knowledgeRoot: knowledge, cwd: home },
			);
			if (outcome.status !== "completed") throw new Error(outcome.reason);
			return outcome.outcomes;
		};
		const check = (overrides: Json = {}) =>
			proposal(evidence.report, {
				facet: "auto-checks",
				rule: "lint-before-commit",
				target: "lint",
				checkClass: "mechanical",
				estimatedBytes: undefined,
				refs: [`${key}#7`, `${key}#9`],
				evidence: [{ facet: "auto-checks", grade: "inferred", rule: "lint-not-run-after-edit", refs: [`${key}#7`] }],
				...overrides,
			});
		return { home, key, knowledge, submit, check };
	}

	test("limits auto-checks targets by error class and records the class", () => {
		const { home, knowledge, submit, check } = setup();
		const outcomes = submit([
			check(),
			check({ rule: "case-a", checkClass: undefined }),
			check({ rule: "case-b", target: "semantic-review-criteria" }),
			check({ rule: "case-c", checkClass: "judgement", target: "test" }),
			check({ rule: "case-d", checkClass: "advisory" }),
			check({ rule: "case-e", checkClass: "toString" }),
			check({ rule: "review-error-shape", checkClass: "judgement", target: "semantic-review-criteria" }),
		]);
		expect(outcomes.map(({ rule, status, reason }) => ({ rule, status, reason }))).toEqual([
			{ rule: "lint-before-commit", status: "written", reason: undefined },
			{ rule: "case-a", status: "rejected", reason: "checkClass must be mechanical or judgement" },
			{ rule: "case-b", status: "rejected", reason: "target for a mechanical error must be one of: lint, hook, ci, test" },
			{ rule: "case-c", status: "rejected", reason: "target for a judgement error must be one of: semantic-review-criteria, repo-review-standard" },
			{ rule: "case-d", status: "rejected", reason: "checkClass must be mechanical or judgement" },
			{ rule: "case-e", status: "rejected", reason: "checkClass must be mechanical or judgement" },
			{ rule: "review-error-shape", status: "written", reason: undefined },
		]);
		const mechanical = parseKnowledgeFile(path.join(knowledge, "entries", `${outcomes[0].id}.md`));
		expect(mechanical).toMatchObject({ check_class: "mechanical", source: "retro", trust_level: "inferred" });
		expect(mechanical.body).toContain("- 錯誤分類（推論）：mechanical");
		expect(mechanical.body).toContain("- unresolved-failure: 2 count (Bash)，#7, #9");
		expect(parseKnowledgeFile(path.join(knowledge, "entries", `${outcomes[6].id}.md`)).check_class).toBe("judgement");

		const graduate = (to: string) =>
			spawnSync("bun", [path.join(ROOT, "bin", "goldband-knowledge.ts"), "review", "graduate", "--id", outcomes[0].id ?? "", "--to", to], {
				cwd: home,
				env: env(home),
				encoding: "utf8",
			});
		expect(graduate("rules/semantic-review-criteria.md")).toMatchObject({
			status: 1,
			stderr: expect.stringContaining("mechanical knowledge graduates only to a lint, hook, CI, or test target"),
		});
		expect(graduate(".github/workflows/lint.yml").status).toBe(0);
	});

	test("rejects a check class outside auto-checks and marks access proposals for security review", () => {
		const { key, knowledge, submit } = setup();
		const access = (overrides: Json = {}) =>
			proposal({ snapshots: [{ sessionId: SESSION, sha256: key.split("@")[1] }] }, {
				facet: "info-access",
				rule: "docs-read-access",
				target: "read-only-permission",
				estimatedBytes: undefined,
				refs: [`${key}#13`],
				evidence: [{ facet: "info-access", grade: "inferred", rule: "auth-failure", refs: [`${key}#13`] }],
				...overrides,
			});
		const outcomes = submit([
			access(),
			access({ rule: "case-a", checkClass: "mechanical" }),
			access({ rule: "case-b", target: "lint" }),
			proposal({ snapshots: [{ sessionId: SESSION, sha256: key.split("@")[1] }] }, { rule: "case-c", checkClass: "judgement" }),
		]);
		expect(outcomes.map(({ status, reason }) => ({ status, reason }))).toEqual([
			{ status: "written", reason: undefined },
			{ status: "rejected", reason: "checkClass applies only to auto-checks proposals" },
			{ status: "rejected", reason: "target for info-access must be one of: read-only-permission, access-guidance" },
			{ status: "rejected", reason: "checkClass applies only to auto-checks proposals" },
		]);
		const entry = parseKnowledgeFile(path.join(knowledge, "entries", `${outcomes[0].id}.md`));
		expect(entry.check_class).toBe("");
		expect(entry.body).toContain("- 需安全審查：只提議唯讀存取，不授予寫入權限或密鑰");
		expect(entry.body).toContain("- failed-call: 1 count (WebFetch)，#13");
		expect(fs.readFileSync(path.join(knowledge, "entries", `${outcomes[0].id}.md`), "utf8")).not.toContain("check_class");
	});
});

const SHARED = "Use plain Traditional Chinese for discussion and English for code.";
const RULE = "Never weaken, skip, or delete a test to make it pass.";
const ASK = "Ask before irreversible or outward-facing actions every time.";
const RELOADED = "Reloaded guidance that is long enough to count as a paragraph.";

function attachment(value: Json): Json {
	return { type: "attachment", sessionId: SESSION, attachment: value };
}

/**
 * Instruction loads. Ordinals: four files at 1, a nested memory file at 4,
 * an initial skill listing at 5 and a later one adding a skill at 6, and the
 * user file reloaded without RULE at 7. Latest contents repeat SHARED in the
 * user and project files (7, 1), RULE in the project and nested files (1, 4),
 * and ASK in two files loaded by record 1.
 */
function instructionRecords(): Json[] {
	return [
		{ type: "user", sessionId: SESSION, message: { role: "user", content: CANARY.prompt } },
		attachment({
			type: "instructions",
			files: [
				{ path: "/home/u/.claude/CLAUDE.md", type: "User", content: `# Style\n\n${SHARED}\n\n- ${RULE}\n- Keep it short.` },
				{
					path: "/repo/CLAUDE.md",
					type: "Project",
					content: `${SHARED.replace(" for ", "  for\n")}\n\n* ${RULE}\n* Keep it short.\n* ${ASK}\n\n${SHARED}`,
				},
				{ path: "/home/u/.claude/projects/x/memory/MEMORY.md", type: "AutoMem", content: `- [Note](n.md) — ${CANARY.file} memory index line` },
				{ path: "/etc/claude/odd.md", type: "constructor", content: ASK },
			],
		}),
		call("m1", "t1", "Read", { file_path: "/repo/a.ts" }),
		result("t1", "ok"),
		attachment({
			type: "nested_memory",
			path: "/repo/sub/CLAUDE.md",
			content: { path: "/repo/sub/CLAUDE.md", type: "Project", content: `1. ${RULE}` },
		}),
		attachment({
			type: "skill_listing",
			isInitial: true,
			content: "- alpha: Alpha skill description that is long enough\n- beta: Beta skill\n  continued on a second line",
		}),
		attachment({ type: "skill_listing", isInitial: false, content: "- gamma: Gamma skill description also long enough" }),
		attachment({ type: "instructions", files: [{ path: "/home/u/.claude/CLAUDE.md", type: "User", content: `${SHARED}\n\n${RELOADED}` }] }),
	];
}

describe("ineffective-instructions evidence", () => {
	const sha = (value: string) => createHash("sha256").update(value).digest("hex");
	const ordinals = (refs: string[]) => refs.map((ref) => Number(ref.slice(ref.lastIndexOf("#") + 1)));
	function report(records = instructionRecords()) {
		const home = tempHome();
		const session = readClaudeSession(writeSession(home, records), SESSION);
		return { session, report: analyzeRetroSession(session) };
	}

	test("lists each source with its latest content and covers all five facets", () => {
		const { session, report: value } = report();
		expect(Object.values(value.facets).every((facet) => facet.status === "covered")).toBe(true);
		const user = `${SHARED}\n\n${RELOADED}`;
		const skills = "- alpha: Alpha skill description that is long enough\n- beta: Beta skill\n  continued on a second line\n- gamma: Gamma skill description also long enough";
		expect(session.instructions.find((load) => load.ordinal === 6)?.content).toBe(skills);
		const sources = value.evidence.filter((item) => item.rule === "instruction-source");
		const latest = [user, session.instructions[1].content, session.instructions[2].content, ASK, `1. ${RULE}`, skills];
		expect(sources.map((item) => ({ kind: item.sourceKind, refs: ordinals(item.refs), value: item.metric?.value, sha: item.contentSha256 }))).toEqual([
			{ kind: "user", refs: [1, 7], value: Buffer.byteLength(user), sha: sha(user) },
			{ kind: "project", refs: [1], value: Buffer.byteLength(latest[1]), sha: sha(latest[1]) },
			{ kind: "memory", refs: [1], value: Buffer.byteLength(latest[2]), sha: sha(latest[2]) },
			{ kind: "other", refs: [1], value: Buffer.byteLength(ASK), sha: sha(ASK) },
			{ kind: "project", refs: [4], value: Buffer.byteLength(latest[4]), sha: sha(latest[4]) },
			{ kind: "skills", refs: [5, 6], value: Buffer.byteLength(skills), sha: sha(skills) },
		]);
		const bytes = value.evidence.find((item) => item.rule === "instruction-bytes");
		expect({ refs: ordinals(bytes?.refs ?? []), value: bytes?.metric?.value }).toEqual({
			refs: [1, 4, 6, 7],
			value: latest.reduce((sum, content) => sum + Buffer.byteLength(content), 0),
		});
	});

	test("counts paragraphs repeated verbatim across sources", () => {
		const { report: value } = report();
		const duplicates = value.evidence.filter((item) => item.rule === "duplicate-paragraph");
		expect(duplicates.map((item) => ({ sha: item.contentSha256, count: item.metric?.value, refs: ordinals(item.refs) }))).toEqual([
			{ sha: sha(SHARED), count: 2, refs: [1, 7] },
			{ sha: sha(ASK), count: 2, refs: [1] },
			{ sha: sha(RULE), count: 2, refs: [1, 4] },
		]);
		const metric = (rule: string) => value.evidence.find((item) => item.rule === rule)?.metric?.value;
		expect(metric("duplicate-paragraph-groups")).toBe(3);
		expect(metric("duplicate-paragraph-bytes")).toBe(Buffer.byteLength(SHARED + ASK + RULE));
		expect(value.evidence.every((item) => item.grade === "measured")).toBe(true);
	});

	test("reports no duplicates when a repeated paragraph is short or stays in one source", () => {
		const records = [
			{ type: "user", sessionId: SESSION, message: { role: "user", content: "hi" } },
			attachment({
				type: "instructions",
				files: [
					{ path: "/a/CLAUDE.md", type: "User", content: `${SHARED}\n\n${SHARED}\n\n- Keep it short.` },
					{ path: "/b/CLAUDE.md", type: "Project", content: "Keep it short." },
				],
			}),
		];
		const { report: value } = report(records);
		expect(value.evidence.filter((item) => item.rule.startsWith("duplicate-paragraph"))).toEqual([]);
		expect(value.facets["ineffective-instructions"]).toEqual({ status: "covered" });
	});

	test("cites the latest load of a source reloaded more than 20 times", () => {
		const reload = (index: number) =>
			attachment({ type: "instructions", files: [{ path: "/a/CLAUDE.md", type: "User", content: `${RELOADED} ${index}` }] });
		const records = [{ type: "user", sessionId: SESSION, message: { role: "user", content: "hi" } }, ...Array.from({ length: 21 }, (_, index) => reload(index))];
		const source = report(records).report.evidence.find((item) => item.rule === "instruction-source");
		expect(ordinals(source?.refs ?? [])).toEqual([...Array.from({ length: 19 }, (_, index) => index + 1), 21]);
		expect(source?.contentSha256).toBe(sha(`${RELOADED} 20`));
	});

	test("keeps namespaced skills apart and ignores other attachments whatever their shape", () => {
		const records = [
			{ type: "user", sessionId: SESSION, message: { role: "user", content: "hi" } },
			attachment({ type: "skill_listing", isInitial: true, content: "- plugin:docx: Word files\n- plugin:pdf: PDF files\n- plain: Plain skill" }),
			{ type: "attachment", sessionId: SESSION, attachment: null },
			{ type: "attachment", sessionId: SESSION },
			attachment({ type: "skill_listing", isInitial: false, content: "- plugin:pdf: PDF files, updated" }),
		];
		const { session } = report(records);
		expect(session.instructions.at(-1)?.content).toBe("- plugin:docx: Word files\n- plain: Plain skill\n- plugin:pdf: PDF files, updated");
	});

	test("rejects instruction attachments without the fields it reads", () => {
		const home = tempHome();
		const read = (value: Json) =>
			() => readClaudeSession(writeSession(home, [{ type: "user", sessionId: SESSION, message: { role: "user", content: "hi" } }, attachment(value)]), SESSION);
		expect(read({ type: "instructions" })).toThrow("claude session record 1 has instructions without a file list");
		expect(read({ type: "instructions", files: [{ path: "/a", type: "User" }] })).toThrow("has a memory file without path or content");
		expect(read({ type: "nested_memory", path: "/a" })).toThrow("claude session record 1 memory file");
		expect(read({ type: "skill_listing", isInitial: true })).toThrow("has a skill listing without content");
		expect(read({ type: "queued_command", prompt: CANARY.prompt })().instructions).toEqual([]);
	});

	test("persists hashes and kinds but no instruction text or paths", () => {
		const home = tempHome();
		writeSession(home, instructionRecords());
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot: path.join(home, ".goldband"), env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const persisted = fs.readFileSync(evidence.reportPath, "utf8");
		for (const text of [SHARED, RULE, ASK, RELOADED, CANARY.file, CANARY.prompt, "/repo/", "/home/u", "CLAUDE.md", "MEMORY.md", "alpha", "Keep it short"]) {
			expect({ text, found: persisted.includes(text) }).toEqual({ text, found: false });
		}
		expect(persisted).toContain(sha(SHARED));
	});

	test("writes instruction proposals as unproven candidates that cannot graduate", () => {
		const home = tempHome();
		writeSession(home, instructionRecords());
		const stateRoot = path.join(home, ".goldband");
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const snapshot = evidence.report.snapshots[0];
		const key = `${snapshot.sessionId}@${snapshot.sha256}`;
		const knowledge = path.join(stateRoot, "knowledge");
		const instruction = (overrides: Json = {}) =>
			proposal(evidence.report, {
				facet: "ineffective-instructions",
				rule: "duplicate-paragraph",
				target: "instruction-consolidation",
				estimatedBytes: undefined,
				refs: [`${key}#1`, `${key}#7`],
				evidence: [{ facet: "ineffective-instructions", grade: "inferred", rule: "semantic-duplicate", refs: [`${key}#1`] }],
				...overrides,
			});
		const outcome = runRetroProposals(
			{
				sessionId: snapshot.sessionId,
				sha256: snapshot.sha256,
				proposals: [
					instruction(),
					instruction({ rule: "case-a", target: "lint" }),
					instruction({ rule: "case-b", checkClass: "mechanical" }),
					instruction({ rule: "enforced-by-hook", target: "instruction-removal", estimatedBytes: 120 }),
				],
			},
			{ stateRoot, knowledgeRoot: knowledge, cwd: home },
		);
		if (outcome.status !== "completed") throw new Error(outcome.reason);
		expect(outcome.outcomes.map(({ rule, status, reason }) => ({ rule, status, reason }))).toEqual([
			{ rule: "duplicate-paragraph", status: "written", reason: undefined },
			{ rule: "case-a", status: "rejected", reason: "target for ineffective-instructions must be one of: instruction-removal, instruction-consolidation" },
			{ rule: "case-b", status: "rejected", reason: "checkClass applies only to auto-checks proposals" },
			{ rule: "enforced-by-hook", status: "written", reason: undefined },
		]);
		const id = outcome.outcomes[0].id ?? "";
		const entry = parseKnowledgeFile(path.join(knowledge, "entries", `${id}.md`));
		expect(entry).toMatchObject({ status: "candidate", eval_status: "unproven", check_class: "" });
		expect(entry.body).toContain(RETRO_UNPROVEN_NOTE);
		expect(entry.body).toContain(`- duplicate-paragraph: 2 count (sha256:${sha(SHARED).slice(0, 12)})，#1, #7`);
		expect(entry.body).toContain(`- instruction-source: ${Buffer.byteLength(`${SHARED}\n\n${RELOADED}`)} bytes (user sha256:${sha(`${SHARED}\n\n${RELOADED}`).slice(0, 12)})，#1, #7`);
		const removal = parseKnowledgeFile(path.join(knowledge, "entries", `${outcome.outcomes[3].id}.md`));
		expect(removal.body).toContain("採用目標：instruction-removal（預估減少 120 bytes）");

		const knowledgeCli = (args: string[]) =>
			spawnSync("bun", [path.join(ROOT, "bin", "goldband-knowledge.ts"), "review", ...args, "--id", id], { cwd: home, env: env(home), encoding: "utf8" });
		expect(knowledgeCli(["graduate", "--to", "CLAUDE.md"])).toMatchObject({
			status: 1,
			stderr: expect.stringContaining("unproven knowledge cannot become graduated until an eval clears eval_status"),
		});
		expect(knowledgeCli(["promote"])).toMatchObject({
			status: 1,
			stderr: expect.stringContaining("unproven knowledge cannot become active until an eval clears eval_status"),
		});
		expect(parseKnowledgeFile(path.join(knowledge, "entries", `${id}.md`))).toMatchObject({ status: "candidate", eval_status: "unproven" });
		expect(knowledgeCli(["retire"]).status).toBe(0);
	});
});

describe("retro instruction eval", () => {
	/** An unproven instruction-removal candidate written through the proposal path. */
	function instructionCandidate(): { home: string; knowledge: string; id: string } {
		const home = tempHome();
		writeSession(home, instructionRecords());
		const stateRoot = path.join(home, ".goldband");
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const snapshot = evidence.report.snapshots[0];
		const key = `${snapshot.sessionId}@${snapshot.sha256}`;
		const knowledge = path.join(stateRoot, "knowledge");
		const outcome = runRetroProposals(
			{
				sessionId: snapshot.sessionId,
				sha256: snapshot.sha256,
				proposals: [
					proposal(evidence.report, {
						facet: "ineffective-instructions",
						rule: "enforced-by-hook",
						target: "instruction-removal",
						estimatedBytes: 120,
						refs: [`${key}#1`],
						evidence: [],
					}),
				],
			},
			{ stateRoot, knowledgeRoot: knowledge, cwd: home },
		);
		if (outcome.status !== "completed" || !outcome.outcomes[0].id) throw new Error("candidate not written");
		return { home, knowledge, id: outcome.outcomes[0].id };
	}
	const entryOf = (knowledge: string, id: string) => parseKnowledgeFile(path.join(knowledge, "entries", `${id}.md`));
	const knowledgeCli = (home: string, id: string, args: string[]) =>
		spawnSync("bun", [path.join(ROOT, "bin", "goldband-knowledge.ts"), "review", ...args, "--id", id], { cwd: home, env: env(home), encoding: "utf8" });

	test("marks a change that leaves results no worse as ineffective, which may be adopted", () => {
		const { home, knowledge, id } = instructionCandidate();
		const before = entryOf(knowledge, id);
		expect(before.body).toContain(RETRO_UNPROVEN_NOTE);
		const result = runRetroEval({ candidate: id, metric: "task-pass", better: "higher", keep: [1, 1, 0, 1, 1], change: [1, 0, 1, 1, 1] }, { knowledgeRoot: knowledge });
		expect(result).toEqual({ status: "completed", id, evalStatus: "ineffective", metric: "task-pass", better: "higher", keep: { count: 5, mean: 0.8 }, change: { count: 5, mean: 0.8 } });
		const entry = entryOf(knowledge, id);
		const verdict = "- 驗證狀態：ineffective（變更組平均不比保留組差，已證實無效）";
		expect(entry).toMatchObject({ status: "candidate", eval_status: "ineffective" });
		expect(entry.body).not.toContain("unproven");
		expect(entry.body.startsWith(before.body.replace(RETRO_UNPROVEN_NOTE, verdict))).toBe(true);
		expect(entry.body).toContain(
			[
				"### Eval：保留 vs 變更（measured，使用者執行）",
				"",
				"- 指標：task-pass（每次執行一個分數，越大越好）",
				"- 保留：n=5，平均 0.8",
				"- 變更（刪除或合併）：n=5，平均 0.8",
				`- 判定：${verdict.slice("- 驗證狀態：".length)}`,
				`- 日期：${entry.updated}`,
			].join("\n"),
		);
		// The eval measured this content: an edited proposal cannot reuse it.
		const evaluated = fs.readFileSync(path.join(knowledge, "entries", `${id}.md`), "utf8");
		for (const args of [["edit", "--summary", "Another change."], ["retire", "--summary", "Another change."], ["graduate", "--to", "CLAUDE.md", "--summary", "Another change."]]) {
			expect(knowledgeCli(home, id, args)).toMatchObject({ status: 1, stderr: expect.stringContaining(`knowledge entry ${id} has a recorded eval, so its summary cannot change`) });
		}
		expect(fs.readFileSync(path.join(knowledge, "entries", `${id}.md`), "utf8")).toBe(evaluated);
		// Saving the same content back, as `review show` prints it, is not a change.
		const same = path.join(home, "same-body.md");
		fs.writeFileSync(same, `${entryOf(knowledge, id).body}\n`);
		expect(knowledgeCli(home, id, ["edit", "--body-file", same]).status).toBe(0);
		expect(knowledgeCli(home, id, ["promote"]).status).toBe(0);
		expect(entryOf(knowledge, id)).toMatchObject({ status: "active", eval_status: "ineffective" });
	});

	test("marks a change that makes results worse as effective, which is never adopted", () => {
		const { home, knowledge, id } = instructionCandidate();
		const result = runRetroEval({ candidate: id, metric: "review-score", better: "higher", keep: [8, 9, 7, 9, 8, 9], change: [8, 9, 7, 9, 8, 8.5] }, { knowledgeRoot: knowledge });
		expect(result).toMatchObject({ status: "completed", evalStatus: "effective", keep: { count: 6, mean: 25 / 3 }, change: { count: 6, mean: 8.25 } });
		expect(entryOf(knowledge, id).body).toContain("- 驗證狀態：effective（變更組平均比保留組差，有效，保留）");
		for (const args of [["promote"], ["graduate", "--to", "CLAUDE.md"]]) {
			expect(knowledgeCli(home, id, args)).toMatchObject({ status: 1, stderr: expect.stringContaining("its eval showed results get worse without the instruction") });
		}
		expect(entryOf(knowledge, id)).toMatchObject({ status: "candidate", eval_status: "effective" });
	});

	test("compares means in the better direction, exactly, without overflow", () => {
		const verdict = (better: string, keep: number[], change: number[]) => {
			const { knowledge, id } = instructionCandidate();
			const result = runRetroEval({ candidate: id, metric: "tokens", better, keep, change }, { knowledgeRoot: knowledge });
			return result.status === "completed" ? result.evalStatus : result.reason;
		};
		const five = (value: number) => [value, value, value, value, value];
		expect(verdict("lower", five(900), five(1200))).toBe("effective");
		expect(verdict("lower", five(900), five(900))).toBe("ineffective");
		expect(verdict("higher", five(1), five(0.9999999999999))).toBe("effective");
		expect(verdict("higher", five(1e308), five(9e307))).toBe("effective");
		expect(verdict("higher", five(Number.MIN_VALUE), five(0))).toBe("effective");
		expect(verdict("lower", five(0), five(Number.MIN_VALUE))).toBe("effective");
		expect(verdict("higher", five(-1e308), five(-1e308))).toBe("ineffective");
		expect(verdict("higher", [-1e308, 1, 1, 1, 1e308], [-1e308, 0, 0, 0, 1e308])).toBe("effective");
		expect(verdict("higher", [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1])).toBe("ineffective");
		const { knowledge, id } = instructionCandidate();
		const cancelling = runRetroEval({ candidate: id, metric: "tokens", better: "higher", keep: [-1e308, 1, 1, 1, 1e308], change: [-1e308, 0, 0, 0, 1e308] }, { knowledgeRoot: knowledge });
		expect(cancelling).toMatchObject({ status: "completed", evalStatus: "effective", keep: { count: 5, mean: 0.6 }, change: { count: 5, mean: 0 } });
		expect(entryOf(knowledge, id).body).toContain("- 保留：n=5，平均 0.6\n- 變更（刪除或合併）：n=5，平均 0\n");
		const bounds = instructionCandidate();
		const extremes = runRetroEval({ candidate: bounds.id, metric: "tokens", better: "higher", keep: five(Number.MAX_VALUE), change: [...five(Number.MIN_VALUE), -Number.MIN_VALUE] }, { knowledgeRoot: bounds.knowledge });
		expect(extremes).toMatchObject({ keep: { mean: Number.MAX_VALUE }, change: { mean: 5e-324 } });
		expect(JSON.stringify(extremes)).toContain('"keep":{"count":5,"mean":1.7976931348623157e+308}');
		expect(entryOf(bounds.knowledge, bounds.id).body).toContain("- 保留：n=5，平均 1.7976931348623157e+308\n");
		expect(entryOf(bounds.knowledge, bounds.id).body).not.toContain("顯示精度");
		// A difference below the shown precision is stated next to equal means.
		const close = instructionCandidate();
		const below = runRetroEval({ candidate: close.id, metric: "tokens", better: "higher", keep: five(1), change: [1, 1, 1, 1, 0.9999999999999999] }, { knowledgeRoot: close.knowledge });
		expect(below).toMatchObject({ evalStatus: "effective", keep: { mean: 1 }, change: { mean: 1 } });
		expect(entryOf(close.knowledge, close.id).body).toContain("- 變更（刪除或合併）：n=5，平均 1\n- 兩組平均的差異小於顯示精度，判定依精確比較\n- 判定：effective");
		const m = Number.MIN_VALUE;
		const ties = instructionCandidate();
		const tie = runRetroEval({ candidate: ties.id, metric: "tokens", better: "higher", keep: [m, m, m, 2 * m, 2 * m, 2 * m], change: [m, m, m, m, m, 2 * m, 2 * m, 2 * m] }, { knowledgeRoot: ties.knowledge });
		expect(tie).toMatchObject({ evalStatus: "effective", keep: { mean: 2 * m }, change: { mean: m } });
		expect(verdict("lower", [3, 3, 3, 3, 3, 4], [3, 3, 3, 3, 4])).toBe("effective");
		expect(verdict("higher", [0.1, 0.2, 0.3, 0.4, 0.5], [0.5, 0.4, 0.3, 0.2, 0.1])).toBe("ineffective");
	});

	test("replaces the note of a candidate written before the eval command", () => {
		const { knowledge, id } = instructionCandidate();
		const legacy = "- 驗證狀態：unproven（未經 eval，不可直接刪除或合併）";
		const entry = entryOf(knowledge, id);
		writeKnowledgeEntry({ ...entry, body: entry.body.replace(RETRO_UNPROVEN_NOTE, legacy) }, knowledge);
		const five = [1, 1, 1, 1, 1];
		expect(runRetroEval({ candidate: id, metric: "task-pass", better: "higher", keep: five, change: five }, { knowledgeRoot: knowledge }).status).toBe("completed");
		expect(entryOf(knowledge, id).body).not.toContain("unproven");
	});

	test("blocks requests without a pending retro instruction eval", () => {
		const { home, knowledge, id } = instructionCandidate();
		const run = (request: unknown) => runRetroEval(request, { knowledgeRoot: knowledge });
		const valid = { candidate: id, metric: "task-pass", better: "higher", keep: [1, 1, 1, 1, 1], change: [1, 1, 1, 1, 1] };
		const blocked = (reason: string) => ({ status: "blocked", reason });
		expect(run([])).toEqual(blocked("eval request must be an object"));
		expect(run({ ...valid, note: "x" })).toEqual(blocked("eval request has unsupported field: note"));
		expect(run({ ...valid, candidate: "../x" })).toEqual(blocked("candidate must be a retro candidate id"));
		expect(run({ ...valid, metric: "Task Pass" })).toEqual(blocked("metric must be a lowercase label of at most 64 characters"));
		expect(run({ ...valid, better: undefined })).toEqual(blocked("better must be higher or lower"));
		for (const keep of [[1, 1, 1, 1], [1, 1, 1, 1, "1"], "11111"]) {
			expect(run({ ...valid, keep })).toEqual(blocked("keep must hold 5 to 1000 finite numbers, one per run"));
		}
		expect(run({ ...valid, candidate: "retro-0000000000000000" })).toEqual(blocked("knowledge entry not found: retro-0000000000000000"));
		expect(runRetroEval(valid, { knowledgeRoot: path.join(home, "missing") })).toEqual(blocked(`knowledge entry not found: ${id}`));
		const lock = `${path.join(knowledge, "entries", `${id}.md`)}.lock`;
		fs.writeFileSync(lock, "");
		expect(run(valid)).toEqual(blocked(`knowledge entry ${id} is being updated, or an update was interrupted; remove ${lock} if none is running`));
		// A review action waits for no one either: it fails while the entry is locked.
		expect(knowledgeCli(home, id, ["retire"])).toMatchObject({ status: 1, stderr: expect.stringContaining(`knowledge entry ${id} is being updated`) });
		fs.rmSync(lock);
		// The lock takes only a valid id, and reports only a held lock as busy.
		expect(() => transitionKnowledgeStatus("../../x", "retired", {}, knowledge)).toThrow("invalid knowledge id: ../../x");
		expect(fs.existsSync(path.join(knowledge, "..", "x.md.lock"))).toBe(false);
		const entries = path.join(knowledge, "entries");
		fs.chmodSync(entries, 0o500);
		try {
			expect(() => run(valid)).toThrow(expect.objectContaining({ code: "EACCES" }));
		} finally {
			fs.chmodSync(entries, 0o700);
		}
		// `add` cannot replace a retro entry, so it cannot skip the eval.
		const before = fs.readFileSync(path.join(entries, `${id}.md`), "utf8");
		const add = spawnSync("bun", [path.join(ROOT, "bin", "goldband-knowledge.ts"), "add", "--id", id, "--title", "Replaced", "--type", "practice", "--domains", "general", "--summary", "Replaced.", "--body", "## 做法\nx\n\n## 適用情境\nx\n\n## 驗證證據\nx\n", "--status", "active"], { cwd: home, env: env(home), encoding: "utf8" });
		expect(add).toMatchObject({ status: 1, stderr: expect.stringContaining(`knowledge entry ${id} is a retro entry`) });
		expect(fs.readFileSync(path.join(entries, `${id}.md`), "utf8")).toBe(before);
		expect(fs.readdirSync(entries).filter((name) => name.endsWith(".lock"))).toEqual([]);
		const manual = createKnowledgeEntry({ ...entryOf(knowledge, id), id: "retro-1111111111111111", source: "manual" });
		writeKnowledgeEntry(manual, knowledge);
		expect(run({ ...valid, candidate: manual.id })).toEqual(blocked(`not a retro candidate: ${manual.id}`));
		expect(knowledgeCli(home, id, ["retire"]).status).toBe(0);
		expect(run(valid)).toEqual(blocked(`knowledge entry is retired, not a candidate: ${id}`));
		const second = instructionCandidate();
		const again = { ...valid, candidate: second.id };
		expect(runRetroEval(again, { knowledgeRoot: second.knowledge }).status).toBe("completed");
		expect(runRetroEval(again, { knowledgeRoot: second.knowledge })).toEqual(blocked(`candidate has no pending eval: ${second.id}`));
		expect(entryOf(second.knowledge, second.id).eval_status).toBe("ineffective");
		expect(fs.existsSync(`${path.join(second.knowledge, "entries", `${second.id}.md`)}.lock`)).toBe(false);
	});

	test("runs through the CLI in the knowledge home that review reads", () => {
		const { home, knowledge, id } = instructionCandidate();
		const input = path.join(home, "eval.json");
		fs.writeFileSync(input, JSON.stringify({ candidate: id, metric: "task-pass", better: "higher", keep: [0, 1, 0, 1, 1], change: [1, 1, 1, 0, 1] }));
		const cli = (args: string[]) => spawnSync("bun", [path.join(ROOT, "bin", "goldband-retro.ts"), ...args], { cwd: home, env: env(home), encoding: "utf8" });
		const run = cli(["eval", "--input", input]);
		expect(run.status).toBe(0);
		expect(JSON.parse(run.stdout)).toMatchObject({ status: "completed", id, evalStatus: "ineffective" });
		const again = cli(["eval", "--input", input]);
		expect(again.status).toBe(3);
		expect(JSON.parse(again.stdout)).toEqual({ status: "blocked", reason: `candidate has no pending eval: ${id}` });
		expect(cli(["eval", "--input", input, "--host", "claude"]).status).toBe(2);
		expect(cli(["eval"]).status).toBe(2);
		expect(knowledgeCli(home, id, ["promote"]).status).toBe(0);
		expect(entryOf(knowledge, id)).toMatchObject({ status: "active", eval_status: "ineffective" });
	});
});

describe("retro range", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const NOW = Date.UTC(2026, 9, 26, 12);

	function rangeHome() {
		const home = tempHome();
		const repo = path.join(home, "repo");
		fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
		expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
		return { home, repo: fs.realpathSync(repo) };
	}

	/** Writes a session record in its own project directory, last modified `age` days before NOW. */
	function rangeSession(home: string, id: string, cwd: string | undefined, age: number, records?: Json[]): string {
		const dir = path.join(home, ".claude", "projects", `-p-${id.slice(0, 8)}`);
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, `${id}.jsonl`);
		const body = (records ?? sessionRecords()).map((record) => JSON.stringify({ ...record, sessionId: id }));
		const first = JSON.stringify({ type: "summary", summary: "x".repeat(70_000) });
		const located = cwd === undefined ? [] : [JSON.stringify({ type: "user", sessionId: id, cwd, message: { role: "user", content: "hi" } })];
		fs.writeFileSync(file, `${[first, ...located, ...body].join("\n")}\n`);
		const time = new Date(NOW - age * DAY);
		fs.utimesSync(file, time, time);
		return file;
	}

	const id = (n: number) => `${String(n).padStart(8, "0")}-2222-4333-8444-555555555555`;

	test("analyzes each repository session changed in the range under its own snapshot", () => {
		const { home, repo } = rangeHome();
		rangeSession(home, id(1), repo, 1);
		rangeSession(home, id(2), path.join(repo, "sub"), 2);
		rangeSession(home, id(3), path.join(home, "elsewhere"), 1);
		rangeSession(home, id(4), `${repo}-sibling`, 1);
		rangeSession(home, id(5), repo, 10);
		rangeSession(home, id(6), undefined, 1);
		const subagents = path.join(home, ".claude", "projects", "-p-00000001", id(1), "subagents");
		fs.mkdirSync(subagents, { recursive: true });
		fs.writeFileSync(path.join(subagents, `${id(7)}.jsonl`), "{}\n");
		const stateRoot = path.join(home, ".goldband");
		const run = () => runRetroRange({ host: "claude", days: 7, cwd: path.join(repo, "sub"), stateRoot, env: env(home), now: NOW });

		const first = run();
		if (first.status !== "completed") throw new Error(first.reason);
		expect(first.unlocated).toBe(1);
		expect(first.sessions.map((session) => [session.sessionId, session.status])).toEqual([
			[id(2), "completed"],
			[id(1), "completed"],
		]);
		const [older, newer] = first.sessions;
		if (older.status !== "completed" || newer.status !== "completed") throw new Error("range session failed");
		expect(older.sha256).not.toBe(newer.sha256);
		expect(path.basename(older.reportPath)).toBe(`${id(2)}@${older.sha256}.json`);
		const report = JSON.parse(fs.readFileSync(older.reportPath, "utf8"));
		expect(report.snapshots).toEqual([expect.objectContaining({ sessionId: id(2), sha256: older.sha256 })]);
		expect(report.evidence.length).toBe(older.evidence);

		const options = { stateRoot, knowledgeRoot: path.join(stateRoot, "knowledge"), cwd: home };
		const submit = () =>
			runRetroProposals(
				{ sessionId: older.sessionId, sha256: older.sha256, proposals: [proposal(report)] },
				options,
			);
		expect(submit()).toMatchObject({ outcomes: [{ status: "written" }] });
		const second = run();
		expect(second).toEqual(first);
		expect(submit()).toMatchObject({ outcomes: [{ status: "duplicate" }] });
	});

	test("includes linked worktrees of the repository", () => {
		const { home, repo } = rangeHome();
		const git = (...args: string[]) =>
			spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "core.hooksPath=/dev/null", ...args], {
				encoding: "utf8",
			});
		expect(git("commit", "-q", "--allow-empty", "-m", "init").status).toBe(0);
		// A newline in a worktree path survives only NUL-separated listing.
		const linked = path.join(home, "linked\nworktree");
		const nested = path.join(repo, ".claude", "worktrees", "x");
		expect(git("worktree", "add", "-q", "--detach", linked).status).toBe(0);
		expect(git("worktree", "add", "-q", "--detach", nested).status).toBe(0);
		rangeSession(home, id(1), repo, 1);
		rangeSession(home, id(2), fs.realpathSync(linked), 1);
		rangeSession(home, id(3), fs.realpathSync(nested), 1);
		const run = (cwd: string) => runRetroRange({ host: "claude", days: 3, cwd, stateRoot: path.join(home, ".goldband"), env: env(home), now: NOW });
		for (const cwd of [repo, linked]) {
			const result = run(cwd);
			if (result.status !== "completed") throw new Error(result.reason);
			expect(result.sessions.map((session) => session.sessionId).sort()).toEqual([id(1), id(2), id(3)]);
		}
	});

	test("reports a duplicated id once as ambiguous and leaves out records of another session", () => {
		const { home, repo } = rangeHome();
		rangeSession(home, id(1), repo, 1);
		const copy = path.join(home, ".claude", "projects", "-copy");
		fs.mkdirSync(copy);
		fs.copyFileSync(rangeSession(home, id(2), repo, 1), path.join(copy, `${id(2)}.jsonl`));
		// The other copy of id 3 is older than the range and still makes the id ambiguous.
		const old = path.join(copy, `${id(3)}.jsonl`);
		fs.copyFileSync(rangeSession(home, id(3), repo, 1), old);
		fs.utimesSync(old, new Date(Date.now() - 30 * DAY), new Date(Date.now() - 30 * DAY));
		// A sidechain record named for an agent carries its parent's session id.
		const sidechain = path.join(home, ".claude", "projects", "-p-00000001", "agent-a1b2c3d4.jsonl");
		fs.writeFileSync(sidechain, `${JSON.stringify({ type: "user", sessionId: id(1), isSidechain: true, cwd: repo, message: { role: "user", content: "x" } })}\n`);
		const result = runRetroRange({ host: "claude", days: 3, cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home), now: Date.now() });
		if (result.status !== "completed") throw new Error(result.reason);
		expect(result.sessions.map(({ sessionId, status }) => [sessionId, status])).toEqual([
			[id(1), "completed"],
			[id(2), "failed"],
			[id(3), "failed"],
		]);
		expect(result.sessions[1]).toMatchObject({ reason: `Claude session id is ambiguous: ${id(2)}` });
		expect(result.sessions[2]).toMatchObject({ reason: `Claude session id is ambiguous: ${id(3)}` });
	});

	test("finds a working directory past the first read step", () => {
		const { home, repo } = rangeHome();
		const file = rangeSession(home, id(1), repo, 1);
		const lines = fs.readFileSync(file, "utf8").split("\n");
		lines[0] = JSON.stringify({ type: "summary", summary: "x".repeat(600_000) });
		fs.writeFileSync(file, lines.join("\n"));
		const time = new Date(NOW - DAY);
		fs.utimesSync(file, time, time);
		const result = runRetroRange({ host: "claude", days: 3, cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home), now: NOW });
		expect(result).toMatchObject({ status: "completed", sessions: [{ sessionId: id(1), status: "completed" }], unlocated: 0 });
	});

	test("reports a malformed session as failed and keeps the others", () => {
		const { home, repo } = rangeHome();
		rangeSession(home, id(1), repo, 1);
		rangeSession(home, id(2), repo, 1, [{ type: "assistant", sessionId: id(2), message: { content: "x" } }, { nope: true }]);
		const result = runRetroRange({ host: "claude", days: 3, cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home), now: NOW });
		if (result.status !== "completed") throw new Error(result.reason);
		expect(result.sessions.map((session) => session.status).sort()).toEqual(["completed", "failed"]);
		expect(result.sessions.find((session) => session.status === "failed")).toEqual({
			sessionId: id(2),
			status: "failed",
			reason: expect.stringContaining("has no type"),
		});
	});

	test("excludes nested worktrees and repositories and counts unreadable records as unlocated", () => {
		const { home, repo } = rangeHome();
		const worktree = path.join(repo, ".worktrees", "feature");
		const nested = path.join(repo, "vendor", "lib");
		fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
		fs.writeFileSync(path.join(worktree, ".git"), "gitdir: ../../.git/worktrees/feature\n");
		fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
		rangeSession(home, id(1), repo, 1);
		rangeSession(home, id(2), path.join(worktree, "src"), 1);
		rangeSession(home, id(3), nested, 1);
		rangeSession(home, id(4), path.join(repo, "removed", "dir"), 1);
		rangeSession(home, id(6), "removed", 1);
		fs.chmodSync(rangeSession(home, id(5), repo, 1), 0o000);
		const locked = path.join(home, ".claude", "projects", "-locked");
		fs.mkdirSync(locked);
		fs.chmodSync(locked, 0o000);
		// Listable but not searchable: the directory reads, each entry's status does not.
		const listOnly = path.join(home, ".claude", "projects", "-list-only");
		fs.mkdirSync(listOnly);
		fs.writeFileSync(path.join(listOnly, `${id(9)}.jsonl`), "{}\n");
		fs.chmodSync(listOnly, 0o444);
		try {
			// Run from a subdirectory without `.git`, where a relative cwd once never reached the root.
			const result = runRetroRange({ host: "claude", days: 3, cwd: path.join(repo, "sub"), stateRoot: path.join(home, ".goldband"), env: env(home), now: NOW });
			if (result.status !== "completed") throw new Error(result.reason);
			expect(result.sessions.map((session) => [session.sessionId, session.status])).toEqual([
				[id(1), "completed"],
				[id(4), "completed"],
			]);
			expect(result.unlocated).toBe(1);
			expect(result.unreadableDirectories).toBe(2);
			// A relative cwd resolves against the process directory, so run the CLI inside the repository.
			const cli = spawnSync("bun", [path.join(ROOT, "bin", "goldband-retro.ts"), "evidence", "--host", "claude", "--days", "3"], {
				cwd: path.join(repo, "sub"),
				env: env(home),
				encoding: "utf8",
				timeout: 20_000,
			});
			expect(cli.status).toBe(0);
			expect(JSON.parse(cli.stdout).sessions.map((session: Json) => session.sessionId)).not.toContain(id(6));
		} finally {
			fs.chmodSync(path.join(home, ".claude", "projects", `-p-${id(5).slice(0, 8)}`, `${id(5)}.jsonl`), 0o600);
			fs.chmodSync(locked, 0o700);
			fs.chmodSync(listOnly, 0o700);
		}
	});

	test("keeps a failed session's reason in the workflow output without its record path", async () => {
		const { home, repo } = rangeHome();
		rangeSession(home, id(1), repo, 0);
		const broken = rangeSession(home, id(2), repo, 0, [{ type: "assistant", sessionId: id(2), message: { content: "x" } }, { nope: true }]);
		const goldbandHome = path.join(home, ".goldband");
		const inputFile = path.join(home, "input.json");
		fs.writeFileSync(inputFile, JSON.stringify({ mode: "evidence", days: 1 }));
		const saved = process.env.CLAUDE_CONFIG_DIR;
		process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
		try {
			const run = await runWorkflow(getWorkflow("context/retro"), { mode: "real", host: "claude", cwd: repo, goldbandHome, inputFile });
			const output = run.output as { sessions: Json[]; evidence: string[] };
			expect(output.sessions.find((session) => session.sessionId === id(2))).toMatchObject({
				status: "failed",
				reason: expect.stringContaining("has no type"),
			});
			expect(output.evidence).toContain(`${id(2)}: failed: claude session record 3 has no type`);
		} finally {
			if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
			else process.env.CLAUDE_CONFIG_DIR = saved;
		}
		for (const file of filesUnder(goldbandHome)) {
			expect({ file, leaked: fs.readFileSync(file, "utf8").includes(broken) }).toEqual({ file, leaked: false });
		}
	});

	test("bounds the range and its session count", () => {
		const { home, repo } = rangeHome();
		const options = { host: "claude", cwd: repo, stateRoot: path.join(home, ".goldband"), env: env(home), now: NOW };
		expect(runRetroRange({ ...options, days: 1 })).toEqual({ status: "completed", days: 1, sessions: [], unlocated: 0, unreadableDirectories: 0, unreadRecords: 0 });
		for (const days of [0, 91, 1.5]) expect(() => runRetroRange({ ...options, days })).toThrow("days must be an integer from 1 to 90");
		expect(runRetroRange({ ...options, host: "gemini", days: 1 })).toMatchObject({ status: "blocked", reason: "context/retro has no gemini session adapter" });
		for (let n = 1; n <= 201; n += 1) rangeSession(home, id(n), repo, 0, []);
		expect(runRetroRange({ ...options, days: 1 })).toEqual({
			status: "blocked",
			reason: "201 sessions in the last 1 days exceed 200; use fewer days",
		});
	});

	test("accepts --days only as a bounded integer without --session", () => {
		const { home, repo } = rangeHome();
		const cli = (args: string[]) =>
			spawnSync("bun", [path.join(ROOT, "bin", "goldband-retro.ts"), "evidence", "--host", "claude", ...args], {
				cwd: repo,
				env: env(home),
				encoding: "utf8",
			});
		for (const args of [["--days", "0"], ["--days", "91"], ["--days", "1.5"], ["--days", "3", "--session", SESSION]]) {
			expect({ args, status: cli(args).status }).toEqual({ args, status: 2 });
		}
		const run = cli(["--days", "3"]);
		expect(run.status).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({ status: "completed", days: 3, sessions: [], unlocated: 0, unreadableDirectories: 0, unreadRecords: 0 });
	});
});

describe("retro owner runtime", () => {
	test("persists a byte-identical report for the same snapshot and excludes later records", () => {
		const home = tempHome();
		const file = writeSession(home, sessionRecords());
		const stateRoot = path.join(home, ".goldband");
		const first = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (first.status !== "completed") throw new Error(first.reason);
		const bytes = fs.readFileSync(first.reportPath);
		const second = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		expect(second.status === "completed" && fs.readFileSync(second.reportPath).equals(bytes)).toBe(true);
		fs.appendFileSync(file, '{"type":"assistant","sessionId"');
		const partial = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		expect(partial.status === "completed" && partial.reportPath).toBe(first.reportPath);
	});

	test("blocks other hosts and missing sessions", () => {
		const home = tempHome();
		const stateRoot = path.join(home, ".goldband");
		expect(runRetroEvidence({ host: "gemini", stateRoot, env: env(home) })).toMatchObject({
			status: "blocked",
			reason: "context/retro has no gemini session adapter",
		});
		expect(runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) })).toMatchObject({
			status: "blocked",
			reason: expect.stringContaining("not found"),
		});
	});

	test("writes proposals as inferred retro candidates and skips reruns and rewording", () => {
		const home = tempHome();
		writeSession(home, sessionRecords());
		const stateRoot = path.join(home, ".goldband");
		const knowledge = path.join(stateRoot, "knowledge");
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const snapshot = evidence.report.snapshots[0];
		const request = (proposals: Json[]) => ({ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals });
		const options = { stateRoot, knowledgeRoot: knowledge, cwd: home };

		const written = runRetroProposals(request([proposal(evidence.report)]), options);
		if (written.status !== "completed") throw new Error(written.reason);
		const id = written.outcomes[0].id ?? "";
		expect(written.outcomes[0].status).toBe("written");
		expect(id).toMatch(/^retro-[0-9a-f]{16}$/);
		const entry = parseKnowledgeFile(path.join(knowledge, "entries", `${id}.md`));
		expect(entry).toMatchObject({ status: "candidate", source: "retro", trust_level: "inferred" });
		expect(entry.body).toContain("### 實測（measured）");
		expect(entry.body).toContain("- duplicate-search: 2 count (Grep)，#1, #3");
		expect(entry.body).toContain("### 推論（inferred，未經驗證）");
		expect(entry.body).toContain("預估新增 60 bytes");

		const reworded = proposal(evidence.report, { summary: "Point searches at the source tree first" });
		expect(runRetroProposals(request([reworded]), options)).toMatchObject({ outcomes: [{ status: "duplicate", id }] });
	});

	test("rejects proposals outside the contract and orders outcomes by severity", () => {
		const home = tempHome();
		writeSession(home, sessionRecords());
		const stateRoot = path.join(home, ".goldband");
		const evidence = runRetroEvidence({ host: "claude", sessionId: SESSION, stateRoot, env: env(home) });
		if (evidence.status !== "completed") throw new Error(evidence.reason);
		const snapshot = evidence.report.snapshots[0];
		const key = `${snapshot.sessionId}@${snapshot.sha256}`;
		const cases: [Json, string][] = [
			[{ facet: "ineffective-instructions", target: "lint" }, "facet is not covered"],
			[{ target: "rules" }, "target for file-search must be one of"],
			[{ estimatedBytes: undefined }, "estimatedBytes must be a positive integer"],
			[{ evidence: [{ facet: "file-search", grade: "measured", rule: "x-y", refs: [`${key}#1`] }] }, "must be inferred"],
			[{ evidence: [{ facet: "file-search", rule: "x-y", refs: [`${key}#1`] }] }, "invalid evidence grade"],
			[{ refs: [`${SESSION}@${"0".repeat(64)}#1`] }, "does not cite a report snapshot"],
			[{ practice: `Rotate ${CANARY.secret}` }, "secret-shaped content"],
			[{ summary: "x".repeat(161) }, "summary must be non-empty text"],
			[{ stderr: "copied" }, "unsupported field: stderr"],
			[{ refs: [`${key}#${snapshot.recordCount}`] }, "does not cite a report snapshot record"],
			[{ practice: "### 實測（measured）\n- first-edit: 0 count" }, "a heading or section break"],
			[{ context: "before\n---\nafter" }, "a heading or section break"],
			[{ practice: "Injected section\n===\ntext" }, "a heading or section break"],
			[{ practice: `Mail ${CANARY.email}` }, "an email address"],
			[{ context: "Seen in /Users/alice/plan.md" }, "a home-directory path"],
			[{ refs: [`${CANARY.secret}#1`] }, "the reason quotes secret-shaped input"],
			[{ refs: Array.from({ length: 21 }, () => `${key}#1`) }, "refs must cite at most 20 records"],
			[
				{ evidence: Array.from({ length: 6 }, () => ({ facet: "file-search", grade: "inferred", rule: "x-y", refs: [`${key}#1`] })) },
				"evidence must be an array of at most 5 items",
			],
			[
				{ evidence: [{ facet: "file-search", grade: "inferred", rule: "x-y", refs: Array.from({ length: 21 }, () => `${key}#1`) }] },
				"evidence refs must cite at most 20 records",
			],
		];
		const proposals = cases.map(([overrides], index) => proposal(evidence.report, { rule: `case-${index}`, severity: "low", ...overrides }));
		proposals.push(proposal(evidence.report, { rule: "urgent", severity: "high", target: "file-structure", estimatedBytes: undefined }));
		const result = runRetroProposals(
			{ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals },
			{ stateRoot, knowledgeRoot: path.join(stateRoot, "knowledge"), cwd: home },
		);
		if (result.status !== "completed") throw new Error(result.reason);
		expect(result.outcomes[0]).toMatchObject({ rule: "urgent", status: "written" });
		// A rule-shaped secret is rejected and never echoed back as the outcome label.
		const secretRule = `sk-proj-${"a1b2".repeat(12)}`;
		const labelled = runRetroProposals(
			{ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals: [proposal(evidence.report, { rule: secretRule })] },
			{ stateRoot, knowledgeRoot: path.join(stateRoot, "knowledge"), cwd: home },
		);
		expect(JSON.stringify(labelled)).not.toContain(secretRule);
		expect(labelled).toMatchObject({ outcomes: [{ rule: "invalid", status: "rejected" }] });
		cases.forEach(([, reason], index) => {
			expect(result.outcomes[index + 1]).toMatchObject({ rule: `case-${index}`, status: "rejected", reason: expect.stringContaining(reason) });
		});
		expect(
			runRetroProposals({ sessionId: SESSION, sha256: "1".repeat(64), proposals: [] }, { stateRoot, cwd: home }),
		).toMatchObject({ status: "blocked" });
	});
});

describe("knowledge CLI", () => {
	test("leaves retro candidates to the retro owner", () => {
		const home = tempHome();
		for (const args of [
			["capture-candidate", "--source-type", "retro", "--source-evidence", "x", "--summary", "y"],
			["add", "--source", "retro", "--id", "retro-x", "--title", "t", "--type", "practice", "--domains", "general", "--summary", "s", "--body", "b"],
		]) {
			const run = spawnSync("bun", [path.join(ROOT, "bin", "goldband-knowledge.ts"), ...args], { cwd: home, env: env(home), encoding: "utf8" });
			expect({ args: args[0], status: run.status, stderr: run.stderr.includes("must be one of") }).toEqual({ args: args[0], status: 1, stderr: true });
		}
		expect(fs.existsSync(path.join(home, ".goldband", "knowledge"))).toBe(false);
	});
});

describe("goldband-retro CLI", () => {
	test("keeps session text out of every persisted output", () => {
		const home = tempHome();
		const recordPath = writeSession(home, sessionRecords());
		const evidence = retroCli(home, ["evidence", "--host", "claude"], { CLAUDE_CODE_SESSION_ID: SESSION });
		expect(evidence.status).toBe(0);
		const output = JSON.parse(evidence.stdout);
		expect(output).toMatchObject({ status: "completed", recordPath });
		const input = path.join(home, "proposals.json");
		const snapshot = output.report.snapshots[0];
		fs.writeFileSync(input, JSON.stringify({ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals: [proposal(output.report)] }));
		const proposed = retroCli(home, ["propose", "--input", input]);
		expect(proposed.status).toBe(0);
		expect(JSON.parse(proposed.stdout).outcomes[0].status).toBe("written");

		const persisted = filesUnder(path.join(home, ".goldband"));
		expect(persisted.length).toBeGreaterThan(1);
		for (const file of persisted) {
			const text = fs.readFileSync(file, "utf8");
			for (const value of [...Object.values(CANARY), recordPath, "/repo/secret.ts", "npm test"]) {
				expect({ file, leaked: text.includes(value) }).toEqual({ file, leaked: false });
			}
		}
	});

	test("runs the typed workflow owner in real mode through the CLI", async () => {
		const home = tempHome();
		const [first, ...rest] = sessionRecords();
		const recordPath = writeSession(home, [{ ...first, cwd: fs.realpathSync(home) }, ...rest]);
		const goldbandHome = path.join(home, ".goldband");
		const saved = { dir: process.env.CLAUDE_CONFIG_DIR, id: process.env.CLAUDE_CODE_SESSION_ID };
		process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
		process.env.CLAUDE_CODE_SESSION_ID = SESSION;
		try {
			const run = (input: Json) => {
				const inputFile = path.join(home, `input-${input.mode}.json`);
				fs.writeFileSync(inputFile, JSON.stringify(input));
				return runWorkflow(getWorkflow("context/retro"), { mode: "real", host: "claude", cwd: home, goldbandHome, inputFile });
			};
			const evidence = await run({ mode: "evidence" });
			expect(evidence.output).toMatchObject({ status: "completed", report: { schemaVersion: 1 } });
			const report = (evidence.output as { report: { snapshots: { sessionId: string; sha256: string }[] } }).report;
			const proposed = await run({
				mode: "propose",
				sessionId: report.snapshots[0].sessionId,
				sha256: report.snapshots[0].sha256,
				proposals: [proposal(report)],
			});
			expect(proposed.output).toMatchObject({ status: "completed", outcomes: [{ status: "written" }] });
			const range = await run({ mode: "evidence", days: 2 });
			expect(range.output).toMatchObject({
				status: "completed",
				days: 2,
				unlocated: 0,
				sessions: [{ sessionId: SESSION, status: "completed", sha256: report.snapshots[0].sha256 }],
				evidence: [
					`${SESSION}@${report.snapshots[0].sha256}: evidence=${(evidence.output as { report: { evidence: unknown[] } }).report.evidence.length}`,
					"unlocated=0",
					"unreadableDirectories=0",
					"unreadRecords=0",
				],
			});
			const missing = await run({ mode: "evidence", sessionId: "00000000-0000-4000-8000-000000000000" });
			expect(missing.output).toMatchObject({ status: "blocked" });
			await expect(runWorkflow(getWorkflow("context/retro"), { mode: "real", cwd: home, goldbandHome })).rejects.toThrow(
				"real mode requires an explicit host",
			);
			const modeFile = path.join(home, "input-bad-mode.json");
			fs.writeFileSync(modeFile, JSON.stringify({ mode: CANARY.prompt }));
			const badMode = runWorkflow(getWorkflow("context/retro"), { mode: "mock", cwd: home, goldbandHome, inputFile: modeFile });
			await expect(badMode).rejects.toThrow("context/retro mode must be one of: evidence, propose");
		} finally {
			for (const [key, value] of [["CLAUDE_CONFIG_DIR", saved.dir], ["CLAUDE_CODE_SESSION_ID", saved.id]] as const) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
		for (const file of filesUnder(goldbandHome)) {
			const text = fs.readFileSync(file, "utf8");
			for (const value of [...Object.values(CANARY), recordPath]) {
				expect({ file, leaked: text.includes(value) }).toEqual({ file, leaked: false });
			}
		}
	});

	test("lets exactly one concurrent run write a candidate", async () => {
		const home = tempHome();
		writeSession(home, sessionRecords());
		const evidence = retroCli(home, ["evidence", "--host", "claude", "--session", SESSION]);
		const report = JSON.parse(evidence.stdout).report;
		const snapshot = report.snapshots[0];
		const runs = [0, 1, 2, 3].map((index) => {
			const input = path.join(home, `concurrent-${index}.json`);
			const reworded = proposal(report, { summary: `Name the source directory, wording ${index}` });
			fs.writeFileSync(input, JSON.stringify({ sessionId: snapshot.sessionId, sha256: snapshot.sha256, proposals: [reworded] }));
			const child = Bun.spawn(["bun", path.join(ROOT, "bin", "goldband-retro.ts"), "propose", "--input", input], {
				cwd: home,
				env: env(home),
				stdout: "pipe",
			});
			return new Response(child.stdout).text();
		});
		const statuses = (await Promise.all(runs)).map((stdout) => JSON.parse(stdout).outcomes[0].status).sort();
		expect(statuses).toEqual(["duplicate", "duplicate", "duplicate", "written"]);
		const entries = fs.readdirSync(path.join(home, ".goldband", "knowledge", "entries"));
		expect(entries.filter((name) => name.endsWith(".md"))).toHaveLength(1);
		expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
	});

	test("reports blocked, usage, and format errors with distinct exit codes", () => {
		const home = tempHome();
		expect(retroCli(home, ["evidence", "--host", "claude", "--session", SESSION]).status).toBe(3);
		expect(retroCli(home, ["evidence"]).status).toBe(2);
		expect(retroCli(home, ["evidence", "--host", "gemini"]).status).toBe(2);
		for (const args of [["evidence", "--host"], ["evidence", "--host", "claude", "--session", ""], ["evidence", "--bogus", "x"], ["evidence", "--host", "claude", "--host", "claude"]]) {
			const run = retroCli(home, args);
			expect({ args, status: run.status, usage: run.stderr.startsWith("Usage:") }).toEqual({ args, status: 2, usage: true });
		}
		writeSession(home, [{ type: "user", sessionId: SESSION, message: { content: "x" } }, result("missing", "x")]);
		const broken = retroCli(home, ["evidence", "--host", "claude", "--session", SESSION]);
		expect(broken.status).toBe(1);
		expect(broken.stderr).toContain("tool_result without a matching tool_use");
	});
});
