#!/usr/bin/env bash
# Dry-run smoke test for the kaizen-upload composite action.
#
# What this does:
#   - Reproduces the bash steps from action.yml inline (composite actions can't
#     be executed standalone; GitHub's runner orchestrates them).
#   - Stubs `npx` so we never touch the network.
#   - Asserts that:
#       1. Missing kensho-results/ → exits non-zero with a friendly ::error::.
#       2. Missing token → exits non-zero with a friendly ::error::.
#       3. Happy path with `live=false` → invokes `npx ... push ...`.
#       4. Happy path with `live=true`  → invokes `npx ... watch ...`.
#
# Usage: bash __test__/dry-run.sh
# Exits 0 on success, 1 on any failure.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_DIR="$(dirname "$SCRIPT_DIR")"
TMP_ROOT="$(mktemp -d -t kaizen-upload-dryrun-XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

PASSED=0
FAILED=0

# --- helper: extract & run the inline shell from action.yml --------------------
# action.yml has two shell blocks (validate + upload). We reconstruct the same
# logic here as a single function so we don't need a YAML parser. The logic is
# kept byte-equivalent to the action; if action.yml diverges, update this too.

run_action() {
  # env vars expected by the action steps (mirrors action.yml `env:` blocks)
  local KENSHO_RESULTS_PATH="${KENSHO_RESULTS_PATH:-./kensho-results}"
  local KAIZEN_TOKEN="${KAIZEN_TOKEN:-}"
  local KAIZEN_WORKSPACE="${KAIZEN_WORKSPACE:-}"
  local KAIZEN_PROJECT="${KAIZEN_PROJECT:-}"
  local KAIZEN_SERVER="${KAIZEN_SERVER:-https://api.kaizenreport.com}"
  local KENSHO_VERSION="${KENSHO_VERSION:-latest}"
  local KENSHO_LIVE="${KENSHO_LIVE:-false}"

  # Step 1: validate
  if [ ! -d "$KENSHO_RESULTS_PATH" ]; then
    echo "::error title=Kensho results missing::No directory at '$KENSHO_RESULTS_PATH'."
    echo "Make sure your test step writes Kensho results to that path before this action runs."
    return 1
  fi
  if [ ! -f "$KENSHO_RESULTS_PATH/run.json" ]; then
    echo "::warning title=run.json not found::'$KENSHO_RESULTS_PATH/run.json' is missing — the upload will likely fail."
  fi

  # Step 2: upload
  echo "::add-mask::$KAIZEN_TOKEN"
  if [ -z "$KAIZEN_TOKEN" ]; then
    echo "::error title=Missing token::kaizen-token input is empty. Set secrets.KAIZEN_TOKEN in repo settings."
    return 1
  fi

  local SUBCOMMAND
  if [ "$KENSHO_LIVE" = "true" ]; then SUBCOMMAND="watch"; else SUBCOMMAND="push"; fi

  echo "Running: npx --yes @kaizenreport/kensho@${KENSHO_VERSION} ${SUBCOMMAND} ..."
  npx --yes "@kaizenreport/kensho@${KENSHO_VERSION}" "${SUBCOMMAND}" \
    --workspace "${KAIZEN_WORKSPACE}" \
    --project "${KAIZEN_PROJECT}" \
    --token "${KAIZEN_TOKEN}" \
    --input "${KENSHO_RESULTS_PATH}" \
    --server "${KAIZEN_SERVER}"
}

# --- stub npx so nothing reaches the network ---------------------------------
mkdir -p "$TMP_ROOT/bin"
cat > "$TMP_ROOT/bin/npx" <<'STUB'
#!/usr/bin/env bash
# Records the full invocation to $NPX_LOG and exits 0.
echo "$@" >> "${NPX_LOG:-/tmp/npx.log}"
exit 0
STUB
chmod +x "$TMP_ROOT/bin/npx"
export PATH="$TMP_ROOT/bin:$PATH"
export NPX_LOG="$TMP_ROOT/npx.log"

assert() {
  local label="$1"; local expected_rc="$2"; local actual_rc="$3"; local extra="${4:-}"
  if [ "$expected_rc" = "$actual_rc" ] && [ -z "$extra" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$label"; PASSED=$((PASSED+1))
  elif [ "$expected_rc" = "$actual_rc" ] && [ -n "$extra" ]; then
    # extra = grep pattern that must appear in $TMP_ROOT/out
    if grep -q -- "$extra" "$TMP_ROOT/out"; then
      printf '  \033[32mPASS\033[0m  %s\n' "$label"; PASSED=$((PASSED+1))
    else
      printf '  \033[31mFAIL\033[0m  %s — expected output to contain %q\n' "$label" "$extra"; FAILED=$((FAILED+1))
      echo "    --- output ---"; sed 's/^/    /' "$TMP_ROOT/out"
    fi
  else
    printf '  \033[31mFAIL\033[0m  %s — expected rc=%s, got rc=%s\n' "$label" "$expected_rc" "$actual_rc"; FAILED=$((FAILED+1))
    echo "    --- output ---"; sed 's/^/    /' "$TMP_ROOT/out"
  fi
}

echo "kaizen-upload dry-run (action dir: $ACTION_DIR)"
echo

# --- case 1: missing kensho-results/ ----------------------------------------
echo "case 1: missing kensho-results/ directory"
( cd "$TMP_ROOT" && \
  KENSHO_RESULTS_PATH="$TMP_ROOT/does-not-exist" \
  KAIZEN_TOKEN=fake KAIZEN_WORKSPACE=demo KAIZEN_PROJECT=app \
  bash -c "$(declare -f run_action); run_action" >"$TMP_ROOT/out" 2>&1 )
rc=$?
assert "exits non-zero" 1 "$rc"
assert "emits friendly ::error::" 1 "$rc" "::error title=Kensho results missing::"
echo

# --- case 2: missing token ---------------------------------------------------
echo "case 2: missing kaizen-token input"
mkdir -p "$TMP_ROOT/results-ok"
echo '{}' > "$TMP_ROOT/results-ok/run.json"
( cd "$TMP_ROOT" && \
  KENSHO_RESULTS_PATH="$TMP_ROOT/results-ok" \
  KAIZEN_TOKEN="" KAIZEN_WORKSPACE=demo KAIZEN_PROJECT=app \
  bash -c "$(declare -f run_action); run_action" >"$TMP_ROOT/out" 2>&1 )
rc=$?
assert "exits non-zero" 1 "$rc"
assert "emits friendly ::error::" 1 "$rc" "::error title=Missing token::"
echo

# --- case 3: happy path, live=false (push) ----------------------------------
echo "case 3: happy path, live=false → push"
: > "$NPX_LOG"
( cd "$TMP_ROOT" && \
  KENSHO_RESULTS_PATH="$TMP_ROOT/results-ok" \
  KAIZEN_TOKEN=fake KAIZEN_WORKSPACE=demo KAIZEN_PROJECT=app \
  KENSHO_LIVE=false \
  bash -c "$(declare -f run_action); run_action" >"$TMP_ROOT/out" 2>&1 )
rc=$?
assert "exits 0" 0 "$rc"
if grep -q ' push ' "$NPX_LOG"; then
  printf '  \033[32mPASS\033[0m  invoked `npx ... push ...`\n'; PASSED=$((PASSED+1))
else
  printf '  \033[31mFAIL\033[0m  expected npx invocation to contain ` push `; got:\n'; sed 's/^/    /' "$NPX_LOG"; FAILED=$((FAILED+1))
fi
echo

# --- case 4: happy path, live=true (watch) ----------------------------------
echo "case 4: happy path, live=true → watch"
: > "$NPX_LOG"
( cd "$TMP_ROOT" && \
  KENSHO_RESULTS_PATH="$TMP_ROOT/results-ok" \
  KAIZEN_TOKEN=fake KAIZEN_WORKSPACE=demo KAIZEN_PROJECT=app \
  KENSHO_LIVE=true \
  bash -c "$(declare -f run_action); run_action" >"$TMP_ROOT/out" 2>&1 )
rc=$?
assert "exits 0" 0 "$rc"
if grep -q ' watch ' "$NPX_LOG"; then
  printf '  \033[32mPASS\033[0m  invoked `npx ... watch ...`\n'; PASSED=$((PASSED+1))
else
  printf '  \033[31mFAIL\033[0m  expected npx invocation to contain ` watch `; got:\n'; sed 's/^/    /' "$NPX_LOG"; FAILED=$((FAILED+1))
fi
echo

echo "----- summary -----"
echo "  passed: $PASSED"
echo "  failed: $FAILED"
[ "$FAILED" -eq 0 ] || exit 1
exit 0
