#!/usr/bin/env bash
# Try the real TokenFlow CLI against the local mock server — no API keys, no cost.
# Uses a throwaway HOME so it never touches your real ~/.tokenflow config/history.
#
#   npm run build            # once
#   bash scripts/try-mock.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="dist/cli/index.js"
[ -f "$BIN" ] || { echo "Run 'npm run build' first."; exit 1; }

# Throwaway home + config that points every provider at the mock server.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill "${SRV:-}" 2>/dev/null || true' EXIT
mkdir -p "$TMP/.tokenflow"
cat > "$TMP/.tokenflow/config.json" <<'JSON'
{ "providers": {
  "anthropic": { "baseUrl": "http://127.0.0.1:8788" },
  "openai":    { "baseUrl": "http://127.0.0.1:8788" },
  "gemini":    { "baseUrl": "http://127.0.0.1:8788" }
} }
JSON

node scripts/mock-server.mjs & SRV=$!
sleep 1
export HOME="$TMP" USERPROFILE="$TMP" ANTHROPIC_API_KEY=x OPENAI_API_KEY=x GEMINI_API_KEY=x

echo "### one-shot"
node "$BIN" "hello" < /dev/null
echo; echo "### fan-out (3 models + comparison table)"
node "$BIN" -m claude-opus-4-8,gpt-4o,gemini-2.5-pro "hello" < /dev/null
echo; echo "### piped (stdout = response only; cost goes to stderr)"
echo "some context" | node "$BIN" "summarise" 2>/dev/null
echo; echo "### JSON mode"
node "$BIN" --json "hello" < /dev/null
echo; echo "### history"
node "$BIN" log
node "$BIN" cost --since 7d
