#!/usr/bin/env node
/**
 * PreToolUse Hook: Block creation of random .md/.txt files
 *
 * Prevents unnecessary documentation file creation while allowing
 * standard files (README, CLAUDE, AGENTS, CONTRIBUTING, SKILL .md)
 * and files in .claude/, .planning/, reference/, and commands/ directories.
 */

const MAX_STDIN = 1024 * 1024;
let data = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  if (data.length < MAX_STDIN) {
    data += chunk;
  }
});

process.stdin.on("end", () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path || "";

    if (
      /\.(md|txt)$/.test(filePath) &&
      !/(README|CLAUDE|AGENTS|CONTRIBUTING|SKILL)\.md$/.test(filePath) &&
      !/\.claude\//.test(filePath) &&
      !/\.planning\//.test(filePath) &&
      !/\/reference\//.test(filePath) &&
      !/\/commands\//.test(filePath) &&
      !/\/docs\//.test(filePath)
    ) {
      console.error("[Hook] BLOCKED: Unnecessary documentation file creation");
      console.error("[Hook] File: " + filePath);
      process.exit(2);
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
});
