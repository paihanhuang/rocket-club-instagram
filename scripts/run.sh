#!/bin/bash
#
# One newsroom command under launchd.
#
#   scripts/run.sh daily [--date YYYY-MM-DD]
#   scripts/run.sh publish
#
# launchd starts jobs with almost no environment, so this script provides the
# three things the newsroom needs: the repository as the working directory,
# Homebrew's node and pnpm on PATH, and a log to read afterwards.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/lahsrocketry"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "usage: run.sh <daily|publish|doctor|gate|token-refresh> [args]" >&2
  exit 64
fi

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/${COMMAND}.log"

# Keep a single log from growing without bound: 5 MB, one generation back.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  mv -f "$LOG" "$LOG.1"
fi

# The same Homebrew node and pnpm an interactive shell would use.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO" || exit 66
exec >>"$LOG" 2>&1

echo "--- $(date '+%Y-%m-%d %H:%M:%S %Z')  run.sh $*"
pnpm tool "$@"
STATUS=$?
echo "--- exit $STATUS"
exit $STATUS
