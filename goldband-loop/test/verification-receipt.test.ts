import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createManagedWorktree } from "../lib/managed-worktree";
import {
	computeCandidateReviewDiff,
	materializeReviewUntrackedFile,
	readAndValidateAnalysisArtifact,
	readAndValidateVerificationReceipt,
	recordAnalysisArtifact,
	recordManualVerification,
	recordVerification,
} from "../lib/verification-receipt";
import type {
	VerificationMode,
	WorkMapCreateInput,
} from "../workflows/work-map";
import { WorkMapStore } from "../workflows/work-map-store";

const cleanup: string[] = [];

afterEach(() => {
	for (const root of cleanup.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("verification receipt", () => {
	test("records an argument-array check and advances only the bound ticket", () => {
		const command = [
			process.execPath,
			"-e",
			"if (process.argv[1] !== 'space and $meta') process.exit(9)",
			"space and $meta",
		];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "evidence",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
			claimOwner: "codex",
		});
		fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "candidate\n");
		const receipt = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		expect(receipt.records[0]?.command.at(-1)).toBe("space and $meta");
		expect(receipt.records[0]?.exitCode).toBe(0);
		const map = fixture.store.read("work-a");
		expect(map.tickets[0]?.status).toBe("implemented");
		expect(map.tickets[0]?.evidence?.receipt?.treeDigest).toBe(
			receipt.candidate.treeDigest,
		);
		expect(
			readAndValidateVerificationReceipt({
				lease,
				map,
				ticket: map.tickets[0]!,
			}).receipt.id,
		).toBe(receipt.id);
	});

	test("rejects environment spoofing and stale candidates", () => {
		const command = [process.execPath, "-e", "process.exit(0)"];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "spoof",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({
				stage: "check",
				command,
				cwd: lease.worktreePath,
				env: {
					...process.env,
					GOLDBAND_WORKTREE_LEASE_ID:
						"00000000-0000-4000-8000-000000000000",
				},
			}),
		).toThrow("environment lease does not match broker lease");

		const initialReceipt = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		fs.writeFileSync(path.join(lease.worktreePath, "after-check.txt"), "changed\n");
		const map = fixture.store.read("work-a");
		expect(() =>
			readAndValidateVerificationReceipt({
				lease,
				map,
				ticket: map.tickets[0]!,
			}),
		).toThrow("stale for the current candidate");
		const refreshedReceipt = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		expect(refreshedReceipt.candidate.treeDigest).not.toBe(
			initialReceipt.candidate.treeDigest,
		);
		const refreshedMap = fixture.store.read("work-a");
		expect(
			readAndValidateVerificationReceipt({
				lease,
				map: refreshedMap,
				ticket: refreshedMap.tickets[0]!,
			}).receipt.candidate.treeDigest,
		).toBe(refreshedReceipt.candidate.treeDigest);
	});

	test("enforces TDD RED signal, seam, ordering, and GREEN outcome", () => {
		const fixture = createFixture("tdd");
		const lease = createManagedWorktree({
			name: "tdd",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({
				stage: "green",
				seam: "unit seam",
				command: [process.execPath, "-e", "process.exit(0)"],
				cwd: lease.worktreePath,
			}),
		).toThrow("requires an earlier RED");
		expect(() =>
			recordVerification({
				stage: "red",
				seam: "unit seam",
				expectedSignal: "expected failure",
				command: [process.execPath, "-e", "process.exit(0)"],
				cwd: lease.worktreePath,
			}),
		).toThrow("unexpectedly succeeded");
		expect(() =>
			recordVerification({
				stage: "red",
				seam: "unit seam",
				expectedSignal: "expected failure",
				command: [
					process.execPath,
					"-e",
					"console.error('other failure'); process.exit(1)",
				],
				cwd: lease.worktreePath,
			}),
		).toThrow("missing the expected failure signal");
		recordVerification({
			stage: "red",
			seam: "unit seam",
			expectedSignal: "expected failure",
			command: [
				process.execPath,
				"-e",
				"console.error('expected failure'); process.exit(1)",
			],
			cwd: lease.worktreePath,
		});
		expect(() =>
			recordVerification({
				stage: "green",
				seam: "other seam",
				command: [process.execPath, "-e", "process.exit(0)"],
				cwd: lease.worktreePath,
			}),
		).toThrow("seam is not declared");
		recordVerification({
			stage: "green",
			seam: "unit seam",
			command: [process.execPath, "-e", "process.exit(0)"],
			cwd: lease.worktreePath,
		});
		const implemented = fixture.store.read("work-a");
		expect(implemented.tickets[0]?.status).toBe("implemented");
		const recorded = readAndValidateVerificationReceipt({
			lease,
			map: implemented,
			ticket: implemented.tickets[0]!,
		});
		const sameTimestamp = "2026-01-01T00:00:00.000Z";
		for (const record of recorded.receipt.records) record.startedAt = sameTimestamp;
		fs.writeFileSync(recorded.path, `${JSON.stringify(recorded.receipt, null, 2)}\n`);
		expect(
			readAndValidateVerificationReceipt({
				lease,
				map: implemented,
				ticket: implemented.tickets[0]!,
			}).receipt.records,
		).toHaveLength(2);
		recorded.receipt.records.reverse();
		fs.writeFileSync(recorded.path, `${JSON.stringify(recorded.receipt, null, 2)}\n`);
		expect(() =>
			readAndValidateVerificationReceipt({
				lease,
				map: implemented,
				ticket: implemented.tickets[0]!,
			}),
		).toThrow("requires ordered RED and GREEN");
	});

	test("fails explicitly on timeout and output cap without advancing", () => {
		const timeoutCommand = [
			process.execPath,
			"-e",
			"setTimeout(() => process.exit(0), 1000)",
		];
		const fixture = createFixture("existing-tests", timeoutCommand);
		const lease = createManagedWorktree({
			name: "bounded-command",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({
				stage: "check",
				command: timeoutCommand,
				cwd: lease.worktreePath,
				timeoutMs: 20,
			}),
		).toThrow("timed out");
		const outputCommand = [
			process.execPath,
			"-e",
			"process.stdout.write('x'.repeat(4096))",
		];
		const outputFixture = createFixture("existing-tests", outputCommand);
		const outputLease = createManagedWorktree({
			name: "bounded-output",
			repoRoot: outputFixture.repo,
			stateRoot: outputFixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({
				stage: "check",
				command: outputCommand,
				cwd: outputLease.worktreePath,
				outputLimitBytes: 32,
			}),
		).toThrow("output exceeds");
		expect(fixture.store.read("work-a").tickets[0]?.status).toBe("claimed");
	});

	test("analysis-only uses a named artifact lifecycle and rejects code worktrees", () => {
		const fixture = createFixture("analysis-only");
		fs.mkdirSync(path.join(fixture.repo, "reports"));
		fs.writeFileSync(path.join(fixture.repo, "reports", "ticket-a.md"), "analysis\n");
		const artifact = recordAnalysisArtifact({
			cwd: fixture.repo,
			env: { ...process.env, GOLDBAND_HOME: fixture.state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const map = fixture.store.read("work-a");
		expect(map.status).toBe("completed");
		expect(map.tickets[0]?.evidence?.review).toBeUndefined();
		expect(map.tickets[0]?.status).toBe("verified");
		expect(
			readAndValidateAnalysisArtifact({
				store: fixture.store,
				map,
				ticket: map.tickets[0]!,
			}).artifact.id,
		).toBe(artifact.id);
		expect(() =>
			createManagedWorktree({
				name: "analysis",
				repoRoot: fixture.repo,
				stateRoot: fixture.state,
				ticketId: "ticket-a",
			}),
		).toThrow();
	});

	test("legacy implemented analysis can finish by recording its artifact without review authority", () => {
		const fixture = createFixture("analysis-only");
		const map = fixture.store.read("work-a");
		const claimed = fixture.store.claimTicket({workId: map.id, ticketId: "ticket-a",
			expectedRevision: map.revision, owner: "analysis-recorder", leaseId: "legacy-analysis", kind: "analysis"});
		fixture.store.update(map.id, claimed.revision, "legacy-record", "fixture", value => {
			value.status = "verifying";
			value.tickets[0]!.status = "implemented";
			value.tickets[0]!.evidence = {analysis: {id: "legacy-artifact", digest: "a".repeat(64), artifactDigest: "b".repeat(64)}};
			return value;
		});
		fs.mkdirSync(path.join(fixture.repo, "reports"));
		fs.writeFileSync(path.join(fixture.repo, "reports", "ticket-a.md"), "current analysis\n");
		const artifact = recordAnalysisArtifact({cwd: fixture.repo,
			env: {...process.env, GOLDBAND_HOME: fixture.state}, workId: map.id,
			ticketId: "ticket-a", artifactPath: "reports/ticket-a.md"});
		const completed = fixture.store.read(map.id);
		expect(completed.status).toBe("completed");
		expect(completed.tickets[0]!.evidence?.analysis?.id).toBe(artifact.id);
		expect(completed.tickets[0]!.evidence?.review).toBeUndefined();
	});

	test("existing-tests rejects a successful command outside the planning contract", () => {
		const declared = [process.execPath, "-e", "process.exit(0)"];
		const fixture = createFixture("existing-tests", declared);
		const lease = createManagedWorktree({
			name: "wrong-command",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({
				stage: "check",
				command: [process.execPath, "-e", "process.exit(0); // different"],
				cwd: lease.worktreePath,
			}),
		).toThrow("does not match the ticket planning contract");
	});

	test("verification rejects shell interpreters before their side effect", () => {
		const marker = "shell-side-effect.txt";
		const command = ["/bin/sh", "-c", `printf leaked > ${marker}`];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "reject-shell",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		expect(() =>
			recordVerification({ stage: "check", command, cwd: lease.worktreePath }),
		).toThrow("cannot invoke a shell interpreter");
		expect(fs.existsSync(path.join(lease.worktreePath, marker))).toBe(false);
	});

	test("verification child receives a minimal environment without caller secrets", () => {
		const sensitiveKey = ["API", "TOKEN"].join("_");
		const sensitiveValue = ["super", "secret", "value"].join("-");
		const command = [
			process.execPath,
			"-e",
			`require('fs').writeFileSync('observed-env.txt', process.env[${JSON.stringify(sensitiveKey)}] || 'missing')`,
		];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "minimal-env",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
			env: { ...process.env, [sensitiveKey]: sensitiveValue },
		});
		expect(fs.readFileSync(path.join(lease.worktreePath, "observed-env.txt"), "utf8")).toBe(
			"missing",
		);
	});

	test("analysis artifacts reject secrets, binary data, and invalid UTF-8 before claiming", () => {
		const fixture = createFixture("analysis-only");
		const reports = path.join(fixture.repo, "reports");
		const report = path.join(reports, "ticket-a.md");
		fs.mkdirSync(reports);
		const sensitiveAssignment = `${["API", "TOKEN"].join("_")}=${["super", "secret", "value"].join("-")}\n`;
		for (const [content, message] of [
			[Buffer.from(sensitiveAssignment), "secret-like content"],
			[Buffer.from([0, 1, 2, 3]), "not binary content"],
			[Buffer.from([0xc3, 0x28]), "valid UTF-8"],
		] as const) {
			fs.writeFileSync(report, content);
			expect(() =>
				recordAnalysisArtifact({
					cwd: fixture.repo,
					env: { ...process.env, GOLDBAND_HOME: fixture.state },
					workId: "work-a",
					ticketId: "ticket-a",
					artifactPath: "reports/ticket-a.md",
				}),
			).toThrow(message);
			expect(fixture.store.read("work-a").tickets[0]?.status).toBe("ready");
		}
	});

	test("redacts secret-like summaries while retaining an output digest", () => {
		const sensitiveValues = [
			["API_TOKEN", "super-secret"].join("="),
			["sk", "abcdefghijklmnopqrstuv"].join("-"),
			["ghp", "abcdefghijklmnopqrstuv"].join("_"),
			["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
			[
				"eyJabcdefghijk",
				"abcdefghijkl",
				"mnopqrstuvwx",
			].join("."),
			["-----BEGIN ", "PRIVATE KEY-----\nkey-material\n-----END PRIVATE KEY-----"].join(""),
		];
		const encodedOutput = Buffer.from(sensitiveValues.join("\n")).toString("base64");
		const command = [
			process.execPath,
			"-e",
			"process.stdout.write(Buffer.from(process.argv[1], 'base64'))",
			encodedOutput,
		];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "redact",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		const receipt = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		expect(receipt.records[0]?.outputSummary).toContain("[REDACTED]");
		for (const value of sensitiveValues) {
			expect(receipt.records[0]?.outputSummary).not.toContain(value);
		}
		expect(receipt.records[0]?.outputDigest).toMatch(/^[a-f0-9]{64}$/);
	});

	test("manual verification persists only bounded redacted fields and digests", () => {
		const fixture = createFixture("manual");
		const lease = createManagedWorktree({
			name: "manual-redaction",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		const sensitiveValue = [["ghp", "abcdefghijklmnopqrstuv"].join("_")].join("");
		const receipt = recordManualVerification({
			cwd: lease.worktreePath,
			steps: [`inspect ${sensitiveValue}`],
			observableResult: `observed ${sensitiveValue}`,
			artifactReference: `artifact:${sensitiveValue}`,
		});
		const persisted = JSON.stringify(receipt);
		expect(persisted).not.toContain(sensitiveValue);
		expect(persisted).not.toContain(
			createHash("sha256").update(sensitiveValue).digest("hex"),
		);
		expect(persisted).toContain("[REDACTED]");
		expect(receipt.records[0]?.manualStepsDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(receipt.records[0]?.observableResultDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(receipt.records[0]?.artifactReferenceDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			recordManualVerification({
				cwd: lease.worktreePath,
				steps: ["x".repeat(1025)],
				observableResult: "observed",
				artifactReference: "artifact.txt",
			}),
		).toThrow("manual step exceeds 1024 byte limit");
	});

	test("canonical candidate diff skips secret-like and oversized untracked files", () => {
		const command = [process.execPath, "-e", "process.exit(0)"];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "bounded-review-diff",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(
			path.join(lease.worktreePath, "credentials.txt"),
			`${["API_TOKEN", "super-secret-value"].join("=")}\n`,
		);
		fs.writeFileSync(
			path.join(lease.worktreePath, "oversized.txt"),
			"x".repeat(128 * 1024 + 1),
		);
		fs.writeFileSync(
			path.join(lease.worktreePath, "control-bytes.bin"),
			Buffer.alloc(100, 1),
		);
		const diff = computeCandidateReviewDiff(lease);
		expect(diff).not.toContain("super-secret-value");
		expect(diff).toContain("secret-like content (credential-assignment)");
		expect(diff).toContain("file exceeds 131072 byte limit");
		expect(diff).toContain("diff --git a/control-bytes.bin b/control-bytes.bin");
		expect(diff).toContain("skipped untracked file: binary file");
		recordVerification({ stage: "check", command, cwd: lease.worktreePath });
		expect(fixture.store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("candidate identity and review diff include an untracked executable mode", () => {
		const command = [process.execPath, "-e", "process.exit(0)"];
		const fixture = createFixture("existing-tests", command);
		const lease = createManagedWorktree({
			name: "executable-mode",
			repoRoot: fixture.repo,
			stateRoot: fixture.state,
			ticketId: "ticket-a",
		});
		const script = path.join(lease.worktreePath, "candidate.sh");
		fs.writeFileSync(script, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
		const initial = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		expect(computeCandidateReviewDiff(lease)).toContain("new file mode 100644");
		fs.chmodSync(script, 0o755);
		const implemented = fixture.store.read("work-a");
		expect(() =>
			readAndValidateVerificationReceipt({
				lease,
				map: implemented,
				ticket: implemented.tickets[0]!,
			}),
		).toThrow("stale for the current candidate");
		const refreshed = recordVerification({
			stage: "check",
			command,
			cwd: lease.worktreePath,
		});
		expect(refreshed.candidate.treeDigest).not.toBe(initial.candidate.treeDigest);
		expect(computeCandidateReviewDiff(lease)).toContain("new file mode 100755");
	});

	test("the secret scanner can review its own implementation and tests", () => {
		const repoRoot = path.resolve(import.meta.dir, "..");
		const state = { includedBytes: 0 };
		const sourceDiff = materializeReviewUntrackedFile(
			repoRoot,
			fs.realpathSync(repoRoot),
			"lib/verification-receipt.ts",
			state,
		);
		const testDiff = materializeReviewUntrackedFile(
			repoRoot,
			fs.realpathSync(repoRoot),
			"test/verification-receipt.test.ts",
			state,
		);
		expect(sourceDiff).toContain("export function materializeReviewUntrackedFile");
		expect(testDiff).toContain("import { afterEach, describe, expect, test }");
		for (const diff of [sourceDiff, testDiff]) {
			expect(diff).not.toContain(
				"@@ -0,0 +1,1 @@\n+[[review/code skipped untracked file: secret-like content",
			);
		}
	});
});

function createFixture(mode: VerificationMode, verificationCommand?: string[]) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "goldband-verification-"));
	cleanup.push(root);
	const repo = path.join(root, "repo");
	const state = path.join(root, "state");
	fs.mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.name", "Goldband Test"]);
	git(repo, ["config", "user.email", "goldband@example.invalid"]);
	fs.writeFileSync(path.join(repo, "tracked.txt"), "base\n");
	git(repo, ["add", "tracked.txt"]);
	git(repo, ["commit", "-m", "initial"]);
	const store = new WorkMapStore({
		cwd: repo,
		goldbandHome: state,
		idFactory: () => "work-a",
	});
	store.create(input(mode, verificationCommand), "codex");
	return { root, repo, state, store };
}

function input(mode: VerificationMode, verificationCommand?: string[]): WorkMapCreateInput {
	return {
		mode: "bounded",
		destination: "Bind ticket verification evidence",
		scope: { included: ["ticket-a"], excluded: ["external tracker"] },
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Implement evidence binding",
				delivers: "A verified candidate",
				blockedBy: [],
				acceptanceCriteria: ["Receipt is bound"],
				verificationMode: mode,
				...(mode === "existing-tests" ? { verificationCommand } : {}),
				...(mode === "analysis-only"
					? { analysisArtifact: "reports/ticket-a.md" }
					: {}),
				testSeams: mode === "analysis-only" ? [] : ["unit seam"],
				status: "ready",
			},
		],
	};
}

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
}
