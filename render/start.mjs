import { createWebServer } from './web.mjs';
import saavn from './node_modules/.m14u-saavn/dist/server.js';

const port = Number(process.env.PORT || 10000);
createWebServer({ saavn: request => saavn.fetch(request) }).listen(port, '0.0.0.0');
