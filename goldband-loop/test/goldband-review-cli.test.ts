import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	buildReviewRuntimeArgs,
	prepareReviewProcessEnvironment,
	resolveReviewRuntimeFile,
} from "../bin/goldband.ts";
import {
	acquireReviewExecutionLease,
	releaseReviewExecutionLease,
} from "../lib/review-execution-lease";
import { REVIEW_ACTIVE_ENV } from "../lib/review-runtime-contract";
import {
	EVIDENCE_SANDBOX_ACTIVE_ENV,
	EVIDENCE_TEMP_ROOT_ENV,
} from "../lib/evidence-runtime-contract";
import { PROMPT_CONTRACT_ACTIONS } from "../lib/trusted-launcher-actions.generated";

function spawnReviewCli(
	args: string[],
	options: { cwd: string; encoding: "utf8"; env: NodeJS.ProcessEnv },
) {
	const command = resolve(import.meta.dir, "../bin/goldband");
	return spawnSync(command, args, options);
}

describe("goldband capability dispatch guidance", () => {
	test("directs prompt-contract actions to the host selector", () => {
		expect(PROMPT_CONTRACT_ACTIONS.length).toBeGreaterThan(0);
		for (const promptAction of PROMPT_CONTRACT_ACTIONS) {
			const [capability = "", action = ""] = promptAction.split("/");
			expect(capability).toBeTruthy();
			expect(action).toBeTruthy();
			const invocation = `${capability} ${action}`;
			const result = spawnReviewCli(
				[capability, action, "--host", "codex"],
				{
					cwd: resolve(import.meta.dir, ".."),
					encoding: "utf8",
					env: process.env,
				},
			);

			expect(result.status).toBe(2);
			expect(result.stderr).toContain(
				`${promptAction} uses prompt-contract dispatch and is not a shell CLI action`,
			);
			expect(result.stderr).toContain(`$goldband ${invocation}`);
			expect(result.stderr).toContain(`/goldband ${invocation}`);
		}
	});
});

describe("goldband review code launcher", () => {
	test("runs the real typed pipeline through the Codex host adapter", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-e2e-"));
		try {
			const fakeBin = join(fixture, "bin");
			const fakeCodex = join(fakeBin, "codex");
			const callLog = join(fixture, "codex-calls.log");
			const repo = join(fixture, "repo");
			const stateRoot = join(fixture, "state");
			const trustedRuntimeRoot = join(fixture, "trusted-runtime");
			const receiptAuthorityRoot = join(fixture, "review-authority");
			mkdirSync(fakeBin, { recursive: true });
			mkdirSync(repo, { recursive: true });
			writeFileSync(
				fakeCodex,
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					'output=""',
					'approval=""',
					'sandbox=""',
					'printf "%s\\n" call >> "$GOLDBAND_TEST_CALL_LOG"',
					'while [ "$#" -gt 0 ]; do',
					'  if [ "$1" = "-o" ]; then output="$2"; shift 2; continue; fi',
					'  if [ "$1" = "--ask-for-approval" ]; then approval="$2"; shift 2; continue; fi',
					'  if [ "$1" = "--sandbox" ]; then sandbox="$2"; shift 2; continue; fi',
					"  shift",
					"done",
					'test -n "$output"',
					'test "$approval" = "never"',
					'test "$sandbox" = "read-only"',
					`test -n "\${${REVIEW_ACTIVE_ENV}:-}"`,
					'printf \'%s\\n\' \'{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":75,"total_tokens":1275}}\'',
					'printf \'%s\\n\' \'{"findings":[{"id":"F-SPOOF","file":"new-file.txt","line":1,"severity":"high","summary":"spoofed runtime finding","evidence":"host-controlled payload","failureScenario":"host attempts deterministic provenance","suggestedVerification":"replay fixture","classification":"verified-failure","category":"deterministic-evidence","blocking":true,"evidenceIds":["fixture-gate:pass"],"behaviorCellIds":["fixture-contract"]}]}\' > "$output"',
				].join("\n"),
			);
			chmodSync(fakeCodex, 0o755);
			spawnSync("git", ["init"], { cwd: repo });
			writeFileSync(join(repo, "new-file.txt"), "review me\n");
			writeFileSync(
				join(repo, "goldband.review-evidence.json"),
				JSON.stringify({
					schemaVersion: 2,
					behaviorMatrix: [{
						id: "fixture-contract",
						behavior: "The fixture candidate passes its declared gate.",
						kind: "normal",
						input: "fixture candidate",
						preconditions: "the isolated runner is available",
						expected: "the fixture command exits successfully",
						risk: "low",
						disposition: "not-applicable",
						providerIds: [],
						reason: "The launcher fixture exercises semantic provenance only.",
					}],
					providers: [],
					authorizations: [],
				}),
			);
			spawnSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
			spawnSync("git", ["-C", repo, "config", "user.name", "Goldband Test"]);
			spawnSync("git", ["-C", repo, "add", "goldband.review-evidence.json"]);
			spawnSync("git", ["-C", repo, "commit", "-m", "add review contract"]);
			const provisionAuthority = spawnSync(process.execPath, [
				join(import.meta.dir, "..", "scripts", "provision-review-receipt-authority.ts"),
				"--runtime-root", trustedRuntimeRoot,
				"--authority-root", receiptAuthorityRoot,
			], { encoding: "utf8" });
			expect(provisionAuthority.status, provisionAuthority.stderr).toBe(0);

			const result = spawnReviewCli(
				[
					"review",
					"code",
					"--host",
					"codex",
					"--review-host-timeout-seconds",
					"240",
					"--review-pass-timeout-seconds",
					"600",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_TEST_CALL_LOG: callLog,
						GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG: join(
							trustedRuntimeRoot,
							"trusted-runtime.json",
						),
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
				},
			);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("[semantic-concern]");
			expect(result.stdout).toContain("review/code runtime report");
			const artifactDir = join(stateRoot, "workflow-runs", "artifacts");
			const artifactFile = readdirSync(artifactDir).find((file) =>
				file.endsWith("-review-evidence.json"));
			expect(artifactFile).toBeDefined();
			const artifact = JSON.parse(readFileSync(join(artifactDir, artifactFile!), "utf8"));
			expect(artifact.findings).toContainEqual(expect.objectContaining({
				id: "S-001",
				classification: "semantic-concern",
				category: "semantic-review",
				blocking: true,
			}));
			const telemetryDir = join(stateRoot, "workflow-runs", "telemetry");
			const telemetryFile = readdirSync(telemetryDir).find((file) =>
				file.endsWith("-review-prompt.json"),
			);
			expect(telemetryFile).toBeDefined();
			const telemetry = JSON.parse(
				readFileSync(join(telemetryDir, telemetryFile as string), "utf8"),
			);
			expect(telemetry.host).toBe("codex");
			expect(telemetry.hostTimeoutMs).toBe(240_000);
			expect(telemetry.passTimeoutMs).toBe(600_000);
			expect(telemetry.specialistMode).toBe("off");
			expect(telemetry.selectedSpecialists).toEqual([]);
			expect(telemetry.diffBytes).toBeGreaterThan(0);
			expect(telemetry.promptOverheadBytes).toBeLessThanOrEqual(48 * 1024);
			expect(telemetry.hostCallCount).toBe(1);
			expect(telemetry.originalDiffBytesSent).toBeGreaterThan(0);
			const usageFile = readdirSync(telemetryDir).find((file) =>
				file.endsWith("-review-host-usage.json"),
			);
			const usage = JSON.parse(
				readFileSync(join(telemetryDir, usageFile as string), "utf8"),
			);
			expect(usage).toMatchObject({
				host: "codex",
				available: true,
				inputTokens: 1200,
				cachedInputTokens: 800,
				outputTokens: 75,
				totalTokens: 1275,
			});
			expect(readFileSync(callLog, "utf8").trim().split("\n")).toHaveLength(1);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("nested review is rejected before launching any runtime or host", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-nested-"));
		try {
			const fakeBin = join(fixture, "bin");
			const fakeCodex = join(fakeBin, "codex");
			const callLog = join(fixture, "codex-calls.log");
			mkdirSync(fakeBin, { recursive: true });
			writeFileSync(
				fakeCodex,
				`#!/usr/bin/env bash\nprintf '%s\\n' call >> "${callLog}"\n`,
			);
			chmodSync(fakeCodex, 0o755);

			const result = spawnReviewCli(
				["review", "code", "--host", "codex"],
				{
					cwd: fixture,
					encoding: "utf8",
					env: {
						...process.env,
						[REVIEW_ACTIVE_ENV]: "parent-review-token",
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
				},
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("cannot start inside an active review");
			expect(existsSync(callLog)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("same repository and scope cannot hold two active review leases", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-lease-"));
		try {
			const stateRoot = join(fixture, "state");
			const nestedDirectory = join(fixture, "packages", "app");
			mkdirSync(join(fixture, ".git"));
			mkdirSync(nestedDirectory, { recursive: true });
			const first = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--worktree"],
			);
			try {
				expect(() =>
					acquireReviewExecutionLease(
						stateRoot,
						nestedDirectory,
						["review", "code", "--worktree"],
					),
				).toThrow("already running for this repository and scope");
			} finally {
				releaseReviewExecutionLease(first);
			}
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("equivalent base plus worktree scopes share one lease regardless of flag order", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-lease-order-"));
		try {
			const stateRoot = join(fixture, "state");
			mkdirSync(join(fixture, ".git"));
			const first = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--base", "origin/main", "--worktree"],
			);
			try {
				expect(() =>
					acquireReviewExecutionLease(
						stateRoot,
						fixture,
						["review", "code", "--worktree", "--base", "origin/main"],
					),
				).toThrow("already running for this repository and scope");
			} finally {
				releaseReviewExecutionLease(first);
			}
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("equivalent diff-file scopes use the invocation directory", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-diff-lease-"));
		try {
			const stateRoot = join(fixture, "state");
			const packageDirectory = join(fixture, "packages", "app");
			mkdirSync(join(fixture, ".git"));
			mkdirSync(packageDirectory, { recursive: true });
			writeFileSync(join(packageDirectory, "change.diff"), "diff fixture\n");
			const first = acquireReviewExecutionLease(
				stateRoot,
				packageDirectory,
				["review", "code", "--diff-file", "change.diff"],
			);
			try {
				expect(() =>
					acquireReviewExecutionLease(
						stateRoot,
						fixture,
						["review", "code", "--diff-file", "packages/app/change.diff"],
					),
				).toThrow("already running for this repository and scope");
			} finally {
				releaseReviewExecutionLease(first);
			}
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("different scopes may run concurrently and stale leases recover", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-lease-scope-"));
		try {
			const stateRoot = join(fixture, "state");
			const worktree = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--worktree"],
			);
			const staged = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--staged"],
			);
			releaseReviewExecutionLease(worktree);
			releaseReviewExecutionLease(staged);

			const stale = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--base", "origin/main"],
				{ pid: 999_999, isProcessAlive: () => false },
			);
			const replacement = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--base", "origin/main"],
				{ isProcessAlive: () => false },
			);
			releaseReviewExecutionLease(stale);
			expect(existsSync(replacement.file)).toBe(true);
			releaseReviewExecutionLease(replacement);
			expect(existsSync(replacement.file)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("stale recovery cannot delete a concurrently replaced live lease", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-lease-race-"));
		try {
			const stateRoot = join(fixture, "state");
			mkdirSync(join(fixture, ".git"));
			const stale = acquireReviewExecutionLease(
				stateRoot,
				fixture,
				["review", "code", "--worktree"],
				{ pid: 999_999, isProcessAlive: () => false },
			);

			let winner: ReturnType<typeof acquireReviewExecutionLease> | undefined;
			expect(() =>
				acquireReviewExecutionLease(
					stateRoot,
					fixture,
					["review", "code", "--worktree"],
					{
						isProcessAlive: (pid) => pid !== 999_999,
						afterStaleLeaseRead: () => {
							winner = acquireReviewExecutionLease(
								stateRoot,
								fixture,
								["review", "code", "--worktree"],
								{ isProcessAlive: () => false },
							);
						},
					},
				),
			).toThrow("already running for this repository and scope");

			expect(winner).toBeDefined();
			expect(JSON.parse(readFileSync(stale.file, "utf8")).token).toBe(
				winner?.token,
			);
			releaseReviewExecutionLease(stale);
			expect(existsSync(stale.file)).toBe(true);
			releaseReviewExecutionLease(winner as NonNullable<typeof winner>);
			expect(existsSync(stale.file)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("forces real Codex review and defaults to the whole worktree", () => {
		expect(buildReviewRuntimeArgs(["--host", "codex"])).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--worktree",
		]);
	});

	test("preserves explicit scope", () => {
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--base",
				"origin/main",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--base",
			"origin/main",
		]);
	});

	test("forwards one evidence manifest and one scoped closure artifact", () => {
		expect(buildReviewRuntimeArgs([
			"--host", "codex",
			"--diff-file", "candidate.patch",
			"--evidence-manifest", "evidence.json",
			"--closure-artifact", "initial-review.json",
		])).toEqual([
			"review", "code", "--mode", "real", "--host", "codex",
			"--diff-file", "candidate.patch",
			"--evidence-manifest", "evidence.json",
			"--closure-artifact", "initial-review.json",
		]);
		expect(() => buildReviewRuntimeArgs([
			"--host", "codex",
			"--evidence-manifest", "a.json",
			"--evidence-manifest", "b.json",
		])).toThrow("--evidence-manifest may be supplied only once");
	});

	test("requires and forwards the complete Work Map scope pair", () => {
		expect(() =>
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--work-id",
				"work-a",
			]),
		).toThrow("--work-id and --ticket-id must be supplied together");
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--work-id",
				"work-a",
				"--ticket-id",
				"ticket-a",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--work-id",
			"work-a",
			"--ticket-id",
			"ticket-a",
		]);
		expect(() =>
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--work-id",
				"work-a",
				"--ticket-id",
				"ticket-a",
				"--diff-file",
				"unrelated.patch",
			]),
		).toThrow("Work Map review scope is runtime-owned");
	});

	test("rejects repeated review loops before launching the runtime", () => {
		expect(() =>
			buildReviewRuntimeArgs(["--host", "codex", "--loop"]),
		).toThrow("--loop is disabled to prevent repeated full-diff model calls");
	});

	test("rejects independent specialist agents before launching the runtime", () => {
		for (const mode of ["auto", "all"]) {
			expect(() =>
				buildReviewRuntimeArgs([
					"--host",
					"codex",
					"--specialists",
					mode,
				]),
			).toThrow("independent specialist agents are disabled");
		}
	});

	test("rejected specialist mode starts zero Codex processes", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-blocked-fanout-"));
		try {
			const fakeBin = join(fixture, "bin");
			const fakeCodex = join(fakeBin, "codex");
			const callLog = join(fixture, "codex-calls.log");
			mkdirSync(fakeBin, { recursive: true });
			writeFileSync(
				fakeCodex,
				`#!/usr/bin/env bash\nprintf '%s\\n' call >> "${callLog}"\n`,
			);
			chmodSync(fakeCodex, 0o755);

			const result = spawnReviewCli(
				["review", "code", "--host", "codex", "--specialists", "auto"],
				{
					cwd: fixture,
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
				},
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("independent specialist agents are disabled");
			expect(existsSync(callLog)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("rejects conflicting review scopes before launching the runtime", () => {
		for (const scopes of [
			["--staged", "--diff-file", "empty.diff"],
			["--worktree", "--diff-file", "empty.diff"],
			["--base", "origin/main", "--diff-file", "empty.diff"],
			["--staged", "--worktree"],
			["--staged", "--base", "origin/main"],
			["--diff-file", "empty.diff", "--include-untracked"],
		]) {
			expect(() =>
				buildReviewRuntimeArgs(["--host", "codex", ...scopes]),
			).toThrow("conflicting review scope flags");
		}
	});

	test("forwards explicit review timeout overrides", () => {
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--review-host-timeout-seconds",
				"240",
				"--review-pass-timeout-seconds",
				"600",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--worktree",
			"--review-host-timeout-seconds",
			"240",
			"--review-pass-timeout-seconds",
			"600",
		]);
	});

	test("forwards metered Claude budget overrides only to the Claude host", () => {
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"claude",
				"--review-claude-max-budget-usd",
				"4.25",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"claude",
			"--worktree",
			"--review-claude-max-budget-usd",
			"4.25",
		]);
		expect(() =>
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--review-claude-max-budget-usd",
				"3.00",
			]),
		).toThrow("--review-claude-max-budget-usd requires --host claude");
		expect(() =>
			buildReviewRuntimeArgs([
				"--host",
				"claude",
				"--review-claude-max-budget-usd",
				"3.00",
				"--review-claude-max-budget-usd",
				"4.00",
			]),
		).toThrow("--review-claude-max-budget-usd may be supplied only once");
	});

	test("rejects missing hosts and attempts to downgrade into mock mode", () => {
		expect(() => buildReviewRuntimeArgs([])).toThrow(
			"review code requires --host claude or --host codex",
		);
		expect(() =>
			buildReviewRuntimeArgs(["--host", "codex", "--mode", "mock"]),
		).toThrow("review code always uses real mode");
	});

	test("falls back to a private temporary evidence root when the default root is sandbox-blocked", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-fallback-"));
		try {
			const temporaryRoot = join(fixture, "temporary-state");
			mkdirSync(temporaryRoot, { recursive: true });
			const probed: string[] = [];
			const result = prepareReviewProcessEnvironment(
				{ GOLDBAND_REVIEW_CONTRACT_ROOT: "/caller-controlled" },
				{
					home: join(fixture, "blocked-home"),
					coordinationRoot: join(fixture, "review-coordination"),
					createTemporaryRoot: () => temporaryRoot,
					probeStateRoot: (root) => {
						probed.push(root);
						if (root !== temporaryRoot) {
							throw Object.assign(new Error("sandbox blocked"), {
								code: "EPERM",
							});
						}
					},
				},
			);

			expect(result.durability).toBe("ephemeral");
			expect(result.evidenceRoot).toBe(temporaryRoot);
			expect(result.coordinationRoot).toBe(
				realpathSync(join(fixture, "review-coordination")),
			);
			expect(result.env.GOLDBAND_HOME).toBe(temporaryRoot);
			expect(result.env.GOLDBAND_REVIEW_CONTRACT_ROOT).toBe(join(fixture, "blocked-home", ".goldband"));
			expect(result.env.GOLDBAND_REVIEW_EVIDENCE_DURABILITY).toBe(
				"ephemeral",
			);
			expect(probed).toEqual([
				join(fixture, "blocked-home", ".goldband"),
				temporaryRoot,
			]);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("sandbox fallback roots honor the runtime-owned evidence temp root", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-authorized-tmp-"));
		try {
			const authorizedRoot = realpathSync(fixture);
			const blockedHome = join(fixture, "blocked-home");
			const result = prepareReviewProcessEnvironment(
				{
					[EVIDENCE_SANDBOX_ACTIVE_ENV]: "1",
					[EVIDENCE_TEMP_ROOT_ENV]: authorizedRoot,
					TMPDIR: "/tmp",
				},
				{
					home: blockedHome,
					probeStateRoot: (root) => {
						if (root === join(blockedHome, ".goldband")) {
							throw Object.assign(new Error("sandbox blocked"), { code: "EPERM" });
						}
						mkdirSync(root, { recursive: true });
					},
				},
			);

			expect(result.durability).toBe("ephemeral");
			expect(result.evidenceRoot.startsWith(`${authorizedRoot}/`)).toBe(true);
			expect(result.coordinationRoot.startsWith(`${authorizedRoot}/`)).toBe(true);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("durable evidence owns its default review coordination root", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-durable-"));
		try {
			const evidenceRoot = join(fixture, "evidence");
			const result = prepareReviewProcessEnvironment(
				{ GOLDBAND_HOME: evidenceRoot },
			);

			expect(result.durability).toBe("durable");
			expect(result.evidenceRoot).toBe(evidenceRoot);
			expect(result.coordinationRoot).toBe(
				realpathSync(join(evidenceRoot, "review-coordination")),
			);
			expect(result.coordinationRoot).not.toBe(result.evidenceRoot);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("ephemeral evidence roots share one stable review coordination root", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-coordination-"));
		try {
			const blockedHome = join(fixture, "blocked-home");
			const prepare = (temporaryRoot: string) =>
				prepareReviewProcessEnvironment(
					{},
					{
						home: blockedHome,
						createTemporaryRoot: () => temporaryRoot,
						probeStateRoot: (root) => {
							if (root === join(blockedHome, ".goldband")) {
								throw Object.assign(new Error("sandbox blocked"), {
									code: "EPERM",
								});
							}
							mkdirSync(root, { recursive: true });
						},
					},
				);
			const firstEnvironment = prepare(join(fixture, "evidence-one"));
			const secondEnvironment = prepare(join(fixture, "evidence-two"));
			expect(firstEnvironment.evidenceRoot).not.toBe(
				secondEnvironment.evidenceRoot,
			);
			expect(firstEnvironment.coordinationRoot).toBe(
				secondEnvironment.coordinationRoot,
			);
			expect(secondEnvironment.coordinationRoot).toBe(
				realpathSync(firstEnvironment.coordinationRoot),
			);

			const first = acquireReviewExecutionLease(
				firstEnvironment.coordinationRoot,
				fixture,
				["review", "code", "--worktree"],
			);
			try {
				expect(() =>
					acquireReviewExecutionLease(
						secondEnvironment.coordinationRoot,
						fixture,
						["review", "code", "--worktree"],
					),
				).toThrow("already running for this repository and scope");
			} finally {
				releaseReviewExecutionLease(first);
			}
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("does not hide an unwritable explicitly configured evidence root", () => {
		const blocked = Object.assign(new Error("configured root blocked"), {
			code: "EPERM",
		});
		expect(() =>
			prepareReviewProcessEnvironment(
				{ GOLDBAND_HOME: "/configured/state" },
				{ probeStateRoot: () => { throw blocked; } },
			),
		).toThrow("configured root blocked");
	});

	test("resolves a copied runtime through its installed source marker", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-launcher-"));
		try {
			const sourceRoot = join(fixture, "source");
			const runtimeRoot = join(fixture, "installed");
			const entryFile = join(runtimeRoot, "bin", "goldband.ts");
			const runtimeFile = join(sourceRoot, "workflows", "run.ts");
			mkdirSync(join(runtimeRoot, "bin"), { recursive: true });
			mkdirSync(join(sourceRoot, "workflows"), { recursive: true });
			writeFileSync(entryFile, "// fixture\n");
			writeFileSync(runtimeFile, "// fixture\n");
			writeFileSync(join(runtimeRoot, ".installed-source"), `${sourceRoot}\n`);

			expect(
				resolveReviewRuntimeFile({ entryFile, env: {} }),
			).toBe(runtimeFile);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
