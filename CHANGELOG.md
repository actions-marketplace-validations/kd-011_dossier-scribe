# Changelog

All notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## Unreleased

### Added

- Weekly Dependabot updates for GitHub Actions, grouped by minor and patch with a seven-day cooldown, and auto-merge once the required checks pass.
- A weekly upkeep workflow that checks README links and the project's own dossier, and opens one issue per problem.
- A dossier for this repository with a committed lock file.
- Security policy, code of conduct, issue and pull request templates.

### Changed

- CI runs on Node 22 and 24, and once a week.

## 0.1.0

First release.

- `init`, `lint`, `pin`, `check`, `queue`, `verify`, `auto`, `report` and `demo` commands.
- Claim-level drift: each cited claim is pinned to the git blob (or line range) of the files it names.
- Static HTML and Markdown reports, task files for re-verification, and a read-only auto block.
- No runtime dependencies, Node 22 or newer.
