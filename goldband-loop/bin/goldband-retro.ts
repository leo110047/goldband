#!/usr/bin/env bun
import { resolve } from "node:path";
import {
	RETRO_MAX_RANGE_DAYS,
	runRetroEvidence,
	runRetroProposals,
	runRetroRange,
} from "../lib/session-retro-runtime";
import { readStableRegularFile } from "../lib/stable-file-read";
import { resolveGoldbandStateRoot } from "../lib/state-root";

const MAX_INPUT_BYTES = 256 * 1024;
const USAGE = `Usage:
  goldband-retro evidence --host <claude|codex> [--session <id> | --days <1-90>]
    Snapshot the session (default: the current one) and print its measured report.
    With --days, analyze every session in a worktree of the current repository
    changed in that many days and print where each report was written.
  goldband-retro propose --input <file>
    Validate proposals for a reported snapshot and write them as knowledge candidates.`;

/** Exit codes: 0 completed, 1 error, 2 usage error, 3 blocked. */
export function main(args: string[]): number {
	const [command, ...rest] = args;
	const options = parseOptions(rest);
	if (!options) return usage();
	if (
		command === "evidence" &&
		(options.host === "claude" || options.host === "codex") &&
		!options.input
	) {
		return evidence(options.host, options);
	}
	if (
		command === "propose" &&
		options.input &&
		!options.host &&
		!options.session &&
		!options.days
	) {
		const input = readStableRegularFile(resolve(options.input), {
			label: "goldband-retro propose --input",
			maxBytes: MAX_INPUT_BYTES,
			tooLarge: () =>
				new Error(
					`goldband-retro propose --input exceeds ${MAX_INPUT_BYTES} bytes`,
				),
		});
		const result = runRetroProposals(JSON.parse(input.toString("utf8")), {
			stateRoot: resolveGoldbandStateRoot(),
			cwd: process.cwd(),
		});
		console.log(JSON.stringify(result));
		return result.status === "completed" ? 0 : 3;
	}
	return usage();
}

function evidence(host: string, options: Options): number {
	if (options.days === undefined) {
		const result = runRetroEvidence({
			host,
			sessionId: options.session,
			stateRoot: resolveGoldbandStateRoot(),
		});
		console.log(JSON.stringify(result));
		return result.status === "completed" ? 0 : 3;
	}
	const days = /^[1-9][0-9]{0,5}$/.test(options.days)
		? Number(options.days)
		: 0;
	if (options.session || days < 1 || days > RETRO_MAX_RANGE_DAYS)
		return usage();
	const result = runRetroRange({
		host,
		days,
		cwd: process.cwd(),
		stateRoot: resolveGoldbandStateRoot(),
	});
	console.log(JSON.stringify(result));
	return result.status === "completed" ? 0 : 3;
}

function usage(): number {
	console.error(USAGE);
	return 2;
}

type OptionName = "host" | "session" | "input" | "days";
type Options = Partial<Record<OptionName, string>>;

/** Parsed options, or null for a usage error. */
function parseOptions(args: string[]): Options | null {
	const options: Options = {};
	for (let index = 0; index < args.length; index += 2) {
		const name = {
			"--host": "host",
			"--session": "session",
			"--input": "input",
			"--days": "days",
		}[args[index]] as OptionName | undefined;
		const value = args[index + 1];
		if (
			!name ||
			!value ||
			value.startsWith("--") ||
			options[name] !== undefined
		) {
			return null;
		}
		options[name] = value;
	}
	return options;
}

if (import.meta.main) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(
			`goldband-retro: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
