import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	workflowSourceInputManifest,
	writeDistributionManifest,
} from "../../scripts/lib/workflow-distribution-contract.mjs";

const statusScript = resolve(import.meta.dir, "../..", "shell/install/status.sh");
const workflowScript = resolve(import.meta.dir, "../..", "shell/install/workflow.sh");
const workflowStatusScript = resolve(import.meta.dir, "../..", "shell/install/workflow-status.sh");
const repoRoot = resolve(import.meta.dir, "../..");
const loopRoot = resolve(import.meta.dir, "..");

describe("trusted Codex workflow status", () => {
	test("source input digest changes when a declared runtime input changes", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-source-digest-"));
		try {
			const sourceRoot = join(fixture, "goldband-loop");
			mkdirSync(sourceRoot);
			const input = join(sourceRoot, "runtime.ts");
			writeFileSync(input, "export const version = 1;\n");
			const before = workflowSourceInputManifest(sourceRoot, ["goldband-loop/runtime.ts"]);
			writeFileSync(input, "export const version = 2;\n");
			const after = workflowSourceInputManifest(sourceRoot, ["goldband-loop/runtime.ts"]);
			expect(after.digest).not.toBe(before.digest);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("permits absent generated bundles but hashes them once built", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-generated-source-digest-"));
		try {
			const sourceRoot = join(fixture, "goldband-loop");
			mkdirSync(sourceRoot);
			const sourceInputs = ["goldband-loop/browse/dist"];
			const before = workflowSourceInputManifest(sourceRoot, sourceInputs);
			expect(before.inputs).toEqual([]);

			const bundle = join(sourceRoot, "browse", "dist", "browse");
			mkdirSync(join(sourceRoot, "browse", "dist"), { recursive: true });
			writeFileSync(bundle, "compiled fixture\n");
			const after = workflowSourceInputManifest(sourceRoot, sourceInputs);
			expect(after.inputs.map((entry: { path: string }) => entry.path)).toEqual([
				"goldband-loop/browse/dist/browse",
			]);
			expect(after.digest).not.toBe(before.digest);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("rejects an absent mandatory source input", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-mandatory-source-digest-"));
		try {
			const sourceRoot = join(fixture, "goldband-loop");
			mkdirSync(sourceRoot);
			expect(() =>
				workflowSourceInputManifest(sourceRoot, ["goldband-loop/runtime.ts"]),
			).toThrow("distribution source input is missing: goldband-loop/runtime.ts");
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("probes the pinned Codex executable and rejects it when missing", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-status-"));
		try {
			const home = join(fixture, "home");
			const runtimeRoot = join(home, ".codex", "goldband", "workflow-runtime");
			const skillRoot = join(home, ".codex", "skills", "goldband");
			const rulesRoot = join(home, ".codex", "rules");
			const trustedBin = join(fixture, "trusted-bin");
			const poisonBin = join(fixture, "poison-bin");
			for (const directory of [
				join(runtimeRoot, "bin"),
				join(runtimeRoot, "browse", "server"),
				join(runtimeRoot, "review", "rules"),
				skillRoot,
				rulesRoot,
				trustedBin,
				poisonBin,
			]) mkdirSync(directory, { recursive: true });

			const pinnedLog = join(fixture, "pinned.log");
			const poisonLog = join(fixture, "poison.log");
			const pinnedCodex = join(trustedBin, "codex");
			const poisonCodex = join(poisonBin, "codex");
			const bunExecutable = join(trustedBin, "bun");
			const brokenRouterFlag = join(fixture, "broken-router");
			const browserExecutable = join(runtimeRoot, "browse", "browse");
			const browserServer = join(runtimeRoot, "browse", "server", "server.js");
			const rulesResolver = join(runtimeRoot, "review", "rules-resolver.js");
			const rulesDirectory = join(runtimeRoot, "review", "rules");
			const launcher = join(runtimeRoot, "bin", "goldband.js");
			const reviewEntry = join(runtimeRoot, "bin", "goldband");
			const rule = join(rulesRoot, "goldband-workflows.rules");
			const markerFile = join(skillRoot, ".workflow-launcher.json");
			writeFileSync(
				bunExecutable,
				'#!/usr/bin/env bash\nif [ "$2" = "--contract-probe" ] && [ -n "${3:-}" ]; then [ ! -f "$BROKEN_ROUTER_FLAG" ] || exit 2; printf \'{"schemaVersion":1,"action":"%s","routable":true}\\n\' "$3"; exit 0; fi\nif [ "$2" = "--contract-probe" ]; then printf \'%s\\n\' \'{"schemaVersion":1,"dispatch":"trusted-launcher","actions":["browser/session","plan/create","plan/sync","review/code"]}\'; fi\nexit 0\n',
			);
			writeFileSync(browserExecutable, "#!/usr/bin/env bash\nexit 0\n");
			writeFileSync(reviewEntry, "#!/usr/bin/env bash\nexit 0\n");
			chmodSync(bunExecutable, 0o755);
			chmodSync(browserExecutable, 0o755);
			chmodSync(reviewEntry, 0o755);
			writeFileSync(launcher, "// fixture\n");
			writeFileSync(browserServer, "// fixture\n");
			writeFileSync(rulesResolver, "module.exports = {};\n");
			writeFileSync(join(rulesDirectory, "manifest.json"), "{}\n");
			writeFileSync(rule, "# fixture\n");
			writeFileSync(
				pinnedCodex,
				"#!/usr/bin/env bash\nprintf 'pinned\\n' >> \"$PINNED_LOG\"\nprintf '{\"decision\":\"allow\"}\\n'\n",
			);
			writeFileSync(
				poisonCodex,
				"#!/usr/bin/env bash\nprintf 'poison\\n' >> \"$POISON_LOG\"\nexit 97\n",
			);
			chmodSync(pinnedCodex, 0o755);
			chmodSync(poisonCodex, 0o755);
			writeFileSync(
				join(runtimeRoot, "trusted-runtime.json"),
				JSON.stringify({
					schemaVersion: 2,
					bunExecutable,
					codexExecutable: pinnedCodex,
					browserExecutable,
					browserServerScript: browserServer,
					rulesResolverScript: rulesResolver,
					rulesDirectory,
				}),
			);
			writeFileSync(
				markerFile,
				JSON.stringify({
					schemaVersion: 1,
					argvPrefix: [bunExecutable, launcher],
					ruleFile: rule,
					runtimeRoot,
				}),
			);
			writeFileSync(join(skillRoot, ".installed-source"), `${loopRoot}\n`);
			const sideArtifacts = [
				{ role: "codex-execpolicy-rule", path: rule },
				{ role: "workflow-launcher-marker", path: markerFile },
			];
			writeDistributionManifest(runtimeRoot, loopRoot, sideArtifacts);

			const runStatus = () => spawnSync(
				"bash",
				[
					"-c",
					'REPO_DIR="$4"; source "$1"; source "$2"; source "$3"; RED=""; GREEN=""; YELLOW=""; NC=""; GOLDBAND_STATUS_EXIT_CODE=0; show_codex_workflow_launcher_status',
					"status-test",
					workflowScript,
					workflowStatusScript,
					statusScript,
					repoRoot,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						HOME: home,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
						PINNED_LOG: pinnedLog,
						POISON_LOG: poisonLog,
						BROKEN_ROUTER_FLAG: brokenRouterFlag,
					},
				},
			);

			const healthy = runStatus();
			expect(healthy.status).toBe(0);
			expect(healthy.stdout).toContain("[OK] trusted Codex workflow launcher");
			expect(readFileSync(pinnedLog, "utf8").trim().split("\n")).toHaveLength(3);
			expect(() => readFileSync(poisonLog, "utf8")).toThrow();
			writeFileSync(brokenRouterFlag, "broken\n");
			const brokenRouter = runStatus();
			expect(brokenRouter.stdout).toContain("action dispatch behavior probe failed");
			unlinkSync(brokenRouterFlag);

			writeFileSync(rule, "# fixture\nprefix_rule(pattern=[\"bun\"], decision=\"allow\")\n");
			const widenedRule = runStatus();
			expect(widenedRule.stdout).toContain("[corrupt] trusted Codex workflow launcher");
			writeFileSync(rule, "# fixture\n");

			writeFileSync(launcher, "// tampered fixture\n");
			const corrupt = runStatus();
			expect(corrupt.stdout).toContain("[corrupt] trusted Codex workflow launcher");
			writeFileSync(launcher, "// fixture\n");

			const distributionFile = join(runtimeRoot, "distribution-manifest.json");
			const distribution = JSON.parse(readFileSync(distributionFile, "utf8"));
			distribution.sourceDigest = "0".repeat(64);
			writeFileSync(distributionFile, `${JSON.stringify(distribution)}\n`);
			const sourceStale = runStatus();
			expect(sourceStale.stdout).toContain("source inputs changed but runtime was not rebuilt");
			writeDistributionManifest(runtimeRoot, loopRoot, sideArtifacts);

			unlinkSync(rulesResolver);
			const missingRulesRuntime = runStatus();
			expect(missingRulesRuntime.stdout).toContain(
				"[stale] trusted Codex workflow launcher",
			);
			writeFileSync(rulesResolver, "module.exports = {};\n");

			unlinkSync(pinnedCodex);
			const stale = runStatus();
			expect(stale.stdout).toContain("[stale] trusted Codex workflow launcher");
			expect(stale.stdout).not.toContain("[OK] trusted Codex workflow launcher");
			expect(() => readFileSync(poisonLog, "utf8")).toThrow();
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 15_000);
});
