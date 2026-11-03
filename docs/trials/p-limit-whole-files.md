---
slug: p-limit
name: p-limit
repo: .
status: active
last_verified: 2026-11-03
tags: [library]
---

Runs promise-returning functions with limited concurrency.

## Features

- The default export takes a concurrency number and returns a limit function. <!-- src: index.js -->
- Concurrency must be a positive integer or Infinity, anything else throws a TypeError. <!-- src: index.js -->
- `limit.map` runs an iterable through the limiter and passes the index to the mapper. <!-- src: index.js -->
- The limit function exposes activeCount, pendingCount and clearQueue. <!-- src: index.js -->
- Pending functions are kept in a yocto-queue. <!-- src: index.js, package.json -->
- Types ship with the package. <!-- src: index.d.ts, package.json -->
- Arguments after the function are passed through to it. <!-- src: index.js -->

## Architecture

- It is an ES module with a single default export. <!-- src: package.json, index.js -->
- The only runtime dependency is yocto-queue. <!-- src: package.json -->
- Only index.js and index.d.ts are published. <!-- src: package.json -->

## Deploy

- CI tests Node 20, 22 and 24. <!-- src: .github/workflows/main.yml -->
- Tests run with xo, ava and tsd. <!-- src: package.json -->

<!-- auto:start -->
<!-- auto:end -->
