import { createHash } from "node:crypto";
import { isAbsolute, win32 } from "node:path";

const WORK_MAP_SCHEMA_VERSION = 1 as const;

export type WorkMapMode = "bounded" | "wayfinding";
export type WorkMapStatus =
	| "shaping"
	| "mapped"
	| "executing"
	| "verifying"
	| "completed"
	| "blocked"
	| "cancelled";
export type WorkTicketStatus =
	| "draft"
	| "ready"
	| "claimed"
	| "implemented"
	| "verified"
	| "blocked"
	| "cancelled";
export type VerificationMode =
	| "tdd"
	| "existing-tests"
	| "manual"
	| "analysis-only";

export type DecisionReference = {
	id: string;
	summary: string;
	source?: string;
	sourceDigest?: string;
};

export type OpenQuestion = {
	id: string;
	question: string;
	blockedBy: string[];
	status: "unresolved" | "graduated" | "excluded";
	graduatedTicketIds: string[];
};

export type WorkTicket = {
	id: string;
	title: string;
	delivers: string;
	blockedBy: string[];
	acceptanceCriteria: string[];
	verificationMode: VerificationMode;
	verificationCommand?: string[];
	analysisArtifact?: string;
	testSeams: string[];
	status: WorkTicketStatus;
	claim?: TicketClaim;
	evidence?: TicketEvidence;
	blockerReason?: string;
	blockedFrom?: "claimed" | "implemented";
	cancellationReason?: string;
	integratedCommit?: string;
};

type TicketClaim = {
	owner: string;
	claimedAt: string;
	leaseId: string;
	kind: "managed-worktree" | "analysis";
	attempt: number;
	ticketContractDigest: string;
};

export type EvidenceReference = {
	id: string;
	digest: string;
	treeDigest?: string;
	artifactDigest?: string;
};

type TicketEvidence = {
	receipt?: EvidenceReference;
	analysis?: EvidenceReference;
	review?: EvidenceReference;
	requestedChanges?: EvidenceReference;
};

export type WorkBlocker = {
	ticketId: string;
	reason: string;
};

export type WorkMapV1 = {
	schemaVersion: 1;
	id: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	repository: {
		identity: string;
		cwd: string;
		branch: string;
		baseCommit: string;
	};
	mode: WorkMapMode;
	status: WorkMapStatus;
	destination: string;
	scope: {
		included: string[];
		excluded: string[];
	};
	decisions: DecisionReference[];
	fog: OpenQuestion[];
	tickets: WorkTicket[];
	frontier: string[];
	blockers: WorkBlocker[];
};

export type WorkMapCreateInput = Pick<
	WorkMapV1,
	"mode" | "destination" | "scope" | "decisions" | "fog" | "tickets"
>;

const MAP_STATUSES = new Set<WorkMapStatus>([
	"shaping",
	"mapped",
	"executing",
	"verifying",
	"completed",
	"blocked",
	"cancelled",
]);
const TICKET_STATUSES = new Set<WorkTicketStatus>([
	"draft",
	"ready",
	"claimed",
	"implemented",
	"verified",
	"blocked",
	"cancelled",
]);
const INITIAL_TICKET_STATUSES = new Set<WorkTicketStatus>([
	"draft",
	"ready",
	"blocked",
	"cancelled",
]);
const VERIFICATION_MODES = new Set<VerificationMode>([
	"tdd",
	"existing-tests",
	"manual",
	"analysis-only",
]);
const GENERIC_DESTINATIONS = new Set([
	"complete",
	"done",
	"finish",
	"improve",
	"make it better",
	"完成",
	"做完",
	"改善",
]);

const MAP_TRANSITIONS: Record<WorkMapStatus, readonly WorkMapStatus[]> = {
	shaping: ["mapped", "blocked", "cancelled"],
	mapped: ["executing", "blocked", "cancelled"],
	executing: ["verifying", "completed", "blocked", "cancelled"],
	verifying: ["executing", "completed", "blocked", "cancelled"],
	blocked: ["shaping", "mapped", "executing", "verifying", "cancelled"],
	completed: [],
	cancelled: [],
};

const TICKET_TRANSITIONS: Record<
	WorkTicketStatus,
	readonly (WorkTicketStatus | { status: WorkTicketStatus; verificationMode: VerificationMode })[]
> = {
	draft: ["ready", "blocked", "cancelled"],
	ready: ["claimed", "blocked", "cancelled"],
	claimed: ["ready", "implemented", { status: "verified", verificationMode: "analysis-only" }, "blocked", "cancelled"],
	implemented: ["claimed", "verified", "blocked", "cancelled"],
	verified: [],
	blocked: ["draft", "ready", "claimed", "implemented", "cancelled"],
	cancelled: [],
};

export function parseWorkMap(value: unknown): WorkMapV1 {
	const item = strictRecord(value, "Work Map", [
		"schemaVersion",
		"id",
		"revision",
		"createdAt",
		"updatedAt",
		"repository",
		"mode",
		"status",
		"destination",
		"scope",
		"decisions",
		"fog",
		"tickets",
		"frontier",
		"blockers",
	]);
	if (item.schemaVersion !== WORK_MAP_SCHEMA_VERSION) {
		throw new Error(
			`unsupported Work Map schema version: ${String(item.schemaVersion)}`,
		);
	}
	const repository = strictRecord(item.repository, "repository", [
		"identity",
		"cwd",
		"branch",
		"baseCommit",
	]);
	const scope = parseScope(item.scope);
	const decisions = array(item.decisions, "decisions").map(parseDecision);
	const fog = array(item.fog, "fog").map(parseQuestion);
	const tickets = array(item.tickets, "tickets").map(parseTicket);
	const map: WorkMapV1 = {
		schemaVersion: WORK_MAP_SCHEMA_VERSION,
		id: nonEmptyString(item.id, "id"),
		revision: positiveInteger(item.revision, "revision"),
		createdAt: timestamp(item.createdAt, "createdAt"),
		updatedAt: timestamp(item.updatedAt, "updatedAt"),
		repository: {
			identity: nonEmptyString(repository.identity, "repository.identity"),
			cwd: absolutePath(repository.cwd, "repository.cwd"),
			branch: nonEmptyString(repository.branch, "repository.branch"),
			baseCommit: nonEmptyString(
				repository.baseCommit,
				"repository.baseCommit",
			),
		},
		mode: enumValue(item.mode, "mode", new Set(["bounded", "wayfinding"])),
		status: enumValue(item.status, "status", MAP_STATUSES),
		destination: destination(item.destination),
		scope,
		decisions,
		fog,
		tickets,
		frontier: stringArray(item.frontier, "frontier"),
		blockers: array(item.blockers, "blockers").map(parseBlocker),
	};
	validateWorkMap(map);
	return map;
}

export function parseWorkMapCreateInput(value: unknown): WorkMapCreateInput {
	const item = strictRecord(value, "plan/create input", [
		"mode",
		"destination",
		"scope",
		"decisions",
		"fog",
		"tickets",
	]);
	const input: WorkMapCreateInput = {
		mode: enumValue(item.mode, "mode", new Set(["bounded", "wayfinding"])),
		destination: destination(item.destination),
		scope: parseScope(item.scope),
		decisions: array(item.decisions, "decisions").map(parseDecision),
		fog: array(item.fog, "fog").map(parseQuestion),
		tickets: array(item.tickets, "tickets").map(parseTicket),
	};
	for (const ticket of input.tickets) {
		if (!INITIAL_TICKET_STATUSES.has(ticket.status)) {
			throw new Error(
				`plan/create ticket ${ticket.id} cannot start with status ${ticket.status}`,
			);
		}
		if (
			ticket.claim ||
			ticket.evidence ||
			ticket.blockerReason ||
			ticket.cancellationReason ||
			ticket.integratedCommit
		) {
			throw new Error(
				`plan/create ticket ${ticket.id} cannot include runtime-owned evidence`,
			);
		}
	}
	const now = new Date(0).toISOString();
	validateWorkMap({
		schemaVersion: 1,
		id: "validation",
		revision: 1,
		createdAt: now,
		updatedAt: now,
		repository: {
			identity: "validation",
			cwd: "/validation",
			branch: "validation",
			baseCommit: "validation",
		},
		status: "mapped",
		...input,
		frontier: calculateFrontier(input.tickets),
		blockers: calculateBlockers(input.tickets),
	});
	return input;
}

export function calculateFrontier(tickets: readonly WorkTicket[]): string[] {
	const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
	return tickets
		.filter(
			(ticket) =>
				ticket.status === "ready" &&
				ticket.blockedBy.every((blockerId) =>
					isTicketDelivered(byId.get(blockerId)),
				),
		)
		.map((ticket) => ticket.id)
		.sort();
}

export function calculateBlockers(
	tickets: readonly WorkTicket[],
): WorkBlocker[] {
	const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
	return tickets
		.filter((ticket) => ticket.status === "blocked")
		.map((ticket) => {
			const unresolved = ticket.blockedBy.filter(
				(id) => !isTicketDelivered(byId.get(id)),
			);
			return {
				ticketId: ticket.id,
				reason:
					unresolved.length > 0
						? `waiting for ${unresolved.sort().join(", ")}`
						: "blocked without a ticket dependency",
			};
		})
		.sort((left, right) => left.ticketId.localeCompare(right.ticketId));
}

function isTicketDelivered(ticket: WorkTicket | undefined): boolean {
	if (!ticket || ticket.status !== "verified") return false;
	return ticket.verificationMode === "analysis-only" || Boolean(ticket.integratedCommit);
}

export function areTicketsDelivered(tickets: readonly WorkTicket[]): boolean {
	return tickets
		.filter((ticket) => ticket.status !== "cancelled")
		.every((ticket) => isTicketDelivered(ticket));
}

export function assertMapTransition(
	from: WorkMapStatus,
	to: WorkMapStatus,
): void {
	if (from === to) return;
	if (!MAP_TRANSITIONS[from].includes(to)) {
		throw new Error(`invalid Work Map status transition: ${from} -> ${to}`);
	}
}

export function assertTicketTransition(
	ticket: Pick<WorkTicket, "status" | "verificationMode">,
	to: WorkTicketStatus,
): void {
	const from = ticket.status;
	if (from === to) return;
	if (!TICKET_TRANSITIONS[from].some((transition) =>
		typeof transition === "string" ? transition === to :
			transition.status === to && transition.verificationMode === ticket.verificationMode)) {
		throw new Error(`invalid ticket status transition: ${from} -> ${to}`);
	}
}

export function assertWorkMapTransition(
	before: WorkMapV1,
	after: WorkMapV1,
): void {
	assertMapTransition(before.status, after.status);
	const beforeTickets = new Map(
		before.tickets.map((ticket) => [ticket.id, ticket]),
	);
	const afterTicketIds = new Set(after.tickets.map((ticket) => ticket.id));
	const removedTicketIds = [...beforeTickets.keys()]
		.filter((id) => !afterTicketIds.has(id))
		.sort();
	const addedTicketIds = after.tickets
		.map((ticket) => ticket.id)
		.filter((id) => !beforeTickets.has(id))
		.sort();
	if (removedTicketIds.length > 0 || addedTicketIds.length > 0) {
		const changes = [
			...(removedTicketIds.length > 0
				? [`removed ${removedTicketIds.join(", ")}`]
				: []),
			...(addedTicketIds.length > 0
				? [`added ${addedTicketIds.join(", ")}`]
				: []),
		];
		throw new Error(
			`Work Map ticket set cannot change during update: ${changes.join("; ")}`,
		);
	}
	for (const ticket of after.tickets) {
		const previous = beforeTickets.get(ticket.id);
		if (!previous) {
			throw new Error(
				`Work Map ticket is missing from prior revision: ${ticket.id}`,
			);
		}
		assertTicketTransition(previous, ticket.status);
	}
}

export function workMapDigest(map: WorkMapV1): string {
	return createHash("sha256").update(stableJson(map)).digest("hex");
}

export function ticketContractDigest(ticket: WorkTicket): string {
	return createHash("sha256")
		.update(
			stableJson({
				id: ticket.id,
				title: ticket.title,
				delivers: ticket.delivers,
				blockedBy: ticket.blockedBy,
				acceptanceCriteria: ticket.acceptanceCriteria,
				verificationMode: ticket.verificationMode,
				verificationCommand: ticket.verificationCommand,
				analysisArtifact: ticket.analysisArtifact,
				testSeams: ticket.testSeams,
			}),
		)
		.digest("hex");
}

export function stableJson(value: unknown): string {
	return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function validateWorkMap(map: WorkMapV1): void {
	if (new Date(map.updatedAt).getTime() < new Date(map.createdAt).getTime()) {
		throw new Error("updatedAt cannot be earlier than createdAt");
	}
	assertUniqueIds(map);
	assertScopeDoesNotOverlap(map.scope);
	assertDependencies(map.tickets);
	assertFogReferences(map.fog, map.tickets);
	for (const ticket of map.tickets) {
		validateVerificationContract(ticket);
		const requiresClaim = ["claimed", "implemented", "verified"].includes(
			ticket.status,
		);
		if (requiresClaim && !ticket.claim) {
			throw new Error(
				`ticket ${ticket.id} requires a claim binding`,
			);
		}
		if (["implemented", "verified"].includes(ticket.status)) {
			if (ticket.verificationMode === "analysis-only") {
				if (!ticket.evidence?.analysis) {
					throw new Error(
						`ticket ${ticket.id} requires analysis artifact evidence`,
					);
				}
			} else if (!ticket.evidence?.receipt) {
				throw new Error(
					`ticket ${ticket.id} requires verification receipt evidence`,
				);
			}
		}
		if (ticket.blockerReason && ticket.status !== "blocked") {
			throw new Error(
				`ticket ${ticket.id} blocker reason requires blocked status`,
			);
		}
		if (
			(ticket.blockedFrom !== undefined && ticket.status !== "blocked") ||
			(ticket.status === "blocked" &&
				Boolean(ticket.claim) &&
				!["claimed", "implemented"].includes(ticket.blockedFrom ?? ""))
		) {
			throw new Error(`ticket ${ticket.id} blocked state provenance is invalid`);
		}
		if (ticket.cancellationReason && ticket.status !== "cancelled") {
			throw new Error(
				`ticket ${ticket.id} cancellation reason requires cancelled status`,
			);
		}
	}
	const expectedFrontier = calculateFrontier(map.tickets);
	if (!sameStrings(map.frontier, expectedFrontier)) {
		throw new Error(
			`frontier mismatch: expected ${expectedFrontier.join(",") || "(empty)"}`,
		);
	}
	const expectedBlockers = calculateBlockers(map.tickets);
	if (stableJson(map.blockers) !== stableJson(expectedBlockers)) {
		throw new Error("blockers mismatch: blockers are runtime-calculated");
	}
	if (
		map.mode === "bounded" &&
		map.fog.some((question) => question.status === "unresolved")
	) {
		throw new Error("bounded Work Map cannot contain unresolved fog");
	}
	if (
		map.status === "completed" &&
		(map.tickets.some(
			(ticket) => ticket.status !== "verified" && ticket.status !== "cancelled",
		) ||
			map.fog.some((question) => question.status === "unresolved"))
	) {
		throw new Error(
			"completed Work Map requires all active tickets verified and no unresolved fog",
		);
	}
}

function assertUniqueIds(map: WorkMapV1): void {
	const ids = [
		...map.decisions.map((item) => item.id),
		...map.fog.map((item) => item.id),
		...map.tickets.map((item) => item.id),
	];
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) throw new Error(`duplicate Work Map id: ${id}`);
		seen.add(id);
	}
}

function assertScopeDoesNotOverlap(scope: WorkMapV1["scope"]): void {
	const excluded = new Set(scope.excluded.map(normalizeText));
	const overlap = scope.included.find((value) =>
		excluded.has(normalizeText(value)),
	);
	if (overlap) throw new Error(`scope included/excluded overlap: ${overlap}`);
}

function assertDependencies(tickets: readonly WorkTicket[]): void {
	const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
	for (const ticket of tickets) {
		for (const blockerId of ticket.blockedBy) {
			const blocker = byId.get(blockerId);
			if (!blocker || blocker.status === "cancelled") {
				throw new Error(
					`ticket ${ticket.id} references missing or cancelled blocker ${blockerId}`,
				);
			}
			if (blockerId === ticket.id) {
				throw new Error(
					`ticket dependency cycle: ${ticket.id} -> ${ticket.id}`,
				);
			}
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, path: string[]) => {
		if (visiting.has(id)) {
			throw new Error(`ticket dependency cycle: ${[...path, id].join(" -> ")}`);
		}
		if (visited.has(id)) return;
		visiting.add(id);
		const ticket = byId.get(id);
		for (const blockerId of ticket?.blockedBy ?? []) {
			visit(blockerId, [...path, id]);
		}
		visiting.delete(id);
		visited.add(id);
	};
	for (const ticket of tickets) visit(ticket.id, []);
}

function assertFogReferences(
	fog: readonly OpenQuestion[],
	tickets: readonly WorkTicket[],
): void {
	const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
	for (const question of fog) {
		for (const ticketId of [
			...question.blockedBy,
			...question.graduatedTicketIds,
		]) {
			const ticket = byId.get(ticketId);
			if (!ticket || ticket.status === "cancelled") {
				throw new Error(
					`fog ${question.id} references missing or cancelled ticket ${ticketId}`,
				);
			}
		}
		if (
			question.status === "graduated" &&
			question.graduatedTicketIds.length === 0
		) {
			throw new Error(
				`graduated fog ${question.id} requires a graduated ticket`,
			);
		}
	}
}

function parseScope(value: unknown): WorkMapV1["scope"] {
	const item = strictRecord(value, "scope", ["included", "excluded"]);
	return {
		included: stringArray(item.included, "scope.included"),
		excluded: stringArray(item.excluded, "scope.excluded"),
	};
}

function parseDecision(value: unknown, index: number): DecisionReference {
	const item = strictRecord(value, `decisions[${index}]`, [
		"id",
		"summary",
		"source",
		"sourceDigest",
	]);
	return {
		id: nonEmptyString(item.id, `decisions[${index}].id`),
		summary: nonEmptyString(item.summary, `decisions[${index}].summary`),
		...(item.source === undefined
			? {}
			: { source: nonEmptyString(item.source, `decisions[${index}].source`) }),
		...(item.sourceDigest === undefined
			? {}
			: {
					sourceDigest: nonEmptyString(
						item.sourceDigest,
						`decisions[${index}].sourceDigest`,
					),
				}),
	};
}

function parseQuestion(value: unknown, index: number): OpenQuestion {
	const item = strictRecord(value, `fog[${index}]`, [
		"id",
		"question",
		"blockedBy",
		"status",
		"graduatedTicketIds",
	]);
	return {
		id: nonEmptyString(item.id, `fog[${index}].id`),
		question: nonEmptyString(item.question, `fog[${index}].question`),
		blockedBy: stringArray(item.blockedBy, `fog[${index}].blockedBy`),
		status: enumValue(
			item.status,
			`fog[${index}].status`,
			new Set(["unresolved", "graduated", "excluded"]),
		),
		graduatedTicketIds: stringArray(
			item.graduatedTicketIds,
			`fog[${index}].graduatedTicketIds`,
		),
	};
}

function parseTicket(value: unknown, index: number): WorkTicket {
	const item = strictRecord(value, `tickets[${index}]`, [
		"id",
		"title",
		"delivers",
		"blockedBy",
		"acceptanceCriteria",
		"verificationMode",
		"verificationCommand",
		"analysisArtifact",
		"testSeams",
		"status",
		"claim",
		"evidence",
		"blockerReason",
		"blockedFrom",
		"cancellationReason",
		"integratedCommit",
	]);
	return {
		id: nonEmptyString(item.id, `tickets[${index}].id`),
		title: nonEmptyString(item.title, `tickets[${index}].title`),
		delivers: nonEmptyString(item.delivers, `tickets[${index}].delivers`),
		blockedBy: stringArray(item.blockedBy, `tickets[${index}].blockedBy`),
		acceptanceCriteria: nonEmptyStringArray(
			item.acceptanceCriteria,
			`tickets[${index}].acceptanceCriteria`,
		),
		verificationMode: enumValue(
			item.verificationMode,
			`tickets[${index}].verificationMode`,
			VERIFICATION_MODES,
		),
		...(item.verificationCommand === undefined
			? {}
			: {
					verificationCommand: nonEmptyStringArray(
						item.verificationCommand,
						`tickets[${index}].verificationCommand`,
					),
				}),
		...(item.analysisArtifact === undefined
			? {}
			: {
					analysisArtifact: relativeArtifactPath(
						item.analysisArtifact,
						`tickets[${index}].analysisArtifact`,
					),
				}),
		testSeams: stringArray(item.testSeams, `tickets[${index}].testSeams`),
		status: enumValue(item.status, `tickets[${index}].status`, TICKET_STATUSES),
		...(item.claim === undefined
			? {}
			: { claim: parseClaim(item.claim, `tickets[${index}].claim`) }),
		...(item.evidence === undefined
			? {}
			: { evidence: parseEvidence(item.evidence, `tickets[${index}].evidence`) }),
		...(item.blockerReason === undefined
			? {}
			: {
					blockerReason: nonEmptyString(
						item.blockerReason,
						`tickets[${index}].blockerReason`,
					),
				}),
		...(item.blockedFrom === undefined
			? {}
			: {
					blockedFrom: enumValue(
						item.blockedFrom,
						`tickets[${index}].blockedFrom`,
						new Set(["claimed", "implemented"] as const),
					),
				}),
		...(item.cancellationReason === undefined
			? {}
			: {
					cancellationReason: nonEmptyString(
						item.cancellationReason,
						`tickets[${index}].cancellationReason`,
					),
				}),
		...(item.integratedCommit === undefined
			? {}
			: {
					integratedCommit: gitObjectString(
						item.integratedCommit,
						`tickets[${index}].integratedCommit`,
					),
				}),
	};
}

function parseClaim(value: unknown, label: string): TicketClaim {
	const item = strictRecord(value, label, [
		"owner",
		"claimedAt",
		"leaseId",
		"kind",
		"attempt",
		"ticketContractDigest",
	]);
	return {
		owner: nonEmptyString(item.owner, `${label}.owner`),
		claimedAt: timestamp(item.claimedAt, `${label}.claimedAt`),
		leaseId: nonEmptyString(item.leaseId, `${label}.leaseId`),
		kind: enumValue(
			item.kind,
			`${label}.kind`,
			new Set(["managed-worktree", "analysis"]),
		),
		attempt: positiveInteger(item.attempt, `${label}.attempt`),
		ticketContractDigest: digestString(
			item.ticketContractDigest,
			`${label}.ticketContractDigest`,
		),
	};
}

function parseEvidence(value: unknown, label: string): TicketEvidence {
	const item = strictRecord(value, label, [
		"receipt",
		"analysis",
		"review",
		"requestedChanges",
	]);
	return {
		...(item.receipt === undefined
			? {}
			: { receipt: parseEvidenceReference(item.receipt, `${label}.receipt`) }),
		...(item.analysis === undefined
			? {}
			: { analysis: parseEvidenceReference(item.analysis, `${label}.analysis`) }),
		...(item.review === undefined
			? {}
			: { review: parseEvidenceReference(item.review, `${label}.review`) }),
		...(item.requestedChanges === undefined
			? {}
			: {
					requestedChanges: parseEvidenceReference(
						item.requestedChanges,
						`${label}.requestedChanges`,
					),
				}),
	};
}

function parseEvidenceReference(
	value: unknown,
	label: string,
): EvidenceReference {
	const item = strictRecord(value, label, [
		"id",
		"digest",
		"treeDigest",
		"artifactDigest",
	]);
	const reference: EvidenceReference = {
		id: nonEmptyString(item.id, `${label}.id`),
		digest: digestString(item.digest, `${label}.digest`),
	};
	if (item.treeDigest !== undefined) {
		reference.treeDigest = digestString(item.treeDigest, `${label}.treeDigest`);
	}
	if (item.artifactDigest !== undefined) {
		reference.artifactDigest = digestString(
			item.artifactDigest,
			`${label}.artifactDigest`,
		);
	}
	if (Boolean(reference.treeDigest) === Boolean(reference.artifactDigest)) {
		throw new Error(`${label} requires exactly one subject digest`);
	}
	return reference;
}

function parseBlocker(value: unknown, index: number): WorkBlocker {
	const item = strictRecord(value, `blockers[${index}]`, [
		"ticketId",
		"reason",
	]);
	return {
		ticketId: nonEmptyString(item.ticketId, `blockers[${index}].ticketId`),
		reason: nonEmptyString(item.reason, `blockers[${index}].reason`),
	};
}

function strictRecord(
	value: unknown,
	label: string,
	allowedKeys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	const item = value as Record<string, unknown>;
	const allowed = new Set(allowedKeys);
	const unknown = Object.keys(item).find((key) => !allowed.has(key));
	if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
	return item;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	return array(value, label).map((item, index) =>
		nonEmptyString(item, `${label}[${index}]`),
	);
}

function nonEmptyStringArray(value: unknown, label: string): string[] {
	const values = stringArray(value, label);
	if (values.length === 0) throw new Error(`${label} must not be empty`);
	return values;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label} must be a non-empty string`);
	}
	if (/[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`${label} must not contain control characters`);
	}
	return value.trim();
}

function destination(value: unknown): string {
	const result = nonEmptyString(value, "destination");
	if (GENERIC_DESTINATIONS.has(normalizeText(result))) {
		throw new Error("destination must describe a concrete outcome");
	}
	return result;
}

function absolutePath(value: unknown, label: string): string {
	const result = nonEmptyString(value, label);
	if (!isAbsolute(result) && !win32.isAbsolute(result)) {
		throw new Error(`${label} must be absolute`);
	}
	return result;
}

function relativeArtifactPath(value: unknown, label: string): string {
	const result = nonEmptyString(value, label).replaceAll("\\", "/");
	if (
		result.startsWith("/") ||
		win32.isAbsolute(result) ||
		result.split("/").some((part) => part === ".." || part === "")
	) {
		throw new Error(`${label} must be a normalized repository-relative path`);
	}
	return result;
}

function validateVerificationContract(ticket: WorkTicket): void {
	if (ticket.verificationMode === "existing-tests") {
		if (!ticket.verificationCommand?.length) {
			throw new Error(
				`ticket ${ticket.id} existing-tests requires verificationCommand`,
			);
		}
	} else if (ticket.verificationCommand) {
		throw new Error(
			`ticket ${ticket.id} verificationCommand is only valid for existing-tests`,
		);
	}
	if (ticket.verificationMode === "analysis-only") {
		if (!ticket.analysisArtifact) {
			throw new Error(
				`ticket ${ticket.id} analysis-only requires analysisArtifact`,
			);
		}
		if (ticket.testSeams.length > 0) {
			throw new Error(
				`ticket ${ticket.id} analysis-only cannot declare testSeams`,
			);
		}
	} else if (ticket.analysisArtifact) {
		throw new Error(
			`ticket ${ticket.id} analysisArtifact is only valid for analysis-only`,
		);
	}
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
	return Number(value);
}

function digestString(value: unknown, label: string): string {
	const result = nonEmptyString(value, label);
	if (!/^[a-f0-9]{64}$/.test(result)) {
		throw new Error(`${label} must be a SHA-256 digest`);
	}
	return result;
}

function gitObjectString(value: unknown, label: string): string {
	const result = nonEmptyString(value, label);
	if (!/^[a-f0-9]{40,64}$/.test(result)) {
		throw new Error(`${label} must be a Git object id`);
	}
	return result;
}

function timestamp(value: unknown, label: string): string {
	const result = nonEmptyString(value, label);
	if (Number.isNaN(Date.parse(result)))
		throw new Error(`${label} must be ISO-8601`);
	return result;
}

function enumValue<T extends string>(
	value: unknown,
	label: string,
	values: ReadonlySet<T>,
): T {
	if (typeof value !== "string" || !values.has(value as T)) {
		throw new Error(`${label} has unknown value: ${String(value)}`);
	}
	return value as T;
}

function normalizeText(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function sameStrings(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortJson(item)]),
	);
}
