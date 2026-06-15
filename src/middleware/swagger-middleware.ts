/**
 * Swagger Middleware
 *
 * Framework-agnostic middleware registration for:
 *   - useSwagger()    → serves the OpenAPI JSON spec at /api-docs.json
 *   - useSwaggerUi()  → serves the Swagger UI at /api-docs
 *
 * Framework detection is done via duck-typing on the app object:
 *   - Express:  app.get() exists and app is not a Fastify instance
 *   - Fastify:  app.decorate() exists (Fastify-specific)
 *   - Koa:      app.use() exists and app.context exists (Koa-specific)
 */

import * as path from 'path';
import * as fs from 'fs';
import { analyzeRoutes } from '../analyzer';
import { generateSpec } from '../generator';
import { SwaggerConfig, AnalysisResult } from '../types';
import { OpenApiSpec } from '../generator/spec-builder';

// Cache the generated spec so it's only built once per process
let cachedSpec: OpenApiSpec | null = null;
let analysisResult: AnalysisResult | null = null;

/**
 * Registers the OpenAPI JSON spec endpoint on the app.
 *
 * Works with Express, Fastify, and Koa.
 * The spec is generated lazily on first request and cached.
 *
 * @param app - Your framework app instance (Express, Fastify, Koa)
 * @param config - Optional configuration for the Swagger generator
 *
 * @example Express
 * ```typescript
 * import express from 'express';
 * import { useSwagger } from '@romatech/swagger';
 *
 * const app = express();
 * useSwagger(app, { title: 'My API', version: '2.0.0' });
 * ```
 *
 * @example Fastify
 * ```typescript
 * const fastify = Fastify();
 * useSwagger(fastify, { title: 'My API' });
 * ```
 *
 * @example Koa
 * ```typescript
 * const app = new Koa();
 * const router = new Router();
 * useSwagger(router, { title: 'My API' });
 * app.use(router.routes());
 * ```
 */
export function useSwagger(app: unknown, config: SwaggerConfig = {}): void {
  const specPath = config.specPath ?? '/api-docs.json';

  if (isFastify(app)) {
    registerFastifySpec(app, specPath, config);
  } else if (isKoa(app)) {
    registerKoaSpec(app, specPath, config);
  } else if (isExpress(app)) {
    registerExpressSpec(app, specPath, config);
  } else {
    throw new Error(
      '[romatech/swagger] Could not detect framework. ' +
      'Pass an Express app, Fastify instance, or Koa Router.'
    );
  }
}

/**
 * Registers the Swagger UI endpoint on the app.
 *
 * Serves the official Swagger UI (from swagger-ui-dist) with the spec URL
 * pre-configured to point at your spec endpoint.
 *
 * @param app - Your framework app instance
 * @param config - Same config used in useSwagger() — paths must match
 *
 * @example
 * ```typescript
 * useSwagger(app);     // serves spec at /api-docs.json
 * useSwaggerUi(app);   // serves UI at /api-docs
 * ```
 */
export function useSwaggerUi(app: unknown, config: SwaggerConfig = {}): void {
  const uiPath = config.uiPath ?? '/api-docs';
  const specPath = config.specPath ?? '/api-docs.json';

  if (isFastify(app)) {
    registerFastifyUi(app, uiPath, specPath);
  } else if (isKoa(app)) {
    registerKoaUi(app, uiPath, specPath);
  } else if (isExpress(app)) {
    registerExpressUi(app, uiPath, specPath);
  } else {
    throw new Error(
      '[romatech/swagger] Could not detect framework. ' +
      'Pass an Express app, Fastify instance, or Koa Router.'
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: spec generation
// ---------------------------------------------------------------------------

/**
 * Generates or returns the cached OpenAPI spec.
 */
async function getSpec(config: SwaggerConfig): Promise<OpenApiSpec> {
  if (cachedSpec) return cachedSpec;

  analysisResult = await analyzeRoutes(config);
  cachedSpec = generateSpec(analysisResult, config);
  return cachedSpec;
}

/**
 * Invalidates the spec cache. Useful during development with hot-reload.
 */
export function invalidateCache(): void {
  cachedSpec = null;
  analysisResult = null;
}

// ---------------------------------------------------------------------------
// Internal: Express adapter
// ---------------------------------------------------------------------------

function registerExpressSpec(app: any, specPath: string, config: SwaggerConfig): void {
  app.get(specPath, async (req: any, res: any) => {
    try {
      const spec = await getSpec(config);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(spec);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate Swagger spec', message: (err as Error).message });
    }
  });
}

function registerExpressUi(app: any, uiPath: string, specPath: string): void {
  // Serve Swagger UI HTML at uiPath
  app.get(uiPath, (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(buildSwaggerUiHtml(specPath));
  });

  // Serve swagger-ui-dist static assets
  try {
    const swaggerUiDist = require('swagger-ui-dist');
    const distPath = swaggerUiDist.getAbsoluteFSPath();
    const expressStatic = require('express').static;
    app.use(`${uiPath}-assets`, expressStatic(distPath));
  } catch {
    // swagger-ui-dist not available — use CDN fallback (handled in HTML template)
  }
}

// ---------------------------------------------------------------------------
// Internal: Fastify adapter
// ---------------------------------------------------------------------------

function registerFastifySpec(app: any, specPath: string, config: SwaggerConfig): void {
  app.get(specPath, async (_req: any, reply: any) => {
    try {
      const spec = await getSpec(config);
      reply.header('Content-Type', 'application/json');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.send(spec);
    } catch (err) {
      reply.status(500).send({ error: 'Failed to generate Swagger spec', message: (err as Error).message });
    }
  });
}

function registerFastifyUi(app: any, uiPath: string, specPath: string): void {
  app.get(uiPath, (_req: any, reply: any) => {
    reply.header('Content-Type', 'text/html');
    reply.send(buildSwaggerUiHtml(specPath));
  });
}

// ---------------------------------------------------------------------------
// Internal: Koa adapter
// ---------------------------------------------------------------------------

function registerKoaSpec(router: any, specPath: string, config: SwaggerConfig): void {
  router.get(specPath, async (ctx: any) => {
    try {
      const spec = await getSpec(config);
      ctx.set('Content-Type', 'application/json');
      ctx.set('Access-Control-Allow-Origin', '*');
      ctx.body = spec;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { error: 'Failed to generate Swagger spec', message: (err as Error).message };
    }
  });
}

function registerKoaUi(router: any, uiPath: string, specPath: string): void {
  router.get(uiPath, (ctx: any) => {
    ctx.set('Content-Type', 'text/html');
    ctx.body = buildSwaggerUiHtml(specPath);
  });
}

// ---------------------------------------------------------------------------
// Internal: Framework detection (duck-typing)
// ---------------------------------------------------------------------------

/**
 * Detects a Fastify instance by looking for Fastify-specific methods.
 */
function isFastify(app: unknown): boolean {
  return (
    typeof app === 'object' &&
    app !== null &&
    typeof (app as any).decorate === 'function' &&
    typeof (app as any).register === 'function' &&
    typeof (app as any).addHook === 'function'
  );
}

/**
 * Detects a Koa Router instance by looking for Koa-specific properties.
 * Supports both koa-router and @koa/router.
 */
function isKoa(app: unknown): boolean {
  return (
    typeof app === 'object' &&
    app !== null &&
    typeof (app as any).routes === 'function' &&
    typeof (app as any).allowedMethods === 'function'
  );
}

/**
 * Detects an Express app or Router by looking for Express-specific methods.
 * Called last since Express and Koa both have .use() and .get().
 */
function isExpress(app: unknown): boolean {
  return (
    typeof app === 'object' &&
    app !== null &&
    typeof (app as any).get === 'function' &&
    typeof (app as any).use === 'function' &&
    typeof (app as any).listen === 'function'
  );
}

// ---------------------------------------------------------------------------
// Internal: HTML template
// ---------------------------------------------------------------------------

/**
 * Builds the Swagger UI HTML page with the spec URL pre-configured.
 * Uses swagger-ui-dist assets when available, falls back to the official CDN.
 */
function buildSwaggerUiHtml(specPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>API Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = function () {
        SwaggerUIBundle({
          url: "${specPath}",
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'StandaloneLayout',
          deepLinking: true,
          showExtensions: true,
          showCommonExtensions: true,
        });
      };
    </script>
  </body>
</html>`;
}
