# Security

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the Security tab of this repository and choose "Report a vulnerability". The report stays private until a fix is out. Do not open a public issue for something exploitable.

Include what you ran, what you expected and what happened. A small repository that reproduces it helps most.

## What is in scope

dossier-scribe reads files from a git repository and writes dossier, lock, state and report files. It makes no network calls. The areas most worth a look:

- Path handling in citations (`<!-- src: ... -->`), including globs and `..` segments.
- The `--dispatch-cmd` option of `queue`, which runs a command you supply through `sh -c`.
- The HTML report, which should escape everything taken from a dossier.
- The env collector, which must record variable names and never values.

## Supported versions

Only the latest release gets fixes. The project is small and has no runtime dependencies.
