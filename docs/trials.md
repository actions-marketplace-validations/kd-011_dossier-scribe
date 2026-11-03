# Trials on real repositories

I pinned a dossier for two public repositories at a commit about a year old, then ran `check` against today's HEAD. That answers "if I had adopted this a year ago, what would it say now, and how much of it would be noise?". Each flagged claim was judged by reading the diff since the pin.

| Repository | Pinned at | Commits since | Files at HEAD |
| --- | --- | --- | --- |
| [sindresorhus/p-limit](https://github.com/sindresorhus/p-limit) | `7bdd25c`, 2025-10-19 | 16 | 16 |
| [expressjs/express](https://github.com/expressjs/express) | `4453d83c`, 2025-11-01 | 95 | 216 |

Both ran in November 2026. Reproduce a row with `node scripts/trial.mjs <url> <commit> <dossier>`, using the dossiers in [docs/trials/](trials/).

## Setup time

The tool's own commands (`init`, `lint`, `pin`, `check`) each took under a second, and `check` took about 0.1 s on express's 6186 commits. Cloning both repositories, writing 12 and 16 claims and running the first `check` on each took 48 s in total by file timestamps. A language model read the code and wrote the claims, and a person will do that more slowly. Writing claims that cite files is the real setup cost, and I did not time that part on its own.

## What check said

"Still true" means the claim was correct at HEAD when I read the diff. "Wrong at pin" means the claim was already false the day I pinned it, which is my mistake and not something the tool can see.

| Dossier | Version | Claims | STALE | Real drift | Still true | Wrong at pin | MOVED |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p-limit, whole files | 0.1.0 | 12 | 11 | 1 | 9 | 1 | n/a |
| p-limit, narrow citations | 0.2.0 | 12 | 5 | 1 | 4 | 0 | 1 |
| express, whole files | 0.1.0 | 16 | 11 | 0 | 10 | 1 | n/a |
| express, whole files | 0.2.0 | 16 | 9 | 0 | 8 | 1 | 2 |
| express, narrow citations | 0.2.0 | 16 | 2 | 0 | 2 | 0 | 4 |

"Whole files" is how I wrote the first dossier for each, citing `package.json` and source files as a whole. "Narrow" is mostly the same claims cited with line ranges and `package.json#key`, which is what the README now recommends.

What the rows show:

- A whole `package.json` is the worst citation. Every release and every Dependabot bump changes it. On express, `package.json` changed in 23 commits and flagged four claims that had nothing to do with versions. A `#key` citation fixed that.
- Line ranges drifted for a boring reason: comments and imports added above them. In the first express dossier that made two claims `STALE` under 0.1.0 although the cited lines were identical (four in the narrow one). They are `MOVED` now and do not fail the build.
- What is left is a range or file that really changed while the claim stayed true. p-limit's `limit.map` was refactored, the claim "passes the index to the mapper" still holds, and it is flagged. The tool cannot tell those apart from a real change. `verify` now shows only the hunks that touch the cited lines, which makes the glance quick.
- True drift was rare. In p-limit, the claim "the default export takes a concurrency number" became incomplete when `pLimit` started accepting an options object, and it was caught. In express I found none in 95 commits. Pinning does not check that a claim is true, only that the files it cites have not changed since. Two of my claims were wrong on the day I pinned them: p-limit's "a single default export" (it also exports `limitFunction`) and express's Dependabot "weekly" (the file says monthly).

On these two repos that came to one real catch in 28 claims and two to four false alarms per dossier once the citations were narrow. It will not give you zero false alarms. It gives you a short list of claims to open.

## What changed because of it

- `package.json#key` citations, so release and dependency bumps stop flagging unrelated claims.
- A `MOVED` state, so line shifts stop failing the build.
- One listing of a file's commits per dossier instead of one per claim. The first p-limit run printed the same five commits eleven times.
- A hint in `check` when a whole `package.json` is what changed.
- `verify` narrowed to the cited lines or value.
