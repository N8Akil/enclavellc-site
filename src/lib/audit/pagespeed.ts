// src/lib/audit/pagespeed.ts
// Google's PageSpeed Insights test of the audited site, on a simulated phone: one request, turned into a short,
// fixed set of measures whose words are written HERE, from the numbers in Google's answer, plus Google's phone
// screenshot of the home page. What goes wrong comes back as a code, and only a code: never Google's body, never
// the key.
//
// Google is a fixed, trusted host, so this does not go through the guard in safe-fetch.ts, which is for the audited site.
// THE KEY is a secret. It travels only in the X-Goog-Api-Key header, never in the URL; redirects are refused, so the
// header is never carried to another host; and it is never logged, thrown, put in a result, or sent to the model.
// What Google measures is one lab run, not real visitors: nothing here reads or claims real-user numbers.
import { auditSetting } from './env';
import { sameSite } from './fetch-website';
import type { Measurements } from './types';

export const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const PAGESPEED_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
// A run usually takes 10 to 30 seconds; past this it is given up and Speed is not assessed.
export const PAGESPEED_TIMEOUT_MS = 45_000;
// Google's whole answer is well under a megabyte; anything far past that is not read.
const MAX_BODY_CHARS = 8_000_000;
// The phone screenshot is about 30 KB; this is the most kept (run-audit.ts holds it to its own cap as well).
const MAX_SCREENSHOT_BASE64 = 2_000_000;

export type PageSpeedCode =
  | 'no_key'
  | 'bad_url'
  | 'timeout'
  | 'aborted'
  | 'network'
  | `http_${number}`
  | 'bad_json'
  | 'runtime_error'
  | 'other_site';

export type PageSpeedResult = { ok: true; measurements: Extract<Measurements, { ok: true }> } | { ok: false; code: PageSpeedCode };

export interface PageSpeedOptions {
  // left out: read from the GOOGLE_PAGESPEED_API_KEY setting
  apiKey?: string;
  // a stand-in for tests; left out, the platform's own: the one request in the audit code made outside the guard,
  // allowed by tests/audit-static.test.ts for this file and this endpoint only
  fetch?: typeof fetch;
  timeoutMs?: number;
  // the caller's own abort (the pipeline aborts when the site cannot be read)
  signal?: AbortSignal;
}

// The address Google is asked to test: the audited site's normalised URL (as validateUrl and the fetcher make it:
// scheme, host and path; no query, fragment, trailing slash or credentials). Nothing else the visitor typed.
function siteAddress(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function pageSpeedRequestUrl(address: string): string {
  const params = new URLSearchParams({ url: address, strategy: 'mobile' });
  for (const category of PAGESPEED_CATEGORIES) params.append('category', category);
  return `${PAGESPEED_ENDPOINT}?${params.toString()}`;
}

export async function runPageSpeed(siteUrl: string, options: PageSpeedOptions = {}): Promise<PageSpeedResult> {
  const key = (options.apiKey ?? auditSetting('GOOGLE_PAGESPEED_API_KEY') ?? '').trim();
  // a key that could not be a header value is treated as no key: nothing is sent
  if (!key || !/^[\x21-\x7e]+$/.test(key)) return { ok: false, code: 'no_key' };
  const address = siteAddress(siteUrl);
  if (!address) return { ok: false, code: 'bad_url' };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? PAGESPEED_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let body: string;
    try {
      const response = await (options.fetch ?? globalThis.fetch)(pageSpeedRequestUrl(address), {
        method: 'GET',
        headers: { 'X-Goog-Api-Key': key, accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      // the status only: Google's error body can name the key or the request
      if (!response.ok) return { ok: false, code: `http_${response.status}` };
      body = await response.text();
    } catch {
      // the error itself is never kept: its message can carry a header value
      if (timedOut) return { ok: false, code: 'timeout' };
      if (controller.signal.aborted) return { ok: false, code: 'aborted' };
      return { ok: false, code: 'network' };
    }
    if (body.length > MAX_BODY_CHARS) return { ok: false, code: 'bad_json' };
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, code: 'bad_json' };
    }
    return readPageSpeed(json, address);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Google's answer, read
// ---------------------------------------------------------------------------------------------------------------

type Measure = { value: number; unit: string; display: string };
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// A finite, non-negative number at audits[id].numericValue, or null.
function numeric(audits: Json, id: string): number | null {
  const audit = audits[id];
  const value = isObject(audit) ? audit.numericValue : undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
// A category's score, 0 to 1, as a whole number out of 100, or null (Google gives null when a category failed).
function categoryScore(categories: Json, id: string): number | null {
  const category = categories[id];
  const score = isObject(category) ? category.score : undefined;
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? Math.round(score * 100) : null;
}

// THE MEASURES. Fixed ids, fixed words; the one number in each is computed here from Google's raw value and rounded
// the same way every time: seconds to one decimal, milliseconds and kilobytes to whole numbers, the layout-shift
// score to two decimals, category scores to a whole number out of 100. Google's own displayValue is never used.
function buildMeasures(audits: Json, categories: Json): Record<string, Measure> {
  const measures: Record<string, Measure> = {};
  const score = (id: string, category: string, words: (n: number) => string) => {
    const n = categoryScore(categories, category);
    if (n !== null) measures[id] = { value: n, unit: 'of 100', display: words(n) };
  };
  const seconds = (id: string, audit: string, words: (s: string) => string) => {
    const ms = numeric(audits, audit);
    if (ms === null) return;
    const s = (ms / 1000).toFixed(1);
    measures[id] = { value: Number(s), unit: 's', display: words(s) };
  };

  score('performance_score', 'performance', (n) => `Google's performance score for a phone: ${n} of 100`);
  seconds('largest_contentful_paint', 'largest-contentful-paint', (s) => `the main content appeared after ${s} seconds on a phone (Google's test)`);
  seconds('first_contentful_paint', 'first-contentful-paint', (s) => `the first text or image appeared after ${s} seconds on a phone (Google's test)`);
  seconds('speed_index', 'speed-index', (s) => `most of the screen had filled in after ${s} seconds on a phone (Google's speed index)`);

  const blocking = numeric(audits, 'total-blocking-time');
  if (blocking !== null) {
    const ms = Math.round(blocking);
    measures.total_blocking_time = { value: ms, unit: 'ms', display: `the page was too busy to answer a tap for ${ms} milliseconds in all (Google's test)` };
  }
  const shift = numeric(audits, 'cumulative-layout-shift');
  if (shift !== null) {
    const cls = shift.toFixed(2);
    measures.layout_shift = { value: Number(cls), unit: 'score', display: `layout shift score ${cls}: how much the page jumps while it loads (Google's test; 0 is best)` };
  }
  const bytes = numeric(audits, 'total-byte-weight');
  if (bytes !== null) {
    const kb = Math.round(bytes / 1024);
    measures.page_weight =
      kb < 1024
        ? { value: kb, unit: 'KB', display: `the page weighs ${kb} KB in all (Google's test)` }
        : (() => {
            const mb = (bytes / (1024 * 1024)).toFixed(1);
            return { value: Number(mb), unit: 'MB', display: `the page weighs ${mb} MB in all (Google's test)` };
          })();
  }

  score('accessibility_score', 'accessibility', (n) => `Google's accessibility score: ${n} of 100`);
  score('best_practices_score', 'best-practices', (n) => `Google's best-practices score: ${n} of 100`);
  score('seo_score', 'seo', (n) => `Google's search (SEO) score: ${n} of 100`);
  return measures;
}

const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

// Google's final phone screenshot: a data: URI of a picture. Kept only when it is base64 of the type it says it is
// (checked on the decoded bytes) and within the size cap; otherwise there is simply no screenshot.
function readScreenshot(audits: Json): { mediaType: string; dataBase64: string } | undefined {
  const audit = audits['final-screenshot'];
  const details = isObject(audit) ? audit.details : undefined;
  const data = isObject(details) ? details.data : undefined;
  if (typeof data !== 'string') return undefined;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length > MAX_SCREENSHOT_BASE64) return undefined;
  const [, mediaType, dataBase64] = match;
  const bytes = Buffer.from(dataBase64, 'base64');
  // strict: the text must be exactly the bytes' base64, so nothing was dropped in decoding
  if (bytes.toString('base64') !== dataBase64 || !SIGNATURES[mediaType](bytes)) return undefined;
  return { mediaType, dataBase64 };
}

export function readPageSpeed(json: unknown, address: string): PageSpeedResult {
  const lighthouse = isObject(json) ? json.lighthouseResult : undefined;
  if (!isObject(lighthouse)) return { ok: false, code: 'bad_json' };
  // Lighthouse ran but could not test the page: nothing it reports is a measurement of the site
  if (lighthouse.runtimeError !== undefined && lighthouse.runtimeError !== null) return { ok: false, code: 'runtime_error' };
  const { audits, categories } = lighthouse;
  if (!isObject(audits)) return { ok: false, code: 'bad_json' };

  // the test must have ended on the audited site (or its www/apex twin), or the numbers are another site's
  const ended = lighthouse.finalDisplayedUrl ?? lighthouse.finalUrl;
  if (typeof ended === 'string') {
    try {
      if (!sameSite(new URL(address).hostname)(new URL(ended).hostname)) return { ok: false, code: 'other_site' };
    } catch {
      return { ok: false, code: 'bad_json' };
    }
  }

  const measures = buildMeasures(audits, isObject(categories) ? categories : {});
  if (Object.keys(measures).length === 0) return { ok: false, code: 'bad_json' };
  const screenshot = readScreenshot(audits);
  return { ok: true, measurements: { ok: true, measures, ...(screenshot ? { screenshot } : {}) } };
}

// For the pipeline: the result as the model step takes it. A failure is { ok: false, reason: <code> }.
export async function pageSpeedMeasurements(siteUrl: string, options: PageSpeedOptions = {}): Promise<Measurements> {
  const result = await runPageSpeed(siteUrl, options);
  return result.ok ? result.measurements : { ok: false, reason: result.code };
}
