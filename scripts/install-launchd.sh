#!/bin/bash
#
# Installs the two launchd jobs for this copy of the repository:
#
#   com.lahsrocketry.daily      20:30 every day, drafts tomorrow's post
#   com.lahsrocketry.publisher  every 15 minutes and at load, publishes
#
# Re-running it is how you update them after the plists change.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/lahsrocketry"
DOMAIN="gui/$(id -u)"

mkdir -p "$AGENTS" "$LOGS"
chmod +x "$REPO/scripts/run.sh"

for LABEL in com.lahsrocketry.daily com.lahsrocketry.publisher; do
  SOURCE="$REPO/launchd/$LABEL.plist"
  TARGET="$AGENTS/$LABEL.plist"

  sed -e "s|__REPO__|$REPO|g" -e "s|__LOGS__|$LOGS|g" "$SOURCE" >"$TARGET"
  plutil -lint "$TARGET" >/dev/null

  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$TARGET"
  launchctl enable "$DOMAIN/$LABEL"
  echo "loaded $LABEL"
done

echo
echo "Repository: $REPO"
echo "Logs:       $LOGS/daily.log and $LOGS/publisher.log"
echo "Status:     launchctl list | grep lahsrocketry"
echo "Run now:    launchctl kickstart -k $DOMAIN/com.lahsrocketry.publisher"
