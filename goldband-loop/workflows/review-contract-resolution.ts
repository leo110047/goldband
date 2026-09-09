import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { REVIEW_CONTRACT_ROOT_ENV } from "../lib/review-runtime-contract";
import { assertReviewContractBoundary } from "./review-lineage";
import { stateRoot } from "./evidence";
import {
	digestManifest,
	inspectReviewContractStore,
	type ReviewContractStoreInspection,
	resolveReviewContractRepositoryIdentity,
} from "./review-contract-store";
import {
	loadReviewEvidenceManifest,
	type InitialReviewArtifact,
	type ReviewEvidenceManifest,
	reviewEvidenceManifestSchema,
} from "./review-evidence";
import type { ReviewDiffInput } from "./review-impact";
import {
	type ReviewWorkspaceCoordinates,
	resolveReviewWorkspace,
} from "./review-workspace";
import type { WorkflowContext } from "./types";

const DEFAULT_REVIEW_EVIDENCE_MANIFEST = "goldband.review-evidence.json";
const COMPATIBILITY_IDENTITY =
	"review-evidence-schema-v2/runtime-contract-v2" as const;

type ReviewContractSource = {
	kind:
		| "repository"
		| "runtime-store"
		| "candidate-extension"
		| "explicit-primary"
		| "explicit-extension"
		| "closure-artifact";
	identity: string;
	digest: string;
	importedFrom?: string;
	importedAt?: string;
};

type ReviewCandidateManifest = {
	value?: unknown;
	identity: string;
	selection: "worktree" | "index" | "head";
};

type ReviewManifestProvenance = {
	identity: string;
	trackingState:
		| "absent"
		| "unchanged"
		| "modified"
		| "staged-modified"
		| "staged-new"
		| "untracked"
		| "head";
	digest?: string;
	baseDigest?: string;
};

export type ReviewContractResolution = {
	schemaVersion: 1;
	repositoryIdentity: ReturnType<
		typeof resolveReviewContractRepositoryIdentity
	>;
	workspace: ReviewWorkspaceCoordinates;
	compatibilityIdentity: typeof COMPATIBILITY_IDENTITY;
	baseline: ReviewContractSource;
	candidate?: ReviewContractSource;
	candidateProvenance: ReviewManifestProvenance;
	explicit?: ReviewContractSource;
	effectiveDigest: string;
	shadowedRuntimeStore?: {
		present: boolean;
		identity?: string;
		digest?: string;
		importedFrom?: string;
		importedAt?: string;
		invalidReason?: string;
	};
	schemaMigration?: {
		observedVersion: 1;
		supportedVersion: 2;
		source: string;
	};
};

export type ResolvedReviewContract = {
	manifest: ReviewEvidenceManifest;
	source: string;
	monotonicExtensions: Array<{
		baseline: ReviewEvidenceManifest;
		effective: ReviewEvidenceManifest;
	}>;
	resolution: ReviewContractResolution;
};

export function resolveReviewContract(
	ctx: WorkflowContext,
	input: ReviewDiffInput,
	closureArtifact?: InitialReviewArtifact,
): ResolvedReviewContract {
	const workspace = resolveReviewWorkspace(ctx.cwd);
	const repositoryIdentity = resolveReviewContractRepositoryIdentity(
		workspace.repositoryRoot,
	);
	const explicitFile = ctx.options.evidenceManifestFile
		? resolve(ctx.cwd, ctx.options.evidenceManifestFile)
		: undefined;
	const store = readStoreInspection(ctx);
	const baseRef = resolveBaseRef(workspace.repositoryRoot, ctx.options.base);
	const baseValue = readGitJson(
		workspace.repositoryRoot,
		baseRef,
		DEFAULT_REVIEW_EVIDENCE_MANIFEST,
	);
	const candidateRead = readCandidateManifest(workspace.repositoryRoot, ctx);
	const candidateValue = candidateRead.value;

	let baselineManifest: ReviewEvidenceManifest | undefined;
	let baseline: ReviewContractSource | undefined;
	let schemaMigration: ReviewContractResolution["schemaMigration"];
	let shadowedRuntimeStore: ReviewContractResolution["shadowedRuntimeStore"];
	if (baseValue !== undefined) {
		const identity = `git:${workspace.repositoryRoot}@${baseRef}:${DEFAULT_REVIEW_EVIDENCE_MANIFEST}`;
		const validatedBase = validateBaseManifest(baseValue, candidateValue, identity);
		baselineManifest = validatedBase.manifest;
		if (validatedBase.migrated) {
			schemaMigration = { observedVersion: 1, supportedVersion: 2, source: identity };
		}
		baseline = source("repository", identity, baselineManifest);
		shadowedRuntimeStore = shadowedStoreProvenance(store);
	} else if (store.entry) {
		baselineManifest = store.entry.manifest;
		baseline = {
			...source("runtime-store", store.entryFile, store.entry.manifest),
			importedFrom: store.entry.importedFrom,
			importedAt: store.entry.importedAt,
		};
	} else if (store.invalidReason) {
		throw new Error(store.invalidReason);
	}
	const monotonicExtensions: ResolvedReviewContract["monotonicExtensions"] = [];
	if (candidateValue === undefined && store.entry && baselineManifest &&
		isRegisteredReviewContractExtension(baselineManifest, store.entry.manifest)) {
		monotonicExtensions.push({ baseline: baselineManifest, effective: store.entry.manifest });
		baselineManifest = store.entry.manifest;
		baseline = { ...source("runtime-store", store.entryFile, baselineManifest), importedFrom: store.entry.importedFrom, importedAt: store.entry.importedAt };
		shadowedRuntimeStore = undefined;
	}
	if (baseValue !== undefined && candidateValue === undefined && store.entry?.manifestDigest !== digestManifest(baselineManifest!)) {
		throw new Error(
			`review contract laundering blocked: candidate ${candidateRead.identity} removes the authoritative repository manifest from ${baseRef}`,
		);
	}

	let manifest = baselineManifest;
	let candidate: ReviewContractSource | undefined;
	if (candidateValue !== undefined) {
		const identity = candidateRead.identity;
		const candidateManifest = validateManifest(candidateValue, identity);
		if (!baselineManifest && ctx.options.mode !== "mock") {
			throw new Error(
				"review/code evidence contract has no authoritative base; import the candidate manifest with review contract import --manifest <path> before semantic review",
			);
		}
		if (
			baselineManifest &&
			digestManifest(candidateManifest) !== digestManifest(baselineManifest)
		) {
			monotonicExtensions.push({
				baseline: baselineManifest,
				effective: candidateManifest,
			});
			manifest = candidateManifest;
			candidate = source("candidate-extension", identity, candidateManifest);
		} else if (!baselineManifest) {
			manifest = candidateManifest;
			baseline = source("explicit-primary", identity, candidateManifest);
		}
	}

	const missingContract = !manifest && !explicitFile;
	if (missingContract && closureArtifact) return resolveArtifactContract(ctx.cwd, closureArtifact);
	if (missingContract && ctx.options.mode === "mock") {
		const loaded = loadReviewEvidenceManifest(ctx);
		manifest = loaded.manifest;
		baseline = source("explicit-primary", loaded.source, loaded.manifest);
	}
	if (!manifest && !explicitFile) {
		throw new Error(
			`review/code evidence contract is required before semantic review; repository: ${workspace.repositoryRoot}; registry entry: ${store.entryFile}; run goldband review contract inspect to diagnose project registration`,
		);
	}

	let explicit: ReviewContractSource | undefined;
	if (explicitFile) {
		const loaded = readExplicitContract(ctx, input, explicitFile, manifest);
		if (manifest)
			monotonicExtensions.push({
				baseline: manifest,
				effective: loaded.manifest,
			});
		manifest = loaded.manifest;
		explicit = source(
			baseline ? "explicit-extension" : "explicit-primary",
			realpathSync(explicitFile),
			manifest,
		);
		if (!baseline) baseline = explicit;
	}

	const effective = manifest!;
	return {
		manifest: effective,
		source: explicit?.identity ?? candidate?.identity ?? baseline!.identity,
		monotonicExtensions,
		resolution: {
			schemaVersion: 1,
			repositoryIdentity,
			workspace,
			compatibilityIdentity: COMPATIBILITY_IDENTITY,
			baseline: baseline!,
			...(candidate ? { candidate } : {}),
			candidateProvenance: inspectCandidateProvenance(workspace.repositoryRoot, baseRef, candidateRead, baselineManifest),
			...(explicit ? { explicit } : {}),
			effectiveDigest: digestManifest(effective),
			...(shadowedRuntimeStore ? { shadowedRuntimeStore } : {}),
			...(schemaMigration ? { schemaMigration } : {}),
		},
	};
}

function readExplicitContract(
	ctx: WorkflowContext,
	input: ReviewDiffInput,
	file: string,
	baseline?: ReviewEvidenceManifest,
) {
	if (baseline) return loadReviewEvidenceManifest(ctx, input);
	if (ctx.options.mode !== "mock") throw new Error(
		"review/code explicit manifest is an extension, not an authority; import it before semantic review when no repository base exists",
	);
	return { manifest: validateManifest(JSON.parse(readFileSync(file, "utf8")), file), source: file };
}

function resolveArtifactContract(cwd: string, artifact: InitialReviewArtifact): ResolvedReviewContract {
	const { manifest, manifestSource, contractResolution } = artifact.evidence;
	return {
		manifest, source: manifestSource, monotonicExtensions: [],
		resolution: contractResolution ?? closureArtifactResolution(cwd, manifest, manifestSource),
	};
}

function closureArtifactResolution(
	cwd: string,
	manifest: ReviewEvidenceManifest,
	sourceIdentity: string,
): ReviewContractResolution {
	const workspace = resolveReviewWorkspace(cwd);
	const digest = digestManifest(manifest);
	return {
		schemaVersion: 1,
		repositoryIdentity: resolveReviewContractRepositoryIdentity(
			workspace.repositoryRoot,
		),
		workspace,
		compatibilityIdentity: COMPATIBILITY_IDENTITY,
		baseline: { kind: "closure-artifact", identity: sourceIdentity, digest },
		candidateProvenance: {
			identity: join(
				workspace.repositoryRoot,
				DEFAULT_REVIEW_EVIDENCE_MANIFEST,
			),
			trackingState: "absent",
		},
		effectiveDigest: digest,
	};
}

function validateManifest(
	value: unknown,
	identity: string,
): ReviewEvidenceManifest {
	try {
		return reviewEvidenceManifestSchema.validate(value);
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}; source: ${identity}`,
		);
	}
}

function validateBaseManifest(
	value: unknown,
	candidateValue: unknown | undefined,
	identity: string,
): { manifest: ReviewEvidenceManifest; migrated: boolean } {
	const item = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
	const candidate = candidateValue && typeof candidateValue === "object"
		? candidateValue as Record<string, unknown>
		: undefined;
	if (item?.schemaVersion === 1 && candidate?.schemaVersion === 2) {
		try {
			return {
				manifest: reviewEvidenceManifestSchema.validate({ ...item, schemaVersion: 2 }),
				migrated: true,
			};
		} catch {
			// Fall through to the explicit incompatibility diagnostic. Safety fields
			// are never inferred during the one-version migration boundary.
		}
	}
	return { manifest: validateManifest(value, identity), migrated: false };
}

function source(
	kind: ReviewContractSource["kind"],
	identity: string,
	manifest: ReviewEvidenceManifest,
): ReviewContractSource {
	return { kind, identity, digest: digestManifest(manifest) };
}

function resolveBaseRef(
	repositoryRoot: string,
	requestedBase?: string,
): string {
	if (!requestedBase) return "HEAD";
	return (
		git(repositoryRoot, ["merge-base", requestedBase, "HEAD"]) || requestedBase
	);
}

function readCandidateManifest(
	repositoryRoot: string,
	ctx: WorkflowContext,
): ReviewCandidateManifest {
	if (ctx.options.staged)
		return {
			value: readGitJson(repositoryRoot, ":", DEFAULT_REVIEW_EVIDENCE_MANIFEST),
			identity: `git:${repositoryRoot}@index:${DEFAULT_REVIEW_EVIDENCE_MANIFEST}`,
			selection: "index",
		};
	if (ctx.options.base && !ctx.options.worktree) {
		return {
			value: readGitJson(repositoryRoot, "HEAD", DEFAULT_REVIEW_EVIDENCE_MANIFEST),
			identity: `git:${repositoryRoot}@HEAD:${DEFAULT_REVIEW_EVIDENCE_MANIFEST}`,
			selection: "head",
		};
	}
	const file = join(repositoryRoot, DEFAULT_REVIEW_EVIDENCE_MANIFEST);
	return {
		value: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined,
		identity: file,
		selection: "worktree",
	};
}

function inspectCandidateProvenance(
	repositoryRoot: string,
	baseRef: string,
	candidate: ReviewCandidateManifest,
	resolvedBaseManifest?: ReviewEvidenceManifest,
): ReviewManifestProvenance {
	const identity = candidate.identity;
	const baseValue = readGitJson(
		repositoryRoot,
		baseRef,
		DEFAULT_REVIEW_EVIDENCE_MANIFEST,
	);
	const baseManifest = resolvedBaseManifest ?? (baseValue === undefined
		? undefined
		: validateManifest(baseValue, `git:${baseRef}:${DEFAULT_REVIEW_EVIDENCE_MANIFEST}`));
	const baseDigest = baseManifest ? digestManifest(baseManifest) : undefined;
	if (candidate.value === undefined)
		return {
			identity,
			trackingState: "absent",
			...(baseDigest ? { baseDigest } : {}),
		};
	const candidateManifest = validateManifest(candidate.value, identity);
	const digest = digestManifest(candidateManifest);
	const trackedInHead = gitStatus(repositoryRoot, [
		"cat-file",
		"-e",
		`HEAD:${DEFAULT_REVIEW_EVIDENCE_MANIFEST}`,
	]);
	const trackedInIndex = gitStatus(repositoryRoot, [
		"ls-files",
		"--error-unmatch",
		"--",
		DEFAULT_REVIEW_EVIDENCE_MANIFEST,
	]);
	const stagedChanged = !gitStatus(repositoryRoot, [
		"diff",
		"--cached",
		"--quiet",
		"--",
		DEFAULT_REVIEW_EVIDENCE_MANIFEST,
	]);
	const worktreeChanged = !gitStatus(repositoryRoot, [
		"diff",
		"--quiet",
		"--",
		DEFAULT_REVIEW_EVIDENCE_MANIFEST,
	]);
	const trackingState = candidate.selection === "head"
		? baseRef === "HEAD" ? "unchanged" : "head"
		: candidate.selection === "index"
			? !trackedInHead
				? "staged-new"
				: stagedChanged
					? "staged-modified"
					: "unchanged"
			: !trackedInIndex
				? "untracked"
				: !trackedInHead
					? "staged-new"
					: stagedChanged
						? "staged-modified"
						: worktreeChanged
							? "modified"
							: baseRef === "HEAD"
								? "unchanged"
								: "head";
	return {
		identity,
		trackingState,
		digest,
		...(baseDigest ? { baseDigest } : {}),
	};
}

function readGitJson(
	repositoryRoot: string,
	revision: string,
	path: string,
): unknown | undefined {
	const spec = revision === ":" ? `:${path}` : `${revision}:${path}`;
	const result = spawnSync("git", ["show", spec], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (result.status !== 0) return undefined;
	return JSON.parse(result.stdout);
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

function gitStatus(cwd: string, args: string[]): boolean {
	return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

function readStoreInspection(
	ctx: WorkflowContext,
): Pick<
	ReviewContractStoreInspection,
	"entryFile" | "entry" | "invalidReason"
> {
	return inspectReviewContractStore(
		ctx.cwd, process.env[REVIEW_CONTRACT_ROOT_ENV] ?? stateRoot(ctx.options),
	);
}

function shadowedStoreProvenance(store: Pick<ReviewContractStoreInspection, "entryFile" | "entry" | "invalidReason">): ReviewContractResolution["shadowedRuntimeStore"] {
  if (store.entry) return {
    present: true, identity: store.entryFile, digest: store.entry.manifestDigest,
    importedFrom: store.entry.importedFrom, importedAt: store.entry.importedAt,
  };
  if (store.invalidReason) return { present: true, identity: store.entryFile, invalidReason: store.invalidReason };
  return { present: false };
}

export function isRegisteredReviewContractExtension(before: ReviewEvidenceManifest, after: ReviewEvidenceManifest): boolean {
  try { assertReviewContractBoundary(before, after); return true; } catch { return false; }
}
