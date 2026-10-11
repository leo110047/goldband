import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installCodexReviewLauncher, renderCodexReviewRule } from "../scripts/install-codex-review-launcher.ts";
import { inspectDistribution } from "../../scripts/lib/workflow-distribution-contract.mjs";
const sourceRoot = resolve(import.meta.dir, "..");
const bunPath = process.execPath;

describe("trusted workflow launcher", () => {
  test("rejects a trusted runtime inside the reviewed workspace", () => {
    expect(() => installCodexReviewLauncher({sourceRoot, runtimeRoot: join(sourceRoot, ".unsafe-review-runtime"),
      ruleFile: "/tmp/unused-rule", markerFile: "/tmp/unused-marker", bunPath, codexPath: bunPath, browserPath: bunPath,
    })).toThrow("must be outside the Goldband source workspace");
  });


  test("installs semantic review with pinned native host permissions and repeatable runs", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "goldband-semantic-install-"));
    try {
      const fakeCodex = join(fixture, "codex");
      writeFileSync(fakeCodex, [
        "#!/bin/bash", "set -euo pipefail", 'output=""', 'approval=""', 'sandbox=""',
        'while [ "$#" -gt 0 ]; do',
        'case "$1" in -o) output="$2"; shift 2;; --ask-for-approval) approval="$2"; shift 2;; --sandbox) sandbox="$2"; shift 2;; *) shift;; esac',
        'done', 'test "$approval" = never', 'test "$sandbox" = read-only',
        'test -n "${GOLDBAND_REVIEW_ACTIVE:-}"', 'cat >/dev/null',
        'printf "call\\n" >> "$GOLDBAND_TEST_CALLS"',
        'if [ -n "${GOLDBAND_TEST_RELEASE:-}" ]; then',
        '  for i in {1..200}; do [ -f "$GOLDBAND_TEST_RELEASE" ] && break; sleep 0.05; done',
        '  test -f "$GOLDBAND_TEST_RELEASE"',
        'fi',
        'printf \'%s\\n\' \'{"findings":[{"file":"file.txt","line":1,"severity":"high","summary":"fixture concern","evidence":"observed code","failureScenario":"input triggers incorrect result","suggestedVerification":"exercise input","classification":"verified-failure","evidenceIds":["spoofed"]}]}\' > "$output"',
      ].join("\n"));
      chmodSync(fakeCodex, 0o755);
      const runtimeRoot = join(fixture, "runtime");
      const ruleFile = join(fixture, "rules", "review.rules");
      const markerFile = join(fixture, "skill", ".workflow-launcher.json");
      const options = {sourceRoot, runtimeRoot, ruleFile, markerFile, bunPath, codexPath: fakeCodex,
        browserPath: bunPath, bundleBrowserServer: (_bun: string, _entry: string, dir: string) => {
          mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "server.js"), "// fixture\n");
        }};
      const marker = installCodexReviewLauncher(options);
      for (const file of ["bin/goldband", "workflows/run.ts", "review/shared-rubric.md", "browse/server/server.js"]) {
        expect(existsSync(join(runtimeRoot, file))).toBe(true);
      }
      for (const file of ["workflows/review-contract-cli.ts", "review/review-evidence-manifest.md", "review/schemas/review-evidence-manifest.schema.json"]) {
        expect(existsSync(join(runtimeRoot, file))).toBe(false);
      }
      expect(existsSync(join(fixture, "review-receipt.key"))).toBe(false);
      const config = JSON.parse(readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"));
      expect(config).not.toHaveProperty("reviewReceiptKeyFile");
      expect(config).not.toHaveProperty("reviewReceiptAuthorityRoot");
      expect(config).not.toHaveProperty("reviewReceiptStore");
      expect(config).not.toHaveProperty("reviewHostEvidenceLane");
      expect(config).not.toHaveProperty("reviewLocalEvidenceLane");
      const sideArtifacts = [{role: "workflow-launcher-marker", path: markerFile}, {role: "codex-execpolicy-rule", path: ruleFile}];
      expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts).ok).toBe(true);
      const rule = readFileSync(ruleFile, "utf8");
      writeFileSync(ruleFile, rule + '\nprefix_rule(pattern=["bun"], decision="allow")\n');
      expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts).ok).toBe(false);
      writeFileSync(ruleFile, rule);
      const repo = join(fixture, "repo"); mkdirSync(repo);
      expect(spawnSync("git", ["init", "-q"], {cwd: repo}).status).toBe(0);
      writeFileSync(join(repo, "file.txt"), "candidate\n");
      const poisonBin = join(fixture, "poison"); mkdirSync(poisonBin);
      writeFileSync(join(poisonBin, "codex"), "#!/bin/sh\nexit 97\n"); chmodSync(join(poisonBin, "codex"), 0o755);
      const state = join(fixture, "state");
      for (let i = 0; i < 2; i++) {
        const run = spawnSync(join(runtimeRoot, "bin", "goldband"), ["review", "code"], {
          cwd: repo, encoding: "utf8", env: {...process.env, HOME: fixture, GOLDBAND_HOME: state,
            GOLDBAND_TEST_CALLS: join(fixture, "calls"), PATH: `${poisonBin}:${process.env.PATH}`},
        });
        expect(run.status, run.stderr).toBe(0);
        expect(run.stdout).toContain("fixture concern");
        expect(run.stdout).toContain("not executed");
      }
      expect(readFileSync(join(fixture, "calls"), "utf8").trim().split("\n")).toHaveLength(2);
      const artifacts = readdirSync(join(state, "workflow-runs", "artifacts"));
      const reviews = artifacts.filter(f => f.endsWith("-review.json"));
      expect(reviews).toHaveLength(2);
      const report = JSON.parse(readFileSync(join(state, "workflow-runs", "artifacts", reviews[0]!), "utf8"));
      expect(report.mode).toBe("semantic"); expect(report.checksExecuted).toEqual([]);
      expect(report).not.toHaveProperty("completionAuthorized");
      expect(report.findings[0]).not.toHaveProperty("classification");
      expect(report.findings[0]).not.toHaveProperty("evidenceIds");
      const help = spawnSync(marker.argvPrefix[0], [marker.argvPrefix[1], "--help"], {encoding:"utf8"});
      expect(help.status).toBe(0); expect(help.stdout).not.toContain("review contract");

      const release = join(fixture, "release");
      const env = {...process.env, HOME: fixture, GOLDBAND_HOME: state,
        GOLDBAND_TEST_CALLS: join(fixture, "calls"), GOLDBAND_TEST_RELEASE: release};
      const active = Bun.spawn([join(runtimeRoot, "bin", "goldband"), "review", "code"], {
        cwd: repo, env, stdout: "pipe", stderr: "pipe",
      });
      try {
        const deadline = Date.now() + 5_000;
        while (readFileSync(join(fixture, "calls"), "utf8").trim().split("\n").length < 3 && Date.now() < deadline) {
          await Bun.sleep(25);
        }
        expect(readFileSync(join(fixture, "calls"), "utf8").trim().split("\n")).toHaveLength(3);
        const duplicate = spawnSync(join(runtimeRoot, "bin", "goldband"), ["review", "code"], {
          cwd: repo, env, encoding: "utf8", timeout: 2_000,
        });
        expect(duplicate.status, duplicate.stderr).toBe(1);
        expect(duplicate.stderr).toContain("already running for this repository and scope");
        expect(readFileSync(join(fixture, "calls"), "utf8").trim().split("\n")).toHaveLength(3);
      } finally {
        writeFileSync(release, "released\n");
        const exit = await active.exited;
        expect(exit, await new Response(active.stderr).text()).toBe(0);
      }
      // A snapshot refresh removes obsolete runtime assets while preserving external history.
      writeFileSync(join(runtimeRoot, "workflows", "review-contract-cli.ts"), "retired");
      writeFileSync(join(runtimeRoot, "trusted-runtime.json"), JSON.stringify({
        ...config, reviewReceiptKeyFile: "historical-key", reviewReceiptStore: "historical-store",
      }));
      writeFileSync(join(fixture, "review-receipt.key"), "historical key");
      installCodexReviewLauncher(options);
      expect(existsSync(join(runtimeRoot, "workflows", "review-contract-cli.ts"))).toBe(false);
      const refreshedConfig = JSON.parse(readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"));
      expect(refreshedConfig).not.toHaveProperty("reviewReceiptKeyFile");
      expect(refreshedConfig).not.toHaveProperty("reviewReceiptStore");
      expect(readFileSync(join(fixture, "review-receipt.key"), "utf8")).toBe("historical key");
    } finally { rmSync(fixture, {recursive:true, force:true}); }
  }, 30_000);

	test("restores the previous runtime when replacement fails after backup", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-rollback-"));
		try {
			const runtimeRoot = join(fixture, "runtime");
			const options = {
				sourceRoot,
				runtimeRoot,
				ruleFile: join(fixture, "rules", "goldband.rules"),
				markerFile: join(fixture, "skills", "goldband", ".workflow-launcher.json"),
				bunPath,
				codexPath: bunPath,
				browserPath: bunPath,
				bundleBrowserServer: (_bun: string, _entry: string, outputDirectory: string) => {
					mkdirSync(outputDirectory, { recursive: true });
					writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
				},
			};
			installCodexReviewLauncher(options);
			writeFileSync(join(runtimeRoot, "healthy-runtime"), "preserve me\n");

			expect(() =>
				installCodexReviewLauncher({
					...options,
					afterRuntimeBackup: () => {
						throw new Error("injected swap failure");
					},
				}),
			).toThrow("injected swap failure");
			expect(readFileSync(join(runtimeRoot, "healthy-runtime"), "utf8")).toBe(
				"preserve me\n",
			);
			expect(existsSync(`${runtimeRoot}.backup`)).toBe(false);
			installCodexReviewLauncher(options);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("fails when the required execpolicy executable is missing", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-missing-codex-"));
		try {
			const result = spawnSync(bunPath, ["test", import.meta.path,
				"--test-name-pattern", "an execpolicy probe matches"], {
				cwd: sourceRoot, encoding: "utf8",
				env: {...process.env, PATH: fixture, GOLDBAND_REQUIRE_CODEX_EXECPOLICY: "1"},
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("required execpolicy prerequisite is unavailable: codex executable");
		} finally { rmSync(fixture, {recursive: true, force: true}); }
	});

	test("an execpolicy probe matches only trusted review and browser prefixes", () => {
		const codex = Bun.which("codex");
		if (!codex) {
			if (process.env.GOLDBAND_REQUIRE_CODEX_EXECPOLICY === "1") {
				throw new Error("required execpolicy prerequisite is unavailable: codex executable");
			}
			return;
		}
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-rule-probe-"));
		try {
			const launcher = join(fixture, "trusted", "bin", "goldband.js");
			const ruleFile = join(fixture, "goldband-workflows.rules");
			mkdirSync(join(fixture, "trusted", "bin"), { recursive: true });
			writeFileSync(launcher, "// fixture\n");
			const marker = {
				schemaVersion: 1 as const,
				argvPrefix: [bunPath, launcher] as [string, string],
				ruleFile,
				runtimeRoot: join(fixture, "trusted"),
			};
			writeFileSync(ruleFile, renderCodexReviewRule(marker));

			const probe = (argv: string[]) => {
				const result = spawnSync(
					codex,
					["execpolicy", "check", "--rules", ruleFile, "--", ...argv],
					{ encoding: "utf8" },
				);
				expect(result.status).toBe(0);
				return JSON.parse(result.stdout);
			};

			expect(
				probe([...marker.argvPrefix, "review", "code", "--host", "codex"])
					.decision,
			).toBe("allow");
			const entry = join(marker.runtimeRoot, "bin", "goldband");
			expect(probe([entry, "review", "code"]).decision).toBe("allow");
			expect(probe([entry, "review", "contract", "import"]).decision).toBeUndefined();
			expect(probe([entry, "worktree", "create", "unsafe"]).decision).toBeUndefined();
			expect(probe([join(sourceRoot, "bin", "goldband"), "review", "code"]).decision).toBeUndefined();
			expect(
				probe([...marker.argvPrefix, "browser", "session", "--host", "codex", "status"])
					.decision,
			).toBe("allow");
			expect(
				probe([
					...marker.argvPrefix,
					"browser",
					"session",
					"--host",
					"codex",
					"goto",
					"http://127.0.0.1:43123/private",
				]).decision,
			).toBeUndefined();
			expect(
				probe([bunPath, join(sourceRoot, "bin", "goldband.ts"), "review", "code", "--host", "codex"])
					.decision,
			).toBeUndefined();
			expect(
				probe([...marker.argvPrefix, "worktree", "create", "unsafe"]).decision,
			).toBeUndefined();
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
