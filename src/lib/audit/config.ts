// src/lib/audit/config.ts
// The audit's constants. Code reads these; docs/audit-system/audit-system-config.json documents them
// (tests/audit-config.test.ts fails if the weights or rate limits drift apart).

// The ONE place the model id lives. Source: the claude-api skill's model table (cached 2026-11-03).
// The audit reads untrusted site text, so it runs on the current Opus-class model.
export const AUDIT_MODEL = 'claude-opus-5-5';

// Output ceiling per model call. One retry is possible, so the worst case is two calls.
// On this model thinking is always on and its tokens count against this ceiling, so the ceiling covers the model's
// reasoning AND the report. 8000 leaves room for both; a reply cut off here is a miss (retry, then an honest failure),
// never a partial report. This number, the input caps below and the daily limit are what bound a day's spend.
export const AUDIT_MAX_TOKENS = 8000;
// How much the model reasons before answering. Set explicitly: the model's own default can change between releases.
export const AUDIT_EFFORT = 'medium' as const;

// Input ceilings (characters of page text sent to the model).
export const PAGE_TEXT_CAP = 12_000;
export const TOTAL_TEXT_CAP = 60_000;
export const MAX_LINKED_PAGES = 10;
export const TRUNCATION_MARKER = '[truncated]';

// The four areas the free audit can honestly score from page text. Weights sum to 1.
export const ASSESSED_CATEGORIES = [
  { key: 'content_quality', name: 'Content Quality', weight: 0.3 },
  { key: 'seo', name: 'SEO Fundamentals', weight: 0.25 },
  { key: 'structure_cta', name: 'Structure & Calls to Action', weight: 0.25 },
  { key: 'trust_signals', name: 'Trust Signals', weight: 0.2 },
] as const;

export type AssessedKey = (typeof ASSESSED_CATEGORIES)[number]['key'];
export const ASSESSED_KEYS = ASSESSED_CATEGORIES.map((c) => c.key) as [AssessedKey, ...AssessedKey[]];

// Areas that need a rendered page. They are listed in every report, never scored.
export const UNASSESSED_CATEGORIES = [
  'Visual Design & Branding',
  'Mobile Responsiveness',
  'Performance',
  'Accessibility',
] as const;

// Fixed sentences, written here and never by the model.
export const NOT_ASSESSED_LABEL = 'Not assessed in the free audit';
export const NOT_ASSESSED_SENTENCE =
  'Not assessed in the free audit. It needs the page rendered in a browser, which the full review includes.';
export const UNSUPPORTED_SENTENCE =
  'The automated read could not support its findings for this area; it was left out rather than guessed.';

export const THRESHOLDS = { excellent: 9, good: 7, needs_improvement: 5, critical: 0 } as const;

export type ScoreStatus = 'Critical' | 'Needs Improvement' | 'Good' | 'Excellent';

export function statusFor(score: number): ScoreStatus {
  if (score >= THRESHOLDS.excellent) return 'Excellent';
  if (score >= THRESHOLDS.good) return 'Good';
  if (score >= THRESHOLDS.needs_improvement) return 'Needs Improvement';
  return 'Critical';
}

// Weighted average of the assessed areas only, weights renormalised over them, one decimal.
// Returns null when nothing was assessed: there is then no score to show.
export function computeOverallScore(scored: ReadonlyArray<{ score: number; weight: number }>): number | null {
  let weightSum = 0;
  let total = 0;
  for (const { score, weight } of scored) {
    if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 0) continue;
    const clamped = Math.min(10, Math.max(1, score));
    weightSum += weight;
    total += clamped * weight;
  }
  if (weightSum <= 0) return null;
  return Math.round((total / weightSum) * 10) / 10;
}

// Rate limits. Enforced in limits.ts, in memory, PER PROCESS.
export const RATE_LIMITS = {
  per_ip_hourly: 3,
  per_email_daily: 5,
  global_hourly: 100,
} as const;

// Audits started per UTC day, unless AUDIT_DAILY_LIMIT overrides it.
export const DEFAULT_DAILY_LIMIT = 30;

// Lead emails to the admin address per UTC day (a request that is not run automatically becomes a lead for a person).
// A lead spends nothing, so it never uses the audit ceiling above; this separate, generous cap only stops the form
// being used to flood one inbox.
export const LEAD_DAILY_LIMIT = 200;

// Outbound fetch limits (safe-fetch.ts).
export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 5;
export const AUDIT_FETCH_DEADLINE_MS = 45_000;
