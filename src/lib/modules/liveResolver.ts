import type { Invidious } from './getStreamData';

const endpoint = import.meta.env.VITE_RESOLVER_MANIFEST_URL;
const publicKey = import.meta.env.VITE_RESOLVER_PUBLIC_KEY;
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const signatureAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
const cacheKey = 'm14u.live-resolver.v1';
const refreshInterval = 15 * 60 * 1000;

type Bundle = { version: number; code: string; signature: string };
let active: Bundle | undefined;
let lastWorking: Bundle | undefined;
let lastCheck = 0;
let checking: Promise<void> | undefined;

async function verify(bundle: Bundle): Promise<boolean> {
  if (!Number.isSafeInteger(bundle.version) || bundle.version < 1 ||
      typeof bundle.code !== 'string' || bundle.code.length > 3_000_000 ||
      typeof bundle.signature !== 'string') return false;
  const key = await crypto.subtle.importKey('spki', decode(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify(signatureAlgorithm, key, decode(bundle.signature),
    new TextEncoder().encode(`m14u-resolver-v1\n${bundle.version}\n${bundle.code}`));
}

async function refresh() {
  try {
    const saved = localStorage.getItem(cacheKey);
    if (!active && saved) {
      const cached = JSON.parse(saved) as Bundle;
      if (await verify(cached)) active = lastWorking = cached;
    }
  } catch { /* Unavailable or invalid cache. */ }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return;
    const response = await fetch(url, { credentials: 'omit', redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) return;
    const next = await response.json() as Bundle;
    if (next.version > (active?.version ?? 0) && await verify(next)) active = next;
  } catch { /* Fall back to the cached bundle or native resolver. */ }
}

export function checkForLiveResolverUpdate() {
  if (!endpoint || !publicKey) return;
  if (!checking && Date.now() - lastCheck >= refreshInterval) {
    lastCheck = Date.now();
    checking = refresh().finally(() => { checking = undefined; });
  }
  return checking;
}

export async function resolveWithLiveBundle(videoId: string, signal?: AbortSignal): Promise<Invidious | undefined> {
  if (signal?.aborted) return;
  const pending = checkForLiveResolverUpdate();
  if (!active) await pending;
  const bundle = active;
  if (!bundle || signal?.aborted) return;

  const result = await runBundle(bundle, videoId, signal);
  if (result) {
    if (!lastWorking || bundle.version >= lastWorking.version) {
      lastWorking = bundle;
      try { localStorage.setItem(cacheKey, JSON.stringify(bundle)); } catch { /* Storage unavailable. */ }
    }
    return result;
  }
  if (signal?.aborted || lastWorking === bundle) return;
  if (active === bundle) active = lastWorking;
  if (lastWorking) return runBundle(lastWorking, videoId, signal);
}

async function runBundle(bundle: Bundle, videoId: string, signal?: AbortSignal) {
  const url = URL.createObjectURL(new Blob([bundle.code], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url);
    return await new Promise<Invidious | undefined>(resolve => {
      const finish = (data?: Invidious) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        resolve(data);
      };
      const onAbort = () => finish();
      const timer = setTimeout(onAbort, 8000);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onerror = onAbort;
      worker.onmessage = ({ data }) => {
        const streams = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats.filter(
          (stream: { type?: string; url?: string }) => stream?.type?.startsWith('audio/') &&
            /^https:\/\/[a-z0-9.-]+\.googlevideo\.com\//i.test(stream.url ?? '')) : [];
        finish(streams.length ? { title: String(data.title ?? ''), adaptiveFormats: streams } : undefined);
      };
      try { worker.postMessage({ videoId }); } catch { finish(); }
    });
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
