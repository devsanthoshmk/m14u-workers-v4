import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey, sign } from 'node:crypto';
import { build } from 'vite';

const [versionArg, keyPath, output] = process.argv.slice(2);
const version = Number(versionArg);
if (!Number.isSafeInteger(version) || version < 1 || !keyPath || !output) {
  throw new Error('Usage: node scripts/build-resolver.mjs VERSION PRIVATE_KEY_PEM OUTPUT_JSON');
}

const [bundle] = await build({ configFile: false, build: {
  write: false,
  lib: { entry: 'scripts/resolver-worker.ts', name: 'M14UResolver', formats: ['iife'] },
} });
const code = bundle.output.find(item => item.type === 'chunk').code;
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Expected a P-256 private key');
}
const signature = sign('sha256', Buffer.from(`m14u-resolver-v1\n${version}\n${code}`), {
  key, dsaEncoding: 'ieee-p1363',
}).toString('base64');
await writeFile(output, JSON.stringify({ version, code, signature }));
