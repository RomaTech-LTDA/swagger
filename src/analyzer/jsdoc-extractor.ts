/**
 * JSDoc Extractor
 *
 * Extracts documentation from JSDoc comments in source files.
 * This allows developers to enrich their Swagger spec with descriptions
 * simply by writing standard JSDoc — no annotations library needed.
 *
 * Supported JSDoc tags:
 * @summary   - Short summary for the operation
 * @tag       - Tag for grouping the endpoint
 * @deprecated - Marks the endpoint as deprecated
 * @param     - Parameter description
 * @returns   - Response description
 */

import { JSDoc, JSDocTag, Node } from 'ts-morph';
import { JsDocTag } from '../types';

/**
 * Result of JSDoc extraction from a node.
 */
export interface JsDocInfo {
  summary?: string;
  description?: string;
  tags: JsDocTag[];
  deprecated: boolean;
}

/**
 * Extracts JSDoc information from a ts-morph node.
 *
 * @param node - The ts-morph node to extract JSDoc from
 * @returns Extracted JSDoc information
 */
export function extractJsDoc(node: Node): JsDocInfo {
  const result: JsDocInfo = {
    tags: [],
    deprecated: false,
  };

  // ts-morph nodes that support JSDoc implement getJsDocs()
  const jsDocs: JSDoc[] = (node as any).getJsDocs?.() ?? [];

  if (jsDocs.length === 0) {
    return result;
  }

  // Use the last JSDoc comment (closest to the declaration)
  const jsDoc = jsDocs[jsDocs.length - 1];

  // Extract description text (everything before any @tags)
  const comment = jsDoc.getComment();
  if (comment) {
    const text = typeof comment === 'string' ? comment : comment.map(c => c?.getText() ?? '').join('');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length > 0) {
      // First line is the summary
      result.summary = lines[0];
      // Remaining lines form the description
      if (lines.length > 1) {
        result.description = lines.slice(1).join('\n').trim();
      }
    }
  }

  // Extract all @tags
  const tags = jsDoc.getTags();
  for (const tag of tags) {
    const tagName = tag.getTagName();
    const tagComment = getTagComment(tag);

    switch (tagName) {
      case 'summary':
        // @summary overrides the first-line summary
        result.summary = tagComment;
        break;

      case 'deprecated':
        result.deprecated = true;
        if (tagComment) {
          result.tags.push({ name: 'deprecated', value: tagComment });
        }
        break;

      case 'tag':
      case 'swagger-tag':
        // @tag UserManagement — groups the endpoint under a tag
        result.tags.push({ name: 'tag', value: tagComment });
        break;

      default:
        // Preserve all other tags for downstream use
        result.tags.push({ name: tagName, value: tagComment });
        break;
    }
  }

  return result;
}

/**
 * Safely extracts the text content of a JSDoc tag.
 */
function getTagComment(tag: JSDocTag): string | undefined {
  const comment = tag.getComment();
  if (!comment) return undefined;
  if (typeof comment === 'string') return comment.trim();
  return comment.map(c => c?.getText() ?? '').join('').trim() || undefined;
}
