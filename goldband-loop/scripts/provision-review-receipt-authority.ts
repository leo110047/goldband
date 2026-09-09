#!/usr/bin/env bun
import { REVIEW_HOST_EVIDENCE_POLICY } from "../lib/review-runtime-contract";

import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

function argument(name: string): string {
	const index = process.argv.indexOf(`--${name}`);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value || !isAbsolute(value)) throw new Error(`--${name} requires an absolute path`);
	return resolve(value);
}

function assertPrivateRegularFile(file: string): void {
	const stat = lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
		throw new Error(`review receipt authority file is unsafe: ${file}`);
	}
	if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
		throw new Error(`review receipt authority file has the wrong owner: ${file}`);
	}
}

const runtimeRoot = argument("runtime-root");
const authorityRoot = argument("authority-root");
mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
mkdirSync(authorityRoot, { recursive: true, mode: 0o700 });
chmodSync(authorityRoot, 0o700);

const keyFile = join(authorityRoot, "review-receipt.key");
if (!existsSync(keyFile)) {
	writeFileSync(keyFile, `${randomBytes(32).toString("hex")}\n`, {
		mode: 0o600,
		flag: "wx",
	});
}
assertPrivateRegularFile(keyFile);
if (!/^[a-f0-9]{64}\n?$/.test(readFileSync(keyFile, "utf8"))) {
	throw new Error(`review receipt authority key is invalid: ${keyFile}`);
}

const receiptStore = join(authorityRoot, "review-receipts");
mkdirSync(receiptStore, { recursive: true, mode: 0o700 });
chmodSync(receiptStore, 0o700);
const configFile = join(runtimeRoot, "trusted-runtime.json");
const existing = existsSync(configFile)
	? JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>
	: {};
if (existing.schemaVersion !== undefined && existing.schemaVersion !== 2) {
	throw new Error(`trusted runtime configuration is invalid: ${configFile}`);
}
const config = {
	...existing,
	schemaVersion: 2,
	runtimeHost: "claude",
	...REVIEW_HOST_EVIDENCE_POLICY,
	reviewReceiptAuthorityRoot: authorityRoot,
	reviewReceiptKeyFile: keyFile,
	reviewReceiptStore: receiptStore,
};
const temporary = `${configFile}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
	mode: 0o600,
	flag: "wx",
});
renameSync(temporary, configFile);
