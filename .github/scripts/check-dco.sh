#!/usr/bin/env bash
# Checks that every non-merge commit in <base>..<head> carries a Signed-off-by
# trailer matching its author (Developer Certificate of Origin, see CONTRIBUTING.md).
# Usage: check-dco.sh <base> <head>   (base may be empty or all zeros for a new branch)
set -euo pipefail

base="${1:-}"
head="${2:?usage: check-dco.sh <base> <head>}"
if [[ -z "$base" || "$base" =~ ^0+$ ]]; then range="$head"; else range="$base..$head"; fi

failed=0
while IFS= read -r sha; do
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  if ! git log -1 --format='%(trailers:key=Signed-off-by,valueonly)' "$sha" | grep -Fxq "$author"; then
    echo "::error::Commit ${sha:0:12} lacks 'Signed-off-by: $author'. Use 'git commit -s'."
    failed=1
  fi
done < <(git rev-list --no-merges "$range")

if [[ "$failed" -eq 0 ]]; then echo "All commits are signed off."; fi
exit "$failed"
