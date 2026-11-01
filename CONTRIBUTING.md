# Contributing

Bug reports, fixes and small features are welcome. For anything larger than a fix, open an issue first so we can agree on the shape before you spend time on it.

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

There is no CLA. Instead every commit carries a Developer Certificate of Origin sign-off, which says you wrote the change or have the right to submit it under the project licence (MIT). Add it with `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

The full text is at https://developercertificate.org. Pull requests with unsigned commits will be asked to amend them.
