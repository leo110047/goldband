import { superviseCommand } from '../scripts/process-supervisor.mjs';
import { resolveReviewTimeoutPolicy } from '../workflows/review-timeouts';
import { REVIEW_RESOURCE_CLEANUP_TIMEOUT_MS } from './review-runtime-contract';

/** Keep launcher dependencies inside the materialized (or source-linked) lib owner. */
export async function superviseReviewRuntime(runtimeFile: string, args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }) {
  const seconds = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : Number(args[index + 1]) * 1000;
  };
  const policy = resolveReviewTimeoutPolicy({
    reviewHostTimeoutMs: seconds('--review-host-timeout-seconds'),
    reviewPassTimeoutMs: seconds('--review-pass-timeout-seconds'),
  });
  return await superviseCommand(process.execPath, [runtimeFile, ...args], {
    ...options, stdio: 'inherit', timeoutMs: policy.passTimeoutMs,
    killGraceMs: REVIEW_RESOURCE_CLEANUP_TIMEOUT_MS + 2_000, label: 'goldband review',
  });
}
