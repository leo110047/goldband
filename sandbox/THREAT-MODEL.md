# goldband Sandbox Threat Model

This sandbox is a second line of defense for local agent runs. It does not
replace the hook router, Codex permissions, Claude permissions, or human review.
It provides a small, testable filesystem boundary for container execution.

## Scope

The sandbox is a local Docker or Podman container, narrower than a managed VM or
remote sandbox: goldband is baked into the image and installed into a clean
container HOME at build time, and only the declared target project is
bind-mounted at run time. Host-native Claude Code and Codex sandboxing are
separate, independently enforced mechanisms.

## Mount Contract

`sandbox/sandbox.sh run <project-dir>` mounts:

- the target project read-write at `/workspace/project`
- an explicit `--env-file FILE`, if provided
- an explicit named cache volume at `/home/goldband/.cache`, if provided

The goldband repo is copied into the image at build time and made non-writable
at `/opt/goldband`. `run` does not bind-mount the host goldband checkout and
does not rerun `install.sh`, so container-side Linux build artifacts do not
overwrite the macOS host checkout.

`/opt/goldband` is read-only at runtime. Runtime state, including installed
Claude and Codex skills, telemetry, and workflow state, is expected under
`/home/goldband`. `scripts/test-sandbox.sh` verifies this only for installed
Goldband Loop helper commands; it does not run a provider-backed Claude or
Codex agent task.

It does not mount:

- the host goldband repo
- the user's host HOME
- `~/.ssh`
- cloud provider credential directories
- Docker or Podman sockets
- arbitrary host paths

The container HOME is `/home/goldband`. goldband is installed there during image
build through the existing `install.sh all-with-workflow` path. Runtime starts
from that baked install.

## Image Build Context

The Docker build context is the goldband repository root, not the user's target
project. `.dockerignore` excludes known host overlays, generated state, Git
history, local Codex configuration, local log files, and common secret file
patterns before `COPY . /opt/goldband` runs.

The deny-list does not exclude secret files whose names match no rule; such a
file inside the goldband repo enters an image layer. Credentials stay out of the
repo tree and reach the container only through `--env` or `--env-file`; local
untracked files are reviewed before an image rebuild.

## Network Posture

No network allowlist exists. The container uses the host runtime's default
egress, so every process inside it can reach the network unless the runtime or
host network restricts it. `scripts/test-sandbox.sh` has no network test because
no network policy is enforced.

`--env-file` and `--env KEY=VALUE` carry only credentials safe to expose to
every process in the container, preferably repository-scoped or short-lived.
Host credential files are never mounted.

## What It Helps With

- Accidental writes outside the mounted project directory.
- Accidental reads from host HOME, SSH keys, browser profiles, and cloud config
  that are not mounted.
- Keeping goldband installer output, Claude config, Codex config, telemetry, and
  session state inside a clean container HOME.
- Layering filesystem isolation with the existing hook router deny/advisory
  checks, rather than choosing one or the other.

## What It Does Not Protect

- Anything mounted read-write, including the target project.
- The host goldband source if you choose the goldband repo itself as
  `<project-dir>`. In that case it is intentionally the target project.
- Data exfiltration over the default container network.
- Credentials passed through `--env-file` or `--env`.
- Container runtime escapes, kernel vulnerabilities, or Docker/Podman daemon
  misconfiguration.
- Malicious dependencies downloaded during image build or commands run inside
  the mounted project.
- Host services reachable from the container network.
- API/provider data flow. Files the agent reads can still be sent to the model
  provider according to the active Claude Code or Codex configuration.

## Verification Boundary

`scripts/test-sandbox.sh` verifies:

- the image builds
- `install.sh all-with-workflow` works in a clean container HOME during image build
- `node scripts/check-goldband-loop-inventory.mjs` passes during image build,
  before `/opt/goldband` is made non-writable
- `claude --version` and `codex --version` run inside the image
- the hook router golden dataset still blocks representative unsafe behavior
- a direct hook-router deny event is recorded in the container HOME telemetry
- installed Goldband Loop helper commands write config and timeline state under
  container HOME while `/opt/goldband` is read-only
- host overlays and secret-like local files are not baked into the image
- `/opt/goldband` is not writable at runtime
- the mounted project is writable from the container
- an absolute host path that is not mounted is not writable from the container
- `sandbox/sandbox.sh run <dir>` works on the happy path
- `sandbox/sandbox.sh run <dir> -- command` preserves quoted arguments
- `sandbox/sandbox.sh` fails clearly when no Docker/Podman runtime is available

Those tests prove only the listed boundaries. They do not prove complete host
security.
