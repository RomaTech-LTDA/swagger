/**
 * Route Analyzer
 *
 * The core of the AST analysis pipeline.
 * Uses ts-morph to parse TypeScript source files and extract route definitions
 * from Express, Fastify, and Koa without requiring any modifications to user code.
 *
 * Detection strategy per framework:
 *
 * Express:
 *   - app.get('/path', handler)
 *   - app.post('/path', handler)
 *   - router.get('/path', handler)
 *   - app.route('/path').get(handler)
 *
 * Fastify:
 *   - fastify.get('/path', handler)
 *   - fastify.route({ method: 'GET', url: '/path', handler })
 *
 * Koa:
 *   - router.get('/path', handler)
 *   - router.post('/path', handler)
 */

import {
  Project,
  SourceFile,
  CallExpression,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
} from 'ts-morph';
import { glob } from 'glob';
import { AnalysisResult, AnalysisError, RouteInfo, HttpMethod, ParameterInfo, SchemaInfo } from '../types';
import { detectFramework } from './framework-detector';
import { extractJsDoc } from './jsdoc-extractor';
import { extractResponses } from './response-extractor';
import { SwaggerConfig } from '../types';

/** HTTP methods we look for as method calls on route objects. */
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

/**
 * Analyzes TypeScript source files and extracts all route definitions.
 *
 * @param config - Swagger configuration with source patterns and tsconfig path
 * @returns Full analysis result including routes, schemas, and any errors
 */
export async function analyzeRoutes(config: SwaggerConfig): Promise<AnalysisResult> {
  const errors: AnalysisError[] = [];
  const schemas: Record<string, SchemaInfo> = {};
  const allRoutes: RouteInfo[] = [];

  // --- Setup the TypeScript project ---
  const tsConfigPath = config.tsConfigPath ?? './tsconfig.json';
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: false,
  });

  // --- Resolve source files ---
  const patterns = config.sourcePatterns ?? ['./src/**/*.ts'];
  const files: string[] = [];

  for (const pattern of patterns) {
    const matched = await glob(pattern, { absolute: true, ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'] });
    files.push(...matched);
  }

  if (files.length === 0) {
    errors.push({
      filePath: '',
      message: `No source files matched the patterns: ${patterns.join(', ')}`,
      severity: 'warning',
    });
    return { routes: [], framework: 'unknown', schemas, errors };
  }

  // Add files to the ts-morph project for type-aware analysis
  for (const file of files) {
    project.addSourceFileAtPathIfExists(file);
  }

  // --- Analyze each file ---
  const sourceFiles = project.getSourceFiles();
  let detectedFramework = 'unknown' as ReturnType<typeof detectFramework>;

  for (const sourceFile of sourceFiles) {
    // Skip declaration files
    if (sourceFile.isDeclarationFile()) continue;

    try {
      // Detect framework from this file
      const fw = detectFramework(sourceFile);
      if (fw !== 'unknown') {
        detectedFramework = fw;
      }

      const routes = extractRoutesFromFile(sourceFile, schemas, errors);
      allRoutes.push(...routes);
    } catch (err) {
      errors.push({
        filePath: sourceFile.getFilePath(),
        message: `Failed to analyze file: ${(err as Error).message}`,
        severity: 'error',
      });
    }
  }

  // Deduplicate routes (same method + path from multiple files)
  const uniqueRoutes = deduplicateRoutes(allRoutes);

  // Sort routes for consistent output
  uniqueRoutes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  return {
    routes: uniqueRoutes,
    framework: detectedFramework,
    schemas,
    errors,
  };
}

/**
 * Extracts all route definitions from a single source file.
 */
function extractRoutesFromFile(
  sourceFile: SourceFile,
  schemas: Record<string, SchemaInfo>,
  errors: AnalysisError[]
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const filePath = sourceFile.getFilePath();

  // Find all call expressions (e.g., app.get(...), router.post(...))
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpr of callExpressions) {
    try {
      const route = tryExtractRoute(callExpr, schemas, filePath);
      if (route) {
        routes.push(route);
      }
    } catch (err) {
      errors.push({
        filePath,
        line: callExpr.getStartLineNumber(),
        message: `Failed to extract route: ${(err as Error).message}`,
        severity: 'warning',
      });
    }
  }

  return routes;
}

/**
 * Attempts to extract a route definition from a call expression.
 * Returns null if the call expression is not a route definition.
 */
function tryExtractRoute(
  callExpr: CallExpression,
  schemas: Record<string, SchemaInfo>,
  filePath: string
): RouteInfo | null {
  const expr = callExpr.getExpression();

  // Must be a property access expression: something.method(...)
  if (!Node.isPropertyAccessExpression(expr)) {
    return null;
  }

  const methodName = expr.getName().toLowerCase();

  // --- Express / Koa / Fastify shorthand: app.get(path, handler) ---
  if (HTTP_METHODS.includes(methodName as HttpMethod)) {
    return extractShorthandRoute(callExpr, methodName as HttpMethod, schemas, filePath);
  }

  // --- Fastify: fastify.route({ method, url, handler }) ---
  if (methodName === 'route') {
    return extractFastifyRoute(callExpr, schemas, filePath);
  }

  return null;
}

/**
 * Extracts a route from shorthand call: app.get('/path', handler)
 */
function extractShorthandRoute(
  callExpr: CallExpression,
  method: HttpMethod,
  schemas: Record<string, SchemaInfo>,
  filePath: string
): RouteInfo | null {
  const args = callExpr.getArguments();

  // Must have at least 2 args: path and handler
  if (args.length < 2) return null;

  const firstArg = args[0];

  // First argument must be a string literal (the route path)
  if (!Node.isStringLiteral(firstArg) && !Node.isNoSubstitutionTemplateLiteral(firstArg)) {
    return null;
  }

  const routePath = normalizePath(firstArg.getLiteralText());

  // Find the handler (last argument that is a function)
  const handler = findHandlerArg(args);

  const route: RouteInfo = {
    method,
    path: routePath,
    filePath,
    line: callExpr.getStartLineNumber(),
  };

  if (handler) {
    // Extract JSDoc from the handler
    const jsdoc = extractJsDoc(handler);
    route.summary = jsdoc.summary;
    route.description = jsdoc.description;
    route.deprecated = jsdoc.deprecated;
    route.tags = jsdoc.tags.filter(t => t.name === 'tag').map(t => t.value!).filter(Boolean);
    route.jsdocTags = jsdoc.tags;

    // Try to extract handler function name
    const handlerName = getHandlerName(handler);
    if (handlerName) route.handlerName = handlerName;

    // Extract response schemas using the multi-strategy extractor
    route.responses = extractResponses(handler, schemas);
  }

  // Extract path parameters from the route pattern (e.g., /users/:id → id)
  route.parameters = extractPathParameters(routePath);

  // Default 200 response if none resolved
  if (!route.responses) {
    route.responses = {
      '200': { description: 'Successful response' },
    };
  }

  return route;
}

/**
 * Extracts a route from Fastify's object notation: fastify.route({ method, url, handler })
 */
function extractFastifyRoute(
  callExpr: CallExpression,
  schemas: Record<string, SchemaInfo>,
  filePath: string
): RouteInfo | null {
  const args = callExpr.getArguments();
  if (args.length < 1) return null;

  const optionsArg = args[0];
  if (!Node.isObjectLiteralExpression(optionsArg)) return null;

  let method: HttpMethod | undefined;
  let routePath: string | undefined;
  let handler: FunctionDeclaration | ArrowFunction | FunctionExpression | null = null;

  for (const prop of optionsArg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const key = prop.getName();
    const value = prop.getInitializer();
    if (!value) continue;

    if (key === 'method' && Node.isStringLiteral(value)) {
      method = value.getLiteralText().toLowerCase() as HttpMethod;
    }

    if ((key === 'url' || key === 'path') && Node.isStringLiteral(value)) {
      routePath = normalizePath(value.getLiteralText());
    }

    if (key === 'handler') {
      if (Node.isArrowFunction(value)) handler = value as ArrowFunction;
      else if (Node.isFunctionExpression(value)) handler = value as FunctionExpression;
      else if (Node.isIdentifier(value)) handler = resolveIdentifierToFunction(value);
    }
  }

  if (!method || !routePath) return null;
  if (!HTTP_METHODS.includes(method)) return null;

  const route: RouteInfo = {
    method,
    path: routePath,
    filePath,
    line: callExpr.getStartLineNumber(),
    parameters: extractPathParameters(routePath),
  };

  if (handler) {
    const jsdoc = extractJsDoc(handler);
    route.summary = jsdoc.summary;
    route.description = jsdoc.description;
    route.deprecated = jsdoc.deprecated;
    route.tags = jsdoc.tags.filter(t => t.name === 'tag').map(t => t.value!).filter(Boolean);
    route.responses = extractResponses(handler, schemas);
  } else {
    route.responses = { '200': { description: 'Successful response' } };
  }

  return route;
}

/**
 * Finds the handler function argument from a list of call arguments.
 *
 * Supports:
 *  - Inline arrow functions:     app.get('/path', (req, res) => { ... })
 *  - Inline function expressions: app.get('/path', function(req, res) { ... })
 *  - Identifier references:       app.get('/path', listUsers)
 *    In this case, we follow the reference and find the actual function declaration.
 */
function findHandlerArg(
  args: Node[]
): FunctionDeclaration | ArrowFunction | FunctionExpression | null {
  // Walk backwards — handler is typically the last argument
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];

    // Direct inline function
    if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
      return arg as ArrowFunction | FunctionExpression;
    }

    // Identifier reference — follow it to the declaration
    if (Node.isIdentifier(arg)) {
      const resolved = resolveIdentifierToFunction(arg);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Follows an identifier reference to find the actual function declaration.
 *
 * Handles:
 *  - `const listUsers = (req, res) => { ... }`  → returns the ArrowFunction
 *  - `function listUsers(req, res) { ... }`     → returns the FunctionDeclaration
 *  - `const listUsers = async function(...) {}` → returns the FunctionExpression
 */
function resolveIdentifierToFunction(
  identifier: Node
): FunctionDeclaration | ArrowFunction | FunctionExpression | null {
  const symbol = identifier.getSymbol();
  if (!symbol) return null;

  const declarations = symbol.getDeclarations();
  for (const decl of declarations) {
    // Direct function declaration: function listUsers(...) {}
    if (Node.isFunctionDeclaration(decl)) {
      return decl as FunctionDeclaration;
    }

    // Variable declaration: const listUsers = ...
    if (Node.isVariableDeclaration(decl)) {
      const initializer = decl.getInitializer();
      if (!initializer) continue;

      if (Node.isArrowFunction(initializer)) return initializer as ArrowFunction;
      if (Node.isFunctionExpression(initializer)) return initializer as FunctionExpression;
    }
  }

  return null;
}

/**
 * Attempts to get a meaningful name for a handler function.
 */
function getHandlerName(
  handler: FunctionDeclaration | ArrowFunction | FunctionExpression
): string | undefined {
  if (Node.isFunctionDeclaration(handler) || Node.isFunctionExpression(handler)) {
    const name = (handler as FunctionDeclaration | FunctionExpression).getName();
    if (name) return name;
  }

  // Arrow function might be assigned to a variable: const getUser = (req, res) => {}
  const parent = handler.getParent();
  if (Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }

  return undefined;
}

/**
 * Extracts path parameters from an Express/Koa-style route path.
 *
 * @example
 * extractPathParameters('/users/:id/posts/:postId')
 * // Returns: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, ...]
 */
function extractPathParameters(routePath: string): ParameterInfo[] {
  const params: ParameterInfo[] = [];
  // Match :paramName and {paramName} patterns
  const patterns = [/:([a-zA-Z_][a-zA-Z0-9_]*)/g, /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(routePath)) !== null) {
      const name = match[1];
      // Avoid duplicates
      if (!params.find(p => p.name === name)) {
        params.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
      }
    }
  }

  return params;
}

/**
 * Normalizes a route path to OpenAPI format.
 * Converts Express :param syntax to OpenAPI {param} syntax.
 *
 * @example
 * normalizePath('/users/:id') // → '/users/{id}'
 */
function normalizePath(routePath: string): string {
  return routePath.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/**
 * Removes duplicate routes (same method + path combination).
 * Keeps the one with the most information (description, response types, etc.).
 */
function deduplicateRoutes(routes: RouteInfo[]): RouteInfo[] {
  const seen = new Map<string, RouteInfo>();

  for (const route of routes) {
    const key = `${route.method}:${route.path}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, route);
      continue;
    }

    // Prefer the route with more information
    const existingScore = scoreRoute(existing);
    const currentScore = scoreRoute(route);

    if (currentScore > existingScore) {
      seen.set(key, route);
    }
  }

  return Array.from(seen.values());
}

/**
 * Scores a route by how much information it contains.
 * Used for deduplication preference.
 */
function scoreRoute(route: RouteInfo): number {
  let score = 0;
  if (route.summary) score += 2;
  if (route.description) score += 1;
  if (route.responses && Object.values(route.responses).some(r => r.schema)) score += 3;
  if (route.parameters && route.parameters.length > 0) score += 1;
  if (route.tags && route.tags.length > 0) score += 1;
  return score;
}
