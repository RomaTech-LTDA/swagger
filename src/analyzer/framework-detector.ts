/**
 * Framework Detector
 *
 * Analyzes import statements and usage patterns in source files
 * to determine which HTTP framework is being used.
 *
 * Supports detection of:
 * - Express (import express, require('express'))
 * - Fastify (import fastify, require('fastify'))
 * - Koa (import Koa, require('koa'))
 *
 * Detection is based on:
 * 1. Import/require statements
 * 2. Variable type annotations
 * 3. Usage patterns (app.get, fastify.route, router.get, etc.)
 */

import { SourceFile } from 'ts-morph';
import { FrameworkType } from '../types';

/**
 * Framework detection result with confidence score.
 */
interface DetectionResult {
  framework: FrameworkType;
  confidence: number;
}

/**
 * Detects which HTTP framework is being used in a source file.
 *
 * @param sourceFile - The ts-morph SourceFile to analyze
 * @returns The detected framework type
 *
 * @example
 * ```typescript
 * const framework = detectFramework(sourceFile);
 * // Returns: 'express' | 'fastify' | 'koa' | 'unknown'
 * ```
 */
export function detectFramework(sourceFile: SourceFile): FrameworkType {
  const results: DetectionResult[] = [
    detectExpress(sourceFile),
    detectFastify(sourceFile),
    detectKoa(sourceFile),
  ];

  // Sort by confidence descending, pick the highest
  results.sort((a, b) => b.confidence - a.confidence);

  // Require at least 1 confidence point to make a call
  if (results[0].confidence > 0) {
    return results[0].framework;
  }

  return 'unknown';
}

/**
 * Checks for Express.js patterns in the source file.
 */
function detectExpress(sourceFile: SourceFile): DetectionResult {
  let confidence = 0;
  const text = sourceFile.getFullText();

  // Check imports
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const imp of importDeclarations) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (moduleSpecifier === 'express' || moduleSpecifier.startsWith('express/')) {
      confidence += 3;
    }
  }

  // Check require statements
  if (/require\(['"]express['"]\)/.test(text)) {
    confidence += 3;
  }

  // Check for Express-specific patterns
  if (/\.(get|post|put|delete|patch|use|route)\s*\(\s*['"`\/]/.test(text)) {
    confidence += 1;
  }

  // Check for Router usage
  if (/express\.Router\(\)/.test(text) || /Router\(\)/.test(text)) {
    confidence += 2;
  }

  // Check for type annotations
  if (/:\s*(Express|Application|Router|Request|Response)/.test(text)) {
    confidence += 1;
  }

  return { framework: 'express', confidence };
}

/**
 * Checks for Fastify patterns in the source file.
 */
function detectFastify(sourceFile: SourceFile): DetectionResult {
  let confidence = 0;
  const text = sourceFile.getFullText();

  // Check imports
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const imp of importDeclarations) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (moduleSpecifier === 'fastify' || moduleSpecifier.startsWith('fastify/')) {
      confidence += 3;
    }
  }

  // Check require statements
  if (/require\(['"]fastify['"]\)/.test(text)) {
    confidence += 3;
  }

  // Check for Fastify-specific patterns
  if (/\.(register|route|addHook)\s*\(/.test(text)) {
    confidence += 1;
  }

  // Check for Fastify route shorthand with schema
  if (/\.(get|post|put|delete|patch)\s*\(\s*['"`\/].*schema/.test(text)) {
    confidence += 2;
  }

  // Check for FastifyInstance type
  if (/FastifyInstance|FastifyRequest|FastifyReply/.test(text)) {
    confidence += 2;
  }

  return { framework: 'fastify', confidence };
}

/**
 * Checks for Koa patterns in the source file.
 */
function detectKoa(sourceFile: SourceFile): DetectionResult {
  let confidence = 0;
  const text = sourceFile.getFullText();

  // Check imports
  const importDeclarations = sourceFile.getImportDeclarations();
  for (const imp of importDeclarations) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (
      moduleSpecifier === 'koa' ||
      moduleSpecifier === '@koa/router' ||
      moduleSpecifier === 'koa-router'
    ) {
      confidence += 3;
    }
  }

  // Check require statements
  if (/require\(['"]koa['"]\)/.test(text)) {
    confidence += 3;
  }
  if (/require\(['"](koa-router|@koa\/router)['"]\)/.test(text)) {
    confidence += 3;
  }

  // Check for Koa-specific patterns (ctx usage)
  if (/ctx\.(body|status|request|response)/.test(text)) {
    confidence += 2;
  }

  // Check for Koa Router
  if (/new\s+Router\(\)/.test(text) && /router\.(get|post|put|delete|patch)/.test(text)) {
    confidence += 2;
  }

  return { framework: 'koa', confidence };
}
