/**
 * `$P setup` — guided smoke test.
 *
 * Flow (per the CEO plan CLI UX spec):
 *   1. Verify Playwright can launch Chromium
 *   2. Verify pdftotext is installed (warn, don't fail)
 *   3. Generate a smoke-test PDF from an inline 2-paragraph fixture
 *   4. Print a 3-command cheatsheet
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { checkChromium } from "./pdfRenderer";
import { resolvePdftotext, PdftotextUnavailableError } from "./pdftotext";
import { generate } from "./orchestrator";

export async function runSetup(): Promise<void> {
  process.stderr.write("make-pdf setup — verifying install\n\n");

  // 1. Chromium smoke
  process.stderr.write("  [1/4] Launching Chromium...");
  try {
    const version = await checkChromium();
    process.stderr.write(` OK (${version})\n`);
  } catch (err: any) {
    process.stderr.write(" FAIL\n");
    process.stderr.write(`\n${err.message}\n`);
    process.exit(4);
  }

  // 2. pdftotext (optional — CI gate only)
  process.stderr.write("  [2/4] Checking pdftotext (optional)...");
  try {
    const info = resolvePdftotext();
    process.stderr.write(` OK (${info.flavor}, ${info.version.split(" ").slice(-1)[0] || "version unknown"})\n`);
  } catch (err) {
    process.stderr.write(" SKIP\n");
    if (err instanceof PdftotextUnavailableError) {
      process.stderr.write(
        "    pdftotext not installed. This is optional — only the CI\n" +
        "    copy-paste gate needs it. To enable:\n" +
        "      macOS:  brew install poppler\n" +
        "      Ubuntu: sudo apt-get install poppler-utils\n",
      );
    }
  }

  // 3. Render smoke-test PDF
  process.stderr.write("  [3/4] Generating smoke-test PDF...\n");
  const fixture = [
    "# Hello from make-pdf",
    "",
    "This is a two-paragraph smoke test. If you can read this sentence in the PDF that just opened, the pipeline works end-to-end.",
    "",
    "The second paragraph contains curly quotes (\"hello\"), an em dash -- like this, and an ellipsis... all of which should render correctly.",
    "",
  ].join("\n");
  const fixturePath = path.join(os.tmpdir(), `make-pdf-smoke-${process.pid}.md`);
  const outPath = path.join(os.tmpdir(), `make-pdf-smoke-${process.pid}.pdf`);
  fs.writeFileSync(fixturePath, fixture, "utf8");

  try {
    await generate({
      input: fixturePath,
      output: outPath,
      quiet: true,
      pageNumbers: true,
    });
    process.stderr.write(`        PASSED. Smoke test saved to ${outPath}\n`);
  } catch (err: any) {
    process.stderr.write(`        FAILED: ${err.message}\n`);
    process.exit(2);
  } finally {
    try { fs.unlinkSync(fixturePath); } catch { /* ignore */ }
  }

  // 4. Cheatsheet
  process.stderr.write("  [4/4] All checks passed.\n\n");
  process.stderr.write([
    "make-pdf is ready. Try:",
    "  $P generate letter.md                  # default memo mode",
    "  $P generate --cover --toc essay.md     # full publication",
    "  $P generate --watermark DRAFT memo.md  # diagonal watermark",
    "",
    `Smoke-test PDF: ${outPath}`,
    "",
  ].join("\n"));
}
