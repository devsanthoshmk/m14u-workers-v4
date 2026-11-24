import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWebServer } from './web.mjs';
import saavn from '../node_modules/.m14u-saavn/dist/server.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (!(await stat(`${dist}index.html`)).isFile()) throw new Error('SPA build is missing');
const port = Number(process.env.PORT || 10000);
createWebServer({ dist, saavn: (request) => saavn.fetch(request) }).listen(port, '0.0.0.0', () => {
  console.log(`M14U listening on port ${port}`);
});
