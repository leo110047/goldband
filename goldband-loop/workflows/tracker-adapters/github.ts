import {
	inspectTrackerConfiguration,
	type TrackerConfigurationV1,
} from "../tracker-config";
import {
	boundedError,
	CliTrackerProjectionAdapter,
	parseArray,
	requiredString,
} from "./cli-adapter";
import {
	assembleRemoteProjection,
	linkedRemoteArtifactBody,
	remoteDependencyIssue,
} from "./projection";
import type {
	ProjectionArtifact,
	ProjectionPlan,
	RemoteComment,
	RemoteIssue,
	RemoteProjectionState,
	TrackerCommandRunner,
} from "./types";

type GitHubIssueWire = {
	number?: number;
	url?: string;
	title?: string;
	body?: string;
	state?: string;
	labels?: Array<{ name?: string } | string>;
	assignees?: Array<{ login?: string } | string>;
	comments?: Array<{
		id?: string;
		author?: { login?: string };
		createdAt?: string;
		body?: string;
	}>;
};

export class GitHubTrackerAdapter extends CliTrackerProjectionAdapter {
	readonly provider = "github" as const;
	readonly #runner: TrackerCommandRunner;
	readonly #configuration: TrackerConfigurationV1 & {
		mode: "github";
		repository: string;
	};

	constructor(input: {
		repository: string;
		runner: TrackerCommandRunner;
		defaultLabels?: string[];
		dependencyCapability?: "native" | "body-links";
	}) {
		super(input.repository, input.defaultLabels);
		this.#runner = input.runner;
		this.#configuration = {
			schemaVersion: 1,
			mode: "github",
			repository: input.repository,
			defaultLabels: input.defaultLabels ?? [],
			dependencyCapability: input.dependencyCapability ?? "body-links",
		};
	}

	async inspectConfiguration() {
		return inspectTrackerConfiguration(
			this.#configuration,
			this.#runner,
		) as ReturnType<typeof inspectTrackerConfiguration> & {
			provider: "github";
		};
	}

	async inspectRemote(workId: string): Promise<RemoteProjectionState> {
		const result = this.#runner("gh", [
			"issue",
			"list",
			"--repo",
			this.repository,
			"--state",
			"all",
			"--limit",
			"1000",
			"--json",
			"number,url,title,body,state,labels,assignees,comments",
		]);
		if (result.status !== 0)
			throw new Error(
				`GitHub issue read failed: ${boundedError(result.stderr)}`,
			);
		const raw = parseArray(
			result.stdout,
			"GitHub issue list",
		) as GitHubIssueWire[];
		const issues = raw.map(parseGitHubIssue);
		return assembleRemoteProjection(this.provider, this.repository, workId, issues);
	}

	protected async writeStep(
		step: ProjectionPlan["steps"][number],
		artifact: ProjectionArtifact,
	): Promise<void> {
		if (step.action === "create") {
			const labels = [
				...new Set([...this.#configuration.defaultLabels, ...artifact.labels]),
			];
			this.#run([
				"issue",
				"create",
				"--repo",
				this.repository,
				"--title",
				artifact.title,
				"--body",
				artifact.body,
				...labels.flatMap((label) => ["--label", label]),
			]);
			return;
		}
		const remoteId =
			artifact.remoteId ?? (await this.#resolveRemoteId(artifact));
		if (step.action === "update") {
			const labels = [
				...new Set([...this.#configuration.defaultLabels, ...artifact.labels]),
			];
			const state = await this.inspectRemote(artifact.workId);
			const issue =
				artifact.kind === "map"
					? state.mapIssue
					: state.ticketIssues[artifact.ticketId ?? ""];
			if (!issue)
				throw new Error(`GitHub issue missing for ${artifact.stepId}`);
			const staleManagedLabels = issue.labels.filter(
				(label) => label.startsWith("goldband:") && !labels.includes(label),
			);
			this.#run([
				"issue",
				"edit",
				remoteId,
				"--repo",
				this.repository,
				"--title",
				artifact.title,
				"--body",
				artifact.body,
				...labels.flatMap((label) => ["--add-label", label]),
				...staleManagedLabels.flatMap((label) => ["--remove-label", label]),
			]);
			return;
		}
		if (step.action === "close" || step.action === "reopen") {
			this.#run(["issue", step.action, remoteId, "--repo", this.repository]);
			return;
		}
		if (step.action === "link") {
			const state = await this.inspectRemote(artifact.workId);
			const linkedBody = linkedRemoteArtifactBody(
				artifact.body,
				artifact.blockedByTicketIds,
				state,
			);
			if (this.#configuration.dependencyCapability === "native") {
				const dependencyId = step.id.split(":").at(-1) ?? "";
				const dependencyRemoteId = remoteDependencyIssue(
					state,
					dependencyId,
				).id;
				this.#run([
					"api",
					`repos/${this.repository}/issues/${remoteId}/dependencies/blocked_by`,
					"--method",
					"POST",
					"-f",
					`issue_id=${dependencyRemoteId}`,
				]);
			}
			this.#run([
				"issue",
				"edit",
				remoteId,
				"--repo",
				this.repository,
				"--body",
				linkedBody,
			]);
		}
	}

	async #resolveRemoteId(artifact: ProjectionArtifact): Promise<string> {
		const state = await this.inspectRemote(artifact.workId);
		const issue =
			artifact.kind === "map"
				? state.mapIssue
				: state.ticketIssues[artifact.ticketId ?? ""];
		if (!issue) throw new Error(`GitHub issue missing for ${artifact.stepId}`);
		return issue.id;
	}

	#run(args: string[]): void {
		const result = this.#runner("gh", args);
		if (result.status !== 0)
			throw new Error(`GitHub write failed: ${boundedError(result.stderr)}`);
	}
}

function parseGitHubIssue(value: GitHubIssueWire): RemoteIssue {
	if (!Number.isSafeInteger(value.number) || (value.number ?? 0) < 1)
		throw new Error("invalid GitHub issue number");
	return {
		id: String(value.number),
		url: requiredString(value.url, "GitHub issue url"),
		title: requiredString(value.title, "GitHub issue title"),
		body: typeof value.body === "string" ? value.body : "",
		state: value.state?.toUpperCase() === "CLOSED" ? "closed" : "open",
		labels: (value.labels ?? []).map((label) =>
			typeof label === "string"
				? label
				: requiredString(label.name, "GitHub label"),
		),
		assignees: (value.assignees ?? []).map((assignee) =>
			typeof assignee === "string"
				? assignee
				: requiredString(assignee.login, "GitHub assignee"),
		),
		comments: (value.comments ?? []).map(
			(comment, index): RemoteComment => ({
				id:
					typeof comment.id === "string"
						? comment.id
						: `${value.number}:comment:${index}`,
				author: comment.author?.login ?? "unknown",
				createdAt: comment.createdAt ?? new Date(0).toISOString(),
				body: comment.body ?? "",
			}),
		),
	};
}

