import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectManagedBoundary } from "./managed-worktree-boundary";
import {
	type CreateManagedWorktreeOptions,
	canonicalStateRoot,
	ensureControlDirectories,
	type FinishManagedWorktreeOptions,
	type FinishManagedWorktreeResult,
	LEASE_SCHEMA_VERSION,
	leasePaths,
	MANAGED_MARKER,
	type ManagedBrokerContract,
	type ManagedWorktreeLease,
	newLeaseId,
	type ProtectedBrokerInput,
	readAndValidateLease,
	readJson,
	removePathIfExists,
	repositoryId,
	validateCommitMessage,
	validateManagedWorktreeName,
	withExclusiveLock,
	writeLease,
	writePrivateJson,
} from "./managed-worktree-contract";
import {
	canonicalGitPath,
	canonicalRepoRoot,
	cleanError,
	createGitExecutionContext,
	type GitExecutionContext,
	type GitIdentity,
	gitBuffer,
	gitOk,
	gitOutput,
	gitRun,
	readGitIdentity,
	resolveTrustedGitExecutable,
} from "./managed-worktree-git";
import {
	discardPreparedCommit,
	integratePreparedCommit,
	type PreparedManagedCommit,
	prepareManagedCommit,
} from "./managed-worktree-integration";
import { resolveGoldbandStateRoot } from "./state-root";
import {
	computeCandidateState,
	readAndValidateVerificationReceipt,
} from "./verification-receipt";
import { ticketContractDigest } from "../workflows/work-map";
import { WorkMapStore } from "../workflows/work-map-store";

export type {
	CreateManagedWorktreeOptions,
	FinishManagedWorktreeOptions,
	FinishManagedWorktreeResult,
	ManagedWorktreeLease,
} from "./managed-worktree-contract";

const MANAGED_RUNTIME_ROOT = fs.realpathSync(
	path.resolve(import.meta.dir, ".."),
);

export function createManagedWorktree(
	options: CreateManagedWorktreeOptions,
): ManagedWorktreeLease {
	const name = validateManagedWorktreeName(options.name);
	const stateRoot = canonicalStateRoot(
		options.stateRoot ?? resolveGoldbandStateRoot(),
	);
	const leaseId = newLeaseId();
	const bootstrapScratch = path.join(
		stateRoot,
		"worktrees",
		"scratch",
		leaseId,
	);
	const gitExecutable = resolveTrustedGitExecutable();
	const discoveryContext = createGitExecutionContext({
		executable: gitExecutable,
		scratchPath: bootstrapScratch,
	});
	discoveryContext.configArgs = ["-c", "core.fsmonitor=false"];
	const repoRoot = canonicalRepoRoot(
		options.repoRoot ?? process.cwd(),
		discoveryContext,
	);
	const identity = readGitIdentity(gitExecutable, repoRoot);
	const boundary = detectManagedBoundary();

	const commonGitDir = canonicalGitPath(
		repoRoot,
		gitOutput(["rev-parse", "--git-common-dir"], repoRoot, discoveryContext),
	);
	const broker = buildBrokerContract({
		repoRoot,
		commonGitDir,
		gitExecutable,
		identity,
		discoveryContext,
	});
	const context = brokerGitContext(broker, bootstrapScratch);
	ensureSourceSafeForCreate(repoRoot, context);
	const sourceBranch = gitOutput(
		["symbolic-ref", "-q", "HEAD"],
		repoRoot,
		context,
	);
	if (!sourceBranch.startsWith("refs/heads/")) {
		throw new Error(
			"managed worktree create requires the source worktree to be on a normal branch",
		);
	}
	const baseCommit = gitOutput(["rev-parse", sourceBranch], repoRoot, context);
	const repoId = repositoryId(repoRoot, commonGitDir);
	const paths = leasePaths(stateRoot, repoId, name, leaseId);
	ensureControlDirectories(paths);
	if (options.ticketId) {
		reconcilePendingWorkMapLeases({
			repoRoot,
			stateRoot,
			repoId,
			ticketId: options.ticketId,
		});
	}
	const workMapBinding = options.ticketId
		? resolveWorkMapBinding({
				repoRoot,
				stateRoot,
				ticketId: options.ticketId,
			})
		: undefined;

	if (workMapBinding) {
		fs.mkdirSync(
			path.join(
				stateRoot,
				"worktrees",
				"verification",
				repoId,
				leaseId,
			),
			{ recursive: true, mode: 0o700 },
		);
	}
	if (fs.existsSync(paths.manifestPath) || fs.existsSync(paths.worktreePath)) {
		throw new Error(`managed worktree already exists: ${name}`);
	}

	let worktreeCreated = false;
	let claimCreated = false;
	let publishedLease: ManagedWorktreeLease | undefined;
	try {
		gitOk(
			["worktree", "add", "--detach", paths.worktreePath, baseCommit],
			repoRoot,
			context,
		);
		worktreeCreated = true;
		const worktreeGitDir = canonicalGitPath(
			paths.worktreePath,
			gitOutput(["rev-parse", "--git-dir"], paths.worktreePath, context),
		);
		const lease: ManagedWorktreeLease = {
			schemaVersion: LEASE_SCHEMA_VERSION,
			id: leaseId,
			name,
			status: workMapBinding ? "pending" : "active",
			repoRoot,
			commonGitDir,
			sourceWorktree: repoRoot,
			sourceBranch,
			baseCommit,
			worktreePath: paths.worktreePath,
			worktreeGitDir,
			stateRoot,
			manifestPath: paths.manifestPath,
			scratchPath: paths.scratchPath,
			agentScratchPath: paths.agentScratchPath,
			evidencePath: paths.evidencePath,
			createdAt: new Date().toISOString(),
			...(workMapBinding
				? {
						workMap: {
							...workMapBinding.binding,
							workRevision: workMapBinding.map.revision + 1,
						},
					}
				: {}),
			broker,
			enforcement: {
				boundary,
				gitMetadata: "read-only",
				worktreeFiles: "read-write",
				softGuards: ["PreToolUse", "pre-commit"],
			},
		};
		publishedLease = lease;
		writePrivateJson(path.join(worktreeGitDir, MANAGED_MARKER), {
			schemaVersion: LEASE_SCHEMA_VERSION,
			leaseId,
			manifestPath: paths.manifestPath,
		});
		writeLease(lease);
		if (workMapBinding) {
			options.afterPendingLease?.();
			const claimed = workMapBinding.store.claimTicket({
				workId: workMapBinding.map.id,
				ticketId: workMapBinding.ticket.id,
				expectedRevision: workMapBinding.map.revision,
				owner: options.claimOwner ?? "managed-worktree",
				leaseId,
			});
			claimCreated = true;
			if (claimed.revision !== lease.workMap?.workRevision) {
				throw new Error("managed worktree claim revision binding failed");
			}
			const activeLease: ManagedWorktreeLease = { ...lease, status: "active" };
			writeLease(activeLease);
			return activeLease;
		}
		return lease;
	} catch (error) {
		if (worktreeCreated) {
			gitRun(
				["worktree", "remove", "--force", paths.worktreePath],
				repoRoot,
				context,
			);
			gitRun(["worktree", "prune"], repoRoot, context);
		}
		if (claimCreated && workMapBinding && publishedLease) {
			rollbackClaimWithRetry({
				store: workMapBinding.store,
				workId: workMapBinding.map.id,
				ticketId: workMapBinding.ticket.id,
				leaseId: publishedLease.id,
			});
		}
		removePathIfExists(paths.manifestPath);
		removePathIfExists(paths.scratchPath);
		removePathIfExists(paths.agentScratchPath);
		removePathIfExists(
			path.join(
				stateRoot,
				"worktrees",
				"verification",
				repoId,
				leaseId,
			),
		);
		throw error;
	}
}

function reconcilePendingWorkMapLeases(input: {
	repoRoot: string;
	stateRoot: string;
	repoId: string;
	ticketId: string;
}): void {
	const leaseDirectory = path.join(
		input.stateRoot,
		"worktrees",
		"leases",
		input.repoId,
	);
	if (!fs.existsSync(leaseDirectory)) return;
	for (const entry of fs.readdirSync(leaseDirectory)) {
		if (!entry.endsWith(".json")) continue;
		const manifestPath = path.join(leaseDirectory, entry);
		const raw = readJson(manifestPath) as Partial<ManagedWorktreeLease>;
		if (
			raw.status !== "pending" ||
			raw.workMap?.ticketId !== input.ticketId
		) {
			continue;
		}
		const pending = readAndValidateLease(manifestPath, input.repoRoot);
		const store = new WorkMapStore({
			cwd: input.repoRoot,
			goldbandHome: input.stateRoot,
		});
		const map = store.read(pending.workMap!.workId);
		const ticket = map.tickets.find((item) => item.id === input.ticketId);
		if (ticket?.status === "claimed" && ticket.claim?.leaseId === pending.id) {
			writeLease({ ...pending, status: "active" });
			throw new Error(
				`recovered pending managed worktree ${pending.name}; use the existing lease instead of creating a second candidate`,
			);
		}
		if (ticket?.status !== "ready" || ticket.claim) {
			throw new Error("pending managed worktree cannot be reconciled safely");
		}
		const pendingContext = brokerGitContext(pending.broker, pending.scratchPath);
		gitOk(
			["worktree", "remove", "--force", pending.worktreePath],
			pending.repoRoot,
			pendingContext,
		);
		removePathIfExists(pending.manifestPath);
		removePathIfExists(pending.scratchPath);
		removePathIfExists(pending.agentScratchPath);
	}
}

export function abortCreatedManagedWorktree(
	lease: ManagedWorktreeLease,
	options: { beforeRollbackAttempt?: (attempt: number) => void } = {},
): void {
	const current = readAndValidateLease(lease.manifestPath, lease.repoRoot);
	const context = brokerGitContext(current.broker, current.scratchPath);
	if (current.status !== "active" && current.status !== "aborting") {
		throw new Error("cannot abort a managed worktree after source integration");
	}
	if (current.status === "active") {
		writeLease({ ...current, status: "aborting" });
	}
	if (fs.existsSync(current.worktreePath)) {
		gitOk(
			["worktree", "remove", "--force", current.worktreePath],
			current.repoRoot,
			context,
		);
	}
	if (current.workMap) {
		const store = new WorkMapStore({
			cwd: current.repoRoot,
			goldbandHome: current.stateRoot,
		});
		rollbackClaimWithRetry({
			store,
			workId: current.workMap.workId,
			ticketId: current.workMap.ticketId,
			leaseId: current.id,
			beforeAttempt: options.beforeRollbackAttempt,
		});
	}
	removePathIfExists(current.manifestPath);
	removePathIfExists(current.scratchPath);
	removePathIfExists(current.agentScratchPath);
	if (current.workMap) {
		removePathIfExists(
			path.join(
				current.stateRoot,
				"worktrees",
				"verification",
				repositoryId(current.repoRoot, current.commonGitDir),
				current.id,
			),
		);
	}
}

function rollbackClaimWithRetry(input: {
	store: WorkMapStore;
	workId: string;
	ticketId: string;
	leaseId: string;
	beforeAttempt?: (attempt: number) => void;
}): void {
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const map = input.store.read(input.workId);
		const ticket = map.tickets.find((item) => item.id === input.ticketId);
		if (!ticket) throw new Error("rollback Work Map ticket is missing");
		if (!ticket.claim) {
			if (["ready", "blocked", "cancelled"].includes(ticket.status)) return;
			throw new Error("rollback Work Map claim is missing");
		}
		if (ticket.claim?.leaseId !== input.leaseId) {
			throw new Error("rollback Work Map claim no longer matches the managed lease");
		}
		input.beforeAttempt?.(attempt);
		try {
			input.store.rollbackClaim({
				workId: map.id,
				ticketId: ticket.id,
				expectedRevision: map.revision,
				leaseId: input.leaseId,
				actor: "managed-worktree-abort",
			});
			return;
		} catch (error) {
			if (
				attempt < 5 &&
				error instanceof Error &&
				error.message.startsWith("stale Work Map revision:")
			) {
				continue;
			}
			throw error;
		}
	}
}

export function finishManagedWorktree(
	options: FinishManagedWorktreeOptions,
): FinishManagedWorktreeResult {
	const name = validateManagedWorktreeName(options.name);
	const message = validateCommitMessage(options.message);
	const stateRoot = canonicalStateRoot(
		options.stateRoot ?? resolveGoldbandStateRoot(),
	);
	const bootstrapScratch = fs.mkdtempSync(
		path.join(stateRoot, ".finish-broker-"),
	);
	const gitExecutable = resolveTrustedGitExecutable();
	const discoveryContext = createGitExecutionContext({
		executable: gitExecutable,
		scratchPath: bootstrapScratch,
	});
	discoveryContext.configArgs = ["-c", "core.fsmonitor=false"];
	const repoRoot = canonicalRepoRoot(
		options.repoRoot ?? process.cwd(),
		discoveryContext,
	);
	const commonGitDir = canonicalGitPath(
		repoRoot,
		gitOutput(["rev-parse", "--git-common-dir"], repoRoot, discoveryContext),
	);
	const repoId = repositoryId(repoRoot, commonGitDir);
	const manifestPath = path.join(
		stateRoot,
		"worktrees",
		"leases",
		repoId,
		`${name}.json`,
	);
	const lockPath = path.join(
		stateRoot,
		"worktrees",
		"locks",
		repoId,
		`${name}.lock`,
	);

	try {
		return withExclusiveLock(lockPath, () => {
			let lease = readAndValidateLease(manifestPath, repoRoot);
			if (
				lease.broker.gitExecutable !== gitExecutable ||
				lease.broker.runtimeRoot !== MANAGED_RUNTIME_ROOT
			) {
				throw new Error("managed broker runtime no longer matches the lease");
			}
			validateBrokerContract(lease, discoveryContext);
			const context = brokerGitContext(lease.broker, lease.scratchPath);
			removePathIfExists(bootstrapScratch);
			validateLeaseOwnership(
				lease,
				{
					name,
					repoRoot,
					commonGitDir,
					stateRoot,
				},
				context,
			);
			if (lease.status === "integrated") {
				return finishIntegratedCleanup(lease, context);
			}
			if (lease.status !== "active") {
				throw new Error(`cannot finish managed worktree in ${lease.status} state`);
			}
			if (
				lease.preparedCommit &&
				lease.preparedTree &&
				gitOutput(
					["rev-parse", lease.sourceBranch],
					lease.repoRoot,
					context,
				) === lease.preparedCommit
			) {
				verifyIntegratedSource(
					lease,
					lease.preparedCommit,
					lease.preparedTree,
					context,
				);
				lease = {
					...lease,
					status: "integrated",
					integratedAt: new Date().toISOString(),
				};
				writeLease(lease);
				return finishIntegratedCleanup(lease, context);
			}
			if (lease.preparedCommit && lease.preparedTree) {
				discardPreparedCommit({
					indexPath: path.join(lease.scratchPath, "finish.index"),
					objectDirectory: path.join(lease.scratchPath, "objects"),
				});
				lease = clearPreparedLease(lease);
			}

			validateActiveWorktree(lease, context);
			validateSourceForIntegration(lease, context);
			validateManagedContent(lease, context);
			validateBoundEvidence(lease);
			const prepared = prepareManagedCommit(lease, message, context);
			try {
				validateSourceIgnoredCollisions(lease, prepared, context);
			} catch (error) {
				discardPreparedCommit(prepared);
				throw error;
			}
			lease = {
				...lease,
				preparedCommit: prepared.commit,
				preparedTree: prepared.tree,
			};
			writeLease(lease);

			try {
				validateSourceForIntegration(lease, context);
				validateSourceIgnoredCollisions(lease, prepared, context);
			} catch (error) {
				discardPreparedCommit(prepared);
				clearPreparedLease(lease);
				throw error;
			}
			const integration = integratePreparedCommit(lease, prepared);
			const sourceReceivedCommit =
				gitOutput(
					["rev-parse", lease.sourceBranch],
					lease.repoRoot,
					context,
				) === prepared.commit;
			if (integration.status !== 0 && !sourceReceivedCommit) {
				discardPreparedCommit(prepared);
				clearPreparedLease(lease);
				throw new Error(
					`managed worktree integration failed; worktree preserved: ${cleanError(integration)}`,
				);
			}

			verifyIntegratedSource(lease, prepared.commit, prepared.tree, context);
			lease = {
				...lease,
				status: "integrated",
				integratedAt: new Date().toISOString(),
			};
			writeLease(lease);
			return finishIntegratedCleanup(lease, context);
		});
	} finally {
		removePathIfExists(bootstrapScratch);
	}
}

function buildBrokerContract(options: {
	repoRoot: string;
	commonGitDir: string;
	gitExecutable: string;
	identity: GitIdentity;
	discoveryContext: GitExecutionContext;
}): ManagedBrokerContract {
	const sourceConfig = readSourceConfigContract(
		options.repoRoot,
		options.commonGitDir,
		options.discoveryContext,
	);
	return {
		gitExecutable: options.gitExecutable,
		runtimeRoot: MANAGED_RUNTIME_ROOT,
		hookRoot: sourceConfig.hookRoot,
		sourceConfigFiles: sourceConfig.files,
		sourceConfigDigest: sourceConfig.digest,
		authorName: options.identity.name,
		authorEmail: options.identity.email,
		protectedInputs: buildProtectedBrokerInputs({
			gitExecutable: options.gitExecutable,
			hookRoot: sourceConfig.hookRoot,
			sourceConfigFiles: sourceConfig.files,
		}),
	};
}

function validateBrokerContract(
	lease: ManagedWorktreeLease,
	discoveryContext: GitExecutionContext,
): void {
	const current = readSourceConfigContract(
		lease.repoRoot,
		lease.commonGitDir,
		discoveryContext,
	);
	if (
		current.hookRoot !== lease.broker.hookRoot ||
		current.digest !== lease.broker.sourceConfigDigest ||
		JSON.stringify(current.files) !==
			JSON.stringify(lease.broker.sourceConfigFiles)
	) {
		throw new Error(
			"source-owned Git config or hook contract changed after managed worktree creation",
		);
	}
}

function brokerGitContext(
	broker: ManagedBrokerContract,
	scratchPath: string,
): GitExecutionContext {
	return createGitExecutionContext({
		executable: broker.gitExecutable,
		scratchPath,
		hookRoot: broker.hookRoot,
		identity: { name: broker.authorName, email: broker.authorEmail },
	});
}

function readSourceConfigContract(
	repoRoot: string,
	commonGitDir: string,
	context: GitExecutionContext,
): { files: string[]; hookRoot: string; digest: string } {
	const result = gitRun(
		["config", "--local", "--includes", "--show-origin", "--null", "--list"],
		repoRoot,
		context,
	);
	if (result.status !== 0) {
		throw new Error(
			`failed to inspect source Git config: ${cleanError(result)}`,
		);
	}
	const fields = result.stdout.split("\0").filter(Boolean);
	const files = new Set<string>();
	for (let index = 0; index < fields.length; index += 2) {
		const origin = fields[index];
		if (!origin?.startsWith("file:")) continue;
		const configPath = fs.realpathSync(
			path.resolve(repoRoot, origin.slice("file:".length)),
		);
		if (
			!isWithin(repoRoot, configPath) &&
			!isWithin(commonGitDir, configPath)
		) {
			throw new Error(
				`source Git config includes a non-source-owned file: ${configPath}`,
			);
		}
		files.add(configPath);
	}
	const hookRoot = canonicalPotentialPath(
		gitOutput(
			["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
			repoRoot,
			context,
		),
	);
	if (!isWithin(repoRoot, hookRoot) && !isWithin(commonGitDir, hookRoot)) {
		throw new Error(`source Git hooksPath is not source-owned: ${hookRoot}`);
	}
	const sortedFiles = [...files].sort();
	const digest = createHash("sha256");
	digest.update(`${hookRoot}\0`);
	for (const configPath of sortedFiles) {
		digest.update(`${configPath}\0`);
		digest.update(fs.readFileSync(configPath));
		digest.update("\0");
	}
	return { files: sortedFiles, hookRoot, digest: digest.digest("hex") };
}

function buildProtectedBrokerInputs(options: {
	gitExecutable: string;
	hookRoot: string;
	sourceConfigFiles: string[];
}): ProtectedBrokerInput[] {
	const inputs = new Map<string, ProtectedBrokerInput>();
	const add = (candidate: string, kind: ProtectedBrokerInput["kind"]): void => {
		const lexical = canonicalPotentialPath(candidate);
		inputs.set(`${kind}:${lexical}`, { path: lexical, kind });
		if (fs.existsSync(candidate)) {
			const actual = fs.realpathSync(candidate);
			inputs.set(`${kind}:${actual}`, { path: actual, kind });
		}
	};
	add(options.gitExecutable, "file");
	add(MANAGED_RUNTIME_ROOT, "directory");
	add(options.hookRoot, "directory");
	for (const configPath of options.sourceConfigFiles) add(configPath, "file");

	const home = canonicalPotentialPath(process.env.HOME ?? os.homedir());
	const xdgConfig = canonicalPotentialPath(
		process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
	);
	add(path.join(home, ".gitconfig"), "file");
	add(path.join(xdgConfig, "git"), "directory");
	add(path.join(home, ".codex", "skills", "goldband"), "directory");
	add(path.join(home, ".claude", "skills", "goldband"), "directory");
	add(path.join(home, ".claude", "shell", "goldband-launchers.sh"), "file");
	return [...inputs.values()].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
}

function canonicalPotentialPath(candidate: string): string {
	let cursor = path.resolve(candidate);
	const suffix: string[] = [];
	while (!fs.existsSync(cursor)) {
		const parent = path.dirname(cursor);
		if (parent === cursor) break;
		suffix.unshift(path.basename(cursor));
		cursor = parent;
	}
	return path.join(fs.realpathSync(cursor), ...suffix);
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function clearPreparedLease(lease: ManagedWorktreeLease): ManagedWorktreeLease {
	const cleared = { ...lease };
	delete cleared.preparedCommit;
	delete cleared.preparedTree;
	writeLease(cleared);
	return cleared;
}

function finishIntegratedCleanup(
	lease: ManagedWorktreeLease,
	context: GitExecutionContext,
): FinishManagedWorktreeResult {
	const commit = lease.preparedCommit;
	const tree = lease.preparedTree;
	if (!commit || !tree) {
		throw new Error(
			"integrated managed lease is missing prepared commit evidence",
		);
	}
	verifyIntegratedSource(lease, commit, tree, context);
	markBoundTicketIntegrated(lease, commit);
	if (fs.existsSync(lease.worktreePath)) {
		const removal = gitRun(
			["worktree", "remove", "--force", lease.worktreePath],
			lease.repoRoot,
			context,
		);
		if (removal.status !== 0) {
			throw new Error(
				`commit is integrated but managed worktree cleanup failed; retry finish: ${cleanError(removal)}`,
			);
		}
	}

	writePrivateJson(lease.evidencePath, {
		...lease,
		status: "finished",
		finishedAt: new Date().toISOString(),
		commit,
		tree,
	});
	removePathIfExists(lease.manifestPath);
	removePathIfExists(lease.scratchPath);
	removePathIfExists(lease.agentScratchPath);
	return {
		commit,
		tree,
		branch: lease.sourceBranch,
		evidencePath: lease.evidencePath,
	};
}

function resolveWorkMapBinding(input: {
	repoRoot: string;
	stateRoot: string;
	ticketId: string;
}) {
	const store = new WorkMapStore({
		cwd: input.repoRoot,
		goldbandHome: input.stateRoot,
	});
	const map = store.readActive();
	if (!map) throw new Error("managed Work Map worktree requires an active map");
	if (!map.frontier.includes(input.ticketId)) {
		throw new Error(`ticket is not in the current Work Map frontier: ${input.ticketId}`);
	}
	const ticket = map.tickets.find((item) => item.id === input.ticketId);
	if (!ticket) throw new Error(`Work Map ticket is missing: ${input.ticketId}`);
	if (ticket.status !== "ready" || ticket.claim) {
		throw new Error(`ticket is already claimed: ${input.ticketId}`);
	}
	if (ticket.verificationMode === "analysis-only") {
		throw new Error("analysis-only ticket cannot create a code worktree");
	}
	return {
		store,
		map,
		ticket,
		binding: {
			workId: map.id,
			ticketId: ticket.id,
			ticketContractDigest: ticketContractDigest(ticket),
		},
	};
}

function validateBoundEvidence(lease: ManagedWorktreeLease): void {
	if (!lease.workMap) return;
	const store = new WorkMapStore({
		cwd: lease.repoRoot,
		goldbandHome: lease.stateRoot,
	});
	const map = store.read(lease.workMap.workId);
	const ticket = map.tickets.find(
		(item) => item.id === lease.workMap?.ticketId,
	);
	if (
		!ticket ||
		!["implemented", "verified"].includes(ticket.status) ||
		ticket.claim?.leaseId !== lease.id ||
		ticketContractDigest(ticket) !== lease.workMap.ticketContractDigest
	) {
		throw new Error("managed worktree ticket lacks project verification for this lease");
	}
	const receipt = readAndValidateVerificationReceipt({
		lease,
		map,
		ticket,
	});
	if (
		!ticket.evidence?.receipt ||
		ticket.evidence.receipt.digest !== receipt.reference.digest ||
		ticket.evidence.receipt.treeDigest !== receipt.reference.treeDigest ||
		computeCandidateState(lease).treeDigest !== receipt.reference.treeDigest
	) {
		throw new Error("managed worktree verification receipt is stale or mismatched");
	}
}

function markBoundTicketIntegrated(
	lease: ManagedWorktreeLease,
	commit: string,
): void {
	if (!lease.workMap) return;
	const store = new WorkMapStore({
		cwd: lease.repoRoot,
		goldbandHome: lease.stateRoot,
	});
	markIntegratedWithRetry({
		store,
		workId: lease.workMap.workId,
		ticketId: lease.workMap.ticketId,
		commit,
	});
}

export function markIntegratedWithRetry(input: {
	store: WorkMapStore;
	workId: string;
	ticketId: string;
	commit: string;
	beforeAttempt?: (attempt: number) => void;
}): void {
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const map = input.store.read(input.workId);
		const ticket = map.tickets.find((item) => item.id === input.ticketId);
		if (!ticket) throw new Error("integrated Work Map ticket is missing");
		if (ticket.integratedCommit === input.commit) return;
		if (ticket.integratedCommit && ticket.integratedCommit !== input.commit) {
			throw new Error("Work Map ticket records a different integrated commit");
		}
		input.beforeAttempt?.(attempt);
		try {
			input.store.markIntegrated({
				workId: map.id,
				ticketId: ticket.id,
				expectedRevision: map.revision,
				actor: "managed-worktree-finish",
				commit: input.commit,
			});
			return;
		} catch (error) {
			if (
				attempt < 5 &&
				error instanceof Error &&
				error.message.startsWith("stale Work Map revision:")
			) {
				continue;
			}
			throw error;
		}
	}
}

function validateLeaseOwnership(
	lease: ManagedWorktreeLease,
	expected: {
		name: string;
		repoRoot: string;
		commonGitDir: string;
		stateRoot: string;
	},
	context: GitExecutionContext,
): void {
	if (
		lease.name !== expected.name ||
		lease.repoRoot !== expected.repoRoot ||
		lease.commonGitDir !== expected.commonGitDir ||
		lease.stateRoot !== expected.stateRoot
	) {
		throw new Error(
			"managed worktree manifest does not match the requested repository and name",
		);
	}
	const currentSourceBranch = gitOutput(
		["symbolic-ref", "-q", "HEAD"],
		lease.sourceWorktree,
		context,
	);
	if (currentSourceBranch !== lease.sourceBranch) {
		throw new Error(
			"managed worktree source branch no longer matches the manifest",
		);
	}
}

function validateActiveWorktree(
	lease: ManagedWorktreeLease,
	context: GitExecutionContext,
): void {
	if (!fs.existsSync(lease.worktreePath)) {
		throw new Error("managed worktree path is missing");
	}
	const actualGitDir = canonicalGitPath(
		lease.worktreePath,
		gitOutput(["rev-parse", "--git-dir"], lease.worktreePath, context),
	);
	if (actualGitDir !== lease.worktreeGitDir) {
		throw new Error(
			"managed worktree Git directory does not match the manifest",
		);
	}
	const marker = readJson(path.join(actualGitDir, MANAGED_MARKER)) as {
		schemaVersion?: number;
		leaseId?: string;
		manifestPath?: string;
	};
	if (
		marker.schemaVersion !== LEASE_SCHEMA_VERSION ||
		marker.leaseId !== lease.id ||
		marker.manifestPath !== lease.manifestPath
	) {
		throw new Error("managed worktree marker is missing or invalid");
	}
	if (
		process.platform !== "win32" &&
		(fs.statSync(path.join(actualGitDir, MANAGED_MARKER)).mode & 0o077) !== 0
	) {
		throw new Error("managed worktree marker permissions are not owner-only");
	}
	if (
		gitOutput(["rev-parse", "HEAD"], lease.worktreePath, context) !==
		lease.baseCommit
	) {
		throw new Error(
			"managed worktree HEAD moved; agent-side commits are not accepted",
		);
	}
}

function validateSourceForIntegration(
	lease: ManagedWorktreeLease,
	context: GitExecutionContext,
): void {
	const branch = gitOutput(
		["symbolic-ref", "-q", "HEAD"],
		lease.sourceWorktree,
		context,
	);
	if (branch !== lease.sourceBranch) {
		throw new Error("source worktree is no longer on the recorded branch");
	}
	const branchCommit = gitOutput(
		["rev-parse", lease.sourceBranch],
		lease.repoRoot,
		context,
	);
	if (branchCommit !== lease.baseCommit) {
		throw new Error("source branch moved after managed worktree creation");
	}
	if (
		gitOutput(["rev-parse", "HEAD"], lease.sourceWorktree, context) !==
		lease.baseCommit
	) {
		throw new Error("source worktree HEAD does not match the recorded base");
	}
	if (worktreeStatus(lease.sourceWorktree, context)) {
		throw new Error("source worktree is dirty; managed integration stopped");
	}
	const lockFiles = [
		path.join(lease.commonGitDir, "index.lock"),
		path.join(lease.commonGitDir, "HEAD.lock"),
		path.join(lease.commonGitDir, "packed-refs.lock"),
		path.join(lease.worktreeGitDir, "index.lock"),
	].filter((candidate) => fs.existsSync(candidate));
	if (lockFiles.length > 0) {
		throw new Error(
			`Git integration is not safe while lock files exist: ${lockFiles.join(", ")}`,
		);
	}
}

function validateManagedContent(
	lease: ManagedWorktreeLease,
	context: GitExecutionContext,
): void {
	const ignored = gitBuffer(
		["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
		lease.worktreePath,
		context,
	)
		.toString("utf8")
		.split("\0")
		.filter(Boolean);
	if (ignored.length > 0) {
		throw new Error(
			`managed worktree contains ignored files; remove or intentionally unignore them before finish: ${ignored.join(", ")}`,
		);
	}
	const submodules = gitRun(
		[
			"submodule",
			"foreach",
			"--recursive",
			"--quiet",
			'test -z "$(git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)" && test -z "$(git ls-files --others --ignored --exclude-standard)"',
		],
		lease.worktreePath,
		context,
	);
	if (submodules.status !== 0) {
		throw new Error(
			"managed worktree contains a dirty or ignored submodule worktree; commit or clean it separately before finish",
		);
	}
	if (!worktreeStatus(lease.worktreePath, context)) {
		throw new Error("managed worktree has no tracked or untracked changes");
	}
}

function validateSourceIgnoredCollisions(
	lease: ManagedWorktreeLease,
	prepared: PreparedManagedCommit,
	context: GitExecutionContext,
): void {
	const ignored = gitBuffer(
		["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
		lease.sourceWorktree,
		context,
	)
		.toString("utf8")
		.split("\0")
		.filter(Boolean);
	if (ignored.length === 0) return;

	const candidate = gitRun(
		["ls-tree", "-r", "-z", "--name-only", prepared.tree],
		lease.worktreePath,
		prepared.context,
	);
	if (candidate.status !== 0) {
		throw new Error(
			`failed to inspect the managed candidate tree: ${cleanError(candidate)}`,
		);
	}
	const candidatePaths = candidate.stdout.split("\0").filter(Boolean);
	const collisions = ignored.filter((ignoredPath) =>
		candidatePaths.some(
			(candidatePath) =>
				candidatePath === ignoredPath ||
				candidatePath.startsWith(`${ignoredPath}/`) ||
				ignoredPath.startsWith(`${candidatePath}/`),
		),
	);
	if (collisions.length > 0) {
		throw new Error(
			`managed candidate collides with ignored source content; worktree preserved: ${collisions.join(", ")}`,
		);
	}
}

function verifyIntegratedSource(
	lease: ManagedWorktreeLease,
	commit: string,
	tree: string,
	context: GitExecutionContext,
): void {
	if (
		gitOutput(["rev-parse", lease.sourceBranch], lease.repoRoot, context) !==
		commit
	) {
		throw new Error("prepared commit is not the current source branch commit");
	}
	if (
		gitOutput(["rev-parse", `${commit}^{tree}`], lease.repoRoot, context) !==
		tree
	) {
		throw new Error("integrated commit tree does not match prepared evidence");
	}
	if (worktreeStatus(lease.sourceWorktree, context)) {
		throw new Error("source worktree is not clean after integration");
	}
}

function ensureSourceSafeForCreate(
	repoRoot: string,
	context: GitExecutionContext,
): void {
	if (gitRun(["symbolic-ref", "-q", "HEAD"], repoRoot, context).status !== 0) {
		throw new Error(
			"managed worktree create requires a source branch, not detached HEAD",
		);
	}
	if (worktreeStatus(repoRoot, context)) {
		throw new Error("managed worktree create requires a clean source worktree");
	}
}

function worktreeStatus(
	worktree: string,
	context: GitExecutionContext,
): string {
	return gitOutput(
		[
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
			"--ignore-submodules=none",
		],
		worktree,
		context,
	);
}
