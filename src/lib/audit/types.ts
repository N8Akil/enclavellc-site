// src/lib/audit/types.ts
// Type definitions for the website audit system
import type { AreaKey, Effort, Niche, ScoreStatus } from './config';

export interface AuditRequest {
  websiteUrl: string;
  userEmail: string;
  userName?: string;
  businessType?: string;
  niche?: Niche;
}

export interface PageLink {
  // the link's visible words
  text: string;
  // absolute URL, or the raw href for tel: and mailto:
  href: string;
}

// What the code reads from the full parsed page. The model is handed facts built from these; it does not assert them.
export interface PageFacts {
  isHttps: boolean;
  title: string;
  metaDescription: string;
  h1Count: number;
  imageCount: number;
  imagesWithoutAlt: number;
  hasCanonical: boolean;
  hasViewportMeta: boolean;
  hasPhoneLink: boolean;
  hasEmailLink: boolean;
  hasSocialLinks: boolean;
  hasPrivacyLink: boolean;
  formCount: number;
  // the content of <meta name="robots">, lower-cased ('' when there is none)
  robotsMeta: string;
  ogTitle: string;
  ogImage: string;
  ogSiteName: string;
  // a LocalBusiness-type block in the page's structured data (JSON-LD), and the name it gives
  hasLocalBusinessSchema: boolean;
  schemaName: string;
  // the first tel: and mailto: links, as the page shows them
  phoneLink: PageLink | null;
  emailLink: PageLink | null;
  // the first links of the page in document order: what a visitor meets before scrolling far
  firstLinks: PageLink[];
  // every link to the site's own host found on the page (absolute, no fragment), with its visible words
  ownLinks: PageLink[];
  // each form's visible words (labels, buttons)
  forms: string[];
}

export interface FetchedPage {
  // the URL that answered (after redirects)
  url: string;
  title: string;
  // labelled text of the page, capped; ends with the truncation marker when cut
  text: string;
  truncated: boolean;
  facts: PageFacts;
  // the page's OWN words inside `text` (no label, separator or marker of ours), each with where it starts.
  // Quotes are checked against these and nothing else.
  segments: PageSegment[];
}

export interface PageSegment {
  start: number;
  value: string;
}

// Things asked of the site besides its pages. 'unknown' means the question could not be answered (a timeout,
// a refusal): no fact is made from an unknown.
export interface SiteProbes {
  robots:
    | { state: 'found'; disallowsHome: boolean; rule: string }
    | { state: 'missing' }
    | { state: 'unknown' };
  sitemap: { state: 'found'; locCount: number } | { state: 'missing' } | { state: 'unknown' };
  // does the http:// address of the site end up on https://
  httpsRedirect: 'redirects' | 'no_redirect' | 'unknown';
  // links on the site's OWN host only; other hosts are never asked
  links: { checked: number; broken: Array<{ url: string; status: number }> };
}

export interface WebsiteContent {
  // the homepage first, then the linked pages that could be read
  pages: FetchedPage[];
  probes?: SiteProbes;
}

// A measurement from outside this code (a page-speed test, a phone screenshot). Nothing in this repository makes
// one yet: the pipeline's default returns { ok: false }, and then Speed is not assessed and no screenshot exists.
export type Measurements =
  | { ok: false; reason: string }
  | {
      ok: true;
      measures: Record<string, { value: number; unit: string; display: string }>;
      screenshot?: { mediaType: string; dataBase64: string };
    };

// What a finding rests on. Four kinds, and the report says in words which one each finding has (present.ts).
//   quote    the page's own words (checked against the page, or picked out of the page by the code)
//   absent   something the CODE looked for on the pages read and did not find; the label is written in facts.ts
//   measured a number the CODE counted, or one taken from an injected measurement; never a number from the model
//   screen   the model's reading of the phone screenshot. Code cannot check it. Only in First impression.
export type Evidence =
  | { kind: 'quote'; pageUrl: string; quote: string }
  | { kind: 'absent'; label: string }
  | { kind: 'measured'; text: string }
  | { kind: 'screen' };

export interface Finding {
  text: string;
  evidence: Evidence;
}

export interface AssessedArea {
  key: AreaKey;
  name: string;
  assessed: true;
  score: number;
  status: ScoreStatus;
  weight: number;
  line: string;
  findings: Finding[];
}

export interface UnassessedArea {
  key: AreaKey;
  name: string;
  assessed: false;
  // a fixed sentence written in code (config.ts), never by the model
  reason: string;
}

export type AreaResult = AssessedArea | UnassessedArea;

export interface WorkingItem {
  title: string;
  line: string;
  evidence: Evidence;
}

export interface Fix {
  headline: string;
  whatWeSaw: string;
  evidence: Evidence;
  whyItMatters: string;
  theFix: string;
  effort: Effort;
  selfServe: boolean;
}

export interface Callout {
  title: string;
  line: string;
}

// There is no plan, invitation, price or tier here on purpose: the model has no field to write one into.
export interface AuditResults {
  success: true;
  websiteUrl: string;
  auditDate: string;
  niche: Niche;
  // weighted average of the assessed areas only, computed in code
  overallScore: number;
  overallStatus: ScoreStatus;
  whereYouStand: string;
  working: WorkingItem[];
  fixes: Fix[];
  // always all five, in order; an area without usable evidence is there as not assessed
  areas: AreaResult[];
  // only when a phone screenshot was supplied
  phoneCallouts: Callout[];
  // the pages whose text was read
  pagesRead: string[];
  // links on the site's own host whose status was asked
  linksChecked: number;
  // findings, fixes and strengths removed because their evidence did not check out
  droppedFindings: number;
}

export interface AuditError {
  success: false;
  error: string;
  message: string;
  websiteUrl: string;
}
