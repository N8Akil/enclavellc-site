// src/lib/audit/limits.ts
// Rate limits and the daily ceiling for the free audit. Checked BEFORE any outbound request or model call.
//
// PLAINLY: these counts live in this process's memory.
//   - They reset whenever the process restarts.
//   - They are PER PROCESS. The site runs as one PM2 fork-mode instance today, so the numbers below are the
//     real limits. If it ever runs as more than one process, every limit multiplies by the process count,
//     including the daily ceiling, and this needs a shared store before that happens.
//
// The limits (config.ts RATE_LIMITS, DEFAULT_DAILY_LIMIT):
//   - 3 requests per client per hour         (sliding window). A client is an IPv4 address or an IPv6 /64:
//                                             one IPv6 subscriber holds a whole /64 and can use a new address
//                                             from it for every request, so the /64 is what gets counted.
//   - 5 requests per email address per day   (sliding 24 h window). The address is trimmed, lower-cased and has
//                                             any +tag removed, so name+1@ and name+2@ are one address.
//   - 100 requests per hour across everyone  (sliding window). This is NOT redundant with the 30-a-day audit
//                                             ceiling below: a request that is not run automatically (a lead)
//                                             never touches that ceiling, and leads are only bounded by 200 a
//                                             day. The hourly limit is what bounds how FAST anything at all,
//                                             leads included, can be made to happen through this form.
//   - 30 audits started per UTC day, or AUDIT_DAILY_LIMIT if it is a positive integer. A slot is spent only by an
//                                             audit admitted to run or to wait in the queue: the route gives the
//                                             slot back (returnAuditSlot) when the request is not admitted after all
//   - 200 lead emails per UTC day (a request that is not run automatically; it never uses the 30)
//
// Nothing here is logged. Keys are SHA-256 hashes of the client bucket and of the normalised email, and a key is
// dropped as soon as its window has passed.
//
// More than one process: a PM2 cluster worker refuses every request (see decide()). The limits need a shared store
// before the site can run that way.
//
// The daily ceiling FAILS CLOSED: if anything about the check throws, the clock is not a number, or the
// counter is not in a state this code wrote, the request is refused as if the daily limit were reached.

import cluster from 'node:cluster';
import { createHash } from 'node:crypto';
import { DEFAULT_DAILY_LIMIT, LEAD_DAILY_LIMIT, RATE_LIMITS } from './config';
import { auditSetting } from './env';
import { parseIPv4, parseIPv6 } from './safe-fetch';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type LimitCause = 'ip' | 'email' | 'global' | 'daily';
export type LimitDecision =
  | { allowed: true }
  | { allowed: false; cause: LimitCause; retryAfterSeconds?: number };

export interface DailyState {
  day: number;
  count: number;
}

export interface AuditLimiterOptions {
  now?: () => number;
  // true when this process is one of several workers sharing the port (PM2 cluster mode); injectable for tests
  isClusterWorker?: () => boolean;
  // the ceiling for audits started per UTC day; read on every check
  dailyLimit?: () => number;
  // the daily counter; injectable so a test can put it in a broken state
  dailyState?: DailyState;
  // the daily lead-mail counter and its cap; injectable for the same reason
  leadState?: DailyState;
  leadLimit?: number;
}

// A positive integer, or the default. "0", "-1", "3.5", "ten", "" and undefined all fall back.
export function parseDailyLimit(raw: string | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw.trim())) return DEFAULT_DAILY_LIMIT;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : DEFAULT_DAILY_LIMIT;
}

const hashKey = (kind: string, value: string): string =>
  createHash('sha256').update(`${kind}:${value}`).digest('hex');

// The client's address, from ONE header: cf-connecting-ip, which Cloudflare sets itself on every request it
// passes on (a value the caller sent under that name is replaced). It is trustworthy because the origin is
// reachable through the Cloudflare tunnel only. x-forwarded-for is deliberately NOT read: if the origin were ever
// reachable directly, a caller could set that header and pick its own bucket on every request.
// A request with no cf-connecting-ip did not come through Cloudflare; all such callers share the one "unknown"
// bucket, which is the safe direction.
export function clientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

// What a client is counted as. IPv4: the address. IPv6: its /64 (the first four groups, after the address is
// properly expanded by the same parser the fetch guard uses), because a single subscriber is routed a whole /64.
// An IPv4 address written inside IPv6 (::ffff:a.b.c.d) counts as that IPv4 address. Anything else is counted as
// the text it is, so "unknown" stays one bucket.
export function ipBucket(ip: string): string {
  const text = ip.trim().toLowerCase();
  if (parseIPv4(text)) return text;
  const bytes = parseIPv6(text);
  if (!bytes) return text;
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12).join('.');
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return `${groups.join(':')}::/64`;
}

// The address a per-email count is kept under: trimmed, lower-cased, +tag removed from the part before the @.
// Dots stay (only some providers ignore them, and treating two people's addresses as one would be worse).
export function emailBucket(email: string): string {
  const text = email.trim().toLowerCase();
  const at = text.lastIndexOf('@');
  if (at < 1) return text;
  const local = text.slice(0, at);
  const plus = local.indexOf('+');
  return `${plus > 0 ? local.slice(0, plus) : local}${text.slice(at)}`;
}

export function createAuditLimiter(options: AuditLimiterOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const dailyLimit = options.dailyLimit ?? (() => parseDailyLimit(auditSetting('AUDIT_DAILY_LIMIT')));
  const daily: DailyState = options.dailyState ?? { day: -1, count: 0 };
  const isClusterWorker = options.isClusterWorker ?? (() => cluster.isWorker);
  const leads: DailyState = options.leadState ?? { day: -1, count: 0 };
  const leadLimit = options.leadLimit ?? LEAD_DAILY_LIMIT;
  const byIp = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  let globalHits: number[] = [];

  const prune = (map: Map<string, number[]>, cutoff: number) => {
    for (const [key, hits] of map) {
      const live = hits.filter((t) => t > cutoff);
      if (live.length) map.set(key, live);
      else map.delete(key);
    }
  };
  const retryAfter = (oldest: number, windowMs: number, t: number) =>
    Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));

  // audit: true takes one of the day's audit slots; false is a request that will not be run automatically (it
  // becomes a lead), which must pass the per-person and hourly limits but never uses the audit ceiling.
  function decide(ip: string, email: string, audit: boolean): LimitDecision {
    // These counts are only the real limits in ONE process. The site's PM2 entry was made by hand (fork mode, one
    // instance, read on the server 2026-11-10); if it is ever started in cluster mode every worker would keep its own
    // counts and each limit would multiply. So a cluster worker refuses outright instead of counting: fail closed.
    if (isClusterWorker()) return { allowed: false, cause: 'daily' };
    const t = now();
    if (!Number.isFinite(t)) return { allowed: false, cause: 'daily' };
    const limit = dailyLimit();
    if (!Number.isSafeInteger(limit) || limit < 1) return { allowed: false, cause: 'daily' };

    // forget everything older than its window, whoever is asking
    prune(byIp, t - HOUR_MS);
    prune(byEmail, t - DAY_MS);
    globalHits = globalHits.filter((hit) => hit > t - HOUR_MS);

    const today = Math.floor(t / DAY_MS);
    // the counter must be in a state this code wrote; otherwise refuse (and keep refusing) rather than heal it
    if (!Number.isSafeInteger(daily.day) || daily.day < -1 || !Number.isSafeInteger(daily.count) || daily.count < 0) {
      return { allowed: false, cause: 'daily' };
    }
    // a new UTC day starts a new count; a clock that steps backwards does not
    if (today > daily.day) {
      daily.day = today;
      daily.count = 0;
    }

    const ipKey = hashKey('ip', ipBucket(ip));
    const emailKey = hashKey('email', emailBucket(email));
    const ipHits = byIp.get(ipKey) ?? [];
    const emailHits = byEmail.get(emailKey) ?? [];

    if (ipHits.length >= RATE_LIMITS.per_ip_hourly) {
      return { allowed: false, cause: 'ip', retryAfterSeconds: retryAfter(ipHits[0], HOUR_MS, t) };
    }
    if (emailHits.length >= RATE_LIMITS.per_email_daily) {
      return { allowed: false, cause: 'email', retryAfterSeconds: retryAfter(emailHits[0], DAY_MS, t) };
    }
    if (globalHits.length >= RATE_LIMITS.global_hourly) {
      return { allowed: false, cause: 'global', retryAfterSeconds: retryAfter(globalHits[0], HOUR_MS, t) };
    }
    if (audit && daily.count >= limit) {
      return { allowed: false, cause: 'daily', retryAfterSeconds: Math.max(1, Math.ceil(((today + 1) * DAY_MS - t) / 1000)) };
    }

    // allowed: the attempt is counted now, whatever happens to it later
    byIp.set(ipKey, [...ipHits, t]);
    byEmail.set(emailKey, [...emailHits, t]);
    globalHits.push(t);
    if (audit) daily.count += 1;
    return { allowed: true };
  }

  // One lead email to the admin address. Its own daily cap, counted here; fails closed like the audit ceiling.
  function takeLeadSlot(): boolean {
    if (isClusterWorker()) return false;
    const t = now();
    if (!Number.isFinite(t)) return false;
    if (!Number.isSafeInteger(leadLimit) || leadLimit < 1) return false;
    if (!Number.isSafeInteger(leads.day) || leads.day < -1 || !Number.isSafeInteger(leads.count) || leads.count < 0) return false;
    const today = Math.floor(t / DAY_MS);
    if (today > leads.day) {
      leads.day = today;
      leads.count = 0;
    }
    if (leads.count >= leadLimit) return false;
    leads.count += 1;
    return true;
  }

  // Gives back ONE of today's audit slots, taken by an allowed check() whose audit was then not admitted (the queue
  // was full, or the request failed before it was accepted). Only today's count is ever lowered, never below zero:
  // a slot taken before the UTC day changed belongs to a count that is gone already. The per-person and hourly
  // counts are not touched: the attempt still happened.
  function giveBackAuditSlot(): void {
    if (isClusterWorker()) return;
    const t = now();
    if (!Number.isFinite(t)) return;
    if (!Number.isSafeInteger(daily.day) || !Number.isSafeInteger(daily.count) || daily.count < 1) return;
    if (Math.floor(t / DAY_MS) !== daily.day) return;
    daily.count -= 1;
  }

  return {
    // Checks every limit and, when all pass, counts the attempt. A refused attempt is not counted.
    check(ip: string, email: string, options: { audit?: boolean } = {}): LimitDecision {
      try {
        return decide(ip, email, options.audit !== false);
      } catch {
        // fail closed
        return { allowed: false, cause: 'daily' };
      }
    },
    // The caller took an audit slot with check() and the audit was NOT admitted: the slot goes back. Call it at
    // most once per slot taken (the route keeps a flag for that).
    returnAuditSlot(): void {
      try {
        giveBackAuditSlot();
      } catch {
        // nothing given back: the safe direction (the slot stays spent)
      }
    },
    // May one more lead email go to the admin address today? Counts it when the answer is yes.
    takeLead(): boolean {
      try {
        return takeLeadSlot();
      } catch {
        return false;
      }
    },
    // for tests
    reset() {
      byIp.clear();
      byEmail.clear();
      globalHits = [];
      daily.day = -1;
      daily.count = 0;
      leads.day = -1;
      leads.count = 0;
    },
    // how many keys are held right now (for the "nothing is kept past its window" test)
    size() {
      return { ips: byIp.size, emails: byEmail.size, global: globalHits.length };
    },
  };
}

// The one limiter the route uses.
export const auditLimiter = createAuditLimiter();

export const RATE_LIMIT_MESSAGES: Record<LimitCause, string> = {
  ip: "You've requested several audits recently. Please try again later, or email n.garrett@enclavellc.net.",
  email: "You've requested several audits recently. Please try again later, or email n.garrett@enclavellc.net.",
  global: "The free audit has reached its limit for today. Please email n.garrett@enclavellc.net and we'll run yours by hand.",
  daily: "The free audit has reached its limit for today. Please email n.garrett@enclavellc.net and we'll run yours by hand.",
};

// Said instead of the daily sentence above when the visitor's request was passed on as a lead: they need do nothing more.
export const CEILING_LEAD_MESSAGE =
  'The free audit has reached its limit for today. Nate has your request and will run yours by hand.';
