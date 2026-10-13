/**
 * `make-pdf setup` — guided smoke test.
 *
 * Flow (per the CEO plan CLI UX spec):
 *   1. Verify Playwright can launch Chromium
 *   2. Generate a smoke-test PDF from an inline 2-paragraph fixture
 *   3. Print a 3-command cheatsheet
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { checkChromium } from "./pdfRenderer";
import { generate } from "./orchestrator";

export async function runSetup(): Promise<void> {
  process.stderr.write("make-pdf setup — verifying install\n\n");

  // 1. Chromium smoke
  process.stderr.write("  [1/3] Launching Chromium...");
  try {
    const version = await checkChromium();
    process.stderr.write(` OK (${version})\n`);
  } catch (err: any) {
    process.stderr.write(" FAIL\n");
    process.stderr.write(`\n${err.message}\n`);
    process.exit(4);
  }

  // 2. Render smoke-test PDF
  process.stderr.write("  [2/3] Generating smoke-test PDF...\n");
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

  // 3. Cheatsheet
  process.stderr.write("  [3/3] All checks passed.\n\n");
  process.stderr.write([
    "make-pdf is ready. Try:",
    "  make-pdf generate letter.md                  # default memo mode",
    "  make-pdf generate --cover --toc essay.md     # full publication",
    "  make-pdf generate --watermark DRAFT memo.md  # diagonal watermark",
    "",
    `Smoke-test PDF: ${outPath}`,
    "",
  ].join("\n"));
}
