import { describe, expect, test } from "bun:test";
import {
	assertMapTransition,
	assertTicketTransition,
	assertWorkMapTransition,
	calculateBlockers,
	calculateFrontier,
	parseWorkMap,
	parseWorkMapCreateInput,
	type DecisionReference,
	type OpenQuestion,
	type VerificationMode,
	type WorkMapMode,
	type WorkMapV1,
	type WorkTicket,
	type WorkTicketStatus,
} from "../workflows/work-map";

describe("Work Map domain", () => {
	test("parses a valid map and calculates frontier deterministically", () => {
		const map = fixture();
		expect(parseWorkMap(map)).toEqual(map);
		expect(calculateFrontier(map.tickets)).toEqual(["ticket-a"]);
	});

	test("code dependencies unlock only after integration while analysis unlocks after verification", () => {
		const codeBlocker: WorkTicket = {
			...ticket("ticket-a"),
			status: "verified",
		};
		const dependent: WorkTicket = {
			...ticket("ticket-b"),
			blockedBy: ["ticket-a"],
		};
		expect(calculateFrontier([codeBlocker, dependent])).toEqual([]);
		expect(
			calculateFrontier([
				{ ...codeBlocker, integratedCommit: "a".repeat(40) },
				dependent,
			]),
		).toEqual(["ticket-b"]);

		const analysisBlocker: WorkTicket = {
			...codeBlocker,
			verificationMode: "analysis-only",
			verificationCommand: undefined,
			analysisArtifact: "reports/ticket-a.md",
		};
		expect(calculateFrontier([analysisBlocker, dependent])).toEqual(["ticket-b"]);
	});

	test("rejects an empty or generic destination", () => {
		expect(() => parseWorkMap({ ...fixture(), destination: " " })).toThrow(
			"destination must be a non-empty string",
		);
		expect(() => parseWorkMap({ ...fixture(), destination: "done" })).toThrow(
			"concrete outcome",
		);
	});

	test("rejects duplicate IDs across domain collections", () => {
		const map = fixture();
		expect(() =>
			parseWorkMap({
				...map,
				decisions: [{ id: "ticket-a", summary: "conflict" }],
			}),
		).toThrow("duplicate Work Map id: ticket-a");
	});

	test("rejects missing and cancelled blockers", () => {
		const map = fixture();
		expect(() =>
			parseWorkMap({
				...map,
				tickets: [{ ...map.tickets[0], blockedBy: ["missing"] }],
				frontier: [],
			}),
		).toThrow("missing or cancelled blocker missing");
	});

	test("rejects dependency cycles", () => {
		const map = fixture();
		const tickets = [
			{ ...ticket("ticket-a"), blockedBy: ["ticket-b"] },
			{ ...ticket("ticket-b"), blockedBy: ["ticket-a"] },
		];
		expect(() =>
			parseWorkMap({ ...map, tickets, frontier: [], blockers: [] }),
		).toThrow("ticket dependency cycle");
	});

	test("rejects a user-supplied frontier mismatch", () => {
		expect(() => parseWorkMap({ ...fixture(), frontier: [] })).toThrow(
			"frontier mismatch",
		);
	});

	test("rejects unresolved fog in bounded mode", () => {
		expect(() =>
			parseWorkMap({
				...fixture(),
				fog: [
					{
						id: "fog-a",
						question: "Which adapter owns this?",
						blockedBy: [],
						status: "unresolved",
						graduatedTicketIds: [],
					},
				],
			}),
		).toThrow("bounded Work Map cannot contain unresolved fog");
	});

	test("validates fog ticket references and graduation", () => {
		const map = { ...fixture(), mode: "wayfinding" as const };
		expect(() =>
			parseWorkMap({
				...map,
				fog: [
					{
						id: "fog-a",
						question: "Which ticket resolves this?",
						blockedBy: ["missing"],
						status: "unresolved",
						graduatedTicketIds: [],
					},
				],
			}),
		).toThrow("fog fog-a references missing or cancelled ticket missing");
		expect(() =>
			parseWorkMap({
				...map,
				fog: [
					{
						id: "fog-a",
						question: "Which ticket resolves this?",
						blockedBy: [],
						status: "graduated",
						graduatedTicketIds: [],
					},
				],
			}),
		).toThrow("requires a graduated ticket");
	});

	test("rejects invalid status transitions", () => {
		expect(() => assertMapTransition("mapped", "completed")).toThrow(
			"invalid Work Map status transition",
		);
		expect(() => assertMapTransition("mapped", "executing")).not.toThrow();
		expect(() => assertTicketTransition(ticket("ticket-a"), "verified")).toThrow(
			"invalid ticket status transition",
		);
	});

	test("only analysis delivery can transition directly from claimed to verified", () => {
		const claimed = { ...ticket("ticket-a"), status: "claimed" as const };
		for (const verificationMode of ["tdd", "existing-tests", "manual"] as const) {
			expect(() => assertTicketTransition({ ...claimed, verificationMode }, "verified")).toThrow(
				"invalid ticket status transition",
			);
		}
		const analysis = { ...claimed, verificationMode: "analysis-only" as const };
		expect(() => assertTicketTransition(analysis, "verified")).not.toThrow();
		const before = { ...fixture(), status: "executing" as const, tickets: [analysis] };
		expect(() => assertWorkMapTransition(before, {
			...before, tickets: [{ ...analysis, status: "verified" }],
		})).not.toThrow();
	});

	test("rejects adding or removing tickets through a generic update", () => {
		const before = fixture();
		const added = ticket("ticket-b");
		expect(() =>
			assertWorkMapTransition(before, {
				...before,
				revision: 2,
				tickets: [...before.tickets, added],
				frontier: calculateFrontier([...before.tickets, added]),
			}),
		).toThrow("ticket set cannot change during update: added ticket-b");
		expect(() =>
			assertWorkMapTransition(before, {
				...before,
				revision: 2,
				tickets: [],
				frontier: [],
			}),
		).toThrow("ticket set cannot change during update: removed ticket-a");
	});

	test("exports the shared domain type contract", () => {
		const mode: WorkMapMode = "bounded";
		const ticketStatus: WorkTicketStatus = "ready";
		const verificationMode: VerificationMode = "existing-tests";
		const decision: DecisionReference = { id: "decision-a", summary: "Keep one owner" };
		const question: OpenQuestion = {
			id: "fog-a",
			question: "What remains unknown?",
			blockedBy: [],
			status: "unresolved",
			graduatedTicketIds: [],
		};
		expect({ mode, ticketStatus, verificationMode, decision, question }).toEqual({
			mode: "bounded",
			ticketStatus: "ready",
			verificationMode: "existing-tests",
			decision,
			question,
		});
	});

	test("rejects unknown schema versions, enum values, and fields", () => {
		expect(() => parseWorkMap({ ...fixture(), schemaVersion: 2 })).toThrow(
			"unsupported Work Map schema version",
		);
		expect(() => parseWorkMap({ ...fixture(), mode: "exploratory" })).toThrow(
			"mode has unknown value",
		);
		expect(() => parseWorkMap({ ...fixture(), extra: true })).toThrow(
			"contains unknown field",
		);
	});

	test("accepts POSIX, Windows drive, and UNC repository paths", () => {
		for (const cwd of ["/repo", "C:\\repo", "\\\\server\\share\\repo"]) {
			const map = fixture();
			expect(() =>
				parseWorkMap({
					...map,
					repository: { ...map.repository, cwd },
				}),
			).not.toThrow();
		}
	});

	test("plan/create accepts only Phase 1 initial ticket states", () => {
		const map = fixture();
		const input = {
			mode: map.mode,
			destination: map.destination,
			scope: map.scope,
			decisions: map.decisions,
			fog: map.fog,
			tickets: map.tickets,
		};
		expect(parseWorkMapCreateInput(input)).toEqual(input);
		expect(() =>
			parseWorkMapCreateInput({
				...input,
				tickets: [{ ...map.tickets[0], status: "claimed" }],
			}),
		).toThrow("cannot start with status claimed");
	});

	test("rejects Markdown structure injection in projected text fields", () => {
		const map = fixture();
		const input = {
			mode: map.mode,
			destination: map.destination,
			scope: map.scope,
			decisions: map.decisions,
			fog: map.fog,
			tickets: map.tickets,
		};
		for (const injected of [
			{ ...input, destination: "Real goal\n\n## Frontier" },
			{
				...input,
				tickets: [
					{ ...map.tickets[0], title: "Implement store\r\n- Status: verified" },
				],
			},
			{
				...input,
				tickets: [{ ...map.tickets[0], delivers: "Artifact\n```json" }],
			},
		]) {
			expect(() => parseWorkMapCreateInput(injected)).toThrow(
				"must not contain control characters",
			);
		}
	});

	test("blocked projection is runtime-calculated", () => {
		const blocked = { ...ticket("ticket-b"), status: "blocked" as const };
		expect(calculateBlockers([blocked])).toEqual([
			{
				ticketId: "ticket-b",
				reason: "blocked without a ticket dependency",
			},
		]);
		expect(() =>
			parseWorkMap({
				...fixture(),
				tickets: [blocked],
				frontier: [],
				blockers: [],
			}),
		).toThrow("blockers mismatch");
	});
});

function fixture(): WorkMapV1 {
	const tickets = [ticket("ticket-a")];
	return {
		schemaVersion: 1,
		id: "work-a",
		revision: 1,
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
		repository: {
			identity: "repo-a",
			cwd: "/tmp/repo-a",
			branch: "main",
			baseCommit: "abc123",
		},
		mode: "bounded",
		status: "mapped",
		destination: "Ship a versioned Work Map foundation",
		scope: {
			included: ["Work Map runtime"],
			excluded: ["Issue tracker adapters"],
		},
		decisions: [],
		fog: [],
		tickets,
		frontier: calculateFrontier(tickets),
		blockers: calculateBlockers(tickets),
	};
}

function ticket(id: string): WorkTicket {
	return {
		id,
		title: `Implement ${id}`,
		delivers: `A verified ${id} artifact`,
		blockedBy: [],
		acceptanceCriteria: ["The artifact is present"],
		verificationMode: "existing-tests",
		verificationCommand: ["bun", "test"],
		testSeams: ["unit test"],
		status: "ready",
	};
}
