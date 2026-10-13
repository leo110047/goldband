/**
 * Chromium PDF rendering through Playwright.
 *
 * Each render launches a dedicated headless Chromium, loads the HTML, waits for
 * Paged.js when a table of contents was requested, writes the PDF, and closes
 * the browser. GOLDBAND_CHROMIUM_PATH overrides the Playwright-managed binary,
 * matching the installer's Chromium override.
 *
 * Bun on Windows cannot launch Chromium over Playwright's stdio pipes
 * (oven-sh/bun#4253), and Bun 1.3 cannot use chromium.connect either, so on
 * Windows a Node child process runs the whole job.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { ChromiumUnavailableError } from "./types";

export interface PdfRenderOptions {
  html: string;
  output: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  format?: string;
  width?: string;
  height?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  headerTemplate?: string;
  footerTemplate?: string;
  pageNumbers?: boolean;
  tagged?: boolean;
  outline?: boolean;
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
  toc?: boolean;
}

interface ChromiumJob {
  mode: "check" | "render";
  executablePath?: string;
  html?: string;
  output?: string;
  waitUntil?: PdfRenderOptions["waitUntil"];
  toc?: boolean;
  pdfOptions?: Record<string, unknown>;
}

/** Paged.js sets this flag after layout; give it up to 3 seconds. */
async function waitForPagedJs(page: Page): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate("!!window.__pagedjsAfterFired")
      .catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function renderPage(browser: Browser, job: ChromiumJob): Promise<void> {
  const page = await browser.newPage();
  await page.setContent(job.html ?? "", {
    waitUntil: job.waitUntil ?? "domcontentloaded",
  });
  if (job.toc) await waitForPagedJs(page);
  await page.pdf({ path: job.output, ...job.pdfOptions });
}

/**
 * Run one Chromium job and return the browser version. Node executes these
 * functions' source on Windows, so they may only call each other.
 */
async function runChromiumJob(
  launcher: typeof chromium,
  job: ChromiumJob,
): Promise<string> {
  const browser = await launcher.launch(
    job.executablePath ? { executablePath: job.executablePath } : {},
  );
  try {
    if (job.mode === "render") await renderPage(browser, job);
    return browser.version();
  } finally {
    await browser.close();
  }
}

// Node reads the job from stdin, resolves playwright from the checkout that
// owns this binary or source, and prints the browser version.
const NODE_JOB_SCRIPT = `
${waitForPagedJs.toString()}
${renderPage.toString()}
${runChromiumJob.toString()}
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  try {
    const { paths, job } = JSON.parse(input);
    const { chromium } = require(require.resolve("playwright", { paths }));
    process.stdout.write(await runChromiumJob(chromium, job));
  } catch (err) {
    process.stderr.write(String((err && err.message) || err));
    process.exit(1);
  }
});
`;

function playwrightSearchPaths(): string[] {
  return [
    path.resolve(path.dirname(process.execPath), "..", ".."),
    path.resolve(import.meta.dir, "..", ".."),
  ];
}

/** Run a job in a Node child process; the Windows path (oven-sh/bun#4253). */
export function runJobThroughNode(job: ChromiumJob): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["-e", NODE_JOB_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => reject(new Error(`cannot run node: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `node exited with ${code}`));
    });
    child.stdin.end(JSON.stringify({ paths: playwrightSearchPaths(), job }));
  });
}

async function runJob(job: ChromiumJob): Promise<string> {
  const withPath = { ...job, executablePath: process.env.GOLDBAND_CHROMIUM_PATH || undefined };
  try {
    return process.platform === "win32"
      ? await runJobThroughNode(withPath)
      : await runChromiumJob(chromium, withPath);
  } catch (err: any) {
    throw new ChromiumUnavailableError(err?.message ?? String(err));
  }
}

/** Launch and close Chromium; returns the browser version. */
export function checkChromium(): Promise<string> {
  return runJob({ mode: "check" });
}

export async function renderPdf(opts: PdfRenderOptions): Promise<void> {
  await runJob({
    mode: "render",
    html: opts.html,
    output: opts.output,
    waitUntil: opts.waitUntil,
    toc: opts.toc,
    pdfOptions: buildPdfOptions(opts),
  });
}

type PdfOptionInput = Omit<PdfRenderOptions, "html" | "output">;

const PAGE_NUMBER_FOOTER = [
  '<div style="font-size:9pt; font-family:Helvetica,Arial,sans-serif; color:#666; ',
  'width:100%; text-align:center;">',
  '<span class="pageNumber"></span> of <span class="totalPages"></span>',
  "</div>",
].join("");

export function buildPdfOptions(opts: PdfOptionInput): Record<string, unknown> {
  return {
    ...pageSize(opts),
    ...margins(opts),
    ...headerFooter(opts),
    ...booleanFlags(opts),
  };
}

function pageSize(opts: PdfOptionInput): Record<string, unknown> {
  if (opts.format) {
    return {
      format:
        opts.format.charAt(0).toUpperCase() + opts.format.slice(1).toLowerCase(),
    };
  }
  if (opts.width && opts.height) return { width: opts.width, height: opts.height };
  return { format: "Letter" };
}

function margins(opts: PdfOptionInput): Record<string, unknown> {
  const entries = Object.entries({
    top: opts.marginTop,
    right: opts.marginRight,
    bottom: opts.marginBottom,
    left: opts.marginLeft,
  }).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length > 0 ? { margin: Object.fromEntries(entries) } : {};
}

function headerFooter(opts: PdfOptionInput): Record<string, unknown> {
  const display =
    !!opts.headerTemplate || !!opts.footerTemplate || opts.pageNumbers === true;
  if (!display) return {};
  // Chromium prints its default URL/date in an unset slot, so fill it.
  return {
    displayHeaderFooter: true,
    headerTemplate: opts.headerTemplate ?? "<div></div>",
    footerTemplate: opts.pageNumbers
      ? PAGE_NUMBER_FOOTER
      : (opts.footerTemplate ?? "<div></div>"),
  };
}

function booleanFlags(opts: PdfOptionInput): Record<string, unknown> {
  const flags = {
    tagged: opts.tagged,
    outline: opts.outline,
    printBackground: opts.printBackground,
    preferCSSPageSize: opts.preferCSSPageSize,
  };
  return Object.fromEntries(
    Object.entries(flags)
      .filter((entry) => entry[1] === true)
      .map(([key]) => [key, true]),
  );
}
