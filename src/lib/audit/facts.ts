// src/lib/audit/facts.ts
// What the CODE can state about a site, computed from the pages read and the site probes. The model is handed
// these with an id each and may cite an id as evidence; it cannot state any of them on its own.
//
// Three families, which decide how a cited fact is printed (present.ts):
//   absent    looked for on the pages read and not found  -> "Looked for on the pages read, not found: <label>"
//   says      words the code picked out of the page       -> "Your page says: <the words>"
//   measured  something the code counted                  -> "Measured: <label>"
//
// EVERY LABEL IS WRITTEN HERE, ONCE. None of them is a verdict. In particular no label says that anything is or
// is not lawful, licensed or allowed: a home-care fact reports the words the page uses, or that they were not
// found on the pages read. tests/audit-facts.test.ts fails if a label contains one of the words in VERDICT_WORDS.
import type { AreaKey, Niche } from './config';
import type { Evidence, FetchedPage, PageLink, WebsiteContent } from './types';

export type FactFamily = 'absent' | 'says' | 'measured';

export interface Fact {
  // what the model cites. Page facts end in @<page number>.
  id: string;
  area: AreaKey;
  family: FactFamily;
  // absent: the thing looked for. measured: the whole statement. says: what the quoted words are.
  // This is what is PRINTED; for a page fact it names the page by its path.
  label: string;
  // The same words for the model's instructions, naming the page by its number instead: a path is the site's
  // own text and stays out of the instruction part of the message.
  hint: string;
  // says only: the page's words and where they are
  pageUrl?: string;
  quote?: string;
}

// Words no label may contain (case-insensitive): the audit reports what is on the page, it gives no verdict.
export const VERDICT_WORDS = ['law', 'legal', 'comply', 'compliance', 'hipaa', 'violat', 'required by', 'regulation'] as const;

type Entry = { area: AreaKey; label: string | ((...values: Array<string | number>) => string) };

// Things looked for and not found. Each is printed after "Looked for on the pages read, not found:".
export const ABSENT_FACTS = {
  no_title: { area: 'found', label: (path) => `a page title on ${path}` },
  no_meta_description: { area: 'found', label: (path) => `a description for search results (meta description) on ${path}` },
  no_h1: { area: 'found', label: (path) => `a main heading (H1) on ${path}` },
  no_sitemap: { area: 'found', label: 'a sitemap at /sitemap.xml that lists your pages' },
  no_og_title: { area: 'found', label: 'a title for when your home page is shared (Open Graph title)' },
  no_og_image: { area: 'found', label: 'a picture for when your home page is shared (Open Graph image)' },
  no_local_business_data: { area: 'found', label: 'local-business details written for search engines (structured data)' },
  no_phone_number: { area: 'found', label: 'a phone number in the text' },
  no_street_address: { area: 'found', label: 'a street address in the text' },
  no_business_name: { area: 'found', label: 'the business name, as the site names itself to search engines, in the home page text' },
  no_tel_link: { area: 'next_step', label: 'a phone number that can be tapped to call (a tel: link)' },
  no_mailto_link: { area: 'next_step', label: 'an email address that can be tapped to write (a mailto: link)' },
  no_form: { area: 'next_step', label: 'a form' },
  no_hours: { area: 'next_step', label: 'opening hours or the times you answer' },
  no_service_area: { area: 'next_step', label: 'the towns or area you serve' },
  not_https: { area: 'trust', label: 'a secure https:// address' },
  no_https_redirect: { area: 'trust', label: 'a redirect from the http:// address to https://' },
  no_privacy_link: { area: 'trust', label: 'a link to a privacy policy' },
  no_copyright_year: { area: 'trust', label: 'a copyright year' },
  // home care only
  no_careers_link: { area: 'next_step', label: 'a careers or apply link' },
  no_careers_link_first: { area: 'next_step', label: 'a careers or apply link among the first links of the home page' },
  no_request_care_form: { area: 'next_step', label: 'a form to request care' },
  no_word_licensed: { area: 'trust', label: 'the words "licensed" or "registered"' },
  no_word_insured: { area: 'trust', label: 'the word "insured"' },
  no_word_bonded: { area: 'trust', label: 'the word "bonded"' },
  no_word_background_check: { area: 'trust', label: 'the words "background check"' },
  no_word_trained: { area: 'trust', label: 'the words "trained" or "training"' },
  no_payer_words: { area: 'trust', label: 'how care is paid for (Medicaid, private pay, long-term care insurance or VA)' },
} as const satisfies Record<string, Entry>;

// Things the code counted. Each is printed after "Measured:".
export const MEASURED_FACTS = {
  title_length: { area: 'found', label: (n) => `your home page title is ${n} characters long` },
  description_length: { area: 'found', label: (n) => `your home page description for search results is ${n} characters long` },
  multiple_h1: { area: 'found', label: (n, path) => `${path} has ${n} main headings (H1)` },
  sitemap_listed: { area: 'found', label: (n) => `your sitemap lists ${n} ${n === 1 ? 'address' : 'addresses'}` },
  broken_links: {
    area: 'trust',
    label: (broken, checked) => `${broken} of the ${checked} links we checked on your own site answered with an error`,
  },
  links_all_answer: { area: 'trust', label: (checked) => `all ${checked} links we checked on your own site answered` },
} as const satisfies Record<string, Entry>;

// Words the code picked out of the page. The label says what they are; what is printed is the words themselves.
export const SAYS_FACTS = {
  noindex: { area: 'found', label: (path) => `the instruction to search engines in the code of ${path}` },
  robots_disallows_home: { area: 'found', label: 'a line in your robots.txt file that covers the home page' },
  phone_number: { area: 'found', label: 'a phone number in the text' },
  street_address: { area: 'found', label: 'a street address in the text' },
  business_name: { area: 'found', label: 'the business name in the home page text' },
  tel_link: { area: 'next_step', label: 'a phone number that can be tapped to call' },
  mailto_link: { area: 'next_step', label: 'an email address that can be tapped to write' },
  hours: { area: 'next_step', label: 'opening hours or the times you answer' },
  service_area: { area: 'next_step', label: 'the towns or area you serve' },
  copyright_year: { area: 'trust', label: 'the copyright line' },
  // home care only
  careers_link: { area: 'next_step', label: 'a careers or apply link' },
  request_care_form: { area: 'next_step', label: 'a form to request care' },
  word_licensed: { area: 'trust', label: 'where the page uses "licensed" or "registered"' },
  word_insured: { area: 'trust', label: 'where the page uses "insured"' },
  word_bonded: { area: 'trust', label: 'where the page uses "bonded"' },
  word_background_check: { area: 'trust', label: 'where the page uses "background check"' },
  word_trained: { area: 'trust', label: 'where the page uses "trained" or "training"' },
  payer_words: { area: 'trust', label: 'where the page says how care is paid for' },
} as const satisfies Record<string, Entry>;

const text = (label: Entry['label'], ...values: Array<string | number>): string =>
  typeof label === 'string' ? label : label(...values);

// Every label this module can produce, with sample values in the gaps: what the verdict-word test reads.
export function allFactLabels(): string[] {
  return [ABSENT_FACTS, MEASURED_FACTS, SAYS_FACTS].flatMap((catalogue) =>
    Object.values(catalogue).map((entry: Entry) => text(entry.label, 3, '/sample-page'))
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Picking words out of a page
// ---------------------------------------------------------------------------------------------------------------

const MAX_SNIPPET = 160;

// The words around the first match, cut at sentence ends, always an exact piece of one segment of the page.
function snippet(value: string, index: number, length: number): string {
  let start = index;
  while (start > 0 && !/[.!?|]/.test(value[start - 1]) && index - start < 70) start--;
  let end = index + length;
  while (end < value.length && !/[.!?|]/.test(value[end]) && end - start < MAX_SNIPPET) end++;
  if (end < value.length && /[.!?]/.test(value[end])) end++;
  return value.slice(start, end).trim();
}

function findWords(pages: FetchedPage[], pattern: RegExp): { pageUrl: string; quote: string } | null {
  for (const page of pages) {
    for (const segment of page.segments) {
      const match = pattern.exec(segment.value);
      if (match) return { pageUrl: page.url, quote: snippet(segment.value, match.index, match[0].length) };
    }
  }
  return null;
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const STREET =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Highway|Hwy|Parkway|Pkwy|Place|Pl|Suite|Ste)\b\.?/i;
const HOURS =
  /\b(?:open\s+24|24\s*\/\s*7|24 hours|hours\s*:|opening hours|office hours|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(?:-|to|through|thru|–)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:-|to|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;
const SERVICE_AREA = /\b(?:proudly\s+serving|serving\s+[A-Z]|service areas?|areas? we serve|we serve\s+[A-Z]|communities we serve|locations we serve)/;
const COPYRIGHT = /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?\d{4}/i;
const CAREERS = /\b(?:careers?|jobs?|apply|employment|join our team|we(?:'| a)re hiring|work with us|caregiver (?:jobs|positions))\b/i;
const REQUEST_CARE = /\b(?:request|care|consult|assessment|get started|schedule)/i;

const HOME_CARE_WORDS = [
  ['licensed', /\b(?:licen[sc]ed?|registered)\b/i],
  ['insured', /\binsured\b/i],
  ['bonded', /\bbonded\b/i],
  ['background_check', /\bbackground[\s-]check/i],
  ['trained', /\btrain(?:ed|ing)\b/i],
] as const;
const PAYERS = /\b(?:medicaid|private[\s-]pay|long[\s-]term[\s-]care insurance|veterans?(?:'| )|VA benefits|VA aid)\b/i;

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return url;
  }
};

const linkWords = (link: PageLink): string => link.text || link.href;

// ---------------------------------------------------------------------------------------------------------------
// The facts for one site
// ---------------------------------------------------------------------------------------------------------------

export function computeFacts(content: WebsiteContent, niche: Niche): Fact[] {
  const pages = content.pages;
  if (!pages.length) return [];
  const home = pages[0];
  const probes = content.probes;
  const facts: Fact[] = [];
  // A page whose text was cut may hold the words past the cut: then "not found" would be a guess, so absences
  // that rest on the TEXT are left out. Absences that rest on the whole document's markup are not affected.
  const textComplete = !pages.some((page) => page.truncated);

  // `values` fill the gaps of the printed label; `hintValues` fill the same gaps for the model (page number, not path)
  type Values = Array<string | number>;
  const absent = (id: keyof typeof ABSENT_FACTS, suffix = '', values: Values = [], hintValues: Values = values) =>
    facts.push({
      id: `${id}${suffix}`,
      area: ABSENT_FACTS[id].area,
      family: 'absent',
      label: text(ABSENT_FACTS[id].label, ...values),
      hint: text(ABSENT_FACTS[id].label, ...hintValues),
    });
  const measured = (id: keyof typeof MEASURED_FACTS, suffix = '', values: Values = [], hintValues: Values = values) =>
    facts.push({
      id: `${id}${suffix}`,
      area: MEASURED_FACTS[id].area,
      family: 'measured',
      label: text(MEASURED_FACTS[id].label, ...values),
      hint: text(MEASURED_FACTS[id].label, ...hintValues),
    });
  const says = (id: keyof typeof SAYS_FACTS, pageUrl: string, quote: string, suffix = '', values: Values = [], hintValues: Values = values) => {
    if (!quote) return;
    facts.push({
      id: `${id}${suffix}`,
      area: SAYS_FACTS[id].area,
      family: 'says',
      label: text(SAYS_FACTS[id].label, ...values),
      hint: text(SAYS_FACTS[id].label, ...hintValues),
      pageUrl,
      quote,
    });
  };
  // words in the text: the page's words when found; "not found" only when no page's text was cut
  const words = (pattern: RegExp, found: keyof typeof SAYS_FACTS, missing: keyof typeof ABSENT_FACTS) => {
    const hit = findWords(pages, pattern);
    if (hit) says(found, hit.pageUrl, hit.quote);
    else if (textComplete) absent(missing);
  };

  // --- Found
  pages.forEach((page, index) => {
    const at = `@${index + 1}`;
    const path = pathOf(page.url);
    const ref = `page ${index + 1}`;
    if (!page.facts.title) absent('no_title', at, [path], [ref]);
    if (!page.facts.metaDescription) absent('no_meta_description', at, [path], [ref]);
    if (page.facts.h1Count === 0) absent('no_h1', at, [path], [ref]);
    if (page.facts.h1Count > 1) measured('multiple_h1', at, [page.facts.h1Count, path], [page.facts.h1Count, ref]);
    if (/\bnoindex\b/.test(page.facts.robotsMeta)) says('noindex', page.url, page.facts.robotsMeta.slice(0, MAX_SNIPPET), at, [path], [ref]);
  });
  if (home.facts.title) measured('title_length', '', [home.facts.title.length]);
  if (home.facts.metaDescription) measured('description_length', '', [home.facts.metaDescription.length]);
  if (probes?.robots.state === 'found' && probes.robots.disallowsHome) {
    says('robots_disallows_home', new URL('/robots.txt', home.url).href, probes.robots.rule);
  }
  if (probes?.sitemap.state === 'missing') absent('no_sitemap');
  if (probes?.sitemap.state === 'found') measured('sitemap_listed', '', [probes.sitemap.locCount]);
  if (!home.facts.ogTitle) absent('no_og_title');
  if (!home.facts.ogImage) absent('no_og_image');
  if (!pages.some((page) => page.facts.hasLocalBusinessSchema)) absent('no_local_business_data');
  words(PHONE, 'phone_number', 'no_phone_number');
  words(STREET, 'street_address', 'no_street_address');
  // the name the site gives itself in its own data, looked for in what a visitor can read on the home page
  const name = home.facts.ogSiteName || pages.map((page) => page.facts.schemaName).find(Boolean) || '';
  if (name.length >= 3) {
    const hit = home.segments.find((segment) => segment.value.toLowerCase().includes(name.toLowerCase()));
    if (hit) {
      const index = hit.value.toLowerCase().indexOf(name.toLowerCase());
      says('business_name', home.url, hit.value.slice(index, index + name.length));
    } else if (!home.truncated) absent('no_business_name');
  }

  // --- Clear next step
  const withTel = pages.find((page) => page.facts.phoneLink);
  if (withTel) says('tel_link', withTel.url, linkWords(withTel.facts.phoneLink!));
  else absent('no_tel_link');
  const withMail = pages.find((page) => page.facts.emailLink);
  if (withMail) says('mailto_link', withMail.url, linkWords(withMail.facts.emailLink!));
  else absent('no_mailto_link');
  if (!pages.some((page) => page.facts.formCount > 0)) absent('no_form');
  words(HOURS, 'hours', 'no_hours');
  words(SERVICE_AREA, 'service_area', 'no_service_area');

  // --- Trust
  if (!home.facts.isHttps) absent('not_https');
  if (probes?.httpsRedirect === 'no_redirect') absent('no_https_redirect');
  if (!pages.some((page) => page.facts.hasPrivacyLink)) absent('no_privacy_link');
  words(COPYRIGHT, 'copyright_year', 'no_copyright_year');
  if (probes && probes.links.checked > 0) {
    if (probes.links.broken.length > 0) measured('broken_links', '', [probes.links.broken.length, probes.links.checked]);
    else measured('links_all_answer', '', [probes.links.checked]);
  }

  // --- Home care: the two doors, and the words a careful family or a referrer looks for. Words only, no verdict.
  if (niche === 'home_care') {
    const isCareers = (link: PageLink) => CAREERS.test(link.text) || CAREERS.test(pathOf(link.href));
    const anywhere = pages.flatMap((page) => page.facts.ownLinks.map((link) => ({ page, link }))).find(({ link }) => isCareers(link));
    const first = home.facts.firstLinks.find(isCareers);
    if (first) says('careers_link', home.url, linkWords(first));
    else if (anywhere) {
      says('careers_link', anywhere.page.url, linkWords(anywhere.link));
      absent('no_careers_link_first');
    } else absent('no_careers_link');

    const careForm = pages.flatMap((page) => page.facts.forms.map((form) => ({ page, form }))).find(({ form }) => REQUEST_CARE.test(form));
    if (careForm) says('request_care_form', careForm.page.url, careForm.form.slice(0, MAX_SNIPPET));
    else absent('no_request_care_form');

    for (const [word, pattern] of HOME_CARE_WORDS) words(pattern, `word_${word}`, `no_word_${word}`);
    words(PAYERS, 'payer_words', 'no_payer_words');
  }

  return facts;
}

// How a cited fact is printed. The words come from this module (or from the page, for "says"), never from the model.
export function factEvidence(fact: Fact): Evidence {
  if (fact.family === 'absent') return { kind: 'absent', label: fact.label };
  if (fact.family === 'measured') return { kind: 'measured', text: fact.label };
  return { kind: 'quote', pageUrl: fact.pageUrl ?? '', quote: fact.quote ?? '' };
}

// The fact list as the model sees it, in the instruction part of the message: ids and this module's own words
// only. The words a "says" fact found on the page are the site's text and are given inside a data block instead
// (factWordsBlock).
export function factsBlock(facts: Fact[]): string {
  if (!facts.length) return '- none';
  return facts
    .map((fact) => {
      if (fact.family === 'absent') return `- [${fact.id}] ${fact.area}: looked for and NOT found on the pages read: ${fact.hint}`;
      if (fact.family === 'measured') return `- [${fact.id}] ${fact.area}: counted: ${fact.hint}`;
      return `- [${fact.id}] ${fact.area}: found: ${fact.hint} (the words are in the fact words block)`;
    })
    .join('\n');
}

// The page's words behind each "says" fact. Site text: the caller cleans it and puts it inside a data block.
export function factWords(facts: Fact[]): Array<{ id: string; quote: string }> {
  return facts.flatMap((fact) => (fact.family === 'says' && fact.quote ? [{ id: fact.id, quote: fact.quote }] : []));
}
