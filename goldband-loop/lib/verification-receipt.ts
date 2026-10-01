import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	MANAGED_MARKER,
	type ManagedWorktreeLease,
	readAndValidateLease,
	readJson,
	repositoryId,
	writePrivateJson,
} from "./managed-worktree-contract";
import { runManagedVerificationCommand } from "./managed-worktree-boundary";
import {
	stableJson,
	ticketContractDigest,
	type EvidenceReference,
	type VerificationMode,
	type WorkMapV1,
	type WorkTicket,
} from "../workflows/work-map";
import { WorkMapStore } from "../workflows/work-map-store";
import { detectSecretLikeContent, SECRET_CONTENT_RULES } from "./secret-content";

type VerificationStage = "red" | "green" | "check" | "manual";

type VerificationRecord = {
	stage: VerificationStage;
	command: string[];
	cwd: string;
	startedAt: string;
	durationMs: number;
	exitCode: number;
	outputDigest: string;
	outputSummary: string;
	seam?: string;
	expectedSignal?: string;
	manualSteps?: string[];
	manualStepsDigest?: string;
	observableResult?: string;
	observableResultDigest?: string;
	artifactReference?: string;
	artifactReferenceDigest?: string;
};

export type VerificationReceiptV1 = {
	schemaVersion: 1;
	id: string;
	workId: string;
	workRevision: number;
	ticketId: string;
	leaseId: string;
	claimAttempt: number;
	repositoryIdentity: string;
	worktreePath: string;
	baseCommit: string;
	mode: VerificationMode;
	records: VerificationRecord[];
	candidate: CandidateState;
	createdAt: string;
};

export type CandidateState = {
	changedPathsDigest: string;
	treeDigest: string;
	reviewDiffDigest: string;
};

export type AnalysisArtifactV1 = {
	schemaVersion: 1;
	id: string;
	workId: string;
	workRevision: number;
	ticketId: string;
	claimId: string;
	claimAttempt: number;
	repositoryIdentity: string;
	artifactPath: string;
	artifactDigest: string;
	contentPath: string;
	createdAt: string;
};

export type RecordVerificationOptions = {
	stage: "red" | "green" | "check";
	command: string[];
	seam?: string;
	expectedSignal?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	outputLimitBytes?: number;
};

export type ReviewUntrackedDiffState = {
	includedBytes: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const SUMMARY_LIMIT_BYTES = 4096;
const MANUAL_MAX_STEPS = 32;
const MANUAL_STEP_LIMIT_BYTES = 1024;
const MANUAL_RESULT_LIMIT_BYTES = 4096;
const MANUAL_ARTIFACT_LIMIT_BYTES = 2048;

export function recordVerification(
	options: RecordVerificationOptions,
): VerificationReceiptV1 {
	const context = resolveVerificationContext(
		options.cwd ?? process.cwd(),
		options.env ?? process.env,
	);
	const command = commandArray(options.command);
	assertStageContract(context.ticket, { ...options, command });
	assertSafeVerificationExecutable(command[0]!);
	const startedAt = new Date();
	const started = performance.now();
	const limit = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
	const result = runManagedVerificationCommand(context.lease, command, {
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxBuffer: limit + 1,
	});
	const durationMs = Math.max(0, Math.round(performance.now() - started));
	if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") {
		throw new Error("verification command timed out");
	}
	const stdout = result.stdout ?? Buffer.alloc(0);
	const stderr = result.stderr ?? Buffer.alloc(0);
	const output = Buffer.concat([stdout, stderr]);
	if (output.byteLength > limit || result.error?.message.includes("ENOBUFS")) {
		throw new Error(`verification output exceeds ${limit} bytes`);
	}
	if (result.signal) {
		throw new Error(`verification command terminated by signal ${result.signal}`);
	}
	if (result.status === null) {
		throw new Error(
			`verification command did not return an exit code: ${result.error?.message ?? "unknown failure"}`,
		);
	}
	const text = output.toString("utf8");
	assertCommandOutcome(options, result.status, text);
	const candidate = computeCandidateState(context.lease);
	const previous = readReceiptIfPresent(context.receiptPath);
	const records =
		previous && previous.claimAttempt === context.ticket.claim?.attempt
			? previous.records
			: [];
	if (options.stage === "green") {
		const red = [...records]
			.reverse()
			.find(
				(record) =>
					record.stage === "red" && record.seam === options.seam,
			);
		if (!red) {
			throw new Error("GREEN requires an earlier RED for the same seam");
		}
	}
	const record: VerificationRecord = {
		stage: options.stage,
		command,
		cwd: context.lease.worktreePath,
		startedAt: startedAt.toISOString(),
		durationMs,
		exitCode: result.status,
		outputDigest: sha256(output),
		outputSummary: redactSummary(text),
		...(options.seam ? { seam: options.seam } : {}),
		...(options.expectedSignal
			? { expectedSignal: options.expectedSignal }
			: {}),
	};
	const receipt = buildReceipt(context, [...records, record], candidate);
	writePrivateJson(context.receiptPath, receipt);
	if (options.stage === "green" || options.stage === "check") {
		advanceImplemented(context, receipt);
	}
	return receipt;
}

export function recordManualVerification(input: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	steps: string[];
	observableResult: string;
	artifactReference: string;
}): VerificationReceiptV1 {
	const context = resolveVerificationContext(
		input.cwd ?? process.cwd(),
		input.env ?? process.env,
	);
	if (context.ticket.verificationMode !== "manual") {
		throw new Error("manual verification requires a manual ticket");
	}
	if (
		input.steps.length === 0 ||
		input.steps.length > MANUAL_MAX_STEPS ||
		input.steps.some((step) => step.trim() === "") ||
		!input.observableResult.trim() ||
		!input.artifactReference.trim()
	) {
		throw new Error(
			"manual verification requires steps, observable result, and artifact reference",
		);
	}
	const manualSteps = input.steps.map((step) =>
		redactBoundedManualField(step, "manual step", MANUAL_STEP_LIMIT_BYTES),
	);
	const observableResult = redactBoundedManualField(
		input.observableResult,
		"manual observable result",
		MANUAL_RESULT_LIMIT_BYTES,
	);
	const artifactReference = redactBoundedManualField(
		input.artifactReference,
		"manual artifact reference",
		MANUAL_ARTIFACT_LIMIT_BYTES,
	);
	const candidate = computeCandidateState(context.lease);
	const record: VerificationRecord = {
		stage: "manual",
		command: [],
		cwd: context.lease.worktreePath,
		startedAt: new Date().toISOString(),
		durationMs: 0,
		exitCode: 0,
		outputDigest: sha256(
			Buffer.from(
				stableJson({
					steps: input.steps,
					observableResult: input.observableResult,
					artifactReference: input.artifactReference,
				}),
			),
		),
		outputSummary: observableResult,
		manualSteps,
		manualStepsDigest: sha256(Buffer.from(stableJson(manualSteps))),
		observableResult,
		observableResultDigest: sha256(Buffer.from(observableResult)),
		artifactReference,
		artifactReferenceDigest: sha256(Buffer.from(artifactReference)),
	};
	const receipt = buildReceipt(context, [record], candidate);
	writePrivateJson(context.receiptPath, receipt);
	advanceImplemented(context, receipt);
	return receipt;
}

export function recordAnalysisArtifact(input: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	workId: string;
	ticketId: string;
	artifactPath: string;
}): AnalysisArtifactV1 {
	const env = input.env ?? process.env;
	const cwd = fs.realpathSync(input.cwd ?? process.cwd());
	const repoRoot = gitRaw(["rev-parse", "--show-toplevel"], cwd, 4096)
		.toString("utf8")
		.trim();
	const store = new WorkMapStore({
		cwd: repoRoot,
		goldbandHome: env.GOLDBAND_HOME,
	});
	const map = store.read(input.workId);
	const ticket = map.tickets.find((item) => item.id === input.ticketId);
	if (
		!ticket ||
		!["ready", "claimed"].includes(ticket.status) ||
		ticket.verificationMode !== "analysis-only" ||
		(ticket.status === "claimed" && ticket.claim?.kind !== "analysis") ||
		!ticket.analysisArtifact
	) {
		throw new Error("analysis artifact requires a ready analysis-only ticket");
	}
	const expectedPath = path.resolve(repoRoot, ticket.analysisArtifact);
	const suppliedPath = path.resolve(cwd, input.artifactPath);
	if (suppliedPath !== expectedPath || !isWithin(repoRoot, suppliedPath)) {
		throw new Error("analysis artifact path does not match the ticket contract");
	}
	const before = fs.lstatSync(suppliedPath);
	if (before.isSymbolicLink() || !before.isFile()) {
		throw new Error("analysis artifact must be a regular file");
	}
	if (before.size > 1024 * 1024) {
		throw new Error("analysis artifact exceeds 1048576 bytes");
	}
	if (fs.realpathSync(suppliedPath) !== suppliedPath) {
		throw new Error("analysis artifact must not traverse a symbolic link");
	}
	const content = fs.readFileSync(suppliedPath);
	assertSafeAnalysisContent(content);
	const after = fs.lstatSync(suppliedPath);
	if (
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs
	) {
		throw new Error("analysis artifact changed while being recorded");
	}
	const claimId = ticket.claim?.leaseId ?? randomUUID();
	const claimed = ticket.status === "ready"
		? store.claimTicket({
				workId: map.id,
				ticketId: ticket.id,
				expectedRevision: map.revision,
				owner: "analysis-recorder",
				leaseId: claimId,
				kind: "analysis",
			})
		: map;
	const claimedTicket = claimed.tickets.find((item) => item.id === ticket.id)!;
	const artifactId = randomUUID();
	const artifactRoot = path.join(path.dirname(store.mapPath(map.id)), "analysis");
	fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
	const contentPath = path.join(artifactRoot, `${artifactId}.artifact`);
	fs.writeFileSync(contentPath, content, { mode: 0o600 });
	const artifact: AnalysisArtifactV1 = {
		schemaVersion: 1,
		id: artifactId,
		workId: map.id,
		workRevision: claimed.revision,
		ticketId: ticket.id,
		claimId,
		claimAttempt: claimedTicket.claim!.attempt,
		repositoryIdentity: map.repository.identity,
		artifactPath: ticket.analysisArtifact,
		artifactDigest: sha256(content),
		contentPath,
		createdAt: new Date().toISOString(),
	};
	const metadataPath = path.join(artifactRoot, `${artifactId}.json`);
	writePrivateJson(metadataPath, artifact);
	store.markAnalysisImplemented({
		workId: map.id,
		ticketId: ticket.id,
		expectedRevision: claimed.revision,
		actor: "analysis-recorder",
		analysis: {
			id: artifact.id,
			digest: sha256(Buffer.from(stableJson(artifact))),
			artifactDigest: artifact.artifactDigest,
		},
	});
	return artifact;
}

export function readAndValidateAnalysisArtifact(input: {
	store: WorkMapStore;
	map: WorkMapV1;
	ticket: WorkTicket;
}): { artifact: AnalysisArtifactV1; content: string; path: string } {
	const reference = input.ticket.evidence?.analysis;
	if (
		input.ticket.verificationMode !== "analysis-only" ||
		input.ticket.claim?.kind !== "analysis" ||
		!reference?.artifactDigest
	) {
		throw new Error("ticket lacks analysis artifact evidence");
	}
	const metadataPath = path.join(
		path.dirname(input.store.mapPath(input.map.id)),
		"analysis",
		`${reference.id}.json`,
	);
	const artifact = parseAnalysisArtifact(readJson(metadataPath));
	if (
		artifact.workId !== input.map.id ||
		artifact.ticketId !== input.ticket.id ||
		artifact.claimId !== input.ticket.claim.leaseId ||
		artifact.claimAttempt !== input.ticket.claim.attempt ||
		artifact.repositoryIdentity !== input.map.repository.identity ||
		artifact.artifactPath !== input.ticket.analysisArtifact ||
		artifact.artifactDigest !== reference.artifactDigest ||
		sha256(Buffer.from(stableJson(artifact))) !== reference.digest
	) {
		throw new Error("analysis artifact provenance does not match Work Map binding");
	}
	const content = fs.readFileSync(artifact.contentPath);
	if (sha256(content) !== artifact.artifactDigest) {
		throw new Error("analysis artifact content digest is stale or mismatched");
	}
	assertSafeAnalysisContent(content);
	return { artifact, content: content.toString("utf8"), path: metadataPath };
}

export function readAndValidateVerificationReceipt(input: {
	lease: ManagedWorktreeLease;
	map: WorkMapV1;
	ticket: WorkTicket;
	requireCurrentCandidate?: boolean;
}): { receipt: VerificationReceiptV1; reference: EvidenceReference; path: string } {
	if (!input.lease.workMap) {
		throw new Error("standalone managed worktree has no Work Map verification");
	}
	const receiptPath = verificationReceiptPath(input.lease);
	const receipt = parseReceipt(readJson(receiptPath));
	const binding = input.lease.workMap;
	if (
		receipt.workId !== input.map.id ||
		receipt.ticketId !== input.ticket.id ||
		receipt.leaseId !== input.lease.id ||
		receipt.claimAttempt !== input.ticket.claim?.attempt ||
		receipt.repositoryIdentity !== input.map.repository.identity ||
		receipt.worktreePath !== input.lease.worktreePath ||
		receipt.baseCommit !== input.lease.baseCommit ||
		receipt.mode !== input.ticket.verificationMode ||
		binding.workId !== input.map.id ||
		binding.ticketId !== input.ticket.id ||
		binding.ticketContractDigest !== ticketContractDigest(input.ticket) ||
		input.ticket.claim?.leaseId !== input.lease.id
	) {
		throw new Error("verification receipt provenance does not match Work Map binding");
	}
	assertReceiptMode(receipt, input.ticket);
	if (input.requireCurrentCandidate !== false) {
		const current = computeCandidateState(input.lease);
		if (stableJson(current) !== stableJson(receipt.candidate)) {
			throw new Error("verification receipt is stale for the current candidate");
		}
	}
	return {
		receipt,
		reference: {
			id: receipt.id,
			digest: sha256(Buffer.from(stableJson(receipt))),
			treeDigest: receipt.candidate.treeDigest,
		},
		path: receiptPath,
	};
}

export function computeCandidateState(
	lease: ManagedWorktreeLease,
): CandidateState {
	const paths = gitOutput(
		lease,
		["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z"],
		8 * 1024 * 1024,
	);
	const changedPaths = paths
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.sort();
	const hash = createHash("sha256");
	hash.update(`${lease.baseCommit}\0`);
	hash.update(
		gitOutput(
			lease,
			["diff", "--binary", "--no-ext-diff", "--no-color", "HEAD", "--"],
			32 * 1024 * 1024,
		),
	);
	for (const relative of changedPaths) {
		const absolute = path.resolve(lease.worktreePath, relative);
		if (!isWithin(lease.worktreePath, absolute)) {
			throw new Error(`candidate path escapes managed worktree: ${relative}`);
		}
		hash.update(`\0${relative}\0`);
		if (fs.existsSync(absolute)) {
			const stat = fs.lstatSync(absolute);
			if (stat.isFile()) {
				hash.update(`${gitRegularFileMode(stat)}\0`);
				hash.update(fs.readFileSync(absolute));
			} else if (stat.isSymbolicLink()) {
				hash.update("120000\0");
				hash.update(fs.readlinkSync(absolute));
			}
		}
	}
	const reviewDiff = computeCandidateReviewDiff(lease);
	return {
		changedPathsDigest: sha256(Buffer.from(changedPaths.join("\0"))),
		treeDigest: hash.digest("hex"),
		reviewDiffDigest: sha256(Buffer.from(reviewDiff)),
	};
}

export function computeCandidateReviewDiff(
	lease: ManagedWorktreeLease,
): string {
	const chunks: string[] = [];
	const tracked = gitOutput(
		lease,
		[
			"diff",
			"--binary",
			"--no-ext-diff",
			"--no-textconv",
			"--no-color",
			"HEAD",
			"--",
		],
		32 * 1024 * 1024,
	).toString("utf8");
	if (tracked) chunks.push(tracked);
	const untracked = gitOutput(
		lease,
		["ls-files", "--others", "--exclude-standard", "-z"],
		8 * 1024 * 1024,
	)
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.sort();
	const state: ReviewUntrackedDiffState = { includedBytes: 0 };
	const realRoot = fs.realpathSync(lease.worktreePath);
	for (const relative of untracked) {
		chunks.push(
			materializeReviewUntrackedFile(
				lease.worktreePath,
				realRoot,
				relative,
				state,
			),
		);
	}
	return chunks.join("\n");
}

export function materializeReviewUntrackedFile(
	cwd: string,
	realRoot: string,
	file: string,
	state: ReviewUntrackedDiffState,
	beforeOpen: () => void = () => {},
	afterFirstRead: () => void = () => {},
): string {
	const maxFileBytes = 128 * 1024;
	const maxTotalBytes = 512 * 1024;
	const absolute = path.resolve(cwd, file);
	const relative = path.relative(cwd, absolute);
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(absolute);
	} catch {
		return skippedReviewFile(relative, "unreadable file");
	}
	if (stat.isSymbolicLink()) return skippedReviewFile(relative, "symbolic link");
	if (!stat.isFile()) return skippedReviewFile(relative, "non-regular file");
	const realFile = fs.realpathSync(absolute);
	if (!isWithin(realRoot, realFile)) {
		return skippedReviewFile(relative, "resolved path escapes repository");
	}
	if (stat.size > maxFileBytes) {
		return skippedReviewFile(relative, `file exceeds ${maxFileBytes} byte limit`);
	}
	if (state.includedBytes + stat.size > maxTotalBytes) {
		return skippedReviewFile(
			relative,
			`untracked diff exceeds ${maxTotalBytes} byte total limit`,
		);
	}
	beforeOpen();
	const flags = fs.constants.O_RDONLY |
		(fs.constants.O_NOFOLLOW ?? 0) |
		(fs.constants.O_NONBLOCK ?? 0);
	let descriptor: number | undefined;
	let content: Buffer;
	try {
		descriptor = fs.openSync(absolute, flags);
		const opened = fs.fstatSync(descriptor);
		if (!sameFileVersion(opened, stat)) throw new Error("file changed");
		content = readDescriptor(descriptor, maxFileBytes, afterFirstRead);
		if (!sameFileVersion(fs.fstatSync(descriptor), opened)) {
			throw new Error("file changed");
		}
	} catch {
		return skippedReviewFile(
			relative,
			"file changed or became unreadable during review collection",
		);
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
	if (state.includedBytes + content.length > maxTotalBytes) {
		return skippedReviewFile(
			relative,
			`untracked diff exceeds ${maxTotalBytes} byte total limit`,
		);
	}
	if (isLikelyBinary(content)) return skippedReviewFile(relative, "binary file");
	const text = content.toString("utf8");
	if (text.includes("\uFFFD")) return skippedReviewFile(relative, "non-UTF-8 content");
	const secretMatch = detectSecretLikeContent(text);
	if (secretMatch) {
		return skippedReviewFile(relative, `secret-like content (${secretMatch})`);
	}
	state.includedBytes += content.length;
	const leftPath = gitPatchPath("a", relative);
	const rightPath = gitPatchPath("b", relative);
	const header = [
		`diff --git ${leftPath} ${rightPath}`,
		`new file mode ${gitRegularFileMode(stat)}`,
		"--- /dev/null",
		`+++ ${rightPath}`,
	];
	if (text.length === 0) return `${header.join("\n")}\n`;
	const hasTrailingNewline = text.endsWith("\n");
	const lines = (hasTrailingNewline ? text.slice(0, -1) : text).split("\n");
	const body = lines.map((line) => `+${line}`).join("\n");
	return `${[
		...header,
		`@@ -0,0 +1,${lines.length} @@`,
		body,
		...(hasTrailingNewline ? [] : ["\\ No newline at end of file"]),
	].join("\n")}\n`;
}

function verificationReceiptPath(
	lease: ManagedWorktreeLease,
): string {
	if (!lease.workMap) {
		throw new Error("standalone managed worktree has no verification receipt");
	}
	return path.join(
		lease.stateRoot,
		"worktrees",
		"verification",
		repositoryId(lease.repoRoot, lease.commonGitDir),
		lease.id,
		`${lease.workMap.ticketId}.json`,
	);
}

function resolveVerificationContext(cwd: string, env: NodeJS.ProcessEnv) {
	const root = fs.realpathSync(cwd);
	const lease = readManagedLeaseForWorktree(root);
	if (!lease.workMap) {
		throw new Error("verification requires a Work Map-bound managed lease");
	}
	const claimedLease = env.GOLDBAND_WORKTREE_LEASE_ID;
	if (claimedLease && claimedLease !== lease.id) {
		throw new Error("managed verification environment lease does not match broker lease");
	}
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
		!["claimed", "implemented"].includes(ticket.status) ||
		ticket.claim?.kind !== "managed-worktree" ||
		ticket.claim?.leaseId !== lease.id ||
		ticketContractDigest(ticket) !== lease.workMap.ticketContractDigest
	) {
		throw new Error("managed verification ticket binding is stale or invalid");
	}
	return {
		lease,
		store,
		map,
		ticket,
		receiptPath: verificationReceiptPath(lease),
	};
}

/** Missing markers mean ordinary Git work; malformed existing markers still fail. */
export function findManagedLeaseForWorktree(cwd: string): ManagedWorktreeLease | undefined {
	const root = fs.realpathSync(cwd);
	const gitDir = gitRaw(["rev-parse", "--git-dir"], root, 1024).toString("utf8").trim();
	const marker = path.join(path.resolve(root, gitDir), MANAGED_MARKER);
	if (!fs.lstatSync(marker, { throwIfNoEntry: false })) return undefined;
	return readManagedLeaseForWorktree(cwd);
}

export function readManagedLeaseForWorktree(
	cwd: string,
): ManagedWorktreeLease {
	const root = fs.realpathSync(cwd);
	const gitDir = gitRaw(["rev-parse", "--git-dir"], root, 1024)
		.toString("utf8")
		.trim();
	const markerPath = path.join(path.resolve(root, gitDir), MANAGED_MARKER);
	const marker = readJson(markerPath) as {
		leaseId?: string;
		manifestPath?: string;
	};
	if (!marker.manifestPath || !marker.leaseId) {
		throw new Error("verification requires a valid managed worktree marker");
	}
	const untrustedLease = readJson(marker.manifestPath) as { repoRoot?: unknown };
	if (typeof untrustedLease.repoRoot !== "string") {
		throw new Error("managed verification lease is missing repository identity");
	}
	const lease = readAndValidateLease(
		marker.manifestPath,
		fs.realpathSync(untrustedLease.repoRoot),
	);
	if (
		marker.leaseId !== lease.id ||
		!isWithin(lease.worktreePath, root)
	) {
		throw new Error("verification lease binding is invalid");
	}
	return lease;
}

function assertStageContract(
	ticket: WorkTicket,
	options: RecordVerificationOptions,
): void {
	if (ticket.verificationMode === "analysis-only") {
		throw new Error("analysis-only ticket cannot produce a code candidate");
	}
	if (ticket.verificationMode === "tdd") {
		if (!["red", "green"].includes(options.stage)) {
			throw new Error("tdd ticket requires RED/GREEN verification");
		}
		if (!options.seam || !ticket.testSeams.includes(options.seam)) {
			throw new Error("TDD verification seam is not declared by the ticket");
		}
		if (options.stage === "red" && !options.expectedSignal) {
			throw new Error("RED requires an expected failure signal");
		}
	} else if (options.stage !== "check") {
		throw new Error(
			`${ticket.verificationMode} ticket requires check or its dedicated recorder`,
		);
	}
	if (
		ticket.verificationMode === "existing-tests" &&
		stableJson(options.command) !== stableJson(ticket.verificationCommand)
	) {
		throw new Error(
			"verification command does not match the ticket planning contract",
		);
	}
}

function assertCommandOutcome(
	options: RecordVerificationOptions,
	exitCode: number,
	output: string,
): void {
	if (options.stage === "red") {
		if (exitCode === 0) throw new Error("RED command unexpectedly succeeded");
		if (!output.includes(options.expectedSignal!)) {
			throw new Error("RED output is missing the expected failure signal");
		}
		return;
	}
	if (exitCode !== 0) {
		throw new Error(`${options.stage.toUpperCase()} command failed with exit ${exitCode}`);
	}
}

function assertReceiptMode(
	receipt: VerificationReceiptV1,
	ticket: WorkTicket,
): void {
	if (ticket.verificationMode === "tdd") {
		let greenIndex = -1;
		for (let index = receipt.records.length - 1; index >= 0; index -= 1) {
			if (receipt.records[index]?.stage === "green") {
				greenIndex = index;
				break;
			}
		}
		const green = greenIndex >= 0 ? receipt.records[greenIndex] : undefined;
		const red = green
			? receipt.records
					.slice(0, greenIndex)
					.find(
						(record) => record.stage === "red" && record.seam === green.seam,
					)
			: undefined;
		if (!red || !green || red.exitCode === 0 || green.exitCode !== 0) {
			throw new Error("TDD receipt requires ordered RED and GREEN for one seam");
		}
		return;
	}
	if (
		ticket.verificationMode === "existing-tests" &&
		!receipt.records.some(
			(record) =>
				record.stage === "check" &&
				record.exitCode === 0 &&
				stableJson(record.command) === stableJson(ticket.verificationCommand),
		)
	) {
		throw new Error("existing-tests receipt requires a successful check");
	}
	if (
		ticket.verificationMode === "manual" &&
		!receipt.records.some(
			(record) =>
				record.stage === "manual" &&
				record.manualSteps?.length &&
				/^[a-f0-9]{64}$/.test(record.manualStepsDigest ?? "") &&
				record.observableResult &&
				/^[a-f0-9]{64}$/.test(record.observableResultDigest ?? "") &&
				record.artifactReference &&
				/^[a-f0-9]{64}$/.test(record.artifactReferenceDigest ?? ""),
		)
	) {
		throw new Error("manual receipt is missing concrete observation evidence");
	}
	if (ticket.verificationMode === "analysis-only") {
		throw new Error("analysis-only tickets use named artifacts, not code receipts");
	}
}

function buildReceipt(
	context: ReturnType<typeof resolveVerificationContext>,
	records: VerificationRecord[],
	candidate: CandidateState,
): VerificationReceiptV1 {
	return {
		schemaVersion: 1,
		id:
			readReceiptIfPresent(context.receiptPath)?.claimAttempt ===
			context.ticket.claim?.attempt
				? readReceiptIfPresent(context.receiptPath)?.id ?? randomUUID()
				: randomUUID(),
		workId: context.map.id,
		workRevision: context.map.revision,
		ticketId: context.ticket.id,
		leaseId: context.lease.id,
		claimAttempt: context.ticket.claim!.attempt,
		repositoryIdentity: context.map.repository.identity,
		worktreePath: context.lease.worktreePath,
		baseCommit: context.lease.baseCommit,
		mode: context.ticket.verificationMode,
		records,
		candidate,
		createdAt:
			readReceiptIfPresent(context.receiptPath)?.claimAttempt ===
			context.ticket.claim?.attempt
				? readReceiptIfPresent(context.receiptPath)?.createdAt ??
					new Date().toISOString()
				: new Date().toISOString(),
	};
}

function advanceImplemented(
	context: ReturnType<typeof resolveVerificationContext>,
	receipt: VerificationReceiptV1,
): void {
	context.store.markImplemented({
		workId: context.map.id,
		ticketId: context.ticket.id,
		expectedRevision: context.map.revision,
		actor: "verification-recorder",
		receipt: {
			id: receipt.id,
			digest: sha256(Buffer.from(stableJson(receipt))),
			treeDigest: receipt.candidate.treeDigest,
		},
	});
}

function parseReceipt(value: unknown): VerificationReceiptV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("verification receipt is invalid");
	}
	const receipt = value as VerificationReceiptV1;
	if (
		receipt.schemaVersion !== 1 ||
		typeof receipt.id !== "string" ||
		typeof receipt.workId !== "string" ||
		!Number.isSafeInteger(receipt.workRevision) ||
		typeof receipt.ticketId !== "string" ||
		typeof receipt.leaseId !== "string" ||
		!Number.isSafeInteger(receipt.claimAttempt) ||
		receipt.claimAttempt < 1 ||
		typeof receipt.repositoryIdentity !== "string" ||
		typeof receipt.worktreePath !== "string" ||
		typeof receipt.baseCommit !== "string" ||
		!["tdd", "existing-tests", "manual", "analysis-only"].includes(
			receipt.mode,
		) ||
		!Array.isArray(receipt.records) ||
		!/^[a-f0-9]{64}$/.test(receipt.candidate?.changedPathsDigest) ||
		!/^[a-f0-9]{64}$/.test(receipt.candidate?.treeDigest) ||
		!/^[a-f0-9]{64}$/.test(receipt.candidate?.reviewDiffDigest)
	) {
		throw new Error("verification receipt is invalid");
	}
	return receipt;
}

function parseAnalysisArtifact(value: unknown): AnalysisArtifactV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("analysis artifact metadata is invalid");
	}
	const artifact = value as AnalysisArtifactV1;
	if (
		artifact.schemaVersion !== 1 ||
		typeof artifact.id !== "string" ||
		typeof artifact.workId !== "string" ||
		!Number.isSafeInteger(artifact.workRevision) ||
		typeof artifact.ticketId !== "string" ||
		typeof artifact.claimId !== "string" ||
		!Number.isSafeInteger(artifact.claimAttempt) ||
		artifact.claimAttempt < 1 ||
		typeof artifact.repositoryIdentity !== "string" ||
		typeof artifact.artifactPath !== "string" ||
		!/^[a-f0-9]{64}$/.test(artifact.artifactDigest) ||
		typeof artifact.contentPath !== "string" ||
		Number.isNaN(Date.parse(artifact.createdAt))
	) {
		throw new Error("analysis artifact metadata is invalid");
	}
	return artifact;
}

function readReceiptIfPresent(
	receiptPath: string,
): VerificationReceiptV1 | undefined {
	return fs.existsSync(receiptPath)
		? parseReceipt(readJson(receiptPath))
		: undefined;
}

function redactSummary(output: string): string {
	let redacted = output;
	for (const { pattern } of SECRET_CONTENT_RULES) {
		redacted = redacted.replace(
			new RegExp(pattern.source, `${pattern.flags}g`),
			"[REDACTED]",
		);
	}
	return Buffer.from(redacted).subarray(0, SUMMARY_LIMIT_BYTES).toString("utf8");
}

function redactBoundedManualField(
	value: string,
	label: string,
	maxBytes: number,
): string {
	const trimmed = value.trim();
	if (Buffer.byteLength(trimmed) > maxBytes) {
		throw new Error(`${label} exceeds ${maxBytes} byte limit`);
	}
	return redactSummary(trimmed);
}

function readDescriptor(
	descriptor: number,
	maxBytes: number,
	afterFirstRead: () => void,
): Buffer {
	const chunks: Buffer[] = [];
	let total = 0;
	while (true) {
		const remaining = maxBytes + 1 - total;
		if (remaining <= 0) throw new Error("file exceeds review limit");
		const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
		const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
		if (count === 0) break;
		total += count;
		if (total > maxBytes) throw new Error("file exceeds review limit");
		chunks.push(chunk.subarray(0, count));
		if (chunks.length === 1) afterFirstRead();
	}
	return Buffer.concat(chunks, total);
}

function sameFileVersion(left: fs.Stats, right: fs.Stats): boolean {
	return left.isFile() &&
		right.isFile() &&
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs;
}

function isLikelyBinary(content: Buffer): boolean {
	if (content.includes(0)) return true;
	const sample = content.subarray(0, Math.min(content.length, 4096));
	if (sample.length === 0) return false;
	let suspicious = 0;
	for (const byte of sample) {
		const allowedControl = byte === 9 || byte === 10 || byte === 13;
		if (byte < 32 && !allowedControl) suspicious++;
	}
	return suspicious / sample.length > 0.02;
}

function gitRegularFileMode(stat: fs.Stats): "100644" | "100755" {
	return (stat.mode & 0o111) !== 0 ? "100755" : "100644";
}

function skippedReviewFile(relative: string, reason: string): string {
	const leftPath = gitPatchPath("a", relative);
	const rightPath = gitPatchPath("b", relative);
	return [
		`diff --git ${leftPath} ${rightPath}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ ${rightPath}`,
		"@@ -0,0 +1,1 @@",
		`+[[review/code skipped untracked file: ${reason}]]`,
	].join("\n");
}

function gitPatchPath(side: "a" | "b", relative: string): string {
	const value = `${side}/${relative}`;
	if (!/[\t\n\r"\\]/.test(value)) return value;
	return `"${value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\t", "\\t")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")}"`;
}

function commandArray(value: string[]): string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((item) => typeof item !== "string" || item.length === 0)
	) {
		throw new Error("verification command must be a non-empty argument array");
	}
	return [...value];
}

const SHELL_EXECUTABLES = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"fish",
	"csh",
	"tcsh",
	"cmd",
	"cmd.exe",
	"powershell",
	"powershell.exe",
	"pwsh",
	"env",
]);

function assertSafeVerificationExecutable(executable: string): void {
	if (SHELL_EXECUTABLES.has(path.basename(executable).toLowerCase())) {
		throw new Error(
			"verification command cannot invoke a shell interpreter without native host approval",
		);
	}
}

function assertSafeAnalysisContent(content: Buffer): void {
	if (isLikelyBinary(content)) {
		throw new Error("analysis artifact must be bounded UTF-8 text, not binary content");
	}
	const text = content.toString("utf8");
	if (text.includes("\uFFFD")) {
		throw new Error("analysis artifact must contain valid UTF-8 text");
	}
	const contentViolation = detectSecretLikeContent(text);
	if (contentViolation) {
		throw new Error(
			`analysis artifact contains secret-like content (${contentViolation})`,
		);
	}
}

function gitOutput(
	lease: ManagedWorktreeLease,
	args: string[],
	maxBuffer: number,
): Buffer {
	return gitRaw(args, lease.worktreePath, maxBuffer);
}

function gitRaw(args: string[], cwd: string, maxBuffer: number): Buffer {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "buffer",
		maxBuffer,
		timeout: 10_000,
	});
	if (result.status !== 0) {
		throw new Error(
			`failed to inspect verification candidate: ${(result.stderr ?? Buffer.alloc(0)).toString("utf8").trim()}`,
		);
	}
	return result.stdout ?? Buffer.alloc(0);
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}
