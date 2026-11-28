import { CapacitorHttp } from '@capacitor/core';
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import type { Platform } from 'youtubei.js/web';
import { anyAbortSignal, timeoutAbortSignal } from './abortSignal.ts';

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
async function loadQuickJS() {
  const variant = typeof window !== 'undefined'
    ? newVariant(RELEASE_SYNC, { wasmLocation: (await import('@jitl/quickjs-wasmfile-release-sync/wasm?url')).default })
    : RELEASE_SYNC;
  return newQuickJSWASMModuleFromVariant(variant);
}
// No native bridge or other host functions are exposed to upstream player code.
export const evaluatePlayerScript: typeof Platform.shim.eval = async (script, args) => {
  const vm = await (engine ??= loadQuickJS().catch((error) => { engine = undefined; throw error; }));
  return vm.evalCode(`${script.output}\n;` +
    `(() => { const args = ${JSON.stringify(args)}; return {` +
    `sig: typeof args.sig === 'string' ? exportedVars.sigFunction?.(args.sig) : undefined,` +
    `n: typeof args.n === 'string' ? exportedVars.nFunction?.(args.n) : undefined }; })()`, {
    memoryLimitBytes: 16 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
    shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + 150),
  });
};

const HOSTS = new Set(['www.youtube.com', 'm.youtube.com', 'youtubei.googleapis.com', 'youtubei.youtube.com']);
const SAFE_HEADER = /^(accept|accept-language|content-type|user-agent|x-youtube-client-(name|version)|x-goog-(visitor-id|api-format-version))$/;
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const REQUEST_LIMIT = 64 * 1024;
const REDIRECTS = [301, 302, 303, 307, 308];
let inFlight = 0;

function checkedURL(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new TypeError('Disallowed resolver URL');
  }
  url.hash = '';
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => signal.aborted ? abort() : resolve(value), reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export const createCapacitorFetch = (nativeRequest: typeof CapacitorHttp.request): typeof fetch => async (input, init) => {
  const request = new Request(input, init);
  let url = checkedURL(request.url);
  const timeout = timeoutAbortSignal(5500);
  const combined = anyAbortSignal([request.signal, timeout.signal]);
  const signal = combined.signal;
  try {
    signal.throwIfAborted();
    let method = request.method;
    if (!['GET', 'HEAD', 'POST'].includes(method)) throw new TypeError('Unsupported resolver method');

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => { if (SAFE_HEADER.test(name)) headers[name] = value; });
    const rawHeaders = init?.headers;
    if (rawHeaders && !(rawHeaders instanceof Headers)) {
      const entries = Array.isArray(rawHeaders) ? rawHeaders : Object.entries(rawHeaders);
      for (const [name, value] of entries) {
        const key = name.toLowerCase();
        if (SAFE_HEADER.test(key)) headers[key] = value;
      }
    }
    let data: string | undefined;
    let dataType: 'file' | undefined;
    if (request.body) {
      const type = headers['content-type']?.toLowerCase() ?? '';
      if (type.startsWith('multipart/') || type.startsWith('application/x-www-form-urlencoded')) {
        throw new TypeError('Unsupported resolver request body');
      }
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await abortable(reader.read(), signal);
          if (done) break;
          length += value.byteLength;
          if (length > REQUEST_LIMIT) throw new TypeError('Resolver request exceeds size limit');
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (type.startsWith('text/') || type.includes('application/json')) {
        data = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } else {
        headers['content-type'] ||= 'application/octet-stream';
        data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
        dataType = 'file';
      }
    }

    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      if (inFlight >= 4) throw new Error('Resolver transport busy');
      inFlight++;
      // The native request is not cancellable; keep its slot until it really settles.
      const pending = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return nativeRequest({ url: url.href, method, headers, data, dataType,
          disableRedirects: true, responseType: 'text', connectTimeout: 2500, readTimeout: 3500 });
      }).catch(() => { throw new TypeError('Native resolver request failed'); }).finally(() => { inFlight--; });
      const result = await abortable(pending, signal);
      signal.throwIfAborted();
      if (checkedURL(result.url).href !== url.href) throw new TypeError('Unexpected native redirect');
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(result.headers ?? {})) {
        if (/^(set-cookie2?|content-encoding)$/i.test(name)) continue;
        responseHeaders.set(name, value);
      }
      const location = responseHeaders.get('location');
      if (REDIRECTS.includes(result.status)) {
        if (request.redirect === 'error') throw new TypeError('Resolver redirect rejected');
        if (request.redirect === 'follow' && location) {
          if (redirects >= 3) throw new TypeError('Too many resolver redirects');
          const next = checkedURL(new URL(location, url).href);
          if (next.origin !== url.origin) throw new TypeError('Cross-origin resolver redirect rejected');
          url = next;
          if (method === 'POST' && [301, 302, 303].includes(result.status)) {
            method = 'GET'; data = undefined; dataType = undefined; delete headers['content-type'];
          }
          continue;
        }
      }
      const length = Number(responseHeaders.get('content-length'));
      const type = responseHeaders.get('content-type') ?? '';
      if (length > RESPONSE_LIMIT || /^(audio|video)\//i.test(type)) throw new TypeError('Unsupported resolver response');
      const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? null);
      if (text.length > RESPONSE_LIMIT || new TextEncoder().encode(text).byteLength > RESPONSE_LIMIT) {
        throw new TypeError('Resolver response exceeds size limit');
      }
      // Capacitor does not expose an HTTP reason phrase and may parse JSON natively.
      responseHeaders.delete('content-length');
      const body = method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : text;
      const response = new Response(body, { status: result.status, headers: responseHeaders });
      Object.defineProperties(response, { url: { value: url.href }, redirected: { value: redirects > 0 } });
      return response;
    }
  } finally {
    combined.cleanup();
    timeout.cleanup();
  }
};

export const capacitorFetch = createCapacitorFetch(options => CapacitorHttp.request(options));
