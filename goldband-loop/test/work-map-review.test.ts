import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createManagedWorktree } from "../lib/managed-worktree";
import {
	readAndValidateAnalysisArtifact,
	recordAnalysisArtifact,
	recordVerification,
} from "../lib/verification-receipt";
import { getWorkflow } from "../workflows/registry";
import { runWorkflow } from "../workflows/runtime";
import { WorkMapStore } from "../workflows/work-map-store";
import {
	createCandidateBinding,
	reviewEvidenceManifestSchema,
	writeInitialReviewArtifact,
} from "../workflows/review-evidence";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Work Map review readback", () => {
	test("semantic-only artifact cannot complete an implemented Work Map ticket", () => {
		const { store } = fixture();
		const created = store.create(input(), "codex");
		const claimed = store.claimTicket({ workId: created.id, ticketId: "ticket-a",
			expectedRevision: created.revision, owner: "codex", leaseId: "lease-a" });
		const implemented = store.markImplemented({ workId: created.id, ticketId: "ticket-a",
			expectedRevision: claimed.revision, actor: "recorder",
			receipt: { id: "receipt-a", digest: "a".repeat(64), treeDigest: "b".repeat(64) } });
		const before = fs.readFileSync(store.mapPath(created.id), "utf8");
		const semantic = { schemaVersion: 1, phase: "semantic-only", evidenceStatus: "not-declared",
			completionAuthorized: false, findings: [], hostCallCount: 1, providerCallCount: 0 };
		expect(() => store.verifyTicket({ workId: created.id, ticketId: "ticket-a",
			expectedRevision: implemented.revision, actor: "review-readback", review: semantic as any }))
			.toThrow("review and verification receipt tree digests differ");
		expect(fs.readFileSync(store.mapPath(created.id), "utf8")).toBe(before);
	});

	test("requested changes return an implemented ticket to claimed", () => {
		const { store } = fixture();
		const created = store.create(input(), "codex");
		const claimed = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		const implemented = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: claimed.revision,
			actor: "recorder",
			receipt: {
				id: "receipt-a",
				digest: "a".repeat(64),
				treeDigest: "b".repeat(64),
			},
		});
		const changed = store.requestChanges({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: implemented.revision,
			actor: "review-readback",
			review: {
				id: "review-a",
				digest: "c".repeat(64),
				treeDigest: "b".repeat(64),
			},
		});
		expect(changed.tickets[0]?.status).toBe("claimed");
		expect(changed.tickets[0]?.evidence?.receipt).toBeUndefined();
		expect(changed.tickets[0]?.evidence?.requestedChanges?.id).toBe("review-a");
		expect(changed.tickets[0]?.claim?.attempt).toBe(2);
		const repaired = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: changed.revision,
			actor: "recorder",
			receipt: {
				id: "receipt-b",
				digest: "d".repeat(64),
				treeDigest: "e".repeat(64),
			},
		});
		expect(repaired.tickets[0]?.evidence?.requestedChanges).toEqual(
			changed.tickets[0]?.evidence?.requestedChanges,
		);
	});

	test("analysis-only artifact follows implemented, reviewed, and completed lifecycle", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		const manifest = writeNoopEvidenceManifest(state);
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "# Result\n\nEvidence.\n");
		recordAnalysisArtifact({
			cwd: repo,
			env: { ...process.env, GOLDBAND_HOME: state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const originalVerifyTicket = WorkMapStore.prototype.verifyTicket;
		let injectedRevisionRace = false;
		let artifactTransitionRevision: number | undefined;
		WorkMapStore.prototype.verifyTicket = function (request) {
			if (!injectedRevisionRace) {
				const current = this.read(request.workId);
				this.update(
					request.workId,
					current.revision,
					"concurrent-map-note",
					"other-actor",
					(map) => {
						map.destination = "Complete a reviewed analysis artifact safely";
						return map;
					},
				);
				injectedRevisionRace = true;
			}
			return originalVerifyTicket.call(this, request);
		};
		try {
			const result = await runWorkflow(getWorkflow("review/code"), {
				mode: "mock",
				host: "mock",
				workId: "work-a",
				ticketId: "ticket-a",
				cwd: repo,
				goldbandHome: state,
				evidenceManifestFile: manifest,
			});
			const initialArtifactFile = result.artifacts.find((file) => file.endsWith("-review-evidence.json"));
			const workMapArtifactFile = result.artifacts.find((file) => file.endsWith("-work-map-review.json"));
			expect(initialArtifactFile).toBeDefined();
			expect(workMapArtifactFile).toBeDefined();
			const initialArtifact = JSON.parse(fs.readFileSync(initialArtifactFile!, "utf8"));
			const workMapArtifact = JSON.parse(fs.readFileSync(workMapArtifactFile!, "utf8"));
			expect(workMapArtifact.mapRevision).toBe(initialArtifact.runtimeReceipt.reviewScope.mapRevision);
			expect(workMapArtifact.transitionRevision).toBeGreaterThan(workMapArtifact.mapRevision);
			artifactTransitionRevision = workMapArtifact.transitionRevision;
		} finally {
			WorkMapStore.prototype.verifyTicket = originalVerifyTicket;
		}
		expect(injectedRevisionRace).toBe(true);
		const completed = store.read("work-a");
		expect(artifactTransitionRevision).toBe(completed.revision);
		expect(completed.tickets[0]?.status).toBe("verified");
		expect(completed.tickets[0]?.evidence?.review?.artifactDigest).toBeDefined();
		expect(completed.status).toBe("completed");
	});

	test("review rejects an analysis artifact changed after the model pass", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "# Result\n\nEvidence.\n");
		recordAnalysisArtifact({
			cwd: repo,
			env: { ...process.env, GOLDBAND_HOME: state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const implemented = store.read("work-a");
		const analysis = readAndValidateAnalysisArtifact({
			store,
			map: implemented,
			ticket: implemented.tickets[0]!,
		});
		const restore = mutateOnThirdRead(() => {
			fs.writeFileSync(analysis.artifact.contentPath, "changed after review\n");
		});
		try {
			await expect(
				runWorkflow(getWorkflow("review/code"), {
					mode: "mock",
					host: "mock",
					workId: "work-a",
					ticketId: "ticket-a",
					cwd: repo,
					goldbandHome: state,
				}),
			).rejects.toThrow("analysis artifact content digest is stale");
		} finally {
			restore();
		}
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("review rejects a code candidate changed after the model pass", async () => {
		const { store, repo, state } = fixture();
		store.create(input(), "codex");
		const lease = createManagedWorktree({
			name: "review-race",
			repoRoot: repo,
			stateRoot: state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "reviewed\n");
		recordVerification({
			stage: "check",
			command: input().tickets[0]!.verificationCommand,
			cwd: lease.worktreePath,
		});
		const restore = mutateOnThirdRead(() => {
			fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "changed\n");
		});
		try {
			await expect(
				runWorkflow(getWorkflow("review/code"), {
					mode: "mock",
					host: "mock",
					workId: "work-a",
					ticketId: "ticket-a",
					cwd: lease.worktreePath,
					goldbandHome: state,
				}),
			).rejects.toThrow("review candidate changed after deterministic evidence collection");
		} finally {
			restore();
		}
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("deterministic evidence failure still binds and transitions the Work Map", async () => {
		const { store, repo, state } = fixture();
		store.create(input(), "codex");
		const lease = createManagedWorktree({
			name: "review-deterministic-failure",
			repoRoot: repo,
			stateRoot: state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "reviewed\n");
		recordVerification({
			stage: "check",
			command: input().tickets[0]!.verificationCommand,
			cwd: lease.worktreePath,
		});
		const evidenceManifest = path.join(state, "unsupported-evidence.json");
		fs.writeFileSync(evidenceManifest, `${JSON.stringify({
			schemaVersion: 2,
			behaviorMatrix: [{
				id: "device-proof",
				behavior: "Device proof is required.",
				kind: "boundary",
				input: "candidate",
				preconditions: "approved runner",
				expected: "device readback exists",
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
				reason: "No approved device runner exists.",
			}],
			providers: [],
			authorizations: [],
		})}\n`);

		const result = await runWorkflow(getWorkflow("review/code"), {
			mode: "mock",
			host: "mock",
			workId: "work-a",
			ticketId: "ticket-a",
			cwd: lease.worktreePath,
			goldbandHome: state,
			evidenceManifestFile: evidenceManifest,
		});

		expect(String(result.output)).toContain("Semantic host calls: 0.");
		const changed = store.read("work-a");
		expect(changed.tickets[0]?.status).toBe("claimed");
		expect(changed.tickets[0]?.evidence?.requestedChanges?.id).toBe(result.runId);
	});

	test("verified deterministic failure remains blocking after semantic normalization", async () => {
		const { store, repo, state } = fixture();
		store.create(input(), "codex");
		const lease = createManagedWorktree({
			name: "review-verified-failure",
			repoRoot: repo,
			stateRoot: state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "reviewed\n");
		recordVerification({
			stage: "check",
			command: input().tickets[0]!.verificationCommand,
			cwd: lease.worktreePath,
		});
		const evidenceManifest = path.join(state, "failing-evidence.json");
		fs.writeFileSync(evidenceManifest, `${JSON.stringify({
			schemaVersion: 2,
			behaviorMatrix: [{
				id: "candidate-gate",
				behavior: "Candidate gate must pass.",
				kind: "normal",
				input: "candidate",
				preconditions: "isolated runner",
				expected: "gate exits zero",
				risk: "high",
				disposition: "automated",
				providerIds: ["candidate-gate-provider"],
			}],
			providers: [{
				id: "candidate-gate-provider",
				owner: "work-map-review.test.ts",
				kind: "static",
				lifecycle: "persistent",
				cellIds: ["candidate-gate"],
				applicability: { kind: "global", reason: "Explicit Work Map test fixture." },
				executionContext: { sandboxOwner: "review-runtime", runner: "sealed" },
				operations: [{
					id: "fail",
					target: "candidate",
					argv: ["false"],
					expectedExit: "zero",
					timeoutMs: 1000,
					maxOutputBytes: 1024,
					network: "deny",
					evidenceLevel: "fixture",
				}],
			}],
			authorizations: [],
		})}\n`);

		const result = await runWorkflow(getWorkflow("review/code"), {
			mode: "mock",
			host: "mock",
			workId: "work-a",
			ticketId: "ticket-a",
			cwd: lease.worktreePath,
			goldbandHome: state,
			evidenceManifestFile: evidenceManifest,
		});

		const reviewArtifactPath = result.artifacts.find((file) =>
			file.endsWith("-work-map-review.json"));
		expect(reviewArtifactPath).toBeDefined();
		const reviewArtifact = JSON.parse(fs.readFileSync(reviewArtifactPath!, "utf8"));
		expect(reviewArtifact.findings).toContainEqual(expect.objectContaining({
			classification: "verified-failure",
			category: "deterministic-evidence",
			blocking: true,
		}));
		const changed = store.read("work-a");
		expect(changed.tickets[0]?.status).toBe("claimed");
		expect(changed.tickets[0]?.evidence?.requestedChanges?.id).toBe(result.runId);
	});

	test("high semantic concern deterministically requests Work Map changes", async () => {
		const { store, repo, state } = fixture();
		store.create(input(), "codex");
		const lease = createManagedWorktree({
			name: "review-high-semantic",
			repoRoot: repo,
			stateRoot: state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(
			path.join(lease.worktreePath, "candidate.txt"),
			"GOLDBAND_HIGH_SEMANTIC_FIXTURE\n",
		);
		recordVerification({
			stage: "check",
			command: input().tickets[0]!.verificationCommand,
			cwd: lease.worktreePath,
		});
		const result = await runWorkflow(getWorkflow("review/code"), {
			mode: "mock",
			host: "mock",
			workId: "work-a",
			ticketId: "ticket-a",
			cwd: lease.worktreePath,
			goldbandHome: state,
			evidenceManifestFile: writeNoopEvidenceManifest(state),
		});
		const reviewArtifactPath = result.artifacts.find((file) =>
			file.endsWith("-work-map-review.json"));
		expect(reviewArtifactPath).toBeDefined();
		const reviewArtifact = JSON.parse(fs.readFileSync(reviewArtifactPath!, "utf8"));
		expect(reviewArtifact.findings).toContainEqual(expect.objectContaining({
			severity: "high",
			classification: "semantic-concern",
			blocking: true,
		}));
		const changed = store.read("work-a");
		expect(changed.tickets[0]?.status).toBe("claimed");
		expect(changed.tickets[0]?.evidence?.requestedChanges?.id).toBe(result.runId);
	});

	test("closure cannot replay a signed artifact from a prior claim attempt", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		const manifest = writeNoopEvidenceManifest(state);
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "attempt-one\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		const firstArtifact = issueMockWorkMapInitialReview({
			store, repo, state, manifestFile: manifest, runId: "review-attempt-one",
		});

		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "attempt-two\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		issueMockWorkMapInitialReview({
			store, repo, state, manifestFile: manifest, runId: "review-attempt-two",
		});
		expect(store.read("work-a").tickets[0]?.evidence?.requestedChanges?.id).toBe("review-attempt-two");

		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "attempt-three\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		await expect(runWorkflow(getWorkflow("review/code"), {
			mode: "mock",
			host: "mock",
			workId: "work-a",
			ticketId: "ticket-a",
			cwd: repo,
			goldbandHome: state,
			evidenceManifestFile: manifest,
			closureArtifactFile: firstArtifact,
		})).rejects.toThrow("does not authorize the current Work Map repair attempt");
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("closure rejects a caller-downgraded evidence disposition before execution", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		const manifest = writeNoopEvidenceManifest(state);
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "GOLDBAND_HIGH_SEMANTIC_FIXTURE\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		const initial = await runWorkflow(getWorkflow("review/code"), {
			mode: "mock", host: "mock", workId: "work-a", ticketId: "ticket-a",
			cwd: repo, goldbandHome: state, evidenceManifestFile: manifest,
		});
		const initialArtifact = initial.artifacts.find((file) => file.endsWith("-review-evidence.json"));
		expect(initialArtifact).toBeDefined();
		expect(store.read("work-a").tickets[0]?.status).toBe("claimed");
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "after-repair\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		writeNoopEvidenceManifest(state, "unsupported");
		await expect(runWorkflow(getWorkflow("review/code"), {
			mode: "mock", host: "mock", workId: "work-a", ticketId: "ticket-a",
			cwd: repo, goldbandHome: state, evidenceManifestFile: manifest,
			closureArtifactFile: initialArtifact,
		})).rejects.toThrow("contract laundering blocked");
		const current = store.read("work-a");
		expect(current.tickets[0]?.status).toBe("implemented");
	});

	test("transition failure preserves the lineage-bound artifact and receipt", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		const manifest = writeNoopEvidenceManifest(state);
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "candidate\n");
		recordAnalysisArtifact({ cwd: repo, env: { ...process.env, GOLDBAND_HOME: state }, workId: "work-a", ticketId: "ticket-a", artifactPath: "reports/ticket-a.md" });
		const originalVerifyTicket = WorkMapStore.prototype.verifyTicket;
		WorkMapStore.prototype.verifyTicket = function () {
			throw new Error("forced transition failure");
		};
		try {
			await expect(runWorkflow(getWorkflow("review/code"), {
				mode: "mock", host: "mock", workId: "work-a", ticketId: "ticket-a",
				cwd: repo, goldbandHome: state, evidenceManifestFile: manifest,
			})).rejects.toThrow("forced transition failure");
		} finally {
			WorkMapStore.prototype.verifyTicket = originalVerifyTicket;
		}
		const artifactRoot = path.join(state, "workflow-runs", "artifacts");
		expect(fs.existsSync(artifactRoot)
			? fs.readdirSync(artifactRoot).some((file) => file.endsWith("-review-evidence.json"))
			: false).toBe(true);
		const receiptRoot = path.join(state, "workflow-runs", "mock-review-receipts");
		expect(fs.existsSync(receiptRoot)
			? fs.readdirSync(receiptRoot).some((file) => file.endsWith(".json"))
			: false).toBe(true);
		expect(fs.existsSync(path.join(receiptRoot, "review-lineages"))).toBe(true);
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("a post-commit transition error preserves artifacts after authoritative readback", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		const manifest = writeNoopEvidenceManifest(state, "unsupported");
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "candidate\n");
		recordAnalysisArtifact({
			cwd: repo,
			env: { ...process.env, GOLDBAND_HOME: state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const originalRequestChanges = WorkMapStore.prototype.requestChanges;
		WorkMapStore.prototype.requestChanges = function (request) {
			originalRequestChanges.call(this, request);
			throw new Error("simulated error after durable transition");
		};
		let result;
		try {
			result = await runWorkflow(getWorkflow("review/code"), {
				mode: "mock",
				host: "mock",
				workId: "work-a",
				ticketId: "ticket-a",
				cwd: repo,
				goldbandHome: state,
				evidenceManifestFile: manifest,
			});
		} finally {
			WorkMapStore.prototype.requestChanges = originalRequestChanges;
		}
		const current = store.read("work-a");
		expect(current.tickets[0]?.status).toBe("claimed");
		expect(current.tickets[0]?.evidence?.requestedChanges?.id).toBe(result!.runId);
		expect(result!.artifacts.some((file) => file.endsWith("-work-map-review.json"))).toBe(true);
		expect(result!.artifacts.some((file) => file.endsWith("-review-evidence.json"))).toBe(true);
	});
});

function issueMockWorkMapInitialReview(input: {
	store: WorkMapStore;
	repo: string;
	state: string;
	manifestFile: string;
	runId: string;
	injectRevisionRace?: boolean;
}): string {
	const map = input.store.read("work-a");
	const ticket = map.tickets[0]!;
	const subject = ticket.evidence?.analysis;
	if (ticket.status !== "implemented" || !ticket.claim || !subject) {
		throw new Error("fixture requires an implemented analysis ticket");
	}
	const content = fs.readFileSync(path.join(input.repo, "reports", "ticket-a.md"), "utf8");
	const diff = [
		"ANALYSIS_ARTIFACT_START reports/ticket-a.md",
		content,
		"ANALYSIS_ARTIFACT_END",
	].join("\n");
	const manifest = reviewEvidenceManifestSchema.validate(
		JSON.parse(fs.readFileSync(input.manifestFile, "utf8")),
	);
	const binding = createCandidateBinding(input.repo, {
		source: "work-map-runtime-owned-candidate",
		diff,
		changedFiles: ["reports/ticket-a.md"],
	}, manifest);
	const evidence = {
		schemaVersion: 1 as const,
		manifest,
		binding,
		records: [],
		completeness: {
			complete: true,
			hostEligible: true,
			blockingCellIds: [],
			coverageGapCellIds: [],
			runtimeIncompleteCellIds: [],
		},
		manifestSource: input.manifestFile,
	};
	const findings = [{
		id: "F-001",
		file: "reports/ticket-a.md",
		line: 1,
		severity: "high" as const,
		summary: "The current analysis needs a scoped repair.",
		evidence: "fixture evidence",
		failureScenario: "The unresolved case remains incorrect.",
		recommendation: "Repair the scoped case.",
		blocking: true,
		classification: "semantic-concern" as const,
		behaviorCellIds: ["candidate-behavior"],
	}];
	const analysisRoot = path.join(path.dirname(input.store.mapPath(map.id)), "analysis");
	const initialFile = path.join(analysisRoot, `${input.runId}-review-evidence.json`);
	writeInitialReviewArtifact(initialFile, {
		schemaVersion: 1,
		phase: "initial",
		runId: input.runId,
		binding,
		diff,
		evidence,
		findings,
		hostCallCount: 1,
		createdAt: new Date().toISOString(),
	}, {
		runId: input.runId,
		workflow: getWorkflow("review/code"),
		cwd: input.repo,
		options: { mode: "mock", goldbandHome: input.state },
		artifacts: [],
	}, {
		kind: "work-map",
		workId: map.id,
		ticketId: ticket.id,
		mapRevision: map.revision,
		claimAttempt: ticket.claim.attempt,
		subjectDigest: subject.digest,
	});
	const transitionMap = input.injectRevisionRace
		? input.store.update(
			map.id,
			map.revision,
			"fixture-concurrent-map-note",
			"other-actor",
			(current) => current,
		)
		: map;
	const workMapArtifact = {
		schemaVersion: 2,
		id: input.runId,
		workId: map.id,
		ticketId: ticket.id,
		mapRevision: map.revision,
		transitionRevision: transitionMap.revision + 1,
		ticketDigest: ticket.claim.ticketContractDigest,
		analysisDigest: subject.digest,
		reviewedDiffDigest: sha256(diff),
		candidateDigest: binding.candidateDigest,
		artifactDigest: subject.artifactDigest,
		findings,
		evidenceRecords: [],
		evidenceChain: {
			behaviorContractDigest: binding.behaviorContractDigest,
			candidateDigest: binding.candidateDigest,
			scopeDigest: binding.scopeDigest,
			completeness: evidence.completeness,
			recordsDigest: sha256("[]"),
			hostCallCount: 1,
			phase: "initial",
		},
		createdAt: new Date().toISOString(),
	};
	fs.writeFileSync(
		path.join(analysisRoot, `${input.runId}-work-map-review.json`),
		`${JSON.stringify(workMapArtifact, null, 2)}\n`,
	);
	input.store.requestChanges({
		workId: map.id,
		ticketId: ticket.id,
		expectedRevision: transitionMap.revision,
		actor: "fixture-review",
		review: {
			id: input.runId,
			digest: sha256(JSON.stringify(workMapArtifact)),
			artifactDigest: subject.artifactDigest,
		},
	});
	return initialFile;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function writeNoopEvidenceManifest(
	state: string,
	disposition: "not-applicable" | "unsupported" = "not-applicable",
): string {
	const file = path.join(state, "noop-evidence.json");
	fs.mkdirSync(state, { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify({
		schemaVersion: 2,
		behaviorMatrix: [{
			id: "candidate-behavior",
			behavior: "The candidate behavior is reviewed.",
			kind: "normal",
			input: "candidate",
			preconditions: "candidate exists",
			expected: "review completes",
			risk: "high",
			disposition,
			providerIds: [],
			reason: disposition === "unsupported"
				? "No authorized runner is available."
				: "This lifecycle fixture exercises Work Map binding, not candidate behavior.",
		}],
		providers: [],
		authorizations: [],
	}, null, 2)}\n`);
	return file;
}

function mutateOnThirdRead(mutate: () => void): () => void {
	const original = WorkMapStore.prototype.read;
	let reads = 0;
	WorkMapStore.prototype.read = function (workId) {
		const map = original.call(this, workId);
		reads += 1;
		if (reads === 3) mutate();
		return map;
	};
	return () => {
		WorkMapStore.prototype.read = original;
	};
}

function fixture(): { store: WorkMapStore; repo: string; state: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-review-"));
	roots.push(root);
	const repo = path.join(root, "repo");
	fs.mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.name", "Goldband Test"]);
	git(repo, ["config", "user.email", "goldband@example.invalid"]);
	fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
	git(repo, ["add", "file.txt"]);
	git(repo, ["commit", "-m", "initial"]);
	const state = path.join(root, "state");
	const store = new WorkMapStore({
		cwd: repo,
		goldbandHome: state,
		idFactory: () => "work-a",
	});
	return { store, repo, state };
}

function input() {
	return {
		mode: "bounded" as const,
		destination: "Read back review evidence",
		scope: { included: ["ticket-a"], excluded: ["tracker"] },
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Review ticket",
				delivers: "Review readback",
				blockedBy: [],
				acceptanceCriteria: ["Review is bound"],
				verificationMode: "existing-tests" as const,
				verificationCommand: [process.execPath, "-e", "process.exit(0)"],
				testSeams: ["unit"],
				status: "ready" as const,
			},
		],
	};
}

function analysisInput() {
	return {
		...input(),
		destination: "Complete a reviewed analysis artifact",
		tickets: [
			{
				...input().tickets[0],
				verificationMode: "analysis-only" as const,
				verificationCommand: undefined,
				analysisArtifact: "reports/ticket-a.md",
				testSeams: [],
			},
		],
	};
}

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
