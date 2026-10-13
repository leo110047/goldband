/**
 * make-pdf — shared types.
 *
 * No runtime code. Imports are safe from any module.
 */

type PageSize = "letter" | "a4" | "legal" | "tabloid";

/**
 * Options for `$P generate` — the public CLI contract.
 * Matches the flag set documented in the CEO plan.
 */
export interface GenerateOptions {
  input: string;                  // markdown input path
  output?: string;                // PDF output path (default: /tmp/<slug>.pdf)

  // Page layout
  margins?: string;               // "1in" | "72pt" | "25mm" | "2.54cm"
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  pageSize?: PageSize;            // default "letter"

  // Document structure
  cover?: boolean;
  toc?: boolean;
  noChapterBreaks?: boolean;      // default: chapter breaks ON

  // Branding
  watermark?: string;             // e.g. "DRAFT"
  headerTemplate?: string;        // raw HTML
  footerTemplate?: string;        // raw HTML, mutex with pageNumbers
  confidential?: boolean;         // default: true

  // Output control
  pageNumbers?: boolean;          // default: true
  tagged?: boolean;               // default: true (accessible PDF)
  outline?: boolean;              // default: true (PDF bookmarks)
  quiet?: boolean;                // suppress progress on stderr
  verbose?: boolean;              // per-stage timings on stderr

  // Network
  allowNetwork?: boolean;         // default: false

  // Metadata
  title?: string;
  author?: string;
  date?: string;                  // ISO-ish; default: today
}

/**
 * Options for `$P preview`.
 */
export interface PreviewOptions {
  input: string;
  quiet?: boolean;
  verbose?: boolean;
  // Same render flags as generate so preview matches output
  cover?: boolean;
  toc?: boolean;
  watermark?: string;
  noChapterBreaks?: boolean;
  confidential?: boolean;
  pageNumbers?: boolean;
  allowNetwork?: boolean;
  title?: string;
  author?: string;
  date?: string;
}

/**
 * Exit codes for $P generate.
 * Mirror these in orchestrator error paths.
 */
export const ExitCode = {
  Success: 0,
  BadArgs: 1,
  RenderError: 2,
  PagedJsTimeout: 3,
  ChromiumUnavailable: 4,
} as const;
export type ExitCode = typeof ExitCode[keyof typeof ExitCode];

/**
 * Chromium could not be launched for PDF rendering.
 */
export class ChromiumUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Chromium failed to launch: ${detail.trim()}\n` +
        "Install it with: bunx playwright install chromium " +
        "(or set GOLDBAND_CHROMIUM_PATH to a compatible Chromium binary)",
    );
    this.name = "ChromiumUnavailableError";
  }
}
