import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	isDirectoryLockContention,
	renderWorkMapMarkdown,
	WorkMapStore,
	type WorkMapTransactionStep,
} from "../workflows/work-map-store";
import type { WorkMapCreateInput } from "../workflows/work-map";
import { executeWorkMapLifecycle } from "../workflows/work-map-runtime";

const cleanup: string[] = [];

afterEach(() => {
	for (const path of cleanup.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("WorkMapStore", () => {
	test("classifies cross-platform directory rename contention", () => {
		for (const code of ["EEXIST", "ENOTEMPTY"]) {
			expect(
				isDirectoryLockContention(Object.assign(new Error(code), { code })),
			).toBe(true);
		}
		expect(
			isDirectoryLockContention(Object.assign(new Error("denied"), { code: "EPERM" })),
		).toBe(false);
		expect(isDirectoryLockContention(new Error("unknown"))).toBe(false);
	});

	test("owns claim, implementation, review, and integration transitions", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const claimed = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		expect(claimed.tickets[0]?.status).toBe("claimed");
		const receipt = {
			id: "receipt-a",
			digest: "a".repeat(64),
			treeDigest: "b".repeat(64),
		};
		const implemented = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: claimed.revision,
			actor: "recorder",
			receipt,
		});
		const verified = store.verifyTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: implemented.revision,
			actor: "review-readback",
			review: {
				id: "review-a",
				digest: "c".repeat(64),
				treeDigest: receipt.treeDigest,
			},
		});
		const integrated = store.markIntegrated({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: verified.revision,
			actor: "finish",
			commit: "d".repeat(40),
		});
		expect(integrated.status).toBe("completed");
		expect(integrated.tickets[0]?.integratedCommit).toBe("d".repeat(40));
		expect(store.events(created.id).map((event) => event.operation)).toEqual([
			"create",
			"claim-ticket",
			"mark-implemented",
			"verify-ticket",
			"integrate-ticket",
		]);
	});

	test("code dependency enters frontier only after its verified commit is integrated", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const plan = input();
		plan.tickets.push({
			...plan.tickets[0]!,
			id: "ticket-b",
			title: "Implement dependent candidate",
			blockedBy: ["ticket-a"],
		});
		const created = store.create(plan, "codex");
		const claimed = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		const receipt = {
			id: "receipt-a",
			digest: "a".repeat(64),
			treeDigest: "b".repeat(64),
		};
		const implemented = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: claimed.revision,
			actor: "recorder",
			receipt,
		});
		const verified = store.verifyTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: implemented.revision,
			actor: "review-readback",
			review: {
				id: "review-a",
				digest: "c".repeat(64),
				treeDigest: receipt.treeDigest,
			},
		});
		expect(verified.frontier).toEqual([]);
		const integrated = store.markIntegrated({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: verified.revision,
			actor: "finish",
			commit: "d".repeat(40),
		});
		expect(integrated.frontier).toEqual(["ticket-b"]);
	});

	test("runtime lifecycle owner blocks and cancels with durable readback", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		const blocked = executeWorkMapLifecycle(
			"block",
			{ workId: "work-a", ticketId: "ticket-a", reason: "waiting for evidence" },
			{ host: "codex", cwd: repo, goldbandHome: home },
		);
		expect(blocked.map.tickets[0]?.status).toBe("blocked");
		expect(store.events("work-a").at(-1)?.operation).toBe("block-ticket");
		const resumed = executeWorkMapLifecycle(
			"resume",
			{ workId: "work-a", ticketId: "ticket-a", reason: "" },
			{ host: "codex", cwd: repo, goldbandHome: home },
		);
		expect(resumed.map.tickets[0]?.status).toBe("claimed");
		expect(resumed.map.tickets[0]?.blockerReason).toBeUndefined();
		expect(store.events("work-a").at(-1)?.operation).toBe("resume-ticket");

		const second = createStore(repo, home, "work-b").create(input(), "claude");
		const cancelled = executeWorkMapLifecycle(
			"cancel",
			{ workId: second.id, ticketId: "ticket-a", reason: "scope removed" },
			{ host: "claude", cwd: repo, goldbandHome: home },
		);
		expect(cancelled.map.tickets[0]?.status).toBe("cancelled");
		expect(createStore(repo, home, "unused").events(second.id).at(-1)?.operation).toBe(
			"cancel-ticket",
		);
	});

	test("runtime lifecycle blocks a ready ticket and resumes it to the frontier", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const blocked = executeWorkMapLifecycle(
			"block",
			{ workId: created.id, ticketId: "ticket-a", reason: "waiting for access" },
			{ host: "codex", cwd: repo, goldbandHome: home },
		);
		expect(blocked.map.tickets[0]?.status).toBe("blocked");
		expect(blocked.map.tickets[0]?.claim).toBeUndefined();
		expect(blocked.map.tickets[0]?.blockedFrom).toBeUndefined();
		expect(blocked.map.frontier).toEqual([]);

		const resumed = executeWorkMapLifecycle(
			"resume",
			{ workId: created.id, ticketId: "ticket-a", reason: "" },
			{ host: "codex", cwd: repo, goldbandHome: home },
		);
		expect(resumed.map.tickets[0]?.status).toBe("ready");
		expect(resumed.map.frontier).toEqual(["ticket-a"]);
	});

	test("mixed analysis and code work completes after the code commit integrates", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const plan = input();
		plan.tickets[0] = {
			...plan.tickets[0]!,
			verificationMode: "analysis-only",
			verificationCommand: undefined,
			analysisArtifact: "reports/analysis.md",
			testSeams: [],
		};
		plan.tickets.push({
			...input().tickets[0]!,
			id: "ticket-b",
			title: "Integrate the analysis result",
			blockedBy: ["ticket-a"],
		});
		const created = store.create(plan, "codex");
		const claimedAnalysis = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "analysis-a",
			kind: "analysis",
		});
		const analysisDigest = "a".repeat(64);
		const implementedAnalysis = store.markAnalysisImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: claimedAnalysis.revision,
			actor: "analysis-recorder",
			analysis: { id: "analysis-a", digest: "b".repeat(64), artifactDigest: analysisDigest },
		});
		const verifiedAnalysis = store.verifyTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: implementedAnalysis.revision,
			actor: "review-readback",
			review: { id: "review-a", digest: "c".repeat(64), artifactDigest: analysisDigest },
		});
		expect(verifiedAnalysis.frontier).toEqual(["ticket-b"]);
		const claimedCode = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-b",
			expectedRevision: verifiedAnalysis.revision,
			owner: "codex",
			leaseId: "lease-b",
		});
		const receipt = { id: "receipt-b", digest: "d".repeat(64), treeDigest: "e".repeat(64) };
		const implementedCode = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-b",
			expectedRevision: claimedCode.revision,
			actor: "recorder",
			receipt,
		});
		const verifiedCode = store.verifyTicket({
			workId: created.id,
			ticketId: "ticket-b",
			expectedRevision: implementedCode.revision,
			actor: "review-readback",
			review: { id: "review-b", digest: "f".repeat(64), treeDigest: receipt.treeDigest },
		});
		const completed = store.markIntegrated({
			workId: created.id,
			ticketId: "ticket-b",
			expectedRevision: verifiedCode.revision,
			actor: "finish",
			commit: "1".repeat(40),
		});
		expect(completed.status).toBe("completed");
	});

	test("rejects non-frontier and stale claims", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(() =>
			store.claimTicket({
				workId: created.id,
				ticketId: "missing",
				expectedRevision: created.revision,
				owner: "codex",
				leaseId: "lease-a",
			}),
		).toThrow("not in the current Work Map frontier");
		store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		expect(() =>
			store.claimTicket({
				workId: created.id,
				ticketId: "ticket-a",
				expectedRevision: created.revision,
				owner: "codex",
				leaseId: "lease-b",
			}),
		).toThrow("stale Work Map revision");
	});

	test("create/read round trip writes event and active pointer", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(store.read(created.id)).toEqual(created);
		expect(store.readActive()).toEqual(created);
		expect(store.events(created.id)).toEqual([
			expect.objectContaining({
				operation: "create",
				beforeRevision: null,
				afterRevision: 1,
				actor: "codex",
			}),
		]);
	});

	test("atomic update increments revision and rejects stale concurrency", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const updated = store.update(
			created.id,
			1,
			"block",
			"codex",
			(map) => ({ ...map, status: "blocked" }),
		);
		expect(updated.revision).toBe(2);
		expect(updated.status).toBe("blocked");
		expect(() =>
			store.update(created.id, 1, "stale", "codex", (map) => map),
		).toThrow("stale Work Map revision");
		expect(store.read(created.id)).toEqual(updated);
	});

	test("generic update rejects ticket additions and removals", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(() =>
			store.update(created.id, 1, "add-ticket", "codex", (map) => ({
				...map,
				tickets: [
					...map.tickets,
					{
						...map.tickets[0],
						id: "ticket-b",
						title: "Implement ticket-b",
					},
				],
			})),
		).toThrow("ticket set cannot change during update: added ticket-b");
		expect(() =>
			store.update(created.id, 1, "remove-ticket", "codex", (map) => ({
				...map,
				tickets: [],
			})),
		).toThrow("ticket set cannot change during update: removed ticket-a");
		expect(store.read(created.id)).toEqual(created);
	});

	test("invalid event metadata cannot commit a revision", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const mapBefore = readFileSync(store.mapPath(created.id));
		const markdownBefore = readFileSync(store.markdownPath(created.id));
		const eventsBefore = readFileSync(store.eventsPath(created.id));

		expect(() =>
			store.update(created.id, 1, "", "codex", (map) => ({
				...map,
				status: "blocked",
			})),
		).toThrow("operation must be a non-empty string");
		expect(() =>
			store.update(created.id, 1, "block", "", (map) => ({
				...map,
				status: "blocked",
			})),
		).toThrow("actor must be a non-empty string");

		expect(readFileSync(store.mapPath(created.id))).toEqual(mapBefore);
		expect(readFileSync(store.markdownPath(created.id))).toEqual(markdownBefore);
		expect(readFileSync(store.eventsPath(created.id))).toEqual(eventsBefore);
		expect(store.read(created.id)).toEqual(created);
	});

	test("recovers a complete revision after every interrupted commit step", () => {
		for (const step of [
			"before-event",
			"after-event",
			"after-markdown",
			"after-map",
		] satisfies WorkMapTransactionStep[]) {
			const { repo, home } = fixture();
			const initial = createStore(repo, home, "work-a");
			const created = initial.create(input(), "codex");
			let injected = false;
			const interrupted = createStore(repo, home, "unused", (current) => {
				if (!injected && current === step) {
					injected = true;
					throw new Error(`injected interruption: ${step}`);
				}
			});
			expect(() =>
				interrupted.update(created.id, 1, "block", "codex", (map) => ({
					...map,
					status: "blocked",
				})),
			).toThrow(`injected interruption: ${step}`);

			const recovered = createStore(repo, home, "unused");
			const map = recovered.read(created.id);
			expect(map.revision).toBe(2);
			expect(map.status).toBe("blocked");
			expect(readFileSync(recovered.markdownPath(created.id), "utf8")).toBe(
				renderWorkMapMarkdown(map),
			);
			expect(recovered.events(created.id)).toEqual([
				expect.objectContaining({ operation: "create", afterRevision: 1 }),
				expect.objectContaining({
					operation: "block",
					beforeRevision: 1,
					afterRevision: 2,
				}),
			]);
		}
	});

	test("recovers a journal and stale lock after a process crash", async () => {
		const { repo, home } = fixture();
		const initial = createStore(repo, home, "work-a");
		initial.create(input(), "codex");
		const moduleUrl = pathToFileURL(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"../workflows/work-map-store.ts",
			),
		).href;
		const worker = Bun.spawn({
			cmd: [
				process.execPath,
				"-e",
				`
					import { WorkMapStore } from ${JSON.stringify(moduleUrl)};
					const store = new WorkMapStore({
						cwd: ${JSON.stringify(repo)},
						goldbandHome: ${JSON.stringify(home)},
						transactionObserver: (step) => {
							if (step === "after-event") process.exit(91);
						},
					});
					store.update("work-a", 1, "block", "codex", (map) => ({
						...map,
						status: "blocked",
					}));
				`,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await worker.exited).toBe(91);

		const recovered = createStore(repo, home, "unused");
		const map = recovered.read("work-a");
		expect(map.revision).toBe(2);
		expect(map.status).toBe("blocked");
		expect(recovered.events("work-a")).toHaveLength(2);
	});

	test("recovers ownerless legacy locks without blocking state access", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		mkdirSync(join(store.workRoot, created.id, ".update-lock"));
		expect(store.read(created.id)).toEqual(created);
		mkdirSync(join(store.workRoot, ".active-pointer-lock"));
		expect(() => store.setActive(created.id)).not.toThrow();
		expect(store.readActive()).toEqual(created);
	});

	test("preserves zero-timeout semantics for a live update lock", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const lock = join(store.workRoot, created.id, ".update-lock");
		mkdirSync(lock, { mode: 0o700 });
		writeFileSync(
			join(lock, "owner.json"),
			JSON.stringify({
				schemaVersion: 1,
				pid: process.pid,
				token: "test-owner",
			}),
		);

		const startedAt = Date.now();
		expect(() =>
			store.update(created.id, created.revision, "block", "codex", (map) => ({
				...map,
				status: "blocked",
			})),
		).toThrow(`Work Map update is already in progress: ${created.id}`);
		expect(Date.now() - startedAt).toBeLessThan(500);
	});

	test("rejects a symlink in the state path", () => {
		const { repo, home } = fixture();
		const target = mkdtempSync(join(tmpdir(), "goldband-work-target-"));
		cleanup.push(target);
		symlinkSync(target, join(home, "projects"));
		expect(() => createStore(repo, home, "work-a")).toThrow(
			"state path must be a real directory",
		);
	});

	test("isolates active maps by branch", () => {
		const { repo, home } = fixture();
		runGit(repo, ["checkout", "-b", "branch-a"]);
		const branchA = createStore(repo, home, "work-a");
		expect(branchA.create(input(), "codex").id).toBe("work-a");
		runGit(repo, ["checkout", "-b", "branch-b"]);
		const branchB = createStore(repo, home, "work-b");
		expect(branchB.readActive()).toBeNull();
		expect(() => branchB.read("work-a")).toThrow(
			"Work Map repository identity mismatch",
		);
		expect(branchB.create(input(), "codex").id).toBe("work-b");
		runGit(repo, ["checkout", "branch-a"]);
		expect(createStore(repo, home, "unused").readActive()?.id).toBe("work-a");
	});

	test("isolates active maps by worktree", () => {
		const { repo, home } = fixture();
		const worktree = mkdtempSync(join(tmpdir(), "goldband-worktree-parent-"));
		rmSync(worktree, { recursive: true, force: true });
		cleanup.push(worktree);
		runGit(repo, ["branch", "linked"]);
		runGit(repo, ["worktree", "add", worktree, "linked"]);
		const primary = createStore(repo, home, "work-primary");
		primary.create(input(), "codex");
		const linked = createStore(worktree, home, "work-linked");
		expect(linked.readActive()).toBeNull();
		linked.create(input(), "codex");
		expect(primary.readActive()?.id).toBe("work-primary");
		expect(linked.readActive()?.id).toBe("work-linked");
	});

	test("serializes active pointer updates across worktrees", async () => {
		const { repo, home } = fixture();
		const worktree = mkdtempSync(join(tmpdir(), "goldband-worktree-parent-"));
		rmSync(worktree, { recursive: true, force: true });
		cleanup.push(worktree);
		runGit(repo, ["branch", "linked"]);
		runGit(repo, ["worktree", "add", worktree, "linked"]);

		const primary = createStore(repo, home, "work-primary");
		primary.create(input(), "codex");
		const primaryPointer = readFileSync(primary.activePath, "utf8");
		const linked = createStore(worktree, home, "work-linked");
		linked.create(input(), "codex");

		const lock = join(primary.workRoot, ".active-pointer-lock");
		mkdirSync(lock, { mode: 0o700 });
		const lockOwner = join(lock, "owner.json");
		writeFileSync(
			lockOwner,
			JSON.stringify({
				schemaVersion: 1,
				pid: process.pid,
				token: "test-owner",
			}),
		);
		const coordination = mkdtempSync(join(tmpdir(), "goldband-active-pointer-"));
		cleanup.push(coordination);
		const ready = join(coordination, "ready");
		const start = join(coordination, "start");
		const calling = join(coordination, "calling");
		const moduleUrl = pathToFileURL(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"../workflows/work-map-store.ts",
			),
		).href;
		const worker = Bun.spawn({
			cmd: [
				process.execPath,
				"-e",
				`
					import { existsSync, writeFileSync } from "node:fs";
					import { WorkMapStore } from ${JSON.stringify(moduleUrl)};
					const store = new WorkMapStore({
						cwd: ${JSON.stringify(worktree)},
						goldbandHome: ${JSON.stringify(home)},
					});
					writeFileSync(${JSON.stringify(ready)}, "");
					while (!existsSync(${JSON.stringify(start)})) await Bun.sleep(5);
					writeFileSync(${JSON.stringify(calling)}, "");
					store.setActive("work-linked");
				`,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		await waitForFile(ready);
		writeFileSync(start, "");
		await waitForFile(calling);
		writeFileSync(primary.activePath, primaryPointer);
		const releasedLock = `${lock}.released-test-owner`;
		renameSync(lock, releasedLock);
		rmSync(releasedLock, { recursive: true, force: true });

		const exitCode = await worker.exited;
		const workerError = await new Response(worker.stderr).text();
		if (exitCode !== 0) {
			throw new Error(`active pointer worker exited ${exitCode}: ${workerError}`);
		}
		expect(primary.readActive()?.id).toBe("work-primary");
		expect(linked.readActive()?.id).toBe("work-linked");
	});

	test("Markdown projection deterministically matches authoritative JSON", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		expect(readFileSync(store.markdownPath(map.id), "utf8")).toBe(
			renderWorkMapMarkdown(map),
		);
		expect(JSON.parse(readFileSync(store.mapPath(map.id), "utf8"))).toEqual(map);
	});

	test("a failed update leaves the previous valid state", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(() =>
			store.update(created.id, 1, "invalid", "codex", (map) => ({
				...map,
				destination: "",
			})),
		).toThrow("destination must be a non-empty string");
		expect(store.read(created.id)).toEqual(created);
		expect(existsSync(store.mapPath(created.id))).toBe(true);
	});

	test("rejects path traversal and repository identity mismatch", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "../escape");
		expect(() => store.create(input(), "codex")).toThrow("invalid Work Map id");

		const valid = createStore(repo, home, "work-a");
		const map = valid.create(input(), "codex");
		const raw = JSON.parse(readFileSync(valid.mapPath(map.id), "utf8"));
		raw.repository.identity = "other";
		writeFileSync(valid.mapPath(map.id), JSON.stringify(raw));
		expect(() => valid.read(map.id)).toThrow(
			"Work Map repository identity mismatch",
		);
	});

	test("rejects a map whose payload identity differs from its state path", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		const raw = JSON.parse(readFileSync(store.mapPath(map.id), "utf8"));
		raw.id = "work-b";
		writeFileSync(store.mapPath(map.id), JSON.stringify(raw));
		expect(() => store.read("work-a")).toThrow(
			"Work Map path identity mismatch: expected work-a, found work-b",
		);
		expect(() => store.readActive()).toThrow(
			"Work Map path identity mismatch: expected work-a, found work-b",
		);
	});

	test("rejects schema-valid map changes without matching transition evidence", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		const raw = JSON.parse(readFileSync(store.mapPath(map.id), "utf8"));
		raw.status = "blocked";
		writeFileSync(store.mapPath(map.id), JSON.stringify(raw));
		expect(() => store.read(map.id)).toThrow(
			"Work Map history integrity mismatch: work-a",
		);
		expect(() => store.readActive()).toThrow(
			"Work Map history integrity mismatch: work-a",
		);
	});
});

function fixture(): { repo: string; home: string } {
	const repo = mkdtempSync(join(tmpdir(), "goldband-work-map-repo-"));
	const home = mkdtempSync(join(tmpdir(), "goldband-work-map-home-"));
	cleanup.push(repo, home);
	runGit(repo, ["init"]);
	runGit(repo, ["config", "user.email", "test@example.com"]);
	runGit(repo, ["config", "user.name", "Test"]);
	writeFileSync(join(repo, "README.md"), "fixture\n");
	runGit(repo, ["add", "README.md"]);
	runGit(repo, ["commit", "-m", "initial"]);
	return { repo, home };
}

function createStore(
	repo: string,
	home: string,
	id: string,
	transactionObserver?: (step: WorkMapTransactionStep) => void,
): WorkMapStore {
	return new WorkMapStore({
		cwd: repo,
		goldbandHome: home,
		clock: () => new Date("2026-07-30T00:00:00.000Z"),
		idFactory: () => id,
		transactionObserver,
	});
}

function input(): WorkMapCreateInput {
	return {
		mode: "bounded",
		destination: "Create a durable Work Map",
		scope: {
			included: ["Local state"],
			excluded: ["External trackers"],
		},
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Implement store",
				delivers: "Durable local Work Map state",
				blockedBy: [],
				acceptanceCriteria: ["State survives a process restart"],
				verificationMode: "existing-tests",
				verificationCommand: ["bun", "test"],
				testSeams: ["store test"],
				status: "ready",
			},
		],
	};
}

function runGit(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
}

async function waitForFile(path: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!existsSync(path)) {
		if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
		await Bun.sleep(5);
	}
}
