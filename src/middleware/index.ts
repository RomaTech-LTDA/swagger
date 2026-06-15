/**
 * Middleware Entry Point
 *
 * Exports the two public-facing functions:
 *   - useSwagger()    → serves the OpenAPI JSON spec
 *   - useSwaggerUi()  → serves the Swagger UI HTML interface
 *
 * These functions auto-detect the framework (Express, Fastify, Koa)
 * and register the appropriate middleware/routes.
 */

export { useSwagger, useSwaggerUi } from './swagger-middleware';
