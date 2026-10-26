import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const LEASE_SCHEMA_VERSION = 3;
export const MANAGED_MARKER = "goldband-managed-worktree.json";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ManagedBoundary = "darwin-seatbelt" | "linux-bubblewrap";

export interface ProtectedBrokerInput {
	path: string;
	kind: "file" | "directory";
}

export interface ManagedBrokerContract {
	gitExecutable: string;
	runtimeRoot: string;
	hookRoot: string;
	sourceConfigFiles: string[];
	sourceConfigDigest: string;
	authorName: string;
	authorEmail: string;
	protectedInputs: ProtectedBrokerInput[];
}

export interface ManagedWorktreeLease {
	schemaVersion: 3;
	id: string;
	name: string;
	status: "pending" | "active" | "aborting" | "integrated";
	repoRoot: string;
	commonGitDir: string;
	sourceWorktree: string;
	sourceBranch: string;
	baseCommit: string;
	worktreePath: string;
	worktreeGitDir: string;
	stateRoot: string;
	manifestPath: string;
	scratchPath: string;
	agentScratchPath: string;
	evidencePath: string;
	createdAt: string;
	workMap?: {
		workId: string;
		workRevision: number;
		ticketId: string;
		ticketContractDigest: string;
	};
	preparedCommit?: string;
	preparedTree?: string;
	integratedAt?: string;
	broker: ManagedBrokerContract;
	enforcement: {
		boundary: ManagedBoundary;
		gitMetadata: "read-only";
		worktreeFiles: "read-write";
		softGuards: string[];
	};
}

export interface CreateManagedWorktreeOptions {
	name: string;
	repoRoot?: string;
	stateRoot?: string;
	ticketId?: string;
	claimOwner?: string;
	afterPendingLease?: () => void;
}

export interface FinishManagedWorktreeOptions {
	name: string;
	message: string;
	repoRoot?: string;
	stateRoot?: string;
}

export interface FinishManagedWorktreeResult {
	commit: string;
	tree: string;
	branch: string;
	evidencePath: string;
}

export interface ManagedBoundaryProbe {
	available: boolean;
	boundary?: ManagedBoundary;
	reason?: "nested-sandbox" | "unavailable" | "contract-failed";
	detail?: string;
}

export function validateManagedWorktreeName(name: string): string {
	if (!NAME_PATTERN.test(name) || name === "." || name === "..") {
		throw new Error(
			"managed worktree name must be 1-64 characters using letters, numbers, dot, underscore, or dash",
		);
	}
	return name;
}

export function validateCommitMessage(message: string): string {
	const normalized = message.trim();
	if (!normalized || normalized.includes("\0")) {
		throw new Error("finish requires a non-empty commit message");
	}
	if (Buffer.byteLength(normalized, "utf8") > 4096) {
		throw new Error("finish commit message exceeds 4096 bytes");
	}
	return normalized;
}

export function repositoryId(repoRoot: string, commonGitDir: string): string {
	return createHash("sha256")
		.update(`${repoRoot}\0${commonGitDir}`)
		.digest("hex")
		.slice(0, 20);
}

export function canonicalStateRoot(candidate: string): string {
	const resolved = path.resolve(candidate);
	fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") fs.chmodSync(resolved, 0o700);
	return fs.realpathSync(resolved);
}

export function leasePaths(
	stateRoot: string,
	repoId: string,
	name: string,
	leaseId: string,
): {
	worktreePath: string;
	manifestPath: string;
	scratchPath: string;
	agentScratchPath: string;
	evidencePath: string;
	controlDirectories: string[];
} {
	const controlRoot = path.join(stateRoot, "worktrees");
	const leaseDirectory = path.join(controlRoot, "leases", repoId);
	const checkoutDirectory = path.join(controlRoot, "checkouts", repoId);
	const scratchDirectory = path.join(controlRoot, "scratch", leaseId);
	const agentScratchDirectory = path.join(
		controlRoot,
		"agent-scratch",
		leaseId,
	);
	const evidenceDirectory = path.join(controlRoot, "evidence", repoId);
	const lockDirectory = path.join(controlRoot, "locks", repoId);
	return {
		worktreePath: path.join(checkoutDirectory, name),
		manifestPath: path.join(leaseDirectory, `${name}.json`),
		scratchPath: scratchDirectory,
		agentScratchPath: agentScratchDirectory,
		evidencePath: path.join(evidenceDirectory, `${leaseId}.json`),
		controlDirectories: [
			leaseDirectory,
			checkoutDirectory,
			scratchDirectory,
			agentScratchDirectory,
			evidenceDirectory,
			lockDirectory,
		],
	};
}

export function newLeaseId(): string {
	return randomUUID();
}

export function ensureControlDirectories(
	paths: ReturnType<typeof leasePaths>,
): void {
	for (const directory of paths.controlDirectories) {
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
	}
}

export function writeLease(lease: ManagedWorktreeLease): void {
	writePrivateJson(lease.manifestPath, lease);
}

export function writePrivateJson(filePath: string, value: unknown): void {
	writePrivateText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Atomically writes an owner-only file through a fresh, exclusive temporary file. */
export function writePrivateText(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const temporary = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
	fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
	fs.renameSync(temporary, filePath);
	if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

export function readAndValidateLease(
	manifestPath: string,
	repoRoot: string,
): ManagedWorktreeLease {
	const lease = readJson(manifestPath) as Partial<ManagedWorktreeLease>;
	const requiredStrings: Array<keyof ManagedWorktreeLease> = [
		"id",
		"name",
		"repoRoot",
		"commonGitDir",
		"sourceWorktree",
		"sourceBranch",
		"baseCommit",
		"worktreePath",
		"worktreeGitDir",
		"stateRoot",
		"manifestPath",
		"scratchPath",
		"agentScratchPath",
		"evidencePath",
		"createdAt",
	];
	const stringsAreValid = requiredStrings.every(
		(key) => typeof lease[key] === "string" && String(lease[key]).length > 0,
	);
	const expectedPaths = stringsAreValid
		? leasePaths(
				String(lease.stateRoot),
				repositoryId(String(lease.repoRoot), String(lease.commonGitDir)),
				String(lease.name),
				String(lease.id),
			)
		: null;
	const absolutePaths = [
		lease.repoRoot,
		lease.commonGitDir,
		lease.sourceWorktree,
		lease.worktreePath,
		lease.worktreeGitDir,
		lease.stateRoot,
		lease.manifestPath,
		lease.scratchPath,
		lease.agentScratchPath,
		lease.evidencePath,
	];
	const workMapBindingIsValid =
		lease.workMap === undefined ||
		(typeof lease.workMap === "object" &&
			lease.workMap !== null &&
			typeof lease.workMap.workId === "string" &&
			/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lease.workMap.workId) &&
			Number.isSafeInteger(lease.workMap.workRevision) &&
			lease.workMap.workRevision > 0 &&
			typeof lease.workMap.ticketId === "string" &&
			lease.workMap.ticketId.length > 0 &&
			/^[0-9a-f]{64}$/.test(lease.workMap.ticketContractDigest));
	if (
		lease.schemaVersion !== LEASE_SCHEMA_VERSION ||
		!stringsAreValid ||
		!workMapBindingIsValid ||
		(lease.status !== "pending" &&
			lease.status !== "active" &&
			lease.status !== "aborting" &&
			lease.status !== "integrated") ||
		!lease.enforcement ||
		!lease.broker ||
		typeof lease.broker.gitExecutable !== "string" ||
		typeof lease.broker.runtimeRoot !== "string" ||
		typeof lease.broker.hookRoot !== "string" ||
		!Array.isArray(lease.broker.sourceConfigFiles) ||
		!lease.broker.sourceConfigFiles.every(
			(configPath) =>
				typeof configPath === "string" && path.isAbsolute(configPath),
		) ||
		!/^[0-9a-f]{64}$/.test(String(lease.broker.sourceConfigDigest)) ||
		typeof lease.broker.authorName !== "string" ||
		!lease.broker.authorName ||
		typeof lease.broker.authorEmail !== "string" ||
		!lease.broker.authorEmail ||
		!Array.isArray(lease.broker.protectedInputs) ||
		!lease.broker.protectedInputs.every(
			(input) =>
				input &&
				(input.kind === "file" || input.kind === "directory") &&
				typeof input.path === "string" &&
				path.isAbsolute(input.path),
		) ||
		lease.enforcement.gitMetadata !== "read-only" ||
		lease.enforcement.worktreeFiles !== "read-write" ||
		(lease.enforcement.boundary !== "darwin-seatbelt" &&
			lease.enforcement.boundary !== "linux-bubblewrap") ||
		!Array.isArray(lease.enforcement.softGuards) ||
		!lease.enforcement.softGuards.every(
			(guard) => typeof guard === "string" && guard.length > 0,
		) ||
		!absolutePaths.every(
			(candidate) =>
				typeof candidate === "string" &&
				path.isAbsolute(candidate) &&
				path.resolve(candidate) === candidate,
		) ||
		lease.sourceWorktree !== lease.repoRoot ||
		fs.realpathSync(String(lease.stateRoot)) !== lease.stateRoot ||
		!NAME_PATTERN.test(String(lease.name)) ||
		!String(lease.sourceBranch).startsWith("refs/heads/") ||
		!/^[0-9a-f]{40,64}$/.test(String(lease.baseCommit)) ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			String(lease.id),
		) ||
		lease.manifestPath !== manifestPath ||
		lease.repoRoot !== repoRoot ||
		lease.worktreePath !== expectedPaths?.worktreePath ||
		lease.manifestPath !== expectedPaths?.manifestPath ||
		lease.scratchPath !== expectedPaths?.scratchPath ||
		lease.agentScratchPath !== expectedPaths?.agentScratchPath ||
		lease.evidencePath !== expectedPaths?.evidencePath ||
		(lease.preparedCommit !== undefined &&
			!/^[0-9a-f]{40,64}$/.test(lease.preparedCommit)) ||
		(lease.preparedTree !== undefined &&
			!/^[0-9a-f]{40,64}$/.test(lease.preparedTree)) ||
		Boolean(lease.preparedCommit) !== Boolean(lease.preparedTree) ||
		(lease.status === "integrated" &&
			(!lease.preparedCommit || !lease.preparedTree || !lease.integratedAt))
	) {
		throw new Error(
			"managed worktree manifest is invalid or has been tampered with",
		);
	}
	if (
		process.platform !== "win32" &&
		(fs.statSync(manifestPath).mode & 0o077) !== 0
	) {
		throw new Error("managed worktree manifest permissions are not owner-only");
	}
	return lease as ManagedWorktreeLease;
}

export function readJson(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch (error) {
		throw new Error(
			`managed worktree manifest or marker cannot be read: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function withExclusiveLock<T>(lockPath: string, operation: () => T): T {
	fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
	let descriptor: number;
	try {
		descriptor = fs.openSync(lockPath, "wx", 0o600);
	} catch {
		throw new Error(
			`managed worktree finish is already running or lock is not writable: ${lockPath}`,
		);
	}
	try {
		fs.writeFileSync(descriptor, `${process.pid}\n`);
		return operation();
	} finally {
		fs.closeSync(descriptor);
		removePathIfExists(lockPath);
	}
}

export function removePathIfExists(target: string): void {
	fs.rmSync(target, { recursive: true, force: true });
}
