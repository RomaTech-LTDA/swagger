/**
 * Response Extractor
 *
 * Extracts response schemas from route handler functions using a multi-strategy approach.
 * Each strategy is tried in order of reliability; the first one that returns a useful
 * schema wins.
 *
 * Strategy priority (highest to lowest):
 *
 *  1. Explicit return type annotation
 *     `(req, res): User => { ... }`
 *     `async (req, res): Promise<User[]> => { ... }`
 *
 *  2. res.json() / res.send() / reply.send() argument type
 *     `res.json(users)` → infers type of `users`
 *     Works with variables, function calls, and inline objects.
 *
 *  3. ctx.body assignment (Koa)
 *     `ctx.body = users` → infers type of `users`
 *
 *  4. res.status(N).json() chains for multi-status responses
 *     `res.status(404).json({ error: 'Not found' })` → captures 404 response
 *
 *  5. return statement type (for Fastify async handlers that return directly)
 *     `return { id: 1, name: 'Alice' }` → infers inline object type
 *
 * For strategies 2–5, the TypeScript compiler resolves the actual type of each
 * argument/value, so even inline object literals get their full shape extracted.
 */

import {
  Node,
  SyntaxKind,
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  CallExpression,
  BinaryExpression,
  ReturnStatement,
} from 'ts-morph';
import { ResponseInfo, SchemaInfo } from '../types';
import { resolveType } from './type-resolver';

/** A handler function node — all three variants we support. */
type HandlerNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Extracted response map: status code → ResponseInfo.
 * The key is a string like "200", "404", or "default".
 */
export type ResponseMap = Record<string, ResponseInfo>;

/**
 * Extracts all response definitions from a handler function.
 *
 * Returns a map of HTTP status codes to response schemas.
 * If multiple status codes are detected, all are returned.
 * Falls back to { "200": { description: "Successful response" } } if nothing is found.
 *
 * @param handler - The handler function node to analyze
 * @param schemas - Shared schema registry for $ref resolution
 * @returns A map of status codes to response info objects
 */
export function extractResponses(
  handler: HandlerNode,
  schemas: Record<string, SchemaInfo>
): ResponseMap {
  // Strategy 1 — explicit return type annotation
  const fromReturnType = tryFromReturnType(handler, schemas);
  if (fromReturnType) {
    return { '200': { description: 'Successful response', schema: fromReturnType } };
  }

  // Strategy 2, 3, 4 — scan the function body
  const fromBody = extractFromBody(handler, schemas);
  if (Object.keys(fromBody).length > 0) {
    return fromBody;
  }

  // Strategy 5 — last resort: return statement type for Fastify-style async handlers
  const fromReturn = tryFromReturnStatements(handler, schemas);
  if (fromReturn) {
    return { '200': { description: 'Successful response', schema: fromReturn } };
  }

  // Default fallback
  return { '200': { description: 'Successful response' } };
}

// ---------------------------------------------------------------------------
// Strategy 1: Explicit return type annotation
// ---------------------------------------------------------------------------

/**
 * Reads the declared return type of the handler function.
 * Unwraps Promise<T> automatically.
 * Skips void, any, and bare "object" types (not useful for a schema).
 */
function tryFromReturnType(
  handler: HandlerNode,
  schemas: Record<string, SchemaInfo>
): SchemaInfo | null {
  const returnType = handler.getReturnType();

  if (!returnType) return null;
  if (returnType.isAny() || returnType.isUnknown() || returnType.isVoid() || returnType.isNever()) return null;

  // Unwrap Promise<T>
  const unwrapped = unwrapPromise(returnType);
  if (!unwrapped) return null;
  if (unwrapped.isAny() || unwrapped.isUnknown() || unwrapped.isVoid() || unwrapped.isNever()) return null;

  // Unwrap Response / void combinations common in Express:
  // Return type is often `void` or `Response` — not useful
  const typeName = unwrapped.getSymbol()?.getName() ?? '';
  if (typeName === 'Response' || typeName === 'ServerResponse') return null;

  const schema = resolveType(unwrapped, schemas);

  // Only accept if we got something specific
  if (isUsefulSchema(schema)) {
    return schema;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strategy 2 + 3 + 4: Body scanning
// ---------------------------------------------------------------------------

/**
 * Scans the handler body for:
 *  - res.json(value), res.send(value), reply.send(value)  → Express / Fastify
 *  - ctx.body = value                                      → Koa
 *  - res.status(N).json(value)                             → Express multi-status
 *
 * Collects all unique status codes and schemas found.
 */
function extractFromBody(
  handler: HandlerNode,
  schemas: Record<string, SchemaInfo>
): ResponseMap {
  const responses: ResponseMap = {};

  // --- 2 + 4: res.json / res.send / reply.send call expressions ---
  const callExprs = handler.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExprs) {
    const result = tryExtractFromCall(call, schemas);
    if (!result) continue;

    const { statusCode, schema } = result;
    const key = String(statusCode);

    // If we already have a schema for this status, keep the more specific one
    if (!responses[key] || (schema && !responses[key].schema)) {
      responses[key] = {
        description: descriptionForStatus(statusCode),
        schema: schema ?? undefined,
      };
    }
  }

  // --- 3: ctx.body = value (Koa) ---
  const assignments = handler.getDescendantsOfKind(SyntaxKind.BinaryExpression);
  for (const assignment of assignments) {
    const result = tryExtractFromCtxBody(assignment, schemas);
    if (!result) continue;

    if (!responses['200']) {
      responses['200'] = {
        description: 'Successful response',
        schema: result ?? undefined,
      };
    }
  }

  return responses;
}

/**
 * Tries to extract a response from a single call expression.
 *
 * Handles these patterns:
 *   res.json(value)                     → status 200
 *   res.send(value)                     → status 200
 *   reply.send(value)                   → status 200 (Fastify)
 *   res.status(404).json(value)         → status 404
 *   res.status(404).send(value)         → status 404
 *   ctx.json(value)                     → status 200 (some Koa libs)
 */
function tryExtractFromCall(
  call: CallExpression,
  schemas: Record<string, SchemaInfo>
): { statusCode: number; schema: SchemaInfo | null } | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.getName();

  // Only care about .json() and .send()
  if (methodName !== 'json' && methodName !== 'send') return null;

  const callee = expr.getExpression();

  // Chained: res.status(N).json(value) — callee is a CallExpression (res.status(N))
  if (Node.isCallExpression(callee)) {
    const statusCode = extractStatusCode(callee);
    if (statusCode !== null) {
      const args = call.getArguments();
      const schema = args.length > 0 ? resolveArgSchema(args[0], schemas) : null;
      return { statusCode, schema };
    }
  }

  // Direct: res.json(value) or reply.send(value)
  const args = call.getArguments();
  const schema = args.length > 0 ? resolveArgSchema(args[0], schemas) : null;
  return { statusCode: 200, schema };
}

/**
 * Tries to extract a response from a `ctx.body = value` binary expression (Koa).
 */
function tryExtractFromCtxBody(
  assignment: BinaryExpression,
  schemas: Record<string, SchemaInfo>
): SchemaInfo | null {
  // Must be an assignment: left = right
  if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return null;

  const left = assignment.getLeft();

  // Must be ctx.body
  if (!Node.isPropertyAccessExpression(left)) return null;
  if (left.getName() !== 'body') return null;

  const obj = left.getExpression();
  // The object must be named 'ctx' or 'context'
  if (!Node.isIdentifier(obj)) return null;
  const objName = obj.getText();
  if (objName !== 'ctx' && objName !== 'context') return null;

  const right = assignment.getRight();
  return resolveArgSchema(right, schemas);
}

// ---------------------------------------------------------------------------
// Strategy 5: return statement type inference
// ---------------------------------------------------------------------------

/**
 * Looks for `return <value>` statements in the handler and infers the type.
 * Useful for Fastify async handlers that return the response directly:
 *
 *   fastify.get('/users', async () => {
 *     return [{ id: 1, name: 'Alice' }];
 *   });
 */
function tryFromReturnStatements(
  handler: HandlerNode,
  schemas: Record<string, SchemaInfo>
): SchemaInfo | null {
  const returnStatements = handler.getDescendantsOfKind(SyntaxKind.ReturnStatement);

  for (const ret of returnStatements) {
    const expr = ret.getExpression();
    if (!expr) continue;

    // Skip: return res.json(...) — already handled
    if (Node.isCallExpression(expr)) {
      const callExpr = expr.getExpression();
      if (Node.isPropertyAccessExpression(callExpr)) {
        const name = callExpr.getName();
        if (name === 'json' || name === 'send' || name === 'status') continue;
      }
    }

    const schema = resolveArgSchema(expr, schemas);
    if (schema && isUsefulSchema(schema)) {
      return schema;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the schema from a Node by getting its TypeScript type.
 * This is the key function that makes inline objects work:
 * The TS compiler knows the full shape of `{ id: 1, name: 'Alice' }`.
 */
function resolveArgSchema(node: Node, schemas: Record<string, SchemaInfo>): SchemaInfo | null {
  try {
    const type = node.getType();
    if (!type || type.isAny() || type.isUnknown()) return null;

    const schema = resolveType(type, schemas);
    return isUsefulSchema(schema) ? schema : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the numeric status code from a `res.status(N)` call expression.
 */
function extractStatusCode(call: CallExpression): number | null {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  if (expr.getName() !== 'status') return null;

  const args = call.getArguments();
  if (args.length === 0) return null;

  const arg = args[0];
  if (Node.isNumericLiteral(arg)) {
    return parseInt(arg.getLiteralText(), 10);
  }

  return null;
}

/**
 * Returns a human-readable description for common HTTP status codes.
 */
function descriptionForStatus(statusCode: number): string {
  const descriptions: Record<number, string> = {
    200: 'Successful response',
    201: 'Resource created',
    204: 'No content',
    400: 'Bad request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not found',
    409: 'Conflict',
    422: 'Unprocessable entity',
    500: 'Internal server error',
  };
  return descriptions[statusCode] ?? `HTTP ${statusCode}`;
}

/**
 * Checks if a resolved schema is specific enough to be worth including.
 * Filters out bare `{ type: 'object' }` without properties (not useful).
 */
function isUsefulSchema(schema: SchemaInfo): boolean {
  if (!schema) return false;

  // A $ref is always useful
  if (schema.$ref) return true;

  // An array is always useful (even if items are generic)
  if (schema.type === 'array') return true;

  // Primitives are useful
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'boolean' || schema.type === 'integer') return true;

  // An object with properties is useful
  if (schema.type === 'object' && schema.properties && Object.keys(schema.properties).length > 0) return true;

  // oneOf / allOf are useful
  if (schema.oneOf && schema.oneOf.length > 0) return true;
  if (schema.allOf && schema.allOf.length > 0) return true;

  return false;
}

/**
 * Unwraps a Promise<T> type, returning T.
 * Returns null if the type is not a Promise or has no type argument.
 */
function unwrapPromise(type: import('ts-morph').Type): import('ts-morph').Type | null {
  const symbol = type.getSymbol();
  if (symbol?.getName() !== 'Promise') return type; // not a Promise, return as-is

  const args = type.getTypeArguments();
  if (args.length === 0) return null;

  return args[0];
}
