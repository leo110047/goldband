#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	constants,
	cpSync,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	abortCreatedManagedWorktree,
	createManagedWorktree,
	finishManagedWorktree,
} from "../lib/managed-worktree";
import {
	defaultManagedShell,
	probeManagedBoundary,
	runManagedCommand,
} from "../lib/managed-worktree-boundary";
import {
	acquireReviewExecutionLease,
	releaseReviewExecutionLease,
} from "../lib/review-execution-lease";
import {
	evidenceChildProcessEnvironment,
	EVIDENCE_SANDBOX_ACTIVE_ENV,
	EVIDENCE_TEMP_ROOT_ENV,
} from "../lib/evidence-runtime-contract";
import {
	assertReviewNotNested,
	assertValidReviewScopeFlags,
	INDEPENDENT_REVIEWER_ERROR,
	REVIEW_ACTIVE_ENV,
	REVIEW_CONTRACT_ROOT_ENV,
	REVIEW_EVIDENCE_DURABILITY_ENV,
	REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
	REVIEW_SCOPE_FLAGS,
	type ReviewScopeFlag,
} from "../lib/review-runtime-contract";
import { resolveGoldbandStateRoot } from "../lib/state-root";
import {
	PROMPT_CONTRACT_ACTIONS,
	TRUSTED_LAUNCHER_ACTIONS,
} from "../lib/trusted-launcher-actions.generated";

type ReviewHost = "claude" | "codex";
const MAX_PLAN_INPUT_BYTES = 1024 * 1024;

type TrustedBrowserRuntime = {
	browserExecutable: string;
	browserServerScript: string;
	bunExecutable: string;
};

type TrustedRulesRuntime = {
	rulesResolverScript: string;
	rulesDirectory: string;
};

type ReviewRuntimeResolutionOptions = {
	entryFile?: string;
	env?: NodeJS.ProcessEnv;
};

type ReviewProcessEnvironment = {
	env: NodeJS.ProcessEnv;
	evidenceRoot: string;
	coordinationRoot: string;
	durability: "durable" | "ephemeral";
};

type ReviewProcessEnvironmentOptions = {
	home?: string;
	coordinationRoot?: string;
	createTemporaryRoot?: () => string;
	probeStateRoot?: (root: string) => void;
};

const TRUSTED_CODEX_EXECUTABLE_ENV = "GOLDBAND_TRUSTED_CODEX_EXECUTABLE";
const TRUSTED_BROWSER_EXECUTABLE_ENV = "GOLDBAND_TRUSTED_BROWSER_EXECUTABLE";
const REVIEW_RECEIPT_TRUSTED_CONFIG_ENV =
	"GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG";

const TRUSTED_LAUNCHER_ACTION_SET = new Set<string>(TRUSTED_LAUNCHER_ACTIONS);
const PROMPT_CONTRACT_ACTION_SET = new Set<string>(PROMPT_CONTRACT_ACTIONS);

type TrustedLauncherHandlers = {
	"review/code": (args: string[]) => number;
	"browser/session": (args: string[]) => number;
	"plan/create": (args: string[]) => number;
	"plan/sync": (args: string[]) => number;
};

function printUsage(stream: Pick<Console, "log">): void {
	stream.log("Usage:");
	stream.log(
		"  goldband review code --host <claude|codex> [--work-id <id> --ticket-id <id>] [--evidence-manifest <file>] [--closure-artifact <initial-review-artifact>] [--staged|--worktree|--base <ref>|--diff-file <file>] [--include-untracked] [--review-host-timeout-seconds <60-1800>] [--review-pass-timeout-seconds <60-1800>] [--review-claude-max-budget-usd <0.01-100.00>]",
	);
	stream.log(
		"  goldband review contract help",
		"  goldband review contract init [--output <path>]",
		"  goldband review contract validate --manifest <path>",
		"  goldband review contract inspect",
		"  goldband review contract import --manifest <path>",
		"  goldband review contract remove",
	);
	stream.log(
		"  goldband browser session --host <claude|codex> [command] [args...]",
	);
	stream.log("  goldband plan create --input <file> [--host <claude|codex>]");
	stream.log(
		"  goldband plan <block|cancel> --work-id <id> --ticket-id <id> --reason <text> [--host <claude|codex>]",
	);
	stream.log("  goldband plan resume --work-id <id> --ticket-id <id> [--host <claude|codex>]");
	stream.log("  goldband plan sync configure --input <file> [--host <claude|codex>]");
	stream.log("  goldband plan sync <preview|inspect> --work-id <id> [--host <claude|codex>]");
	stream.log("  goldband plan sync publish --work-id <id> --operation-digest <digest> --step <step-id> [--host <claude|codex>]");
	stream.log(
		"  goldband worktree create <name> [--ticket-id <id>] [--claim-owner <owner>]",
	);
	stream.log('  goldband worktree finish <name> -m "<commit message>"');
}

function usage(): never {
	printUsage({ log: (message) => console.error(message) });
	process.exit(2);
}

function promptContractUsage(action: string): never {
	const invocation = action.replace("/", " ");
	console.error(
		`${action} uses prompt-contract dispatch and is not a shell CLI action. ` +
			`Use \`$goldband ${invocation}\` in Codex or \`/goldband ${invocation}\` in Claude Code.`,
	);
	usage();
}

function create(name: string | undefined, extra: string[]): number {
	if (!name) usage();
	let ticketId: string | undefined;
	let claimOwner: string | undefined;
	for (let index = 0; index < extra.length; index += 1) {
		const flag = extra[index];
		const value = extra[index + 1];
		if (!value) usage();
		if (flag === "--ticket-id" && !ticketId) ticketId = value;
		else if (flag === "--claim-owner" && !claimOwner) claimOwner = value;
		else usage();
		index += 1;
	}
	if (claimOwner && !ticketId) {
		throw new Error("--claim-owner requires --ticket-id");
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			"worktree create requires an interactive terminal because the managed agent must inherit the sandboxed shell",
		);
	}

	const lease = createManagedWorktree({ name, ticketId, claimOwner });
	const probe = probeManagedBoundary(lease);
	if (!probe.available) {
		abortCreatedManagedWorktree(lease);
		throw new Error(
			`hard enforcement boundary is unavailable (${probe.reason}): ${probe.detail || "probe failed"}`,
		);
	}

	console.log(`Managed worktree: ${lease.worktreePath}`);
	console.log(`Boundary: ${lease.enforcement.boundary}`);
	console.log(
		"Git metadata is read-only in the shell below. Working files remain writable.",
	);
	console.log(
		"Start the agent without a nested OS sandbox; the managed boundary remains authoritative:",
	);
	console.log(
		`  Claude Code: claude --settings '${JSON.stringify({ sandbox: { enabled: false } })}'`,
	);
	console.log("  Codex: codex --sandbox danger-full-access");
	console.log("Normal agent permissions and Goldband hooks remain active.");
	console.log("Exit this shell before running worktree finish.");
	const result = runManagedCommand(lease, [defaultManagedShell(), "-l"], {
		stdio: "inherit",
	});
	console.log(`Managed worktree preserved: ${lease.worktreePath}`);
	console.log(
		`Finish outside the managed shell: goldband worktree finish ${lease.name} -m "<message>"`,
	);
	return result.status ?? 1;
}

function finish(name: string | undefined, args: string[]): number {
	if (!name) usage();
	let message = "";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-m" || arg === "--message") {
			const value = args[index + 1];
			if (!value || message) usage();
			message = value;
			index += 1;
			continue;
		}
		usage();
	}
	if (!message) usage();

	const result = finishManagedWorktree({ name, message });
	console.log(`Integrated commit: ${result.commit}`);
	console.log(`Source branch: ${result.branch}`);
	console.log(`Evidence: ${result.evidencePath}`);
	return 0;
}

export function buildReviewRuntimeArgs(args: string[]): string[] {
	let host: ReviewHost | undefined;
	const forwarded: string[] = [];
	let hasScope = false;
	const scopeFlags: ReviewScopeFlag[] = [];
	let workId: string | undefined;
	let ticketId: string | undefined;
	let hasClaudeBudgetOverride = false;
	let hasEvidenceManifest = false;
	let hasClosureArtifact = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--host") {
			const value = args[index + 1];
			if (value !== "claude" && value !== "codex") {
				throw new Error("review code requires --host claude or --host codex");
			}
			if (host) throw new Error("review code accepts --host only once");
			host = value;
			index += 1;
			continue;
		}
		if (arg === "--mode") {
			throw new Error(
				"review code always uses real mode; --mode is not accepted",
			);
		}
		if (arg === "--goldband-home") {
			throw new Error("review state root is runtime-owned");
		}
		if (arg === "--review-receipt-trusted-config") {
			throw new Error("review receipt authority is runtime-owned");
		}
		if (arg === "--work-id" || arg === "--ticket-id") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			if (arg === "--work-id") {
				if (workId) throw new Error("--work-id may be supplied only once");
				workId = value;
			} else {
				if (ticketId) throw new Error("--ticket-id may be supplied only once");
				ticketId = value;
			}
			forwarded.push(arg, value);
			index += 1;
			continue;
		}
		if (arg === "--loop") {
			throw new Error(
				"review code is single-pass; --loop is disabled to prevent repeated full-diff model calls",
			);
		}
		if (arg === "--specialists") {
			const value = args[index + 1];
			if (!value) throw new Error("--specialists requires a value");
			if (value !== "off") {
				throw new Error(`${INDEPENDENT_REVIEWER_ERROR}; remove --specialists`);
			}
			index += 1;
			continue;
		}
		if (arg === "--review-claude-max-budget-usd") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			if (hasClaudeBudgetOverride) {
				throw new Error(`${arg} may be supplied only once`);
			}
			hasClaudeBudgetOverride = true;
			forwarded.push(arg, value);
			index += 1;
			continue;
		}
		if (arg === "--evidence-manifest" || arg === "--closure-artifact") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			if (arg === "--evidence-manifest") {
				if (hasEvidenceManifest) throw new Error(`${arg} may be supplied only once`);
				hasEvidenceManifest = true;
			} else {
				if (hasClosureArtifact) throw new Error(`${arg} may be supplied only once`);
				hasClosureArtifact = true;
			}
			forwarded.push(arg, value);
			index += 1;
			continue;
		}
		if (REVIEW_SCOPE_FLAGS.includes(arg as ReviewScopeFlag)) {
			scopeFlags.push(arg as ReviewScopeFlag);
		}
		if (["--staged", "--worktree", "--base", "--diff-file"].includes(arg)) {
			hasScope = true;
		}
		forwarded.push(arg);
	}

	if (!host)
		throw new Error("review code requires --host claude or --host codex");
	if (hasClaudeBudgetOverride && host !== "claude") {
		throw new Error("--review-claude-max-budget-usd requires --host claude");
	}
	if (Boolean(workId) !== Boolean(ticketId)) {
		throw new Error("--work-id and --ticket-id must be supplied together");
	}
	if (workId && scopeFlags.length > 0) {
		throw new Error(
			"Work Map review scope is runtime-owned; remove staged, worktree, base, diff-file, and include-untracked flags",
		);
	}
	assertValidReviewScopeFlags(scopeFlags);
	if (!hasScope && !workId) forwarded.unshift("--worktree");

	return ["review", "code", "--mode", "real", "--host", host, ...forwarded];
}

function resolveWorkflowRuntimeFile(
	options: ReviewRuntimeResolutionOptions = {},
): string {
	const env = options.env ?? process.env;
	const entryFile = options.entryFile ?? fileURLToPath(import.meta.url);
	const entryRoot = resolve(dirname(realpathSync(entryFile)), "..");
	const trustedRuntime = existsSync(join(entryRoot, "trusted-runtime.json"));
	const candidateRoots = trustedRuntime
		? [entryRoot]
		: [env.GOLDBAND_LOOP_DIR, env.GOLDBAND_ROOT, entryRoot];
	const roots = candidateRoots
		.filter((value): value is string => Boolean(value))
		.flatMap((root) => [root, installedSourceRoot(root)])
		.filter((value): value is string => Boolean(value));

	for (const root of [
		...new Set(roots.map((candidate) => resolve(candidate))),
	]) {
		const runtimeFile = join(root, "workflows", "run.ts");
		if (existsSync(runtimeFile)) return runtimeFile;
	}

	throw new Error(
		"workflow runtime unavailable: expected workflows/run.ts in the active Goldband source or its .installed-source",
	);
}

export const resolveReviewRuntimeFile = resolveWorkflowRuntimeFile;

function installedSourceRoot(runtimeRoot: string): string | undefined {
	const marker = join(runtimeRoot, ".installed-source");
	if (!existsSync(marker)) return undefined;
	const source = readFileSync(marker, "utf8").trim();
	return source || undefined;
}

function reviewCode(args: string[]): number {
	assertReviewNotNested(process.env);
	const runtimeFile = resolveWorkflowRuntimeFile();
	const runtimeArgs = buildReviewRuntimeArgs(args);
	const reviewEnvironment = prepareReviewProcessEnvironment(process.env);
	runtimeArgs.push("--goldband-home", reviewEnvironment.evidenceRoot);
	const trustedRuntime = readTrustedRuntimeConfig(fileURLToPath(import.meta.url));
	if (trustedRuntime) {
		reviewEnvironment.env[REVIEW_RECEIPT_TRUSTED_CONFIG_ENV] =
			trustedRuntime.configFile;
		runtimeArgs.push(
			"--review-receipt-trusted-config",
			trustedRuntime.configFile,
		);
	}
	const trustedCodexExecutable = resolveTrustedCodexExecutable();
	if (trustedCodexExecutable) resolveTrustedRulesRuntime();
	if (trustedCodexExecutable) {
		reviewEnvironment.env[TRUSTED_CODEX_EXECUTABLE_ENV] =
			trustedCodexExecutable;
	}
	if (reviewEnvironment.durability === "ephemeral") {
		console.error(
			`Goldband review: durable state root is not writable in this sandbox; evidence will use sandbox-safe temporary root ${reviewEnvironment.evidenceRoot}.`,
		);
	}
	const lease = acquireReviewExecutionLease(
		reviewEnvironment.coordinationRoot,
		process.cwd(),
		runtimeArgs,
	);
	reviewEnvironment.env[REVIEW_ACTIVE_ENV] = lease.token;
	try {
		const result = spawnSync(process.execPath, [runtimeFile, ...runtimeArgs], {
			cwd: process.cwd(),
			env: reviewEnvironment.env,
			stdio: "inherit",
		});
		if (result.error) throw result.error;
		if (result.status === null) {
			throw new Error(
				`review runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
			);
		}
		return result.status;
	} finally {
		releaseReviewExecutionLease(lease);
	}
}

function reviewContract(args: string[]): number {
	const runtimeFile = join(dirname(resolveWorkflowRuntimeFile()), "review-contract-cli.ts");
	if (!existsSync(runtimeFile) || !lstatSync(runtimeFile).isFile()) {
		throw new Error(
			"review contract runtime unavailable: rerun the Goldband workflow installer",
		);
	}
	const command = args[0];
	const needsState = command === "import" || command === "remove";
	const runtimeEnvironment = needsState
		? prepareReviewProcessEnvironment(process.env)
		: undefined;
	if (runtimeEnvironment && runtimeEnvironment.durability !== "durable") {
		throw new Error("review contract store requires a writable durable Goldband state root");
	}
	const runtimeArgs = runtimeEnvironment
		? [...args, "--goldband-home", runtimeEnvironment.evidenceRoot]
		: args;
	const result = spawnSync(
		process.execPath,
		[runtimeFile, ...runtimeArgs],
		{
			cwd: process.cwd(),
			env: runtimeEnvironment?.env ?? process.env,
			stdio: "inherit",
		},
	);
	if (result.error) throw result.error;
	if (result.status === null) {
		throw new Error(
			`review contract runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
		);
	}
	return result.status;
}

function browserSession(args: string[]): number {
	const hostFlag = args[0];
	const host = args[1];
	if (hostFlag !== "--host" || (host !== "claude" && host !== "codex")) {
		throw new Error(
			"browser session requires --host claude or --host codex before the browser command",
		);
	}
	const command = args[2] || "status";
	const commandArgs = args.slice(3);
	const runtimeFile = resolveWorkflowRuntimeFile();
	const runtimeEnvironment = prepareReviewProcessEnvironment(process.env);
	const trustedBrowser = resolveTrustedBrowserRuntime();
	if (trustedBrowser) resolveTrustedRulesRuntime();
	if (host === "codex" && !trustedBrowser) {
		throw new Error(
			"trusted Codex browser runtime is not installed; rerun ./install.sh workflow-codex",
		);
	}
	if (trustedBrowser) {
		runtimeEnvironment.env[TRUSTED_BROWSER_EXECUTABLE_ENV] =
			trustedBrowser.browserExecutable;
		runtimeEnvironment.env.BROWSE_SERVER_SCRIPT =
			trustedBrowser.browserServerScript;
		runtimeEnvironment.env.BROWSE_BUN_EXECUTABLE = trustedBrowser.bunExecutable;
	}
	if (runtimeEnvironment.durability === "ephemeral") {
		console.error(
			`Goldband browser: durable state root is not writable in this sandbox; evidence will use sandbox-safe temporary root ${runtimeEnvironment.evidenceRoot}.`,
		);
	}

	const inputRoot = mkdtempSync(join(tmpdir(), "goldband-browser-input-"));
	const inputFile = join(inputRoot, "request.json");
	writeFileSync(
		inputFile,
		`${JSON.stringify({ command, args: commandArgs })}\n`,
		{ mode: 0o600 },
	);
	try {
		const result = spawnSync(
			process.execPath,
			[
				runtimeFile,
				"browser",
				"session",
				"--mode",
				"real",
				"--host",
				host,
				"--input",
				inputFile,
			],
			{
				cwd: process.cwd(),
				env: runtimeEnvironment.env,
				stdio: "inherit",
			},
		);
		if (result.error) throw result.error;
		if (result.status === null) {
			throw new Error(
				`browser runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
			);
		}
		return result.status;
	} finally {
		rmSync(inputRoot, { recursive: true, force: true });
	}
}

export function resolvePlanRuntimeFile(
	entryFile = fileURLToPath(import.meta.url),
): string {
	const entryRoot = resolve(dirname(entryFile), "..");
	const installedRuntime = join(
		entryRoot,
		"runtime",
		"workflows",
		"work-map-cli.ts",
	);
	if (existsSync(installedRuntime)) {
		const metadata = lstatSync(installedRuntime);
		if (metadata.isSymbolicLink()) {
			throw new Error("installed Work Map runtime must not be a symbolic link");
		}
		if (metadata.isFile()) return installedRuntime;
	}
	const sourceRuntime = join(entryRoot, "workflows", "work-map-cli.ts");
	if (
		existsSync(join(entryRoot, "package.json")) &&
		existsSync(sourceRuntime) &&
		!existsSync(join(entryRoot, ".installed-source"))
	) {
		const metadata = lstatSync(sourceRuntime);
		if (metadata.isSymbolicLink()) {
			throw new Error("source Work Map runtime must not be a symbolic link");
		}
		if (!metadata.isFile()) {
			throw new Error("source Work Map runtime must be a regular file");
		}
		return sourceRuntime;
	}
	throw new Error(
		"installed Work Map runtime unavailable: rerun the Goldband workflow installer",
	);
}

export function readStablePlanInput(
	file: string,
	options: {
		noFollowFlag?: number | null;
		afterFirstRead?: () => void;
	} = {},
): Buffer {
	const resolvedFile = resolve(file);
	const pathBefore = lstatSync(resolvedFile);
	if (pathBefore.isSymbolicLink()) {
		throw new Error("plan create --input must not be a symbolic link");
	}
	if (!pathBefore.isFile()) {
		throw new Error("plan create --input must be a regular file");
	}
	const noFollowFlag =
		options.noFollowFlag === undefined
			? (constants.O_NOFOLLOW ?? null)
			: options.noFollowFlag;
	const flags = constants.O_RDONLY | (noFollowFlag ?? 0);
	let descriptor: number;
	try {
		descriptor = openSync(resolvedFile, flags);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ELOOP") {
			throw new Error("plan create --input must not be a symbolic link");
		}
		throw error;
	}
	try {
		const before = fstatSync(descriptor);
		const preciseBefore = fstatSync(descriptor, { bigint: true });
		if (
			!before.isFile() ||
			before.ino !== pathBefore.ino ||
			before.dev !== pathBefore.dev
		) {
			throw new Error("plan create --input must be a regular file");
		}
		if (before.size > MAX_PLAN_INPUT_BYTES) {
			throw new Error(
				`plan create --input exceeds ${MAX_PLAN_INPUT_BYTES} bytes`,
			);
		}
		const content = readPlanInputBuffer(descriptor, before.size);
		options.afterFirstRead?.();
		const confirmation = readPlanInputBuffer(descriptor, before.size);
		const after = fstatSync(descriptor);
		const preciseAfter = fstatSync(descriptor, { bigint: true });
		const pathAfter = lstatSync(resolvedFile);
		if (
			!content.equals(confirmation) ||
			after.size !== before.size ||
			after.ino !== before.ino ||
			after.dev !== before.dev ||
			after.mtimeMs !== before.mtimeMs ||
			preciseAfter.mtimeNs !== preciseBefore.mtimeNs ||
			preciseAfter.ctimeNs !== preciseBefore.ctimeNs ||
			pathAfter.isSymbolicLink() ||
			pathAfter.ino !== before.ino ||
			pathAfter.dev !== before.dev
		) {
			throw new Error("plan create --input changed while being read");
		}
		return content;
	} finally {
		closeSync(descriptor);
	}
}

function readPlanInputBuffer(descriptor: number, size: number): Buffer {
	const content = Buffer.alloc(size);
	let offset = 0;
	while (offset < content.length) {
		const bytes = readSync(
			descriptor,
			content,
			offset,
			content.length - offset,
			offset,
		);
		if (bytes === 0) break;
		offset += bytes;
	}
	if (offset !== size) {
		throw new Error("plan create --input changed while being read");
	}
	return content;
}

export function planCreate(
	args: string[],
	options: {
		entryFile?: string;
		env?: NodeJS.ProcessEnv;
		spawn?: typeof spawnSync;
	} = {},
): number {
	let inputFile = "";
	let host: ReviewHost | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--input") {
			if (inputFile) throw new Error("plan create accepts --input only once");
			inputFile = args[index + 1] || "";
			index += 1;
			continue;
		}
		if (arg === "--host") {
			const value = args[index + 1];
			if (host || (value !== "claude" && value !== "codex")) {
				throw new Error("plan create --host must be claude or codex");
			}
			host = value;
			index += 1;
			continue;
		}
		throw new Error(`plan create: unknown argument ${arg}`);
	}
	if (!inputFile) throw new Error("plan create requires --input <file>");
	const entryFile = options.entryFile ?? fileURLToPath(import.meta.url);
	const resolvedHost =
		host ?? inferPlanHost(entryFile, options.env ?? process.env);
	const input = readStablePlanInput(inputFile);
	const inputRoot = mkdtempSync(join(tmpdir(), "goldband-plan-input-"));
	const stableInput = join(inputRoot, "request.json");
	writeFileSync(stableInput, input, { mode: 0o600, flag: "wx" });
	let runtimeRoot: string | null = null;
	try {
		const runtimeFile = resolvePlanRuntimeFile(entryFile);
		const snapshot = snapshotPlanRuntime(runtimeFile);
		runtimeRoot = snapshot.root;
		const run = options.spawn ?? spawnSync;
		const result = run(
			process.execPath,
			[snapshot.runtimeFile, "--host", resolvedHost, "--input", stableInput],
			{
				cwd: process.cwd(),
				env: options.env ?? process.env,
				stdio: "inherit",
			},
		);
		if (result.error) throw result.error;
		if (result.status === null) {
			throw new Error(
				`plan runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
			);
		}
		return result.status;
	} finally {
		if (runtimeRoot) rmSync(runtimeRoot, { recursive: true, force: true });
		rmSync(inputRoot, { recursive: true, force: true });
	}
}

export function planLifecycle(
	action: "block" | "resume" | "cancel",
	args: string[],
	options: {
		entryFile?: string;
		env?: NodeJS.ProcessEnv;
		spawn?: typeof spawnSync;
	} = {},
): number {
	let host: ReviewHost | undefined;
	const forwarded: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1];
		if (!["--host", "--work-id", "--ticket-id", "--reason"].includes(arg) || !value) {
			throw new Error(`plan ${action}: invalid or missing option ${arg ?? "option"}`);
		}
		if (arg === "--host") {
			if (host || (value !== "claude" && value !== "codex")) {
				throw new Error(`plan ${action} --host must be claude or codex`);
			}
			host = value;
		} else {
			if (forwarded.includes(arg)) throw new Error(`plan ${action} accepts ${arg} only once`);
			forwarded.push(arg, value);
		}
		index += 1;
	}
	for (const required of [
		"--work-id",
		"--ticket-id",
		...(action === "resume" ? [] : ["--reason"]),
	]) {
		if (!forwarded.includes(required)) throw new Error(`plan ${action} requires ${required}`);
	}
	const entryFile = options.entryFile ?? fileURLToPath(import.meta.url);
	const resolvedHost = host ?? inferPlanHost(entryFile, options.env ?? process.env);
	let runtimeRoot: string | null = null;
	try {
		const snapshot = snapshotPlanRuntime(resolvePlanRuntimeFile(entryFile));
		runtimeRoot = snapshot.root;
		const result = (options.spawn ?? spawnSync)(
			process.execPath,
			[snapshot.runtimeFile, action, "--host", resolvedHost, ...forwarded],
			{ cwd: process.cwd(), env: options.env ?? process.env, stdio: "inherit" },
		);
		if (result.error) throw result.error;
		if (result.status === null) throw new Error(`plan ${action} runtime terminated without an exit status`);
		return result.status;
	} finally {
		if (runtimeRoot) rmSync(runtimeRoot, { recursive: true, force: true });
	}
}

export function planSync(
	args: string[],
	options: { entryFile?: string; env?: NodeJS.ProcessEnv; spawn?: typeof spawnSync } = {},
): number {
	const operation = args[0];
	if (operation !== "configure" && operation !== "preview" && operation !== "inspect" && operation !== "publish") {
		throw new Error("plan sync requires configure, preview, inspect, or publish");
	}
	let host: ReviewHost | undefined;
	let inputFile = "";
	const forwarded = ["sync", operation];
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1];
		if (!value || !["--host", "--work-id", "--operation-digest", "--step", "--input"].includes(arg)) {
			throw new Error(`plan sync ${operation}: invalid or missing option ${arg ?? "option"}`);
		}
		if (arg === "--host") {
			if (host || (value !== "claude" && value !== "codex")) throw new Error("plan sync --host must be claude or codex");
			host = value;
		} else if (arg === "--input") {
			if (inputFile) throw new Error("plan sync accepts --input only once");
			inputFile = value;
		} else {
			if (forwarded.includes(arg)) throw new Error(`plan sync accepts ${arg} only once`);
			forwarded.push(arg, value);
		}
		index += 1;
	}
	if (operation === "configure" && !inputFile) throw new Error("plan sync configure requires --input");
	if (operation !== "configure" && !forwarded.includes("--work-id")) throw new Error("plan sync requires --work-id");
	if (operation === "configure" && (forwarded.includes("--work-id") || forwarded.includes("--operation-digest") || forwarded.includes("--step"))) throw new Error("plan sync configure accepts only --input and --host");
	if (operation === "publish" && !forwarded.includes("--operation-digest")) throw new Error("plan sync publish requires --operation-digest");
	if (operation === "publish" && !forwarded.includes("--step")) throw new Error("plan sync publish requires --step");
	if (operation !== "publish" && forwarded.includes("--operation-digest")) throw new Error(`plan sync ${operation} does not accept --operation-digest`);
	if (operation !== "publish" && forwarded.includes("--step")) throw new Error(`plan sync ${operation} does not accept --step`);
	const entryFile = options.entryFile ?? fileURLToPath(import.meta.url);
	const resolvedHost = host ?? inferPlanHost(entryFile, options.env ?? process.env);
	let runtimeRoot: string | null = null;
	let inputRoot: string | null = null;
	try {
		const snapshot = snapshotPlanRuntime(resolvePlanRuntimeFile(entryFile));
		runtimeRoot = snapshot.root;
		if (inputFile) {
			inputRoot = mkdtempSync(join(tmpdir(), "goldband-tracker-config-"));
			const stableInput = join(inputRoot, "request.json");
			writeFileSync(stableInput, readStablePlanInput(inputFile), { mode: 0o600, flag: "wx" });
			forwarded.push("--input", stableInput);
		}
		const result = (options.spawn ?? spawnSync)(process.execPath, [snapshot.runtimeFile, ...forwarded, "--host", resolvedHost], {
			cwd: process.cwd(), env: options.env ?? process.env, stdio: "inherit",
		});
		if (result.error) throw result.error;
		if (result.status === null) throw new Error("plan sync runtime terminated without an exit status");
		return result.status;
	} finally {
		if (runtimeRoot) rmSync(runtimeRoot, { recursive: true, force: true });
		if (inputRoot) rmSync(inputRoot, { recursive: true, force: true });
	}
}

function snapshotPlanRuntime(runtimeFile: string): {
	root: string;
	runtimeFile: string;
} {
	const runtimeRoot = resolve(dirname(runtimeFile), "..");
	const snapshotRoot = mkdtempSync(join(tmpdir(), "goldband-plan-runtime-"));
	try {
		for (const directory of ["workflows", "lib"]) {
			const source = join(runtimeRoot, directory);
			if (!existsSync(source)) continue;
			cpSync(source, join(snapshotRoot, directory), {
				recursive: true,
				dereference: false,
				errorOnExist: true,
			});
		}
		assertMaterializedTree(snapshotRoot);
		const snapshotRuntime = join(snapshotRoot, "workflows", "work-map-cli.ts");
		if (!lstatSync(snapshotRuntime).isFile()) {
			throw new Error("snapshotted Work Map runtime must be a regular file");
		}
		return { root: snapshotRoot, runtimeFile: snapshotRuntime };
	} catch (error) {
		rmSync(snapshotRoot, { recursive: true, force: true });
		throw error;
	}
}

function assertMaterializedTree(root: string): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		const metadata = lstatSync(path);
		if (metadata.isSymbolicLink()) {
			throw new Error(
				`Work Map runtime snapshot contains a symbolic link: ${path}`,
			);
		}
		if (metadata.isDirectory()) {
			assertMaterializedTree(path);
			continue;
		}
		if (!metadata.isFile()) {
			throw new Error(`Work Map runtime snapshot contains a non-file: ${path}`);
		}
	}
}

function inferPlanHost(entryFile: string, env: NodeJS.ProcessEnv): ReviewHost {
	const normalized = entryFile.split("\\").join("/");
	if (normalized.includes("/.codex/")) return "codex";
	if (normalized.includes("/.claude/")) return "claude";
	if (env.CODEX_THREAD_ID || env.CODEX_HOME) return "codex";
	if (env.CLAUDECODE || env.CLAUDE_PLUGIN_ROOT) return "claude";
	throw new Error(
		"plan create could not infer the parent host; pass --host claude or --host codex",
	);
}

export function prepareReviewProcessEnvironment(
	env: NodeJS.ProcessEnv,
	options: ReviewProcessEnvironmentOptions = {},
): ReviewProcessEnvironment {
	const cleanEnv = {
		...env,
		...evidenceChildProcessEnvironment(env),
	};
	delete cleanEnv[REVIEW_EVIDENCE_DURABILITY_ENV];
	delete cleanEnv[TRUSTED_CODEX_EXECUTABLE_ENV];
	delete cleanEnv[TRUSTED_BROWSER_EXECUTABLE_ENV];
	delete cleanEnv.BROWSE_SERVER_SCRIPT;
	delete cleanEnv.BROWSE_BUN_EXECUTABLE;
	const explicitRoot = hasExplicitStateRoot(env);
	const evidenceRoot = resolveGoldbandStateRoot(
		undefined,
		env,
		options.home ?? homedir(),
	);
	// Contract lookup stays on the durable project registry even when evidence
	// output must move to a sandbox-writable temporary directory.
	cleanEnv[REVIEW_CONTRACT_ROOT_ENV] = evidenceRoot;
	const probe = options.probeStateRoot ?? probeWritableStateRoot;
	try {
		probe(evidenceRoot);
		return {
			env: cleanEnv,
			evidenceRoot,
			coordinationRoot: prepareTemporaryReviewCoordinationRoot(
				options.coordinationRoot ?? defaultReviewCoordinationRoot(evidenceRoot, "durable"),
			),
			durability: "durable",
		};
	} catch (error) {
		if (explicitRoot || !isStateRootPermissionError(error)) throw error;
	}

	const temporaryRoot = options.createTemporaryRoot
		? options.createTemporaryRoot()
		: mkdtempSync(join(reviewTemporaryDirectory(env), "goldband-review-state-"));
	probe(temporaryRoot);
	const coordinationRoot = prepareTemporaryReviewCoordinationRoot(
		options.coordinationRoot ?? defaultReviewCoordinationRoot(temporaryRoot, "ephemeral"),
	);
	return {
		env: {
			...cleanEnv,
			GOLDBAND_HOME: temporaryRoot,
			[REVIEW_EVIDENCE_DURABILITY_ENV]: REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
		},
		evidenceRoot: temporaryRoot,
		coordinationRoot,
		durability: "ephemeral",
	};
}

function defaultReviewCoordinationRoot(
	stateRoot: string,
	durability: "durable" | "ephemeral",
): string {
	if (durability === "durable") return join(stateRoot, "review-coordination");
	const identity = typeof process.getuid === "function"
		? String(process.getuid())
		: "current-user";
	return join(dirname(stateRoot), `goldband-review-coordination-${identity}`);
}

function reviewTemporaryDirectory(env: NodeJS.ProcessEnv): string {
	const runtimeOwnedEvidenceRoot = env[EVIDENCE_TEMP_ROOT_ENV];
	if (
		env[EVIDENCE_SANDBOX_ACTIVE_ENV] === "1" &&
		runtimeOwnedEvidenceRoot &&
		isAbsolute(runtimeOwnedEvidenceRoot) &&
		resolve(runtimeOwnedEvidenceRoot) === runtimeOwnedEvidenceRoot
	) {
		// The outer evidence runtime creates, canonicalizes, and grants this root
		// before entering Seatbelt. Re-probing it here can itself be denied and
		// must not make the installed launcher fall back to an unauthorized /tmp.
		return runtimeOwnedEvidenceRoot;
	}
	for (const key of [EVIDENCE_TEMP_ROOT_ENV, "TMPDIR", "TMP", "TEMP"] as const) {
		const candidate = env[key];
		if (!candidate || !isAbsolute(candidate) || !existsSync(candidate)) continue;
		let metadata;
		try {
			metadata = lstatSync(candidate);
		} catch {
			continue;
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
		if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) continue;
		return realpathSync(candidate);
	}
	return realpathSync(tmpdir());
}

function prepareTemporaryReviewCoordinationRoot(root: string): string {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const metadata = lstatSync(root);
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new Error(
			`review coordination root must be a real directory: ${root}`,
		);
	}
	if (
		typeof process.getuid === "function" &&
		metadata.uid !== process.getuid()
	) {
		throw new Error(
			`review coordination root is not owned by the current user: ${root}`,
		);
	}
	chmodSync(root, 0o700);
	probeWritableStateRoot(root);
	return realpathSync(root);
}

export function resolveTrustedCodexExecutable(
	entryFile = fileURLToPath(import.meta.url),
): string | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	if (resolved.config.runtimeHost === "claude") return undefined;
	return requireTrustedExecutable(
		resolved.configFile,
		"codexExecutable",
		resolved.config.codexExecutable,
	);
}

export function resolveTrustedBrowserRuntime(
	entryFile = fileURLToPath(import.meta.url),
): TrustedBrowserRuntime | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	if (resolved.config.runtimeHost === "claude") return undefined;
	return {
		browserExecutable: requireTrustedExecutable(
			resolved.configFile,
			"browserExecutable",
			resolved.config.browserExecutable,
		),
		browserServerScript: requireTrustedFile(
			resolved.configFile,
			"browserServerScript",
			resolved.config.browserServerScript,
		),
		bunExecutable: requireTrustedExecutable(
			resolved.configFile,
			"bunExecutable",
			resolved.config.bunExecutable,
		),
	};
}

export function resolveTrustedRulesRuntime(
	entryFile = fileURLToPath(import.meta.url),
): TrustedRulesRuntime | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	if (resolved.config.runtimeHost === "claude") return undefined;
	return {
		rulesResolverScript: requireTrustedFile(
			resolved.configFile,
			"rulesResolverScript",
			resolved.config.rulesResolverScript,
		),
		rulesDirectory: requireTrustedDirectory(
			resolved.configFile,
			"rulesDirectory",
			resolved.config.rulesDirectory,
		),
	};
}

function readTrustedRuntimeConfig(entryFile: string):
	| {
			configFile: string;
			config: Record<string, unknown>;
	  }
	| undefined {
	const entryRoot = resolve(dirname(realpathSync(entryFile)), "..");
	const configFile = join(entryRoot, "trusted-runtime.json");
	if (!existsSync(configFile)) return undefined;
	const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<
		string,
		unknown
	>;
	if (config.schemaVersion !== 2) {
		throw new Error(`trusted runtime configuration is invalid: ${configFile}`);
	}
	return { configFile, config };
}

function requireTrustedExecutable(
	configFile: string,
	field: string,
	value: unknown,
): string {
	const file = requireTrustedFile(configFile, field, value);
	return realpathSync(file);
}

function requireTrustedFile(
	configFile: string,
	field: string,
	value: unknown,
): string {
	if (typeof value !== "string" || !isAbsolute(value) || !existsSync(value)) {
		throw new Error(
			`trusted runtime configuration field ${field} is invalid: ${configFile}`,
		);
	}
	return realpathSync(value);
}

function requireTrustedDirectory(
	configFile: string,
	field: string,
	value: unknown,
): string {
	const directory = requireTrustedFile(configFile, field, value);
	if (!statSync(directory).isDirectory()) {
		throw new Error(
			`trusted runtime configuration field ${field} is not a directory: ${configFile}`,
		);
	}
	return directory;
}

function hasExplicitStateRoot(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env.GOLDBAND_HOME ||
			env.GOLDBAND_STATE_DIR ||
			env.GOLDBAND_STATE_ROOT ||
			(env.CLAUDE_PLUGIN_DATA &&
				env.CLAUDE_PLUGIN_ROOT?.toLowerCase().includes("goldband")),
	);
}

function probeWritableStateRoot(root: string): void {
	mkdirSync(root, { recursive: true });
	const probe = mkdtempSync(join(root, ".review-write-probe-"));
	writeFileSync(join(probe, "probe"), "review evidence write probe\n");
	rmSync(probe, { recursive: true, force: true });
}

function isStateRootPermissionError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) return false;
	return ["EACCES", "EPERM", "EROFS"].includes(String(error.code));
}

function dispatchTrustedLauncherAction(
	action: string,
	args: string[],
	handlers: TrustedLauncherHandlers,
): number | undefined {
	if (action === "review/code") return handlers["review/code"](args);
	if (action === "browser/session") return handlers["browser/session"](args);
	if (action === "plan/create") return handlers["plan/create"](args);
	if (action === "plan/sync") return handlers["plan/sync"](args);
	return undefined;
}

const TRUSTED_LAUNCHER_HANDLERS: TrustedLauncherHandlers = {
	"review/code": reviewCode,
	"browser/session": browserSession,
	"plan/create": planCreate,
	"plan/sync": planSync,
};

export function main(args = process.argv.slice(2)): number {
	const [scope, action, name, ...rest] = args;
	if (scope === "--contract-probe" && args.length === 1) {
		console.log(
			JSON.stringify({
				schemaVersion: 1,
				dispatch: "trusted-launcher",
				actions: TRUSTED_LAUNCHER_ACTIONS,
			}),
		);
		return 0;
	}
	if (scope === "--contract-probe" && args.length === 2) {
		if (!action || !TRUSTED_LAUNCHER_ACTION_SET.has(action)) return 2;
		let routedAction: string | undefined;
		const fakeRoute = (declaredAction: string) => () => {
			routedAction = declaredAction;
			return 0;
		};
		const fakeHandlers: TrustedLauncherHandlers = {
			"review/code": fakeRoute("review/code"),
			"browser/session": fakeRoute("browser/session"),
			"plan/create": fakeRoute("plan/create"),
			"plan/sync": fakeRoute("plan/sync"),
		};
		const status = dispatchTrustedLauncherAction(action, [], fakeHandlers);
		if (status !== 0 || routedAction !== action) return 2;
		console.log(
			JSON.stringify({
				schemaVersion: 1,
				action,
				routable: true,
				behavior: "bounded-read-only-fake-host-probe",
			}),
		);
		return 0;
	}
	if (scope === "-h" || scope === "--help" || scope === "help") {
		printUsage(console);
		return 0;
	}
	const trustedAction = action ? `${scope}/${action}` : "";
	const trustedResult = dispatchTrustedLauncherAction(
		trustedAction,
		[name, ...rest].filter((value): value is string => value !== undefined),
		TRUSTED_LAUNCHER_HANDLERS,
	);
	if (trustedResult !== undefined) return trustedResult;
	if (PROMPT_CONTRACT_ACTION_SET.has(trustedAction)) {
		promptContractUsage(trustedAction);
	}
	if (scope === "review") {
		if (action === "contract") {
			return reviewContract(
				[name, ...rest].filter((value): value is string => value !== undefined),
			);
		}
		usage();
	}
	if (scope === "browser") {
		usage();
	}
	if (scope === "plan") {
		const planArgs = [name, ...rest].filter(
			(value): value is string => value !== undefined,
		);
		if (action === "block" || action === "resume" || action === "cancel") {
			return planLifecycle(action, planArgs);
		}
		usage();
	}
	if (scope !== "worktree") usage();
	if (action === "create") return create(name, rest);
	if (action === "finish") return finish(name, rest);
	usage();
}

if (import.meta.main) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(
			`goldband: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
