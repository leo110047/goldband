// A separator-delimited credential key; `_` and `-` may precede it
// (`GITHUB_TOKEN`) but not extend it (`token_count`).
const CREDENTIAL_KEY =
	String.raw`(?<![A-Za-z0-9])(?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret[_-]?(?:access[_-]?)?key|access[_-]?key|secret|password|passwd|client[_-]?secret)(?![A-Za-z0-9_])['"]?[ \t]*[:=][ \t]*`;
// A bare type name ends at a delimiter, so `none-of-…` is still a value.
const TYPE_NAME =
	String.raw`(?:string|number|boolean|bigint|any|unknown|never|undefined|null|object|symbol|void|str|int|float|bool|bytes|true|false|none)(?=[\s;,)}\][|?>=]|$)`;

// A rule with a `prefix` group redacts only the text after that prefix.
export const SECRET_CONTENT_RULES: ReadonlyArray<{
	name: string;
	pattern: RegExp;
}> = [
	{ name: "openai-api-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
	{ name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
	{ name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "stripe-live-key", pattern: /\b[rs]k_live_[A-Za-z0-9]{24,}\b/ },
	{
		// Spans any encoding of the body (escaped JSON, indentation); an
		// unterminated block runs to the end of the text it is given.
		name: "private-key-block",
		pattern:
			/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*)/,
	},
	{
		name: "jwt",
		pattern:
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
	},
	{ name: "bearer-token", pattern: /\bBearer[ \t]+[A-Za-z0-9._~+/-]+=*/i },
	{
		name: "credential-uri",
		pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
	},
	{
		// A quoted value is redacted up to its matching closing quote; escaped
		// characters and the other quote kind belong to the value.
		name: "credential-assignment",
		pattern: new RegExp(
			String.raw`(?<prefix>${CREDENTIAL_KEY}(?<quote>['"]))(?=(?:\\.|(?!\k<quote>)[^\s\\]){6})(?:\\.|(?!\k<quote>)[^\\\r\n])+`,
			"i",
		),
	},
	{
		// An unquoted value keeps its trailing delimiters visible. A leading `[`
		// is an array literal or a marker an earlier rule left.
		name: "credential-assignment",
		pattern: new RegExp(
			String.raw`(?<prefix>${CREDENTIAL_KEY})(?!${TYPE_NAME}|\[)(?=[^\s'"]{6})[^\s'"]*[^\s'"\`,;)\]}]`,
			"i",
		),
	},
];

const GLOBAL_RULES = SECRET_CONTENT_RULES.map(
	({ pattern }) => new RegExp(pattern.source, `${pattern.flags}g`),
);

export function detectSecretLikeContent(text: string): string | null {
	for (const { name, pattern } of SECRET_CONTENT_RULES) {
		if (pattern.test(text)) return name;
	}
	return null;
}

// Keeps the line breaks inside each match so line numbers after a redaction
// stay aligned.
export function redactSecretLikeContent(
	text: string,
	marker = "[redacted]",
): string {
	return redactMatches(
		text,
		(match) => marker + (match.match(/\r?\n/g) ?? []).join(""),
	);
}

// Redacts each hunk separately, so an unterminated match stays within its
// hunk, and leaves binary patch data unchanged. Every spanned line keeps its
// diff prefix, so the result remains a well-formed unified diff.
export function redactSecretLikeDiff(diff: string, marker = "[redacted]"): string {
	return diff
		.split(/(?=^diff --git )/m)
		.map((section) => {
			const binary = section.search(/^GIT binary patch\r?$/m);
			const text = binary === -1 ? section : section.slice(0, binary);
			const redacted = text
				.split(/(?=^@@ )/m)
				.map((hunk) => redactKeyBodyLines(redactDiffText(hunk, marker), marker))
				.join("");
			return redacted + section.slice(text.length);
		})
		.join("");
}

function redactDiffText(text: string, marker: string): string {
	return redactMatches(text, (match) => {
		const [, ...rest] = match.split(/(\r?\n)/);
		let replaced = marker;
		for (let index = 0; index < rest.length; index += 2) {
			replaced += rest[index] + rest[index + 1].slice(0, 1);
		}
		return replaced;
	});
}

// A diff line holding only base64, bare or as a quoted string fragment.
const KEY_BODY_LINE =
	/^([ +-][ \t]*["'`]?)([A-Za-z0-9+/=]+)((?:\\n)?["'`]?(?:[ \t]*[+,])?[ \t]*\r?)$/;
const KEY_FOOTER_LINE = /^[ +-].*?-----END [A-Z ]*PRIVATE KEY-----/;

// Every complete block is already redacted, so key body left in a hunk belongs
// to a key whose BEGIN lies in an earlier hunk. Body lines run up to a remaining
// END marker, the last of them possibly short; without a marker, consecutive
// lines at PEM or OpenSSH wrap width (64 or 70) are a key's middle. Only the
// base64 run is replaced.
function redactKeyBodyLines(hunk: string, marker: string): string {
	const lines = hunk.split("\n");
	const bodies = lines.map((line) => KEY_BODY_LINE.exec(line));
	const redact = (index: number) => {
		const body = bodies[index]!;
		lines[index] = body[1] + marker + body[3];
	};
	for (let index = 0; index < lines.length; index++) {
		if (!KEY_FOOTER_LINE.test(lines[index])) continue;
		for (
			let body = index - 1;
			body >= 0 && bodies[body] && (body === index - 1 || bodies[body]![2].length >= 16);
			body--
		) {
			redact(body);
		}
	}
	const atWrapWidth = (index: number) => {
		const length = bodies[index]?.[2].length ?? 0;
		return length >= 60 && length <= 76;
	};
	for (let start = 0; start < lines.length; ) {
		let end = start;
		while (end < lines.length && atWrapWidth(end)) end++;
		if (end - start >= 2) {
			for (let index = start; index < end; index++) redact(index);
		}
		start = Math.max(end, start + 1);
	}
	return lines.join("\n");
}

function redactMatches(
	text: string,
	replace: (match: string) => string,
): string {
	let redacted = text;
	for (const pattern of GLOBAL_RULES) {
		redacted = redacted.replace(pattern, (match, ...args) => {
			const groups = args.at(-1);
			const prefix: string | undefined =
				typeof groups === "object" ? groups.prefix : undefined;
			return prefix === undefined
				? replace(match)
				: prefix + replace(match.slice(prefix.length));
		});
	}
	return redacted;
}
