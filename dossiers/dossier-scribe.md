---
slug: dossier-scribe
name: dossier-scribe
repo: .
status: active
last_verified: 2026-11-02
tags: [cli, node, docs]
---

A command line tool that keeps project docs true. Each claim in a doc cites the files it came from, and `check` reports which claims drifted. These claims are the README's main promises, each tied to the code that keeps it.

## Features

- Runs on Node 22 or newer. <!-- src: package.json:17-19 -->
- Installs two commands that point at the same script: `dossier-scribe` and the short alias `dscribe`. <!-- src: package.json:6-9 -->
- Has no runtime or development dependencies, only Node built-ins. <!-- src: package.json -->
- Gives each claim a stable id from a hash of its normalised text, so editing a claim shows the old id as removed and the new one as new. <!-- src: src/claims.mjs:15-17 -->
- A cited line range pins a hash of just those lines, so edits elsewhere in the file leave the claim ok. <!-- src: src/pin.mjs:12, src/check.mjs:35-36 -->
- Labels each claim ok, stale, broken, new or removed, and reports a claim with no citation as uncited. <!-- src: src/check.mjs, src/commands/check.mjs:8 -->
- `check` exits 0 when clean and 1 on findings, and a usage or config error exits 2. <!-- src: src/commands/check.mjs:37, src/cli.mjs:59-61 -->
- Rating a dossier red uses the broken count, the stale count against `redStale`, and days since it was verified. <!-- src: src/check.mjs:6-10 -->
- The HTML report has no JavaScript and escapes text taken from dossiers. <!-- src: src/report.mjs -->
- The env collector records variable names only, never values. <!-- src: src/collectors.mjs:125-137 -->
- `queue` stops the same dossier being queued twice within a cooldown and caps tasks per day. <!-- src: src/commands/queue.mjs:24, src/commands/queue.mjs:59, src/config.mjs:14 -->

## Architecture

- All git reads are against HEAD, listing the tree in one call and reading ranged files in one batch. <!-- src: src/git.mjs:47-80 -->
- The lock file lives in the dossiers directory as `.dossier-lock.json`. <!-- src: src/lock.mjs:5 -->

## Deploy

- CI runs `node --test` on Node 22 and 24 for every pull request and once a week. <!-- src: .github/workflows/ci.yml:9-10, .github/workflows/ci.yml:24 -->
- Dependabot opens grouped weekly updates for GitHub Actions and qualifying ones merge automatically once CI is green. <!-- src: .github/dependabot.yml, .github/scripts/automerge-eligible.mjs -->

<!-- auto:start -->
- package: dossier-scribe 0.1.0
- npm scripts (1): test
<!-- auto:end -->
