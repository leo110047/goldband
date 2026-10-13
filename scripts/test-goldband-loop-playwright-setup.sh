#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SCRIPT="$ROOT_DIR/goldband-loop/setup"
PDF_BIN="$ROOT_DIR/goldband-loop/make-pdf/dist/pdf"

ensure_setup_preconditions() {
  local build_log

  if [ -x "$PDF_BIN" ]; then
    return 0
  fi

  echo "Building Goldband Loop runtime binaries for setup smoke precondition..."
  build_log="$(mktemp "${TMPDIR:-/tmp}/goldband-pw-build.XXXXXX")"
  if ! (
    cd "$ROOT_DIR/goldband-loop"
    bun run build
  ) > "$build_log" 2>&1; then
    echo "failed to build Goldband Loop runtime binaries" >&2
    cat "$build_log" >&2
    exit 1
  fi
}

assert_portable_mktemp_templates() {
  local matches
  matches="$(grep -En 'mktemp .*[X][X][X][X][X][X][.]' "$SETUP_SCRIPT" "$0" || true)"
  if [ -n "$matches" ]; then
    echo "mktemp templates must keep XXXXXX at the end for macOS/BSD compatibility" >&2
    echo "$matches" >&2
    exit 1
  fi
}

assert_log_contains() {
  local expected="$1"
  local log_file="$2"
  if grep -Fq "$expected" "$log_file"; then
    return 0
  fi
  echo "expected setup log to contain: $expected" >&2
  cat "$log_file" >&2
  exit 1
}

run_required_missing_browser_fails() {
  local tmp_home log_file rc
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-required.XXXXXX")"
  log_file="$tmp_home/setup.log"

  set +e
  HOME="$tmp_home" \
    PLAYWRIGHT_BROWSERS_PATH="$tmp_home/pw-browsers" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    GOLDBAND_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS=1 \
    "$SETUP_SCRIPT" --host claude > "$log_file" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "expected setup to fail when Playwright browser is missing" >&2
    cat "$log_file" >&2
    exit 1
  fi
  assert_log_contains \
    "goldband setup failed: Playwright Chromium install did not finish successfully" \
    "$log_file"
  assert_log_contains "GOLDBAND_SKIP_PLAYWRIGHT=1" "$log_file"
  if grep -q "goldband ready" "$log_file"; then
    echo "setup reported ready after required Playwright failure" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

write_fake_playwright_tools() {
  local fake_bin="$1"
  local bun_mode="$2"
  local bunx_marker="$3"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/bun" <<EOF_BUN
#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then
  printf '1.3.11\n'
  exit 0
fi
if [ "\${1:-}" = "--eval" ]; then
  case "$bun_mode" in
    sandbox)
      echo "bootstrap_check_in com.microsoft.crashpad.child_port_handshake: Permission denied (1100)" >&2
      ;;
    missing)
      echo "browserType.launch: Executable doesn't exist at /missing/chromium" >&2
      ;;
    *)
      echo "unexpected fake bun mode: $bun_mode" >&2
      ;;
  esac
  exit 1
fi
echo "unexpected fake bun invocation: \$*" >&2
exit 99
EOF_BUN
  cat > "$fake_bin/bunx" <<EOF_BUNX
#!/usr/bin/env bash
set -euo pipefail
touch "$bunx_marker"
echo "bunx should not have been called" >&2
exit 99
EOF_BUNX
  chmod +x "$fake_bin/bun" "$fake_bin/bunx"
}

run_sandbox_launch_block_skips_install() {
  local tmp_home fake_bin log_file bunx_marker rc
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-sandbox.XXXXXX")"
  fake_bin="$tmp_home/bin"
  log_file="$tmp_home/setup.log"
  bunx_marker="$tmp_home/bunx-called"
  write_fake_playwright_tools "$fake_bin" "sandbox" "$bunx_marker"

  set +e
  PATH="$fake_bin:$PATH" \
    HOME="$tmp_home" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    "$SETUP_SCRIPT" --host claude > "$log_file" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "expected setup to fail clearly when sandbox blocks Chromium launch" >&2
    cat "$log_file" >&2
    exit 1
  fi
  assert_log_contains "Playwright Chromium launch was blocked" "$log_file"
  assert_log_contains "Playwright Chromium install was not attempted" "$log_file"
  if [ -e "$bunx_marker" ]; then
    echo "setup tried to install Chromium after a sandbox launch denial" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_unwritable_cache_skips_install() {
  local tmp_home fake_bin log_file bunx_marker cache_path rc
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-cache.XXXXXX")"
  fake_bin="$tmp_home/bin"
  log_file="$tmp_home/setup.log"
  bunx_marker="$tmp_home/bunx-called"
  cache_path="$tmp_home/not-a-directory"
  printf 'not a directory\n' > "$cache_path"
  write_fake_playwright_tools "$fake_bin" "missing" "$bunx_marker"

  set +e
  PATH="$fake_bin:$PATH" \
    HOME="$tmp_home" \
    PLAYWRIGHT_BROWSERS_PATH="$cache_path" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    "$SETUP_SCRIPT" --host claude > "$log_file" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "expected setup to fail clearly when Playwright cache is not writable" >&2
    cat "$log_file" >&2
    exit 1
  fi
  assert_log_contains "Playwright browser cache is not writable" "$log_file"
  assert_log_contains "Playwright Chromium install was not attempted" "$log_file"
  if [ -e "$bunx_marker" ]; then
    echo "setup tried to install Chromium with an unwritable cache" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_explicit_skip_succeeds() {
  local tmp_home log_file
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-skip.XXXXXX")"
  log_file="$tmp_home/setup.log"

  HOME="$tmp_home" \
    PLAYWRIGHT_BROWSERS_PATH="$tmp_home/pw-browsers" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_PLAYWRIGHT=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    "$SETUP_SCRIPT" --host claude > "$log_file" 2>&1

  assert_log_contains "Skipping Playwright Chromium install" "$log_file"
  assert_log_contains "Browser workflows will be unavailable" "$log_file"
  assert_log_contains "goldband ready (claude, standard profile)." "$log_file"
}

assert_portable_mktemp_templates
ensure_setup_preconditions
run_sandbox_launch_block_skips_install
run_unwritable_cache_skips_install
run_required_missing_browser_fails
run_explicit_skip_succeeds

echo "[OK] Goldband Loop Playwright setup behavior verified"
