#!/usr/bin/env bash
# Creates the GitHub release for the pushed tag, with every file at once.
#
#   publish-release.sh <file>...
#
# gh creates the release as a draft, uploads the files and only then publishes
# it, so a release is never public without its downloads; if anything fails, gh
# removes its own draft.
#
# Three checks come first, each stopping the run rather than guessing:
#
# - The tag still points at the commit that was built. GitHub ignores the
#   target of a release whose tag exists, so a moved tag would get a release
#   carrying the old binaries.
# - No published release exists for the tag; re-cutting one means deleting it
#   first. A draft for the tag is left over from a failed attempt and removed.
# - The list of published releases could be read, because "latest" depends on
#   it.
#
# The release is marked latest only when no published release has a newer plain
# vX.Y.Z tag, so re-cutting an older version does not pull the badge and the
# download buttons back to it. A newer tag whose release never came out does not
# count.
set -euo pipefail

tag=$GITHUB_REF_NAME
repo=$GITHUB_REPOSITORY

if [ "$#" -eq 0 ]; then
  echo "::error::no files to publish with $tag" >&2
  exit 1
fi

tagged=$(gh api "repos/$repo/commits/$tag" -q .sha)
if [ "$tagged" != "$GITHUB_SHA" ]; then
  echo "::error::$tag now points at $tagged, but this run built $GITHUB_SHA. The tag moved; the run for its new commit publishes it." >&2
  exit 1
fi

existing=$(gh api --paginate "repos/$repo/releases?per_page=100" \
  -q '.[] | select(.tag_name == env.GITHUB_REF_NAME) | "\(.id) \(.draft)"')
if printf '%s\n' "$existing" | grep -q ' false$'; then
  echo "::error::$tag is already published. To re-cut it, delete that release first." >&2
  exit 1
fi
printf '%s\n' "$existing" | while read -r id _draft; do
  [ -n "$id" ] || continue
  gh api -X DELETE "repos/$repo/releases/$id"
  echo "removed the draft $id an earlier attempt left"
done

published=$(gh release list --repo "$repo" --exclude-drafts --limit 1000 --json tagName -q '.[].tagName')
# grep fails when there is no plain version at all, which is an answer here
# rather than an error.
newest=$(printf '%s\n%s\n' "$published" "$tag" | { grep -E '^v[0-9]+[.][0-9]+[.][0-9]+$' || true; } | sort -V | tail -1)
latest=false
if [ "$newest" = "$tag" ]; then
  latest=true
fi

# The title is the version alone: the repository name is already above it.
gh release create "$tag" \
  --repo "$repo" \
  --verify-tag \
  --title "$tag" \
  --notes-file ".github/release-notes/$tag.md" \
  --latest="$latest" \
  "$@"
echo "published $tag with $# files, latest=$latest"

# The job that moves the image tag reuses this answer instead of deciding again.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "latest=$latest" >> "$GITHUB_OUTPUT"
fi
