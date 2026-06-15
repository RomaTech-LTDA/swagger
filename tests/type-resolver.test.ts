/**
 * Tests for the TypeScript → OpenAPI type resolver.
 *
 * Validates that TS types are correctly converted to OpenAPI 3.0 schemas.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { resolveType } from '../src/analyzer/type-resolver';
import { SchemaInfo } from '../src/types';

/**
 * Helper: creates a project with a typed variable and resolves its type to a schema.
 */
function resolveFromCode(code: string, varName = 'x') {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', code);
  const decl = sf.getVariableDeclarationOrThrow(varName);
  const type = decl.getType();
  const schemas: Record<string, SchemaInfo> = {};
  const schema = resolveType(type, schemas);
  return { schema, schemas };
}

describe('Type Resolver', () => {
  // --- Primitives ---
  describe('Primitives', () => {
    it('resolves string', () => {
      const { schema } = resolveFromCode(`const x: string = '';`);
      expect(schema.type).toBe('string');
    });

    it('resolves number', () => {
      const { schema } = resolveFromCode(`const x: number = 0;`);
      expect(schema.type).toBe('number');
    });

    it('resolves boolean', () => {
      const { schema } = resolveFromCode(`const x: boolean = true;`);
      expect(schema.type).toBe('boolean');
    });

    it('widens string literal to string', () => {
      const { schema } = resolveFromCode(`const x = 'hello';`);
      expect(schema.type).toBe('string');
      expect(schema.enum).toBeUndefined();
    });

    it('widens number literal to number', () => {
      const { schema } = resolveFromCode(`const x = 42;`);
      expect(schema.type).toBe('number');
      expect(schema.enum).toBeUndefined();
    });
  });

  // --- Arrays ---
  describe('Arrays', () => {
    it('resolves string[]', () => {
      const { schema } = resolveFromCode(`const x: string[] = [];`);
      expect(schema.type).toBe('array');
      expect(schema.items?.type).toBe('string');
    });

    it('resolves Array<number>', () => {
      const { schema } = resolveFromCode(`const x: Array<number> = [];`);
      expect(schema.type).toBe('array');
      expect(schema.items?.type).toBe('number');
    });

    it('resolves interface array', () => {
      const { schema, schemas } = resolveFromCode(`
        interface Item { id: number; }
        const x: Item[] = [];
      `);
      expect(schema.type).toBe('array');
      expect(schema.items?.$ref).toBe('#/components/schemas/Item');
      expect(schemas['Item']).toBeDefined();
    });
  });

  // --- Objects ---
  describe('Objects / Interfaces', () => {
    it('resolves a simple interface', () => {
      const { schema, schemas } = resolveFromCode(`
        interface User { id: number; name: string; active: boolean; }
        const x: User = { id: 1, name: 'a', active: true };
      `);
      expect(schema.$ref).toBe('#/components/schemas/User');
      expect(schemas['User'].properties?.id?.type).toBe('number');
      expect(schemas['User'].properties?.name?.type).toBe('string');
      expect(schemas['User'].required).toContain('id');
    });

    it('marks optional properties correctly', () => {
      const { schemas } = resolveFromCode(`
        interface Config { host: string; port?: number; }
        const x: Config = { host: '' };
      `);
      expect(schemas['Config'].required).toContain('host');
      expect(schemas['Config'].required).not.toContain('port');
    });

    it('resolves nested interfaces via $ref', () => {
      const { schemas } = resolveFromCode(`
        interface Address { city: string; }
        interface Person { name: string; address: Address; }
        const x: Person = { name: '', address: { city: '' } };
      `);
      expect(schemas['Person'].properties?.address?.$ref).toBe('#/components/schemas/Address');
      expect(schemas['Address'].properties?.city?.type).toBe('string');
    });
  });

  // --- Union types ---
  describe('Union types', () => {
    it('resolves string literal union as enum', () => {
      const { schema } = resolveFromCode(`const x: 'a' | 'b' | 'c' = 'a';`);
      expect(schema.type).toBe('string');
      expect(schema.enum).toEqual(['a', 'b', 'c']);
    });

    it('resolves number literal union as enum', () => {
      const { schema } = resolveFromCode(`const x: 1 | 2 | 3 = 1;`);
      expect(schema.type).toBe('number');
      expect(schema.enum).toEqual([1, 2, 3]);
    });

    it('resolves nullable type (T | null)', () => {
      // Need strictNullChecks to preserve the union with null
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { strictNullChecks: true },
      });
      const sf = project.createSourceFile('test.ts', `function fn(x: string | null) { return x; }`);
      const fn = sf.getFunctionOrThrow('fn');
      const param = fn.getParameters()[0];
      const type = param.getType();
      const schemas: Record<string, SchemaInfo> = {};
      const schema = resolveType(type, schemas);
      expect(schema.type).toBe('string');
      expect(schema.nullable).toBe(true);
    });

    it('resolves complex union as oneOf', () => {
      const { schema } = resolveFromCode(`
        interface A { kind: 'a'; value: number; }
        interface B { kind: 'b'; label: string; }
        const x: A | B = { kind: 'a', value: 1 };
      `);
      expect(schema.oneOf).toBeDefined();
      expect(schema.oneOf?.length).toBe(2);
    });
  });

  // --- Generics ---
  describe('Generic utility types', () => {
    it('resolves Partial<T> structurally', () => {
      const { schema } = resolveFromCode(`
        interface Full { a: string; b: number; }
        const x: Partial<Full> = {};
      `);
      // Partial<T> gets resolved structurally by TS — all props become optional
      // The schema will have properties from the base type
      expect(schema.type).toBe('object');
      expect(schema.properties?.a?.type).toBe('string');
      expect(schema.properties?.b?.type).toBe('number');
    });

    it('resolves Promise<T> by unwrapping', () => {
      const { schema } = resolveFromCode(`const x: Promise<string> = Promise.resolve('');`);
      expect(schema.type).toBe('string');
    });
  });

  // --- Inline objects ---
  describe('Inline / anonymous objects', () => {
    it('resolves anonymous object literal type', () => {
      const { schema } = resolveFromCode(`const x = { a: 1, b: 'hi', c: true };`);
      expect(schema.type).toBe('object');
      expect(schema.properties?.a?.type).toBe('number');
      expect(schema.properties?.b?.type).toBe('string');
      expect(schema.properties?.c?.type).toBe('boolean');
    });
  });
});
