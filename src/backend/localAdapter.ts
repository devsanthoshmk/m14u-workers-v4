import type { Connect } from 'vite';
import worker from './worker.js';

/**
 * Adapts the Cloudflare Worker fetch handler for use as a Vite middleware.
 */
export function createLocalAdapter() {
  return async (req: Connect.IncomingMessage, res: any, next: () => void) => {
    // Only handle /api/* requests, let Vite handle everything else
    if (!req.url?.startsWith('/api/')) {
      next();
      return;
    }

    console.log('[LocalAdapter] Incoming request:', req.method, req.url);

    const protocol = (req.socket as any).encrypted ? 'https' : 'http';
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '', `${protocol}://${host}`);

    // Create a Fetch Request object from the Node.js request
    const request = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as Record<string, string>,
      // For GET requests, body must be null
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? (req as any) : null,
      // @ts-ignore - duplex is required for streaming bodies in some environments
      duplex: 'half'
    });

    try {
      // Call the worker's fetch method
      // @ts-ignore
      const response = await worker.fetch(request, {}, {});

      console.log('[LocalAdapter] Response status:', response.status);
      console.log('[LocalAdapter] Response headers:', Object.fromEntries(response.headers.entries()));

      // Copy status and headers to the Node.js response
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Stream the response body back to the client
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: number[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(...value);
        }
        const body = new TextDecoder().decode(new Uint8Array(chunks));
        console.log('[LocalAdapter] Response body (first 500 chars):', body.slice(0, 500));
        res.end(body);
      } else {
        console.log('[LocalAdapter] No response body!');
        res.end();
      }
    } catch (err) {
      console.error('[LocalAdapter] Error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal Server Error', message: (err as Error).message }));
      }
    }
  };
}
