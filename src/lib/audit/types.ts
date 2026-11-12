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
  // the page embeds a frame (a form may live in it, unread)
  hasIframe: boolean;
  // the page carries scripts that can build its content (structured-data blocks are not counted)
  hasScripts: boolean;
  // the content of <meta name="robots">, lower-cased ('' when there is none)
  robotsMeta: string;
  // the same, exactly as the page wrote it (trimmed): what is quoted
  robotsMetaRaw: string;
  ogTitle: string;
  ogImage: string;
  ogSiteName: string;
  // a LocalBusiness-type block in the page's structured data (JSON-LD), and the name it gives
  hasLocalBusinessSchema: boolean;
  schemaName: string;
  // the first VISIBLE tel: and mailto: links, with their visible words
  phoneLink: PageLink | null;
  emailLink: PageLink | null;
  // the first visible links of the page in document order: what a visitor meets before scrolling far
  firstLinks: PageLink[];
  // every visible link to the site's own host found on the page (absolute, no fragment), with its visible words
  ownLinks: PageLink[];
  // every link of the page, any host, hidden ones included (a hidden link's words are not kept: text '')
  links: Array<PageLink & { hidden: boolean }>;
  // each visible form's visible words (labels, buttons), joined
  forms: string[];
  // the same, piece by piece: each piece is one element's own words
  formParts: string[][];
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
  // the page builds its content with scripts (little visible text, scripts present): no fact is made from its text
  textUnreadable?: boolean;
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
  // does the site answer on https:// at all ('yes' for a site read over https). 'no_answer' ONLY when an https://
  // request to the same host failed with a connection or TLS error; anything else that went wrong is 'unknown'
  https?: 'yes' | 'no_answer' | 'unknown';
  // links on the site's OWN host only; other hosts are never asked
  links: { checked: number; broken: Array<{ url: string; status: number }> };
}

export interface WebsiteContent {
  // the homepage first, then the linked pages that could be read
  pages: FetchedPage[];
  probes?: SiteProbes;
  // linked addresses on the site whose page read was redirected to another site: not followed, so not read
  offSitePages?: string[];
}

// A measurement from outside this code (a page-speed test, a phone screenshot). pagespeed.ts makes one from Google's
// PageSpeed test; without its key, or when it fails, it is { ok: false }, and then Speed is not assessed and no
// screenshot exists.
export type Measurements =
  | { ok: false; reason: string }
  | {
      ok: true;
      measures: Record<string, { value: number; unit: string; display: string }>;
      screenshot?: { mediaType: string; dataBase64: string };
    };

// What a finding rests on. Five kinds, and the report says in words which one each finding has (present.ts).
// The kind is set by the code that verifies the evidence (run-audit.ts verifyEvidence, facts.ts factEvidence),
// never by the model and never read off the text.
//   quote    the page's own words (checked against the page, or picked out of the page by the code)
//   absent   something the CODE looked for on the pages read and did not find; the label is written in facts.ts
//   counted  a count or length the CODE computed from the pages read (or the site's probes); written in facts.ts
//   measured a measurement taken outside this code and injected (Measurements); never a number from the model
//   screen   the model's reading of the phone screenshot. Code cannot check it. Only in First impression.
export type Evidence =
  | { kind: 'quote'; pageUrl: string; quote: string }
  | { kind: 'absent'; label: string }
  | { kind: 'counted'; text: string }
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
  // pages read that build their content with scripts, whose text was therefore not read (left out: none)
  scriptPages?: number;
  // a measurement (Google's PageSpeed test) was given to the model (left out: none was)
  measured?: true;
  // a phone screenshot of the home page was given to the model (left out: none was)
  screenshotTaken?: true;
}

export interface AuditError {
  success: false;
  error: string;
  message: string;
  websiteUrl: string;
}
