/**
 * OpenAPI Spec Builder
 *
 * Converts the route analysis result into a valid OpenAPI 3.0 specification.
 * The output is a plain JavaScript object compatible with the OpenAPI 3.0.x schema
 * and ready to be serialized as JSON or YAML.
 *
 * @see https://swagger.io/specification/
 */

import { AnalysisResult, RouteInfo, ParameterInfo, SchemaInfo, SwaggerConfig } from '../types';

/** OpenAPI 3.0 specification root object. */
export interface OpenApiSpec {
  openapi: '3.0.3';
  info: {
    title: string;
    description?: string;
    version: string;
  };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, unknown>;
  };
}

/** An individual path item in the OpenAPI spec. */
type PathItem = Partial<Record<string, Operation>>;

/** An OpenAPI operation object. */
interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

interface ParameterObject {
  name: string;
  in: string;
  required: boolean;
  schema: SchemaObject;
  description?: string;
}

interface RequestBodyObject {
  required: boolean;
  content: {
    'application/json': {
      schema: SchemaObject;
    };
  };
}

interface ResponseObject {
  description: string;
  content?: {
    'application/json': {
      schema: SchemaObject;
    };
  };
}

/** OpenAPI Schema Object (subset used by this generator). */
type SchemaObject = Record<string, unknown>;

/**
 * Generates an OpenAPI 3.0 specification object from the analysis result.
 *
 * @param result - The route analysis result containing all detected routes and schemas
 * @param config - Swagger configuration options
 * @returns A complete OpenAPI 3.0 specification object
 */
export function generateSpec(result: AnalysisResult, config: SwaggerConfig): OpenApiSpec {
  const spec: OpenApiSpec = {
    openapi: '3.0.3',
    info: {
      title: config.title ?? 'API Documentation',
      description: config.description,
      version: config.version ?? '1.0.0',
    },
    paths: {},
  };

  // Add servers
  if (config.servers && config.servers.length > 0) {
    spec.servers = config.servers;
  }

  // Add global tags
  if (config.tags && config.tags.length > 0) {
    spec.tags = config.tags;
  }

  // Build paths from routes
  for (const route of result.routes) {
    const openApiPath = ensurePath(route.path, config.basePath);

    if (!spec.paths[openApiPath]) {
      spec.paths[openApiPath] = {};
    }

    spec.paths[openApiPath][route.method] = buildOperation(route);
  }

  // Add component schemas ($ref targets)
  if (Object.keys(result.schemas).length > 0) {
    spec.components = {
      schemas: Object.fromEntries(
        Object.entries(result.schemas).map(([name, schema]) => [name, schemaToObject(schema)])
      ),
    };
  }

  // Add security schemes from config
  if (config.securitySchemes && Object.keys(config.securitySchemes).length > 0) {
    spec.components = spec.components ?? {};
    spec.components.securitySchemes = config.securitySchemes as Record<string, unknown>;
  }

  return spec;
}

/**
 * Builds an OpenAPI Operation object from a RouteInfo.
 */
function buildOperation(route: RouteInfo): Operation {
  const operation: Operation = {
    responses: {},
  };

  // Operation metadata
  if (route.summary) operation.summary = route.summary;
  if (route.description) operation.description = route.description;
  if (route.deprecated) operation.deprecated = true;
  if (route.tags && route.tags.length > 0) operation.tags = route.tags;

  // Generate a stable operationId from method + path
  operation.operationId = buildOperationId(route);

  // Parameters
  if (route.parameters && route.parameters.length > 0) {
    operation.parameters = route.parameters.map(buildParameter);
  }

  // Request body (for POST, PUT, PATCH)
  if (route.requestBody && ['post', 'put', 'patch'].includes(route.method)) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: schemaToObject(route.requestBody),
        },
      },
    };
  }

  // Responses
  if (route.responses && Object.keys(route.responses).length > 0) {
    for (const [statusCode, response] of Object.entries(route.responses)) {
      const responseObj: ResponseObject = {
        description: response.description,
      };

      if (response.schema) {
        responseObj.content = {
          'application/json': {
            schema: schemaToObject(response.schema),
          },
        };
      }

      operation.responses[statusCode] = responseObj;
    }
  } else {
    // Default response
    operation.responses['200'] = { description: 'Successful response' };
  }

  return operation;
}

/**
 * Builds an OpenAPI Parameter object from a ParameterInfo.
 */
function buildParameter(param: ParameterInfo): ParameterObject {
  return {
    name: param.name,
    in: param.in,
    required: param.required,
    schema: schemaToObject(param.schema),
    description: param.description,
  };
}

/**
 * Converts a SchemaInfo to a plain OpenAPI SchemaObject.
 * SchemaInfo may contain nested SchemaInfo objects, which are converted recursively.
 */
function schemaToObject(schema: SchemaInfo): SchemaObject {
  const obj: SchemaObject = {};

  if (schema.$ref) {
    return { $ref: schema.$ref };
  }

  if (schema.type) obj['type'] = schema.type;
  if (schema.format) obj['format'] = schema.format;
  if (schema.description) obj['description'] = schema.description;
  if (schema.nullable) obj['nullable'] = schema.nullable;
  if (schema.enum) obj['enum'] = schema.enum;

  if (schema.properties) {
    obj['properties'] = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, schemaToObject(v)])
    );
  }

  if (schema.required) obj['required'] = schema.required;
  if (schema.items) obj['items'] = schemaToObject(schema.items);

  if (schema.oneOf) obj['oneOf'] = schema.oneOf.map(schemaToObject);
  if (schema.allOf) obj['allOf'] = schema.allOf.map(schemaToObject);

  return obj;
}

/**
 * Generates a camelCase operationId from a method and path.
 *
 * @example
 * buildOperationId({ method: 'get', path: '/users/{id}' })
 * // → 'getUsersById'
 */
function buildOperationId(route: RouteInfo): string {
  const segments = route.path
    .split('/')
    .filter(Boolean)
    .map(segment => {
      // Convert {id} → ById, {userId} → ByUserId
      if (segment.startsWith('{') && segment.endsWith('}')) {
        const name = segment.slice(1, -1);
        return `By${capitalize(name)}`;
      }
      return capitalize(segment);
    });

  return `${route.method}${segments.join('')}` || route.method;
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Ensures the path starts with / and applies the optional base path prefix.
 */
function ensurePath(routePath: string, basePath?: string): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (!basePath) return normalized;
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}${normalized}`;
}
