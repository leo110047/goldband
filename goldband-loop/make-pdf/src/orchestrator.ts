/**
 * Orchestrator — ties render, the PDF renderer, and filesystem together.
 *
 *   generate(opts): markdown → PDF on disk. Returns output path.
 *   preview(opts):  markdown → HTML, opens it in a browser.
 *
 * Progress indication (per DX spec):
 *   - stdout: ONLY the output path, printed by cli.ts after this returns.
 *   - stderr: spinner + per-stage status lines, unless opts.quiet.
 *   - --verbose: stage timings.
 *
 * Browser lifecycle: every generate launches its own headless Chromium through
 * pdfRenderer.ts and closes it in a try/finally, so parallel $P generate calls
 * never share browser state.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";

import { render } from "./render";
import type { GenerateOptions, PreviewOptions } from "./types";
import { renderPdf } from "./pdfRenderer";

class ProgressReporter {
  private readonly quiet: boolean;
  private readonly verbose: boolean;
  private readonly stageStart = new Map<string, number>();
  private readonly totalStart: number;
  constructor(opts: { quiet?: boolean; verbose?: boolean }) {
    this.quiet = opts.quiet === true;
    this.verbose = opts.verbose === true;
    this.totalStart = Date.now();
  }
  begin(stage: string): void {
    this.stageStart.set(stage, Date.now());
    if (this.quiet) return;
    process.stderr.write(`\r\x1b[K${stage}...`);
  }
  end(stage: string, extra?: string): void {
    const start = this.stageStart.get(stage) ?? Date.now();
    const ms = Date.now() - start;
    if (this.quiet) return;
    if (this.verbose) {
      process.stderr.write(`\r\x1b[K${stage} (${ms}ms)${extra ? ` — ${extra}` : ""}\n`);
    }
  }
  done(extra: string): void {
    if (this.quiet) return;
    const total = ((Date.now() - this.totalStart) / 1000).toFixed(1);
    process.stderr.write(`\r\x1b[KDone in ${total}s. ${extra}\n`);
  }
  fail(stage: string, err: Error): void {
    if (!this.quiet) process.stderr.write("\r\x1b[K");
    // Always emit failure info, even in quiet mode — this is an error path.
    process.stderr.write(`${stage} failed: ${err.message}\n`);
  }
}

/**
 * generate — full pipeline. Returns the output PDF path on success.
 */
export async function generate(opts: GenerateOptions): Promise<string> {
  const progress = new ProgressReporter(opts);
  const input = path.resolve(opts.input);

  if (!fs.existsSync(input)) {
    throw new Error(`input file not found: ${input}`);
  }

  const outputPath = path.resolve(
    opts.output ?? path.join(os.tmpdir(), `${deriveSlug(input)}.pdf`),
  );

  // Stage 1: read markdown
  progress.begin("Reading markdown");
  const markdown = fs.readFileSync(input, "utf8");
  progress.end("Reading markdown");

  // Stage 2: render HTML
  progress.begin("Rendering HTML");
  const rendered = render({
    markdown,
    title: opts.title,
    author: opts.author,
    date: opts.date,
    cover: opts.cover,
    toc: opts.toc,
    watermark: opts.watermark,
    noChapterBreaks: opts.noChapterBreaks,
    confidential: opts.confidential,
    pageSize: opts.pageSize,
    margins: opts.margins,
    pageNumbers: opts.pageNumbers,
    footerTemplate: opts.footerTemplate,
  });
  progress.end("Rendering HTML", `${rendered.meta.wordCount} words`);

  // Stage 3: keep the rendered HTML on disk while Chromium runs, which helps
  // when debugging a failed render.
  const htmlTmp = tmpFile("html");
  fs.writeFileSync(htmlTmp, rendered.html, "utf8");

  // Stage 4: load the HTML into a dedicated Chromium, wait for Paged.js when a
  // TOC was requested, then emit the PDF. The renderer always closes Chromium.
  try {
    progress.begin("Generating PDF");
    await renderPdf({
      html: rendered.html,
      output: outputPath,
      waitUntil: "domcontentloaded",
      format: opts.pageSize ?? "letter",
      marginTop: opts.marginTop ?? opts.margins ?? "1in",
      marginRight: opts.marginRight ?? opts.margins ?? "1in",
      marginBottom: opts.marginBottom ?? opts.margins ?? "1in",
      marginLeft: opts.marginLeft ?? opts.margins ?? "1in",
      headerTemplate: opts.headerTemplate,
      footerTemplate: opts.footerTemplate,
      // CSS is the single source of truth for page numbers (see print-css.ts
      // @bottom-center). Chromium's native numbering always off to avoid double
      // footers. The CSS layer honors pageNumbers + footerTemplate via render().
      pageNumbers: false,
      tagged: opts.tagged !== false,
      outline: opts.outline !== false,
      printBackground: !!opts.watermark,
      toc: opts.toc,
    });
    progress.end("Generating PDF");

    const stat = fs.statSync(outputPath);
    const kb = Math.round(stat.size / 1024);
    progress.done(`${rendered.meta.wordCount} words · ${kb}KB · ${outputPath}`);
  } finally {
    try { fs.unlinkSync(htmlTmp); } catch { /* best-effort */ }
  }

  return outputPath;
}

/**
 * preview — render HTML and open it. No PDF round trip.
 */
export async function preview(opts: PreviewOptions): Promise<string> {
  const progress = new ProgressReporter(opts);
  const input = path.resolve(opts.input);
  if (!fs.existsSync(input)) {
    throw new Error(`input file not found: ${input}`);
  }

  progress.begin("Rendering HTML");
  const markdown = fs.readFileSync(input, "utf8");
  const rendered = render({
    markdown,
    title: opts.title,
    author: opts.author,
    date: opts.date,
    cover: opts.cover,
    toc: opts.toc,
    watermark: opts.watermark,
    noChapterBreaks: opts.noChapterBreaks,
    confidential: opts.confidential,
    pageNumbers: opts.pageNumbers,
  });
  progress.end("Rendering HTML", `${rendered.meta.wordCount} words`);

  // Write to a stable path under /tmp so the user can reload in the same tab.
  const previewPath = path.join(os.tmpdir(), `make-pdf-preview-${deriveSlug(input)}.html`);
  fs.writeFileSync(previewPath, rendered.html, "utf8");

  progress.begin("Opening preview");
  tryOpen(previewPath);
  progress.end("Opening preview");

  progress.done(`Preview at ${previewPath}`);
  return previewPath;
}

// ─── helpers ──────────────────────────────────────────────

function deriveSlug(p: string): string {
  const base = path.basename(p).replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 64) || "document";
}

function tmpFile(ext: string): string {
  const hash = crypto.randomBytes(6).toString("hex");
  return path.join(os.tmpdir(), `make-pdf-${process.pid}-${hash}.${ext}`);
}

function tryOpen(pathOrUrl: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" :
              platform === "win32" ? "cmd" :
              "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", pathOrUrl] : [pathOrUrl];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Non-fatal; the caller already has the path and will print it.
  }
}

/** Setup-only re-export so cli.ts can dynamic-import without another file. */
