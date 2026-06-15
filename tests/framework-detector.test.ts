/**
 * Tests for framework detection.
 *
 * Validates that the detector correctly identifies Express, Fastify,
 * and Koa from source code patterns.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { detectFramework } from '../src/analyzer/framework-detector';

function detect(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', code);
  return detectFramework(sf);
}

describe('Framework Detector', () => {
  // --- Express ---
  describe('Express', () => {
    it('detects from import statement', () => {
      expect(detect(`import express from 'express';`)).toBe('express');
    });

    it('detects from require statement', () => {
      expect(detect(`const express = require('express');`)).toBe('express');
    });

    it('detects from Router usage', () => {
      expect(detect(`
        import express from 'express';
        const router = express.Router();
        router.get('/test', (req, res) => {});
      `)).toBe('express');
    });

    it('detects from type annotations', () => {
      expect(detect(`
        import express from 'express';
        import { Request, Response } from 'express';
        const handler = (req: Request, res: Response) => {};
      `)).toBe('express');
    });
  });

  // --- Fastify ---
  describe('Fastify', () => {
    it('detects from import statement', () => {
      expect(detect(`import Fastify from 'fastify';`)).toBe('fastify');
    });

    it('detects from require statement', () => {
      expect(detect(`const fastify = require('fastify');`)).toBe('fastify');
    });

    it('detects from register/addHook patterns', () => {
      expect(detect(`
        import Fastify from 'fastify';
        const app = Fastify();
        app.register(plugin);
        app.addHook('onRequest', hook);
      `)).toBe('fastify');
    });

    it('detects from type annotations', () => {
      expect(detect(`
        import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
      `)).toBe('fastify');
    });
  });

  // --- Koa ---
  describe('Koa', () => {
    it('detects from koa import', () => {
      expect(detect(`import Koa from 'koa';`)).toBe('koa');
    });

    it('detects from @koa/router import', () => {
      expect(detect(`import Router from '@koa/router';`)).toBe('koa');
    });

    it('detects from koa-router require', () => {
      expect(detect(`const Router = require('koa-router');`)).toBe('koa');
    });

    it('detects from ctx patterns', () => {
      expect(detect(`
        import Koa from 'koa';
        app.use(async (ctx) => { ctx.body = 'ok'; ctx.status = 200; });
      `)).toBe('koa');
    });
  });

  // --- Unknown ---
  describe('Unknown', () => {
    it('returns unknown for empty file', () => {
      expect(detect('')).toBe('unknown');
    });

    it('returns unknown for non-web code', () => {
      expect(detect(`
        const x = 1 + 2;
        console.log(x);
      `)).toBe('unknown');
    });
  });
});
