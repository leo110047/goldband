import { assertValidClaudeReviewMaxBudgetUsd } from "../workflows/review-budgets";

// Review collection and prompt transport share the full-patch budget.
export const MAX_REVIEW_DIFF_BYTES = 2 * 1024 * 1024;
export const MAX_REVIEW_PROMPT_OVERHEAD_BYTES = 48 * 1024;
export const REVIEW_RESOURCE_CLEANUP_TIMEOUT_MS = 30_000;
export const REVIEW_ACTIVE_ENV = "GOLDBAND_REVIEW_ACTIVE";
const NESTED_REVIEW_ERROR = "review/code cannot start inside an active review";
export const REVIEW_SCOPE_FLAGS = [
	"--staged", "--worktree", "--base", "--diff-file", "--include-untracked",
] as const;
export type ReviewScopeFlag = (typeof REVIEW_SCOPE_FLAGS)[number];
type ReviewScopeOptions = {
	staged?: boolean;
	worktree?: boolean;
	base?: string;
	diffFile?: string;
	includeUntracked?: boolean;
};

type ReviewExecutionOptions = ReviewScopeOptions & {
	reviewClaudeMaxBudgetUsd?: number;
	workId?: string;
	ticketId?: string;
};

export function assertReviewNotNested(
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (env[REVIEW_ACTIVE_ENV]) throw new Error(NESTED_REVIEW_ERROR);
}

export function assertValidReviewScopeFlags(flags: ReviewScopeFlag[]): void {
	const selected = new Set(flags);
	const primary = REVIEW_SCOPE_FLAGS.filter(
		(flag) => flag !== "--include-untracked" && selected.has(flag),
	);
	const allowedBaseWorktree =
		primary.length === 2 &&
		primary.includes("--base") &&
		primary.includes("--worktree");
	const diffFileWithUntracked =
		selected.has("--diff-file") && selected.has("--include-untracked");
	if ((primary.length > 1 && !allowedBaseWorktree) || diffFileWithUntracked) {
		throw new Error(
			`conflicting review scope flags: ${REVIEW_SCOPE_FLAGS.filter((flag) => selected.has(flag)).join(", ")}; use one scope, with --base --worktree as the only combined scope`,
		);
	}
}

function assertValidReviewScopeOptions(options: ReviewScopeOptions): void {
	const flags: ReviewScopeFlag[] = [];
	if (options.staged) flags.push("--staged");
	if (options.worktree) flags.push("--worktree");
	if (options.base !== undefined) flags.push("--base");
	if (options.diffFile !== undefined) flags.push("--diff-file");
	if (options.includeUntracked) flags.push("--include-untracked");
	assertValidReviewScopeFlags(flags);
}

export function assertValidReviewExecutionOptions(
	options: ReviewExecutionOptions,
): void {
	if (options.workId || options.ticketId) {
		throw new Error("review/code no longer manages Work Map tickets; use an explicit diff scope");
	}
	assertValidReviewScopeOptions(options);
	assertValidClaudeReviewMaxBudgetUsd(options.reviewClaudeMaxBudgetUsd);
}
