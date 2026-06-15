# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-01

### Added

- Initial release
- TypeScript AST-based route analysis via `ts-morph`
- Framework detection: Express, Fastify, Koa
- Response type inference from:
  - Explicit return type annotations
  - `res.json()` / `res.send()` argument types
  - `ctx.body` assignments (Koa)
  - `res.status(N).json()` chains (multi-status)
  - Direct return statements (Fastify async handlers)
- Path parameter extraction from `:param` and `{param}` patterns
- JSDoc-based enrichment (@summary, @tag, @deprecated)
- `useSwagger(app)` — serves OpenAPI 3.0 JSON spec
- `useSwaggerUi(app)` — serves Swagger UI
- Named interface/type registration as `$ref` schemas
- Union type → `oneOf` / `enum` resolution
- Nullable type support
- Circular reference detection
- Configurable spec path, UI path, servers, security schemes, tags
