/**
 * PDF renderer tests — option mapping plus one real Chromium render.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildPdfOptions, renderPdf, runJobThroughNode } from "../src/pdfRenderer";
import { ChromiumUnavailableError } from "../src/types";

describe("buildPdfOptions", () => {
  test("defaults to Letter and normalizes format casing", () => {
    expect(buildPdfOptions({}).format).toBe("Letter");
    expect(buildPdfOptions({ format: "a4" }).format).toBe("A4");
  });

  test("uses explicit width and height only when no format is given", () => {
    expect(buildPdfOptions({ width: "5in", height: "7in" })).toMatchObject({
      width: "5in",
      height: "7in",
    });
    expect(buildPdfOptions({ format: "legal", width: "5in", height: "7in" }).width)
      .toBeUndefined();
  });

  test("collects only the margins that were set", () => {
    expect(buildPdfOptions({ marginTop: "1in", marginLeft: "2cm" }).margin).toEqual({
      top: "1in",
      left: "2cm",
    });
    expect(buildPdfOptions({}).margin).toBeUndefined();
  });

  test("fills the unset header slot so Chromium prints no URL or date", () => {
    const opts = buildPdfOptions({ footerTemplate: "<span>f</span>" });
    expect(opts.displayHeaderFooter).toBe(true);
    expect(opts.headerTemplate).toBe("<div></div>");
    expect(opts.footerTemplate).toBe("<span>f</span>");
  });

  test("page numbers replace the footer template", () => {
    const opts = buildPdfOptions({ pageNumbers: true, footerTemplate: "<b>x</b>" });
    expect(String(opts.footerTemplate)).toContain('class="pageNumber"');
  });

  test("leaves header and footer off when nothing requests them", () => {
    expect(buildPdfOptions({ pageNumbers: false }).displayHeaderFooter).toBeUndefined();
  });

  test("passes boolean flags through only when true", () => {
    expect(
      buildPdfOptions({ tagged: true, outline: true, printBackground: true, preferCSSPageSize: true }),
    ).toMatchObject({ tagged: true, outline: true, printBackground: true, preferCSSPageSize: true });
    expect(buildPdfOptions({ tagged: false }).tagged).toBeUndefined();
  });
});

describe("renderPdf", () => {
  test("writes a PDF with Playwright Chromium", async () => {
    const output = path.join(os.tmpdir(), `make-pdf-render-${process.pid}.pdf`);
    try {
      await renderPdf({
        html: "<!doctype html><h1>Render check</h1><p>Hello PDF.</p>",
        output,
        format: "letter",
        tagged: true,
        outline: true,
      });
      const bytes = fs.readFileSync(output);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1000);
    } finally {
      fs.rmSync(output, { force: true });
    }
  }, 60_000);

  test("reports an unusable Chromium override as ChromiumUnavailableError", async () => {
    const previous = process.env.GOLDBAND_CHROMIUM_PATH;
    process.env.GOLDBAND_CHROMIUM_PATH = "/nonexistent/chromium";
    try {
      await expect(
        renderPdf({ html: "<p>x</p>", output: path.join(os.tmpdir(), "never.pdf") }),
      ).rejects.toBeInstanceOf(ChromiumUnavailableError);
    } finally {
      if (previous === undefined) delete process.env.GOLDBAND_CHROMIUM_PATH;
      else process.env.GOLDBAND_CHROMIUM_PATH = previous;
    }
  });
});

describe("runJobThroughNode", () => {
  // The Windows path, exercised on any platform with Node available.
  test("renders a PDF in a Node child process", async () => {
    const output = path.join(os.tmpdir(), `make-pdf-node-${process.pid}.pdf`);
    try {
      const version = await runJobThroughNode({
        mode: "render",
        html: "<!doctype html><h1>Node render</h1>",
        output,
        pdfOptions: buildPdfOptions({ format: "a4", pageNumbers: true }),
      });
      expect(version).toMatch(/^\d+\./);
      expect(fs.readFileSync(output).subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      fs.rmSync(output, { force: true });
    }
  }, 60_000);

  test("rejects with the Node error for a bad Chromium path", async () => {
    await expect(
      runJobThroughNode({ mode: "check", executablePath: "/nonexistent/chromium" }),
    ).rejects.toThrow(/nonexistent/);
  }, 60_000);
});
