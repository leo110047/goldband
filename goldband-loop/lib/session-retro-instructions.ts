import { createHash } from "node:crypto";
import type {
	RetroEvidenceV1,
	RetroInstructionLoadV1,
} from "./session-retro-evidence";

/**
 * Measured `ineffective-instructions` evidence: the always-on instruction
 * sources a session loaded and the paragraphs repeated verbatim across them.
 * Source identities and text stay in memory; evidence keeps kinds, content
 * hashes, byte counts, and record positions.
 */

/** A paragraph shorter than this is a label or heading fragment, not an instruction. */
const MIN_PARAGRAPH_BYTES = 40;
const REF_LIMIT = 20;
const GROUP_LIMIT = 20;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^\s{0,3}#/;

type Ref = (ordinal: number) => string;

/** The latest load of one source and every record that loaded it. */
type Source = { latest: RetroInstructionLoadV1; ordinals: number[] };

export function instructionEvidence(
	loads: RetroInstructionLoadV1[],
	ref: Ref,
): RetroEvidenceV1[] {
	const sources = latestSources(loads);
	if (sources.length === 0) return [];
	const evidence: RetroEvidenceV1[] = sources.map(({ latest, ordinals }) => ({
		...measured(
			"instruction-source",
			loadRefs(ordinals, ref),
			Buffer.byteLength(latest.content),
			"bytes",
		),
		sourceKind: latest.kind,
		contentSha256: sha256(latest.content),
	}));
	evidence.push(
		measured(
			"instruction-bytes",
			firstRefs(
				sources.map(({ latest }) => latest.ordinal),
				ref,
			),
			sources.reduce(
				(sum, { latest }) => sum + Buffer.byteLength(latest.content),
				0,
			),
			"bytes",
		),
	);
	return [...evidence, ...duplicateParagraphEvidence(sources, ref)];
}

/** Sources in order of first load, each with the content it was last loaded with. */
function latestSources(loads: RetroInstructionLoadV1[]): Source[] {
	const sources = new Map<string, Source>();
	for (const load of [...loads].sort((a, b) => a.ordinal - b.ordinal)) {
		const source = sources.get(load.source);
		if (source) {
			source.latest = load;
			source.ordinals.push(load.ordinal);
		} else sources.set(load.source, { latest: load, ordinals: [load.ordinal] });
	}
	return [...sources.values()];
}

/**
 * Paragraphs found verbatim, after whitespace normalization, in two or more
 * sources: the GROUP_LIMIT that repeat the most bytes, then
 * `duplicate-paragraph-groups` and the repeated bytes over every group.
 */
function duplicateParagraphEvidence(
	sources: Source[],
	ref: Ref,
): RetroEvidenceV1[] {
	const holders = new Map<string, { bytes: number; ordinals: number[] }>();
	for (const { latest } of sources) {
		for (const paragraph of new Set(paragraphs(latest.content))) {
			const key = sha256(paragraph);
			const entry = holders.get(key);
			if (entry) entry.ordinals.push(latest.ordinal);
			else
				holders.set(key, {
					bytes: Buffer.byteLength(paragraph),
					ordinals: [latest.ordinal],
				});
		}
	}
	const groups = [...holders.entries()]
		.filter(([, entry]) => entry.ordinals.length > 1)
		.map(([key, entry]) => ({
			key,
			...entry,
			repeated: entry.bytes * (entry.ordinals.length - 1),
		}))
		.sort(
			(a, b) =>
				b.repeated - a.repeated ||
				a.ordinals[0] - b.ordinals[0] ||
				(a.key < b.key ? -1 : 1),
		);
	if (groups.length === 0) return [];
	const firsts = firstRefs(
		groups.map((group) => group.ordinals[0]),
		ref,
	);
	return [
		...groups.slice(0, GROUP_LIMIT).map((group) => ({
			...measured(
				"duplicate-paragraph",
				// Sources loaded by one record share its position.
				firstRefs(group.ordinals, ref),
				group.ordinals.length,
				"count",
			),
			contentSha256: group.key,
		})),
		measured("duplicate-paragraph-groups", firsts, groups.length, "count"),
		measured(
			"duplicate-paragraph-bytes",
			firsts,
			groups.reduce((sum, group) => sum + group.repeated, 0),
			"bytes",
		),
	];
}

/**
 * Paragraphs are blocks between blank lines and headings; a list item, with
 * its continuation lines, is its own paragraph. Whitespace runs collapse to
 * one space and list markers are dropped.
 */
function paragraphs(content: string): string[] {
	const found: string[] = [];
	let current: string[] = [];
	const flush = () => {
		const text = current.join(" ").replaceAll(/\s+/g, " ").trim();
		if (Buffer.byteLength(text) >= MIN_PARAGRAPH_BYTES) found.push(text);
		current = [];
	};
	for (const line of content.split(/\r?\n/)) {
		if (line.trim() === "" || HEADING.test(line)) {
			flush();
			continue;
		}
		if (LIST_ITEM.test(line)) flush();
		current.push(line.replace(LIST_ITEM, ""));
	}
	flush();
	return found;
}

/**
 * The records that loaded a source; past REF_LIMIT, the first ones and the
 * latest, which holds the measured content.
 */
function loadRefs(ordinals: number[], ref: Ref): string[] {
	const distinct = [...new Set(ordinals)].sort((a, b) => a - b);
	const cited =
		distinct.length > REF_LIMIT
			? [...distinct.slice(0, REF_LIMIT - 1), distinct[distinct.length - 1]]
			: distinct;
	return cited.map(ref);
}

/** The first REF_LIMIT distinct positions, in record order. */
function firstRefs(ordinals: number[], ref: Ref): string[] {
	return [...new Set(ordinals)]
		.sort((a, b) => a - b)
		.slice(0, REF_LIMIT)
		.map(ref);
}

function measured(
	rule: string,
	refs: string[],
	value: number,
	unit: "count" | "bytes",
): RetroEvidenceV1 {
	return {
		facet: "ineffective-instructions",
		grade: "measured",
		rule,
		refs,
		metric: { value, unit },
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
