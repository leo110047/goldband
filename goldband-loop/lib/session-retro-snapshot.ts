import { createHash, type Hash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { RetroHost, RetroSnapshotRefV1 } from "./session-retro-evidence";

const CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

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
