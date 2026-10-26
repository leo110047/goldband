import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseKnowledgeFile } from "../lib/knowledge";
import { analyzeRetroSession, classifyShellCommand, isEmptyShellSearch } from "../lib/session-retro-analysis";
import { locateClaudeSession, readClaudeSession } from "../lib/session-retro-claude";
import type { RetroToolEventV1 } from "../lib/session-retro-evidence";
import { readSessionSnapshot } from "../lib/session-retro-snapshot";
import { runRetroEvidence, runRetroProposals } from "../lib/session-retro-runtime";
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

	test("parses the de-identified sampled session", () => {
		const fixture = path.join(import.meta.dir, "fixtures", "session-retro", "claude-session.jsonl");
		const session = readClaudeSession(fixture, "00000000-0000-4000-8000-00000000c1a0");
		expect(session.tools.length).toBe(23);
		expect(session.tools.filter((event) => event.category === "edit").length).toBeGreaterThan(0);
		expect(session.tools.filter((event) => event.exitCode !== undefined && event.exitCode !== 0)).toHaveLength(1);
		expect(analyzeRetroSession(session).facets["tool-cost"]).toEqual({ status: "covered" });
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

	test("covers two facets and marks the other three unavailable", () => {
		expect(report().report.facets).toEqual({
			"file-search": { status: "covered" },
			"auto-checks": { status: "unavailable", reason: "not-implemented" },
			"tool-cost": { status: "covered" },
			"info-access": { status: "unavailable", reason: "not-implemented" },
			"ineffective-instructions": { status: "unavailable", reason: "not-implemented" },
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

	test("lists the largest duplicate groups and counts every group", () => {
		const snapshot = { host: "claude" as const, sessionId: SESSION, byteLength: 1, recordCount: 400, sha256: "c".repeat(64) };
		const tools: RetroToolEventV1[] = [];
		// Group g has g + 2 calls; group 24 is the largest.
		for (let group = 0; group < 25; group += 1) {
			for (let call = 0; call < group + 2; call += 1) {
				tools.push({
					ordinal: tools.length,
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
		expect(runRetroEvidence({ host: "codex", stateRoot, env: env(home) })).toMatchObject({ status: "blocked" });
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
			[{ facet: "auto-checks", target: "lint" }, "facet is not covered"],
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
		const recordPath = writeSession(home, sessionRecords());
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
