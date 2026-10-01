import { describe, test, expect } from 'bun:test';
import {
  shouldSpawnXvfb,
  isOurXvfb,
  readPidStartTime,
  readPidCmdline,
  cleanupXvfb,
  cleanupXvfbStrict,
  pickFreeDisplay,
  isDisplayFree,
  hasXvfbProbeTools,
  requireXvfbStartIdentity,
  waitForSpawnedXvfbReadiness,
  XvfbStartupCleanupError,
} from '../src/xvfb';

const HAS_XVFB_TOOLS = process.platform === 'linux' && hasXvfbProbeTools();
const CAN_READ_PID_START_TIME = process.platform !== 'win32' && readPidStartTime(process.pid).length > 0;

describe('shouldSpawnXvfb', () => {
  test('skips when not headed', () => {
    const d = shouldSpawnXvfb({}, 'linux');
    expect(d.spawn).toBe(false);
    expect(d.reason).toContain('not headed');
  });

  test('skips on macOS even when headed', () => {
    const d = shouldSpawnXvfb({ BROWSE_HEADED: '1' }, 'darwin');
    expect(d.spawn).toBe(false);
    expect(d.reason).toContain('darwin');
  });

  test('skips on Windows even when headed', () => {
    const d = shouldSpawnXvfb({ BROWSE_HEADED: '1' }, 'win32');
    expect(d.spawn).toBe(false);
    expect(d.reason).toContain('win32');
  });

  test('skips on Linux when DISPLAY already set', () => {
    const d = shouldSpawnXvfb({ BROWSE_HEADED: '1', DISPLAY: ':0' }, 'linux');
    expect(d.spawn).toBe(false);
    expect(d.reason).toContain('DISPLAY=:0');
  });

  test('skips on Linux when WAYLAND_DISPLAY set (codex F2)', () => {
    const d = shouldSpawnXvfb({ BROWSE_HEADED: '1', WAYLAND_DISPLAY: 'wayland-0' }, 'linux');
    expect(d.spawn).toBe(false);
    expect(d.reason).toContain('Wayland');
  });

  test('spawns on Linux + headed + no DISPLAY/WAYLAND_DISPLAY', () => {
    const d = shouldSpawnXvfb({ BROWSE_HEADED: '1' }, 'linux');
    expect(d.spawn).toBe(true);
  });
});

describe('isOurXvfb (PID validation)', () => {
  test('returns false when pid is 0', () => {
    expect(isOurXvfb(0, 'whatever')).toBe(false);
  });

  test('returns false when startTime is empty', () => {
    expect(isOurXvfb(process.pid, '')).toBe(false);
  });

  test.skipIf(!CAN_READ_PID_START_TIME)('returns false when cmdline does not contain Xvfb', () => {
    const proc = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    try {
      const startTime = readPidStartTime(proc.pid);
      expect(startTime.length).toBeGreaterThan(0);
      expect(readPidCmdline(proc.pid).toLowerCase()).not.toContain('xvfb');
      expect(isOurXvfb(proc.pid, startTime)).toBe(false);
    } finally {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  });

  test('returns false when start-time differs (PID reuse defense)', () => {
    // Even if we somehow had the right PID, a stale start-time means it's a
    // different process. We never fake the cmdline test, so this assertion
    // is structural: the function must not pass on stale start-time alone.
    expect(isOurXvfb(process.pid, 'Mon Jan  1 00:00:00 1970')).toBe(false);
  });
});

describe('hasXvfbProbeTools', () => {
  test('returns false when PATH cannot resolve Xvfb helpers', () => {
    expect(hasXvfbProbeTools({ PATH: '' })).toBe(false);
  });
});

describe('readPidStartTime', () => {
  test.skipIf(!CAN_READ_PID_START_TIME)('returns non-empty for current process', () => {
    const t = readPidStartTime(process.pid);
    expect(t.length).toBeGreaterThan(0);
  });

  test('returns empty string for nonexistent PID', () => {
    expect(readPidStartTime(99999999)).toBe('');
  });
});

describe('readPidCmdline', () => {
  test('returns non-empty for current process on Linux', () => {
    if (process.platform !== 'linux') return; // /proc unavailable
    const c = readPidCmdline(process.pid);
    expect(c.length).toBeGreaterThan(0);
  });

  test('returns empty for nonexistent PID', () => {
    expect(readPidCmdline(99999999)).toBe('');
  });
});

describe('requireXvfbStartIdentity', () => {
  test('returns a complete identity without signalling the new child', async () => {
    let signalled = false;
    const proc = {
      pid: 4242,
      kill: () => { signalled = true; },
      exited: Promise.resolve(0),
    };

    expect(await requireXvfbStartIdentity(proc, ':99', () => 'stable-start')).toBe('stable-start');
    expect(signalled).toBe(false);
  });

  test('stops the newly spawned child before rejecting an empty identity', async () => {
    let signalled = false;
    let confirmExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => { confirmExit = resolve; });
    const proc = {
      pid: 4242,
      kill: () => {
        signalled = true;
        confirmExit(0);
      },
      exited,
    };

    await expect(requireXvfbStartIdentity(proc, ':99', () => '')).rejects.toThrow('child stopped before state publish');
    expect(signalled).toBe(true);
  });

  test('stops the newly spawned child when identity lookup throws', async () => {
    let signalled = false;
    let confirmExit: (code: number) => void = () => {};
    const proc = {
      pid: 4242,
      kill: () => {
        signalled = true;
        confirmExit(0);
      },
      exited: new Promise<number>((resolve) => { confirmExit = resolve; }),
    };

    await expect(requireXvfbStartIdentity(
      proc,
      ':99',
      () => { throw new Error('ps denied'); },
    )).rejects.toThrow('ps denied');
    expect(signalled).toBe(true);
  });
});

describe('waitForSpawnedXvfbReadiness', () => {
  test('confirms the spawned child exited when the display probe throws', async () => {
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    let confirmExit: (code: number) => void = () => {};
    const proc = {
      pid: 4242,
      exitCode: null,
      kill: (signal?: NodeJS.Signals | number) => {
        signals.push(signal);
        confirmExit(0);
      },
      exited: new Promise<number>((resolve) => { confirmExit = resolve; }),
    };

    await expect(waitForSpawnedXvfbReadiness(proc, 99, {
      sleep: async () => {},
      probeDisplay: () => { throw new Error('xdpyinfo sandbox denial'); },
      readStartTime: () => 'stable-start',
    })).rejects.toThrow('xdpyinfo sandbox denial');
    expect(signals).toEqual(['SIGKILL']);
  });

  test('confirms the spawned child exited after readiness timeout', async () => {
    let now = 0;
    let signalled = false;
    let confirmExit: (code: number) => void = () => {};
    const proc = {
      pid: 4242,
      exitCode: null,
      kill: () => {
        signalled = true;
        confirmExit(0);
      },
      exited: new Promise<number>((resolve) => { confirmExit = resolve; }),
    };

    await expect(waitForSpawnedXvfbReadiness(proc, 99, {
      sleep: async (milliseconds) => { now += milliseconds; },
      now: () => now,
      readinessTimeoutMs: 200,
      probeDisplay: () => true,
      readStartTime: () => 'stable-start',
    })).rejects.toThrow('never became reachable');
    expect(signalled).toBe(true);
  });

  test('reports an authoritative identity when child exit cannot be confirmed', async () => {
    const proc = {
      pid: 4242,
      exitCode: null,
      kill: () => {},
      exited: new Promise<number>(() => {}),
    };

    try {
      await waitForSpawnedXvfbReadiness(proc, 99, {
        sleep: async () => {},
        probeDisplay: () => { throw new Error('xdpyinfo sandbox denial'); },
        readStartTime: () => 'stable-start',
        confirmExit: async () => false,
      });
      throw new Error('expected readiness failure');
    } catch (error) {
      expect(error).toBeInstanceOf(XvfbStartupCleanupError);
      expect((error as XvfbStartupCleanupError).record).toEqual({
        pid: 4242,
        display: ':99',
        startTime: 'stable-start',
      });
    }
  });

  test('still stops the child when recovery identity lookup throws', async () => {
    let signalled = false;
    let confirmExit: (code: number) => void = () => {};
    const proc = {
      pid: 4242,
      exitCode: null,
      kill: () => {
        signalled = true;
        confirmExit(0);
      },
      exited: new Promise<number>((resolve) => { confirmExit = resolve; }),
    };

    await expect(waitForSpawnedXvfbReadiness(proc, 99, {
      sleep: async () => {},
      probeDisplay: () => { throw new Error('xdpyinfo sandbox denial'); },
      readStartTime: () => { throw new Error('ps denied'); },
    })).rejects.toThrow('xdpyinfo sandbox denial');
    expect(signalled).toBe(true);
  });
});

describe('cleanupXvfb', () => {
  test('no-op when pid is 0', () => {
    expect(() => cleanupXvfb({ pid: 0, startTime: '', display: ':99' })).not.toThrow();
  });

  test('no-op when not our Xvfb (won\'t kill unrelated process)', () => {
    // Pass the current bun process's PID + a stale start-time. cleanupXvfb
    // should refuse to send signals because cmdline doesn't match Xvfb.
    expect(() => cleanupXvfb({
      pid: process.pid,
      startTime: 'Mon Jan  1 00:00:00 1970',
      display: ':99',
    })).not.toThrow();
    // The current process is still alive after the no-op cleanup attempt.
    expect(process.kill(process.pid, 0)).toBe(true);
  });
});

describe('cleanupXvfbStrict', () => {
  const state = { pid: 4242, startTime: 'recorded-start', display: ':99' };

  test('returns only after the recorded Xvfb is confirmed dead', async () => {
    const statuses = ['owned', 'dead'] as const;
    const signals: Array<NodeJS.Signals | number> = [];
    await cleanupXvfbStrict(state, {
      probeOwnership: () => statuses.shift() ?? 'dead',
      kill: (_pid, signal) => { signals.push(signal); },
      sleep: async () => {},
      timeoutMs: 10,
    });
    expect(signals).toEqual(['SIGTERM']);
  });

  test('rejects unknown ownership without signalling', async () => {
    let signalled = false;
    await expect(cleanupXvfbStrict(state, {
      probeOwnership: () => 'unknown',
      kill: () => { signalled = true; },
    })).rejects.toThrow('Cannot confirm ownership');
    expect(signalled).toBe(false);
  });

  test('waits for confirmed exit after a transient unknown shutdown probe', async () => {
    const statuses: Array<'owned' | 'unknown' | 'dead'> = ['owned', 'unknown', 'dead'];
    const signals: Array<NodeJS.Signals | number> = [];
    await cleanupXvfbStrict(state, {
      probeOwnership: () => statuses.shift() ?? 'dead',
      kill: (_pid, signal) => { signals.push(signal); },
      sleep: async () => {},
      timeoutMs: 100,
    });
    expect(signals).toEqual(['SIGTERM']);
  });

  test('rejects persistent unknown shutdown without sending SIGKILL', async () => {
    let signalled = false;
    const signals: Array<NodeJS.Signals | number> = [];
    await expect(cleanupXvfbStrict(state, {
      probeOwnership: () => signalled ? 'unknown' : 'owned',
      kill: (_pid, signal) => { signalled = true; signals.push(signal); },
      sleep: async () => {},
      timeoutMs: 0,
    })).rejects.toThrow('Cannot confirm Xvfb 4242 stopped after SIGTERM');
    expect(signals).toEqual(['SIGTERM']);
  });

  test('rejects when the process remains alive after SIGKILL', async () => {
    const signals: Array<NodeJS.Signals | number> = [];
    await expect(cleanupXvfbStrict(state, {
      probeOwnership: () => 'owned',
      kill: (_pid, signal) => { signals.push(signal); },
      sleep: async () => {},
      timeoutMs: 0,
    })).rejects.toThrow('still alive');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('pickFreeDisplay (Xvfb installed)', () => {
  test.skipIf(!HAS_XVFB_TOOLS)('returns a number in the requested range', () => {
    const n = pickFreeDisplay(99, 105);
    if (n != null) {
      expect(n).toBeGreaterThanOrEqual(99);
      expect(n).toBeLessThanOrEqual(105);
    }
    // null means all displays in range are busy — also valid.
  });

  test.skipIf(!HAS_XVFB_TOOLS)('isDisplayFree returns boolean', () => {
    const result = isDisplayFree(99);
    expect(typeof result).toBe('boolean');
  });
});

describe('xvfb spawn → cleanup round trip (Linux + Xvfb only)', () => {
  test.skipIf(!HAS_XVFB_TOOLS)('spawn, validate ownership, cleanup', async () => {
    const { spawnXvfb } = await import('../src/xvfb');
    const display = pickFreeDisplay(99, 110);
    if (display == null) {
      // No free display in range — skip.
      return;
    }
    const handle = await spawnXvfb(display);
    try {
      expect(handle.pid).toBeGreaterThan(0);
      expect(handle.display).toBe(`:${display}`);
      expect(handle.startTime.length).toBeGreaterThan(0);
      // Validation should pass.
      expect(isOurXvfb(handle.pid, handle.startTime)).toBe(true);
    } finally {
      handle.close();
      // After cleanup, our Xvfb should be gone.
      await new Promise((r) => setTimeout(r, 200));
      expect(isOurXvfb(handle.pid, handle.startTime)).toBe(false);
    }
  });
});
