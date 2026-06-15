/**
 * Tests for the OpenAPI spec builder.
 *
 * Validates that analysis results are correctly transformed into valid OpenAPI 3.0 JSON.
 */

import { describe, it, expect } from 'vitest';
import { generateSpec } from '../src/generator/spec-builder';
import { AnalysisResult, RouteInfo, SchemaInfo } from '../src/types';

function makeResult(routes: RouteInfo[], schemas: Record<string, SchemaInfo> = {}): AnalysisResult {
  return { routes, framework: 'express', schemas, errors: [] };
}

describe('Spec Builder', () => {
  it('generates a valid OpenAPI 3.0.3 spec', () => {
    const spec = generateSpec(makeResult([]), { title: 'Test API' });
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('includes version and description from config', () => {
    const spec = generateSpec(makeResult([]), {
      title: 'My API',
      version: '2.0.0',
      description: 'An awesome API',
    });
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('An awesome API');
  });

  it('maps routes to paths correctly', () => {
    const routes: RouteInfo[] = [
      { method: 'get', path: '/users', filePath: 'a.ts', line: 1, responses: { '200': { description: 'OK' } } },
      { method: 'post', path: '/users', filePath: 'a.ts', line: 2, responses: { '201': { description: 'Created' } } },
    ];

    const spec = generateSpec(makeResult(routes), {});
    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users']['get']).toBeDefined();
    expect(spec.paths['/users']['post']).toBeDefined();
  });

  it('includes path parameters in operations', () => {
    const routes: RouteInfo[] = [
      {
        method: 'get', path: '/users/{id}', filePath: 'a.ts', line: 1,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    ];

    const spec = generateSpec(makeResult(routes), {});
    const params = spec.paths['/users/{id}']['get']?.parameters;
    expect(params).toHaveLength(1);
    expect(params?.[0].name).toBe('id');
    expect(params?.[0].in).toBe('path');
    expect(params?.[0].required).toBe(true);
  });

  it('includes response schemas', () => {
    const routes: RouteInfo[] = [
      {
        method: 'get', path: '/health', filePath: 'a.ts', line: 1,
        responses: {
          '200': { description: 'Healthy', schema: { type: 'object', properties: { status: { type: 'string' } } } },
        },
      },
    ];

    const spec = generateSpec(makeResult(routes), {});
    const response = spec.paths['/health']['get']?.responses['200'];
    expect(response?.content?.['application/json']?.schema).toBeDefined();
  });

  it('applies basePath prefix', () => {
    const routes: RouteInfo[] = [
      { method: 'get', path: '/users', filePath: 'a.ts', line: 1, responses: { '200': { description: 'OK' } } },
    ];

    const spec = generateSpec(makeResult(routes), { basePath: '/api/v1' });
    expect(spec.paths['/api/v1/users']).toBeDefined();
  });

  it('includes servers from config', () => {
    const spec = generateSpec(makeResult([]), {
      servers: [
        { url: 'https://api.example.com', description: 'Production' },
        { url: 'http://localhost:3000', description: 'Local' },
      ],
    });
    expect(spec.servers).toHaveLength(2);
    expect(spec.servers?.[0].url).toBe('https://api.example.com');
  });

  it('includes tags from config', () => {
    const spec = generateSpec(makeResult([]), {
      tags: [{ name: 'Users', description: 'User management' }],
    });
    expect(spec.tags?.[0].name).toBe('Users');
  });

  it('includes component schemas from analysis', () => {
    const schemas: Record<string, SchemaInfo> = {
      User: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } }, required: ['id', 'name'] },
    };

    const spec = generateSpec(makeResult([], schemas), {});
    expect(spec.components?.schemas?.['User']).toBeDefined();
    expect((spec.components?.schemas?.['User'] as any).properties.id.type).toBe('number');
  });

  it('generates stable operationIds', () => {
    const routes: RouteInfo[] = [
      { method: 'get', path: '/users/{id}', filePath: 'a.ts', line: 1, responses: { '200': { description: 'OK' } } },
      { method: 'post', path: '/users', filePath: 'a.ts', line: 2, responses: { '201': { description: 'Created' } } },
    ];

    const spec = generateSpec(makeResult(routes), {});
    expect(spec.paths['/users/{id}']['get']?.operationId).toBe('getUsersById');
    expect(spec.paths['/users']['post']?.operationId).toBe('postUsers');
  });

  it('includes summary and description from route', () => {
    const routes: RouteInfo[] = [
      {
        method: 'get', path: '/health', filePath: 'a.ts', line: 1,
        summary: 'Health check',
        description: 'Returns the service health status.',
        responses: { '200': { description: 'OK' } },
      },
    ];

    const spec = generateSpec(makeResult(routes), {});
    const op = spec.paths['/health']['get'];
    expect(op?.summary).toBe('Health check');
    expect(op?.description).toBe('Returns the service health status.');
  });

  it('marks deprecated operations', () => {
    const routes: RouteInfo[] = [
      {
        method: 'get', path: '/old', filePath: 'a.ts', line: 1,
        deprecated: true,
        responses: { '200': { description: 'OK' } },
      },
    ];

    const spec = generateSpec(makeResult(routes), {});
    expect(spec.paths['/old']['get']?.deprecated).toBe(true);
  });

  it('includes security schemes from config', () => {
    const spec = generateSpec(makeResult([]), {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    });
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
  });

  it('handles $ref schemas in responses', () => {
    const schemas: Record<string, SchemaInfo> = {
      User: { type: 'object', properties: { id: { type: 'number' } } },
    };
    const routes: RouteInfo[] = [
      {
        method: 'get', path: '/me', filePath: 'a.ts', line: 1,
        responses: { '200': { description: 'OK', schema: { $ref: '#/components/schemas/User' } } },
      },
    ];

    const spec = generateSpec(makeResult(routes, schemas), {});
    const responseSchema = spec.paths['/me']['get']?.responses['200']?.content?.['application/json']?.schema;
    expect(responseSchema?.['$ref']).toBe('#/components/schemas/User');
  });
});
