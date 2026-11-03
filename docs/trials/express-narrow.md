---
slug: express
name: express
repo: .
status: active
last_verified: 2026-11-03
tags: [framework]
---

Web framework for Node.

## Features

- A new app starts with a weak etag, a simple query parser and trust proxy off. <!-- src: lib/application.js:90-100 -->
- Redirects default to status 302. <!-- src: lib/response.js:819-824 -->
- With the query parser disabled, req.query is an empty object. <!-- src: lib/request.js:217-225 -->
- `res.send` defaults string bodies to text/html. <!-- src: lib/response.js:125-140 -->
- `res.json` sets the content type to application/json unless one is set. <!-- src: lib/response.js:239-250 -->
- Settings like etag and trust proxy compile a matching function when set. <!-- src: lib/application.js:351-380 -->
- Routing comes from the router package. <!-- src: lib/express.js:19, package.json#dependencies.router -->
- Body parsing is exposed as express.json and express.urlencoded. <!-- src: lib/express.js:77-81 -->
- Runs on Node 18 or newer. <!-- src: package.json#engines.node -->
- `req.range` and `req.is` are request methods. <!-- src: lib/request.js:201-215, lib/request.js:256-275 -->

## Architecture

- The app is a function with application, request and response prototypes mixed in. <!-- src: lib/express.js:30-55 -->
- Views are resolved through a View class. <!-- src: lib/view.js -->
- Only index.js and lib/ are published. <!-- src: package.json#files -->

## Deploy

- CI runs on pull requests. <!-- src: .github/workflows/ci.yml:3-14 -->
- Dependabot opens monthly updates for actions and npm. <!-- src: .github/dependabot.yml:1-13 -->
- Tests run with mocha. <!-- src: package.json#scripts.test -->

<!-- auto:start -->
<!-- auto:end -->
