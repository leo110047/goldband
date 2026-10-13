import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { stateRoot } from "./evidence";
import type {
	SafetyGateContract,
	WorkflowDefinition,
	WorkflowRunOptions,
} from "./types";

type SafetyWorkflowContract = Pick<
	WorkflowDefinition,
	"name" | "riskLevel" | "integrationStatus" | "runtimeOwner" | "safetyGates"
>;

export type SafetyGateAdmission = {
	operation: string;
	mode: string;
	enforcement: "runtime-owner";
	owner: string;
	authorization: SafetyGateContract["authorization"];
	preconditions: string[];
	sideEffects: string[];
	readback: string[];
};

export type SafetyGateVerification = {
	operation: string;
	owner: string;
	state: "verified" | "pending";
	satisfiedPreconditions: string[];
	verifiedReadback: string[];
	reason?: string;
};

type IosQaCheck = {
	id: string;
	device: string;
	status: "pass" | "fail";
	evidence: string;
};

export type IosQaInput = {
	targetScope: {
		project: string;
		scheme: string;
		devices: string[];
	};
	checks: IosQaCheck[];
};

export type SystemUpgradeInput =
	| { phase: "preflight" }
	| {
			phase: "readback";
			preflightId: string;
			oldVersion: string;
			newVersion: string;
			setupVerified: true;
	  };

type RuntimeGateVerifier = {
	owner: string;
	authorization: SafetyGateContract["authorization"];
	preconditions: string[];
	sideEffects: string[];
	readback: string[];
	validateInput(input: unknown): void;
	verify(
		admission: SafetyGateAdmission,
		input: unknown,
		output: unknown,
		options: WorkflowRunOptions,
	): SafetyGateVerification;
};

const RUNTIME_GATE_VERIFIERS: Record<string, RuntimeGateVerifier> = {
	"plan/sync": trackerSyncVerifier(
		"native-host-approval",
		[
			"matching-preview-digest",
			"local-revision-unchanged",
			"remote-digest-unchanged",
		],
		[
			"tracker-issue-create",
			"tracker-issue-update",
			"tracker-relationship-update",
		],
		["remote-markers", "remote-digest", "sync-checkpoint"],
	),
	"plan/sync-preview": trackerSyncVerifier(
		"not-required-read-only",
		["tracker-config-readback", "local-work-map-readback"],
		[],
		["operation-digest", "projection-steps", "approval-requirements"],
	),
	"system/upgrade": {
		owner: "goldband-setup-gate",
		authorization: "native-host-approval",
		preconditions: [
			"trusted-installation",
			"clean-worktree",
			"upgrade-preflight-recorded",
		],
		sideEffects: ["git-fast-forward", "installer-execution"],
		readback: [
			"installed-version",
			"installed-head",
			"setup-status",
			"completed-preflight",
		],
		validateInput(input) {
			parseSystemUpgradeInput(input);
		},
		verify: verifySystemUpgrade,
	},
	"ios/qa": {
		owner: "ios-qa-evidence",
		authorization: "not-required-read-only",
		preconditions: [
			"darwin-platform",
			"xcode-toolchain",
			"target-scope-explicit",
			"qa-checks-supplied",
		],
		sideEffects: [],
		readback: [
			"simulator-inventory",
			"qa-evidence-artifact",
			"untested-device-coverage",
		],
		validateInput(input) {
			parseIosQaInput(input);
		},
		verify: verifyIosQa,
	},
};

export function assertWorkflowSafetyContract(
	workflow: SafetyWorkflowContract,
): void {
	const primary = workflow.safetyGates.find(
		(gate) => gate.operation === workflow.name,
	);
	if (workflow.riskLevel === "high" && !primary) {
		throw new Error(
			`${workflow.name}: high-risk workflow has no primary safety gate`,
		);
	}
	for (const gate of workflow.safetyGates) {
		assertGateOwnership(workflow, gate);
	}
}

export function prepareSafetyGate(
	workflow: WorkflowDefinition,
	input: unknown,
): SafetyGateAdmission | null {
	const gate = resolveSafetyGate(workflow, input);
	if (!gate) return null;
	if (gate.enforcement === "blocked-before-runtime") {
		throw new Error(
			`${gate.operation}: safety gate is blocked-before-runtime; a typed owner is required before integration`,
		);
	}
	const verifier = verifierFor(gate);
	verifier.validateInput(input);
	return {
		...gate,
		enforcement: "runtime-owner",
		owner: verifier.owner,
	};
}

export function verifySafetyGate(
	admission: SafetyGateAdmission,
	input: unknown,
	output: unknown,
	options: WorkflowRunOptions,
): SafetyGateVerification {
	return verifierFor(admission).verify(admission, input, output, options);
}

export function parseIosQaInput(input: unknown): IosQaInput {
	const value = inputRecord(input, "ios/qa input");
	const target = inputRecord(value.targetScope, "ios/qa input.targetScope");
	const devices = uniqueStrings(
		target.devices,
		"ios/qa input.targetScope.devices",
	);
	if (devices.length === 0) {
		throw new Error("ios/qa input.targetScope.devices must be non-empty");
	}
	if (!Array.isArray(value.checks) || value.checks.length === 0) {
		throw new Error("ios/qa input.checks must be a non-empty array");
	}
	const checks = value.checks.map((raw, index) => {
		const item = inputRecord(raw, `ios/qa input.checks[${index}]`);
		const status = requiredString(
			item.status,
			`ios/qa input.checks[${index}].status`,
		);
		if (status !== "pass" && status !== "fail") {
			throw new Error(
				`ios/qa input.checks[${index}].status must be pass or fail`,
			);
		}
		const device = requiredString(
			item.device,
			`ios/qa input.checks[${index}].device`,
		);
		if (!devices.includes(device)) {
			throw new Error(
				`ios/qa input.checks[${index}].device is outside targetScope.devices`,
			);
		}
		return {
			id: requiredString(item.id, `ios/qa input.checks[${index}].id`),
			device,
			status: status as "pass" | "fail",
			evidence: requiredString(
				item.evidence,
				`ios/qa input.checks[${index}].evidence`,
			),
		};
	});
	return {
		targetScope: {
			project: requiredString(
				target.project,
				"ios/qa input.targetScope.project",
			),
			scheme: requiredString(target.scheme, "ios/qa input.targetScope.scheme"),
			devices,
		},
		checks,
	};
}

export function parseSystemUpgradeInput(input: unknown): SystemUpgradeInput {
	const value = inputRecord(input, "system/upgrade input");
	const phase = requiredString(value.phase, "system/upgrade input.phase");
	if (phase === "preflight") return { phase };
	if (phase !== "readback") {
		throw new Error("system/upgrade input.phase must be preflight or readback");
	}
	if (value.setupVerified !== true) {
		throw new Error(
			"system/upgrade input.setupVerified must be true for readback",
		);
	}
	return {
		phase,
		preflightId: requiredString(
			value.preflightId,
			"system/upgrade input.preflightId",
		),
		oldVersion: requiredString(
			value.oldVersion,
			"system/upgrade input.oldVersion",
		),
		newVersion: requiredString(
			value.newVersion,
			"system/upgrade input.newVersion",
		),
		setupVerified: true,
	};
}

function resolveSafetyGate(
	workflow: WorkflowDefinition,
	input: unknown,
): SafetyGateContract | null {
	const operation = operationFor(workflow.name, input);
	const gate = workflow.safetyGates.find(
		(candidate) => candidate.operation === operation,
	);
	if (gate) return gate;
	if (workflow.riskLevel === "high") {
		throw new Error(`${operation}: high-risk operation has no safety gate`);
	}
	return null;
}

function operationFor(workflowName: string, input: unknown): string {
	const record = optionalInputRecord(input);
	if (workflowName === "plan/sync" && record.mode !== "publish-step")
		return "plan/sync-preview";
	if (workflowName === "release/land" && record.mode === "canary") {
		return "release/canary";
	}
	if (workflowName === "ios/qa" && record.mode === "sync") {
		return "ios/sync";
	}
	return workflowName;
}

function trackerSyncVerifier(
	authorization: SafetyGateContract["authorization"],
	preconditions: string[],
	sideEffects: string[],
	readback: string[],
): RuntimeGateVerifier {
	return {
		owner: "tracker-runtime",
		authorization,
		preconditions,
		sideEffects,
		readback,
		validateInput(input) {
			const value = inputRecord(input, "plan/sync input");
			const mode = requiredString(value.mode, "plan/sync input.mode");
			if (!["preview", "inspect", "publish-step"].includes(mode))
				throw new Error(
					"plan/sync input.mode must be preview, inspect, or publish-step",
				);
			requiredString(value.workId, "plan/sync input.workId");
			if (mode === "publish-step") {
				if (
					!/^[a-f0-9]{64}$/.test(
						requiredString(
							value.operationDigest,
							"plan/sync input.operationDigest",
						),
					)
				)
					throw new Error("plan/sync operationDigest must be a SHA-256 digest");
				requiredString(value.stepId, "plan/sync input.stepId");
			}
		},
		verify(admission, input, output, options) {
			const request = inputRecord(input, "plan/sync input");
			const result = inputRecord(output, `${admission.operation} owner output`);
			if (
				result.owner !== "tracker-runtime" ||
				result.operation !== request.mode
			) {
				throw new Error(
					"plan/sync output scope does not match the admitted input",
				);
			}
			if (result.status === "blocked")
				return pendingVerification(admission, String(result.summary));
			if (options.mode !== "real")
				throw new Error(
					"plan/sync: mock output cannot satisfy runtime safety readback",
				);
			if (
				result.mode !== request.mode ||
				result.workId !== request.workId ||
				typeof result.readback !== "object" ||
				result.readback === null
			)
				throw new Error(
					"plan/sync owner readback does not match the admitted input",
				);
			verifyTrackerSyncReadback(
				request,
				inputRecord(result.readback, "plan/sync readback"),
			);
			return verified(admission);
		},
	};
}

function verifyTrackerSyncReadback(
	request: Record<string, unknown>,
	readback: Record<string, unknown>,
): void {
	if (request.mode === "preview") {
		if (
			!/^[a-f0-9]{64}$/.test(
				requiredString(
					readback.operationDigest,
					"plan/sync preview operationDigest",
				),
			) ||
			!Array.isArray(readback.steps)
		) {
			throw new Error("plan/sync preview readback is incomplete");
		}
		if (
			readback.steps.some(
				(raw) =>
					inputRecord(raw, "plan/sync preview step").requiresApproval !== true,
			)
		) {
			throw new Error(
				"plan/sync preview step omitted its approval requirement",
			);
		}
		return;
	}
	if (request.mode === "inspect") {
		if (
			!/^[a-f0-9]{64}$/.test(
				requiredString(readback.remoteDigest, "plan/sync inspect remoteDigest"),
			) ||
			!Array.isArray(readback.candidates) ||
			typeof readback.remote !== "object" ||
			readback.remote === null
		) {
			throw new Error("plan/sync inspect readback is incomplete");
		}
		return;
	}
	const stepId = requiredString(request.stepId, "plan/sync input.stepId");
	if (readback.blockedReason !== undefined)
		throw new Error("plan/sync publish step remains blocked");
	const completed = stringList(
		readback.completedSteps,
		"plan/sync publish completedSteps",
	);
	const pending = stringList(
		readback.pendingSteps,
		"plan/sync publish pendingSteps",
	);
	if (!completed.includes(stepId) || pending.includes(stepId))
		throw new Error("plan/sync publish did not complete the admitted step");
	const plan = inputRecord(readback.plan, "plan/sync publish plan");
	const operationDigest = requiredString(
		request.operationDigest,
		"plan/sync input.operationDigest",
	);
	if (plan.operationDigest !== operationDigest)
		throw new Error("plan/sync publish plan digest mismatch");
	const remote = inputRecord(readback.remote, "plan/sync publish remote");
	const remoteDigest = requiredString(
		remote.digest,
		"plan/sync publish remote.digest",
	);
	if (!/^[a-f0-9]{64}$/.test(remoteDigest))
		throw new Error("plan/sync publish remote digest is invalid");
	const checkpoint = inputRecord(
		readback.checkpoint,
		"plan/sync publish checkpoint",
	);
	const checkpointCompleted = stringList(
		checkpoint.completedSteps,
		"plan/sync checkpoint completedSteps",
	);
	if (
		checkpoint.operationDigest !== operationDigest ||
		checkpoint.lastRemoteDigest !== remoteDigest ||
		!checkpointCompleted.includes(stepId)
	) {
		throw new Error("plan/sync publish checkpoint readback mismatch");
	}
}

function assertGateOwnership(
	workflow: SafetyWorkflowContract,
	gate: SafetyGateContract,
): void {
	if (gate.enforcement === "blocked-before-runtime") {
		if (gate.owner !== null) {
			throw new Error(
				`${gate.operation}: blocked safety gate cannot claim an owner`,
			);
		}
		return;
	}
	if (workflow.integrationStatus !== "integrated") {
		throw new Error(
			`${gate.operation}: registered-only workflow cannot enforce a runtime safety gate`,
		);
	}
	if (!gate.owner || gate.owner !== workflow.runtimeOwner) {
		throw new Error(
			`${gate.operation}: safety gate owner must match the runtime owner`,
		);
	}
	const verifier = verifierFor(gate);
	assertSameContract(gate, verifier);
}

function verifierFor(
	gate: Pick<SafetyGateContract, "operation" | "owner">,
): RuntimeGateVerifier {
	const verifier = RUNTIME_GATE_VERIFIERS[gate.operation];
	if (!verifier) {
		throw new Error(
			`${gate.operation}: runtime safety gate has no contract verifier`,
		);
	}
	if (!gate.owner || gate.owner !== verifier.owner) {
		throw new Error(`${gate.operation}: safety gate verifier owner mismatch`);
	}
	return verifier;
}

function assertSameContract(
	gate: SafetyGateContract,
	verifier: RuntimeGateVerifier,
): void {
	if (gate.authorization !== verifier.authorization) {
		throw new Error(
			`${gate.operation}: verifier authorization contract mismatch`,
		);
	}
	for (const field of ["preconditions", "sideEffects", "readback"] as const) {
		if (!sameStrings(gate[field], verifier[field])) {
			throw new Error(`${gate.operation}: verifier ${field} contract mismatch`);
		}
	}
}

function verifyIosQa(
	admission: SafetyGateAdmission,
	input: unknown,
	output: unknown,
	options: WorkflowRunOptions,
): SafetyGateVerification {
	const request = parseIosQaInput(input);
	const result = ownedOutput(output, admission, "ios qa evidence");
	if (
		result.status === "blocked" &&
		stringList(result.artifacts, "ios/qa output.artifacts").length === 0
	) {
		return pendingVerification(admission, String(result.summary));
	}
	if (options.mode !== "real") {
		throw new Error(
			"ios/qa: mock output cannot satisfy runtime safety readback",
		);
	}
	if (result.darwinPlatform !== true || result.xcodeToolchain !== true) {
		throw new Error(
			"ios/qa: owner did not verify the platform and Xcode toolchain",
		);
	}
	if (!sameJson(result.targetScope, request.targetScope)) {
		throw new Error(
			"ios/qa: owner target scope does not match the admitted input",
		);
	}
	if (!sameJson(result.checks, request.checks)) {
		throw new Error("ios/qa: owner checks do not match the admitted input");
	}
	const inventoryDigest = requiredString(
		result.simulatorInventoryDigest,
		"ios/qa output.simulatorInventoryDigest",
	);
	const availableDevices = uniqueStrings(
		result.availableDevices,
		"ios/qa output.availableDevices",
	);
	const untested = stringList(
		result.untestedDeviceCoverage,
		"ios/qa output.untestedDeviceCoverage",
	);
	const expectedUntested = request.targetScope.devices.filter(
		(device) =>
			!new Set(request.checks.map((check) => check.device)).has(device),
	);
	if (!sameStrings(untested, expectedUntested)) {
		throw new Error(
			"ios/qa: untested device coverage does not match the admitted scope",
		);
	}
	const artifact = singleTrustedArtifact(
		result.artifacts,
		"ios/qa",
		join(stateRoot(options), "workflow-runs", "artifacts"),
	);
	const artifactRecord = readTrustedJson(artifact, "ios/qa evidence artifact");
	const expectedArtifact = {
		schemaVersion: 1,
		targetScope: request.targetScope,
		checks: request.checks,
		darwinPlatform: true,
		xcodeToolchain: true,
		simulatorInventoryDigest: inventoryDigest,
		availableDevices,
		untestedDeviceCoverage: expectedUntested,
	};
	if (!sameJson(artifactRecord, expectedArtifact)) {
		throw new Error("ios/qa: evidence artifact does not match owner readback");
	}
	return verified(admission);
}

function verifySystemUpgrade(
	admission: SafetyGateAdmission,
	input: unknown,
	output: unknown,
	options: WorkflowRunOptions,
): SafetyGateVerification {
	const request = parseSystemUpgradeInput(input);
	const result = ownedOutput(output, admission, "goldband setup");
	if (result.status === "blocked") {
		if (request.phase === "preflight" && result.preflightId !== undefined) {
			const artifact = singleTrustedArtifact(
				result.artifacts,
				"system/upgrade",
				join(stateRoot(options), "system-upgrade"),
			);
			const preflight = readTrustedJson(artifact, "system upgrade preflight");
			assertSystemPreflight(preflight);
			if (
				preflight.status !== "pending" ||
				preflight.preflightId !== result.preflightId
			) {
				throw new Error(
					"system/upgrade: pending output does not match preflight readback",
				);
			}
			return {
				...pendingVerification(admission, "native-host-approval-required"),
				satisfiedPreconditions: [...admission.preconditions],
			};
		}
		return pendingVerification(admission, String(result.summary));
	}
	if (request.phase !== "readback") {
		throw new Error("system/upgrade: completed output requires readback phase");
	}
	if (
		result.preflightId !== request.preflightId ||
		result.oldVersion !== request.oldVersion ||
		result.newVersion !== request.newVersion ||
		result.setupVerified !== true
	) {
		throw new Error(
			"system/upgrade: completed output does not match admitted readback",
		);
	}
	const newHead = requiredString(
		result.newHead,
		"system/upgrade output.newHead",
	);
	const artifact = singleTrustedArtifact(
		result.artifacts,
		"system/upgrade",
		join(stateRoot(options), "system-upgrade"),
	);
	const preflight = readTrustedJson(artifact, "system upgrade preflight");
	assertSystemPreflight(preflight);
	if (
		preflight.status !== "completed" ||
		preflight.preflightId !== request.preflightId ||
		preflight.oldVersion !== request.oldVersion ||
		preflight.newVersion !== request.newVersion ||
		preflight.newHead !== newHead ||
		typeof preflight.completedAt !== "string"
	) {
		throw new Error(
			"system/upgrade: completed preflight does not match owner readback",
		);
	}
	return verified(admission);
}

function assertSystemPreflight(preflight: Record<string, unknown>): void {
	if (preflight.schemaVersion !== 1) {
		throw new Error("system/upgrade: preflight schema version is invalid");
	}
	for (const field of [
		"preflightId",
		"root",
		"runtimeRoot",
		"setupPath",
		"oldVersion",
		"oldHead",
		"createdAt",
	]) {
		requiredString(preflight[field], `system upgrade preflight.${field}`);
	}
	if (
		preflight.trustedInstallation !== true ||
		preflight.cleanWorktree !== true
	) {
		throw new Error(
			"system/upgrade: preflight did not verify installation trust and clean worktree",
		);
	}
	assertInstallationChecks(preflight.installationChecks);
	if (
		!Array.isArray(preflight.nextCommands) ||
		preflight.nextCommands.length !== 2 ||
		preflight.nextCommands.some(
			(command) =>
				!Array.isArray(command) ||
				command.length === 0 ||
				command.some((part) => typeof part !== "string" || part.length === 0),
		)
	) {
		throw new Error("system/upgrade: preflight nextCommands are invalid");
	}
	const commands = preflight.nextCommands as string[][];
	if (
		!sameStrings(commands[0], [
			"git",
			"-C",
			String(preflight.root),
			"pull",
			"--ff-only",
		]) ||
		!sameStrings(commands[1], [String(preflight.setupPath), "-q"])
	) {
		throw new Error(
			"system/upgrade: preflight commands do not match trusted source state",
		);
	}
}

function assertInstallationChecks(value: unknown): void {
	if (!Array.isArray(value) || value.length < 3) {
		throw new Error("system/upgrade: installation checks are missing");
	}
	const checks = value.map((raw, index) =>
		inputRecord(raw, `system upgrade installationChecks[${index}]`),
	);
	if (checks.some((check) => check.status !== "pass")) {
		throw new Error("system/upgrade: installation checks did not all pass");
	}
	const ids = new Set(checks.map((check) => check.id));
	const sourceIsTrusted =
		ids.has("runtime-source") ||
		(ids.has("installed-contract") && ids.has("source-install-drift"));
	if (
		!ids.has("runtime-present") ||
		!ids.has("runtime-files") ||
		!sourceIsTrusted
	) {
		throw new Error(
			"system/upgrade: installation checks do not prove trusted runtime provenance",
		);
	}
}

function ownedOutput(
	output: unknown,
	admission: SafetyGateAdmission,
	expectedOwner: string,
): Record<string, unknown> {
	const result = inputRecord(output, `${admission.operation} owner output`);
	if (result.owner !== expectedOwner) {
		throw new Error(
			`${admission.operation}: output owner does not match safety owner`,
		);
	}
	if (result.operation !== admission.mode) {
		throw new Error(
			`${admission.operation}: output operation does not match safety mode`,
		);
	}
	if (result.status !== "completed" && result.status !== "blocked") {
		throw new Error(`${admission.operation}: owner output has invalid status`);
	}
	return result;
}

function verified(admission: SafetyGateAdmission): SafetyGateVerification {
	return {
		operation: admission.operation,
		owner: admission.owner,
		state: "verified",
		satisfiedPreconditions: [...admission.preconditions],
		verifiedReadback: [...admission.readback],
	};
}

function pendingVerification(
	admission: SafetyGateAdmission,
	reason: string,
): SafetyGateVerification {
	return {
		operation: admission.operation,
		owner: admission.owner,
		state: "pending",
		satisfiedPreconditions: [],
		verifiedReadback: [],
		reason,
	};
}

function singleTrustedArtifact(
	value: unknown,
	operation: string,
	trustedRoot: string,
): string {
	const artifacts = stringList(value, `${operation} output.artifacts`);
	if (artifacts.length !== 1) {
		throw new Error(
			`${operation}: owner must return exactly one readback artifact`,
		);
	}
	const artifact = artifacts[0];
	if (!existsSync(artifact) || lstatSync(artifact).isSymbolicLink()) {
		throw new Error(
			`${operation}: owner readback artifact is missing or untrusted`,
		);
	}
	const trustedRelative = relative(
		realpathSync(trustedRoot),
		realpathSync(artifact),
	);
	if (trustedRelative.startsWith("..") || isAbsolute(trustedRelative)) {
		throw new Error(
			`${operation}: owner readback artifact is outside trusted state`,
		);
	}
	return artifact;
}

function readTrustedJson(path: string, label: string): Record<string, unknown> {
	try {
		return inputRecord(JSON.parse(readFileSync(path, "utf8")), label);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(`${label} must`)) {
			throw error;
		}
		throw new Error(`${label} is not valid JSON`);
	}
}

function inputRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function optionalInputRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function stringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${field} must be an array of strings`);
	}
	return value as string[];
}

function uniqueStrings(value: unknown, field: string): string[] {
	const strings = stringList(value, field).map((item) => item.trim());
	if (
		strings.some((item) => item === "") ||
		new Set(strings).size !== strings.length
	) {
		throw new Error(`${field} must contain unique non-empty strings`);
	}
	return strings;
}

function sameStrings(left: string[], right: string[]): boolean {
	return sameJson(left, right);
}

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
