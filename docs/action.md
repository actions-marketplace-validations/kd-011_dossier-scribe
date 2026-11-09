# GitHub Action

The action runs `dossier-scribe lint` and `dossier-scribe check` on your repo and fails the step when a claim is stale or broken.

```yaml
name: docs
on:
  push:
  schedule:
    - cron: "0 3 * * 1"

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: kd-011/dossier-scribe@v0
```

`fetch-depth: 0` matters. `check` compares the lock file with git history, and a shallow clone has none, so every claim would look unchanged.

The repo needs `dossier-scribe.json`, the dossiers and the lock file committed. [agents-and-ci.md](agents-and-ci.md) covers the nightly issue workflow if you want one issue per drifted doc instead of a red build.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `root` | `.` | Directory of the repo to check. |
| `fail-on` | `stale,broken` | Claim states that set exit 1. |
| `since` | empty | Hide drift older than `7d`, a date or a git ref. |
| `lint` | `true` | Run `lint` first, so a malformed citation fails the step. |
