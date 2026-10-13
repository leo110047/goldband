import { createHash, randomUUID } from "node:crypto";
import { detectSecretLikeContent } from "../../lib/secret-content";
import type { WorkMapV1, WorkTicket } from "../work-map";
import type {
	ProjectionArtifact,
	ProjectionPlan,
	RemoteProjectionState,
	RemoteIssue,
	TrackerProvider,
} from "./types";

export const MAX_TRACKER_BODY_BYTES = 256 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MARKER_PATTERN = /<!-- goldband-work-(map|ticket)\n([\s\S]*?)\n-->/g;

export type ParsedProjectionMarker = {
	kind: "map" | "ticket";
	schemaVersion: 1;
	workId: string;
	revision: number;
	digest: string;
	ticketId?: string;
};

export function projectionDigest(value: unknown): string {
	const serializable = JSON.parse(JSON.stringify(value)) as unknown;
	return createHash("sha256").update(stableJson(serializable)).digest("hex");
}

export function renderMapProjection(map: WorkMapV1): ProjectionArtifact {
	const progress = new Map<string, number>();
	for (const status of [
		"ready",
		"claimed",
		"implemented",
		"verified",
		"blocked",
	]) {
		progress.set(
			status,
			map.tickets.filter((ticket) => ticket.status === status).length,
		);
	}
	const content = [
		"## Destination",
		"",
		safeProjectionText(map.destination),
		"",
		"## Scope",
		"",
		"### Included",
		...renderList(map.scope.included),
		"",
		"### Excluded",
		...renderList(map.scope.excluded),
		"",
		"## Decisions",
		...renderList(
			map.decisions.map((decision) => `${decision.id}: ${decision.summary}`),
		),
		"",
		"## Fog",
		...renderList(
			map.fog
				.filter((question) => question.status === "unresolved")
				.map((question) => question.question),
		),
		"",
		"## Progress",
		...(
			["ready", "claimed", "implemented", "verified", "blocked"] as const
		).map((status) => `- ${titleCase(status)}: ${progress.get(status) ?? 0}`),
	].join("\n");
	const digest = projectionDigest({
		kind: "map",
		workId: map.id,
		revision: map.revision,
		content,
	});
	const body = `${content}\n\n${renderMarker({ kind: "map", workId: map.id, revision: map.revision, digest })}\n`;
	assertBodySize(body);
	return {
		stepId: "map",
		kind: "map",
		workId: map.id,
		title: `Work Map: ${oneLine(map.destination)}`,
		body,
		digest,
		labels: ["goldband:work-map"],
		state:
			map.status === "completed" || map.status === "cancelled"
				? "closed"
				: "open",
		blockedByTicketIds: [],
	};
}

export function renderTicketProjection(
	map: WorkMapV1,
	ticket: WorkTicket,
): ProjectionArtifact {
	const content = [
		"## Delivers",
		"",
		safeProjectionText(ticket.delivers),
		"",
		"## Acceptance criteria",
		...ticket.acceptanceCriteria.map(
			(criterion) => `- [ ] ${safeProjectionText(criterion)}`,
		),
		"",
		"## Verification",
		"",
		`- Mode: ${ticket.verificationMode}`,
		`- Seams: ${ticket.testSeams.length > 0 ? ticket.testSeams.map(safeProjectionText).join(", ") : "none"}`,
		"",
		"## Blocked by",
		...renderList(ticket.blockedBy.map((id) => `ticket:${id}`)),
	].join("\n");
	const digest = projectionDigest({
		kind: "ticket",
		workId: map.id,
		ticketId: ticket.id,
		revision: map.revision,
		content,
	});
	const body = `${content}\n\n${renderMarker({
		kind: "ticket",
		workId: map.id,
		ticketId: ticket.id,
		revision: map.revision,
		digest,
	})}\n`;
	assertBodySize(body);
	return {
		stepId: `ticket:${ticket.id}`,
		kind: "ticket",
		workId: map.id,
		ticketId: ticket.id,
		title: safeProjectionText(ticket.title),
		body,
		digest,
		labels: ["goldband:work-ticket", `goldband:status:${ticket.status}`],
		state:
			ticket.status === "verified" || ticket.status === "cancelled"
				? "closed"
				: "open",
		blockedByTicketIds: [...ticket.blockedBy].sort(),
	};
}

export function buildProjectionPlan(input: {
	provider: TrackerProvider;
	repository: string;
	map: WorkMapV1;
	remote?: RemoteProjectionState | null;
	operationId?: string;
	defaultLabels?: readonly string[];
}): ProjectionPlan {
	const artifacts = [
		renderMapProjection(input.map),
		...input.map.tickets.map((ticket) =>
			renderTicketProjection(input.map, ticket),
		),
	];
	for (const artifact of artifacts) {
		artifact.labels = [
			...new Set([...(input.defaultLabels ?? []), ...artifact.labels]),
		].sort();
	}
	const remoteByStep = new Map<string, RemoteIssue>();
	if (input.remote?.mapIssue) remoteByStep.set("map", input.remote.mapIssue);
	for (const [ticketId, issue] of Object.entries(
		input.remote?.ticketIssues ?? {},
	)) {
		remoteByStep.set(`ticket:${ticketId}`, issue);
	}
	const mutationSteps: ProjectionPlan["steps"] = [];
	const relationshipSteps: ProjectionPlan["steps"] = [];
	for (const artifact of artifacts) {
		const remote = remoteByStep.get(artifact.stepId);
		let rewritesBody = false;
		artifact.remoteId = remote?.id;
		if (!remote) {
			rewritesBody = true;
			mutationSteps.push({
				id: `create:${artifact.stepId}`,
				action: "create",
				artifactStepId: artifact.stepId,
				requiresApproval: true,
			});
		} else {
			const marker = parseProjectionMarker(remote.body);
			if (
				marker.workId !== input.map.id ||
				marker.ticketId !== artifact.ticketId
			) {
				throw new Error(`foreign tracker marker for ${artifact.stepId}`);
			}
			if (
				marker.digest !== artifact.digest ||
				marker.revision !== input.map.revision ||
				!projectionProtectedFieldsMatchRemote(
					artifact,
					remote,
					input.remote ?? null,
				)
			) {
				rewritesBody = true;
				mutationSteps.push({
					id: `update:${artifact.stepId}`,
					action: "update",
					artifactStepId: artifact.stepId,
					requiresApproval: true,
				});
			}
			if (remote.state !== artifact.state) {
				mutationSteps.push({
					id: `${artifact.state === "closed" ? "close" : "reopen"}:${artifact.stepId}`,
					action: artifact.state === "closed" ? "close" : "reopen",
					artifactStepId: artifact.stepId,
					requiresApproval: true,
				});
			}
		}
		for (const dependency of artifact.blockedByTicketIds) {
			const dependencyUrl = input.remote?.ticketIssues[dependency]?.url;
			if (
				rewritesBody ||
				!remote ||
				!dependencyUrl ||
				!remote.body.includes(dependencyUrl)
			) {
				relationshipSteps.push({
					id: `link:${artifact.stepId}:${dependency}`,
					action: "link",
					artifactStepId: artifact.stepId,
					requiresApproval: true,
				});
			}
		}
	}
	const operationId = input.operationId ?? randomUUID();
	const unsigned = {
		schemaVersion: 1 as const,
		provider: input.provider,
		repository: validateRepository(input.repository),
		workId: input.map.id,
		localRevision: input.map.revision,
		operationId,
		remoteDigest: input.remote?.digest ?? null,
		artifacts,
		steps: [...mutationSteps, ...relationshipSteps],
	};
	return { ...unsigned, operationDigest: projectionDigest(unsigned) };
}

export function parseProjectionMarker(body: string): ParsedProjectionMarker {
	if (Buffer.byteLength(body) > MAX_TRACKER_BODY_BYTES)
		throw new Error("tracker body exceeds size limit");
	const matches = [...body.matchAll(MARKER_PATTERN)];
	if (matches.length !== 1)
		throw new Error(
			matches.length === 0
				? "Goldband marker missing"
				: "duplicate Goldband marker",
		);
	const kind = matches[0][1] as "map" | "ticket";
	const fields = new Map<string, string>();
	for (const line of matches[0][2].split("\n")) {
		const match = /^([a-z-]+)=([^\r\n]+)$/.exec(line);
		if (!match || fields.has(match[1]))
			throw new Error("invalid Goldband marker field");
		fields.set(match[1], match[2]);
	}
	const expected =
		kind === "map"
			? new Set(["schema", "work-id", "revision", "digest"])
			: new Set([
					"schema",
					"work-id",
					"ticket-id",
					"work-revision",
					"ticket-digest",
				]);
	if (
		fields.size !== expected.size ||
		[...fields.keys()].some((key) => !expected.has(key))
	) {
		throw new Error("unknown Goldband marker field");
	}
	if (fields.get("schema") !== "1")
		throw new Error("unsupported Goldband marker schema");
	const workId = validId(fields.get("work-id"), "work-id");
	const ticketId =
		kind === "ticket"
			? validId(fields.get("ticket-id"), "ticket-id")
			: undefined;
	const revisionText =
		fields.get(kind === "map" ? "revision" : "work-revision") ?? "";
	if (
		!/^[1-9][0-9]*$/.test(revisionText) ||
		!Number.isSafeInteger(Number(revisionText))
	)
		throw new Error("invalid marker revision");
	const digest = fields.get(kind === "map" ? "digest" : "ticket-digest") ?? "";
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("invalid marker digest");
	return {
		kind,
		schemaVersion: 1,
		workId,
		revision: Number(revisionText),
		digest,
		...(ticketId ? { ticketId } : {}),
	};
}

export function remoteProjectionDigest(
	state: Omit<RemoteProjectionState, "digest">,
): string {
	return projectionDigest(state);
}

const PROVIDER_LABELS: Record<TrackerProvider, string> = {
	github: "GitHub",
	gitlab: "GitLab",
};

type RemoteMarkerIndex = {
	mapIssue: RemoteIssue | null;
	ticketIssues: Record<string, RemoteIssue>;
};

function indexRemoteIssue(
	index: RemoteMarkerIndex,
	issue: RemoteIssue,
	workId: string,
): void {
	if (!issue.body.includes("goldband-work-")) return;
	const marker = parseProjectionMarker(issue.body);
	if (marker.workId !== workId) return;
	if (marker.kind === "map") {
		if (index.mapIssue) throw new Error("duplicate remote Work Map marker");
		index.mapIssue = issue;
		return;
	}
	const ticketId = marker.ticketId as string;
	if (index.ticketIssues[ticketId])
		throw new Error(`duplicate remote ticket marker: ${ticketId}`);
	index.ticketIssues[ticketId] = issue;
}

/** Build the readback state for one Work Map from provider issues. */
export function assembleRemoteProjection(
	provider: TrackerProvider,
	repository: string,
	workId: string,
	issues: RemoteIssue[],
): RemoteProjectionState {
	const index: RemoteMarkerIndex = { mapIssue: null, ticketIssues: {} };
	for (const issue of issues) indexRemoteIssue(index, issue, workId);
	if (!index.mapIssue && Object.keys(index.ticketIssues).length === 0)
		throw new Error("tracker projection not found");
	const state = { provider, repository, workId, ...index };
	return { ...state, digest: remoteProjectionDigest(state) };
}

/** Resolve a dependency ticket to its remote issue, failing when readback lacks it. */
export function remoteDependencyIssue(
	state: RemoteProjectionState,
	dependencyId: string,
): RemoteIssue {
	const issue = state.ticketIssues[dependencyId];
	if (!issue)
		throw new Error(
			`${PROVIDER_LABELS[state.provider]} dependency readback missing: ${dependencyId}`,
		);
	return issue;
}

/** Replace ticket references with remote URLs; every dependency must be read back. */
export function linkedRemoteArtifactBody(
	body: string,
	dependencyIds: string[],
	state: RemoteProjectionState,
): string {
	let linked = body;
	for (const dependencyId of dependencyIds) {
		linked = linked.replace(
			`ticket:${dependencyId}`,
			remoteDependencyIssue(state, dependencyId).url,
		);
	}
	return linked;
}

export function expectedRemoteArtifactBody(
	artifact: ProjectionArtifact,
	remote: RemoteProjectionState | null,
): string {
	let body = artifact.body;
	for (const dependencyId of artifact.blockedByTicketIds) {
		const url = remote?.ticketIssues[dependencyId]?.url;
		if (url) body = body.replace(`ticket:${dependencyId}`, url);
	}
	return body;
}

export function projectionProtectedFieldsMatchRemote(
	artifact: ProjectionArtifact,
	issue: RemoteIssue,
	remote: RemoteProjectionState | null,
): boolean {
	return (
		issue.title === artifact.title &&
		issue.body === expectedRemoteArtifactBody(artifact, remote) &&
		hasRequiredLabels(issue.labels, artifact.labels)
	);
}

function renderMarker(
	marker: Omit<ParsedProjectionMarker, "schemaVersion">,
): string {
	return marker.kind === "map"
		? `<!-- goldband-work-map\nschema=1\nwork-id=${validId(marker.workId, "work-id")}\nrevision=${marker.revision}\ndigest=${marker.digest}\n-->`
		: `<!-- goldband-work-ticket\nschema=1\nwork-id=${validId(marker.workId, "work-id")}\nticket-id=${validId(marker.ticketId, "ticket-id")}\nwork-revision=${marker.revision}\nticket-digest=${marker.digest}\n-->`;
}

function safeProjectionText(value: string): string {
	if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
		throw new Error("projection text contains control characters");
	const secret = detectSecretLikeContent(value);
	if (secret)
		throw new Error(`projection text contains secret-like content: ${secret}`);
	if (
		/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|\/private\/|\/var\/folders\/|\/tmp\/|[A-Za-z]:\\|\\\\[^\\\s]+\\[^\\\s]+)/.test(
			value,
		)
	) {
		throw new Error("projection text contains a private absolute path");
	}
	if (/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(value)) {
		throw new Error("projection text contains an environment value");
	}
	return value.replace(/<!--[\s\S]*?-->/g, "[comment removed]").trim();
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

function renderList(items: string[]): string[] {
	return items.length > 0
		? items.map((item) => `- ${safeProjectionText(item)}`)
		: ["- None"];
}

function oneLine(value: string): string {
	return safeProjectionText(value).replace(/\s+/g, " ").slice(0, 180);
}

function titleCase(value: string): string {
	return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function validId(value: string | undefined, label: string): string {
	if (!value || !ID_PATTERN.test(value)) throw new Error(`invalid ${label}`);
	return value;
}

function validateRepository(value: string): string {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value))
		throw new Error("repository must be owner/name");
	return value;
}

function assertBodySize(body: string): void {
	if (Buffer.byteLength(body) > MAX_TRACKER_BODY_BYTES)
		throw new Error("tracker body exceeds size limit");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}
