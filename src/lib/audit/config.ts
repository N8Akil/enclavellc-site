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

// Who the audit is written for. "home_care" changes one printed area name, adds the home-care checks and a short
// block in the prompt; the schema and every check are the same.
export const NICHES = ['general', 'home_care'] as const;
export type Niche = (typeof NICHES)[number];

// The five areas. Weights sum to 1; the overall score is their weighted average over the areas that were assessed.
export const AREAS = [
  { key: 'found', name: 'Found', weight: 0.2 },
  { key: 'first_impression', name: 'First impression', weight: 0.2 },
  { key: 'speed', name: 'Speed', weight: 0.2 },
  { key: 'next_step', name: 'Clear next step', weight: 0.25 },
  { key: 'trust', name: 'Trust', weight: 0.15 },
] as const;

export type AreaKey = (typeof AREAS)[number]['key'];
export const AREA_KEYS = AREAS.map((a) => a.key) as [AreaKey, ...AreaKey[]];

// The name printed for an area. One differs by niche: a home-care site has two doors (families, caregivers).
export function areaName(key: AreaKey, niche: Niche): string {
  if (key === 'next_step' && niche === 'home_care') return 'Two clear doors';
  return AREAS.find((a) => a.key === key)!.name;
}

// Fixed sentences, written here and never by the model.
export const NOT_ASSESSED_LABEL = 'Not assessed';
// Speed needs a measurement from outside this code. Without one it is never guessed.
export const NOT_MEASURED_SENTENCE = 'Not measured in this audit.';
export const UNSUPPORTED_SENTENCE =
  'The automated read could not support its findings for this area; it was left out rather than guessed.';

// What the model may return, in characters. A string over its limit makes the whole reply a miss: nothing is
// shortened or cut to fit. (The one cut code makes is the ranking cut of findings to MAX_FINDINGS.)
export const LIMITS = {
  whereYouStand: 110,
  workingTitle: 45,
  workingLine: 120,
  fixHeadline: 70,
  fixWhatWeSaw: 170,
  fixWhyItMatters: 130,
  fixTheFix: 110,
  areaLine: 120,
  findingText: 170,
  calloutTitle: 45,
  calloutLine: 90,
} as const;
export const WORKING_COUNT = 2;
export const FIX_COUNT = 3;
export const MAX_FINDINGS_PER_AREA = 3;
export const MAX_FINDINGS = 9;
export const MAX_CALLOUTS = 3;
export const MAX_SCREEN_EVIDENCE = 3;

export const EFFORTS = ['ten_minutes', 'an_afternoon', 'a_project'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABELS: Record<Effort, string> = {
  ten_minutes: 'Ten minutes',
  an_afternoon: 'An afternoon',
  a_project: 'A project',
};

// Links on the audited site's own host whose status is checked, at most.
export const MAX_LINK_CHECKS = 20;

// The background run: audits running at once, and waiting, in this one process. Past that a request becomes a lead.
export const QUEUE_MAX_RUNNING = 2;
export const QUEUE_MAX_WAITING = 5;

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
