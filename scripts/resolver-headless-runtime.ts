// Deliberately partial Web API surface for the anonymous resolver, not a browser polyfill.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const size = Math.floor(value.replace(/=+$/, '').length * 6 / 8);
  const output = new Uint8Array(size);
  let bits = 0, pending = 0, index = 0;
  for (const ch of value.replace(/=+$/, '')) {
    const digit = alphabet.indexOf(ch);
    if (digit < 0) throw new Error('Invalid base64');
    pending = (pending << 6) | digit;
    bits += 6;
    if (bits >= 8) output[index++] = pending >>> (bits -= 8);
  }
  return output;
}
function toBase64(value: string) {
  let result = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i), b = value.charCodeAt(i + 1), c = value.charCodeAt(i + 2);
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < value.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < value.length ? alphabet[c & 63] : '=');
  }
  return result;
}
class Encoder {
  encode(value = '') { return Uint8Array.from(unescape(encodeURIComponent(value)), (ch) => ch.charCodeAt(0)); }
}
class Decoder {
  decode(input: ArrayBuffer | ArrayBufferView = new ArrayBuffer(0)) {
    const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    const chunks: string[] = [];
    let units: number[] = [];
    for (let i = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0; i < bytes.length;) {
      const first = bytes[i++];
      let cp = first;
      if (first >= 128) {
        const count = first >= 194 && first < 224 ? 1 : first < 240 && first >= 224 ? 2 : first >= 240 && first < 245 ? 3 : 0;
        cp = count ? first & (127 >> (count + 1)) : 0xfffd;
        for (let j = 0; j < count; j++) {
          const next = bytes[i];
          if ((next & 192) !== 128 || j === 0 && (first === 224 && next < 160 || first === 237 && next >= 160 ||
              first === 240 && next < 144 || first === 244 && next >= 144)) { cp = 0xfffd; break; }
          i++; cp = (cp << 6) | (next & 63);
        }
      }
      if (cp <= 0xffff) units.push(cp);
      else { cp -= 0x10000; units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
      if (units.length >= 8192) { chunks.push(String.fromCharCode(...units)); units = []; }
    }
    return chunks.join('') + String.fromCharCode(...units);
  }
}
class Params {
  private pairs: [string, string][] = [];
  constructor(query = '', private changed = () => {}) {
    const decode = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
    this.pairs = query.replace(/^\?/, '').split('&').filter(Boolean).map((entry) => {
      const i = entry.indexOf('=');
      return i < 0 ? [decode(entry), ''] : [decode(entry.slice(0, i)), decode(entry.slice(i + 1))];
    });
  }
  get(k: string) { return this.pairs.find(([name]) => name === k)?.[1] ?? null; }
  has(k: string) { return this.get(k) !== null; }
  append(k: string, v: string) { this.pairs.push([String(k), String(v)]); this.changed(); }
  set(k: string, v: string) {
    const i = this.pairs.findIndex(([name]) => name === k);
    if (i < 0) return this.append(k, v);
    this.pairs[i][1] = String(v);
    this.pairs = this.pairs.filter(([name], j) => j <= i || name !== k);
    this.changed();
  }
  delete(k: string) { this.pairs = this.pairs.filter(([name]) => name !== k); this.changed(); }
  toString() {
    const encode = (s: string) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return this.pairs.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  }
}
class HttpsUrl {
  readonly protocol = 'https:';
  readonly username = '';
  readonly password = '';
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly origin: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: Params;
  constructor(input: unknown, base?: unknown) {
    let value = String(input);
    if (!/^https:\/\//i.test(value) && base) {
      const from = new HttpsUrl(base);
      if (value.startsWith('//')) throw new Error('Unsupported URL');
      value = from.origin + (value.startsWith('/') ? value : from.pathname.replace(/[^/]*$/, '') + value);
    }
    const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(value);
    if (!match) throw new Error('Unsupported URL');
    this.hostname = match[1].toLowerCase();
    this.port = match[2] === '443' ? '' : match[2] ?? '';
    this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname;
    this.origin = `https://${this.host}`;
    this.pathname = match[3] ?? '/';
    this.search = match[4] ?? '';
    this.hash = match[5] ?? '';
    this.searchParams = new Params(this.search, () => { this.search = `?${this.searchParams}`; });
  }
  get href() { return this.toString(); }
  toString() { return `${this.origin}${this.pathname}${this.search}${this.hash}`; }
}
class BrokerHeaders {
  private data: Map<string, string>;
  constructor(input?: BrokerHeaders | Record<string, string> | [string, string][]) {
    this.data = new Map();
    const entries = input instanceof BrokerHeaders ? input.data : Array.isArray(input) ? input : Object.entries(input ?? {});
    for (const [k, v] of entries) this.set(k, v);
  }
  get(k: string) { return this.data.get(k.toLowerCase()) ?? null; }
  set(k: string, v: string) { this.data.set(k.toLowerCase(), String(v)); }
  delete(k: string) { this.data.delete(k.toLowerCase()); }
  has(k: string) { return this.get(k) !== null; }
  toJSON() { return Object.fromEntries(this.data); }
}
class BrokerRequest {
  url: string;
  method: string;
  headers: BrokerHeaders;
  body: unknown;
  signal: { throwIfAborted(): void };
  constructor(input: unknown, init?: Partial<BrokerRequest>) {
    const prior = input instanceof BrokerRequest ? input : undefined;
    this.url = input instanceof BrokerRequest ? input.url : String(input);
    this.method = init?.method ?? prior?.method ?? 'GET';
    this.headers = new BrokerHeaders(init?.headers ?? prior?.headers);
    this.body = init?.body ?? prior?.body;
    this.signal = init?.signal ?? prior?.signal ?? { throwIfAborted() {} };
  }
}
export type HttpReply = { status: number; body: string; type: string };
type HttpRequest = { id: number; url: string; method: string; headers: BrokerHeaders; body: string | null };
const outbox: HttpRequest[] = [];
const pending = new Map<number, (reply: HttpReply | null) => void>();
let sequence = 0;
export const pump = {
  requests: () => outbox.splice(0),
  reply(id: number, value: HttpReply | null) { pending.get(id)?.(value); pending.delete(id); },
};
export const httpFetch = (async (input: unknown, init?: Partial<BrokerRequest>) => {
  const request = new BrokerRequest(input, init);
  const body = init?.body ?? request.body ?? null;
  if (body !== null && typeof body !== 'string') throw new Error('Unsupported request body');
  const id = ++sequence;
  if (id > 12 || pending.size >= 4) throw new Error('HTTP limit');
  const reply = await new Promise<HttpReply | null>((resolve) => {
    pending.set(id, resolve);
    outbox.push({ id, url: request.url, method: request.method, headers: request.headers, body });
  });
  if (!reply) throw new Error('HTTP unavailable');
  const bytes = fromBase64(reply.body);
  const text = async () => new Decoder().decode(bytes);
  return { url: request.url, ok: reply.status >= 200 && reply.status < 300, status: reply.status,
    headers: new BrokerHeaders({ 'content-type': reply.type }), text,
    json: async (): Promise<unknown> => JSON.parse(await text()), arrayBuffer: async () => bytes.buffer };
}) as typeof fetch;

Object.assign(globalThis, {
  URL: HttpsUrl, URLSearchParams: Params, TextEncoder: Encoder, TextDecoder: Decoder,
  Headers: BrokerHeaders, Request: BrokerRequest, fetch: httpFetch,
  CustomEvent: class { detail: unknown; constructor(readonly type: string, init?: {detail?: unknown}) { this.detail = init?.detail; } },
  EventTarget: class {
    private events = new Map<string, Set<(event: { type: string }) => void>>();
    addEventListener(type: string, listener: (event: {type: string}) => void) {
      const listeners = this.events.get(type) ?? new Set(); listeners.add(listener); this.events.set(type, listeners);
    }
    removeEventListener(type: string, listener: (event: {type: string}) => void) { this.events.get(type)?.delete(listener); }
    dispatchEvent(event: {type: string}) { this.events.get(event.type)?.forEach((listener) => listener(event)); return true; }
  },
  atob: (value: string) => Array.from(fromBase64(value), (byte) => String.fromCharCode(byte)).join(''),
  btoa: toBase64,
  console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
});
