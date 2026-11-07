#!/usr/bin/env bash
# Builds the website into _site/ (used by Vercel; GitHub Pages does the same
# in .github/workflows/deploy.yml). Run after `npm run build`.
set -euo pipefail

rm -rf _site
mkdir _site
cp -r index.html admin.html slideshow.html settings.json manifest.webmanifest sw.js icons css js music tools _site/

# New version number on every deploy, so phones never mix an old cached
# style.css / app.js with the new page
SHA="${VERCEL_GIT_COMMIT_SHA:-${GITHUB_SHA:-$(date +%s)}}"
sed -i "s/?v=dev/?v=${SHA:0:8}/g" _site/index.html _site/admin.html _site/slideshow.html _site/js/admin.js _site/sw.js
echo "Built _site (version ${SHA:0:8})"
