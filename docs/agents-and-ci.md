# Agents, CI and hooks

## With AI agents

The tool makes no LLM or network calls itself. It produces the work order; a person or an agent does the rewriting.

`queue --format claude-code` writes a self-contained prompt per drifted doc: what a dossier is, which file to edit, which repo to read, the drifted claims with their diffs, and the exact finish line (`lint`, then `pin`). Paste it into any coding agent:

```sh
dossier-scribe queue --format claude-code --out tasks
cat tasks/orders-service.prompt.md   # paste into your agent
```

To automate that, `--dispatch-cmd` pipes each task to a command on stdin. It is off by default and works with any agent. `--max` per day and the per-doc cooldown still apply:

```sh
dossier-scribe queue --format claude-code --max 3 \
  --dispatch-cmd 'my-agent --prompt-from-stdin'
```

The command runs through `sh -c` with `DSCRIBE_SLUG` and `DSCRIBE_TASK_FILE` in its environment. A non-zero exit makes `queue` exit 1 and does not start that doc's cooldown. The agent is expected to edit the dossier and run `dossier-scribe pin <slug>` itself. Read the resulting diff: the tool can show that a file changed, but it cannot tell you the agent's rewrite is right.

## GitHub Actions: nightly drift issues

[`examples/workflows/dossier-drift.yml`](../examples/workflows/dossier-drift.yml) runs `lint` and `auto --check`, runs `check` and `queue`, then uses `gh` to open or update one issue per drifted dossier (using the task file as the issue body) and to close the issue when the dossier is clean again. Copy it to `.github/workflows/`. It needs the lock file committed and `issues: write` permission.

## Pre-commit hook

Save as `.git/hooks/pre-commit` and `chmod +x` it:

```sh
#!/bin/sh
dossier-scribe lint && dossier-scribe auto --check
```

Because every read is against HEAD, a hook sees the previous commit's files: a claim citing a file you are adding in the same commit fails lint until that file is committed. For the stronger `check` gate use a `pre-push` hook instead, where everything is committed:

```sh
#!/bin/sh
dossier-scribe check --fail-on stale,broken
```

