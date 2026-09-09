import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installCodexReviewLauncher } from "../scripts/install-codex-review-launcher";

const sourceRoot = resolve(import.meta.dir, "..");

describe("Codex review contract authoring install", () => {
	test("installed help, init, and validate remain discoverable and state free", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-contract-authoring-install-"));
		try {
			const trustedBin = join(fixture, "trusted-bin");
			const emptyHome = join(fixture, "empty-home");
			const runtimeRoot = join(fixture, "runtime");
			const repo = join(fixture, "repo");
			const nested = join(repo, "packages", "app");
			const stateRoot = join(fixture, "state-must-not-exist");
			mkdirSync(trustedBin, { recursive: true });
			mkdirSync(emptyHome, { recursive: true });
			mkdirSync(nested, { recursive: true });
			const fakeCodex = executable(join(trustedBin, "codex"));
			const fakeBrowser = executable(join(trustedBin, "browse"));
			const marker = installCodexReviewLauncher({
				sourceRoot,
				runtimeRoot,
				ruleFile: join(fixture, "rules", "goldband-workflows.rules"),
				markerFile: join(fixture, "skills", "goldband", ".workflow-launcher.json"),
				bunPath: process.execPath,
				codexPath: fakeCodex,
				browserPath: fakeBrowser,
				bundleBrowserServer: (_bun, _entry, outputDirectory) => {
					mkdirSync(outputDirectory, { recursive: true });
					writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
				},
			});
			expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
			const env = { ...process.env, HOME: emptyHome, GOLDBAND_HOME: stateRoot };
			const run = (cwd: string, args: string[]) => spawnSync(
				marker.argvPrefix[0],
				[marker.argvPrefix[1], "review", "contract", ...args],
				{ cwd, env, encoding: "utf8" },
			);

			const help = run(repo, ["help"]);
			expect(help.status, help.stderr).toBe(0);
			const installedRoot = realpathSync(runtimeRoot);
			expect(JSON.parse(help.stdout).assets).toEqual({
				guide: join(installedRoot, "review", "review-evidence-manifest.md"),
				example: join(installedRoot, "review", "examples", "minimal-local-gate.json"),
				schema: join(installedRoot, "review", "schemas", "review-evidence-manifest.schema.json"),
			});

			const inspected = run(nested, ["inspect"]);
			expect(inspected.status, inspected.stderr).toBe(0);
			expect(JSON.parse(inspected.stdout)).toMatchObject({
				configured: false,
				runtimeStore: { present: false, identity: expect.stringContaining("review-contracts/") },
			});
			expect(existsSync(stateRoot)).toBe(false);

			const initialized = run(nested, ["init"]);
			expect(initialized.status, initialized.stderr).toBe(0);
			const manifestFile = join(realpathSync(repo), "goldband.review-evidence.json");
			expect(JSON.parse(initialized.stdout)).toMatchObject({
				operation: "init",
				status: "blocking-scaffold",
				output: manifestFile,
				blockingCellIds: ["project-evidence-contract"],
			});
			expect(JSON.parse(readFileSync(manifestFile, "utf8")).behaviorMatrix[0]).toMatchObject({
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
			});

			const validated = run(repo, ["validate", "--manifest", manifestFile]);
			expect(validated.status, validated.stderr).toBe(0);
			expect(JSON.parse(validated.stdout)).toMatchObject({
				operation: "validate",
				valid: true,
				evidenceExecuted: false,
				completionAuthorized: false,
				behaviorCellIds: ["project-evidence-contract"],
				providerIds: [],
			});

			const duplicate = run(repo, ["init"]);
			expect(duplicate.status).not.toBe(0);
			expect(duplicate.stderr).toContain("refusing to overwrite existing review contract");
			expect(existsSync(stateRoot)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});

function executable(file: string): string {
	writeFileSync(file, "#!/usr/bin/env bash\nexit 0\n");
	chmodSync(file, 0o755);
	return file;
}
