import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	type BigIntStats,
	type Stats,
} from "node:fs";

const READ_CHUNK_BYTES = 64 * 1024;

export type StableFileReadOptions = {
	/** Prefix for error messages, e.g. "review/code diff file". */
	label: string;
	maxBytes: number;
	/** Path metadata the caller already validated; read from the path when omitted. */
	expected?: Stats;
	/** Error thrown when the file exceeds maxBytes; defaults to a byte-limit message. */
	tooLarge?: () => Error;
	/** Called before every read and after the last one, e.g. to enforce a deadline. */
	checkpoint?: () => void;
	/** Re-read the descriptor and require identical bytes (coarse-timestamp filesystems). */
	confirmContent?: boolean;
	/** Test seam for platforms without O_NOFOLLOW. */
	noFollowFlag?: number | null;
	/** Test seam invoked after the first chunk is read. */
	afterFirstRead?: () => void;
};

/**
 * Read one regular file without following symlinks, within a byte limit, and
 * fail when the path or descriptor changes between validation and the end of
 * the read. Callers decide whether a failure aborts, skips, or degrades.
 * Same-size rewrites are detected through nanosecond mtime/ctime; on
 * filesystems with coarse timestamps only confirmContent catches them.
 */
export function readStableRegularFile(
	file: string,
	options: StableFileReadOptions,
): Buffer {
	const { label, maxBytes } = options;
	const expected = options.expected ?? lstatSync(file);
	if (expected.isSymbolicLink()) {
		throw new Error(`${label} must not be a symbolic link: ${file}`);
	}
	if (!expected.isFile()) {
		throw new Error(`${label} must be a regular file: ${file}`);
	}
	if (expected.size > maxBytes) throw limitError(options);

	const descriptor = openWithoutFollowing(file, label, options.noFollowFlag);
	try {
		return readOpenedFile(descriptor, file, expected, options);
	} finally {
		closeSync(descriptor);
	}
}

function openWithoutFollowing(
	file: string,
	label: string,
	noFollowOverride: number | null | undefined,
): number {
	const noFollowFlag =
		noFollowOverride === undefined
			? (constants.O_NOFOLLOW ?? null)
			: noFollowOverride;
	const flags =
		constants.O_RDONLY | (noFollowFlag ?? 0) | (constants.O_NONBLOCK ?? 0);
	try {
		return openSync(file, flags);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new Error(`${label} must not be a symbolic link: ${file}`);
		}
		throw error;
	}
}

function readOpenedFile(
	descriptor: number,
	file: string,
	expected: Stats,
	options: StableFileReadOptions,
): Buffer {
	const changed = (phase: string) =>
		new Error(`${options.label} changed while being ${phase}: ${file}`);
	if (!sameFileVersion(fstatSync(descriptor), expected)) throw changed("opened");
	const opened = fstatSync(descriptor, { bigint: true });
	if (!opened.isFile()) throw changed("opened");
	if (opened.size > BigInt(options.maxBytes)) throw limitError(options);
	const content = readWithinLimit(descriptor, options);
	if (
		options.confirmContent &&
		!readAt(descriptor, content.length).equals(content)
	) {
		throw changed("read");
	}
	if (
		!samePreciseVersion(fstatSync(descriptor, { bigint: true }), opened) ||
		!pathStillNames(file, opened)
	) {
		throw changed("read");
	}
	return content;
}

function pathStillNames(file: string, opened: BigIntStats): boolean {
	const current = lstatSync(file, { bigint: true });
	return (
		!current.isSymbolicLink() &&
		current.dev === opened.dev &&
		current.ino === opened.ino
	);
}

function limitError(options: StableFileReadOptions): Error {
	return (
		options.tooLarge?.() ??
		new Error(`${options.label} exceeds ${options.maxBytes} byte limit`)
	);
}

function readWithinLimit(
	descriptor: number,
	options: StableFileReadOptions,
): Buffer {
	const chunks: Buffer[] = [];
	let total = 0;
	while (true) {
		options.checkpoint?.();
		const remainingWithSentinel = options.maxBytes + 1 - total;
		const chunk = Buffer.allocUnsafe(
			Math.min(READ_CHUNK_BYTES, remainingWithSentinel),
		);
		const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
		if (bytesRead === 0) break;
		total += bytesRead;
		if (total > options.maxBytes) throw limitError(options);
		chunks.push(chunk.subarray(0, bytesRead));
		if (chunks.length === 1) options.afterFirstRead?.();
	}
	options.checkpoint?.();
	return Buffer.concat(chunks, total);
}

function readAt(descriptor: number, size: number): Buffer {
	const content = Buffer.alloc(size);
	let offset = 0;
	while (offset < size) {
		const bytesRead = readSync(descriptor, content, offset, size - offset, offset);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	return content.subarray(0, offset);
}

function sameFileVersion(opened: Stats, expected: Stats): boolean {
	return (
		opened.isFile() &&
		opened.dev === expected.dev &&
		opened.ino === expected.ino &&
		opened.size === expected.size &&
		opened.mtimeMs === expected.mtimeMs &&
		opened.ctimeMs === expected.ctimeMs
	);
}

function samePreciseVersion(left: BigIntStats, right: BigIntStats): boolean {
	return (
		left.isFile() &&
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs
	);
}
