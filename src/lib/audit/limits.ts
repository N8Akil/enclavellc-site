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
//   - 3 audits per client IP per hour        (sliding window)
//   - 5 audits per email address per day     (sliding 24 h window)
//   - 100 audits per hour across everyone    (sliding window)
//   - 30 audits started per UTC day, or AUDIT_DAILY_LIMIT if it is a positive integer
//   - 200 lead emails per UTC day (a request that is not run automatically; it never uses the 30)
//
// Nothing here is logged. Keys are SHA-256 hashes of the IP and of the lower-cased email, and a key is
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

// The client's address as Cloudflare reports it. These headers are trustworthy ONLY because the origin is
// reachable through the Cloudflare tunnel alone; if the origin is ever exposed directly, a caller can set
// them and choose its own bucket. Callers with no usable header all share the "unknown" bucket, which is
// the safe direction.
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return 'unknown';
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

    const ipKey = hashKey('ip', ip);
    const emailKey = hashKey('email', email.trim().toLowerCase());
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
