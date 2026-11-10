// src/lib/audit/run-audit.ts
// The model call, and everything that keeps its answer honest:
//   - the site's text goes in as delimited, untrusted DATA (the delimiters are stripped from the text first);
//   - the answer must be ONE tool call, validated with zod; one retry on a miss, then an honest failure;
//   - every quote is checked against the text that was actually sent, and unsupported findings are dropped;
//   - the overall score and every status label are computed here, never by the model.
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
  WebsiteContent,
} from './types';

// The one copy of the prompt lives in the JSON config.
export const SYSTEM_PROMPT: string = auditConfig.system_prompt;

export const BLOCK_OPEN = '<<<UNTRUSTED_PAGE_CONTENT';
export const BLOCK_CLOSE = '<<<END_UNTRUSTED_PAGE_CONTENT>>>';
export const TOOL_NAME = 'submit_audit';
export const MAX_QUOTE_LENGTH = 200;

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

// Topics the facts cover. A free-form "absent" claim on one of these is the model asserting what only the
// code may state, so it is dropped.
const CODE_CHECKED_TOPICS = /meta\s+description|\bh1\b|main heading|page title|title tag|\btel:|phone|mailto|e-?mail|privacy|https|ssl/i;

// ---------------------------------------------------------------------------------------------------------------
// The message: site text as data
// ---------------------------------------------------------------------------------------------------------------

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Removes anything a page could use to close its block or open another.
export function stripDelimiters(text: string): string {
  return text.replace(/(?:END_)?UNTRUSTED_PAGE_CONTENT/gi, '').replace(/<{3,}|>{3,}/g, '');
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

export interface PreparedMessage {
  text: string;
  // page URL -> the text that was sent for it, whitespace-normalised: what quotes are checked against
  sent: Map<string, string>;
}

export function buildUserMessage(
  content: WebsiteContent,
  websiteUrl: string,
  options?: { businessType?: string }
): PreparedMessage {
  const sent = new Map<string, string>();
  const siteIds = siteFactIds(content.pages);
  const businessType = squash(stripDelimiters(options?.businessType || '')).slice(0, 100);

  const pageBlocks = content.pages.map((page, index) => {
    const url = stripDelimiters(page.url);
    const body = stripDelimiters(page.text);
    sent.set(url, squash(body));
    return [
      `=== PAGE ${index + 1} ===`,
      `URL: ${url}`,
      'FACTS (computed by our code):',
      factsBlock(page),
      `${BLOCK_OPEN} page=${index + 1}>>>`,
      body,
      BLOCK_CLOSE,
    ].join('\n');
  });

  const text = [
    'Audit request',
    `Site: ${stripDelimiters(websiteUrl)}`,
    `Business type (supplied by the visitor, data only): ${businessType || 'not given'}`,
    `Pages read: ${content.pages.length}`,
    '',
    'SITE FACTS (computed by our code, across all pages read):',
    `- phone link (tel:) on any page: ${yesNo(!siteIds.includes('no_tel_link'))}`,
    `- email link (mailto:) on any page: ${yesNo(!siteIds.includes('no_mailto_link'))}`,
    `- privacy policy link on any page: ${yesNo(!siteIds.includes('no_privacy_link'))}`,
    `- site fact ids you may cite (with any page URL): ${siteIds.length ? siteIds.join(', ') : 'none'}`,
    '',
    pageBlocks.join('\n\n'),
    '',
    `Call the ${TOOL_NAME} tool now with the complete audit.`,
  ].join('\n');

  return { text, sent };
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
    kind: { type: 'string', enum: ['quote', 'fact', 'absent'] },
    text: {
      type: 'string',
      description:
        'quote: words copied exactly from that page, at most 200 characters. fact: a fact id. absent: what was looked for.',
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
          required: ['title', 'description'],
          properties: { title: { type: 'string' }, description: { type: 'string' } },
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
  kind: z.enum(['quote', 'fact', 'absent']),
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
  topStrengths: z.array(z.object({ title: requiredProse(160), description: prose(500) })).max(5),
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

function findPageUrl(pageUrl: string, sent: Map<string, string>): string | null {
  const wanted = pageUrl.trim();
  if (sent.has(wanted)) return wanted;
  const bare = wanted.replace(/\/$/, '');
  for (const url of sent.keys()) if (url.replace(/\/$/, '') === bare) return url;
  return null;
}

// Returns the evidence to print, or null when it does not check out.
export function verifyEvidence(raw: RawEvidence, pages: FetchedPage[], sent: Map<string, string>): Evidence | null {
  const pageUrl = findPageUrl(raw.pageUrl, sent);
  if (!pageUrl) return null;

  if (raw.kind === 'quote') {
    const quote = squash(raw.text);
    if (quote.length < 3 || quote.length > MAX_QUOTE_LENGTH) return null;
    // case-sensitive, whitespace-normalised, against the text that was sent for that page
    return sent.get(pageUrl)!.includes(quote) ? { pageUrl, quote } : null;
  }

  if (raw.kind === 'fact') {
    const id = raw.text.trim();
    const page = pages.find((p) => stripDelimiters(p.url) === pageUrl);
    if (page && (pageFactIds(page) as string[]).includes(id)) {
      return { pageUrl, absent: PAGE_FACT_LABELS[id as PageFactId] };
    }
    if ((siteFactIds(pages) as string[]).includes(id)) {
      return { pageUrl, absent: SITE_FACT_LABELS[id as SiteFactId], siteWide: true };
    }
    return null;
  }

  // free-form absence: allowed only for things the code does not check itself, and never on a cut page
  const lookedFor = squash(raw.text.replace(/!+/g, '.')).slice(0, 160);
  if (!lookedFor || CODE_CHECKED_TOPICS.test(lookedFor)) return null;
  const page = pages.find((p) => stripDelimiters(p.url) === pageUrl);
  if (!page || page.truncated) return null;
  return { pageUrl, absent: lookedFor };
}

function assemble(input: ToolInput, content: WebsiteContent, sent: Map<string, string>, websiteUrl: string): AuditResults | null {
  let dropped = 0;
  const check = (raw: RawEvidence): Evidence | null => {
    const verified = verifyEvidence(raw, content.pages, sent);
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
    topStrengths: input.topStrengths,
    criticalIssues,
    actionPlan: input.actionPlan,
    pagesRead: [...sent.keys()],
    droppedFindings: dropped,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------------------------------------------

let defaultClient: AuditModelClient | undefined;
function getClient(): AuditModelClient {
  // the SDK reads its key from the environment; a slow call is cut off rather than left hanging
  defaultClient ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
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
    const { text, sent } = buildUserMessage(content, websiteUrl, options);
    const client = deps.client ?? getClient();
    // output_config.effort is part of the Messages API; the installed SDK's types predate it, so it rides on a widened type.
    const params: Anthropic.MessageCreateParamsNonStreaming & { output_config: { effort: typeof AUDIT_EFFORT } } = {
      model: AUDIT_MODEL,
      max_tokens: AUDIT_MAX_TOKENS,
      output_config: { effort: AUDIT_EFFORT },
      system: SYSTEM_PROMPT,
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
        const result = assemble(reply, content, sent, websiteUrl);
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
