import {
	buildProjectionPlan,
	expectedRemoteArtifactBody,
	parseProjectionMarker,
	projectionDigest,
} from "./projection";
import { externalChangeCandidates } from "./import";
import type {
	ExternalChangeCandidate,
	NativeApproval,
	ProjectionArtifact,
	ProjectionPlan,
	ProjectionResult,
	ProjectionPublishOptions,
	RemoteProjectionState,
	TrackerConfigurationReadback,
	TrackerProjectionAdapter,
	TrackerProvider,
} from "./types";
import type { WorkMapV1 } from "../work-map";

export abstract class CliTrackerProjectionAdapter
	implements TrackerProjectionAdapter
{
	abstract readonly provider: TrackerProvider;
	readonly repository: string;
	readonly #defaultLabels: readonly string[];

	constructor(repository: string, defaultLabels: readonly string[] = []) {
		if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
			throw new Error("repository must be owner/name");
		this.repository = repository;
		this.#defaultLabels = [...new Set(defaultLabels)];
	}

	abstract inspectConfiguration(): Promise<TrackerConfigurationReadback>;
	abstract inspectRemote(workId: string): Promise<RemoteProjectionState>;
	protected abstract writeStep(
		step: ProjectionPlan["steps"][number],
		artifact: ProjectionArtifact,
	): Promise<void>;

	async previewProjection(map: WorkMapV1): Promise<ProjectionPlan> {
		const configuration = await this.inspectConfiguration();
		if (configuration.blockedReason)
			throw new Error(configuration.blockedReason);
		let remote: RemoteProjectionState | null = null;
		try {
			remote = await this.inspectRemote(map.id);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				error.message !== "tracker projection not found"
			)
				throw error;
		}
		return buildProjectionPlan({
			provider: this.provider,
			repository: this.repository,
			map,
			remote,
			defaultLabels: this.#defaultLabels,
		});
	}

	async publish(
		plan: ProjectionPlan,
		approval: NativeApproval,
		options: ProjectionPublishOptions = {},
	): Promise<ProjectionResult> {
		this.assertPlan(plan);
		const completedSteps = options.completedSteps ?? [];
		const knownStepIds = new Set(plan.steps.map((step) => step.id));
		if (completedSteps.some((step) => !knownStepIds.has(step)))
			throw new Error("resume checkpoint contains an unknown projection step");
		const completed = [...completedSteps];
		const firstPending = plan.steps.find(
			(step) => !completed.includes(step.id),
		);
		if (options.onlyStepId && firstPending?.id !== options.onlyStepId) {
			throw new Error(
				`publish step must be the next pending projection step: ${firstPending?.id ?? "none"}`,
			);
		}
		for (const step of plan.steps) {
			if (completed.includes(step.id)) continue;
			if (options.onlyStepId && step.id !== options.onlyStepId) continue;
			const artifact = requiredArtifact(plan, step.artifactStepId);
			try {
				await approval({
					provider: this.provider,
					repository: this.repository,
					operationId: plan.operationId,
					stepId: step.id,
					action: step.action,
					artifact,
				});
				await this.writeStep(step, artifact);
				completed.push(step.id);
				const readback = await this.inspectRemote(plan.workId);
				verifyArtifactReadback(
					artifact,
					readback,
					step.action === "link",
					step.action !== "link",
				);
			} catch (error) {
				return {
					status: "pending",
					operationId: plan.operationId,
					completedSteps: completed,
					pendingSteps: plan.steps
						.filter((item) => !completed.includes(item.id))
						.map((item) => item.id),
					remote: await safeInspect(this, plan.workId),
					blockedReason: error instanceof Error ? error.message : String(error),
				};
			}
			if (options.onlyStepId) break;
		}
		const pendingSteps = plan.steps
			.filter((item) => !completed.includes(item.id))
			.map((item) => item.id);
		if (pendingSteps.length > 0) {
			return {
				status: "pending",
				operationId: plan.operationId,
				completedSteps: completed,
				pendingSteps,
				remote: await safeInspect(this, plan.workId),
			};
		}
		const finalRemote = await this.inspectRemote(plan.workId);
		for (const artifact of plan.artifacts)
			verifyArtifactReadback(artifact, finalRemote, true, false);
		return {
			status: "completed",
			operationId: plan.operationId,
			completedSteps: completed,
			pendingSteps: [],
			remote: finalRemote,
		};
	}

	diff(
		map: WorkMapV1,
		remote: RemoteProjectionState,
	): ExternalChangeCandidate[] {
		return externalChangeCandidates(map, remote);
	}

	private assertPlan(plan: ProjectionPlan): void {
		if (plan.provider !== this.provider || plan.repository !== this.repository)
			throw new Error("projection plan targets a different tracker");
		const { operationDigest, ...unsigned } = plan;
		if (projectionDigest(unsigned) !== operationDigest)
			throw new Error("projection plan digest mismatch");
		if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length)
			throw new Error("projection plan has duplicate steps");
	}
}

function requiredArtifact(
	plan: ProjectionPlan,
	stepId: string,
): ProjectionArtifact {
	const artifact = plan.artifacts.find((item) => item.stepId === stepId);
	if (!artifact) throw new Error(`projection artifact missing: ${stepId}`);
	return artifact;
}

function verifyArtifactReadback(
	artifact: ProjectionArtifact,
	remote: RemoteProjectionState,
	verifyRelationships: boolean,
	allowUnlinkedBody: boolean,
): void {
	const issue =
		artifact.kind === "map"
			? remote.mapIssue
			: remote.ticketIssues[artifact.ticketId ?? ""];
	if (!issue) throw new Error(`tracker readback missing ${artifact.stepId}`);
	const marker = parseProjectionMarker(issue.body);
	if (
		marker.workId !== artifact.workId ||
		marker.ticketId !== artifact.ticketId ||
		marker.digest !== artifact.digest
	)
		throw new Error(`tracker readback marker mismatch: ${artifact.stepId}`);
	const bodyMatches =
		issue.body === expectedRemoteArtifactBody(artifact, remote) ||
		(allowUnlinkedBody && issue.body === artifact.body);
	if (
		issue.title !== artifact.title ||
		!bodyMatches ||
		!hasRequiredLabels(issue.labels, artifact.labels)
	)
		throw new Error(
			`tracker readback protected fields mismatch: ${artifact.stepId}`,
		);
	if (issue.state !== artifact.state)
		throw new Error(`tracker readback state mismatch: ${artifact.stepId}`);
	for (const dependencyId of verifyRelationships
		? artifact.blockedByTicketIds
		: []) {
		const dependency = remote.ticketIssues[dependencyId];
		if (!dependency || !issue.body.includes(dependency.url))
			throw new Error(
				`tracker relationship readback mismatch: ${artifact.stepId} -> ${dependencyId}`,
			);
	}
}

function hasRequiredLabels(
	actual: readonly string[],
	required: readonly string[],
): boolean {
	const labels = new Set(actual);
	if (!required.every((label) => labels.has(label))) return false;
	return sameStrings(
		actual.filter(isGoldbandLabel),
		required.filter(isGoldbandLabel),
	);
}

function isGoldbandLabel(label: string): boolean {
	return label.startsWith("goldband:");
}

function sameStrings(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return [...left].sort().join("\0") === [...right].sort().join("\0");
}

async function safeInspect(
	adapter: CliTrackerProjectionAdapter,
	workId: string,
): Promise<RemoteProjectionState | null> {
	try {
		return await adapter.inspectRemote(workId);
	} catch {
		return null;
	}
}

export function parseArray(value: string, label: string): unknown[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${label} must return an array`);
	return parsed;
}

export function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`invalid ${label}`);
	return value;
}

export function boundedError(value: string): string {
	return value.replace(/[\r\n]+/g, " ").slice(0, 500) || "command failed";
}
