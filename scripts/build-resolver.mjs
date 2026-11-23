import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const [versionArg, keyPath, output] = process.argv.slice(2);
const version = Number(versionArg);
if (!Number.isSafeInteger(version) || version < 1 || !keyPath || !output) {
  throw new Error('Usage: node scripts/build-resolver.mjs VERSION PRIVATE_KEY_PEM OUTPUT_JSON');
}

const bundles = await build({ configFile: false, build: {
  write: false,
  lib: { entry: fileURLToPath(new URL('./resolver-worker.ts', import.meta.url)), name: 'M14UResolver', formats: ['iife'] },
} });
const [bundle] = Array.isArray(bundles) ? bundles : [];
const [entry] = bundle?.output ?? [];
if (!Array.isArray(bundles) || bundles.length !== 1 || bundle?.output.length !== 1 || entry?.type !== 'chunk' || !entry.isEntry) {
  throw new Error('Expected exactly one self-contained resolver entry chunk');
}
if (entry.imports.length || entry.dynamicImports.length || entry.code.length > 3_000_000) {
  throw new Error('Resolver must be self-contained and within the live resolver code size limit');
}
const code = entry.code;
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Expected a P-256 private key');
}
const signature = sign('sha256', Buffer.from(`m14u-resolver-v1\n${version}\n${code}`), {
  key, dsaEncoding: 'ieee-p1363',
}).toString('base64');
await writeFile(output, JSON.stringify({ version, code, signature }));
