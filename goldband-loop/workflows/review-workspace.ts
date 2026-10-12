import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";

export type ReviewWorkspaceCoordinates = {
	repositoryRoot: string;
	invocationDirectory: string;
	invocationOffset: string;
};

export function resolveReviewWorkspace(
	cwd: string,
): ReviewWorkspaceCoordinates {
	const invocationDirectory = realpathSync(cwd);
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: invocationDirectory,
		encoding: "utf8",
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" },
		timeout: 30_000,
		maxBuffer: 1024 * 1024,
	});
	const reportedRoot = result.stdout.trim();
	if (result.status !== 0 || !reportedRoot) {
		throw new Error("review workspace requires an unambiguous Git repository");
	}
	const repositoryRoot = realpathSync(reportedRoot);
	const invocationOffset = relative(
		repositoryRoot,
		invocationDirectory,
	).replaceAll("\\", "/");
	if (
		invocationOffset === ".." ||
		invocationOffset.startsWith("../") ||
		invocationOffset.startsWith(`..${sep}`)
	) {
		throw new Error(
			"review invocation directory escapes the canonical Git repository",
		);
	}
	return { repositoryRoot, invocationDirectory, invocationOffset };
}
