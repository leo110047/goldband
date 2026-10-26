import {
	entryPath,
	KnowledgeEntryLockError,
	type KnowledgeEntry,
	knowledgeRoot,
	parseKnowledgeFile,
	todayIsoDate,
	withKnowledgeEntryLock,
	writeKnowledgeEntry,
} from "./knowledge";

/**
 * Records a user-run comparison for an `unproven` retro instruction
 * candidate: runs with the instruction as it is (`keep`) against runs with it
 * removed or consolidated as the candidate proposes (`change`). The user runs
 * both arms with tools of their choice; this module validates the scores,
 * applies the verdict rule, and attaches the result to the candidate. It runs
 * no model and spends nothing.
 */

/** The note retro writes on an `unproven` candidate; a recorded eval replaces it. */
export const RETRO_UNPROVEN_NOTE =
	"- 驗證狀態：unproven（未經 eval，不可直接刪除或合併；以 Goldband runtime 的 `bin/goldband-retro eval` 附上保留 vs 變更的比較結果）";

/** The note on candidates written before the eval command existed. */
const LEGACY_UNPROVEN_NOTE =
	"- 驗證狀態：unproven（未經 eval，不可直接刪除或合併）";
const CANDIDATE_ID_RE = /^retro-[0-9a-f]{16}$/;
const METRIC_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 1000;
const REQUEST_KEYS = ["candidate", "metric", "better", "keep", "change"];

type EvalRequest = {
	candidate: string;
	metric: string;
	better: "higher" | "lower";
	keep: number[];
	change: number[];
};
type Arm = { count: number; mean: number };
/** An arm with its exact sum in units of 2^-1074, which `Arm` output omits. */
type MeasuredArm = Arm & { sum: bigint };
type EvalStatus = "ineffective" | "effective";

export type RetroEvalResult =
	| {
			status: "completed";
			id: string;
			evalStatus: EvalStatus;
			metric: string;
			better: "higher" | "lower";
			keep: Arm;
			change: Arm;
	  }
	| { status: "blocked"; reason: string };

/**
 * One score per run. The change is `ineffective` (the instruction did not
 * help) when the change arm's mean is no worse than the keep arm's in the
 * `better` direction, and `effective` (keep the instruction) otherwise. Each
 * candidate takes one eval.
 */
export function runRetroEval(
	request: unknown,
	options: { knowledgeRoot?: string } = {},
): RetroEvalResult {
	const root = options.knowledgeRoot ?? knowledgeRoot();
	let input: EvalRequest;
	try {
		input = validateRequest(request);
	} catch (error) {
		return { status: "blocked", reason: (error as Error).message };
	}
	const file = entryPath(input.candidate, root);
	try {
		// The entry lock keeps review actions from changing it between read and write.
		return withKnowledgeEntryLock(input.candidate, root, () =>
			recordEval(input, file, root),
		);
	} catch (error) {
		if (error instanceof KnowledgeEntryLockError)
			return { status: "blocked", reason: error.message };
		throw error;
	}
}

function recordEval(
	input: EvalRequest,
	file: string,
	root: string,
): RetroEvalResult {
	const entry = pendingCandidate(input.candidate, file);
	if (typeof entry === "string") return { status: "blocked", reason: entry };
	const keep = arm(input.keep);
	const change = arm(input.change);
	const order = compareMeans(change, keep);
	const noWorse = input.better === "higher" ? order >= 0 : order <= 0;
	const evalStatus: EvalStatus = noWorse ? "ineffective" : "effective";
	const today = todayIsoDate();
	writeKnowledgeEntry(
		{
			...entry,
			eval_status: evalStatus,
			updated: today,
			body: evalBody(entry.body, {
				...input,
				evalStatus,
				keep,
				change,
				equal: order === 0,
				today,
			}),
		},
		root,
	);
	return {
		status: "completed",
		id: entry.id,
		evalStatus,
		metric: input.metric,
		better: input.better,
		keep: { count: keep.count, mean: keep.mean },
		change: { count: change.count, mean: change.mean },
	};
}

function validateRequest(value: unknown): EvalRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("eval request must be an object");
	const request = value as Record<string, unknown>;
	const extra = Object.keys(request).find((key) => !REQUEST_KEYS.includes(key));
	if (extra) throw new Error(`eval request has unsupported field: ${extra}`);
	if (
		typeof request.candidate !== "string" ||
		!CANDIDATE_ID_RE.test(request.candidate)
	)
		throw new Error("candidate must be a retro candidate id");
	if (typeof request.metric !== "string" || !METRIC_RE.test(request.metric))
		throw new Error(
			"metric must be a lowercase label of at most 64 characters",
		);
	if (request.better !== "higher" && request.better !== "lower")
		throw new Error("better must be higher or lower");
	return {
		candidate: request.candidate,
		metric: request.metric,
		better: request.better,
		keep: samples(request.keep, "keep"),
		change: samples(request.change, "change"),
	};
}

function samples(value: unknown, label: string): number[] {
	if (
		!Array.isArray(value) ||
		value.length < MIN_SAMPLES ||
		value.length > MAX_SAMPLES ||
		!value.every(
			(sample) => typeof sample === "number" && Number.isFinite(sample),
		)
	)
		throw new Error(
			`${label} must hold ${MIN_SAMPLES} to ${MAX_SAMPLES} finite numbers, one per run`,
		);
	return value;
}

/** The candidate, or why it has no pending eval. */
function pendingCandidate(id: string, file: string): KnowledgeEntry | string {
	let entry: KnowledgeEntry;
	try {
		entry = parseKnowledgeFile(file);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? `knowledge entry not found: ${id}`
			: `knowledge candidate is unreadable: ${id}`;
	}
	if (entry.source !== "retro") return `not a retro candidate: ${id}`;
	if (entry.status !== "candidate")
		return `knowledge entry is ${entry.status}, not a candidate: ${id}`;
	if (entry.eval_status !== "unproven")
		return `candidate has no pending eval: ${id}`;
	return entry;
}

/** The sign of mean(a) - mean(b), computed exactly: sum(a)·|b| against sum(b)·|a|. */
function compareMeans(a: MeasuredArm, b: MeasuredArm): number {
	const left = a.sum * BigInt(b.count);
	const right = b.sum * BigInt(a.count);
	return left === right ? 0 : left > right ? 1 : -1;
}

/** A finite double times 2^1074, exactly: every finite double is a multiple of 2^-1074. */
function exactUnits(value: number, view: DataView): bigint {
	view.setFloat64(0, value);
	const bits = view.getBigUint64(0);
	const exponent = (bits >> 52n) & 0x7ffn;
	const fraction = bits & 0xfffffffffffffn;
	const magnitude =
		exponent === 0n ? fraction : (fraction | (1n << 52n)) << (exponent - 1n);
	return bits >> 63n === 1n ? -magnitude : magnitude;
}

/**
 * The exact mean as the nearest number, ties to even: the exact sum in units
 * of 2^-1074 is divided by the count once, at the precision of the result.
 */
function exactMean(sum: bigint, count: number): number {
	const magnitude = sum < 0n ? -sum : sum;
	// Units below the result's 53 significant bits are rounded away.
	const drop = Math.max(0, (magnitude / BigInt(count)).toString(2).length - 53);
	const divisor = BigInt(count) << BigInt(drop);
	const remainder = (magnitude % divisor) * 2n;
	let units = magnitude / divisor;
	if (remainder > divisor || (remainder === divisor && units % 2n === 1n))
		units += 1n;
	const mean = Number(units) * 2 ** (drop - 1074);
	return sum < 0n ? -mean : mean;
}

/**
 * Means are compared exactly and shown as the nearest number, so a
 * difference below that precision shows equal means; the verdict still
 * follows the exact comparison.
 */
function arm(values: number[]): MeasuredArm {
	const view = new DataView(new ArrayBuffer(8));
	const sum = values.reduce(
		(total, value) => total + exactUnits(value, view),
		0n,
	);
	const mean = exactMean(sum, values.length);
	return { count: values.length, mean, sum };
}

function evalBody(
	body: string,
	result: Pick<EvalRequest, "metric" | "better"> & {
		evalStatus: EvalStatus;
		keep: Arm;
		change: Arm;
		equal: boolean;
		today: string;
	},
): string {
	const verdict =
		result.evalStatus === "ineffective"
			? "ineffective（變更組平均不比保留組差，已證實無效）"
			: "effective（變更組平均比保留組差，有效，保留）";
	const note = `- 驗證狀態：${verdict}`;
	return [
		body
			.split("\n")
			.map((line) =>
				line === RETRO_UNPROVEN_NOTE || line === LEGACY_UNPROVEN_NOTE
					? note
					: line,
			)
			.join("\n")
			.trimEnd(),
		"",
		"### Eval：保留 vs 變更（measured，使用者執行）",
		"",
		`- 指標：${result.metric}（每次執行一個分數，${result.better === "higher" ? "越大越好" : "越小越好"}）`,
		`- 保留：n=${result.keep.count}，平均 ${result.keep.mean}`,
		`- 變更（刪除或合併）：n=${result.change.count}，平均 ${result.change.mean}`,
		...(result.keep.mean === result.change.mean && !result.equal
			? ["- 兩組平均的差異小於顯示精度，判定依精確比較"]
			: []),
		`- 判定：${verdict}`,
		`- 日期：${result.today}`,
	].join("\n");
}
