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
- `res.json`, `res.jsonp`, `res.download` and `res.sendFile` are defined on the response. <!-- src: lib/response.js -->
- Settings like etag and trust proxy compile a matching function when set. <!-- src: lib/application.js:351-380 -->
- Routing comes from the router package. <!-- src: lib/express.js:16-17, package.json -->
- Body parsing is exposed as express.json and express.urlencoded. <!-- src: lib/express.js -->
- Runs on Node 18 or newer. <!-- src: package.json -->
- Request helpers include req.accepts, req.is, req.range and req.ip. <!-- src: lib/request.js -->

## Architecture

- The app is a function with application, request and response prototypes mixed in. <!-- src: lib/express.js:30-55 -->
- Views are resolved through a View class. <!-- src: lib/view.js -->
- Only index.js and lib/ are published. <!-- src: package.json -->

## Deploy

- CI lints and tests on pull requests. <!-- src: .github/workflows/ci.yml -->
- Dependabot updates actions and npm weekly. <!-- src: .github/dependabot.yml -->
- Tests run with mocha. <!-- src: package.json -->

<!-- auto:start -->
<!-- auto:end -->
