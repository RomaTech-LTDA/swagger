/**
 * Tests for the response extraction pipeline.
 *
 * Each test creates an in-memory TypeScript project with a specific handler pattern,
 * runs the response extractor, and asserts that the correct schemas were generated.
 */

import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { extractResponses } from '../src/analyzer/response-extractor';
import { SchemaInfo } from '../src/types';

/**
 * Helper: creates a ts-morph project with a single in-memory source file,
 * finds the first arrow/function expression, and runs extractResponses on it.
 */
function extractFromCode(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', code);

  const schemas: Record<string, SchemaInfo> = {};

  const handler =
    sf.getFirstDescendantByKind(SyntaxKind.ArrowFunction) ??
    sf.getFirstDescendantByKind(SyntaxKind.FunctionExpression) ??
    sf.getFirstDescendantByKind(SyntaxKind.FunctionDeclaration);

  if (!handler) throw new Error('No handler found in test code');

  return { responses: extractResponses(handler as any, schemas), schemas };
}

// ===========================================================================
// Strategy 1: Explicit return type annotation
// ===========================================================================
describe('Strategy 1 – explicit return type', () => {
  it('resolves a named interface return type', () => {
    const { responses, schemas } = extractFromCode(`
      interface User { id: number; name: string; }
      const handler = (req: any, res: any): User => {
        return { id: 1, name: 'Alice' };
      };
    `);

    expect(responses['200']).toBeDefined();
    expect(responses['200'].schema?.$ref).toBe('#/components/schemas/User');
    expect(schemas['User']).toBeDefined();
    expect(schemas['User'].properties?.id?.type).toBe('number');
    expect(schemas['User'].properties?.name?.type).toBe('string');
  });

  it('unwraps Promise<T> from async handlers', () => {
    const { responses } = extractFromCode(`
      interface Product { id: number; price: number; }
      const handler = async (req: any, res: any): Promise<Product[]> => {
        return [];
      };
    `);

    expect(responses['200']).toBeDefined();
    expect(responses['200'].schema?.type).toBe('array');
  });

  it('resolves a type alias return type (inlined structurally)', () => {
    const { responses } = extractFromCode(`
      type PaginatedResult = { items: string[]; total: number; page: number; };
      const handler = (req: any, res: any): PaginatedResult => {
        return { items: [], total: 0, page: 1 };
      };
    `);

    // Type aliases are resolved structurally (not as $ref like interfaces)
    const schema = responses['200'].schema;
    expect(schema?.type).toBe('object');
    expect(schema?.properties?.total?.type).toBe('number');
    expect(schema?.properties?.items?.type).toBe('array');
    expect(schema?.properties?.page?.type).toBe('number');
  });
});

// ===========================================================================
// Strategy 2: res.json() / res.send() argument type
// ===========================================================================
describe('Strategy 2 – res.json() / res.send() argument', () => {
  it('infers type from typed variable passed to res.json()', () => {
    const { responses, schemas } = extractFromCode(`
      interface Order { id: number; total: number; }
      const handler = (req: any, res: any) => {
        const order: Order = { id: 1, total: 99 };
        res.json(order);
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/Order');
    expect(schemas['Order']).toBeDefined();
  });

  it('infers shape from inline object literal in res.json()', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.json({ id: 1, name: 'Alice', active: true });
      };
    `);

    const schema = responses['200']?.schema;
    expect(schema?.type).toBe('object');
    expect(schema?.properties?.id?.type).toBe('number');
    expect(schema?.properties?.name?.type).toBe('string');
    expect(schema?.properties?.active?.type).toBe('boolean');
  });

  it('infers array of objects in res.json()', () => {
    const { responses } = extractFromCode(`
      interface Tag { id: number; label: string; }
      const handler = (req: any, res: any) => {
        const tags: Tag[] = [];
        res.json(tags);
      };
    `);

    const schema = responses['200']?.schema;
    expect(schema?.type).toBe('array');
    expect(schema?.items?.$ref).toBe('#/components/schemas/Tag');
  });

  it('infers from res.send()', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.send({ ok: true, message: 'done' });
      };
    `);

    expect(responses['200']?.schema?.properties?.ok?.type).toBe('boolean');
    expect(responses['200']?.schema?.properties?.message?.type).toBe('string');
  });

  it('infers return type of a function call passed to res.json()', () => {
    const { responses, schemas } = extractFromCode(`
      interface DbUser { id: number; email: string; createdAt: string; }
      declare function findUser(): DbUser;
      const handler = (req: any, res: any) => {
        const user = findUser();
        res.json(user);
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/DbUser');
    expect(schemas['DbUser'].properties?.email?.type).toBe('string');
  });
});

// ===========================================================================
// Strategy 3: ctx.body assignment (Koa)
// ===========================================================================
describe('Strategy 3 – ctx.body assignment (Koa)', () => {
  it('infers type from ctx.body = typedVariable', () => {
    const { responses, schemas } = extractFromCode(`
      interface Invoice { id: number; amount: number; }
      const handler = async (ctx: any) => {
        const invoice: Invoice = { id: 1, amount: 100 };
        ctx.body = invoice;
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/Invoice');
    expect(schemas['Invoice']).toBeDefined();
  });

  it('infers inline object shape from ctx.body = {}', () => {
    const { responses } = extractFromCode(`
      const handler = async (ctx: any) => {
        ctx.body = { ok: true, count: 5 };
      };
    `);

    const schema = responses['200']?.schema;
    expect(schema?.properties?.ok?.type).toBe('boolean');
    expect(schema?.properties?.count?.type).toBe('number');
  });

  it('handles context.body (alternative Koa naming)', () => {
    const { responses } = extractFromCode(`
      const handler = async (context: any) => {
        context.body = { status: 'healthy' };
      };
    `);

    expect(responses['200']?.schema?.properties?.status?.type).toBe('string');
  });
});

// ===========================================================================
// Strategy 4: res.status(N).json() chains — ALL status codes
// ===========================================================================
describe('Strategy 4 – res.status(N).json() multi-status', () => {
  it('captures 400 Bad Request', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(400).json({ error: 'Invalid input', field: 'email' });
      };
    `);

    expect(responses['400']).toBeDefined();
    expect(responses['400'].description).toBe('Bad request');
    expect(responses['400'].schema?.properties?.error?.type).toBe('string');
    expect(responses['400'].schema?.properties?.field?.type).toBe('string');
  });

  it('captures 401 Unauthorized', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(401).json({ error: 'Token expired' });
      };
    `);

    expect(responses['401']).toBeDefined();
    expect(responses['401'].description).toBe('Unauthorized');
    expect(responses['401'].schema?.properties?.error?.type).toBe('string');
  });

  it('captures 403 Forbidden', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(403).json({ message: 'Access denied' });
      };
    `);

    expect(responses['403']).toBeDefined();
    expect(responses['403'].description).toBe('Forbidden');
  });

  it('captures 404 Not Found', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        const user = null;
        if (!user) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json({ id: 1, name: 'Alice' });
      };
    `);

    expect(responses['404']).toBeDefined();
    expect(responses['404'].description).toBe('Not found');
    expect(responses['404'].schema?.properties?.error?.type).toBe('string');
    expect(responses['200']).toBeDefined();
    expect(responses['200'].schema?.properties?.id?.type).toBe('number');
  });

  it('captures 409 Conflict', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(409).json({ error: 'Already exists', code: 'DUPLICATE' });
      };
    `);

    expect(responses['409']).toBeDefined();
    expect(responses['409'].description).toBe('Conflict');
  });

  it('captures 422 Unprocessable Entity', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(422).json({ errors: [{ field: 'name', message: 'required' }] });
      };
    `);

    expect(responses['422']).toBeDefined();
    expect(responses['422'].description).toBe('Unprocessable entity');
  });

  it('captures 500 Internal Server Error', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        try { throw new Error('oops'); }
        catch (e) { res.status(500).json({ error: 'Internal error' }); }
      };
    `);

    expect(responses['500']).toBeDefined();
    expect(responses['500'].description).toBe('Internal server error');
  });

  it('captures 201 Created', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(201).json({ id: 42, created: true });
      };
    `);

    expect(responses['201']).toBeDefined();
    expect(responses['201'].description).toBe('Resource created');
    expect(responses['201'].schema?.properties?.id?.type).toBe('number');
    expect(responses['201'].schema?.properties?.created?.type).toBe('boolean');
  });

  it('captures multiple different status codes from the same handler', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        if (!req.body.name) {
          return res.status(400).json({ error: 'Name is required' });
        }
        if (!req.user) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        if (req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin only' });
        }
        res.status(201).json({ id: 1, name: req.body.name });
      };
    `);

    expect(responses['400']).toBeDefined();
    expect(responses['401']).toBeDefined();
    expect(responses['403']).toBeDefined();
    expect(responses['201']).toBeDefined();
  });

  it('captures arbitrary status codes not in the built-in map', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(418).json({ message: 'I am a teapot' });
      };
    `);

    expect(responses['418']).toBeDefined();
    expect(responses['418'].description).toBe('HTTP 418');
  });

  it('works with res.status(N).send()', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        res.status(503).send({ error: 'Service unavailable', retryAfter: 30 });
      };
    `);

    expect(responses['503']).toBeDefined();
    expect(responses['503'].schema?.properties?.retryAfter?.type).toBe('number');
  });
});

// ===========================================================================
// Strategy 5: return statement (Fastify async)
// ===========================================================================
describe('Strategy 5 – return statement (Fastify-style)', () => {
  it('infers type from direct return of typed variable', () => {
    const { responses, schemas } = extractFromCode(`
      interface Post { id: number; title: string; }
      const handler = async () => {
        const post: Post = { id: 1, title: 'Hello' };
        return post;
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/Post');
    expect(schemas['Post']).toBeDefined();
  });

  it('infers inline object shape from return statement', () => {
    const { responses } = extractFromCode(`
      const handler = async () => {
        return { status: 'ok', version: '1.0.0' };
      };
    `);

    const schema = responses['200']?.schema;
    expect(schema?.properties?.status?.type).toBe('string');
    expect(schema?.properties?.version?.type).toBe('string');
  });

  it('skips return res.json() (already handled by strategy 2)', () => {
    const { responses } = extractFromCode(`
      interface Item { id: number; }
      const handler = (req: any, res: any) => {
        const item: Item = { id: 1 };
        return res.json(item);
      };
    `);

    // Should extract from res.json, not from the return statement
    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/Item');
  });
});

// ===========================================================================
// Edge cases & complex scenarios
// ===========================================================================
describe('Edge cases', () => {
  it('handles handler with no response (defaults to 200)', () => {
    const { responses } = extractFromCode(`
      const handler = (req: any, res: any) => {
        console.log('ping');
      };
    `);

    expect(responses['200']).toBeDefined();
    expect(responses['200'].description).toBe('Successful response');
  });

  it('handles union return types correctly', () => {
    const { responses, schemas } = extractFromCode(`
      interface SuccessResponse { data: string; }
      interface ErrorResponse { error: string; code: number; }
      const handler = (req: any, res: any): SuccessResponse | ErrorResponse => {
        return { data: 'ok' };
      };
    `);

    // Union → should produce a oneOf schema
    const schema = responses['200']?.schema;
    expect(schema?.oneOf).toBeDefined();
    expect(schema?.oneOf?.length).toBe(2);
  });

  it('handles nullable return types', () => {
    const { responses, schemas } = extractFromCode(`
      interface User { id: number; name: string; }
      const handler = (req: any, res: any): User | null => {
        return null;
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/User');
  });

  it('resolves nested objects', () => {
    const { responses, schemas } = extractFromCode(`
      interface Address { street: string; city: string; zip: string; }
      interface Customer { id: number; name: string; address: Address; }
      const handler = (req: any, res: any) => {
        const customer: Customer = { id: 1, name: 'Bob', address: { street: '123', city: 'NY', zip: '10001' } };
        res.json(customer);
      };
    `);

    expect(responses['200']?.schema?.$ref).toBe('#/components/schemas/Customer');
    expect(schemas['Customer'].properties?.address?.$ref).toBe('#/components/schemas/Address');
    expect(schemas['Address'].properties?.city?.type).toBe('string');
  });

  it('resolves enum properties', () => {
    const { responses, schemas } = extractFromCode(`
      interface Task { id: number; status: 'pending' | 'active' | 'done'; }
      const handler = (req: any, res: any) => {
        const task: Task = { id: 1, status: 'active' };
        res.json(task);
      };
    `);

    expect(schemas['Task'].properties?.status?.type).toBe('string');
    expect(schemas['Task'].properties?.status?.enum).toEqual(['pending', 'active', 'done']);
  });

  it('resolves optional properties correctly', () => {
    const { responses, schemas } = extractFromCode(`
      interface Config { host: string; port: number; debug?: boolean; }
      const handler = (req: any, res: any) => {
        const config: Config = { host: 'localhost', port: 3000 };
        res.json(config);
      };
    `);

    expect(schemas['Config'].required).toContain('host');
    expect(schemas['Config'].required).toContain('port');
    expect(schemas['Config'].required).not.toContain('debug');
  });
});
