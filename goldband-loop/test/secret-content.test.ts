import { describe, expect, test } from "bun:test";
import {
	detectSecretLikeContent,
	redactSecretLikeContent,
	redactSecretLikeDiff,
} from "../lib/secret-content";

const value = ["hunter", "22", "secret"].join("-");
const keyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const keyFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
const keyBody = ["MIIEvQIBADANBgkq", "hkiG9w0BAQEFAASC"].join("");

describe("credential-assignment", () => {
	test("does not treat type annotations or other keys as credential values", () => {
		for (const text of [
			"apiKey: string;",
			"interface Config { accessToken: string }",
			"token: string | null;",
			"secret?: boolean,",
			"password: unknown)",
			"max_tokens=4096000",
			"password_hash = hashValue",
			'password: "must be at least 8 chars"',
		]) {
			expect(detectSecretLikeContent(text)).toBeNull();
		}
	});

	test("detects values that only resemble code or type names", () => {
		for (const text of [
			"API_KEY=SG.abcdEFGHijkl.mnopQRSTuvwx-yz12",
			"PASSWORD=none-of-your-business",
			"PASSWORD=$ecretP@ss99",
			"password=Hunter2.Bravo",
			"secret: string-literal-xyz",
			"password = options.password",
		]) {
			expect(detectSecretLikeContent(text)).toBe("credential-assignment");
		}
	});

	test("detects quoted literals and unquoted values in any spacing", () => {
		for (const text of [
			`apiKey: "${value}"`,
			`password = '${value}'`,
			`{"client_secret": "${value}"}`,
			`API_TOKEN=${value}`,
			`--password=${value}`,
			"password: hunter22secret",
			"API_KEY = abcdef123456",
		]) {
			expect(detectSecretLikeContent(text)).toBe("credential-assignment");
		}
	});

	test("detects keys that follow an underscore or hyphen", () => {
		for (const text of [
			`GITHUB_TOKEN=${value}`,
			`DB_PASSWORD=${value}`,
			`AZURE_CLIENT_SECRET=${value}`,
			`x-api-key: ${value}`,
			`${["AWS", "SECRET", "ACCESS", "KEY"].join("_")}=${value}`,
			`${["STRIPE", "SECRET", "KEY"].join("_")}=${value}`,
			`secretKey: "${value}"`,
		]) {
			expect(detectSecretLikeContent(text)).toBe("credential-assignment");
		}
	});

	test("does not extend secret or access to unrelated key names", () => {
		for (const text of ["secret_name = my-secret-name", "access_level=administrator"]) {
			expect(detectSecretLikeContent(text)).toBeNull();
		}
	});
});

describe("stripe-live-key", () => {
	test("detects live secret and restricted keys", () => {
		for (const prefix of ["sk", "rk"]) {
			const key = [prefix, "live", "abcdefghijklmnopqrstuvwx"].join("_");
			expect(redactSecretLikeContent(`STRIPE=${key}`)).toBe("STRIPE=[redacted]");
		}
	});

	test("does not redact a value twice when a credential key precedes it", () => {
		const key = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");
		const name = ["STRIPE", "SECRET", "KEY"].join("_");
		expect(redactSecretLikeContent(`${name}=${key}`)).toBe(`${name}=[redacted]`);
		expect(redactSecretLikeContent(`${name}=${key}`, "[REDACTED]")).toBe(
			`${name}=[REDACTED]`,
		);
	});
});

describe("redactSecretLikeContent", () => {
	test("replaces only the value and keeps surrounding syntax", () => {
		expect(redactSecretLikeContent(`f(\`TOKEN=${value}\`, 1);`)).toBe(
			"f(`TOKEN=[redacted]`, 1);",
		);
		expect(redactSecretLikeContent(`const config = { apiKey: "${value}" };`)).toBe(
			'const config = { apiKey: "[redacted]" };',
		);
	});

	test("redacts the whole value when it contains delimiters or spaces", () => {
		expect(redactSecretLikeContent("TOKEN=abc,def123456789")).toBe(
			"TOKEN=[redacted]",
		);
		expect(
			redactSecretLikeContent('password: "correct horse battery staple"'),
		).toBe('password: "[redacted]"');
	});

	test("redacts key bodies stored as escaped JSON strings or indented YAML", () => {
		const json = `{"private_key": "${keyHeader}\\n${keyBody}\\n${keyFooter}\\n"}`;
		expect(redactSecretLikeContent(json)).toBe('{"private_key": "[redacted]\\n"}');
		const yaml = `key: |\n  ${keyHeader}\n  ${keyBody}\n  ${keyFooter}\nnext: 1\n`;
		expect(redactSecretLikeContent(yaml)).toBe("key: |\n  [redacted]\n\n\nnext: 1\n");
	});

	test("redacts a quoted value up to its matching closing quote", () => {
		expect(redactSecretLikeContent(`password = "pass'word123"; next()`)).toBe(
			'password = "[redacted]"; next()',
		);
		expect(redactSecretLikeContent(`token: 'hi"there ${value}', x`)).toBe(
			"token: '[redacted]', x",
		);
		expect(redactSecretLikeContent(String.raw`secret = "ab\"cdefgh\"ij" + x`)).toBe(
			'secret = "[redacted]" + x',
		);
	});

	test("redacts long whitespace runs in linear time", () => {
		const padding = " ".repeat(200_000);
		const started = performance.now();
		expect(redactSecretLikeContent(`x${padding}y`)).toBe(`x${padding}y`);
		expect(redactSecretLikeContent(`token:${padding}x`)).toBe(`token:${padding}x`);
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	test("does not extend a bearer token across a line break", () => {
		expect(redactSecretLikeContent("// uses Bearer\n  tokens here")).toBe(
			"// uses Bearer\n  tokens here",
		);
		expect(redactSecretLikeContent(`Authorization: Bearer ${value}`)).toBe(
			"Authorization: [redacted]",
		);
	});

	test("preserves CRLF line endings inside a redacted span", () => {
		expect(
			redactSecretLikeContent(`x\r\n${keyHeader}\r\n${keyBody}\r\n${keyFooter}\r\ny`),
		).toBe("x\r\n[redacted]\r\n\r\n\r\ny");
	});
});

describe("redactSecretLikeDiff", () => {
	test("keeps the diff prefix of every line a multi-line match spans", () => {
		const diff = [
			"@@ -1,2 +1,5 @@",
			" context",
			`+${keyHeader}`,
			`+${keyBody}`,
			`+${keyFooter}`,
			`-API_TOKEN=${value}`,
			"+after",
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"@@ -1,2 +1,5 @@",
				" context",
				"+[redacted]",
				"+",
				"+",
				"-API_TOKEN=[redacted]",
				"+after",
			].join("\n"),
		);
	});

	test("an unterminated key header redacts to the end of its own file only", () => {
		const laterFile = [
			"diff --git a/b.ts b/b.ts",
			"@@ -1 +1 @@",
			"-old",
			"+new code",
		].join("\n");
		const diff = [
			"diff --git a/a.ts b/a.ts",
			"@@ -1 +1,3 @@",
			" x",
			`+const pem = "${keyHeader}`,
			`+${keyBody}`,
			laterFile,
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"diff --git a/a.ts b/a.ts",
				"@@ -1 +1,3 @@",
				" x",
				'+const pem = "[redacted]',
				"+",
				laterFile,
			].join("\n"),
		);
	});

	test("an unterminated key header redacts to the end of its own hunk only", () => {
		const laterHunk = ["@@ -40,3 +40,4 @@", " a", "+const x = 1;", ""].join("\n");
		const diff = [
			"diff --git a/k b/k",
			"@@ -1,2 +1,2 @@",
			`-${keyHeader.replace("PRIVATE", "RSA PRIVATE")}`,
			`+${keyHeader}`,
			` ${keyBody}`,
			laterHunk,
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"diff --git a/k b/k",
				"@@ -1,2 +1,2 @@",
				"-[redacted]",
				"+",
				" ",
				laterHunk,
			].join("\n"),
		);
	});

	test("redacts key body lines before an END marker whose BEGIN is in an earlier hunk", () => {
		const diff = [
			"diff --git a/k b/k",
			"@@ -20,4 +20,4 @@",
			"+const before = 1;",
			` ${keyBody}`,
			`-  ${keyBody}`,
			`+${keyBody}`,
			` ${keyFooter}`,
			"+const after = 2;",
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"diff --git a/k b/k",
				"@@ -20,4 +20,4 @@",
				"+const before = 1;",
				" [redacted]",
				"-  [redacted]",
				"+[redacted]",
				` ${keyFooter}`,
				"+const after = 2;",
			].join("\n"),
		);
	});

	test("treats a short final body line before an orphan END marker as key body", () => {
		const diff = [
			"@@ -20,4 +20,4 @@",
			` ${keyBody}`,
			`-${keyBody}`,
			`+${keyBody}`,
			" Ab3x==",
			` ${keyFooter}`,
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"@@ -20,4 +20,4 @@",
				" [redacted]",
				"-[redacted]",
				"+[redacted]",
				" [redacted]",
				` ${keyFooter}`,
			].join("\n"),
		);
	});

	test("redacts a run of PEM-width body lines in a hunk with no key markers", () => {
		const line = `${keyBody}${keyBody}`;
		const diff = ["@@ -10,4 +10,4 @@", ` ${line}`, `-${line}`, `+${line}`, ` ${line}`, "+short"].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			["@@ -10,4 +10,4 @@", " [redacted]", "-[redacted]", "+[redacted]", " [redacted]", "+short"].join(
				"\n",
			),
		);
	});

	test("leaves a single long base64-like line without key markers visible", () => {
		const diff = `@@ -1 +1 @@\n+${keyBody}${keyBody}\n`;
		expect(redactSecretLikeDiff(diff)).toBe(diff);
	});

	test("checks lines before an orphan END marker in linear time", () => {
		const diff = `@@ -1,2 +1,2 @@\n+${keyBody}${" ".repeat(200_000)}x\n ${keyFooter}\n`;
		const started = performance.now();
		expect(redactSecretLikeDiff(diff)).toBe(diff);
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	test("redacts concatenated key string fragments before an orphan END marker", () => {
		const diff = [
			"diff --git a/k.ts b/k.ts",
			"@@ -30,4 +30,4 @@",
			"   doSomething();",
			`   "${keyBody}\\n" +`,
			`-  '${keyBody}\\n',`,
			`+  \`${keyBody}\\n\`,\r`,
			`   "${keyFooter}\\n";`,
		].join("\n");
		expect(redactSecretLikeDiff(diff)).toBe(
			[
				"diff --git a/k.ts b/k.ts",
				"@@ -30,4 +30,4 @@",
				"   doSomething();",
				'   "[redacted]\\n" +',
				"-  '[redacted]\\n',",
				"+  `[redacted]\\n`,\r",
				`   "${keyFooter}\\n";`,
			].join("\n"),
		);
	});

	test("preserves CRLF line endings and diff prefixes inside a redacted span", () => {
		expect(
			redactSecretLikeDiff(`+${keyHeader}\r\n+${keyBody}\r\n+${keyFooter}\r\n+y`),
		).toBe("+[redacted]\r\n+\r\n+\r\n+y");
	});

	test("leaves binary patch data untouched", () => {
		const binaryFile = [
			"diff --git a/blob.bin b/blob.bin",
			"GIT binary patch",
			"literal 40",
			`zc;${["sk", "abcdefghijklmnopqrstuvwxyz"].join("-")}`,
			"",
			"literal 0",
			"HcmV?d00001",
			"",
		].join("\n");
		const textFile = [
			"diff --git a/a.env b/a.env",
			"@@ -0,0 +1 @@",
			`+API_TOKEN=${value}`,
		].join("\n");
		expect(redactSecretLikeDiff(`${binaryFile}\n${textFile}`)).toBe(
			`${binaryFile}\n${textFile.replace(value, "[redacted]")}`,
		);
	});
});
