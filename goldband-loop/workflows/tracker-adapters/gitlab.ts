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
	RemoteIssue,
	RemoteComment,
	RemoteProjectionState,
	TrackerCommandRunner,
} from "./types";

type GitLabIssueWire = {
	iid?: number;
	web_url?: string;
	title?: string;
	description?: string;
	state?: string;
	labels?: string[];
	assignees?: Array<{ username?: string }>;
};

type GitLabNoteWire = {
	id?: number;
	body?: string;
	created_at?: string;
	author?: { username?: string };
};

export class GitLabTrackerAdapter extends CliTrackerProjectionAdapter {
	readonly provider = "gitlab" as const;
	readonly #runner: TrackerCommandRunner;
	readonly #configuration: TrackerConfigurationV1 & {
		mode: "gitlab";
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
			mode: "gitlab",
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
			provider: "gitlab";
		};
	}

	async inspectRemote(workId: string): Promise<RemoteProjectionState> {
		const result = this.#runner("glab", [
			"issue",
			"list",
			"-R",
			this.repository,
			"--all",
			"--per-page",
			"100",
			"--output",
			"json",
		]);
		if (result.status !== 0)
			throw new Error(
				`GitLab issue read failed: ${boundedError(result.stderr)}`,
			);
		const raw = parseArray(
			result.stdout,
			"GitLab issue list",
		) as GitLabIssueWire[];
		const issues = raw.map(parseGitLabIssue);
		for (const issue of issues) {
			if (!issue.body.includes("goldband-work-")) continue;
			const notes = this.#runner("glab", [
				"api",
				`projects/${encodeURIComponent(this.repository)}/issues/${issue.id}/notes`,
				"--paginate",
			]);
			if (notes.status !== 0)
				throw new Error(
					`GitLab comment read failed: ${boundedError(notes.stderr)}`,
				);
			issue.comments = (
				parseArray(notes.stdout, "GitLab issue notes") as GitLabNoteWire[]
			).map(parseGitLabNote);
		}
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
				"-R",
				this.repository,
				"--title",
				artifact.title,
				"--description",
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
				throw new Error(`GitLab issue missing for ${artifact.stepId}`);
			const staleManagedLabels = issue.labels.filter(
				(label) => label.startsWith("goldband:") && !labels.includes(label),
			);
			this.#run([
				"issue",
				"update",
				remoteId,
				"-R",
				this.repository,
				"--title",
				artifact.title,
				"--description",
				artifact.body,
				...labels.flatMap((label) => ["--label", label]),
				...staleManagedLabels.flatMap((label) => ["--unlabel", label]),
			]);
			return;
		}
		if (step.action === "close" || step.action === "reopen") {
			this.#run([
				"issue",
				"update",
				remoteId,
				"-R",
				this.repository,
				"--state",
				step.action === "close" ? "close" : "reopen",
			]);
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
				const target = remoteDependencyIssue(state, dependencyId).id;
				this.#run([
					"api",
					`projects/${encodeURIComponent(this.repository)}/issues/${remoteId}/links`,
					"--method",
					"POST",
					"-f",
					`target_project_id=${this.repository}`,
					"-f",
					`target_issue_iid=${target}`,
					"-f",
					"link_type=blocks",
				]);
			}
			this.#run([
				"issue",
				"update",
				remoteId,
				"-R",
				this.repository,
				"--description",
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
		if (!issue) throw new Error(`GitLab issue missing for ${artifact.stepId}`);
		return issue.id;
	}

	#run(args: string[]): void {
		const result = this.#runner("glab", args);
		if (result.status !== 0)
			throw new Error(`GitLab write failed: ${boundedError(result.stderr)}`);
	}
}

function parseGitLabNote(value: GitLabNoteWire): RemoteComment {
	if (!Number.isSafeInteger(value.id) || (value.id ?? 0) < 1)
		throw new Error("invalid GitLab note ID");
	return {
		id: String(value.id),
		author: requiredString(value.author?.username, "GitLab note author"),
		createdAt: requiredString(value.created_at, "GitLab note timestamp"),
		body: typeof value.body === "string" ? value.body : "",
	};
}

function parseGitLabIssue(value: GitLabIssueWire): RemoteIssue {
	if (!Number.isSafeInteger(value.iid) || (value.iid ?? 0) < 1)
		throw new Error("invalid GitLab issue IID");
	return {
		id: String(value.iid),
		url: requiredString(value.web_url, "GitLab issue url"),
		title: requiredString(value.title, "GitLab issue title"),
		body: typeof value.description === "string" ? value.description : "",
		state: value.state?.toLowerCase() === "closed" ? "closed" : "open",
		labels: value.labels ?? [],
		assignees: (value.assignees ?? []).map((assignee) =>
			requiredString(assignee.username, "GitLab assignee"),
		),
		comments: [],
	};
}

