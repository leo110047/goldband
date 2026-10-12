#!/bin/sh
# shellcheck disable=SC1007,SC2016
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
TMP_ROOT="${GOLDBAND_SANDBOX_TMPDIR:-/tmp}"
TMP_PROJECT=$(mktemp -d "$TMP_ROOT/goldband-sandbox-project.XXXXXX")
LOG_DIR=$(mktemp -d "$TMP_ROOT/goldband-sandbox-logs.XXXXXX")
IGNORE_PROBES=".claude/.sandbox-secret .goldband/.sandbox-secret codex/local/.sandbox-secret.env sandbox-local.log"
INVOCATION_ID=${TMP_PROJECT##*.}
IMAGE_PREFIX="${GOLDBAND_SANDBOX_IMAGE:-goldband-sandbox:test}"
OWNERSHIP_LABEL_KEY="dev.goldband.sandbox-test-invocation"
OWNERSHIP_TOKEN="$INVOCATION_ID-$$"
IMAGE="$IMAGE_PREFIX-$OWNERSHIP_TOKEN"
RT=""
BUILD_STARTED=0
CLEANUP_DONE=0

inspect_image_id() {
    "$RT" image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

cleanup_test_image() {
    [ "$BUILD_STARTED" -eq 1 ] || return 0

    cleanup_status=0
    owned_image_ids=$("$RT" image ls --all --quiet \
        --filter "label=$OWNERSHIP_LABEL_KEY=$OWNERSHIP_TOKEN") \
        || { printf 'sandbox image cleanup failed to list test-owned images\n' >&2; return 1; }
    for owned_image_id in $owned_image_ids; do
        "$RT" image rm --no-prune "$owned_image_id" >/dev/null \
            || { printf 'sandbox image cleanup failed to remove test-owned image: %s\n' "$owned_image_id" >&2; cleanup_status=1; }
    done
    return "$cleanup_status"
}

cleanup() {
    [ "$CLEANUP_DONE" -eq 0 ] || return 0
    CLEANUP_DONE=1
    cleanup_status=0
    cleanup_test_image || cleanup_status=$?
    rm -rf "$TMP_PROJECT" "$LOG_DIR"
    for probe in $IGNORE_PROBES; do
        rm -f "$ROOT_DIR/$probe"
    done
    return "$cleanup_status"
}

on_exit() {
    command_status=$?
    trap - EXIT INT TERM
    cleanup_status=0
    cleanup || cleanup_status=$?
    if [ "$command_status" -ne 0 ]; then
        exit "$command_status"
    fi
    exit "$cleanup_status"
}

on_signal() {
    signal_status=$1
    trap - INT TERM
    exit "$signal_status"
}
trap on_exit EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

runtime() {
    if [ -n "${GOLDBAND_SANDBOX_RUNTIME:-}" ]; then
        command -v "$GOLDBAND_SANDBOX_RUNTIME" >/dev/null 2>&1 || return 1
        printf '%s\n' "$GOLDBAND_SANDBOX_RUNTIME"
        return 0
    fi
    if command -v docker >/dev/null 2>&1; then
        printf '%s\n' docker
        return 0
    fi
    if command -v podman >/dev/null 2>&1; then
        printf '%s\n' podman
        return 0
    fi
    return 1
}

run() {
    printf '+'
    for arg in "$@"; do
        printf ' %s' "$arg"
    done
    printf '\n'
    "$@"
}

RT=$(runtime) || fail "No container runtime found. Install Docker Desktop or Podman, then retry."

if inspect_image_id "$IMAGE" >/dev/null; then
    fail "Refusing to replace an existing sandbox test image: $IMAGE"
fi

printf 'sandbox runtime: %s\n' "$RT"
printf 'sandbox image: %s\n' "$IMAGE"

mkdir -p "$ROOT_DIR/.claude" "$ROOT_DIR/.goldband" "$ROOT_DIR/codex/local"
for probe in $IGNORE_PROBES; do
    printf 'sandbox ignore probe\n' > "$ROOT_DIR/$probe"
done

BUILD_STARTED=1
if [ "${GOLDBAND_SANDBOX_USE_BUILDX:-0}" = "1" ] && [ "$RT" = "docker" ]; then
    run docker buildx build \
        --load \
        --cache-from type=gha \
        --cache-to type=gha,mode=max \
        --label "$OWNERSHIP_LABEL_KEY=$OWNERSHIP_TOKEN" \
        -f "$ROOT_DIR/sandbox/devcontainer/Dockerfile" \
        -t "$IMAGE" \
        "$ROOT_DIR"
else
    run "$RT" build \
        --label "$OWNERSHIP_LABEL_KEY=$OWNERSHIP_TOKEN" \
        -f "$ROOT_DIR/sandbox/devcontainer/Dockerfile" \
        -t "$IMAGE" \
        "$ROOT_DIR"
fi
inspect_image_id "$IMAGE" >/dev/null \
    || fail "Container runtime did not expose the built sandbox image: $IMAGE"

printf 'sandbox project fixture\n' > "$TMP_PROJECT/README.md"
HOST_PROBE_PATH="$ROOT_DIR/.goldband-sandbox-unmounted-probe"

node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync("sandbox/devcontainer/devcontainer.json", "utf8"));
const dockerfile = fs.readFileSync("sandbox/devcontainer/Dockerfile", "utf8");
if (data.build.context !== "../..") throw new Error("devcontainer build context must point at the goldband repo root");
if (String(data.postCreateCommand || "").includes("/workspace/project/install.sh")) {
  throw new Error("devcontainer must not run a project-local install.sh");
}
for (const key of ["CLAUDE_CODE_VERSION", "CODEX_CLI_VERSION", "BUN_VERSION"]) {
  const match = dockerfile.match(new RegExp(`^ARG ${key}=([^\\n]+)`, "m"));
  if (!match) throw new Error(`Dockerfile is missing ${key}`);
  if ((data.build.args || {})[key] !== match[1].trim()) {
    throw new Error(`devcontainer ${key} must match Dockerfile ARG`);
  }
}
console.log("[OK] devcontainer contract checked");
'

set +e
run "$RT" run --rm \
    --workdir /workspace/project \
    -e HOME=/home/goldband \
    -e GOLDBAND_CONTAINER=1 \
    -e GOLDBAND_SKIP_BUILD=1 \
    -e GOLDBAND_SKIP_COREUTILS=1 \
    -e GOLDBAND_SKIP_GENERATE=1 \
    -e GOLDBAND_SKIP_PLAYWRIGHT=1 \
    -e HOST_PROBE_PATH="$HOST_PROBE_PATH" \
    -v "$TMP_PROJECT:/workspace/project:rw" \
    "$IMAGE" \
    /bin/sh -lc '
        set -eu
        claude --version
        codex --version
        npm --prefix /opt/goldband run test:hook-router
        set +e
        printf "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"notes/random-notes.md\",\"content\":\"ghp_%036d\"}}\n" 0 \
            | node /opt/goldband/hooks/scripts/hooks/hook-router.js \
            >/tmp/goldband-hook-demo.out 2>/tmp/goldband-hook-demo.err
        hook_demo_status=$?
        set -e
        [ "$hook_demo_status" -eq 2 ]
        grep -q "Potential secrets" /tmp/goldband-hook-demo.err
        node /opt/goldband/hooks/scripts/tools/report-usage-summary.js --days 1 \
            >/tmp/goldband-usage-summary.out
        grep -q "claude/secret-detector: 1" /tmp/goldband-usage-summary.out
        echo "[OK] hook deny and container HOME telemetry verified"
        SKILL_ROOT="$HOME/.claude/skills/goldband"
        test -x "$SKILL_ROOT/bin/goldband-config"
        test -x "$SKILL_ROOT/bin/goldband-timeline-log"
        GOLDBAND_HOME="$HOME/.goldband-skill-smoke" "$SKILL_ROOT/bin/goldband-config" set telemetry off
        test "$(GOLDBAND_HOME="$HOME/.goldband-skill-smoke" "$SKILL_ROOT/bin/goldband-config" get telemetry)" = "off"
        GOLDBAND_HOME="$HOME/.goldband-skill-smoke" "$SKILL_ROOT/bin/goldband-timeline-log" \
            "{\"skill\":\"sandbox-smoke\",\"event\":\"started\",\"branch\":\"sandbox\"}"
        GOLDBAND_HOME="$HOME/.goldband-skill-smoke" "$SKILL_ROOT/bin/goldband-timeline-read" --limit 1 \
            >/tmp/goldband-timeline.out
        grep -q "sandbox-smoke started" /tmp/goldband-timeline.out
        test -f "$HOME/.goldband-skill-smoke/config.yaml"
        test -d "$HOME/.goldband-skill-smoke/projects"
        echo "[OK] installed skill helper runtime writes to container HOME"
        test ! -e /opt/goldband/.git
        test ! -e /opt/goldband/.claude/.sandbox-secret
        test ! -e /opt/goldband/.goldband/.sandbox-secret
        test ! -e /opt/goldband/codex/local/.sandbox-secret.env
        test ! -e /opt/goldband/sandbox-local.log
        echo "[OK] host overlays and secrets are not baked into image"
        printf "container write ok\n" > /workspace/project/container-write.txt
        if sh -c "printf probe > /opt/goldband/.sandbox-write-probe" 2>/tmp/goldband-probe.err; then
            echo "unexpected write to /opt/goldband" >&2
            exit 1
        fi
        grep -E "Permission denied|Read-only file system" /tmp/goldband-probe.err >/dev/null
        echo "[OK] /opt/goldband is not writable"
        if sh -c "printf probe > \"$HOST_PROBE_PATH\"" 2>/tmp/host-probe.err; then
            cat /tmp/host-probe.err >&2 || true
            echo "unexpected write to unmounted host path: $HOST_PROBE_PATH" >&2
            exit 1
        fi
        grep -E "No such file|nonexistent|Read-only file system|Permission denied" /tmp/host-probe.err >/dev/null
        echo "[OK] unmounted host path is not writable: $HOST_PROBE_PATH"
    ' >"$LOG_DIR/container.log" 2>&1
container_status=$?
set -e
cat "$LOG_DIR/container.log"
[ "$container_status" -eq 0 ] || exit "$container_status"

[ -f "$TMP_PROJECT/container-write.txt" ] || fail "container did not write through the mounted project"

if ! "$ROOT_DIR/sandbox/sandbox.sh" run "$TMP_PROJECT" --image "$IMAGE" -- \
    sh -lc 'test "$HOME" = /home/goldband && test ! -w /opt/goldband && printf launcher-ok > launcher.txt' \
    >"$LOG_DIR/launcher.out" 2>&1; then
    cat "$LOG_DIR/launcher.out" >&2
    fail "sandbox launcher happy path failed"
fi
grep -q "launcher-ok" "$TMP_PROJECT/launcher.txt" \
    || fail "sandbox launcher did not write through mounted project"

if ! "$ROOT_DIR/sandbox/sandbox.sh" run "$TMP_PROJECT" --image "$IMAGE" -- \
    sh -c 'printf "%s" "$1" > quoted-arg.txt' sh 'a b' \
    >"$LOG_DIR/launcher-quoted.out" 2>&1; then
    cat "$LOG_DIR/launcher-quoted.out" >&2
    fail "sandbox launcher quoted argument path failed"
fi
grep -qx "a b" "$TMP_PROJECT/quoted-arg.txt" \
    || fail "sandbox launcher did not preserve quoted command arguments"

if GOLDBAND_SANDBOX_NO_RUNTIME=1 "$ROOT_DIR/sandbox/sandbox.sh" run "$TMP_PROJECT" >"$LOG_DIR/no-runtime.out" 2>&1; then
    cat "$LOG_DIR/no-runtime.out" >&2
    fail "sandbox launcher should fail when no runtime is available"
fi

grep -q "No container runtime found" "$LOG_DIR/no-runtime.out" \
    || fail "missing clear no-runtime error"

printf '[OK] sandbox image build, baked install, hook replay, CLI smoke, launcher, mount boundary, and no-runtime failure verified\n'
