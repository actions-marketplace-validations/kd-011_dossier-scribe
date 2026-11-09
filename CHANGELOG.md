# Changelog

All notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-11-09

### Added

- A GitHub Action, `kd-011/dossier-scribe`, runs `lint` and `check` in a workflow and fails the step on stale or broken claims. It takes `root`, `fail-on`, `since` and `lint`. See [docs/action.md](docs/action.md).

## [0.2.0] - 2026-11-03

Found by pinning real docs for [p-limit](https://github.com/sindresorhus/p-limit) and [express](https://github.com/expressjs/express) a year back and checking them against today's HEAD. The numbers are in [docs/trials.md](docs/trials.md).

### Added

- Cite one value inside a JSON file with `path#key`, for example `package.json#engines.node`. A version bump or a reformat of `package.json` no longer makes the claim stale. `lint` checks the key exists, `verify` shows the old and new value, and removing the key is `BROKEN`.
- A new claim state, `MOVED`. When the cited lines are unchanged but sit at other line numbers, the claim is no longer `STALE`. It does not fail `check` by default, shows the new numbers, and `--fail-on moved` makes it fail.
- `check` suggests a JSON key when a claim cites a whole `package.json` that changed.
- `scripts/render-assets.mjs` renders the README image from a real `demo` run.
- A `publish` workflow and `scripts/release.mjs`: merging a version bump makes the GitHub Release, and publishes to npm once an `NPM_TOKEN` secret exists.
- Weekly Dependabot updates for GitHub Actions, grouped by minor and patch with a seven-day cooldown, and auto-merge once the required checks pass.
- A weekly upkeep workflow that checks README links and the project's own dossier, and opens one issue per problem.
- A dossier for this repository with a committed lock file.
- Security policy, code of conduct, issue and pull request templates.

### Changed

- Lines added or removed above a cited range used to make the claim `STALE`. It is `MOVED` now. This is the one behaviour change to existing docs: a doc that had a stale range claim for this reason will show `MOVED` instead.
- `check` lists the commits for a changed file once per dossier. Later claims on the same file say "same change as above". `--json` still has them on every claim.
- For a claim with a line range or a key, `check` now says the range changed and that the commit list is for the whole file, instead of implying the commits touched the cited lines.
- `verify` shows only the diff hunks that touch a cited range.
- `demo` prints the claim and the real diff before it prints `check`.
- `init` no longer tells you to commit a file that is already committed.
- CI runs on Node 22 and 24, and once a week.
- `package.json` carries `repository`, `bugs` and `homepage`.

## [0.1.0]

First release.

- `init`, `lint`, `pin`, `check`, `queue`, `verify`, `auto`, `report` and `demo` commands.
- Claim-level drift: each cited claim is pinned to the git blob (or line range) of the files it names.
- Static HTML and Markdown reports, task files for re-verification, and a read-only auto block.
- No runtime dependencies, Node 22 or newer.
