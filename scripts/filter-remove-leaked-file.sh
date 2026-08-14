#!/usr/bin/env bash
# git filter-branch --index-filter script.
#
# 1. Removes the leaked repo-root env file (no leading dot) from the index of
#    EVERY commit, so it disappears from all history.
# 2. Redacts the leaked Supabase access-token value (sbp_...) wherever it
#    appears in ATLAS_MVP_READINESS_REPORT.md in history, replacing it with
#    <redacted>.
set -euo pipefail

git rm --cached --ignore-unmatch env.local >/dev/null 2>&1 || true

if git cat-file -e :ATLAS_MVP_READINESS_REPORT.md 2>/dev/null; then
  blob="$(
    git cat-file blob :ATLAS_MVP_READINESS_REPORT.md \
      | sed -E 's/sbp_[A-Za-z0-9_]+/<redacted>/g' \
      | git hash-object -w --stdin
  )"
  git update-index --cacheinfo "100644,$blob,ATLAS_MVP_READINESS_REPORT.md"
fi
