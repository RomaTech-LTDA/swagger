/**
 * @romatech/swagger
 *
 * Zero-config Swagger/OpenAPI generator for Node.js.
 * Uses TypeScript AST analysis to automatically map routes and generate
 * OpenAPI documentation without any decorators or annotations.
 *
 * Supports: Express, Fastify, Koa (and more via custom adapters).
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { useSwagger, useSwaggerUi } from '@romatech/swagger';
 *
 * const app = express();
 *
 * app.get('/users', (req, res) => { ... });
 * app.post('/users', (req, res) => { ... });
 *
 * useSwagger(app);     // Serves OpenAPI JSON at /api-docs.json
 * useSwaggerUi(app);   // Serves Swagger UI at /api-docs
 *
 * app.listen(3000);
 * ```
 */

export { useSwagger, useSwaggerUi } from './middleware';
export { SwaggerConfig } from './types';
export { generateSpec } from './generator';
export { analyzeRoutes } from './analyzer';
