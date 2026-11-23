import { pipeline } from 'node:stream/promises';
import type { Connect } from 'vite';
import worker from './worker.js';

export function createLocalAdapter(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) {
      next();
      return;
    }

    try {
      // The metadata router only reads the path, query, and method. It does not
      // need to consume a Node request body or trust the incoming Host header.
      const url = new URL(req.url, 'http://localhost');
      const apiKey = process.env.LASTFM_API_KEY;
      const response = await worker.fetch(
        { url: url.href, method: req.method || 'GET' },
        apiKey ? { LASTFM_API_KEY: apiKey } : undefined
      );

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));

      const reader = response.body?.getReader();
      if (!reader) {
        res.end();
        return;
      }
      await pipeline(async function* () {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
          }
        } finally {
          await reader.cancel();
        }
      }, res);
    } catch {
      console.error('[LocalAdapter] Catalog response failed');
      if (!res.headersSent && !res.destroyed) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  };
}
