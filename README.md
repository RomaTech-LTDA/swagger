# @romatech/swagger

Zero-config Swagger/OpenAPI documentation generator for Node.js.

Uses TypeScript AST analysis to automatically detect your routes and generate an OpenAPI 3.0 spec — no decorators, no annotations, no changes to your existing code.

Works with **Express**, **Fastify**, and **Koa**.

---

## Installation

```bash
npm install @romatech/swagger
```

> Requires TypeScript ≥ 5.0 and Node.js ≥ 18.

---

## Quick Start

Add two lines to your existing application. That's it.

```typescript
import express from 'express';
import { useSwagger, useSwaggerUi } from '@romatech/swagger';

const app = express();

app.get('/users', (req, res) => {
  res.json([{ id: 1, name: 'Alice' }]);
});

app.post('/users', (req, res) => {
  res.status(201).json({ id: 2, name: 'Bob' });
});

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, name: 'Alice' });
});

// Register swagger — no config needed
useSwagger(app);    // → GET /api-docs.json
useSwaggerUi(app);  // → GET /api-docs

app.listen(3000, () => console.log('http://localhost:3000/api-docs'));
```

Open `http://localhost:3000/api-docs` and your docs are live.

---

## Supported Frameworks

### Express

```typescript
import express from 'express';
import { useSwagger, useSwaggerUi } from '@romatech/swagger';

const app = express();

useSwagger(app);
useSwaggerUi(app);
```

### Fastify

```typescript
import Fastify from 'fastify';
import { useSwagger, useSwaggerUi } from '@romatech/swagger';

const fastify = Fastify();

fastify.get('/products', async (req, reply) => {
  return [{ id: 1, name: 'Widget' }];
});

useSwagger(fastify);
useSwaggerUi(fastify);

fastify.listen({ port: 3000 });
```

### Koa

```typescript
import Koa from 'koa';
import Router from '@koa/router';
import { useSwagger, useSwaggerUi } from '@romatech/swagger';

const app = new Koa();
const router = new Router();

router.get('/orders', async (ctx) => {
  ctx.body = [{ id: 1, status: 'pending' }];
});

useSwagger(router);   // Pass the router, not app
useSwaggerUi(router);

app.use(router.routes());
app.listen(3000);
```

---

## Configuration

Both `useSwagger` and `useSwaggerUi` accept an optional config object.

```typescript
useSwagger(app, {
  title: 'My API',
  description: 'Manages users and products.',
  version: '2.1.0',
  specPath: '/openapi.json',   // where the JSON spec is served
  uiPath: '/docs',             // where the UI is served
  basePath: '/api/v1',         // prepended to all routes
  sourcePatterns: ['./src/**/*.ts'],
  tsConfigPath: './tsconfig.json',
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local' },
  ],
});

useSwaggerUi(app, {
  uiPath: '/docs',
  specPath: '/openapi.json',
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `"API Documentation"` | Title shown in the UI header |
| `description` | `string` | — | Short API description |
| `version` | `string` | `"1.0.0"` | API version |
| `specPath` | `string` | `"/api-docs.json"` | Path where the OpenAPI JSON is served |
| `uiPath` | `string` | `"/api-docs"` | Path where the Swagger UI is served |
| `basePath` | `string` | — | Prefix prepended to all detected routes |
| `sourcePatterns` | `string[]` | `["./src/**/*.ts"]` | Glob patterns for files to analyze |
| `tsConfigPath` | `string` | `"./tsconfig.json"` | Path to your tsconfig.json |
| `servers` | `ServerConfig[]` | — | Server URLs to list in the spec |
| `securitySchemes` | `object` | — | OpenAPI security scheme definitions |
| `tags` | `TagConfig[]` | — | Global tag definitions |

---

## Enriching Documentation with JSDoc

The analyzer reads standard JSDoc comments to enrich your spec. No extra libraries or annotations are needed — just regular JSDoc.

```typescript
/**
 * Retrieves all users in the system.
 *
 * @summary List users
 * @tag Users
 */
app.get('/users', (req, res) => {
  res.json([]);
});

/**
 * Creates a new user account.
 *
 * @summary Create user
 * @tag Users
 * @deprecated
 */
app.post('/users', (req, res) => {
  res.status(201).json({});
});
```

### Supported JSDoc Tags

| Tag | Effect |
|---|---|
| `@summary` | Short one-line title for the operation |
| `@tag <name>` | Groups the endpoint under a named tag in the UI |
| `@deprecated` | Marks the endpoint as deprecated |
| First JSDoc paragraph | Used as the `summary` if `@summary` is absent |
| Remaining paragraphs | Used as the `description` |

---

## Automatic Type Inference

The analyzer uses the TypeScript compiler to resolve types from your handler signatures and map them directly to OpenAPI schemas.

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

// The return type is inferred → User schema is auto-generated
app.get('/users/:id', (req, res): void => {
  const user: User = { id: 1, name: 'Alice', email: 'alice@example.com', role: 'user' };
  res.json(user);
});
```

Generated schema in the spec:

```json
{
  "User": {
    "type": "object",
    "properties": {
      "id":    { "type": "number" },
      "name":  { "type": "string" },
      "email": { "type": "string" },
      "role":  { "type": "string", "enum": ["admin", "user"] }
    },
    "required": ["id", "name", "email", "role"]
  }
}
```

---

## Advanced: Accessing the Raw Spec

If you need the spec object directly (for testing, export, or custom serving):

```typescript
import { generateSpec, analyzeRoutes } from '@romatech/swagger';

const result = await analyzeRoutes({
  sourcePatterns: ['./src/**/*.ts'],
  tsConfigPath: './tsconfig.json',
});

const spec = generateSpec(result, {
  title: 'My API',
  version: '1.0.0',
});

console.log(JSON.stringify(spec, null, 2));
```

---

## Advanced: Cache Invalidation

The spec is generated once and cached in memory. During development with hot-reload, you can force regeneration:

```typescript
import { invalidateCache } from '@romatech/swagger/middleware';

// Call this after file changes
invalidateCache();
```

---

## How It Works

1. **File scanning** — Resolves all `.ts` files matching your `sourcePatterns`.
2. **AST parsing** — Uses `ts-morph` (TypeScript compiler API) to build a full syntax tree.
3. **Framework detection** — Identifies Express/Fastify/Koa by import statements and usage patterns.
4. **Route extraction** — Finds all `app.get(path, handler)`, `fastify.route({...})`, `router.post(path, handler)` calls.
5. **Type resolution** — Resolves TypeScript types from return types and `res.json()` arguments into OpenAPI schemas.
6. **JSDoc extraction** — Reads `@summary`, `@tag`, `@deprecated` from handler comments.
7. **Spec generation** — Assembles a valid OpenAPI 3.0.3 JSON object.
8. **Serving** — Registers `GET /api-docs.json` and `GET /api-docs` routes on your app.

---

## Multi-Status Response Detection

The analyzer detects all `res.status(N).json()` chains automatically. Every HTTP status code is supported — not just 200 and 404.

```typescript
app.post('/users', (req, res) => {
  if (!req.body.email) {
    return res.status(400).json({ error: 'Email is required', field: 'email' });
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  if (await userExists(req.body.email)) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const user = await createUser(req.body);
  res.status(201).json(user);
});
```

This generates responses for **all 5 status codes** with their respective schemas — no annotations needed.

---

## Roadmap

- [ ] JS support via Babel AST parsing
- [ ] Request body schema inference (Zod, Joi, Yup integration)
- [ ] `@param` JSDoc tag for query/header parameters
- [ ] `@returns {StatusCode}` JSDoc tag for multiple response codes
- [ ] YAML output option
- [ ] CLI: `npx romatech-swagger generate`
- [ ] Watch mode for development

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Build & watch
npm run dev
```

---

## Publishing

```bash
# Login to npm (first time)
npm login --scope=@romatech

# Publish
npm publish
```

The `prepublishOnly` script automatically builds and runs tests before publishing.

---

## License

MIT
