import { describe, expect, test } from "bun:test";
import {
	assembleRemoteProjection,
	buildProjectionPlan,
	linkedRemoteArtifactBody,
	MAX_TRACKER_BODY_BYTES,
	parseProjectionMarker,
	remoteProjectionDigest,
	renderMapProjection,
	renderTicketProjection,
} from "../workflows/tracker-adapters/projection";
import { parseTrackerSyncState } from "../workflows/tracker-adapters/sync-state";
import type { RemoteIssue } from "../workflows/tracker-adapters/types";
import { sampleWorkMap } from "./tracker-test-helpers";

function remoteIssue(id: string, body: string): RemoteIssue {
	return { id, url: `https://tracker.test/${id}`, title: id, body, state: "open", labels: [], assignees: [], comments: [] };
}

describe("tracker projection", () => {
	test("renders deterministic map and ticket markers without local repository paths", () => {
		const map = sampleWorkMap();
		const mapArtifact = renderMapProjection(map);
		const ticketArtifact = renderTicketProjection(map, map.tickets[0]);
		expect(renderMapProjection(map)).toEqual(mapArtifact);
		expect(mapArtifact.body).not.toContain(map.repository.cwd);
		expect(parseProjectionMarker(mapArtifact.body)).toEqual({ kind: "map", schemaVersion: 1, workId: map.id, revision: map.revision, digest: mapArtifact.digest });
		expect(parseProjectionMarker(ticketArtifact.body).ticketId).toBe("ticket-1");
	});

	test("builds deterministic actions while operation identity remains explicit", () => {
		const map = sampleWorkMap();
		const first = buildProjectionPlan({ provider: "github", repository: "owner/repo", map, operationId: "operation-1" });
		const second = buildProjectionPlan({ provider: "github", repository: "owner/repo", map, operationId: "operation-1" });
		expect(first).toEqual(second);
		expect(first.steps.filter((step) => step.action === "create")).toHaveLength(3);
		expect(first.steps.some((step) => step.action === "link")).toBe(true);
		expect(first.steps.every((step) => step.requiresApproval)).toBe(true);
	});

	test("orders every create before dependency links even when tickets are reversed", () => {
		const map = sampleWorkMap();
		map.tickets.reverse();
		const plan = buildProjectionPlan({ provider: "github", repository: "owner/repo", map, operationId: "operation-1" });
		const lastCreate = Math.max(...plan.steps.map((step, index) => step.action === "create" ? index : -1));
		const firstLink = plan.steps.findIndex((step) => step.action === "link");
		expect(firstLink).toBeGreaterThan(lastCreate);
	});

	test("fails closed on secret-shaped text and private user paths", () => {
		expect(() => renderMapProjection(sampleWorkMap({ destination: "API_TOKEN=super-secret-value" }))).toThrow("secret-like content");
		expect(() => renderMapProjection(sampleWorkMap({ destination: "Inspect /Users/alice/private/project" }))).toThrow("private absolute path");
		expect(() => renderMapProjection(sampleWorkMap({ destination: "path=/private/var/folders/xn/secret" }))).toThrow("private absolute path");
		expect(() => renderMapProjection(sampleWorkMap({ destination: "DATABASE_URL=postgres://alice:password@private/db" }))).toThrow(/secret-like content|environment value/);
	});

	test("repairs protected-field drift even when the marker is unchanged", () => {
		const map = sampleWorkMap();
		const artifacts = [renderMapProjection(map), ...map.tickets.map((ticket) => renderTicketProjection(map, ticket))];
		const ticketIssues = Object.fromEntries(artifacts.filter((item) => item.kind === "ticket").map((artifact, index) => [artifact.ticketId as string, { id: String(index + 2), url: `https://tracker/${index + 2}`, title: artifact.title, body: artifact.body, state: artifact.state, labels: artifact.labels, assignees: [], comments: [] }]));
		const mapArtifact = artifacts[0];
		const base = { provider: "github" as const, repository: "owner/repo", workId: map.id, mapIssue: { id: "1", url: "https://tracker/1", title: mapArtifact.title, body: mapArtifact.body, state: mapArtifact.state, labels: mapArtifact.labels, assignees: [], comments: [] }, ticketIssues };
		base.ticketIssues["ticket-2"].body = base.ticketIssues["ticket-2"].body.replace("ticket:ticket-1", base.ticketIssues["ticket-1"].url);
		base.ticketIssues["ticket-1"].title = "tampered title";
		base.ticketIssues["ticket-1"].labels.push("goldband:status:verified");
		const remote = { ...base, digest: remoteProjectionDigest(base) };
		const plan = buildProjectionPlan({ provider: "github", repository: "owner/repo", map, remote, operationId: "operation-1" });
		expect(plan.steps.some((step) => step.id === "update:ticket:ticket-1")).toBe(true);
		base.ticketIssues["ticket-2"].title = "tampered dependent title";
		const dependentPlan = buildProjectionPlan({ provider: "github", repository: "owner/repo", map, remote: { ...base, digest: remoteProjectionDigest(base) }, operationId: "operation-2" });
		expect(dependentPlan.steps.map((step) => step.id)).toEqual(expect.arrayContaining(["update:ticket:ticket-2", "link:ticket:ticket-2:ticket-1"]));
	});

	test("rejects missing, duplicate, unknown, malformed, and oversized markers", () => {
		const marker = renderMapProjection(sampleWorkMap()).body.match(/<!--[\s\S]*?-->/)?.[0] as string;
		expect(() => parseProjectionMarker("none")).toThrow("marker missing");
		expect(() => parseProjectionMarker(`${marker}\n${marker}`)).toThrow("duplicate");
		expect(() => parseProjectionMarker(marker.replace("schema=1", "schema=2"))).toThrow("unsupported");
		expect(() => parseProjectionMarker(marker.replace("work-id=work-1", "work-id=../bad"))).toThrow("invalid work-id");
		expect(() => parseProjectionMarker(`${"x".repeat(MAX_TRACKER_BODY_BYTES + 1)}${marker}`)).toThrow("size limit");
	});

	test("validates checkpoint schema and refuses secret-shaped extra fields", () => {
		const state = {
			schemaVersion: 1, provider: "github", repository: "owner/repo", workId: "work-1", mapRemoteId: "1",
			ticketRemoteIds: { "ticket-1": "2" }, lastLocalRevision: 3, lastRemoteDigest: "a".repeat(64),
			checkpoint: { operationId: "op-1", operationDigest: "b".repeat(64), completedSteps: ["map"], pendingSteps: ["ticket-1"] },
			lastReadbackAt: "2026-08-01T00:00:00.000Z",
		};
		expect(parseTrackerSyncState(state)).toEqual(state);
		expect(() => parseTrackerSyncState({ ...state, token: "secret" })).toThrow("fields");
	});

	for (const [provider, label] of [["github", "GitHub"], ["gitlab", "GitLab"]] as const) {
		test(`${provider} readback assembles markers and rejects incomplete or duplicate projections`, () => {
			const map = sampleWorkMap();
			const mapIssue = remoteIssue("1", renderMapProjection(map).body);
			const ticket = renderTicketProjection(map, map.tickets[0]);
			const ticketIssue = remoteIssue("2", ticket.body);
			const unrelated = remoteIssue("3", "ordinary issue");
			const state = assembleRemoteProjection(provider, "owner/repo", map.id, [mapIssue, ticketIssue, unrelated]);
			expect(state).toMatchObject({ provider, mapIssue, ticketIssues: { "ticket-1": ticketIssue } });
			expect(state.digest).toBe(remoteProjectionDigest({ provider, repository: "owner/repo", workId: map.id, mapIssue, ticketIssues: { "ticket-1": ticketIssue } }));
			expect(linkedRemoteArtifactBody("needs ticket:ticket-1", ["ticket-1"], state)).toBe("needs https://tracker.test/2");
			expect(() => linkedRemoteArtifactBody("needs ticket:ticket-9", ["ticket-9"], state)).toThrow(`${label} dependency readback missing: ticket-9`);
			expect(() => assembleRemoteProjection(provider, "owner/repo", map.id, [mapIssue, { ...mapIssue, id: "9" }])).toThrow("duplicate remote Work Map marker");
			expect(() => assembleRemoteProjection(provider, "owner/repo", map.id, [ticketIssue, { ...ticketIssue, id: "9" }])).toThrow("duplicate remote ticket marker: ticket-1");
			expect(() => assembleRemoteProjection(provider, "owner/repo", map.id, [unrelated])).toThrow("tracker projection not found");
		});
	}
});
