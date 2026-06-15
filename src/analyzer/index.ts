/**
 * Route Analyzer Module
 *
 * Entry point for the AST-based route analysis pipeline.
 * Orchestrates file scanning, framework detection, and route extraction.
 */

export { analyzeRoutes } from './route-analyzer';
export { detectFramework } from './framework-detector';
export { resolveType } from './type-resolver';
export { extractResponses } from './response-extractor';
