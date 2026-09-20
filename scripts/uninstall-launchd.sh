#!/bin/bash
#
# Unloads both newsroom jobs and removes the installed copies of the plists.
# The repository is untouched; re-install with scripts/install-launchd.sh.
set -uo pipefail

AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

for LABEL in com.lahsrocketry.daily com.lahsrocketry.publisher; do
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$AGENTS/$LABEL.plist"
  echo "unloaded $LABEL"
done
