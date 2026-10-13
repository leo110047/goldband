/**
 * CLI error output — run the real entrypoint and read what a user sees.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CLI = path.join(import.meta.dir, "..", "src", "cli.ts");

function runCli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { status: result.status, stderr: result.stderr };
}

describe("make-pdf CLI errors", () => {
  test("a Chromium launch failure starts on its own line after the stage", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "make-pdf-cli-"));
    try {
      const input = path.join(dir, "doc.md");
      fs.writeFileSync(input, "# Title\n\nBody.\n");
      const { status, stderr } = runCli(
        ["generate", input, path.join(dir, "out.pdf")],
        { GOLDBAND_CHROMIUM_PATH: "/nonexistent/chromium" },
      );
      expect(status).toBe(4);
      expect(stderr).toContain("Generating PDF...\nmake-pdf: Chromium failed to launch");
      expect(fs.existsSync(path.join(dir, "out.pdf"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("messages name the program instead of a $P placeholder", () => {
    const missing = runCli(["generate", path.join(os.tmpdir(), "make-pdf-missing.md")]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toStartWith("make-pdf: input file not found");

    const unknown = runCli(["frob"]);
    expect(unknown.stderr).toContain("make-pdf: unknown command: frob");
    expect(missing.stderr + unknown.stderr).not.toContain("$P");
  });
});
