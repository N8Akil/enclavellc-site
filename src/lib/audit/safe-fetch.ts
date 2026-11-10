// src/lib/audit/safe-fetch.ts
// The ONLY way the audit reaches out to a website. Every outbound page request goes through safeFetchPage:
//   1. URL rules (scheme, credentials, port, length) on the first URL and on every redirect hop;
//   2. the hostname is resolved ONCE per hop, and the request is refused unless every answer is a public address;
//   3. the connection is pinned to the vetted address (a second DNS answer cannot move it: DNS rebinding);
//   4. redirects are followed by hand, at most FETCH_MAX_REDIRECTS, each hop through 1-3 again;
//   5. a time limit per request, a body cap, and HTML content types only.
// Errors are UnsafeUrlError with a code. Their messages never carry the URL, the hostname or the address,
// because this app's logs carry codes only.
// tests/audit-static.test.ts fails if anything else under src/lib/audit or src/app/api/audit makes a request.

import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import { FETCH_MAX_BYTES, FETCH_MAX_REDIRECTS, FETCH_TIMEOUT_MS } from './config';

export type UnsafeUrlCode =
  | 'BAD_URL'
  | 'BLOCKED_SCHEME'
  | 'HAS_CREDENTIALS'
  | 'BLOCKED_PORT'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'BAD_REDIRECT'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'BAD_CONTENT_TYPE'
  | 'HTTP_STATUS'
  | 'NETWORK';

export class UnsafeUrlError extends Error {
  readonly code: UnsafeUrlCode;
  constructor(code: UnsafeUrlCode) {
    // the code is the whole message, by design
    super(`audit fetch refused: ${code}`);
    this.name = 'UnsafeUrlError';
    this.code = code;
  }
}

export const MAX_URL_LENGTH = 2048;

// ---------------------------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------------------------

// Four bytes, or null when the text is not a plain dotted IPv4 address. Exported for limits.ts.
export function parseIPv4(ip: string): number[] | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function isPublicIPv4(b: number[]): boolean {
  const [a, c, d] = [b[0], b[1], b[2]];
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10/8 private
  if (a === 100 && c >= 64 && c <= 127) return false; // 100.64/10 CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && c === 254) return false; // link-local, cloud metadata
  if (a === 172 && c >= 16 && c <= 31) return false; // 172.16/12 private
  if (a === 192 && c === 0 && d === 0) return false; // 192.0.0/24 IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return false; // 192.0.2/24 documentation
  if (a === 192 && c === 88 && d === 99) return false; // 192.88.99/24 6to4 relay (deprecated)
  if (a === 192 && c === 168) return false; // 192.168/16 private
  if (a === 198 && (c === 18 || c === 19)) return false; // 198.18/15 benchmarking
  if (a === 198 && c === 51 && d === 100) return false; // 198.51.100/24 documentation
  if (a === 203 && c === 0 && d === 113) return false; // 203.0.113/24 documentation
  if (a >= 224) return false; // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  return true;
}

// 16 bytes, or null when the text is not a plain IPv6 address (zone ids are refused).
// Exported for limits.ts, which groups IPv6 callers by their /64.
export function parseIPv6(ip: string): number[] | null {
  if (!isIPv6(ip) || ip.includes('%')) return null;
  let text = ip;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPublicIPv6(b: number[]): boolean {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which also covers :: and ::1):
  // classified by the IPv4 address they carry
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPublicIPv4(b.slice(12));
  if (zero(0, 12)) return isPublicIPv4(b.slice(12));
  // everything public lives in 2000::/3; this refuses fc00::/7, fe80::/10, fec0::/10, ff00::/8,
  // 64:ff9b::/96 (NAT64), 100::/64 and every other range outside global unicast
  if ((b[0] & 0xe0) !== 0x20) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] <= 0x01) return false; // 2001::/23 (Teredo, ORCHID, protocol assignments)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 documentation
  if (b[0] === 0x20 && b[1] === 0x02) return false; // 2002::/16 6to4 (carries an IPv4 address)
  if (b[0] === 0x3f && b[1] === 0xff && b[2] <= 0x0f) return false; // 3fff::/20 documentation
  return true;
}

// True only for a public unicast address written as a plain IPv4 or IPv6 literal. Anything else is false.
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== 'string') return false;
  const v4 = parseIPv4(ip);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isPublicIPv6(v6);
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// URL rules (rule 1)
// ---------------------------------------------------------------------------------------------------------------

// Returns the parsed URL or throws UnsafeUrlError. No network.
export function checkUrl(input: string | URL): URL {
  const raw = typeof input === 'string' ? input : input.href;
  if (raw.length > MAX_URL_LENGTH) throw new UnsafeUrlError('BAD_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('BAD_URL');
  }
  if (url.href.length > MAX_URL_LENGTH) throw new UnsafeUrlError('BAD_URL');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('BLOCKED_SCHEME');
  if (url.username !== '' || url.password !== '') throw new UnsafeUrlError('HAS_CREDENTIALS');
  // new URL() drops a port that is the scheme's default, so anything left is a non-default port
  if (url.port !== '') throw new UnsafeUrlError('BLOCKED_PORT');
  if (url.hostname === '') throw new UnsafeUrlError('BAD_URL');
  return url;
}

// The hostname as new URL() normalised it, without the brackets around an IPv6 literal.
// (new URL() turns 2130706433, 0x7f.0.0.1, 0177.0.0.1 and 127.1 into 127.0.0.1 for http and https.)
function bareHostname(url: URL): string {
  const h = url.hostname;
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

// ---------------------------------------------------------------------------------------------------------------
// Resolver and transport (both injectable, so tests open no socket and do no DNS)
// ---------------------------------------------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  hostname: string;
  // the vetted address the connection must go to
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
  // GET unless a link check asks for HEAD
  method?: 'GET' | 'HEAD';
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy?: () => void;
}
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true });

// node:http / node:https with a lookup that can only answer the vetted address. The Host header and the TLS
// server name stay the hostname, and the certificate is checked against the hostname as usual: pinning the
// address does not weaken that. agent:false: one connection per request, nothing pooled or reused.
//
// The options exist ONLY so a test can point the real transport at a local port and trust a throwaway CA
// (tests/audit-transport.test.ts). Production code never passes them: tests/audit-static.test.ts fails if
// this is called with an argument anywhere under src/.
export interface NodeTransportOptions {
  port?: number;
  ca?: string | Buffer;
}

export function createNodeTransport(options?: NodeTransportOptions): Transport {
  return (request) =>
    new Promise((resolve, reject) => {
      const secure = request.url.protocol === 'https:';
      const pinnedLookup = (
        _hostname: string,
        lookupOptions: unknown,
        callback: (err: Error | null, address: string | ResolvedAddress[], family?: number) => void
      ) => {
        const wantsAll =
          typeof lookupOptions === 'object' && lookupOptions !== null && (lookupOptions as { all?: boolean }).all === true;
        if (wantsAll) callback(null, [{ address: request.address, family: request.family }]);
        else callback(null, request.address, request.family);
      };
      const requestOptions: https.RequestOptions = {
        protocol: request.url.protocol,
        host: request.hostname,
        port: options?.port ?? (secure ? 443 : 80),
        path: `${request.url.pathname}${request.url.search}`,
        method: request.method ?? 'GET',
        headers: request.headers,
        agent: false,
        lookup: pinnedLookup as https.RequestOptions['lookup'],
        signal: request.signal,
        ...(secure && options?.ca !== undefined ? { ca: options.ca } : {}),
      };
      const req = (secure ? https : http).request(requestOptions, (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, destroy: () => res.destroy() });
      });
      req.on('error', reject);
      req.end();
    });
}

// ports 443 and 80, the system's certificate authorities
const defaultTransport: Transport = createNodeTransport();

// ---------------------------------------------------------------------------------------------------------------
// The guarded page fetch
// ---------------------------------------------------------------------------------------------------------------

export interface SafeFetchOptions {
  resolver?: Resolver;
  transport?: Transport;
  // the whole audit's deadline: aborting it fails the request with TIMEOUT
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  // The content types this ONE call accepts. HTML when left out. It can only narrow the choice to other plain
  // text formats the audit reads (robots.txt, sitemap.xml): see READABLE_TYPES. It changes nothing about where a
  // request may go: the URL rules, the address check and the pin run before any response exists to have a type.
  allowedContentTypes?: readonly string[];
}

export interface SafePage {
  // the URL that answered, after redirects
  finalUrl: string;
  html: string;
}

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'EnclaveLLC-AuditBot/1.0 (Website Audit Service)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Encoding': 'identity',
};
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];
// every type a call may ask for. Nothing binary, nothing executable: asking for anything else is refused.
export const READABLE_TYPES: readonly string[] = [...HTML_TYPES, 'text/plain', 'application/xml', 'text/xml'];
export const PLAIN_TEXT_TYPES: readonly string[] = ['text/plain'];
export const XML_TYPES: readonly string[] = ['application/xml', 'text/xml'];

function headerValue(headers: TransportResponse['headers'], name: string): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }
  return '';
}

// Settles with the work, or with TIMEOUT the moment the signal aborts. The abort listener is removed as soon
// as the work settles: this runs once per body chunk, and a listener left behind each time would pile up on
// the signal for the life of the request.
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new UnsafeUrlError('TIMEOUT'));
      // the work's own outcome is not wanted any more; its rejection must not go unhandled
      work.catch(() => {});
      return;
    }
    const onAbort = () => reject(new UnsafeUrlError('TIMEOUT'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function asTyped(error: unknown, signal: AbortSignal): UnsafeUrlError {
  if (error instanceof UnsafeUrlError) return error;
  // the underlying message can carry the host or the address: keep only a code
  return new UnsafeUrlError(signal.aborted ? 'TIMEOUT' : 'NETWORK');
}

// Rules 1-3 for one hop: returns the address the connection is allowed to use.
async function vetHop(url: URL, resolver: Resolver, signal: AbortSignal): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = bareHostname(url);
  const literal = isIP(hostname);
  if (literal) {
    if (!isPublicAddress(hostname)) throw new UnsafeUrlError('BLOCKED_ADDRESS');
    return { address: hostname, family: literal === 6 ? 6 : 4 };
  }
  let answers: ResolvedAddress[];
  try {
    answers = await raceAbort(resolver(hostname), signal);
  } catch (error) {
    throw error instanceof UnsafeUrlError ? error : new UnsafeUrlError(signal.aborted ? 'TIMEOUT' : 'DNS_FAILED');
  }
  if (!Array.isArray(answers) || answers.length === 0) throw new UnsafeUrlError('DNS_FAILED');
  // ANY non-public answer refuses the hop: a name with one public and one private record is not trusted
  for (const answer of answers) {
    if (!answer || typeof answer.address !== 'string' || !isPublicAddress(answer.address)) {
      throw new UnsafeUrlError('BLOCKED_ADDRESS');
    }
  }
  const pinned = answers[0].address;
  return { address: pinned, family: isIP(pinned) === 6 ? 6 : 4 };
}

async function readBody(response: TransportResponse, maxBytes: number, signal: AbortSignal): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  for (;;) {
    const next = await raceAbort(iterator.next(), signal);
    if (next.done) break;
    total += next.value.length;
    // Content-Length is not trusted: the bytes are counted as they arrive
    if (total > maxBytes) throw new UnsafeUrlError('TOO_LARGE');
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// What one guarded exchange is for: a page whose body is read, or a link whose status alone is wanted.
type Purpose =
  | { kind: 'page'; types: readonly string[] }
  | { kind: 'status'; method: 'GET' | 'HEAD'; sameHost: string };

type Outcome = { finalUrl: string; status: number; body: string; leftHost: boolean };

// Rules 1-5 for one request and its redirects. Both public functions below are this and nothing else.
async function guardedRequest(input: string, options: SafeFetchOptions, purpose: Purpose): Promise<Outcome> {
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? defaultTransport;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? FETCH_MAX_REDIRECTS;

  let current = checkUrl(input);

  for (let hop = 0; ; hop++) {
    // one time limit per request: resolve + connect + headers + body
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onOuterAbort, { once: true });

    let response: TransportResponse | undefined;
    try {
      if (controller.signal.aborted) throw new UnsafeUrlError('TIMEOUT');
      const { address, family } = await vetHop(current, resolver, controller.signal);
      response = await raceAbort(
        transport({
          url: current,
          hostname: bareHostname(current),
          address,
          family,
          headers: { ...REQUEST_HEADERS },
          signal: controller.signal,
          method: purpose.kind === 'status' ? purpose.method : 'GET',
        }),
        controller.signal
      );

      if (REDIRECT_STATUSES.has(response.status)) {
        if (hop >= maxRedirects) throw new UnsafeUrlError('TOO_MANY_REDIRECTS');
        const location = headerValue(response.headers, 'location');
        if (!location) throw new UnsafeUrlError('BAD_REDIRECT');
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new UnsafeUrlError('BAD_REDIRECT');
        }
        // rule 1 again on the new URL; rules 2-3 run at the top of the next turn
        const checked = checkUrl(next);
        // a link check never leaves the site it is checking: the redirect is noted, not followed
        if (purpose.kind === 'status' && checked.host !== purpose.sameHost) {
          return { finalUrl: current.href, status: response.status, body: '', leftHost: true };
        }
        current = checked;
        continue;
      }

      // a link check wants the status and nothing else: the body is never read (the response is destroyed below)
      if (purpose.kind === 'status') return { finalUrl: current.href, status: response.status, body: '', leftHost: false };

      if (response.status < 200 || response.status > 299) throw new UnsafeUrlError('HTTP_STATUS');
      const contentType = headerValue(response.headers, 'content-type').split(';')[0].trim().toLowerCase();
      if (!purpose.types.includes(contentType)) throw new UnsafeUrlError('BAD_CONTENT_TYPE');

      const body = await readBody(response, maxBytes, controller.signal);
      return { finalUrl: current.href, status: response.status, body, leftHost: false };
    } catch (error) {
      throw asTyped(error, controller.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onOuterAbort);
      try {
        response?.destroy?.();
      } catch {
        // nothing to do: the socket is already gone
      }
      controller.abort();
    }
  }
}

// Reads one page (or, with allowedContentTypes, one robots.txt or sitemap.xml) through the guard.
export async function safeFetchPage(input: string, options: SafeFetchOptions = {}): Promise<SafePage> {
  const types = options.allowedContentTypes ?? HTML_TYPES;
  // the option can ask only for formats the audit reads as text; it cannot be widened to anything else
  if (types.length === 0 || types.some((type) => !READABLE_TYPES.includes(type))) throw new UnsafeUrlError('BAD_CONTENT_TYPE');
  const { finalUrl, body } = await guardedRequest(input, options, { kind: 'page', types });
  return { finalUrl, html: body };
}

export interface LinkStatus {
  // the HTTP status of the link on the site's own host
  status: number;
  // true when the link redirects to another host: that host is NOT asked, and nothing is known about it
  leftHost: boolean;
}

// Asks one link on the audited site's own host for its status, through the guard. HEAD first, GET only when
// the server says it does not do HEAD (405, 501); no body is ever read. A redirect that stays on the host is
// followed (each hop vetted again); a redirect to any other host is reported and not followed.
export async function safeCheckLink(input: string, sameHost: string, options: SafeFetchOptions = {}): Promise<LinkStatus> {
  // a link on another host is never requested at all
  if (checkUrl(input).host !== sameHost) throw new UnsafeUrlError('BLOCKED_ADDRESS');
  let result = await guardedRequest(input, options, { kind: 'status', method: 'HEAD', sameHost });
  if (!result.leftHost && (result.status === 405 || result.status === 501)) {
    result = await guardedRequest(input, options, { kind: 'status', method: 'GET', sameHost });
  }
  return { status: result.status, leftHost: result.leftHost };
}
