// src/lib/audit/run-audit.ts
// The model call, and everything that keeps its answer honest:
//   - the site's text goes in as delimited, untrusted DATA. The delimiters carry a random code made for this one
//     request, so no page can write them; anything that looks like one is stripped from the text all the same;
//   - the answer must be ONE tool call, validated with zod; one retry on a miss, then an honest failure;
//   - every quote is checked against the page's own words, and unsupported findings are dropped;
//   - the overall score and every status label are computed here, never by the model.
import { randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import auditConfig from '../../../docs/audit-system/audit-system-config.json';
import {
  ASSESSED_CATEGORIES,
  ASSESSED_KEYS,
  AUDIT_EFFORT,
  AUDIT_MAX_TOKENS,
  AUDIT_MODEL,
  NOT_ASSESSED_SENTENCE,
  UNASSESSED_CATEGORIES,
  UNSUPPORTED_SENTENCE,
  computeOverallScore,
  statusFor,
  type AssessedKey,
} from './config';
import type {
  AuditError,
  AuditResults,
  CategoryResult,
  CriticalIssue,
  Evidence,
  FetchedPage,
  Finding,
  Strength,
  WebsiteContent,
} from './types';

// The one copy of the prompt lives in the JSON config. It is a TEMPLATE: {{NONCE}} becomes this request's code.
export const SYSTEM_PROMPT_TEMPLATE: string = auditConfig.system_prompt;
export const NONCE_PLACEHOLDER = '{{NONCE}}';

export const TOOL_NAME = 'submit_audit';
export const MAX_QUOTE_LENGTH = 200;
export const MIN_QUOTE_LENGTH = 20;
export const MIN_QUOTE_WORDS = 4;

// The data-block markers. The fixed word is public (it is in the repo); the code after it is 16 random bytes made
// for one request, so a page cannot write a marker that matches.
const DELIMITER_WORD = 'UNTRUSTED_PAGE_CONTENT';
export const newNonce = (): string => randomBytes(16).toString('hex');
export const blockOpen = (nonce: string): string => `<<<${DELIMITER_WORD}_${nonce}`;
export const blockClose = (nonce: string): string => `<<<END_${DELIMITER_WORD}_${nonce}>>>`;

export function renderSystemPrompt(nonce: string): string {
  if (!/^[0-9a-f]{32,}$/.test(nonce)) throw new Error('bad nonce');
  return SYSTEM_PROMPT_TEMPLATE.split(NONCE_PLACEHOLDER).join(nonce);
}

// The slice of the SDK this module uses; tests pass a stand-in so no request is ever made.
export interface AuditModelClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface RunAuditDeps {
  client?: AuditModelClient;
  // the route's request id, so log lines can be matched up
  requestId?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Facts: absences the code can check itself. The model may cite these ids; it may not assert them on its own.
// ---------------------------------------------------------------------------------------------------------------

const PAGE_FACT_LABELS = {
  not_https: 'an HTTPS address',
  no_title: 'a page title',
  no_meta_description: 'a meta description',
  no_h1: 'a main heading (H1)',
} as const;
const SITE_FACT_LABELS = {
  no_tel_link: 'a clickable phone link (tel:)',
  no_mailto_link: 'a clickable email link (mailto:)',
  no_privacy_link: 'a privacy policy link',
} as const;
type PageFactId = keyof typeof PAGE_FACT_LABELS;
type SiteFactId = keyof typeof SITE_FACT_LABELS;

function pageFactIds(page: FetchedPage): PageFactId[] {
  const ids: PageFactId[] = [];
  if (!page.facts.isHttps) ids.push('not_https');
  if (!page.facts.title) ids.push('no_title');
  if (!page.facts.metaDescription) ids.push('no_meta_description');
  if (page.facts.h1Count === 0) ids.push('no_h1');
  return ids;
}

// A contact route on any page counts for the site: missing from one page is not a finding.
function siteFactIds(pages: FetchedPage[]): SiteFactId[] {
  const ids: SiteFactId[] = [];
  if (!pages.some((p) => p.facts.hasPhoneLink)) ids.push('no_tel_link');
  if (!pages.some((p) => p.facts.hasEmailLink)) ids.push('no_mailto_link');
  if (!pages.some((p) => p.facts.hasPrivacyLink)) ids.push('no_privacy_link');
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------
// The message: site text as data
// ---------------------------------------------------------------------------------------------------------------

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Characters that take no space: a page could put them inside a word to slip it past a plain comparison.
const INVISIBLE = /[\u00AD\u180E\u200B-\u200D\u2060-\u2064\uFE00-\uFE0F\uFEFF]/g;
// what may sit between the letters of a token and still read as that token
const GAP = '[\\s_.\\-]*';
const spelled = (token: string): RegExp => new RegExp(token.split('').join(GAP), 'gi');
const FIXED_WORDS = spelled(DELIMITER_WORD.replace(/_/g, ''));
const ANGLE_RUNS = /(?:<\s*){3,}|(?:>\s*){3,}/g;

// Removes anything a page could use to close its data block or open another, from text that came from outside.
// The text is first put in one canonical form (Unicode NFKC, so full-width and other look-alike letters become
// plain ones; invisible characters removed). Then this request's code, the fixed delimiter words (in any letter
// case, with or without spaces, underscores, dots or hyphens between the letters) and runs of three or more angle
// brackets are removed, AGAIN AND AGAIN until the text stops changing: removing one occurrence can join the
// pieces around it into another (UNTRUSTED_PAGE_UNTRUSTED_PAGE_CONTENT_CONTENT), and a single pass would leave that.
export function stripDelimiters(text: string, nonce: string): string {
  const code = spelled(nonce);
  let out = text.normalize('NFKC').replace(INVISIBLE, '');
  for (;;) {
    const next = out.replace(code, '').replace(FIXED_WORDS, '').replace(ANGLE_RUNS, ' ');
    if (next === out) return out;
    out = next;
  }
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

function factsBlock(page: FetchedPage): string {
  const f = page.facts;
  const ids = pageFactIds(page);
  return [
    `- HTTPS: ${yesNo(f.isHttps)}`,
    `- title: ${f.title ? `present (${f.title.length} characters)` : 'missing'}`,
    `- meta description: ${f.metaDescription ? `present (${f.metaDescription.length} characters)` : 'missing'}`,
    `- H1 headings: ${f.h1Count}`,
    `- images: ${f.imageCount}, without an alt attribute: ${f.imagesWithoutAlt}`,
    `- canonical link: ${yesNo(f.hasCanonical)}`,
    `- viewport meta tag: ${yesNo(f.hasViewportMeta)}`,
    `- forms: ${f.formCount}`,
    `- phone link (tel:) on this page: ${yesNo(f.hasPhoneLink)}`,
    `- email link (mailto:) on this page: ${yesNo(f.hasEmailLink)}`,
    `- privacy policy link on this page: ${yesNo(f.hasPrivacyLink)}`,
    `- social media links on this page: ${yesNo(f.hasSocialLinks)}`,
    `- text truncated: ${page.truncated ? 'yes, the page was longer than what is shown; do not report things as missing from it' : 'no'}`,
    `- fact ids you may cite for this page: ${ids.length ? ids.join(', ') : 'none'}`,
  ].join('\n');
}

export interface SentPage {
  page: FetchedPage;
  // the page's own words as sent (cleaned, whitespace-normalised), one entry per field: what quotes are checked against
  own: string[];
}

export interface PreparedMessage {
  text: string;
  // this request's delimiter code; the system prompt must be rendered with the same one
  nonce: string;
  // keyed by the exact URL string that was sent for the page
  pages: Map<string, SentPage>;
}

export function buildUserMessage(
  content: WebsiteContent,
  websiteUrl: string,
  options?: { businessType?: string },
  nonce: string = newNonce()
): PreparedMessage {
  const clean = (text: string) => stripDelimiters(text, nonce);
  const open = blockOpen(nonce);
  const close = blockClose(nonce);

  // One entry per URL as it will be sent. Two pages whose URLs are the same once cleaned would be told apart by
  // nobody, so the later one is not sent at all (rather than its text overwriting the first one's).
  const pages = new Map<string, SentPage>();
  for (const page of content.pages) {
    const url = clean(page.url);
    if (pages.has(url)) continue;
    pages.set(url, { page, own: page.segments.map((segment) => squash(clean(segment.value))).filter(Boolean) });
  }
  const sentPages = [...pages.values()].map(({ page }) => page);
  const siteIds = siteFactIds(sentPages);

  // Everything that came from outside (page text, page URLs, what the visitor typed) goes INSIDE a data block.
  // Outside the blocks there is only text this code wrote: labels, counts and yes/no facts.
  const pageBlocks = [...pages.entries()].map(([url, { page }], index) =>
    [
      `=== PAGE ${index + 1} ===`,
      'FACTS (computed by our code):',
      factsBlock(page),
      `${open} page=${index + 1}>>>`,
      `URL: ${url}`,
      clean(page.text),
      close,
    ].join('\n')
  );

  const businessType = squash(clean(options?.businessType || '')).slice(0, 100);
  const visitorBlock = [
    '=== WHAT THE VISITOR TYPED ===',
    `${open} visitor>>>`,
    `Site address: ${squash(clean(websiteUrl)).slice(0, 2100)}`,
    `Business type: ${businessType || 'not given'}`,
    close,
  ].join('\n');

  const text = [
    'Audit request',
    `Pages read: ${pages.size}`,
    '',
    'SITE FACTS (computed by our code, across all pages read):',
    `- phone link (tel:) on any page: ${yesNo(!siteIds.includes('no_tel_link'))}`,
    `- email link (mailto:) on any page: ${yesNo(!siteIds.includes('no_mailto_link'))}`,
    `- privacy policy link on any page: ${yesNo(!siteIds.includes('no_privacy_link'))}`,
    `- site fact ids you may cite (with any page URL): ${siteIds.length ? siteIds.join(', ') : 'none'}`,
    '',
    pageBlocks.join('\n\n'),
    '',
    visitorBlock,
    '',
    `Call the ${TOOL_NAME} tool now with the complete audit.`,
  ].join('\n');

  return { text, nonce, pages };
}

// ---------------------------------------------------------------------------------------------------------------
// The tool and its validation
// ---------------------------------------------------------------------------------------------------------------

const evidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pageUrl', 'kind', 'text'],
  properties: {
    pageUrl: { type: 'string', description: 'The URL of the page, copied exactly as given.' },
    kind: { type: 'string', enum: ['quote', 'fact'] },
    text: {
      type: 'string',
      description:
        'quote: the words of the page itself, copied exactly from one field, 20 to 200 characters and at least four words. fact: a fact id.',
    },
  },
} as const;
const stringList = { type: 'array', items: { type: 'string' } } as const;

// `strict` makes the API hold the tool input to this schema. The installed SDK's types predate the field,
// so it is added on a widened type. The model must call the tool by instruction: forcing tool_choice is
// rejected by the current Opus models, so the reply is checked for the call and re-asked once if it is absent.
const SUBMIT_TOOL: Anthropic.Tool & { strict: boolean } = {
  name: TOOL_NAME,
  description: 'Submit the complete website audit. Call this exactly once.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'categories', 'topStrengths', 'criticalIssues', 'actionPlan'],
    properties: {
      summary: { type: 'string' },
      categories: {
        type: 'array',
        description: 'Exactly one entry for each of the four areas.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'score', 'findings', 'recommendations'],
          properties: {
            key: { type: 'string', enum: [...ASSESSED_KEYS] },
            score: { type: 'integer', description: 'Whole number from 1 to 10.' },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'evidence'],
                properties: { text: { type: 'string' }, evidence: evidenceJsonSchema },
              },
            },
            recommendations: stringList,
          },
        },
      },
      topStrengths: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'evidence'],
          properties: { title: { type: 'string' }, description: { type: 'string' }, evidence: evidenceJsonSchema },
        },
      },
      criticalIssues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'impact', 'evidence'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            impact: { type: 'string' },
            evidence: evidenceJsonSchema,
          },
        },
      },
      actionPlan: {
        type: 'object',
        additionalProperties: false,
        required: ['quickWins', 'shortTerm', 'strategic'],
        properties: { quickWins: stringList, shortTerm: stringList, strategic: stringList },
      },
    },
  },
};

// Model prose: one line, capped, and held to the report's tone whatever the model wrote.
const prose = (max: number) =>
  z
    .string()
    .transform((s) => squash(s.replace(/!+/g, '.').replace(/\p{Extended_Pictographic}/gu, '')).slice(0, max));
const requiredProse = (max: number) => prose(max).refine((s) => s.length > 0);

const evidenceSchema = z.object({
  pageUrl: z.string().max(2100),
  // no free-form absence (looked and did not find it): an absence can only rest on a fact the code computed
  kind: z.enum(['quote', 'fact']),
  // quotes are kept exactly as given: they are checked, not cleaned
  text: z.string().max(2000),
});
type RawEvidence = z.infer<typeof evidenceSchema>;

const toolInputSchema = z.object({
  summary: requiredProse(1200),
  categories: z
    .array(
      z.object({
        key: z.enum(ASSESSED_KEYS),
        // an integer from 1 to 10 or the whole reply is a miss; nothing is rounded or pulled into range
        score: z.number().int().min(1).max(10),
        findings: z.array(z.object({ text: requiredProse(500), evidence: evidenceSchema })).max(8),
        recommendations: z.array(requiredProse(500)).max(6),
      })
    )
    .length(ASSESSED_KEYS.length)
    .refine((list) => new Set(list.map((c) => c.key)).size === ASSESSED_KEYS.length),
  topStrengths: z.array(z.object({ title: requiredProse(160), description: prose(500), evidence: evidenceSchema })).max(5),
  criticalIssues: z
    .array(
      z.object({
        title: requiredProse(160),
        description: prose(600),
        impact: prose(400),
        evidence: evidenceSchema,
      })
    )
    .max(8),
  actionPlan: z.object({
    quickWins: z.array(requiredProse(400)).max(6),
    shortTerm: z.array(requiredProse(400)).max(6),
    strategic: z.array(requiredProse(400)).max(6),
  }),
});
type ToolInput = z.infer<typeof toolInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Evidence verification
// ---------------------------------------------------------------------------------------------------------------

// The page the model named: the exact URL that was sent, or the same URL give or take a final slash when that
// points at one page only.
function findPageUrl(pageUrl: string, pages: Map<string, SentPage>): string | null {
  const wanted = pageUrl.trim();
  if (pages.has(wanted)) return wanted;
  const bare = wanted.replace(/\/$/, '');
  const close = [...pages.keys()].filter((url) => url.replace(/\/$/, '') === bare);
  return close.length === 1 ? close[0] : null;
}

const wordCount = (text: string): number => text.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// Returns the evidence to print, or null when it does not check out.
export function verifyEvidence(raw: RawEvidence, pages: Map<string, SentPage>): Evidence | null {
  const pageUrl = findPageUrl(raw.pageUrl, pages);
  if (!pageUrl) return null;
  const sent = pages.get(pageUrl)!;

  if (raw.kind === 'quote') {
    const quote = squash(raw.text);
    // long enough to mean something: a word or two can be found on any page
    if (quote.length < MIN_QUOTE_LENGTH || quote.length > MAX_QUOTE_LENGTH || wordCount(quote) < MIN_QUOTE_WORDS) return null;
    // case-sensitive, whitespace-normalised, inside ONE field of that page's own words: never our labels, and
    // never words stitched together across two fields
    return sent.own.some((words) => words.includes(quote)) ? { pageUrl, quote } : null;
  }

  // a fact the code computed for that page, or across the site. This is the ONLY source of "looked for, not found".
  const id = raw.text.trim();
  if ((pageFactIds(sent.page) as string[]).includes(id)) {
    return { pageUrl, absent: PAGE_FACT_LABELS[id as PageFactId] };
  }
  const allPages = [...pages.values()].map(({ page }) => page);
  if ((siteFactIds(allPages) as string[]).includes(id)) {
    return { pageUrl, absent: SITE_FACT_LABELS[id as SiteFactId], siteWide: true };
  }
  return null;
}

function assemble(input: ToolInput, pages: Map<string, SentPage>, websiteUrl: string): AuditResults | null {
  let dropped = 0;
  const check = (raw: RawEvidence): Evidence | null => {
    const verified = verifyEvidence(raw, pages);
    if (verified) return verified;
    dropped += 1;
    return null;
  };

  const categories: CategoryResult[] = ASSESSED_CATEGORIES.map(({ key, name, weight }) => {
    const raw = input.categories.find((c) => c.key === key)!;
    const findings: Finding[] = [];
    for (const finding of raw.findings) {
      const evidence = check(finding.evidence);
      if (evidence) findings.push({ text: finding.text, evidence });
    }
    const lost = raw.findings.length - findings.length;
    // more than half unsupported, or nothing supported at all: the score has nothing under it
    if (lost > raw.findings.length / 2 || findings.length === 0) {
      return { key, name, assessed: false, reason: UNSUPPORTED_SENTENCE };
    }
    return {
      key,
      name,
      assessed: true,
      score: raw.score,
      status: statusFor(raw.score),
      weight,
      findings,
      recommendations: raw.recommendations,
    };
  });

  const scored = categories.flatMap((c) => (c.assessed ? [{ score: c.score, weight: c.weight }] : []));
  const overallScore = computeOverallScore(scored);
  if (overallScore === null) return null;

  const criticalIssues: CriticalIssue[] = [];
  for (const issue of input.criticalIssues) {
    const evidence = check(issue.evidence);
    if (evidence) criticalIssues.push({ title: issue.title, description: issue.description, impact: issue.impact, evidence });
  }

  // a strength is a claim like any other: no evidence, no strength
  const topStrengths: Strength[] = [];
  for (const strength of input.topStrengths) {
    const evidence = check(strength.evidence);
    if (evidence) topStrengths.push({ title: strength.title, description: strength.description, evidence });
  }

  return {
    success: true,
    websiteUrl,
    auditDate: new Date().toISOString(),
    overallScore,
    overallStatus: statusFor(overallScore),
    summary: input.summary,
    categories: [
      ...categories,
      ...UNASSESSED_CATEGORIES.map((name) => ({ name, assessed: false as const, reason: NOT_ASSESSED_SENTENCE })),
    ],
    topStrengths,
    criticalIssues,
    actionPlan: input.actionPlan,
    pagesRead: [...pages.keys()],
    droppedFindings: dropped,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------------------------------------------

// maxRetries 0: this module already asks once more itself when a reply is unusable, and that is the whole budget.
// With the SDK retrying as well, one audit could become four requests. A slow call is cut off rather than left hanging.
export const AUDIT_CLIENT_OPTIONS = { timeout: 90_000, maxRetries: 0 } as const;

// The SDK reads its key from the environment.
export function createAuditClient(): Anthropic {
  return new Anthropic(AUDIT_CLIENT_OPTIONS);
}

let defaultClient: AuditModelClient | undefined;
function getClient(): AuditModelClient {
  defaultClient ??= createAuditClient();
  return defaultClient;
}

type Miss = 'REFUSAL' | 'MAX_TOKENS' | 'NO_TOOL_CALL' | 'SCHEMA_MISS' | 'NOTHING_SUPPORTED';

function readReply(response: Anthropic.Message): ToolInput | Miss {
  if (response.stop_reason === 'refusal') return 'REFUSAL';
  if (response.stop_reason === 'max_tokens') return 'MAX_TOKENS';
  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!call) return 'NO_TOOL_CALL';
  const parsed = toolInputSchema.safeParse(call.input);
  return parsed.success ? parsed.data : 'SCHEMA_MISS';
}

export async function runAudit(
  content: WebsiteContent,
  websiteUrl: string,
  options?: { businessType?: string; priorityAreas?: string[] },
  deps: RunAuditDeps = {}
): Promise<AuditResults | AuditError> {
  const tag = `[Audit] ${deps.requestId ?? '-'}`;
  const failure: AuditError = {
    success: false,
    error: 'AUDIT_FAILED',
    message: 'Failed to generate audit. Please try again.',
    websiteUrl,
  };

  try {
    if (!content.pages.length) return failure;
    const { text, nonce, pages } = buildUserMessage(content, websiteUrl, options);
    const client = deps.client ?? getClient();
    // output_config.effort is part of the Messages API; the installed SDK's types predate it, so it rides on a widened type.
    const params: Anthropic.MessageCreateParamsNonStreaming & { output_config: { effort: typeof AUDIT_EFFORT } } = {
      model: AUDIT_MODEL,
      max_tokens: AUDIT_MAX_TOKENS,
      output_config: { effort: AUDIT_EFFORT },
      system: renderSystemPrompt(nonce),
      tools: [SUBMIT_TOOL],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: text }],
    };

    // one try, ONE retry, then an honest failure
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await client.messages.create(params);
      const requestId = (response as { _request_id?: string | null })._request_id ?? '-';
      const reply = readReply(response);
      let miss: Miss;
      if (typeof reply === 'string') {
        miss = reply;
      } else {
        const result = assemble(reply, pages, websiteUrl);
        if (result) {
          if (result.droppedFindings > 0) console.warn(`${tag} evidence dropped: ${result.droppedFindings}`);
          return result;
        }
        miss = 'NOTHING_SUPPORTED';
      }
      // a code and the API's request id only: the reply itself can carry page text
      console.error(`${tag} model reply unusable (attempt ${attempt}): ${miss} req=${requestId}`);
    }
    return failure;
  } catch (error) {
    // class, status and request id only; never the message, which can carry page text
    if (error instanceof Anthropic.APIError) {
      // (the SDK's error classes all report name "Error"; the class itself says which one it is)
      console.error(`${tag} model call failed: ${error.constructor.name} status=${error.status ?? '-'} req=${error.requestID ?? '-'}`);
    } else {
      console.error(`${tag} model call failed: ${error instanceof Error ? error.name : typeof error}`);
    }
    return failure;
  }
}
