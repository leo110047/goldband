import assert from 'node:assert/strict';

export const PROMPT_SURFACE_BUDGETS = Object.freeze({
  workflowContractBytes: 2 * 1024,
  workflowContractsTotalBytes: 64 * 1024,
  manualBytes: 4 * 1024,
  rootRouterSkillBytes: 6 * 1024,
  runtimeReferenceBytes: 12 * 1024,
  installedRuntimeMarkdownTotalBytes: 80 * 1024,
  globalInstructionsBytes: 6 * 1024,
  portableSkillBytes: 16 * 1024,
});

export function utf8ByteLength(content) {
  return Buffer.byteLength(content, 'utf8');
}

export function assertPromptSurfaceBudget(label, content, maxBytes) {
  const bytes = utf8ByteLength(content);
  assert.ok(
    bytes <= maxBytes,
    `${label} exceeds prompt surface budget ${formatBytes(maxBytes)}: ${bytes} bytes`,
  );
  return bytes;
}

export function assertPromptSurfaceTotal(label, entries, maxBytes) {
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  assert.ok(
    totalBytes <= maxBytes,
    `${label} exceeds prompt surface budget ${formatBytes(maxBytes)}: ${totalBytes} bytes`,
  );
  return totalBytes;
}

export function formatBytes(bytes) {
  if (bytes % 1024 === 0) {
    return `${bytes / 1024} KiB`;
  }
  return `${bytes} bytes`;
}
