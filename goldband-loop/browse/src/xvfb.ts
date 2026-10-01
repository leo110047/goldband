/**
 * Xvfb (X virtual framebuffer) auto-spawn for headed Chromium on Linux
 * containers without DISPLAY.
 *
 * The motivating use case: a headless container needs to run Chromium in
 * "headed" mode (visible window) — for example, to run with the
 * AutomationControlled flag off and pass anti-bot fingerprint checks. Xvfb
 * provides an off-screen X server that Chromium can render into.
 *
 * Design notes:
 *   - Pick a free display dynamically (try :99, :100, :101...). NEVER unlink
 *     /tmp/.X<n>-lock for displays we didn't create — that would steal an
 *     active X server from another process or user.
 *   - Validate orphan Xvfb processes by BOTH /proc/<pid>/cmdline matching
 *     'Xvfb' AND start-time matching the recorded value. PID reuse is real;
 *     a one-field check would let us send SIGTERM to an unrelated process
 *     that happened to inherit a recycled PID.
 *   - Skip spawn entirely on macOS/Windows (native windowing) and on Linux
 *     when DISPLAY or WAYLAND_DISPLAY is already set (codex F2).
 */

import * as fs from 'fs';
import { safeKill, isProcessAlive, probeProcessLiveness } from './error-handling';

export interface XvfbHandle {
  pid: number;
  startTime: string;
  display: string; // e.g. ":99"
  /** Best-effort cleanup. Validates ownership before kill. */
  close: () => void;
  /** Startup rollback cleanup. Rejects unless the acquired Xvfb is proven gone. */
  closeStrict: () => Promise<void>;
}

type XvfbOwnership = 'owned' | 'dead' | 'replaced' | 'unknown';

interface StrictCleanupOptions {
  probeOwnership?: () => XvfbOwnership;
  kill?: (pid: number, signal: NodeJS.Signals | number) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export interface SpawnedXvfbProcess {
  pid: number;
  kill: (signal?: NodeJS.Signals | number) => unknown;
  exited: Promise<number>;
  exitCode?: number | null;
}

export interface XvfbOwnershipRecord {
  pid: number;
  display: string;
  startTime?: string;
}

interface XvfbStartupOptions {
  probeDisplay?: (displayNum: number) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  readinessTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  confirmExit?: (proc: SpawnedXvfbProcess, timeoutMs: number) => Promise<boolean>;
  readStartTime?: (pid: number) => string;
}

export class XvfbStartupCleanupError extends Error {
  readonly record: XvfbOwnershipRecord;

  constructor(record: XvfbOwnershipRecord, startupError: unknown, cleanupError: unknown) {
    super(
      `Xvfb on ${record.display} startup failed and child exit could not be confirmed`,
      { cause: new AggregateError([startupError, cleanupError]) },
    );
    this.name = 'XvfbStartupCleanupError';
    this.record = record;
  }
}

export interface ShouldSpawnDecision {
  spawn: boolean;
  reason: string;
}

const DISPLAY_RANGE_START = 99;
const DISPLAY_RANGE_END = 120;

function xvfbPathEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.PATH ?? env.Path ?? '';
}

function hasXvfbBinary(name: 'Xvfb' | 'xdpyinfo', env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(Bun.which(name, { PATH: xvfbPathEnv(env) }));
}

export function hasXvfbProbeTools(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasXvfbBinary('Xvfb', env) && hasXvfbBinary('xdpyinfo', env);
}

/**
 * Decide whether the daemon should auto-spawn an Xvfb. Pure: takes env +
 * platform and returns a decision. Easy to unit test.
 */
export function shouldSpawnXvfb(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): ShouldSpawnDecision {
  if (env.BROWSE_HEADED !== '1') return { spawn: false, reason: 'not headed mode' };
  if (platform !== 'linux') return { spawn: false, reason: `platform ${platform} uses native windowing` };
  if (env.DISPLAY) return { spawn: false, reason: `DISPLAY=${env.DISPLAY} already set` };
  if (env.WAYLAND_DISPLAY) return { spawn: false, reason: `WAYLAND_DISPLAY=${env.WAYLAND_DISPLAY} set; Chromium uses Wayland natively` };
  return { spawn: true, reason: 'linux headed without DISPLAY/WAYLAND_DISPLAY' };
}

/**
 * Probe a display number — return true if no X server is currently listening
 * on it (i.e., we can safely spawn a new Xvfb there).
 */
export function isDisplayFree(displayNum: number): boolean {
  // xdpyinfo exits 0 if a display is reachable. Exit non-zero means no
  // server, which is what we want.
  if (!hasXvfbBinary('xdpyinfo')) {
    throw new Error('xdpyinfo not installed; cannot safely probe X display availability.');
  }
  const result = Bun.spawnSync(['xdpyinfo', '-display', `:${displayNum}`], {
    stdout: 'ignore', stderr: 'ignore', timeout: 2000,
  });
  return result.exitCode !== 0;
}

/**
 * Walk the display range and return the first free one, or null if all
 * displays in the range are taken.
 */
export function pickFreeDisplay(
  rangeStart: number = DISPLAY_RANGE_START,
  rangeEnd: number = DISPLAY_RANGE_END,
): number | null {
  for (let n = rangeStart; n <= rangeEnd; n++) {
    if (isDisplayFree(n)) return n;
  }
  return null;
}

/**
 * Read the wall-clock start time of a PID via `ps -o lstart=`. Stable across
 * reads (unlike /proc/stat field 22 which reports jiffies since boot in a
 * format that's harder to compare). Returns an empty string if the process
 * is gone or ps fails.
 */
export function readPidStartTime(pid: number): string {
  if (!isProcessAlive(pid)) return '';
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'lstart='], {
      stdout: 'pipe', stderr: 'pipe', timeout: 2000,
    });
  } catch {
    return '';
  }
  if (result.exitCode !== 0) return '';
  return result.stdout?.toString().trim() ?? '';
}

/**
 * Read the cmdline of a PID via /proc/<pid>/cmdline. Returns empty string
 * if the process is gone or the cmdline isn't readable.
 */
export function readPidCmdline(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Validate that PID is still our Xvfb child. Both checks must pass:
 *   1. /proc/<pid>/cmdline contains 'Xvfb' (string match — Xvfb's argv[0] is
 *      always 'Xvfb' or a full path ending in /Xvfb)
 *   2. Start time matches the recorded value (PID reuse defense)
 */
export function isOurXvfb(pid: number, recordedStartTime: string): boolean {
  if (!pid || !recordedStartTime) return false;
  const cmdline = readPidCmdline(pid);
  if (!cmdline.toLowerCase().includes('xvfb')) return false;
  const currentStart = readPidStartTime(pid);
  if (!currentStart) return false;
  return currentStart === recordedStartTime;
}

export async function requireXvfbStartIdentity(
  proc: SpawnedXvfbProcess,
  display: string,
  readStartTime: (pid: number) => string = readPidStartTime,
  confirmExit: (proc: SpawnedXvfbProcess, timeoutMs: number) => Promise<boolean> = confirmSpawnedXvfbExit,
): Promise<string> {
  let startTime = '';
  try {
    startTime = readStartTime(proc.pid);
  } catch (error) {
    return stopSpawnedXvfbAfterFailure(proc, display, error, { readStartTime, confirmExit });
  }
  if (startTime) return startTime;
  // The freshly spawned child handle is authoritative even when OS identity
  // lookup is unavailable. Do not return an incomplete handle that could be
  // published and later mistaken for an ownerless Xvfb.
  return stopSpawnedXvfbAfterFailure(
    proc,
    display,
    new Error(`Xvfb on ${display} start identity is unavailable; child stopped before state publish.`),
    { readStartTime, confirmExit },
  );
}

async function confirmSpawnedXvfbExit(
  proc: SpawnedXvfbProcess,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.exited.then(() => finish(true), () => finish(false));
  });
}

function spawnedXvfbRecord(
  proc: SpawnedXvfbProcess,
  display: string,
  readStartTime: (pid: number) => string,
): { record: XvfbOwnershipRecord; identityError: unknown } {
  try {
    const startTime = readStartTime(proc.pid);
    return {
      record: { pid: proc.pid, display, ...(startTime ? { startTime } : {}) },
      identityError: null,
    };
  } catch (identityError) {
    return { record: { pid: proc.pid, display }, identityError };
  }
}

function combineXvfbCleanupErrors(identityError: unknown, cleanupError: unknown): unknown {
  return identityError ? new AggregateError([identityError, cleanupError]) : cleanupError;
}

async function stopSpawnedXvfbAfterFailure(
  proc: SpawnedXvfbProcess,
  display: string,
  startupError: unknown,
  options: Pick<XvfbStartupOptions, 'cleanupTimeoutMs' | 'confirmExit' | 'readStartTime'> = {},
): Promise<never> {
  const readStartTime = options.readStartTime ?? readPidStartTime;
  const { record, identityError } = spawnedXvfbRecord(proc, display, readStartTime);
  let signalError: unknown = null;
  try {
    proc.kill('SIGKILL');
  } catch (error) {
    signalError = error;
  }
  const confirmExit = options.confirmExit ?? confirmSpawnedXvfbExit;
  let stopped = false;
  try {
    stopped = await confirmExit(proc, options.cleanupTimeoutMs ?? 1000);
  } catch (error) {
    signalError = signalError
      ? new AggregateError([signalError, error])
      : error;
  }
  if (!stopped) {
    const cleanupError = signalError ?? new Error(`Xvfb child ${proc.pid} did not exit before cleanup timeout`);
    throw new XvfbStartupCleanupError(
      record,
      startupError,
      combineXvfbCleanupErrors(identityError, cleanupError),
    );
  }
  throw startupError;
}

export async function waitForSpawnedXvfbReadiness(
  proc: SpawnedXvfbProcess,
  displayNum: number,
  options: XvfbStartupOptions = {},
): Promise<void> {
  const display = `:${displayNum}`;
  const probeDisplay = options.probeDisplay ?? isDisplayFree;
  const sleep = options.sleep ?? Bun.sleep;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.readinessTimeoutMs ?? 3000);
  try {
    while (now() < deadline) {
      await sleep(100);
      if (!probeDisplay(displayNum)) return;
      if (proc.exitCode != null) {
        throw new Error(`Xvfb on ${display} exited during startup (code ${proc.exitCode}). Hint: install xvfb (apt-get install xvfb / yum install xorg-x11-server-Xvfb).`);
      }
    }
    throw new Error(`Xvfb on ${display} never became reachable within 3s timeout`);
  } catch (error) {
    return stopSpawnedXvfbAfterFailure(proc, display, error, options);
  }
}

/**
 * Spawn Xvfb on the given display. Returns a handle including the validated
 * start-time so future cleanup can confirm ownership.
 *
 * Throws if Xvfb isn't installed (caller should print a platform-specific
 * install hint).
 */
export async function spawnXvfb(
  displayNum: number,
  recordOwnership: (record: XvfbOwnershipRecord) => void = () => {},
): Promise<XvfbHandle> {
  if (!hasXvfbBinary('Xvfb')) {
    throw new Error('Xvfb not installed.');
  }
  if (!hasXvfbBinary('xdpyinfo')) {
    throw new Error('xdpyinfo not installed; cannot validate Xvfb startup.');
  }

  const display = `:${displayNum}`;

  // Spawn detached: Xvfb's lifetime is tied to whether we've explicitly
  // killed it via the handle's close() method, not to the parent process.
  const proc = Bun.spawn(['Xvfb', display, '-screen', '0', '1920x1080x24', '-ac'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    proc.unref();
    // Publish an intentionally incomplete identity immediately. If this
    // process dies before start-time validation, stale recovery must refuse
    // replacement instead of assuming no Xvfb resource exists.
    recordOwnership({ pid: proc.pid, display });
  } catch (error) {
    return stopSpawnedXvfbAfterFailure(proc, display, error);
  }

  // Wait for the X server to become reachable — Xvfb takes a few hundred ms
  // to bind. Probe via xdpyinfo with retries.
  await waitForSpawnedXvfbReadiness(proc, displayNum);

  const startTime = await requireXvfbStartIdentity(proc, display);
  try {
    recordOwnership({ pid: proc.pid, display, startTime });
  } catch (error) {
    return stopSpawnedXvfbAfterFailure(proc, display, error);
  }
  return {
    pid: proc.pid,
    startTime,
    display,
    close: () => cleanupXvfb({ pid: proc.pid, startTime, display }),
    closeStrict: () => cleanupXvfbStrict({ pid: proc.pid, startTime, display }),
  };
}

function probeXvfbOwnership(state: { pid: number; startTime: string }): XvfbOwnership {
  const liveness = probeProcessLiveness(state.pid);
  if (liveness === 'dead') return 'dead';
  if (liveness === 'unknown') return 'unknown';
  const currentStartTime = readPidStartTime(state.pid);
  if (!currentStartTime) return 'unknown';
  if (currentStartTime !== state.startTime) return 'replaced';
  const cmdline = readPidCmdline(state.pid);
  if (!cmdline) return 'unknown';
  return cmdline.toLowerCase().includes('xvfb') ? 'owned' : 'replaced';
}

async function waitForXvfbStop(
  probe: () => XvfbOwnership,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
): Promise<XvfbOwnership> {
  const deadline = Date.now() + timeoutMs;
  let status = probe();
  // Shutdown can race the separate liveness and identity reads. Keep polling
  // an unknown snapshot; the caller still rejects it at the deadline.
  while ((status === 'owned' || status === 'unknown') && Date.now() < deadline) {
    await sleep(25);
    status = probe();
  }
  return status;
}

function rollbackStopComplete(status: XvfbOwnership, unknownMessage: string): boolean {
  if (status === 'dead' || status === 'replaced') return true;
  if (status === 'unknown') throw new Error(unknownMessage);
  return false;
}

/**
 * Strict rollback cleanup. `dead` and `replaced` both prove the recorded Xvfb
 * resource is gone; `unknown` never authorizes state/profile deletion.
 */
export async function cleanupXvfbStrict(
  state: { pid: number; startTime: string; display: string },
  options: StrictCleanupOptions = {},
): Promise<void> {
  if (!state.pid) return;
  const probe = options.probeOwnership ?? (() => probeXvfbOwnership(state));
  const kill = options.kill ?? safeKill;
  const sleep = options.sleep ?? Bun.sleep;
  const timeoutMs = options.timeoutMs ?? 1000;
  let status = probe();
  if (rollbackStopComplete(
    status,
    `Cannot confirm ownership of Xvfb ${state.pid} during startup rollback`,
  )) return;

  kill(state.pid, 'SIGTERM');
  status = await waitForXvfbStop(probe, sleep, timeoutMs);
  if (rollbackStopComplete(
    status,
    `Cannot confirm Xvfb ${state.pid} stopped after SIGTERM`,
  )) return;

  kill(state.pid, 'SIGKILL');
  status = await waitForXvfbStop(probe, sleep, timeoutMs);
  if (rollbackStopComplete(
    status,
    `Cannot confirm Xvfb ${state.pid} stopped after SIGKILL`,
  )) return;
  throw new Error(`Xvfb ${state.pid} is still alive after SIGKILL`);
}

/**
 * Cleanup an Xvfb child if it's still ours. Validates ownership first; if
 * the PID has been recycled or the cmdline doesn't match, leave it alone.
 *
 * Best-effort: never throws.
 */
export function cleanupXvfb(state: { pid: number; startTime: string; display: string }): void {
  if (!state.pid) return;
  if (!isOurXvfb(state.pid, state.startTime)) return;
  try { safeKill(state.pid, 'SIGTERM'); } catch { /* swallow */ }
  // Wait briefly for Xvfb to exit, then SIGKILL if still alive.
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(state.pid)) break;
  }
  if (isProcessAlive(state.pid)) {
    try { safeKill(state.pid, 'SIGKILL'); } catch { /* swallow */ }
  }
}

/**
 * Print a platform-specific install hint and return the message string.
 * Used by server.ts when Xvfb isn't installed.
 */
export function xvfbInstallHint(): string {
  return 'Xvfb not installed. apt-get install xvfb (Debian/Ubuntu) or yum install xorg-x11-server-Xvfb (RHEL/CentOS). Note: minimal containers (alpine, distroless) may also need fonts, dbus, gtk libs for headed Chromium to render.';
}
