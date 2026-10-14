# iOS QA

`ios/qa` drives a real iPhone through a debug-only bridge embedded in the app and
a Mac-side daemon. It does not use simulators, XCTest, or WebDriverAgent.

## Requirements

- macOS with Xcode 16 or later; `xcrun devicectl` reaches the device through the
  CoreDevice USB tunnel.
- An iPhone on iOS 16 or later, paired with the Mac, with Developer Mode
  enabled. SwiftUI button taps require iOS 18 or later.
- An Apple developer team ID for signing debug builds.
- An installed Goldband runtime with `bin/goldband-ios-qa-daemon` and Bun.
- Remote mode only: Tailscale with a readable `/var/run/tailscale.sock`.

## Components

- **DebugBridge** is an SwiftPM package installed from `ios-qa/templates/`.
  `DebugBridgeCore` is cross-platform; `DebugBridgeUI` and `DebugBridgeTouch`
  link UIKit. The app wires it only under `#if DEBUG`, and the app depends on
  `DebugBridgeUI` with `condition: .when(configuration: .debug)`, so Release
  builds cannot link the bridge.
- **StateServer** runs inside the app and listens only on loopback (`::1` and
  `127.0.0.1`, port 9999) in every mode. It requires a bearer token.
- **goldband-ios-qa-daemon** runs on the Mac, brokers requests over the
  CoreDevice IPv6 tunnel, and listens on loopback port 9099 by default. It holds
  an exclusive lock on `~/.goldband/ios-qa-daemon.pid`; a second invocation joins
  the running daemon. It prints `READY: port=<n> pid=<pid>` once its listeners
  are bound and rotates the app's boot token to an in-memory value within about
  five seconds of starting.

Daemon targeting is set by `GOLDBAND_IOS_TARGET_UDID` (default: the first paired
connected device), `GOLDBAND_IOS_TARGET_BUNDLE_ID`, and `GOLDBAND_IOS_DAEMON_PORT`.

## HTTP surface

| Endpoint | Behavior | Authorization |
| --- | --- | --- |
| `GET /healthz` | Version probe | Loopback only |
| `POST /auth/rotate` | Rotates the boot token | Boot token, daemon only |
| `POST /session/acquire` | Acquires the per-device session lock | Bearer |
| `POST /session/release` | Releases the lock | Bearer and session |
| `GET /screenshot` | PNG of the active window | Bearer |
| `GET /elements` | Accessibility-tree snapshot | Bearer |
| `GET /state/snapshot` | All `@Snapshotable` fields as JSON | Bearer |
| `POST /state/restore` | Atomic restore of a full snapshot | Bearer, session, `restore` tier |
| `POST /tap` | Synthesized touch at window coordinates | Bearer, session, `interact` tier |
| `POST /swipe` | Scrolls the nearest enclosing scroll view | Bearer, session, `interact` tier |
| `POST /type` | Sets text on the first responder | Bearer, session, `interact` tier |

Mutating requests require `Authorization: Bearer <token>` and `X-Session-Id`.
Only fields marked `@Snapshotable` appear in state snapshots, which keeps
tokens, personal data, and auth state out of recorded fixtures unless a field
opts in.

## Remote mode

`goldband-ios-qa-daemon --tailnet` adds a listener on the Mac's tailnet address.
If the Tailscale socket is missing or unreadable, the tailnet listener does not
start; the loopback listener keeps running.

- Capability tiers are nested: `observe` (read endpoints) ⊂ `interact` (tap,
  swipe, type) ⊂ `mutate` (state writes) ⊂ `restore` (state restore).
- Only the Mac owner grants access, with `goldband-ios-qa-mint`; remote callers
  are never added automatically. Grants live in
  `~/.goldband/ios-qa-allowlist.json` (mode 0600) and are read on every mint.
- Allowlist identities are canonical WhoIs forms: a lowercase login email,
  `tag:<name>`, or `node:<key>`.
- `POST /auth/mint` resolves the caller through tailscaled WhoIs, checks the
  allowlist, and returns a session token valid for one hour by default and at
  most 24 hours. Each identity may mint 10 tokens per sliding 60 seconds; the
  next request returns 429.
- Tailnet request bodies above 1 MiB return 413.
- Authenticated mutating requests are logged to
  `~/.goldband/security/ios-qa-audit.jsonl`; rejected requests to
  `~/.goldband/security/attempts.jsonl`.

## Release check

`ios/qa` includes a release-cleanup check that verifies the DebugBridge
dependency and `#if DEBUG` wiring are absent from the release surface. The
SwiftPM debug-only condition remains the structural guard.
