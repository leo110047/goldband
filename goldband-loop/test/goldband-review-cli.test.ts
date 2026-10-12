import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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
import { acquireReviewExecutionLease, releaseReviewExecutionLease } from "../lib/review-execution-lease";
import { REVIEW_ACTIVE_ENV } from "../lib/review-runtime-contract";
import { PROMPT_CONTRACT_ACTIONS } from "../lib/trusted-launcher-actions.generated";

function spawnReviewCli(
	args: string[],
	options: { cwd: string; encoding: "utf8"; env: NodeJS.ProcessEnv },
) {
	const command = resolve(import.meta.dir, "../bin/goldband");
	return spawnSync(command, args, options);
}

describe("review CLI contract", () => {
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

	test("pins the installed runtime ahead of environment overrides", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-runtime-pin-"));
		try {
			const runtimeRoot = join(fixture, "installed");
			const sourceRoot = join(fixture, "source");
			const overrideRoot = join(fixture, "override");
			mkdirSync(join(runtimeRoot, "bin"), {recursive: true});
			for (const root of [sourceRoot, overrideRoot]) {
				mkdirSync(join(root, "workflows"), {recursive: true});
				writeFileSync(join(root, "workflows", "run.ts"), "// fixture\n");
			}
			const entryFile = join(runtimeRoot, "bin", "goldband.ts");
			writeFileSync(entryFile, "// fixture\n");
			writeFileSync(join(runtimeRoot, ".installed-source"), sourceRoot);
			writeFileSync(join(runtimeRoot, "trusted-runtime.json"), JSON.stringify({schemaVersion: 2, runtimeHost: "claude"}));
			expect(resolveReviewRuntimeFile({entryFile, env: {
				GOLDBAND_LOOP_DIR: overrideRoot, GOLDBAND_ROOT: overrideRoot,
			}})).toBe(join(sourceRoot, "workflows", "run.ts"));
		} finally { rmSync(fixture, {recursive: true, force: true}); }
	});

	test("workflow CLI no longer advertises or accepts Work Map scope flags", () => {
		const script = resolve(import.meta.dir, "../workflows/run.ts");
		const help = spawnSync(process.execPath, [script, "--help"], {encoding: "utf8"});
		expect(help.status).toBe(0);
		for (const flag of ["--work-id", "--ticket-id"]) {
			expect(help.stderr).not.toContain(flag);
			const run = spawnSync(process.execPath, [script, "review", "code", flag, "obsolete"], {encoding: "utf8"});
			expect(run.status).toBe(2);
			expect(run.stderr).toContain(`unknown argument: ${flag}`);
		}
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
  test("rejects retired governance flags", () => {
    for (const flag of ["--semantic-only", "--evidence-manifest", "--closure-artifact", "--work-id", "--ticket-id"]) {
      expect(() => buildReviewRuntimeArgs(["--host", "codex", flag])).toThrow();
    }
  });
  test("uses a temporary report directory when the default is sandbox-blocked", () => {
    const fixture = mkdtempSync(join(tmpdir(), "review-report-fallback-"));
    try {
      const result = prepareReviewProcessEnvironment({}, {
        home: join(fixture, "blocked-home"), createTemporaryRoot: () => fixture,
        probeStateRoot: root => { if (root !== fixture) throw Object.assign(new Error("blocked"), {code: "EPERM"}); },
      });
      expect(result.durability).toBe("ephemeral");
      expect(result.evidenceRoot).toBe(fixture);
      expect(result.env.GOLDBAND_HOME).toBe(fixture);
    } finally { rmSync(fixture, {recursive: true, force: true}); }
  });
	test("temporary report roots still share duplicate-review coordination", () => {
		const fixture = mkdtempSync(join(tmpdir(), "review-shared-coordination-"));
		try {
			const prepare = (name: string) => prepareReviewProcessEnvironment({}, {
				home: join(fixture, "blocked-home"),
				createTemporaryRoot: () => join(fixture, name),
				probeStateRoot: root => {
					if (root.includes("blocked-home")) throw Object.assign(new Error("blocked"), {code: "EPERM"});
					mkdirSync(root, {recursive: true});
				},
			});
			const first = prepare("reports-1");
			const second = prepare("reports-2");
			expect(first.evidenceRoot).not.toBe(second.evidenceRoot);
			expect(first.coordinationRoot).toBe(second.coordinationRoot);
			const lease = acquireReviewExecutionLease(first.coordinationRoot, fixture, ["--worktree"]);
			try {
				expect(() => acquireReviewExecutionLease(second.coordinationRoot, fixture, ["--worktree"])).toThrow("already running");
			} finally { releaseReviewExecutionLease(lease); }
		} finally { rmSync(fixture, {recursive: true, force: true}); }
	});
});
