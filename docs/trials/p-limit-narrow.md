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

- The default export takes a concurrency number and returns a limit function. <!-- src: index.js:3-5 -->
- Concurrency must be a positive integer or Infinity, anything else throws a TypeError. <!-- src: index.js:102-106 -->
- `limit.map` runs an iterable through the limiter and passes the index to the mapper. <!-- src: index.js:84-88 -->
- The limit function exposes activeCount, pendingCount and clearQueue. <!-- src: index.js:58-68 -->
- Arguments after the function are passed through to it. <!-- src: index.js:53-55 -->
- Types ship with the package. <!-- src: package.json#exports.types, index.d.ts:57 -->

## Architecture

- Pending functions are kept in a yocto-queue. <!-- src: index.js:1 -->
- The only runtime dependency is yocto-queue. <!-- src: package.json#dependencies -->
- Only index.js and index.d.ts are published. <!-- src: package.json#files -->
- It is an ES module. <!-- src: package.json#type -->

## Deploy

- CI tests Node 20, 22 and 24. <!-- src: .github/workflows/main.yml:9-15 -->
- Tests run with xo, ava and tsd. <!-- src: package.json#scripts.test -->

<!-- auto:start -->
<!-- auto:end -->
