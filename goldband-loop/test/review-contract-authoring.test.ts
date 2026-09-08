import { afterEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	createReviewContractScaffold,
	initializeReviewContract,
	reviewContractAuthoringAssets,
	validateReviewContractFile,
} from "../workflows/review-contract-cli";
import {
	evaluateEvidenceCompleteness,
	reviewEvidenceManifestSchema,
	selectedEvidenceProviderIds,
	type ReviewEvidenceManifest,
} from "../workflows/review-evidence";

const roots: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("review contract authoring", () => {
	test("scaffold is valid but blocks semantic review until project evidence is declared", () => {
		const manifest = reviewEvidenceManifestSchema.validate(createReviewContractScaffold());
		const completeness = evaluateEvidenceCompleteness(manifest, []);

		expect(manifest.behaviorMatrix).toEqual([
			expect.objectContaining({
				id: "project-evidence-contract",
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
			}),
		]);
		expect(manifest.providers).toEqual([]);
		expect(completeness).toEqual({
			complete: false,
			hostEligible: false,
			blockingCellIds: ["project-evidence-contract"],
			coverageGapCellIds: ["project-evidence-contract"],
			runtimeIncompleteCellIds: [],
		});
	});

	test("init writes once at the canonical repository root and refuses escapes or overwrite", () => {
		const root = gitRepository();
		const nested = join(root, "packages", "app");
		mkdirSync(nested, { recursive: true });

		const initialized = initializeReviewContract(nested);
		const manifestFile = join(realpathSync(root), "goldband.review-evidence.json");

		expect(initialized.output).toBe(manifestFile);
		expect(initialized.blockingCellIds).toEqual(["project-evidence-contract"]);
		expect(JSON.parse(readFileSync(manifestFile, "utf8"))).toEqual(
			createReviewContractScaffold(),
		);
		expect(() => initializeReviewContract(nested)).toThrow(
			"refusing to overwrite existing review contract",
		);
		expect(() => initializeReviewContract(nested, "../../../escaped.json")).toThrow(
			"review contract output must stay inside the canonical Git repository",
		);
		const outside = mkdtempSync(join(tmpdir(), "goldband-contract-outside-"));
		roots.push(outside);
		symlinkSync(outside, join(root, "external"));
		expect(() => initializeReviewContract(nested, "../../external/escaped.json")).toThrow(
			"review contract output must stay inside the canonical Git repository",
		);
	});

	test("validate uses the runtime authority and returns a side-effect-free summary", () => {
		const root = gitRepository();
		const manifestFile = join(repoRoot, "examples", "review-evidence", "minimal-local-gate.json");
		const before = gitStatus(root);
		const result = validateReviewContractFile(manifestFile, root);

		expect(result).toMatchObject({
			valid: true,
			compatibilityIdentity: "review-evidence-schema-v2/runtime-contract-v2",
			behaviorCellIds: ["typescript-contracts"],
			providerIds: ["typescript-typecheck"],
			authorizationIds: [],
		});
		expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
		expect(gitStatus(root)).toBe(before);
	});

	test("source authoring assets are discoverable and the public example passes JSON Schema", () => {
		const assets = reviewContractAuthoringAssets();
		expect(assets.guide).toBe(join(repoRoot, "docs", "review-evidence-manifest.md"));
		expect(assets.example).toBe(
			join(repoRoot, "examples", "review-evidence", "minimal-local-gate.json"),
		);
		expect(assets.schema).toBe(join(repoRoot, "schemas", "review-evidence-manifest.schema.json"));

		const validateJsonSchema = jsonSchemaValidator();
		const example = JSON.parse(readFileSync(assets.example, "utf8"));
		expect(validateJsonSchema(example), JSON.stringify(validateJsonSchema.errors)).toBe(true);
		expect(reviewEvidenceManifestSchema.validate(example).schemaVersion).toBe(2);
		expect(selectedEvidenceProviderIds(example, ["src/index.ts"])).toEqual([
			"typescript-typecheck",
		]);
		for (const pathPrefix of ["./src", "../src", "/src", "C:/src", "src\\nested", "src//nested", "src/"]) {
			const invalid = {
				...example,
				providers: [{
					...example.providers[0]!,
					applicability: { kind: "paths", pathPrefixes: [pathPrefix] },
				}],
			};
			expect(validateJsonSchema(invalid), pathPrefix).toBe(false);
			expect(() => reviewEvidenceManifestSchema.validate(invalid), pathPrefix).toThrow();
		}
	});

	test("JSON Schema and runtime validator expose the same opt-in Python 3.14 uv contract", () => {
		const validateJsonSchema = jsonSchemaValidator();
		const example = JSON.parse(
			readFileSync(join(repoRoot, "examples", "review-evidence", "minimal-local-gate.json"), "utf8"),
		) as ReviewEvidenceManifest;
		const python = structuredClone(example);
		python.providers[0]!.operations[0] = {
			...python.providers[0]!.operations[0]!,
			argv: ["python3.14", "-c", "import app"],
			pythonRuntime: {
				interpreter: "python3.14",
				resolver: "uv",
				projectFile: "pyproject.toml",
				lockFile: "uv.lock",
			},
		};
		expect(validateJsonSchema(python), JSON.stringify(validateJsonSchema.errors)).toBe(true);
		expect(reviewEvidenceManifestSchema.validate(python).providers[0]!.operations[0]!.pythonRuntime)
			.toEqual(python.providers[0]!.operations[0]!.pythonRuntime);

		for (const mutate of [
			(value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.argv[0] = "python3"; },
			(value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.network = "authorized"; },
			(value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.requiredSystemTools = ["uv"]; },
			(value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.pythonRuntime!.projectFile = "../pyproject.toml"; },
			(value: ReviewEvidenceManifest) => { value.providers[0]!.operations[0]!.pythonRuntime!.lockFile = "requirements.txt"; },
		]) {
			const invalid = structuredClone(python);
			mutate(invalid);
			expect(validateJsonSchema(invalid)).toBe(false);
			expect(() => reviewEvidenceManifestSchema.validate(invalid)).toThrow();
		}
	});

	test("direct Python commands and child tools cannot omit the dedicated runtime", () => {
		const validateJsonSchema = jsonSchemaValidator();
		const example = JSON.parse(readFileSync(join(repoRoot, "examples/review-evidence/minimal-local-gate.json"), "utf8"));
		for (const command of ["python", "python2", "python2.7", "python3", "python3.13", "python3.14", "python3.14t", "python3.14d", "pythonw.exe", "PYTHON3.EXE"]) {
			for (const child of [false, true]) {
				const value = structuredClone(example);
				const op = value.providers[0].operations[0];
				if (child) op.requiredSystemTools = [command];
				else op.argv = [command, "-I", "-S", "-c", "print('GOLDBAND_PYTHON_STARTED')"];
				expect(validateJsonSchema(value), command).toBe(false);
				expect(() => reviewEvidenceManifestSchema.validate(value), command).toThrow("pythonRuntime");
			}
		}
		for (const command of ["bun", "node", "python-check", "python3-config"]) {
			const value = structuredClone(example);
			value.providers[0].operations[0].argv = [command];
			expect(validateJsonSchema(value), command).toBe(true);
			expect(reviewEvidenceManifestSchema.validate(value).providers[0]!.operations[0]!.argv).toEqual([command]);
		}
	});

	test("JSON Schema and runtime conformance corpus covers local constraints and runtime-only graph rules", () => {
		const validateJsonSchema = jsonSchemaValidator();
		const example = JSON.parse(
			readFileSync(join(repoRoot, "examples", "review-evidence", "minimal-local-gate.json"), "utf8"),
		) as ReviewEvidenceManifest;
		const cases: Array<{
			name: string;
			value: unknown;
			schemaValid: boolean;
			runtimeValid: boolean;
		}> = [
			{
				name: "missing not-applicable reason",
				value: {
					schemaVersion: 2,
					behaviorMatrix: [{
						...example.behaviorMatrix[0]!,
						disposition: "not-applicable",
						providerIds: [],
					}],
					providers: [],
					authorizations: [],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "providerIds is explicit even when empty",
				value: {
					...example,
					behaviorMatrix: [{
						...example.behaviorMatrix[0]!,
						disposition: "manual",
						reason: "manual evidence is not yet automated",
						providerIds: undefined,
					}],
					providers: [],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "automated cell without provider",
				value: {
					schemaVersion: 2,
					behaviorMatrix: [{
						...example.behaviorMatrix[0]!,
						disposition: "automated",
						providerIds: [],
					}],
					providers: [],
					authorizations: [],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "provider references are unique",
				value: {
					...example,
					behaviorMatrix: [{
						...example.behaviorMatrix[0]!,
						providerIds: ["typescript-typecheck", "typescript-typecheck"],
					}],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "unknown provider reference is a runtime graph rule",
				value: {
					...example,
					behaviorMatrix: [{ ...example.behaviorMatrix[0]!, providerIds: ["missing"] }],
					providers: [],
				},
				schemaValid: true,
				runtimeValid: false,
			},
			{
				name: "non-reciprocal ownership is a runtime graph rule",
				value: {
					...example,
					providers: [{ ...example.providers[0]!, cellIds: ["different-cell"] }],
				},
				schemaValid: true,
				runtimeValid: false,
			},
			{
				name: "path prefixes use normalized repo-root coordinates",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						applicability: { kind: "paths", pathPrefixes: ["./src"] },
					}],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "persistent provider cannot carry transition binding",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						transitionBinding: {
							repository: "fixture",
							baseDigest: "a".repeat(64),
							candidateDigest: "b".repeat(64),
							scopeDigest: "c".repeat(64),
							operationContractDigest: "d".repeat(64),
						},
					}],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "persistent RED is a runtime lifecycle rule",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						kind: "regression",
						operations: [
							{
								...example.providers[0]!.operations[0]!,
								id: "base-red",
								target: "base",
								expectedExit: "nonzero",
								expectedExitCode: 42,
							},
							example.providers[0]!.operations[0]!,
						],
					}],
				},
				schemaValid: true,
				runtimeValid: false,
			},
			{
				name: "property fuzz requires replay metadata",
				value: {
					...example,
					providers: [{ ...example.providers[0]!, kind: "property-fuzz" }],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "authorized network requires authorization id",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						operations: [{ ...example.providers[0]!.operations[0]!, network: "authorized" }],
					}],
				},
				schemaValid: false,
				runtimeValid: false,
			},
			{
				name: "authorization id must resolve to the named operation",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						operations: [{
							...example.providers[0]!.operations[0]!,
							network: "authorized",
							authorizationId: "missing-approval",
						}],
					}],
				},
				schemaValid: true,
				runtimeValid: false,
			},
			{
				name: "live evidence requires authorized network",
				value: {
					...example,
					providers: [{
						...example.providers[0]!,
						operations: [{ ...example.providers[0]!.operations[0]!, evidenceLevel: "live-provider" }],
					}],
				},
				schemaValid: false,
				runtimeValid: false,
			},
		];

		for (const fixture of cases) {
			expect(validateJsonSchema(fixture.value), fixture.name).toBe(fixture.schemaValid);
			let runtimeValid = true;
			try {
				reviewEvidenceManifestSchema.validate(fixture.value);
			} catch {
				runtimeValid = false;
			}
			expect(runtimeValid, fixture.name).toBe(fixture.runtimeValid);
		}
	});
});

function gitRepository(): string {
	const root = mkdtempSync(join(tmpdir(), "goldband-contract-authoring-"));
	roots.push(root);
	const initialized = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
	if (initialized.status !== 0) throw new Error(initialized.stderr);
	writeFileSync(join(root, "README.md"), "fixture\n");
	const committed = spawnSync(
		"git",
		[
			"-c",
			"user.name=Goldband Test",
			"-c",
			"user.email=goldband@example.invalid",
			"add",
			"README.md",
		],
		{ cwd: root, encoding: "utf8" },
	);
	if (committed.status !== 0) throw new Error(committed.stderr);
	const commit = spawnSync(
		"git",
		[
			"-c",
			"user.name=Goldband Test",
			"-c",
			"user.email=goldband@example.invalid",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd: root, encoding: "utf8" },
	);
	if (commit.status !== 0) throw new Error(commit.stderr);
	return root;
}

function gitStatus(root: string): string {
	return spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
		cwd: root,
		encoding: "utf8",
	}).stdout;
}

function jsonSchemaValidator() {
	const ajv = new Ajv2020({ strict: false, validateFormats: false });
	const behaviorSchema = JSON.parse(
		readFileSync(join(repoRoot, "schemas", "review-behavior-matrix.schema.json"), "utf8"),
	);
	const manifestSchema = JSON.parse(
		readFileSync(join(repoRoot, "schemas", "review-evidence-manifest.schema.json"), "utf8"),
	);
	ajv.addSchema(behaviorSchema);
	return ajv.compile(manifestSchema);
}
