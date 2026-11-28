import { httpFetch, pump } from './resolver-headless-runtime';
import { configureYouTubeEvaluator, resolveYouTubeStreams } from '../src/lib/modules/resolver/core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
const getQuickJS = () => engine ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
configureYouTubeEvaluator(async (script, args) => (await getQuickJS()).evalCode(`${script.output}\n;` +
  `(() => { const args = ${JSON.stringify(args)}; return {` +
  `sig: typeof args.sig === 'string' ? exportedVars.sigFunction?.(args.sig) : undefined,` +
  `n: typeof args.n === 'string' ? exportedVars.nFunction?.(args.n) : undefined }; })()`, {
  memoryLimitBytes: 16 * 1024 * 1024, maxStackSizeBytes: 512 * 1024,
  shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + 150),
}));

type Android = { consumeNamedDataAsArrayBuffer(name: string): Promise<ArrayBuffer> };
const android = () => (globalThis as typeof globalThis & { android: Android }).android;
let done = false;
let started = false;
let result: Awaited<ReturnType<typeof resolveYouTubeStreams>> | null = null;
Object.assign(globalThis, { m14uResolver: {
  async selfTest() { return String((await getQuickJS()).evalCode('6 * 7')); },
  start(videoId: string) {
    if (started || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid start');
    started = true;
    void resolveYouTubeStreams(videoId, { fetch: httpFetch }).then((value) => { result = value; }, () => {}).finally(() => { done = true; });
    return 'ok';
  },
  async reply(id: number, name: string) {
    try {
      const data = await android().consumeNamedDataAsArrayBuffer(name);
      pump.reply(id, JSON.parse(new TextDecoder().decode(data)));
    } catch {
      pump.reply(id, null);
    }
    return 'ok';
  },
  drain() { return JSON.stringify({ done, result, requests: pump.requests() }); },
} });
