import { existsSync, readFileSync, realpathSync } from "node:fs";
import type { EvidenceRuntimeReadAccess } from "./review-evidence";

const SYSTEM_SANDBOX_PROFILE = "/System/Library/Sandbox/Profiles/system.sb";

export const SYSTEM_SANDBOX_MACH_SERVICES = [
	"com.apple.analyticsd",
	"com.apple.analyticsd.messagetracer",
	"com.apple.appsleep",
	"com.apple.bsd.dirhelper",
	"com.apple.cfprefsd.agent",
	"com.apple.cfprefsd.daemon",
	"com.apple.diagnosticd",
	"com.apple.dt.automationmode.reader",
	"com.apple.espd",
	"com.apple.logd",
	"com.apple.logd.events",
	"com.apple.internal.objc_trace",
	"com.apple.osanalytics.osanalyticshelper",
	"com.apple.runningboard",
	"com.apple.secinitd",
	"com.apple.system.DirectoryService.libinfo_v1",
	"com.apple.system.logger",
	"com.apple.system.notification_center",
	"com.apple.system.opendirectoryd.libinfo",
	"com.apple.system.opendirectoryd.membership",
	"com.apple.trustd",
	"com.apple.trustd.agent",
	"com.apple.xpc.activity.unmanaged",
] as const;

const CONDITIONAL_SYSTEM_MACH_SERVICES = new Set([
	"com.apple.internal.objc_trace",
	"com.apple.osanalytics.osanalyticshelper",
]);

const SYSTEM_SANDBOX_MACH_ALLOW_RULES = uniqueSorted([
	"(allow mach-bootstrap)",
	'(allow mach-register (local-name-prefix ""))',
	'(allow mach-lookup (xpc-service-name-prefix ""))',
	`(allow mach-lookup ${SYSTEM_SANDBOX_MACH_SERVICES
		.filter((service) => !CONDITIONAL_SYSTEM_MACH_SERVICES.has(service))
		.map((service) => `(global-name ${schemeString(service)})`)
		.join(" ")} (local-name "com.apple.cfprefsd.agent"))`,
	'(allow mach-lookup (global-name "com.apple.internal.objc_trace"))',
	'(allow mach-lookup (global-name "com.apple.osanalytics.osanalyticshelper"))',
]);

export type EvidenceSandboxOptions = {
	cwd: string;
	writableRoots: string[];
	argv: string[];
	runtimeAccess: EvidenceRuntimeReadAccess;
	systemToolRoots?: string[];
	systemToolLiterals?: string[];
	systemToolMapExecutableLiterals?: string[];
};

export type EvidenceSandboxCommand = {
	command: string;
	args: string[];
	brokered: boolean;
};

export function sealedEvidenceExecutionUnavailable(
	platform: NodeJS.Platform = process.platform,
	seatbeltExists = existsSync("/usr/bin/sandbox-exec"),
): { actual: string; detail: string } | undefined {
	if (platform === "darwin" && seatbeltExists) return undefined;
	return {
		actual: `${platform}/review-runtime`,
		detail:
			platform === "darwin"
				? "the supported macOS Seatbelt executable is unavailable"
				: "sealed executable review evidence currently requires macOS Seatbelt; Linux and Windows review parity is not supported",
	};
}

export function evidenceSandboxCommand(
	options: EvidenceSandboxOptions,
): EvidenceSandboxCommand {
	const unavailable = sealedEvidenceExecutionUnavailable();
	if (unavailable) {
		throw new Error(
			`review evidence runner unavailable: ${unavailable.detail}`,
		);
	}
	validateSystemSandboxMachServices(
		readFileSync(SYSTEM_SANDBOX_PROFILE, "utf8"),
	);
	return {
		command: "/usr/bin/sandbox-exec",
		args: ["-p", darwinSandboxProfile(options), "--", ...options.argv],
		brokered: false,
	};
}

export function validateSystemSandboxMachServices(profile: string): void {
	const actual = commonSystemMachAllowRules(profile);
	const expected = SYSTEM_SANDBOX_MACH_ALLOW_RULES;
	if (JSON.stringify(actual) === JSON.stringify(expected)) return;
	const actualSet = new Set<string>(actual);
	const expectedSet = new Set<string>(expected);
	const missing = expected.filter((rule) => !actualSet.has(rule));
	const added = actual.filter((rule) => !expectedSet.has(rule));
	throw new Error(
		`macOS system.sb Mach allow-clause baseline drifted; review evidence remains blocked until the private baseline is re-audited (added=${added.join(" | ") || "none"} missing=${missing.join(" | ") || "none"})`,
	);
}

export function commonSystemMachServices(profile: string): string[] {
	return uniqueSorted(
		commonSystemMachAllowRules(profile).flatMap((rule) =>
			[...rule.matchAll(/\(global-name\s+"([^"]+)"\)/g)].map(
				(match) => match[1]!,
			),
		),
	);
}

function commonSystemMachAllowRules(profile: string): string[] {
	const firstDefinition = profile.search(/^\(define\s+\(/m);
	if (firstDefinition < 0) {
		throw new Error(
			"macOS system.sb common process baseline has an unsupported structure",
		);
	}
	const commonBaseline = profile.slice(0, firstDefinition);
	return uniqueSorted(machAllowExpressions(commonBaseline));
}

function machAllowExpressions(profile: string): string[] {
	const expressions: string[] = [];
	for (const match of profile.matchAll(/\(allow(?=[^()]*\bmach-[a-z0-9*_-]+)/gi)) {
		const expression = balancedExpression(profile, match.index);
		if (expression) expressions.push(expression.replace(/\s+/g, " ").trim());
	}
	return expressions;
}

function balancedExpression(source: string, start: number): string | undefined {
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index]!;
		if (character === "(") depth += 1;
		else if (character === ")" && --depth === 0) return source.slice(start, index + 1);
	}
	return undefined;
}

const COMPILER_OUTPUT_PERMISSION_FAILURE = /^error TS5033: Could not write file '[^\r\n]+': [^\r\n]*(?:operation not permitted|permission denied|read-only file system)\b[^\r\n]*$/im;

export function createCompilerOutputDiagnosticCapture() {
	let tail = "";
	let denied = false;
	return {
		write(chunk: string) {
			if (denied) return;
			const window = tail + chunk;
			denied = COMPILER_OUTPUT_PERMISSION_FAILURE.test(window);
			// Keep split diagnostics across chunks without retaining the build log.
			tail = window.slice(-16 * 1024);
		},
		get denied() { return denied; },
	};
}

export function isEvidenceSandboxRuntimeFailure(
	sandboxCommand: string,
	result: { reason: string; exitCode: number; stderr?: string; stdout?: string; compilerOutputDenied?: boolean },
	brokered = false,
): boolean {
	if (
		(!brokered && sandboxCommand !== "/usr/bin/sandbox-exec") ||
		result.reason !== "exit"
	)
		return false;
	const stderr = result.stderr ?? "";
	const brokerFailed =
		brokered &&
		result.exitCode === 71 &&
		/^evidence sandbox broker (?:rejected request|timed out|response)/im.test(
			stderr,
		);
	const sandboxInitializationFailed =
		result.exitCode === 71 && /^(?:sandbox-exec:|sandbox_init:)/im.test(stderr);
	const dynamicLoaderFailedBeforeMain =
		result.exitCode !== 0 && /^dyld\[\d+\]:/m.test(stderr);
	// TypeScript reports output failures on stdout as well as stderr. An
	// unwritable output (including --noEmit's incremental cache) is incomplete
	// evidence, even when its exit code happens to match a declared RED result.
	// Do not classify arbitrary mentions of sandbox/EPERM or type errors here.
	const compilerOutputDenied = result.exitCode !== 0 &&
		(result.compilerOutputDenied || COMPILER_OUTPUT_PERMISSION_FAILURE.test(
			`${result.stdout ?? ""}\n${stderr}`,
		));
	return (
		brokerFailed || sandboxInitializationFailed || dynamicLoaderFailedBeforeMain || compilerOutputDenied
	);
}

function darwinSandboxProfile(options: EvidenceSandboxOptions): string {
	const writableRoots = options.writableRoots.map((root) => realpathSync(root));
	const readableRoots = uniqueSorted([
		realpathSync(options.cwd),
		...writableRoots,
		...options.runtimeAccess.roots,
		...(options.systemToolRoots ?? []),
	]);
	const ancestorRoots = uniqueSorted([
		realpathSync(options.cwd),
		...options.runtimeAccess.roots,
		...(options.systemToolRoots ?? []),
	]);
	return [
		"(version 1)",
		"(deny default)",
		'(import "system.sb")',
		...darwinOutputChannelDenials(),
		...darwinProcessAllows(),
		...darwinRuntimeAllows(
			options,
			readableRoots,
			writableRoots,
			ancestorRoots,
		),
	].join(" ");
}

export function darwinOutputChannelDenials(): string[] {
	const machServices = SYSTEM_SANDBOX_MACH_SERVICES.map(
		(name) => `(global-name ${schemeString(name)})`,
	).join(" ");
	return [
		"(deny network*)",
		'(deny network-outbound (literal "/private/var/run/syslog"))',
		"(deny mach-lookup)",
		"(deny mach-register)",
		"(deny mach-bootstrap)",
		'(deny mach-register (local-name-prefix ""))',
		'(deny mach-lookup (xpc-service-name-prefix ""))',
		`(deny mach-lookup ${machServices} (local-name "com.apple.cfprefsd.agent"))`,
		`(if (defined? 'system-socket) (deny system-socket))`,
		'(deny ipc-posix-shm-read* (ipc-posix-name "apple.shm.notification_center") (ipc-posix-name-prefix "apple.cfprefs."))',
	];
}

function darwinProcessAllows(): string[] {
	return [
		"(allow process-exec)",
		"(allow process-fork)",
		"(allow signal (target self))",
		"(allow signal (target children))",
		"(allow sysctl-read)",
		'(allow file-read* (literal "/dev/null"))',
		'(allow file-write* (literal "/dev/null"))',
	];
}

function darwinRuntimeAllows(
	options: EvidenceSandboxOptions,
	readableRoots: string[],
	writableRoots: string[],
	ancestorRoots: string[],
): string[] {
	const literals = uniqueSorted([
		...options.runtimeAccess.literals,
		...(options.systemToolLiterals ?? []),
	]);
	const executableLiterals = uniqueSorted([
		...options.runtimeAccess.mapExecutableLiterals,
		...(options.systemToolMapExecutableLiterals ?? []),
	]);
	return [
		`(allow file-read* (literal ${schemeString(options.argv[0] ?? "")}))`,
		...literals.map(
			(file) => `(allow file-read* (literal ${schemeString(file)}))`,
		),
		...literals.map((file) => ancestorMetadataRule(file)),
		...executableLiterals.map(
			(file) => `(allow file-map-executable (literal ${schemeString(file)}))`,
		),
		...options.runtimeAccess.mapExecutableRoots.map(
			(root) => `(allow file-map-executable (subpath ${schemeString(root)}))`,
		),
		...(options.systemToolRoots ?? []).map(
			(root) => `(allow file-map-executable (subpath ${schemeString(root)}))`,
		),
		...readableRoots.flatMap((root) => readableRootRules(root)),
		...ancestorRoots.flatMap((root) => ancestorDirectoryRules(root)),
		...writableRoots.flatMap((root) => writableRootRules(root)),
	];
}

function readableRootRules(root: string): string[] {
	return [
		ancestorMetadataRule(root),
		`(allow file-read* (subpath ${schemeString(root)}))`,
	];
}

function ancestorDirectoryRules(root: string): string[] {
	return [
		`(allow file-read-data (literal ${schemeString(root)}))`,
		`(allow file-read-data (path-ancestors ${schemeString(root)}))`,
	];
}

function writableRootRules(root: string): string[] {
	return [
		`(allow file-read* (literal ${schemeString(root)}))`,
		`(allow file-read-metadata file-test-existence (literal ${schemeString(root)}))`,
		`(allow file-write* (subpath ${schemeString(root)}))`,
	];
}

function ancestorMetadataRule(file: string): string {
	return `(allow file-read-metadata file-test-existence (path-ancestors ${schemeString(file)}))`;
}

function schemeString(value: string): string {
	return JSON.stringify(value);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort();
}
