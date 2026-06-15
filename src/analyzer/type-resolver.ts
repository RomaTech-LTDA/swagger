/**
 * Type Resolver
 *
 * Converts TypeScript types (resolved via the TS compiler API through ts-morph)
 * into OpenAPI 3.0 Schema Objects.
 *
 * Handles:
 * - Primitive types: string, number, boolean, null, undefined
 * - Complex types: interfaces, type aliases, classes
 * - Generic types: Array<T>, Promise<T>, Record<K, V>, Partial<T>, etc.
 * - Union types: string | number, T | null
 * - Literal types: "active" | "inactive"
 * - Tuple types
 * - Enum types
 * - Circular references (via $ref)
 */

import { Type, TypeFlags, Symbol as TsSymbol } from 'ts-morph';
import { SchemaInfo } from '../types';

/** Tracks types being resolved to detect circular references. */
type ResolutionStack = Set<string>;

/**
 * Resolves a ts-morph Type into an OpenAPI SchemaInfo object.
 *
 * @param type - The TypeScript type to resolve
 * @param schemas - The shared schema registry for $ref generation
 * @param stack - Internal recursion stack for circular reference detection
 * @returns An OpenAPI-compatible schema object
 */
export function resolveType(
  type: Type,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack = new Set()
): SchemaInfo {
  // Strip Promise<T> wrappers — async handlers return Promise<Response>
  if (isPromise(type)) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) {
      return resolveType(typeArgs[0], schemas, stack);
    }
    return { type: 'object' };
  }

  // Handle null / undefined
  if (type.isNull() || type.isUndefined()) {
    return { type: 'object', nullable: true };
  }

  // Primitive types
  // Single literal types (e.g., property inferred as `1` or `"Alice"`)
  // are widened to their base type. Enum generation happens only for union literals.
  if (type.isString() || type.isStringLiteral()) {
    return { type: 'string' };
  }

  if (type.isNumber() || type.isNumberLiteral()) {
    return { type: 'number' };
  }

  if (type.isBoolean() || type.isBooleanLiteral()) {
    return { type: 'boolean' };
  }

  // Union types (e.g., string | number | null)
  if (type.isUnion()) {
    return resolveUnion(type, schemas, stack);
  }

  // Intersection types (e.g., TypeA & TypeB)
  if (type.isIntersection()) {
    return resolveIntersection(type, schemas, stack);
  }

  // Array types (e.g., string[], Array<User>)
  if (type.isArray()) {
    const elementType = type.getArrayElementType();
    return {
      type: 'array',
      items: elementType ? resolveType(elementType, schemas, stack) : { type: 'object' },
    };
  }

  // Tuple types (e.g., [string, number])
  if (type.isTuple()) {
    const elements = type.getTupleElements();
    return {
      type: 'array',
      items: elements.length > 0 ? resolveType(elements[0], schemas, stack) : { type: 'object' },
    };
  }

  // Enum types
  if (type.isEnum() || type.isEnumLiteral()) {
    return resolveEnum(type);
  }

  // Object / interface / class types
  if (type.isObject() || type.isInterface() || type.isClass()) {
    return resolveObject(type, schemas, stack);
  }

  // Generic type aliases (e.g., Record<string, T>, Partial<T>)
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  if (symbol) {
    const typeName = symbol.getName();
    return resolveNamedType(type, typeName, schemas, stack);
  }

  // Fallback for any/unknown
  return { type: 'object' };
}

/**
 * Resolves a union type to an OpenAPI schema.
 * Handles nullable unions (T | null) and literal enums ("a" | "b").
 */
function resolveUnion(
  type: Type,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack
): SchemaInfo {
  const unionTypes = type.getUnionTypes();

  // Check if it's a nullable union: T | null
  const nonNullTypes = unionTypes.filter(t => !t.isNull() && !t.isUndefined());
  const hasNull = unionTypes.some(t => t.isNull() || t.isUndefined());

  // Pure null/undefined
  if (nonNullTypes.length === 0) {
    return { type: 'object', nullable: true };
  }

  // Nullable single type: T | null → schema with nullable: true
  if (nonNullTypes.length === 1) {
    const schema = resolveType(nonNullTypes[0], schemas, stack);
    if (hasNull) {
      schema.nullable = true;
    }
    return schema;
  }

  // All literals of the same type → enum
  const allStringLiterals = nonNullTypes.every(t => t.isStringLiteral());
  const allNumberLiterals = nonNullTypes.every(t => t.isNumberLiteral());

  if (allStringLiterals) {
    return {
      type: 'string',
      enum: nonNullTypes.map(t => t.getLiteralValue() as string),
      nullable: hasNull,
    };
  }

  if (allNumberLiterals) {
    return {
      type: 'number',
      enum: nonNullTypes.map(t => t.getLiteralValue() as number),
      nullable: hasNull,
    };
  }

  // General union → oneOf
  return {
    oneOf: nonNullTypes.map(t => resolveType(t, schemas, stack)),
    nullable: hasNull || undefined,
  };
}

/**
 * Resolves an intersection type (A & B) via allOf.
 */
function resolveIntersection(
  type: Type,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack
): SchemaInfo {
  const types = type.getIntersectionTypes();
  return {
    allOf: types.map(t => resolveType(t, schemas, stack)),
  };
}

/**
 * Resolves an enum type to an OpenAPI schema.
 */
function resolveEnum(type: Type): SchemaInfo {
  // If it's a union enum, extract values
  const symbol = type.getSymbol();
  if (!symbol) return { type: 'string' };

  const members = symbol.getExports();
  const values = members
    .map(m => {
      const valueDecl = m.getValueDeclaration();
      if (!valueDecl) return null;
      // Try to get the initializer text
      const text = (valueDecl as any).getInitializer?.()?.getText();
      if (!text) return null;
      // Remove quotes for string enums
      if (text.startsWith('"') || text.startsWith("'")) {
        return text.slice(1, -1);
      }
      const num = Number(text);
      return isNaN(num) ? text : num;
    })
    .filter((v): v is string | number => v !== null);

  const allNumbers = values.every(v => typeof v === 'number');

  return {
    type: allNumbers ? 'integer' : 'string',
    enum: values.length > 0 ? values : undefined,
  };
}

/**
 * Resolves an object/interface/class type to an OpenAPI schema.
 * Uses $ref for named types to avoid duplication and support circular refs.
 */
function resolveObject(
  type: Type,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack
): SchemaInfo {
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  const typeName = symbol?.getName();

  // If we have a named type, register it in the schema registry
  if (typeName && typeName !== '__type' && typeName !== '__object' && typeName !== 'Object') {
    // Circular reference protection
    if (stack.has(typeName)) {
      return { $ref: `#/components/schemas/${typeName}` };
    }

    // If already registered, return a $ref
    if (schemas[typeName]) {
      return { $ref: `#/components/schemas/${typeName}` };
    }

    // Start resolving — add to stack to detect circular refs
    stack.add(typeName);

    const schema = buildObjectSchema(type, schemas, stack);
    schemas[typeName] = schema;

    stack.delete(typeName);

    return { $ref: `#/components/schemas/${typeName}` };
  }

  // Anonymous inline object type
  return buildObjectSchema(type, schemas, stack);
}

/**
 * Builds the properties map for an object schema.
 */
function buildObjectSchema(
  type: Type,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack
): SchemaInfo {
  const properties: Record<string, SchemaInfo> = {};
  const required: string[] = [];

  const props = type.getProperties();
  for (const prop of props) {
    const propName = prop.getName();

    // Skip internal/symbol properties
    if (propName.startsWith('__') || propName.startsWith('[')) continue;

    const propType = prop.getTypeAtLocation(
      prop.getValueDeclaration() ?? prop.getDeclarations()[0]
    );

    if (!propType) continue;

    properties[propName] = resolveType(propType, schemas, stack);

    // A property is required if it's not optional (no '?')
    const isOptional = prop.isOptional();
    if (!isOptional) {
      required.push(propName);
    }
  }

  return {
    type: 'object',
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Resolves well-known generic type aliases (Record, Partial, Required, etc.).
 */
function resolveNamedType(
  type: Type,
  name: string,
  schemas: Record<string, SchemaInfo>,
  stack: ResolutionStack
): SchemaInfo {
  const typeArgs = type.getTypeArguments();

  switch (name) {
    case 'Record': {
      // Record<K, V> → { type: 'object', additionalProperties: V }
      const valueType = typeArgs[1];
      return {
        type: 'object',
        ...(valueType
          ? { additionalProperties: resolveType(valueType, schemas, stack) }
          : {}),
      } as SchemaInfo;
    }

    case 'Partial':
    case 'Required':
    case 'Readonly': {
      // Delegates to the wrapped type
      if (typeArgs.length > 0) {
        return resolveType(typeArgs[0], schemas, stack);
      }
      return { type: 'object' };
    }

    case 'Array': {
      const elementType = typeArgs[0];
      return {
        type: 'array',
        items: elementType ? resolveType(elementType, schemas, stack) : { type: 'object' },
      };
    }

    case 'Map': {
      // Map<K, V> → object with additionalProperties
      const valueType = typeArgs[1];
      return {
        type: 'object',
        ...(valueType
          ? { additionalProperties: resolveType(valueType, schemas, stack) }
          : {}),
      } as SchemaInfo;
    }

    default:
      // Unknown named type — try to resolve as object
      return resolveObject(type, schemas, stack);
  }
}

/**
 * Checks if a type is a Promise<T>.
 */
function isPromise(type: Type): boolean {
  const symbol = type.getSymbol();
  if (!symbol) return false;
  const name = symbol.getName();
  return name === 'Promise';
}
