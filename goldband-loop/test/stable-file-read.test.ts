import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	lstatSync,
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStableRegularFile } from "../lib/stable-file-read";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(content: string | Buffer = "stable content\n"): string {
	const root = mkdtempSync(join(tmpdir(), "goldband-stable-read-"));
	roots.push(root);
	const file = join(root, "input.txt");
	writeFileSync(file, content);
	return file;
}

describe("readStableRegularFile", () => {
	test("returns the bytes of an unchanged regular file", () => {
		const file = fixture("one\ntwo\n");
		expect(
			readStableRegularFile(file, { label: "input", maxBytes: 64 }).toString(),
		).toBe("one\ntwo\n");
	});

	test("rejects symbolic links even without O_NOFOLLOW", () => {
		const file = fixture();
		const link = join(file, "..", "link.txt");
		symlinkSync(file, link);
		for (const noFollowFlag of [undefined, null]) {
			expect(() =>
				readStableRegularFile(link, { label: "input", maxBytes: 64, noFollowFlag }),
			).toThrow("input must not be a symbolic link");
		}
	});

	test("rejects a FIFO without blocking", () => {
		if (process.platform === "win32") return;
		const fifo = join(fixture(), "..", "pipe");
		expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
		expect(() => readStableRegularFile(fifo, { label: "input", maxBytes: 64 })).toThrow(
			"input must be a regular file",
		);
	});

	test("enforces the byte limit before and during the read", () => {
		const file = fixture("x".repeat(65));
		expect(() => readStableRegularFile(file, { label: "input", maxBytes: 64 })).toThrow(
			"input exceeds 64 byte limit",
		);
		const growing = fixture("x".repeat(70_000));
		expect(() =>
			readStableRegularFile(growing, {
				label: "input",
				maxBytes: 70_010,
				tooLarge: () => new Error("custom limit"),
				afterFirstRead: () => appendFileSync(growing, "y".repeat(100)),
			}),
		).toThrow("custom limit");
	});

	test("fails when the file differs from the caller's validated metadata", () => {
		const file = fixture();
		const expected = lstatSync(file);
		writeFileSync(file, "replaced with different size\n");
		expect(() =>
			readStableRegularFile(file, { label: "input", maxBytes: 64, expected }),
		).toThrow("input changed while being opened");
	});

	test("fails when the descriptor changes during the read", () => {
		const file = fixture("a".repeat(70_000));
		expect(() =>
			readStableRegularFile(file, {
				label: "input",
				maxBytes: 200_000,
				afterFirstRead: () => writeFileSync(file, "b".repeat(70_000)),
			}),
		).toThrow("input changed while being read");
	});

	test("fails when the path is swapped during the read", () => {
		const file = fixture("a".repeat(70_000));
		const replacement = join(file, "..", "replacement.txt");
		writeFileSync(replacement, "replacement\n");
		expect(() =>
			readStableRegularFile(file, {
				label: "input",
				maxBytes: 200_000,
				afterFirstRead: () => renameSync(replacement, file),
			}),
		).toThrow("input changed while being read");
	});

	test("runs the checkpoint before every chunk and after the read", () => {
		const file = fixture("c".repeat(150_000));
		let calls = 0;
		readStableRegularFile(file, {
			label: "input",
			maxBytes: 200_000,
			checkpoint: () => {
				calls += 1;
			},
		});
		expect(calls).toBeGreaterThanOrEqual(4);
		expect(() =>
			readStableRegularFile(file, {
				label: "input",
				maxBytes: 200_000,
				checkpoint: () => {
					throw new Error("deadline exceeded");
				},
			}),
		).toThrow("deadline exceeded");
	});
});
