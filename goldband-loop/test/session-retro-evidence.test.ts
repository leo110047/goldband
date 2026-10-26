import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	formatRetroRef,
	RETRO_FACETS,
	type RetroReportV1,
	type RetroSnapshotRefV1,
	validateRetroReport,
	validateRetroToolEvent,
} from "../lib/session-retro-evidence";

const FIXTURES = path.join(import.meta.dir, "fixtures", "session-retro");
const HASH = "a".repeat(64);
const SNAPSHOT: RetroSnapshotRefV1 = {
	host: "claude",
	sessionId: "00000000-0000-4000-8000-00000000c1a0",
	byteLength: 4096,
	recordCount: 64,
	sha256: "b".repeat(64),
};

function report(): RetroReportV1 {
	return {
		schemaVersion: 1,
		snapshots: [{ ...SNAPSHOT }],
		facets: {
			"file-search": { status: "covered" },
			"auto-checks": { status: "unavailable", reason: "not-implemented" },
			"tool-cost": { status: "covered" },
			"info-access": { status: "unavailable", reason: "not-implemented" },
			"ineffective-instructions": { status: "unavailable", reason: "not-implemented" },
		},
		evidence: [
			{
				facet: "tool-cost",
				grade: "measured",
				rule: "duplicate-call",
				refs: [formatRetroRef(SNAPSHOT, 12), formatRetroRef(SNAPSHOT, 40)],
				metric: { value: 2, unit: "count" },
				tool: "Bash",
				inputSha256: HASH,
			},
			{ facet: "file-search", grade: "inferred", rule: "unused-read", refs: [formatRetroRef(SNAPSHOT, 7)] },
		],
	};
}

describe("retro report contract", () => {
	test("accepts a report with every facet status and cited evidence", () => {
		expect(validateRetroReport(report())).toEqual(report());
	});

	test("rejects evidence without a grade", () => {
		const value = report() as unknown as { evidence: Record<string, unknown>[] };
		delete value.evidence[0].grade;
		expect(() => validateRetroReport(value)).toThrow("invalid evidence grade");
	});

	test("rejects fields outside the persistence allowlist", () => {
		for (const field of ["stderr", "output", "prompt", "content", "path"]) {
			const value = report() as unknown as { evidence: Record<string, unknown>[] };
			value.evidence[0][field] = "leaked text";
			expect(() => validateRetroReport(value)).toThrow(`unsupported field: ${field}`);
		}
		const snapshot = report() as unknown as { snapshots: Record<string, unknown>[] };
		snapshot.snapshots[0].path = "/home/user/.claude/projects/x/session.jsonl";
		expect(() => validateRetroReport(snapshot)).toThrow("unsupported field: path");
	});

	test("accepts instruction source kinds and content hashes only in their shapes", () => {
		const value = report();
		value.facets["ineffective-instructions"] = { status: "covered" };
		value.evidence.push({
			facet: "ineffective-instructions",
			grade: "measured",
			rule: "instruction-source",
			refs: [formatRetroRef(SNAPSHOT, 2)],
			metric: { value: 120, unit: "bytes" },
			sourceKind: "project",
			contentSha256: HASH,
		});
		expect(validateRetroReport(value)).toEqual(value);
		const evidence = value.evidence[2] as unknown as Record<string, unknown>;
		evidence.sourceKind = "/repo/CLAUDE.md";
		expect(() => validateRetroReport(value)).toThrow("invalid evidence sourceKind");
		evidence.sourceKind = "project";
		evidence.contentSha256 = "Use plain Traditional Chinese";
		expect(() => validateRetroReport(value)).toThrow("contentSha256");
	});

	test("requires all five facets", () => {
		for (const facet of RETRO_FACETS) {
			const value = report() as unknown as { facets: Record<string, unknown> };
			delete value.facets[facet];
			expect(() => validateRetroReport(value)).toThrow(`facet ${facet} must be an object`);
		}
	});

	test("rejects evidence for a facet marked unavailable", () => {
		const value = report();
		value.evidence[0].facet = "auto-checks";
		expect(() => validateRetroReport(value)).toThrow("evidence for unavailable facet: auto-checks");
	});

	test("rejects refs that do not cite a report snapshot", () => {
		const value = report();
		value.evidence[0].refs = [`${SNAPSHOT.sessionId}@${"c".repeat(64)}#3`];
		expect(() => validateRetroReport(value)).toThrow("does not cite a report snapshot");
		value.evidence[0].refs = [`${SNAPSHOT.sessionId}@${SNAPSHOT.sha256}#03`];
		expect(() => validateRetroReport(value)).toThrow("does not cite a report snapshot");
		value.evidence[0].refs = [formatRetroRef(SNAPSHOT, 64)];
		expect(() => validateRetroReport(value)).toThrow("does not cite a report snapshot record");
		value.evidence[0].refs = [formatRetroRef(SNAPSHOT, 63)];
		expect(validateRetroReport(value).evidence[0].refs).toEqual([formatRetroRef(SNAPSHOT, 63)]);
	});
});

describe("retro tool event contract", () => {
	const event = { ordinal: 3, resultOrdinal: 4, tool: "Bash", category: "command", inputSha256: HASH, outputBytes: 120, failed: true };

	test("leaves host-unrecorded fields absent", () => {
		expect(validateRetroToolEvent(event)).toEqual(event);
		expect(validateRetroToolEvent({ ...event, exitCode: 2, truncated: false })).toMatchObject({ exitCode: 2 });
	});

	test("rejects raw output and unknown categories", () => {
		expect(() => validateRetroToolEvent({ ...event, output: "text" })).toThrow("unsupported field: output");
		expect(() => validateRetroToolEvent({ ...event, category: "shell" })).toThrow("invalid tool event category");
		expect(() => validateRetroToolEvent({ ...event, resultOrdinal: 2 })).toThrow("resultOrdinal must not precede its ordinal");
	});
});

describe("session-retro fixtures", () => {
	// Free text is replaced by same-length "x" filler, ids by pseudonyms, and
	// timestamps by a fixed base; only enum-valued keys and tool names keep text.
	const scrubbed = /^(x*|id-\d{6}|2026-01-01T\d\d:\d\d:\d\d\.000Z|00000000-0000-[47]000-8000-00000000c(1a0|0de))$/;
	const marker = /^(Exit code \d+\n)?(…\d+ tokens truncated…)*x*$/;
	const enumKeys = new Set([
		"type", "role", "status", "stop_reason", "subtype", "decision", "reasonType", "phase", "level",
		"userType", "entrypoint", "server", "tool", "kind", "mode", "output_mode", "history_mode", "originator",
		"model_provider", "approval_policy", "effort", "reasoning_effort", "service_tier", "speed", "hookEvent",
		"turn_trigger",
	]);
	const toolParents = new Set(["tool_use", "function_call", "custom_tool_call"]);
	const enumValue = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
	const plainKey = /^[A-Za-z_$][\w$-]*$/;

	for (const host of ["claude", "codex"]) {
		test(`${host} fixture keeps text only in enum fields and tool names`, () => {
			const lines = fs.readFileSync(path.join(FIXTURES, `${host}-session.jsonl`), "utf8").trimEnd().split("\n");
			expect(lines.length).toBeGreaterThan(100);
			const residue = new Set<string>();
			const walk = (value: unknown, key: string, parent: Record<string, unknown> | null): void => {
				if (typeof value === "string") {
					const raw = enumKeys.has(key) || (key === "name" && toolParents.has(String(parent?.type)));
					if (!scrubbed.test(value) && !marker.test(value) && !(raw && enumValue.test(value))) {
						residue.add(`${key}=${value.slice(0, 40)}`);
					}
				} else if (Array.isArray(value)) {
					for (const item of value) walk(item, key, parent);
				} else if (value && typeof value === "object") {
					const object = value as Record<string, unknown>;
					for (const [child, item] of Object.entries(object)) {
						if (!plainKey.test(child) && !scrubbed.test(child)) residue.add(`key:${child.slice(0, 40)}`);
						walk(item, child, object);
					}
				}
			};
			for (const line of lines) walk(JSON.parse(line), "", null);
			expect([...residue]).toEqual([]);
		});
	}
});
