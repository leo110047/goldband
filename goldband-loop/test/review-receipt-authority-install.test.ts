import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evidenceChildProcessEnvironment,
	evidenceTemporaryDirectory,
} from "../lib/evidence-runtime-contract.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("review receipt authority provisioning", () => {
	test("uses only the runtime-owned temp root inside an evidence sandbox", () => {
		expect(evidenceTemporaryDirectory({
			GOLDBAND_EVIDENCE_SANDBOX_ACTIVE: "1",
			GOLDBAND_EVIDENCE_TEMP_ROOT: "/private/tmp/runtime-owned",
			TMPDIR: "/tmp",
		})).toBe("/private/tmp/runtime-owned");
		expect(() => evidenceTemporaryDirectory({
			GOLDBAND_EVIDENCE_SANDBOX_ACTIVE: "1",
			TMPDIR: "/tmp",
		})).toThrow("active evidence sandbox requires an absolute runtime-owned temp root");
		expect(evidenceTemporaryDirectory({ TMPDIR: "/tmp" })).toBeUndefined();
	});

	test("provisions Claude-compatible authority and preserves its key across reinstall", () => {
		const root = mkdtempSync(join(tmpdir(), "review-receipt-authority-"));
		roots.push(root);
		const runtimeRoot = join(root, "claude", "skills", "goldband");
		const authorityRoot = join(root, "state", "review-authority", "claude");
		const script = join(import.meta.dir, "..", "scripts", "provision-review-receipt-authority.ts");
		const run = () => spawnSync(process.execPath, [
			script,
			"--runtime-root", runtimeRoot,
			"--authority-root", authorityRoot,
		], { encoding: "utf8" });
		const first = run();
		expect(first.status).toBe(0);
		const keyFile = join(authorityRoot, "review-receipt.key");
		const firstKey = readFileSync(keyFile, "utf8");
		expect(firstKey).toMatch(/^[a-f0-9]{64}\n$/);
		expect(statSync(keyFile).mode & 0o077).toBe(0);

		const second = run();
		expect(second.status).toBe(0);
		expect(readFileSync(keyFile, "utf8")).toBe(firstKey);
		const config = JSON.parse(readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"));
		expect(config).toMatchObject({
			schemaVersion: 2,
			reviewHostEvidenceLane: "macos-review-contract-host",
			reviewReceiptAuthorityRoot: authorityRoot,
			reviewReceiptKeyFile: keyFile,
			reviewReceiptStore: join(authorityRoot, "review-receipts"),
		});
	});

	test.each(["linked", "bundled"])("Claude-installed %s shell launcher preserves authority and plan boundaries", (installation) => {
		const root = mkdtempSync(join(tmpdir(), "review-receipt-claude-launcher-"));
		roots.push(root);
		const sourceRoot = join(import.meta.dir, "..");
		const runtimeRoot = join(root, "claude", "skills", "goldband");
		const authorityRoot = join(root, "state", "review-authority", "claude");
		const provision = spawnSync(process.execPath, [
			join(sourceRoot, "scripts", "provision-review-receipt-authority.ts"),
			"--runtime-root", runtimeRoot,
			"--authority-root", authorityRoot,
		], { encoding: "utf8" });
		expect(provision.status, provision.stderr).toBe(0);
		cpSync(join(sourceRoot, "bin"), join(runtimeRoot, "bin"), { recursive: true });
		if (installation === "bundled") {
			const bundle = spawnSync(process.execPath, ["build", join(sourceRoot, "bin/goldband.ts"), "--target", "bun", "--outfile", join(runtimeRoot, "bin/goldband.ts")], { encoding: "utf8" });
			expect(bundle.status, bundle.stderr).toBe(0);
		} else {
			symlinkSync(join(sourceRoot, "lib"), join(runtimeRoot, "lib"), "dir");
		}
		writeFileSync(join(runtimeRoot, ".installed-source"), `${sourceRoot}\n`);
		const inputFile = join(root, "plan.json");
		writeFileSync(inputFile, "{}");
		const plan = spawnSync("bash", [join(runtimeRoot, "bin/goldband"), "plan", "create", "--input", inputFile, "--host", "claude"], { encoding: "utf8" });
		expect(plan.status).not.toBe(0);
		expect(plan.stderr).toContain("installed Work Map runtime unavailable");

		const repo = join(root, "repo");
		const stateRoot = join(root, "workflow-state");
		mkdirSync(repo);
		expect(spawnSync("git", ["init"], { cwd: repo }).status).toBe(0);
		const unsupportedManifest = {
			schemaVersion: 2,
			behaviorMatrix: [{
				id: "unsupported-runtime",
				behavior: "The unavailable integration is disclosed.",
				kind: "boundary",
				input: "candidate",
				preconditions: "external runner",
				expected: "live readback exists",
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
				reason: "No authorized external runner exists in this fixture.",
			}],
			providers: [],
			authorizations: [],
		};
		const unrelatedProvider = {
			id: "unrelated-gate", owner: "fixture", kind: "static", lifecycle: "persistent",
			cellIds: ["unrelated-static"],
			applicability: { kind: "paths", pathPrefixes: ["unrelated"] },
			executionContext: { sandboxOwner: "review-runtime", runner: "sealed" },
			operations: [{ id: "pass", target: "candidate", argv: ["true"], expectedExit: "zero",
				timeoutMs: 1000, maxOutputBytes: 1024, network: "deny", evidenceLevel: "fixture",
				requiredSystemTools: ["true"] }],
		};
		unsupportedManifest.providers.push(unrelatedProvider);
		unsupportedManifest.behaviorMatrix.push(
			{ ...unsupportedManifest.behaviorMatrix[0], id: "unrelated-manual",
				behavior: "The unrelated manual boundary is checked.", disposition: "manual" },
			{ ...unsupportedManifest.behaviorMatrix[0], id: "unrelated-static",
				behavior: "The unrelated static boundary is checked.", disposition: "static",
				providerIds: ["unrelated-gate"], reason: undefined },
		);
			writeFileSync(join(repo, "goldband.review-evidence.json"), `${JSON.stringify(unsupportedManifest)}\n`);
			expect(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repo }).status).toBe(0);
			expect(spawnSync("git", ["config", "user.name", "Goldband Test"], { cwd: repo }).status).toBe(0);
			expect(spawnSync("git", ["add", "goldband.review-evidence.json"], { cwd: repo }).status).toBe(0);
			expect(spawnSync("git", ["commit", "-m", "add review contract"], { cwd: repo }).status).toBe(0);
			writeFileSync(join(repo, "candidate.txt"), "review me\n");
		const reviewArgs = [
			join(runtimeRoot, "bin", "goldband"),
			"review", "code", "--host", "claude",
		];
		const reviewOptions = {
			cwd: repo,
			encoding: "utf8" as const,
			env: {
				...process.env,
				...evidenceChildProcessEnvironment(process.env),
				GOLDBAND_HOME: stateRoot,
			},
		};
		const review = spawnSync("bash", reviewArgs, reviewOptions);
		expect(review.status, review.stderr).toBe(0);
		expect(review.stdout).toContain("Semantic host calls: 0.");
		const result = JSON.parse(review.stdout) as { artifacts: string[] };
		const artifactPath = result.artifacts.find((file) =>
			file.endsWith("-review-evidence.json"));
		expect(artifactPath).toBeDefined();
		const artifact = JSON.parse(readFileSync(artifactPath!, "utf8"));
		expect(artifact.runtimeReceipt.signature).toMatch(/^[a-f0-9]{64}$/);
		expect(readFileSync(
			join(authorityRoot, "review-receipts", `${artifact.runtimeReceipt.id}.json`),
			"utf8",
		)).toContain(`"runId": "${artifact.runId}"`);
		if (process.platform !== "darwin") return;

		const fakeBin = join(root, "bin");
		const hostCalls = join(root, "claude-host-calls.log");
		mkdirSync(fakeBin);
		const fakeClaude = join(fakeBin, "claude");
		writeFileSync(fakeClaude, [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'if [ "${1:-}" = "auth" ]; then',
			'  printf \'%s\\n\' \'{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}\'',
			"  exit 0",
			"fi",
			'printf "%s\\n" claude >> "$GOLDBAND_TEST_HOST_CALL_LOG"',
			"prompt=\"$(cat)\"",
			"if printf '%s' \"$prompt\" | grep -q CLOSURE_INPUT_START; then",
			"printf '%s\\n' '{\"result\":\"{\\\"results\\\":[{\\\"findingId\\\":\\\"S-001\\\",\\\"status\\\":\\\"closed\\\",\\\"summary\\\":\\\"repair verified\\\",\\\"evidenceIds\\\":[\\\"claude-repair-gate:candidate-green\\\"]}],\\\"contractReview\\\":{\\\"preserved\\\":true,\\\"summary\\\":\\\"Fixture review confirms unsupported coverage was replaced with the declared static check.\\\"}}\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}'",
			"else",
			"printf '%s\\n' '{\"result\":\"{\\\"findings\\\":[{\\\"id\\\":\\\"F-001\\\",\\\"file\\\":\\\"candidate.txt\\\",\\\"line\\\":1,\\\"severity\\\":\\\"medium\\\",\\\"summary\\\":\\\"fixture concern\\\",\\\"evidence\\\":\\\"fixture semantic observation\\\",\\\"failureScenario\\\":\\\"fixture path\\\",\\\"suggestedVerification\\\":\\\"rerun gate\\\",\\\"classification\\\":\\\"semantic-concern\\\",\\\"blocking\\\":false,\\\"evidenceIds\\\":[\\\"claude-repair-gate:candidate-green\\\"],\\\"behaviorCellIds\\\":[\\\"unsupported-runtime\\\"]}],\\\"contractReview\\\":{\\\"preserved\\\":true,\\\"summary\\\":\\\"Fixture review confirms unsupported coverage was replaced with the declared static check.\\\"}}\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}'",
			"fi",
		].join("\n"));
		chmodSync(fakeClaude, 0o755);
		const repairedManifest = structuredClone(unsupportedManifest);
		repairedManifest.behaviorMatrix[0] = {
			...repairedManifest.behaviorMatrix[0],
			disposition: "static",
			providerIds: ["claude-repair-gate"],
			reason: undefined,
		};
		repairedManifest.providers = [{
			id: "claude-repair-gate",
			owner: "review-receipt-authority-install.test.ts",
			kind: "static",
			lifecycle: "persistent",
			cellIds: ["unsupported-runtime"],
			applicability: { kind: "global", reason: "Explicit Claude recovery fixture." },
			executionContext: { sandboxOwner: "review-runtime", runner: "sealed" },
			operations: [{
				id: "candidate-green",
				target: "candidate",
				argv: ["true"],
				expectedExit: "zero",
				timeoutMs: 1000,
				maxOutputBytes: 1024,
				network: "deny",
				evidenceLevel: "fixture",
				requiredSystemTools: ["true"],
			}],
		}];
		repairedManifest.behaviorMatrix[1].providerIds = ["unrelated-gate"];
		repairedManifest.providers.push({ ...unrelatedProvider, cellIds: ["unrelated-static", "unrelated-manual"] });
		const repairedManifestFile = join(root, "repaired-manifest.json");
		writeFileSync(repairedManifestFile, `${JSON.stringify(repairedManifest)}\n`);
		writeFileSync(join(repo, "candidate.txt"), "review repaired\n");
		const repaired = spawnSync("bash", [
			...reviewArgs,
			"--evidence-manifest", repairedManifestFile,
			"--closure-artifact", artifactPath!,
		], {
			...reviewOptions,
			env: {
				...reviewOptions.env,
				PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
				GOLDBAND_TEST_HOST_CALL_LOG: hostCalls,
			},
		});
		expect(repaired.status, repaired.stderr).toBe(0);
		expect(repaired.stdout).toContain("Phase: evidence-repair.");
		expect(repaired.stdout).toContain("Semantic host calls: 1.");
		const repairedResult = JSON.parse(repaired.stdout) as { artifacts: string[] };
		const repairedArtifactPath = repairedResult.artifacts.find((file) =>
			file.endsWith("-review-evidence.json"))!;
		const repairedArtifact = JSON.parse(readFileSync(repairedArtifactPath, "utf8"));
		expect(repairedArtifact.predecessor).toMatchObject({
			transition: "evidence-repair",
			runId: artifact.runId,
			receiptId: artifact.runtimeReceipt.id,
			findingIds: ["D-001", "D-002"],
			affectedCellIds: ["unrelated-manual", "unrelated-static", "unsupported-runtime"],
		});
		expect(readFileSync(hostCalls, "utf8").trim()).toBe("claude");
		expect(repairedArtifact.evidence.records.map((record) => record.id)).toEqual(["claude-repair-gate:candidate-green"]);
		expect(repairedArtifact.findings).toMatchObject([{ id: "S-001", classification: "semantic-concern" }]);
		writeFileSync(join(repo, "candidate.txt"), "semantic concern repaired\n");
		const closure = spawnSync("bash", [
			...reviewArgs, "--evidence-manifest", repairedManifestFile,
			"--closure-artifact", repairedArtifactPath,
		], {
			...reviewOptions,
			env: { ...reviewOptions.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
				GOLDBAND_TEST_HOST_CALL_LOG: hostCalls },
		});
		expect(closure.status, closure.stderr).toBe(0);
		expect(closure.stdout).toContain("Phase: closure.");
		expect(closure.stdout).toContain("[closed] S-001");
		expect(readFileSync(hostCalls, "utf8").trim().split("\n")).toEqual(["claude", "claude"]);

	}, 30_000);
});
