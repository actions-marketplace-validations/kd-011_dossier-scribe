# Contributing

Bug reports, fixes and small features are welcome. For anything bigger than a fix, open an issue first so we can agree on the approach before you put time into it.

## Ground rules

- Zero runtime dependencies, and no dev dependencies either. Node 22 built-ins only (`node:fs`, `node:child_process`, `node:crypto`, `node:test`).
- The tool never makes network or LLM calls, and never edits dossier prose. It pins, checks, generates the auto block, and writes task files. People and agents rewrite claims.
- Tests build real temporary git repos. No mocking git.
- Plain commit messages, plain prose. No em dashes anywhere (code, docs, tests, commits).

## Development

```sh
node --test                       # everything
node --test test/pin-check.test.mjs   # one file while iterating
node bin/dossier-scribe.mjs demo  # see it work end to end
```

Write the failing test first, watch it fail for the right reason, then make it pass. A change to one of the guards (env value redaction, range-only hashing, the queue cooldown) needs a test that goes red when the guard is weakened.

`DSCRIBE_NOW` (an ISO timestamp) overrides the clock. Tests use it to make "days since verified" and cooldowns deterministic. It is not a user feature.

## Sign-off (DCO)

There is no CLA. Every commit carries a Developer Certificate of Origin sign-off, which says you wrote the change or have the right to submit it under the project licence (MIT). Add it with `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

The full text is at https://developercertificate.org. Pull requests with unsigned commits will be asked to amend them.

## Dependency updates and CI

Dependabot proposes GitHub Actions updates weekly. Patch and minor updates, and any update to an action from the `actions/` organisation, merge on their own once the required checks pass. Other major updates wait for a person. CI runs `node --test` on Node 22 and 24, and once a week so the badge shows the real state of `main`.

A weekly job checks the links in the README and runs `dossier-scribe check` against this repository's own dossier in `dossiers/`. If a cited file changed, it opens one issue. To clear it, re-read the cited files, fix the claims that are no longer true, run `dossier-scribe pin` and commit the dossier and lock.

## Release

A release is a merge. Add a `## [x.y.z] - date` section to `CHANGELOG.md`, run `npm version <patch|minor|major> --no-git-tag-version`, and merge. The `publish` workflow then compares `package.json` with what npm has. If the version is new it runs the tests, publishes with provenance, and makes the `vx.y.z` tag and GitHub Release from that changelog section (`scripts/release.mjs` holds the logic and has tests). While the package is not on npm and the `NPM_TOKEN` secret does not exist, it skips the npm step with a notice and still makes the GitHub Release. To publish later, add the secret and run the workflow by hand from the Actions tab.
