import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const args = process.argv.slice(2);
const v2 = args[0] === '--v2';
const [versionArg, keyPath, output, keyId] = v2 ? args.slice(1) : args;
const version = Number(versionArg);
if (!Number.isSafeInteger(version) || version < 1 || !keyPath || !output) {
  throw new Error('Usage: node scripts/build-resolver.mjs VERSION PRIVATE_KEY_PEM OUTPUT_JSON, or --v2 VERSION PRIVATE_KEY_PEM OUTPUT_DIRECTORY KEY_ID');
}
if (v2 && !/^[A-Za-z0-9_-]{1,48}$/.test(keyId ?? '')) throw new Error('Invalid key ID');

// The generated QuickJS web loader assumes document or Worker APIs. For the pinned
// release-sync module feed its supported wasmBinary option, never a broker request.
let inlinedWasm = false;
const headlessWasm = {
  name: 'm14u-headless-wasm', enforce: 'pre',
  async transform(source, id) {
    if (!id.includes('/quickjs-wasmfile-release-sync/dist/emscripten-module.browser.mjs')) return;
    const anchor = 'moduleArg={}){';
    const asset = '(new URL("emscripten-module.wasm",import.meta.url)).href';
    if (!source.includes(anchor) || !source.includes(asset)) throw new Error('QuickJS loader changed; review headless WASM wiring');
    const bytes = await readFile(join(id, '..', 'emscripten-module.wasm'));
    inlinedWasm = true;
    return source.replace(anchor, `${anchor}moduleArg.wasmBinary??=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));`)
      .replace(asset, '"inline-quickjs.wasm"').replaceAll('import.meta.url', '"https://headless.invalid/"');
  },
};
const bundles = await build({ configFile: false, plugins: v2 ? [headlessWasm] : [], build: {
  write: false,
  ...(v2 ? { assetsInlineLimit: Number.MAX_SAFE_INTEGER } : {}),
  lib: { entry: fileURLToPath(new URL(v2 ? './resolver-headless.ts' : './resolver-worker.ts', import.meta.url)), name: 'M14UResolver', formats: ['iife'] },
} });
if (v2 && !inlinedWasm) throw new Error('Expected one inline headless QuickJS module');
const [bundle] = Array.isArray(bundles) ? bundles : [];
const [entry] = bundle?.output ?? [];
if (!Array.isArray(bundles) || bundles.length !== 1 || bundle?.output.length !== 1 || entry?.type !== 'chunk' || !entry.isEntry) {
  throw new Error('Expected exactly one self-contained resolver entry chunk');
}
if (entry.imports.length || entry.dynamicImports.length || (v2 ? Buffer.byteLength(entry.code) : entry.code.length) > 3_000_000) {
  throw new Error('Resolver must be self-contained and within the live resolver code size limit');
}
const code = entry.code;
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Expected a P-256 private key');
}
const signatureFor = (message) => sign('sha256', Buffer.from(message), {
  key, dsaEncoding: 'ieee-p1363',
}).toString('base64');
if (!v2) {
  await writeFile(output, JSON.stringify({ version, code, signature: signatureFor(`m14u-resolver-v1\n${version}\n${code}`) }));
} else {
  const abi = 'androidx-js-1';
  const artifactPath = `/resolvers/v2/${version}/resolver.js`;
  const byteLength = Buffer.byteLength(code);
  const sha256Hex = createHash('sha256').update(code).digest('hex');
  const signature = signatureFor(['m14u-resolver-v2', version, abi, keyId, artifactPath, byteLength, sha256Hex].join('\n'));
  await mkdir(join(output, String(version)), { recursive: true });
  const artifact = join(output, String(version), 'resolver.js');
  try {
    await writeFile(artifact, code, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readFile(artifact)).equals(Buffer.from(code))) throw error;
  }
  const temporary = join(output, `.manifest-${randomUUID()}`);
  await writeFile(temporary, JSON.stringify({ version, abi, keyId, artifactPath, byteLength, sha256Hex, signature }), { flag: 'wx' });
  await rename(temporary, join(output, 'manifest.json'));
}
