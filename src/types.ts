/**
 * Core type definitions for @romatech/swagger.
 *
 * These types define the internal data structures used throughout the
 * AST analysis pipeline and OpenAPI spec generation.
 */

/**
 * Configuration options for the Swagger generator.
 */
export interface SwaggerConfig {
  /** Title displayed in the Swagger UI header. Defaults to "API Documentation". */
  title?: string;

  /** Short description of the API. */
  description?: string;

  /** API version string. Defaults to "1.0.0". */
  version?: string;

  /** Base path prefix for all routes (e.g., "/api/v1"). */
  basePath?: string;

  /** Path where the OpenAPI JSON spec will be served. Defaults to "/api-docs.json". */
  specPath?: string;

  /** Path where the Swagger UI will be served. Defaults to "/api-docs". */
  uiPath?: string;

  /**
   * Glob patterns pointing to the source files to analyze.
   * Defaults to ["./src/**\/*.ts"].
   */
  sourcePatterns?: string[];

  /**
   * Path to the tsconfig.json file.
   * Used for type resolution. Defaults to "./tsconfig.json".
   */
  tsConfigPath?: string;

  /** Server URLs to include in the spec. */
  servers?: ServerConfig[];

  /** Security scheme definitions. */
  securitySchemes?: Record<string, SecuritySchemeConfig>;

  /** Tags for grouping operations. */
  tags?: TagConfig[];
}

/**
 * Server configuration for the OpenAPI spec.
 */
export interface ServerConfig {
  url: string;
  description?: string;
}

/**
 * Security scheme configuration (Bearer, API Key, etc.).
 */
export interface SecuritySchemeConfig {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: 'header' | 'query' | 'cookie';
  description?: string;
}

/**
 * Tag configuration for grouping endpoints.
 */
export interface TagConfig {
  name: string;
  description?: string;
}

/**
 * Represents a detected route from AST analysis.
 */
export interface RouteInfo {
  /** HTTP method (get, post, put, delete, patch, options, head). */
  method: HttpMethod;

  /** The route path (e.g., "/users/:id"). */
  path: string;

  /** Name of the handler function, if identifiable. */
  handlerName?: string;

  /** File path where the route was found. */
  filePath: string;

  /** Line number in the source file. */
  line: number;

  /** JSDoc description extracted from the handler or route. */
  description?: string;

  /** JSDoc summary (first line of JSDoc). */
  summary?: string;

  /** JSDoc tags like @tag, @deprecated, etc. */
  jsdocTags?: JsDocTag[];

  /** Request parameters (path params, query params, headers). */
  parameters?: ParameterInfo[];

  /** Request body schema. */
  requestBody?: SchemaInfo;

  /** Response schemas by status code. */
  responses?: Record<string, ResponseInfo>;

  /** Tags for grouping this endpoint. */
  tags?: string[];

  /** Whether the endpoint is marked as deprecated. */
  deprecated?: boolean;
}

/**
 * HTTP methods supported by the analyzer.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

/**
 * Represents a route parameter (path, query, header).
 */
export interface ParameterInfo {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: SchemaInfo;
  description?: string;
}

/**
 * Represents a response definition.
 */
export interface ResponseInfo {
  description: string;
  schema?: SchemaInfo;
  headers?: Record<string, SchemaInfo>;
}

/**
 * Represents a resolved TypeScript type as an OpenAPI schema.
 */
export interface SchemaInfo {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaInfo>;
  items?: SchemaInfo;
  required?: string[];
  enum?: (string | number)[];
  description?: string;
  nullable?: boolean;
  oneOf?: SchemaInfo[];
  allOf?: SchemaInfo[];
  $ref?: string;
}

/**
 * JSDoc tag extracted from source code.
 */
export interface JsDocTag {
  name: string;
  value?: string;
}

/**
 * Supported framework types for route detection.
 */
export type FrameworkType = 'express' | 'fastify' | 'koa' | 'unknown';

/**
 * Result of the full analysis pipeline.
 */
export interface AnalysisResult {
  /** All detected routes. */
  routes: RouteInfo[];

  /** Detected framework type. */
  framework: FrameworkType;

  /** Named schemas (interfaces/types) that can be referenced via $ref. */
  schemas: Record<string, SchemaInfo>;

  /** Errors encountered during analysis. */
  errors: AnalysisError[];
}

/**
 * An error encountered during AST analysis.
 */
export interface AnalysisError {
  filePath: string;
  line?: number;
  message: string;
  severity: 'warning' | 'error';
}
