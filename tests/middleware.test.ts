/**
 * Tests for the middleware layer.
 *
 * Validates framework detection (duck-typing) and middleware registration behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { useSwagger, useSwaggerUi } from '../src/middleware';

describe('Middleware – framework detection', () => {
  it('throws if app is null', () => {
    expect(() => useSwagger(null)).toThrow('Could not detect framework');
  });

  it('throws if app is an empty object', () => {
    expect(() => useSwagger({})).toThrow('Could not detect framework');
  });

  it('registers on an Express-like app', () => {
    const get = vi.fn();
    const use = vi.fn();
    const listen = vi.fn();
    const app = { get, use, listen };

    // Should not throw
    expect(() => useSwagger(app)).not.toThrow();
    expect(get).toHaveBeenCalledWith('/api-docs.json', expect.any(Function));
  });

  it('registers on a Fastify-like instance', () => {
    const get = vi.fn();
    const decorate = vi.fn();
    const register = vi.fn();
    const addHook = vi.fn();
    const app = { get, decorate, register, addHook };

    expect(() => useSwagger(app)).not.toThrow();
    expect(get).toHaveBeenCalledWith('/api-docs.json', expect.any(Function));
  });

  it('registers on a Koa-Router-like instance', () => {
    const get = vi.fn();
    const routes = vi.fn();
    const allowedMethods = vi.fn();
    const router = { get, routes, allowedMethods };

    expect(() => useSwagger(router)).not.toThrow();
    expect(get).toHaveBeenCalledWith('/api-docs.json', expect.any(Function));
  });

  it('uses custom specPath', () => {
    const get = vi.fn();
    const use = vi.fn();
    const listen = vi.fn();
    const app = { get, use, listen };

    useSwagger(app, { specPath: '/openapi.json' });
    expect(get).toHaveBeenCalledWith('/openapi.json', expect.any(Function));
  });

  it('registers Swagger UI at custom path', () => {
    const get = vi.fn();
    const use = vi.fn();
    const listen = vi.fn();
    const app = { get, use, listen };

    useSwaggerUi(app, { uiPath: '/docs' });
    expect(get).toHaveBeenCalledWith('/docs', expect.any(Function));
  });
});
