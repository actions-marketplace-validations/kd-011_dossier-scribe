---
slug: orders-service
name: Orders Service
repo: .
status: active
last_verified: 2026-02-14
tags: [backend, node]
---

Takes orders from the storefront and hands them to fulfilment.

## Features

- Orders are validated against a JSON schema before they are stored. <!-- src: src/validate.js, schemas/order.json -->
- Every route is registered from the routes folder. <!-- src: src/routes/*.js -->
- Payment webhooks are checked with an HMAC signature. <!-- src: src/webhooks.js:20-64 -->

## Architecture

- One process, one SQLite file, no queue. Fulfilment polls. <!-- src: src/server.js, src/db.js -->

## Data

- The orders table is the only table with a foreign key. <!-- src: migrations/001_init.sql -->

## Deploy

- The container image exposes port 8080. <!-- src: Dockerfile -->

## Notes

- Ask the payments team before touching the webhook secret rotation.

<!-- auto:start -->
<!-- auto:end -->
