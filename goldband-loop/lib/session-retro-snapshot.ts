import { createHash, type Hash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
} from "node:fs";
import type { RetroHost, RetroSnapshotRefV1 } from "./session-retro-evidence";

const CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;
/** Bytes read from the start of a record to find a record, in steps. */
const HEAD_BYTES = 4 * 1024 * 1024;
const HEAD_STEP = 256 * 1024;
let headBuffer: Buffer | undefined;

/**
 * A host's record root: absent, a directory, or unreadable, which includes a
 * link, since it could point outside the host's home.
 */
export function retroDirectoryKind(
	path: string,
): "absent" | "directory" | "unreadable" {
	try {
		const stat = lstatSync(path, { throwIfNoEntry: false });
		if (!stat) return "absent";
		return stat.isDirectory() ? "directory" : "unreadable";
	} catch {
		return "unreadable";
	}
}

/** Appended to a not-found reason when some record directories could not be listed. */
export function retroUnreadableNote(unreadable: number): string {
	return unreadable > 0
		? `; ${unreadable} record directories could not be listed`
		: "";
}

/**
 * Streams a JSONL session record as one snapshot. The range ends at the last
 * newline present when reading starts; a trailing partial line and anything
 * appended later are outside the snapshot. Each record is parsed and handed to
 * `onRecord` with its 0-based line ordinal and is not retained.
 */
export function readSessionSnapshot(
	file: string,
	identity: { host: RetroHost; sessionId: string },
	onRecord: (record: unknown, ordinal: number) => void,
	options: { chunkBytes?: number } = {},
): RetroSnapshotRefV1 {
	const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile())
			throw new Error(`${identity.host} session record is not a regular file`);
		const state: LineState = {
			hash: createHash("sha256"),
			pending: [],
			byteLength: 0,
			ordinal: 0,
		};
		const buffer = Buffer.allocUnsafe(options.chunkBytes ?? CHUNK_BYTES);
		for (let position = 0; position < stat.size; ) {
			const read = readSync(
				fd,
				buffer,
				0,
				Math.min(buffer.length, stat.size - position),
				position,
			);
			if (read === 0)
				throw new Error(
					`${identity.host} session record shrank during snapshot`,
				);
			position += read;
			consumeChunk(buffer.subarray(0, read), state, (line) => {
				onRecord(
					parseRecord(line, identity.host, state.ordinal),
					state.ordinal,
				);
			});
		}
		return {
			...identity,
			byteLength: state.byteLength,
			recordCount: state.ordinal,
			sha256: state.hash.digest("hex"),
		};
	} finally {
		closeSync(fd);
	}
}

type LineState = {
	hash: Hash;
	pending: Buffer[];
	byteLength: number;
	ordinal: number;
};

/** Emits each newline-terminated line of `chunk`, joined with bytes carried from earlier chunks. */
function consumeChunk(
	chunk: Buffer,
	state: LineState,
	emit: (line: Buffer) => void,
): void {
	let start = 0;
	for (
		let index = chunk.indexOf(NEWLINE);
		index !== -1;
		index = chunk.indexOf(NEWLINE, start)
	) {
		state.pending.push(chunk.subarray(start, index + 1));
		const line =
			state.pending.length === 1
				? state.pending[0]
				: Buffer.concat(state.pending);
		state.pending = [];
		state.hash.update(line);
		state.byteLength += line.length;
		emit(line);
		state.ordinal += 1;
		start = index + 1;
	}
	// The read buffer is reused, so a carried partial line must be copied.
	if (start < chunk.length)
		state.pending.push(Buffer.from(chunk.subarray(start)));
}

function parseRecord(line: Buffer, host: RetroHost, ordinal: number): unknown {
	const text = line.toString("utf8", 0, line.length - 1);
	if (text.trim() === "")
		throw new Error(`${host} session record ${ordinal} is blank`);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${host} session record ${ordinal} is not valid JSON`);
	}
}

/**
 * The first complete record within HEAD_BYTES for which `pick` returns a
 * value, read HEAD_STEP at a time; undefined when none does or the start
 * cannot be read. Lines that are not JSON are skipped.
 */
export function scanSessionHead<T>(
	file: string,
	pick: (record: unknown) => T | undefined,
): T | undefined {
	try {
		const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		try {
			return scanHead(fd, pick);
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

function scanHead<T>(
	fd: number,
	pick: (record: unknown) => T | undefined,
): T | undefined {
	headBuffer ??= Buffer.allocUnsafe(HEAD_BYTES);
	let length = 0;
	let parsed = 0;
	while (length < HEAD_BYTES) {
		const read = readSync(
			fd,
			headBuffer,
			length,
			Math.min(HEAD_STEP, HEAD_BYTES - length),
			length,
		);
		if (read === 0) return undefined;
		length += read;
		const end = headBuffer.lastIndexOf(NEWLINE, length - 1);
		if (end < parsed) continue;
		for (const line of headBuffer.toString("utf8", parsed, end).split("\n")) {
			const found = pickLine(line, pick);
			if (found !== undefined) return found;
		}
		parsed = end + 1;
	}
	return undefined;
}

function pickLine<T>(
	line: string,
	pick: (record: unknown) => T | undefined,
): T | undefined {
	let record: unknown;
	try {
		record = JSON.parse(line);
	} catch {
		return undefined;
	}
	return pick(record);
}
