import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { evidenceChildProcessEnvironment } from "../lib/evidence-runtime-contract.ts";
import { PROMPT_CONTRACT_ACTIONS } from "../lib/trusted-launcher-actions.generated.ts";
import {
	installCodexReviewLauncher,
	renderCodexReviewRule,
} from "../scripts/install-codex-review-launcher.ts";
import { inspectDistribution } from "../../scripts/lib/workflow-distribution-contract.mjs";

const sourceRoot = resolve(import.meta.dir, "..");
const bunPath = process.execPath;

function spawnInstalledRuntime(
	command: string,
	args: string[],
	options: { cwd: string; encoding: "utf8"; env: NodeJS.ProcessEnv },
) {
	return spawnSync(command, args, {
		...options,
		env: {
			...evidenceChildProcessEnvironment(process.env),
			...options.env,
		},
	});
}

describe("Codex trusted workflow launcher install", () => {
	test("materializes review and browser owners with exact allow rules outside source", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-install-"));
		const nestedEvidenceBoundaryUnavailable = nestedSandboxProbeIsBlocked();
		try {
			const trustedBin = join(fixture, "trusted-bin");
			const poisonBin = join(fixture, "poison-bin");
			const emptyHome = join(fixture, "empty-home");
			const hostCallLog = join(fixture, "host-calls.log");
			mkdirSync(trustedBin, { recursive: true });
			mkdirSync(poisonBin, { recursive: true });
			mkdirSync(emptyHome, { recursive: true });
			const fakeCodex = join(trustedBin, "codex");
			const fakeClaude = join(trustedBin, "claude");
			const fakeBrowser = join(trustedBin, "browse");
			writeFileSync(
				fakeCodex,
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					'output=""',
					'while [ "$#" -gt 0 ]; do',
					'  if [ "$1" = "-o" ]; then output="$2"; shift 2; continue; fi',
					"  shift",
					"done",
					'test -n "$output"',
					'if [ -n "${GOLDBAND_TEST_HOST_CALL_LOG:-}" ]; then printf "%s\\n" codex >> "$GOLDBAND_TEST_HOST_CALL_LOG"; fi',
					'prompt="$(cat)"',
					'if printf \'%s\' "$prompt" | grep -q CLOSURE_INPUT_START; then',
					'  printf \'%s\\n\' \'{"results":[{"findingId":"S-001","status":"closed","summary":"repair verified","evidenceIds":["installed-gate:pass"]}]}\' > "$output"',
					'elif [ "${GOLDBAND_TEST_CLEAN_REVIEW:-}" = "1" ]; then',
					'  printf \'%s\\n\' \'{"findings":[]}\' > "$output"',
					'elif [ "${GOLDBAND_EVIDENCE_SANDBOX_ACTIVE:-}" = "1" ]; then',
					'  printf \'%s\\n\' \'{"findings":[{"id":"F-001","file":"review-me.txt","line":1,"severity":"medium","summary":"fixture finding","evidence":"fixture semantic observation","failureScenario":"fixture path","suggestedVerification":"inspect installed phases","classification":"semantic-concern","blocking":false,"evidenceIds":["cell:installed-review:unsupported"],"behaviorCellIds":["installed-review"]}]}\' > "$output"',
					'else',
					'  printf \'%s\\n\' \'{"findings":[{"id":"F-001","file":"review-me.txt","line":1,"severity":"medium","summary":"fixture finding","evidence":"fixture semantic observation","failureScenario":"fixture path","suggestedVerification":"rerun installed gate","classification":"semantic-concern","blocking":false,"evidenceIds":["installed-gate:pass"],"behaviorCellIds":["installed-review"]}]}\' > "$output"',
					'fi',
				].join("\n"),
			);
			chmodSync(fakeCodex, 0o755);
			writeFileSync(
				fakeClaude,
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					'if [ "${1:-}" = "auth" ]; then',
					'  printf \'%s\\n\' \'{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}\'',
					"  exit 0",
					"fi",
					'if [ -n "${GOLDBAND_TEST_HOST_CALL_LOG:-}" ]; then printf "%s\\n" claude >> "$GOLDBAND_TEST_HOST_CALL_LOG"; fi',
					"cat >/dev/null",
					'printf \'%s\\n\' \'{"result":"{\\"findings\\":[]}","usage":{"input_tokens":10,"output_tokens":2}}\'',
				].join("\n"),
			);
			chmodSync(fakeClaude, 0o755);
			writeFileSync(
				fakeBrowser,
				"#!/usr/bin/env bash\nset -euo pipefail\nprintf 'browser-ok:%s\\n' \"$*\"\n",
			);
			chmodSync(fakeBrowser, 0o755);
			const poisonCodex = join(poisonBin, "codex");
			writeFileSync(poisonCodex, "#!/usr/bin/env bash\nexit 99\n");
			chmodSync(poisonCodex, 0o755);
			const runtimeRoot = join(fixture, "codex", "goldband", "workflow-runtime");
			const ruleFile = join(fixture, "codex", "rules", "goldband-workflows.rules");
			const markerFile = join(fixture, "codex", "skills", "goldband", ".workflow-launcher.json");
			const marker = installCodexReviewLauncher({
				sourceRoot,
				runtimeRoot,
				ruleFile,
				markerFile,
				bunPath,
				codexPath: fakeCodex,
				browserPath: fakeBrowser,
				bundleBrowserServer: (_bun, _entry, outputDirectory) => {
					mkdirSync(outputDirectory, { recursive: true });
					writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
				},
			});
			const runInstalledReview = (
				cwd: string,
				args: string[],
				env: NodeJS.ProcessEnv = {},
			) => spawnInstalledRuntime(
				marker.argvPrefix[0],
				[marker.argvPrefix[1], "review", "code", ...args],
				{
					cwd,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: emptyHome,
						GOLDBAND_HOME: join(fixture, "state"),
						GOLDBAND_TEST_HOST_CALL_LOG: hostCallLog,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
						...env,
					},
				},
			);
			const receiptKeyFile = join(dirname(runtimeRoot), "review-receipt.key");
			expect(readFileSync(receiptKeyFile, "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);

			expect(marker.argvPrefix).toEqual([
				bunPath,
				join(runtimeRoot, "bin", "goldband.js"),
			]);
			expect(existsSync(join(runtimeRoot, "workflows", "run.ts"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "workflows", "review-contract-cli.ts"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "browse"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "server", "server.js"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "shared-rubric.md"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "review-evidence-manifest.md"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "examples", "minimal-local-gate.json"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "schemas", "review-evidence-manifest.schema.json"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "schemas", "review-behavior-matrix.schema.json"))).toBe(true);
			expect(readFileSync(join(runtimeRoot, "review", "review-evidence-manifest.md"), "utf8"))
				.toContain("Python 3.14 + uv runtime");
			expect(readFileSync(join(runtimeRoot, "review", "schemas", "review-evidence-manifest.schema.json"), "utf8"))
				.toContain('"pythonRuntime"');
			expect(existsSync(join(runtimeRoot, "review", "rules-resolver.js"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "rules", "manifest.json"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "distribution-manifest.json"))).toBe(true);
			const trustedConfig = JSON.parse(
				readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"),
			);
			expect(trustedConfig.schemaVersion).toBe(2);
			expect(trustedConfig.reviewHostEvidenceLane).toBe(
				"macos-review-contract-host",
			);
			expect(trustedConfig.rulesResolverScript).toBe(
				join(runtimeRoot, "review", "rules-resolver.js"),
			);
			expect(trustedConfig.rulesDirectory).toBe(
				join(runtimeRoot, "review", "rules"),
			);
			expect(readFileSync(markerFile, "utf8")).toContain('"schemaVersion": 1');
			const rule = readFileSync(ruleFile, "utf8");
			const sideArtifacts = [
				{ role: "workflow-launcher-marker", path: markerFile },
				{ role: "codex-execpolicy-rule", path: ruleFile },
			];
			expect(rule).toBe(renderCodexReviewRule(marker));
			expect(rule).toContain('"review", "code", "--host", "codex"');
			expect(rule).toContain('"browser", "session", "--host", "codex"');
			expect(rule).not.toContain(sourceRoot);
			expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts).ok).toBe(true);
			const distributionManifestFile = join(runtimeRoot, "distribution-manifest.json");
			const distributionManifest = JSON.parse(
				readFileSync(distributionManifestFile, "utf8"),
			);
			writeFileSync(
				distributionManifestFile,
				`${JSON.stringify({
					...distributionManifest,
					sideArtifacts: [
						distributionManifest.sideArtifacts[1],
						distributionManifest.sideArtifacts[1],
					],
				}, null, 2)}\n`,
			);
			expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts)).toMatchObject({
				ok: false,
				status: "installed-corrupt",
			});
			writeFileSync(
				distributionManifestFile,
				`${JSON.stringify(distributionManifest, null, 2)}\n`,
			);
			writeFileSync(ruleFile, `${rule}\nprefix_rule(pattern=["bun"], decision="allow")\n`);
			expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts)).toMatchObject({
				ok: false,
				status: "installed-corrupt",
			});
			writeFileSync(ruleFile, rule);
			expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts).ok).toBe(true);
			const realRule = `${ruleFile}.real`;
			renameSync(ruleFile, realRule);
			symlinkSync(realRule, ruleFile);
			expect(inspectDistribution(runtimeRoot, sourceRoot, sideArtifacts)).toMatchObject({
				ok: false,
				status: "installed-corrupt",
			});
			rmSync(ruleFile);
			renameSync(realRule, ruleFile);

			const help = spawnSync(marker.argvPrefix[0], [marker.argvPrefix[1], "--help"], {
				encoding: "utf8",
			});
			expect(help.status).toBe(0);
			expect(help.stdout).toContain("goldband review code");
			expect(help.stdout).toContain("goldband review contract init");
			expect(help.stdout).toContain("goldband review contract validate");
			for (const promptAction of PROMPT_CONTRACT_ACTIONS) {
				const [capability = "", action = ""] = promptAction.split("/");
				const guidance = spawnSync(marker.argvPrefix[0], [
					marker.argvPrefix[1],
					capability,
					action,
					"--host",
					"codex",
				], { encoding: "utf8" });
				expect(guidance.status).toBe(2);
				expect(guidance.stderr).toContain(
					`${promptAction} uses prompt-contract dispatch and is not a shell CLI action`,
				);
			}

			const repo = join(fixture, "repo");
			const stateRoot = join(fixture, "state");
			const poisonRoot = join(fixture, "poison-runtime");
			mkdirSync(repo, { recursive: true });
			mkdirSync(join(poisonRoot, "workflows"), { recursive: true });
			writeFileSync(
				join(poisonRoot, "workflows", "run.ts"),
				"console.error('poison workflow executed'); process.exit(99);\n",
			);
			const initializeRepository = spawnSync("git", ["init"], {
				cwd: repo,
				encoding: "utf8",
			});
			expect(initializeRepository.status, initializeRepository.stderr).toBe(0);
			writeFileSync(join(repo, "review-me.txt"), "baseline\n");
			expect(spawnSync("git", ["add", "review-me.txt"], { cwd: repo }).status).toBe(0);
			const initialCommit = spawnSync(
				"git",
				[
					"-c",
					"user.name=Goldband Test",
					"-c",
					"user.email=goldband@example.invalid",
					"commit",
					"-m",
					"fixture baseline",
				],
				{ cwd: repo, encoding: "utf8" },
			);
			expect(initialCommit.status, initialCommit.stderr).toBe(0);

			const centralRepo = join(fixture, "central-repo");
			mkdirSync(centralRepo, { recursive: true });
			expect(spawnSync("git", ["init"], { cwd: centralRepo }).status).toBe(0);
			writeFileSync(join(centralRepo, "review-me.txt"), "baseline\n");
			expect(spawnSync("git", ["add", "review-me.txt"], { cwd: centralRepo }).status).toBe(0);
			expect(spawnSync("git", [
				"-c", "user.name=Goldband Test",
				"-c", "user.email=goldband@example.invalid",
				"commit", "-m", "central fixture baseline",
			], { cwd: centralRepo }).status).toBe(0);
			writeFileSync(join(centralRepo, "review-me.txt"), "change\n");
			const centralManifest = join(fixture, "central-contract.json");
			writeFileSync(centralManifest, `${JSON.stringify(installedPrimaryContractManifest())}\n`);
			const centralEnv = {
				...process.env,
				HOME: emptyHome,
				GOLDBAND_HOME: stateRoot,
				GOLDBAND_TEST_HOST_CALL_LOG: hostCallLog,
				PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
			};
			const centralStatusBefore = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
				cwd: centralRepo,
				encoding: "utf8",
			}).stdout;
			const missingCentral = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "code", "--host", "codex",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(missingCentral.status).not.toBe(0);
			expect(missingCentral.stderr).toContain("review/code evidence contract is required");
			expect(existsSync(join(centralRepo, "goldband.review-evidence.json"))).toBe(false);

			const importedContract = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "import", "--manifest", centralManifest,
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(importedContract.status, importedContract.stderr).toBe(0);
			const importedReadback = JSON.parse(importedContract.stdout);
			expect(importedReadback.before.configured).toBe(false);
			expect(importedReadback.after.baseline.kind).toBe("runtime-store");
			const inspectedContract = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "inspect",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(inspectedContract.status, inspectedContract.stderr).toBe(0);
			expect(JSON.parse(inspectedContract.stdout).runtimeStore).toMatchObject({
				present: true,
				shadowed: false,
			});
			const centralReview = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "code", "--host", "codex",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(centralReview.status, centralReview.stderr).toBe(0);
			const centralArtifactPath = (JSON.parse(centralReview.stdout) as { artifacts: string[] })
				.artifacts.find((file) => file.endsWith("-review-evidence.json"));
			const centralArtifact = JSON.parse(readFileSync(centralArtifactPath!, "utf8"));
			expect(centralArtifact.evidence.contractResolution.baseline.kind).toBe("runtime-store");
			expect(centralArtifact.evidence.contractResolution.effectiveDigest)
				.toBe(centralArtifact.binding.behaviorContractDigest);
			const centralLineageRoot = join(dirname(runtimeRoot), "review-receipts", "review-lineages");
			const centralLineageFiles = readdirSync(centralLineageRoot)
				.filter((name) => name.endsWith(".json"));
			expect(centralLineageFiles).toHaveLength(1);
			const centralLineage = JSON.parse(readFileSync(
				join(centralLineageRoot, centralLineageFiles[0]!),
				"utf8",
			));
			expect(centralLineage.contractResolution).toEqual(
				centralArtifact.evidence.contractResolution,
			);
			expect(spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
				cwd: centralRepo,
				encoding: "utf8",
			}).stdout).toBe(centralStatusBefore);

			const centralWorktree = join(fixture, "central-worktree");
			const addWorktree = spawnSync("git", [
				"worktree", "add", "-b", "central-contract-worktree", centralWorktree,
			], { cwd: centralRepo, encoding: "utf8" });
			expect(addWorktree.status, addWorktree.stderr).toBe(0);
			const worktreeInspection = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "inspect",
			], { cwd: centralWorktree, encoding: "utf8", env: centralEnv });
			expect(worktreeInspection.status, worktreeInspection.stderr).toBe(0);
			expect(JSON.parse(worktreeInspection.stdout).runtimeStore.present).toBe(true);

			const centralClone = join(fixture, "central-clone");
			const cloneCentral = spawnSync("git", ["clone", "-q", centralRepo, centralClone], {
				encoding: "utf8",
			});
			expect(cloneCentral.status, cloneCentral.stderr).toBe(0);
			const cloneInspection = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "inspect",
			], { cwd: centralClone, encoding: "utf8", env: centralEnv });
			expect(cloneInspection.status, cloneInspection.stderr).toBe(0);
			expect(JSON.parse(cloneInspection.stdout).runtimeStore.present).toBe(false);

			expect(spawnSync("git", [
				"remote", "add", "origin", "https://example.invalid/central.git",
			], { cwd: centralRepo }).status).toBe(0);
			const driftInspection = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "inspect",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(driftInspection.status, driftInspection.stderr).toBe(0);
			expect(JSON.parse(driftInspection.stdout).runtimeStore.invalidReason)
				.toContain("remote identity changed");
			const reboundContract = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "import", "--manifest", centralManifest,
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(reboundContract.status, reboundContract.stderr).toBe(0);

			const displacedCentralRepo = join(fixture, "displaced-central-repo");
			renameSync(centralRepo, displacedCentralRepo);
			mkdirSync(centralRepo);
			expect(spawnSync("git", ["init"], { cwd: centralRepo }).status).toBe(0);
			expect(spawnSync("git", [
				"remote", "add", "origin", "https://example.invalid/central.git",
			], { cwd: centralRepo }).status).toBe(0);
			const reusedPathInspection = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "inspect",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(reusedPathInspection.status, reusedPathInspection.stderr).toBe(0);
			expect(JSON.parse(reusedPathInspection.stdout).runtimeStore.invalidReason)
				.toContain("repository identity mismatch");
			const reboundReplacement = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "import", "--manifest", centralManifest,
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(reboundReplacement.status, reboundReplacement.stderr).toBe(0);
			const removedContract = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "remove",
			], { cwd: centralRepo, encoding: "utf8", env: centralEnv });
			expect(removedContract.status, removedContract.stderr).toBe(0);
			expect(JSON.parse(removedContract.stdout).after.configured).toBe(false);

			writeFileSync(join(repo, "review-me.txt"), "change\n");
			writeFileSync(
				join(repo, "goldband.review-evidence.json"),
				`${JSON.stringify(installedReviewEvidenceManifest())}\n`,
			);
			const importedRepositoryManifest = spawnInstalledRuntime(marker.argvPrefix[0], [
				marker.argvPrefix[1], "review", "contract", "import", "--manifest",
				join(repo, "goldband.review-evidence.json"),
			], { cwd: repo, encoding: "utf8", env: centralEnv });
			expect(importedRepositoryManifest.status, importedRepositoryManifest.stderr).toBe(0);
			expect(JSON.parse(importedRepositoryManifest.stdout).after.runtimeStore.shadowed).toBe(false);
			expect(existsSync(join(repo, "goldband.review-evidence.json"))).toBe(true);
			const weakManifest = join(fixture, "weak-contract.json");
			writeFileSync(weakManifest, `${JSON.stringify(installedPrimaryContractManifest())}\n`);
			const hostCallsBeforeDowngrade = lineCount(hostCallLog);
			const downgraded = runInstalledReview(repo, [
				"--host", "codex", "--evidence-manifest", weakManifest,
			]);
			expect(downgraded.status).not.toBe(0);
			expect(downgraded.stderr).toContain("review contract laundering blocked");
			expect(lineCount(hostCallLog)).toBe(hostCallsBeforeDowngrade);
			const review = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: emptyHome,
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_ROOT: poisonRoot,
						GOLDBAND_RULES_DIR: join(poisonRoot, "rules"),
						GOLDBAND_TEST_HOST_CALL_LOG: hostCallLog,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(
				review.status,
				[
					`review stdout:\n${review.stdout}`,
					`review stderr:\n${review.stderr}`,
				].join("\n"),
			).toBe(0);
			expect(review.stdout).toContain("review/code runtime report");
			expect(existsSync(join(repo, "goldband.review-evidence.json"))).toBe(true);
			expect(review.stdout).toContain("Phase: initial.");
			const reviewResult = JSON.parse(review.stdout) as { artifacts: string[] };
			const initialArtifactPath = reviewResult.artifacts.find((file) =>
				file.endsWith("-review-evidence.json"));
			expect(initialArtifactPath).toBeDefined();
			const initialArtifact = JSON.parse(readFileSync(initialArtifactPath!, "utf8"));
			const installedRecord = initialArtifact.evidence.records[0];
			const installedPath = classifyInstalledReviewPath(
				installedRecord,
				nestedEvidenceBoundaryUnavailable,
			);
			expect(installedPath, JSON.stringify(installedRecord, null, 2)).not.toBe("unverified");
			console.info(installedReviewCoverageSummary(installedPath));
			const runtimeReceiptId = initialArtifact.runtimeReceipt.id;
			expect(runtimeReceiptId).toMatch(/^[A-Za-z0-9._-]+$/);
			expect(initialArtifact).toMatchObject({
				phase: "initial",
				hostCallCount: installedPath === "full-verified" ? 1 : 0,
				runtimeReceipt: {
					schemaVersion: 1,
					id: expect.any(String),
					digest: expect.stringMatching(/^[a-f0-9]{64}$/),
					signature: expect.stringMatching(/^[a-f0-9]{64}$/),
					reviewScope: { kind: "standalone" },
				},
				evidence: installedPath === "full-verified" ? {
					records: [{ id: "installed-gate:pass", status: "verified-pass", fresh: true }],
				} : {
					records: [{ id: "installed-gate:pass", status: "runtime-incomplete", fresh: false }],
				},
			});
			expect(readFileSync(
				join(
					dirname(runtimeRoot),
					"review-receipts",
					`${runtimeReceiptId}.json`,
				),
				"utf8",
			)).toContain(initialArtifact.binding.candidateDigest);
			if (installedPath === "outer-sandbox-runtime-incomplete") {
				expect(review.stdout).toContain(
					"Deterministic evidence: 0 verified pass, 0 verified failure, 0 coverage gap, 1 runtime incomplete.",
				);
				expect(review.stdout).toContain("Semantic host calls: 0.");
				expect(review.stdout).toContain("completion-authorized: false");
			}

			const workflowEvidenceFile = join(stateRoot, "workflow-runs", "review", "code.jsonl");
			const providerDispatchesBeforeDuplicate = workflowStepEventCount(
				workflowEvidenceFile,
				"run-evidence",
			);
			const hostCallsBeforeDuplicate = lineCount(hostCallLog);
			const duplicate = runInstalledReview(
				repo,
				[
					"--include-untracked",
					"--host",
					"codex",
					"--worktree",
				],
			);
			expect(duplicate.status).not.toBe(0);
			expect(duplicate.stderr).toMatch(/prior findings\/blockers open|duplicate initial review identity/);
			expect(workflowStepEventCount(workflowEvidenceFile, "run-evidence"))
				.toBe(providerDispatchesBeforeDuplicate);
			expect(lineCount(hostCallLog)).toBe(hostCallsBeforeDuplicate);

			writeFileSync(join(repo, "review-me.txt"), "repaired without closure\n");
			const repairedInitial = runInstalledReview(
				repo,
				["--host", "codex"],
			);
			expect(repairedInitial.status).not.toBe(0);
			expect(repairedInitial.stderr).toContain("prior findings/blockers open");
			expect(workflowStepEventCount(workflowEvidenceFile, "run-evidence"))
				.toBe(providerDispatchesBeforeDuplicate);
			expect(lineCount(hostCallLog)).toBe(hostCallsBeforeDuplicate);
			writeFileSync(join(repo, "review-me.txt"), "change\n");

			const authorityHostCallsBefore = lineCount(hostCallLog);
			const forgedArtifactPath = join(repo, "forged-initial-review.json");
			writeFileSync(forgedArtifactPath, `${JSON.stringify({
				...initialArtifact,
				hostCallCount: 1,
				findings: initialArtifact.findings.map((finding: Record<string, unknown>) => ({
					...finding,
					summary: "caller-forged closure authority",
				})),
			})}\n`);
			const forgedClosure = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
					"--closure-artifact",
					forgedArtifactPath,
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(forgedClosure.status).not.toBe(0);
			expect(forgedClosure.stderr).toMatch(/receipt|artifact/);
			expect(lineCount(hostCallLog)).toBe(authorityHostCallsBefore);

			const runtimeReceiptFile = join(
				dirname(runtimeRoot),
				"review-receipts",
				`${runtimeReceiptId}.json`,
			);
			const trustedRuntimeReceipt = readFileSync(runtimeReceiptFile, "utf8");
			const forgedRuntimeReceipt = JSON.parse(trustedRuntimeReceipt);
			forgedRuntimeReceipt.signature = "0".repeat(64);
			writeFileSync(runtimeReceiptFile, `${JSON.stringify(forgedRuntimeReceipt)}\n`);
			const forgedReceiptClosure = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
					"--closure-artifact",
					initialArtifactPath!,
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(forgedReceiptClosure.status).not.toBe(0);
			expect(forgedReceiptClosure.stderr).toMatch(
				installedPath === "full-verified"
					? /receipt|signature/
					: /completed initial semantic host call/,
			);
			expect(lineCount(hostCallLog)).toBe(authorityHostCallsBefore);
			writeFileSync(runtimeReceiptFile, trustedRuntimeReceipt);

				if (installedPath === "full-verified") {
				writeFileSync(join(repo, "review-me.txt"), "repaired\n");
				const closure = spawnInstalledRuntime(
					marker.argvPrefix[0],
					[
						marker.argvPrefix[1],
						"review",
						"code",
						"--host",
						"codex",
						"--closure-artifact",
						initialArtifactPath!,
					],
					{
						cwd: repo,
						encoding: "utf8",
						env: {
							...process.env,
							HOME: join(fixture, "empty-home"),
							GOLDBAND_HOME: stateRoot,
							PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
						},
					},
				);
				expect(
				closure.status,
				`closure stdout:\n${closure.stdout}\nclosure stderr:\n${closure.stderr}`,
				).toBe(0);
				expect(closure.stdout).toContain("Phase: closure.");
				expect(closure.stdout).toContain("[closed] S-001");
				const closureResult = JSON.parse(closure.stdout) as { artifacts: string[] };
				const closureArtifactPath = closureResult.artifacts.find((file) =>
				file.endsWith("-review-closure.json"));
				expect(closureArtifactPath).toBeDefined();
				const closureArtifact = JSON.parse(readFileSync(closureArtifactPath!, "utf8"));
				expect(closureArtifact).toMatchObject({
				phase: "closure",
				hostCallCount: 1,
				results: [{ findingId: "S-001", status: "closed" }],
					});
				}

				const repairRepo = join(fixture, "pre-semantic-repair-repo");
				mkdirSync(repairRepo, { recursive: true });
				expect(spawnSync("git", ["init", "-q"], { cwd: repairRepo }).status).toBe(0);
				const repairInitialManifest = installedUnsupportedManifest();
				const unrelatedProvider = {
					...installedHighRiskReviewEvidenceManifest().providers[0],
					id: "unrelated-gate",
					cellIds: ["unrelated-static"],
					applicability: { kind: "paths", pathPrefixes: ["unrelated"] },
				};
				repairInitialManifest.providers.push(unrelatedProvider);
				repairInitialManifest.behaviorMatrix.push(
					{ ...repairInitialManifest.behaviorMatrix[0], id: "unrelated-manual",
						behavior: "The unrelated manual boundary is checked.", disposition: "manual" },
					{ ...installedHighRiskReviewEvidenceManifest().behaviorMatrix[0], id: "unrelated-static",
						behavior: "The unrelated static boundary is checked.", providerIds: ["unrelated-gate"] },
				);

				writeFileSync(join(repairRepo, "review-me.txt"), "baseline\n");
				writeFileSync(
					join(repairRepo, "goldband.review-evidence.json"),
					`${JSON.stringify(repairInitialManifest)}\n`,
				);
				expect(spawnSync("git", ["add", "."], { cwd: repairRepo }).status).toBe(0);
				expect(spawnSync("git", [
					"-c", "user.name=Goldband Test", "-c", "user.email=goldband@example.invalid",
					"commit", "-qm", "pre-semantic repair fixture",
				], { cwd: repairRepo }).status).toBe(0);
				writeFileSync(
					join(repairRepo, "candidate.patch"),
					installedCandidatePatch("deterministic blocker"),
				);
				const deterministicHostCallsBefore = lineCount(hostCallLog);
				const deterministicInitial = runInstalledReview(repairRepo, [
					"--diff-file", "candidate.patch", "--host", "codex",
				]);
				expect(deterministicInitial.status, deterministicInitial.stderr).toBe(0);
				const deterministicResult = JSON.parse(deterministicInitial.stdout) as {
					artifacts: string[];
				};
				const deterministicArtifactFile = deterministicResult.artifacts.find((file) =>
					file.endsWith("-review-evidence.json"))!;
				const deterministicArtifact = JSON.parse(
					readFileSync(deterministicArtifactFile, "utf8"),
				);
				expect(deterministicArtifact.hostCallCount).toBe(0);
				expect(deterministicArtifact.findings[0].id).toBe("D-001");
				expect(lineCount(hostCallLog)).toBe(deterministicHostCallsBefore);

				const repairedManifest = join(fixture, "pre-semantic-repaired-contract.json");
				const repairContract = installedHighRiskReviewEvidenceManifest();
				repairContract.behaviorMatrix.push(
					{ ...repairInitialManifest.behaviorMatrix[1], providerIds: ["unrelated-gate"] },
					repairInitialManifest.behaviorMatrix[2],
				);
				repairContract.providers.push({ ...unrelatedProvider, cellIds: ["unrelated-static", "unrelated-manual"] });
				writeFileSync(repairedManifest, `${JSON.stringify(repairContract)}\n`);
				writeFileSync(
					join(repairRepo, "candidate.patch"),
					installedCandidatePatch("deterministic evidence repaired"),
				);
				const repairedReview = runInstalledReview(repairRepo, [
					"--diff-file", "candidate.patch",
					"--host", "codex",
					"--evidence-manifest", repairedManifest,
					"--closure-artifact", deterministicArtifactFile,
				]);
				expect(repairedReview.status, repairedReview.stderr).toBe(0);
				expect(repairedReview.stdout).toContain("Phase: evidence-repair.");
				const repairedResult = JSON.parse(repairedReview.stdout) as { artifacts: string[] };
				const repairedArtifactFile = repairedResult.artifacts.find((file) =>
					file.endsWith("-review-evidence.json"))!;
				const repairedArtifact = JSON.parse(readFileSync(repairedArtifactFile, "utf8"));
				if (nestedEvidenceBoundaryUnavailable) {
					expect(repairedArtifact.hostCallCount).toBe(0);
					expect(lineCount(hostCallLog)).toBe(deterministicHostCallsBefore);
				} else {
					expect(repairedArtifact).toMatchObject({
						hostCallCount: 1,
						predecessor: {
							transition: "evidence-repair",
							runId: deterministicArtifact.runId,
							receiptId: deterministicArtifact.runtimeReceipt.id,
							findingIds: ["D-001", "D-002"],
							affectedCellIds: ["installed-review", "unrelated-manual", "unrelated-static"],
						},
					});
					expect(repairedArtifact.evidence.records.map((record) => record.id)).toEqual(["installed-gate:pass"]);
					expect(repairedArtifact.findings).toMatchObject([{ id: "S-001", classification: "semantic-concern" }]);
					expect(lineCount(hostCallLog)).toBe(deterministicHostCallsBefore + 1);
					writeFileSync(
						join(repairRepo, "candidate.patch"),
						installedCandidatePatch("semantic finding repaired"),
					);
					const repairedClosure = runInstalledReview(repairRepo, [
						"--diff-file", "candidate.patch",
						"--host", "codex",
						"--evidence-manifest", repairedManifest,
						"--closure-artifact", repairedArtifactFile,
					]);
					expect(repairedClosure.status, repairedClosure.stderr).toBe(0);
					expect(repairedClosure.stdout).toContain("Phase: closure.");
					expect(repairedClosure.stdout).toContain("[closed] S-001");
					expect(lineCount(hostCallLog)).toBe(deterministicHostCallsBefore + 2);
				}

				const cleanRepo = join(fixture, "clean-repo");
			mkdirSync(cleanRepo, { recursive: true });
			expect(spawnSync("git", ["init", "-q"], { cwd: cleanRepo }).status).toBe(0);
			writeFileSync(join(cleanRepo, "review-me.txt"), "baseline\n");
			writeFileSync(
				join(cleanRepo, "candidate.patch"),
				installedCandidatePatch("clean candidate one"),
			);
			writeFileSync(
				join(cleanRepo, "goldband.review-evidence.json"),
				`${JSON.stringify(installedNoOperationManifest())}\n`,
			);
			expect(spawnSync("git", ["add", "."], { cwd: cleanRepo }).status).toBe(0);
			const cleanCommit = spawnSync(
				"git",
				[
					"-c",
					"user.name=Goldband Test",
					"-c",
					"user.email=goldband@example.invalid",
					"commit",
					"-qm",
					"clean installed fixture",
				],
				{ cwd: cleanRepo, encoding: "utf8" },
			);
			expect(cleanCommit.status, cleanCommit.stderr).toBe(0);
			const lineageRoot = join(dirname(runtimeRoot), "review-receipts", "review-lineages");
			const lineageFilesBeforeClean = new Set(readdirSync(lineageRoot));
			const cleanHostCallsBefore = lineCount(hostCallLog);
			const cleanInitial = runInstalledReview(
				cleanRepo,
				[
					"--diff-file",
					"candidate.patch",
					"--host",
					"codex",
				],
				{
					GOLDBAND_TEST_CLEAN_REVIEW: "1",
				},
			);
			expect(cleanInitial.status, cleanInitial.stderr).toBe(0);
			expect(cleanInitial.stdout).toContain("no-new-findings: true");
			expect(lineCount(hostCallLog)).toBe(cleanHostCallsBefore + 1);
			const cleanLineageFiles = readdirSync(lineageRoot).filter(
				(file) => !lineageFilesBeforeClean.has(file),
			);
			expect(cleanLineageFiles).toHaveLength(1);
			const cleanLineageFile = join(lineageRoot, cleanLineageFiles[0]!);
			const firstCleanLineage = JSON.parse(readFileSync(cleanLineageFile, "utf8"));
			const cleanProviderDispatches = workflowStepEventCount(workflowEvidenceFile, "run-evidence");
			const cleanDuplicate = runInstalledReview(
				cleanRepo,
				[
					"--host",
					"codex",
					"--diff-file",
					join(cleanRepo, "candidate.patch"),
				],
				{
					GOLDBAND_TEST_CLEAN_REVIEW: "1",
				},
			);
			expect(cleanDuplicate.status).not.toBe(0);
			expect(cleanDuplicate.stderr).toContain(
				"duplicate initial review identity already has an authoritative result",
			);
			expect(workflowStepEventCount(workflowEvidenceFile, "run-evidence"))
				.toBe(cleanProviderDispatches);
			expect(lineCount(hostCallLog)).toBe(cleanHostCallsBefore + 1);
			const crossHostDuplicate = runInstalledReview(
				cleanRepo,
				[
					"--diff-file",
					"candidate.patch",
					"--host",
					"claude",
				],
				{
					PATH: `${trustedBin}:${poisonBin}:${process.env.PATH ?? ""}`,
				},
			);
			expect(crossHostDuplicate.status).not.toBe(0);
			expect(crossHostDuplicate.stderr).toContain(
				"duplicate initial review identity already has an authoritative result",
			);
			expect(workflowStepEventCount(workflowEvidenceFile, "run-evidence"))
				.toBe(cleanProviderDispatches);
			expect(lineCount(hostCallLog)).toBe(cleanHostCallsBefore + 1);

			writeFileSync(
				join(cleanRepo, "candidate.patch"),
				installedCandidatePatch("clean candidate two"),
			);
			const cleanSuccessor = runInstalledReview(
				cleanRepo,
				[
					"--host",
					"codex",
					"--diff-file",
					"candidate.patch",
				],
				{
					GOLDBAND_TEST_CLEAN_REVIEW: "1",
				},
			);
			expect(cleanSuccessor.status, cleanSuccessor.stderr).toBe(0);
			expect(lineCount(hostCallLog)).toBe(cleanHostCallsBefore + 2);
			const successorLineage = JSON.parse(readFileSync(cleanLineageFile, "utf8"));
			expect(successorLineage.revision).toBe(firstCleanLineage.revision + 1);
			expect(successorLineage.acceptanceDigest).toBe(firstCleanLineage.acceptanceDigest);
			expect(successorLineage.policyDigest).toBe(firstCleanLineage.policyDigest);
			expect(successorLineage.lastCandidateDigest).not.toBe(
				firstCleanLineage.lastCandidateDigest,
			);

			const isolatedRepo = join(fixture, "isolated-repo");
			const cloneForCodexIsolation = spawnSync(
				"git",
				["clone", "-q", cleanRepo, isolatedRepo],
				{ encoding: "utf8" },
			);
			expect(cloneForCodexIsolation.status, cloneForCodexIsolation.stderr).toBe(0);
			const isolatedCallsBefore = lineCount(hostCallLog);
			const isolatedCodexInitial = runInstalledReview(
				isolatedRepo,
				["--host", "codex", "--diff-file", "candidate.patch"],
				{ GOLDBAND_TEST_CLEAN_REVIEW: "1" },
			);
			expect(isolatedCodexInitial.status, isolatedCodexInitial.stderr).toBe(0);
			expect(lineCount(hostCallLog)).toBe(isolatedCallsBefore + 1);

			const claudeRepo = join(fixture, "claude-repo");
			const cloneForClaude = spawnSync(
				"git",
				["clone", "-q", cleanRepo, claudeRepo],
				{ encoding: "utf8" },
			);
			expect(cloneForClaude.status, cloneForClaude.stderr).toBe(0);
			const isolateClaudeAuthority = spawnSync(
				"git",
				["remote", "set-url", "origin", "https://example.invalid/claude-parity.git"],
				{ cwd: claudeRepo, encoding: "utf8" },
			);
			expect(isolateClaudeAuthority.status, isolateClaudeAuthority.stderr).toBe(0);
			const claudeCallsBefore = lineCount(hostCallLog);
			const claudeInitial = runInstalledReview(
				claudeRepo,
				[
					"--host",
					"claude",
					"--diff-file",
					"candidate.patch",
				],
				{
					PATH: `${trustedBin}:${poisonBin}:${process.env.PATH ?? ""}`,
				},
			);
			expect(claudeInitial.status, claudeInitial.stderr).toBe(0);
			expect(claudeInitial.stdout).toContain("no-new-findings: true");
			expect(lineCount(hostCallLog)).toBe(claudeCallsBefore + 1);
			const claudeDuplicate = runInstalledReview(
				claudeRepo,
				[
					"--diff-file",
					join(claudeRepo, "candidate.patch"),
					"--host",
					"claude",
				],
				{
					PATH: `${trustedBin}:${poisonBin}:${process.env.PATH ?? ""}`,
				},
			);
			expect(claudeDuplicate.status).not.toBe(0);
			expect(claudeDuplicate.stderr).toContain(
				"duplicate initial review identity already has an authoritative result",
			);
			expect(lineCount(hostCallLog)).toBe(claudeCallsBefore + 1);

			const python = spawnSync("/usr/bin/which", ["python3.14"], { encoding: "utf8" }).stdout.trim();
			const uv = spawnSync("/usr/bin/which", ["uv"], { encoding: "utf8" }).stdout.trim();
			if ((!python || !uv) && process.platform === "darwin") {
				throw new Error("required review host boundary prerequisite is unavailable: Python 3.14 and uv executables");
			}
			if (python && uv && process.platform === "darwin") {
				const pythonRepo = join(fixture, "installed-python-repo");
				const pythonCache = join(fixture, "installed-python-cache");
				mkdirSync(pythonRepo, { recursive: true });
				mkdirSync(pythonCache, { recursive: true });
				expect(spawnSync("git", ["init", "-q"], { cwd: pythonRepo }).status).toBe(0);
				writeFileSync(join(pythonRepo, "pyproject.toml"), [
					"[project]",
					'name = "installed-python-evidence"',
					'version = "0.1.0"',
					'requires-python = ">=3.14,<3.15"',
					'dependencies = ["fixture-dep"]',
					"[tool.uv.sources]",
					'fixture-dep = { path = "vendor/fixture_dep-1.0.0-py3-none-any.whl" }',
					"",
				].join("\n"));
				const fixtureWheel = join(
					pythonRepo,
					"vendor",
					"fixture_dep-1.0.0-py3-none-any.whl",
				);
				mkdirSync(dirname(fixtureWheel), { recursive: true });
				writeInstalledFixtureWheel(python, fixtureWheel);
				writeFileSync(join(pythonRepo, "app.py"), 'VALUE = "base"\n');
				const lock = spawnSync(uv, [
					"lock", "--project", pythonRepo, "--python", python, "--offline", "--no-cache",
				], { encoding: "utf8" });
				expect(lock.status, lock.stderr).toBe(0);
				writeFileSync(
					join(pythonRepo, "goldband.review-evidence.json"),
					`${JSON.stringify(installedPythonEvidenceManifest())}\n`,
				);
				expect(spawnSync("git", ["add", "."], { cwd: pythonRepo }).status).toBe(0);
				const commit = spawnSync("git", [
					"-c", "user.name=Goldband Test",
					"-c", "user.email=goldband@example.invalid",
					"commit", "-qm", "installed Python fixture",
				], { cwd: pythonRepo, encoding: "utf8" });
				expect(commit.status, commit.stderr).toBe(0);
				writeFileSync(join(pythonRepo, "app.py"), 'VALUE = "candidate"\n');
				const installedPython = runInstalledReview(
					pythonRepo,
					["--host", "codex", "--worktree"],
					{
						GOLDBAND_TEST_CLEAN_REVIEW: "1",
						GOLDBAND_HOME: join(fixture, "installed-python-state"),
						UV_CACHE_DIR: pythonCache,
					},
				);
				expect(installedPython.status, installedPython.stderr).toBe(0);
				const output = JSON.parse(installedPython.stdout) as { artifacts: string[] };
				const evidenceFile = output.artifacts.find((file) => file.endsWith("-review-evidence.json"));
				const evidence = JSON.parse(readFileSync(evidenceFile!, "utf8"));
				expect(evidence.evidence.records[0]).toMatchObject({
					status: "verified-pass",
					fresh: true,
					exitStatus: 0,
				});
				expect(evidence.evidence.records[0].outputSummary).toContain("/operations/");
				expect(evidence.evidence.records[0].outputSummary).toContain("/python-runtime/environment/");
				expect(evidence.evidence.records[0].outputSummary).not.toContain(pythonRepo);
			}

			const browser = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"browser",
					"session",
					"--host",
					"codex",
					"status",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_ROOT: poisonRoot,
						GOLDBAND_TRUSTED_BROWSER_EXECUTABLE: poisonCodex,
					},
				},
			);
			expect(browser.status).toBe(0);
			expect(browser.stdout).toContain("browser-ok:status");
			expect(browser.stdout).toContain('"status": "completed"');
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 30_000);

	test("rejects a trusted runtime inside the writable source", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-reject-"));
		try {
			expect(() =>
				installCodexReviewLauncher({
					sourceRoot,
					runtimeRoot: join(sourceRoot, ".unsafe-review-runtime"),
					ruleFile: join(fixture, "rule.rules"),
					markerFile: join(fixture, "marker.json"),
					bunPath,
					codexPath: Bun.which("codex") ?? bunPath,
					browserPath: bunPath,
					bundleBrowserServer: (_bun, _entry, outputDirectory) => {
						mkdirSync(outputDirectory, { recursive: true });
						writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
					},
				}),
			).toThrow("must be outside the Goldband source workspace");
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("distinguishes verified, outer-sandbox runtime-incomplete, and unverified coverage", () => {
		const sandboxDenied = {
			status: "runtime-incomplete",
			outputSummary: "runner incomplete: sandbox-exec denied or could not initialize the operation",
		};
		expect(classifyInstalledReviewPath(sandboxDenied, true))
			.toBe("outer-sandbox-runtime-incomplete");
		expect(classifyInstalledReviewPath(sandboxDenied, false)).toBe("unverified");
		expect(classifyInstalledReviewPath({
			status: "runtime-incomplete",
			outputSummary: "runner incomplete: timeout",
		}, true)).toBe("unverified");
		expect(classifyInstalledReviewPath({
			status: "verified-pass",
			outputSummary: "fixture gate passed",
		}, false)).toBe("full-verified");
		expect(installedReviewCoverageSummary("full-verified")).toContain(
			"verified; full supported-sandbox path: verified",
		);
		expect(installedReviewCoverageSummary("outer-sandbox-runtime-incomplete")).toContain(
			"runtime-incomplete; full supported-sandbox path: unverified",
		);
		expect(installedReviewCoverageSummary("unverified")).toContain(
			"unverified; full supported-sandbox path: unverified",
		);
	});

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
			const receiptKeyFile = join(dirname(runtimeRoot), "review-receipt.key");
			const receiptKey = readFileSync(receiptKeyFile, "utf8");
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
			expect(readFileSync(receiptKeyFile, "utf8")).toBe(receiptKey);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("an execpolicy probe matches only trusted review and browser prefixes", () => {
		const codex = Bun.which("codex");
		if (!codex) {
			if (process.env.GOLDBAND_REQUIRE_REVIEW_HOST_BOUNDARY === "1") {
				throw new Error("required review host boundary prerequisite is unavailable: codex executable");
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

function installedReviewEvidenceManifest() {
	return {
		schemaVersion: 2,
		behaviorMatrix: [{
			id: "installed-review",
			behavior: "The installed runtime executes declared evidence before review.",
			kind: "normal",
			input: "installed fixture candidate",
			preconditions: "Seatbelt runner is available",
			expected: "the fixture gate exits successfully",
			risk: "low",
			disposition: "static",
			providerIds: ["installed-gate"],
		}],
		providers: [{
			id: "installed-gate",
			owner: "codex-review-launcher-install.test.ts",
			kind: "static",
			lifecycle: "persistent",
			cellIds: ["installed-review"],
			applicability: { kind: "global", reason: "Explicit installed-runtime test fixture." },
			executionContext: {
				sandboxOwner: "provider",
				runner: "host-seatbelt",
				lane: "macos-review-contract-host",
			},
			operations: [{
				id: "pass",
				target: "candidate",
				argv: ["true"],
				expectedExit: "zero",
				timeoutMs: 10000,
				maxOutputBytes: 1024,
				network: "deny",
				evidenceLevel: "fixture",
			}],
		}],
		authorizations: [],
	};
}

function installedUnsupportedManifest() {
	const value = installedHighRiskReviewEvidenceManifest();
	value.behaviorMatrix[0] = {
		...value.behaviorMatrix[0],
		disposition: "unsupported",
		providerIds: [],
		reason: "The installed deterministic provider is not wired yet.",
	};
	value.providers = [];
	return value;
}

function installedHighRiskReviewEvidenceManifest() {
	const value = installedReviewEvidenceManifest();
	value.behaviorMatrix[0] = { ...value.behaviorMatrix[0], risk: "high" };
	return value;
}

function writeInstalledFixtureWheel(python: string, output: string): void {
	const script = [
		"import sys,zipfile",
		"p=sys.argv[1]",
		'with zipfile.ZipFile(p,"w",compression=zipfile.ZIP_DEFLATED) as z:',
		' z.writestr("fixture_dep/__init__.py","VALUE = 42\\n")',
		' z.writestr("fixture_dep-1.0.0.dist-info/METADATA","Metadata-Version: 2.1\\nName: fixture-dep\\nVersion: 1.0.0\\n")',
		' z.writestr("fixture_dep-1.0.0.dist-info/WHEEL","Wheel-Version: 1.0\\nGenerator: goldband-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")',
		' z.writestr("fixture_dep-1.0.0.dist-info/RECORD","")',
	].join("\n");
	const result = spawnSync(python, ["-I", "-S", "-c", script, output], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}

function installedPythonEvidenceManifest() {
	return {
		schemaVersion: 2,
		behaviorMatrix: [{
			id: "installed-python-review",
			behavior: "The installed runtime executes a lock-bound Python candidate gate.",
			kind: "boundary",
			input: "Python 3.14 candidate and uv lockfile",
			preconditions: "the host has Python 3.14, uv, and complete offline artifacts",
			expected: "the candidate module imports from the materialized snapshot",
			risk: "high",
			disposition: "automated",
			providerIds: ["installed-python-gate"],
		}],
		providers: [{
			id: "installed-python-gate",
			owner: "codex-review-launcher-install.test.ts",
			kind: "project-gate",
			lifecycle: "persistent",
			cellIds: ["installed-python-review"],
			applicability: { kind: "global", reason: "Explicit installed Python runtime fixture." },
			executionContext: { sandboxOwner: "review-runtime", runner: "sealed" },
			operations: [{
				id: "python-pass",
				target: "candidate",
				argv: ["python3.14", "-c", 'import app,fixture_dep; assert app.VALUE == "candidate" and fixture_dep.VALUE == 42; print(app.__file__); print(fixture_dep.__file__)'],
				expectedExit: "zero",
				timeoutMs: 30000,
				maxOutputBytes: 4096,
				network: "deny",
				evidenceLevel: "local",
				pythonRuntime: {
					interpreter: "python3.14",
					resolver: "uv",
					projectFile: "pyproject.toml",
					lockFile: "uv.lock",
				},
			}],
		}],
		authorizations: [],
	};
}

function installedPrimaryContractManifest() {
	return {
		schemaVersion: 2,
		behaviorMatrix: [{
			id: "installed-central-contract",
			behavior: "The explicitly imported local repository contract resolves.",
			kind: "boundary",
			input: "A repository without a committed manifest.",
			preconditions: "The user imported this contract.",
			expected: "Resolution remains deterministic and candidate-bound.",
			risk: "low",
			disposition: "not-applicable",
			providerIds: [],
			reason: "Installed contract-store wiring fixture.",
		}],
		providers: [],
		authorizations: [],
	};
}

function nestedSandboxProbeIsBlocked(): boolean {
	if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
		return false;
	}
	const probe = spawnSync(
		"/usr/bin/sandbox-exec",
		["-p", "(version 1)\n(allow default)", "/usr/bin/true"],
		{ encoding: "utf8" },
	);
	return probe.status === 71 && /Operation not permitted/.test(probe.stderr);
}

function classifyInstalledReviewPath(
	record: { status: string; outputSummary: string },
	nestedEvidenceBoundaryUnavailable: boolean,
): "full-verified" | "outer-sandbox-runtime-incomplete" | "unverified" {
	if (record.status === "verified-pass") return "full-verified";
	if (
		nestedEvidenceBoundaryUnavailable &&
		record.status === "runtime-incomplete" &&
		record.outputSummary.includes(
			"runner incomplete: sandbox-exec denied or could not initialize the operation",
		)
	) {
		return "outer-sandbox-runtime-incomplete";
	}
	return "unverified";
}

function installedReviewCoverageSummary(
	path: "full-verified" | "outer-sandbox-runtime-incomplete" | "unverified",
): string {
	if (path === "full-verified") {
		return "[installed-review-lineage] installed evidence: verified; full supported-sandbox path: verified";
	}
	if (path === "outer-sandbox-runtime-incomplete") {
		return "[installed-review-lineage] installed evidence: runtime-incomplete; full supported-sandbox path: unverified (nested evidence boundary unavailable)";
	}
	return "[installed-review-lineage] installed evidence: unverified; full supported-sandbox path: unverified";
}

function installedNoOperationManifest() {
	return {
		schemaVersion: 2,
		behaviorMatrix: [{
			id: "installed-clean-review",
			behavior: "The fixture has no applicable external evidence operation.",
			kind: "boundary",
			input: "installed diff-file candidate",
			preconditions: "the fixture is intentionally self-contained",
			expected: "the runtime records the explicit non-applicability before semantic review",
			risk: "low",
			disposition: "not-applicable",
			providerIds: [],
			reason: "This fixture verifies installed lineage dispatch rather than a product gate.",
		}],
		providers: [],
		authorizations: [],
	};
}

function installedCandidatePatch(value: string): string {
	return [
		"diff --git a/review-me.txt b/review-me.txt",
		"--- a/review-me.txt",
		"+++ b/review-me.txt",
		"@@ -1 +1 @@",
		"-baseline",
		`+${value}`,
		"",
	].join("\n");
}

function lineCount(file: string): number {
	if (!existsSync(file)) return 0;
	return readFileSync(file, "utf8").split("\n").filter(Boolean).length;
}

function workflowStepEventCount(file: string, step: string): number {
	if (!existsSync(file)) return 0;
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { step?: string })
		.filter((event) => event.step === step)
		.length;
}
