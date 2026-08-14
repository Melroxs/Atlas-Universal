#!/usr/bin/env bash
# Purge the leaked credential file + token value from ALL git history.
#
#   sh scripts/purge-leaked-token-history.sh
#
# After this, force-push main (history has been rewritten):
#   git push --force origin main
#
# This is a history rewrite: every commit hash changes. Only run it when a
# force-push is explicitly authorized (it was requested here).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Rewriting history (dropping leaked file, redacting token) ..."
git filter-branch \
  --force \
  --index-filter "bash '$SCRIPT_DIR/filter-remove-leaked-file.sh'" \
  --prune-empty \
  -- --all

echo "==> Removing filter-branch backup refs ..."
git for-each-ref --format='%(refname)' refs/original/ | while read -r ref; do
  git update-ref -d "$ref"
done

echo "==> Expiring reflog + garbage collecting ..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "==> Done. Verifying:"
if git log --all -S "sbp_" --oneline | grep -q .; then
  echo "ERROR: token value still present in history!"
  git log --all -S "sbp_" --oneline
  exit 1
fi
if git ls-tree -r HEAD --name-only | grep -qx "env.local"; then
  echo "ERROR: leaked file still present in HEAD tree!"
  exit 1
fi
echo "OK: no token value and no leaked file remain in any commit."
