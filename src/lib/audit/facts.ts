// src/lib/audit/facts.ts
// What the CODE can state about a site, computed from the pages read and the site probes. The model is handed
// these with an id each and may cite an id as evidence; it cannot state any of them on its own.
//
// Three families, which decide how a cited fact is printed (present.ts):
//   absent    looked for on the pages read and not found  -> "Looked for on the pages read, not found: <label>"
//   says      words the code picked out of the page       -> "Your page says: <the words>"
//   measured  something the code counted                  -> "Counted on your pages: <label>"
//             ("Measured:" is kept for a measurement injected from outside this code; no fact is printed under it)
//
// EVERY LABEL IS WRITTEN HERE, ONCE. None of them is a verdict. In particular no label says that anything is or
// is not lawful, licensed or allowed: a home-care fact reports the words the page uses, and only when it uses them. tests/audit-facts.test.ts fails if a label contains one of the words in VERDICT_WORDS.
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
  // says only: read from the page's code or the robots.txt file, not its visible text (not checked as a page quote)
  markup?: true;
}

// Words no label may contain (case-insensitive): the audit reports what is on the page, it gives no verdict.
export const VERDICT_WORDS = ['law', 'legal', 'comply', 'compliance', 'hipaa', 'violat', 'required by', 'regulation'] as const;

type Entry = { area: AreaKey; label: string | ((...values: Array<string | number>) => string) };

// Things looked for and not found. Each is printed after "Looked for on the pages read, not found:".
// ONLY STRUCTURAL CHECKS: an element, a tag or a link the markup has or has not, or an answer a request got. A
// text pattern that did not match is NOT evidence that something is missing, so no text check has an absence here:
// those are positive-only facts (SAYS_FACTS). tests/audit-facts.test.ts holds the allow-list of these ids.
export const ABSENT_FACTS = {
  no_title: { area: 'found', label: (path) => `a page title on ${path}` },
  no_meta_description: { area: 'found', label: (path) => `a description for search results (meta description) on ${path}` },
  no_h1: { area: 'found', label: (path) => `a main heading (H1) on ${path}` },
  // only when the site itself answered 404 or 410 for /sitemap.xml
  no_sitemap: { area: 'found', label: 'a sitemap at /sitemap.xml that lists your pages' },
  no_og_title: { area: 'found', label: 'a title for when your home page is shared (Open Graph title)' },
  no_og_image: { area: 'found', label: 'a picture for when your home page is shared (Open Graph image)' },
  no_local_business_data: { area: 'found', label: 'local-business details written for search engines (structured data)' },
  no_tel_link: { area: 'next_step', label: 'a phone number that can be tapped to call (a tel: link)' },
  no_mailto_link: { area: 'next_step', label: 'an email address that can be tapped to write (a mailto: link)' },
  no_form: { area: 'next_step', label: 'a form' },
  // only when a request to https:// on the same host failed with a connection or TLS error
  no_https_answer: { area: 'trust', label: 'an answer from your site on https:// (a secure address) when we tried it' },
  no_https_redirect: { area: 'trust', label: 'a redirect from the http:// address to https://' },
  no_privacy_link: { area: 'trust', label: 'a link to a privacy policy' },
  // home care only: links (any site), by their address or their words
  no_careers_link: { area: 'next_step', label: 'a careers or apply link' },
  no_careers_link_first: { area: 'next_step', label: 'a careers or apply link among the first links of the home page' },
} as const satisfies Record<string, Entry>;

// Things the code counted. Each is printed after "Counted on your pages:".
export const MEASURED_FACTS = {
  title_length: { area: 'found', label: (n) => `your home page title is ${n} characters long` },
  description_length: { area: 'found', label: (n) => `your home page description for search results is ${n} characters long` },
  multiple_h1: { area: 'found', label: (n, path) => `${path} has ${n} main headings (H1)` },
  sitemap_listed: { area: 'found', label: (n) => `your sitemap lists ${n} ${n === 1 ? 'address' : 'addresses'}` },
  // robots.txt keeps every crawler off the home page, but its line is too long to quote
  robots_blocks_home: { area: 'found', label: 'your robots.txt file has a line telling every search engine to stay off your whole site' },
  broken_links: {
    area: 'trust',
    label: (broken, checked) => `${broken} of the ${checked} links we checked on your own site answered with an error`,
  },
  links_all_answer: { area: 'trust', label: (checked) => `all ${checked} links we checked on your own site answered` },
  // how many linked pages were redirected off the site (the redirect was not followed, so they were not read), and
  // up to three of their paths. The paths are the site's text: the model's hint is given without them (list '').
  // ("a different site", not "another site": no label may sound as if other sites were checked)
  redirects_off_site: {
    area: 'trust',
    label: (n, paths) =>
      `${n} linked ${n === 1 ? 'page' : 'pages'} on your own site ${n === 1 ? 'sends' : 'send'} visitors to a different site and ${n === 1 ? 'was' : 'were'} not read${paths ? `: ${paths}` : ''}`,
  },
} as const satisfies Record<string, Entry>;

// Words the code picked out of the page. The label says what they are; what is printed is the words themselves.
// Every one except the two read from markup (noindex, the robots.txt line) is checked like any quote before use.
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
  careers_link_elsewhere: { area: 'next_step', label: 'a careers or apply link to an application page on a different site' },
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
// how many of the pages that redirect off the site the off-site fact names by path
const MAX_OFF_SITE_NAMED = 3;

// The words around the first match, cut at sentence ends, always an exact piece of one segment of the page.
function snippet(value: string, index: number, length: number): string {
  let start = index;
  while (start > 0 && !/[.!?|]/.test(value[start - 1]) && index - start < 70) start--;
  let end = index + length;
  while (end < value.length && !/[.!?|]/.test(value[end]) && end - start < MAX_SNIPPET) end++;
  if (end < value.length && /[.!?]/.test(value[end])) end++;
  return value.slice(start, end).trim();
}

// The first segment (one block of one field) of a page that matches any of the patterns. Segments only: the page's
// own visible words, never our labels.
function findWords(pages: FetchedPage[], patterns: RegExp | RegExp[]): { pageUrl: string; quote: string } | null {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const page of pages) {
    for (const segment of page.segments) {
      for (const pattern of list) {
        const match = pattern.exec(segment.value);
        if (match) return { pageUrl: page.url, quote: snippet(segment.value, match.index, match[0].length) };
      }
    }
  }
  return null;
}

// TEXT PATTERNS: positive only (a miss says nothing), so each is written to catch the usual forms generously.
// A phone number: US forms (5125550100, 512/555-0100, (512) 555-0100, +1 512 555 0100), a vanity number
// (1-800-FLOWERS) and an international one (+44 20 7946 0958).
const PHONE = [
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s./-]?\d{3}[\s.-]?\d{4}\b/,
  /\b1[\s.-]?8\d\d[\s.-]?[A-Za-z0-9]{3}[\s.-]?[A-Za-z0-9]{4}\b/,
  /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/,
];
const STREET =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Highway|Hwy|Parkway|Pkwy|Place|Pl|Suite|Ste|Circle|Cir|Trail|Trl|Terrace|Ter|Square|Sq|Plaza|Loop|Pike|Row|Route|Rte|Crescent|Close)\b\.?/i;
const HOURS =
  /\b(?:open\s+24|24\s*\/\s*7|24 hours|hours\s*:|opening hours|office hours|business hours|hours of operation|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(?:-|to|through|thru|–)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\s*(?:-|to|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i;
// "Service Areas", "Areas We Serve", "Proudly Serving Austin", "Communities we serve", "Service area: Travis County"
// in any letter case; "serving Austin" / "We serve Austin" when a capitalised place name follows.
const SERVICE_AREA = [
  /\b(?:proudly\s+serv(?:ing|e)|service\s+areas?|areas?\s+(?:we\s+)?serv(?:e|ed)|(?:communities|locations|cities|towns|neighbou?rhoods|counties)\s+(?:we\s+)?serv(?:e|ed))\b/i,
  /\b(?:[Ss]erving|SERVING|[Ww]e\s+[Ss]erve|WE\s+SERVE)\s+(?:all\s+of\s+|the\s+)?[A-Z][A-Za-z.'-]+/,
];
const COPYRIGHT = /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?\d{4}/i;
const CAREERS = /\b(?:careers?|jobs?|apply|employment|join our team|we(?:'| a)re hiring|work with us|caregiver (?:jobs|positions))\b/i;
// a form for a family to ask for care. Not job wording: "career", "caregiver", "apply" do not match, and a form
// whose words match CAREERS is never taken for one.
const REQUEST_CARE =
  /\b(?:request(?:ing)?\s+(?:care|services?|information|a\s+(?:free\s+)?(?:consult(?:ation)?|assessment|visit)|an?\s+(?:in-home\s+)?assessment)|free\s+(?:in-home\s+)?(?:consult(?:ation)?|assessment)|schedule\s+(?:a\s+|your\s+)?(?:free\s+)?(?:consult(?:ation)?|assessment|visit)|care\s+(?:request|inquiry|enquiry|needs)|get\s+care|start\s+care)\b/i;

const HOME_CARE_WORDS = [
  ['licensed', /\b(?:licen[sc]ed?|registered)\b/i],
  ['insured', /\binsured\b/i],
  ['bonded', /\bbonded\b/i],
  ['background_check', /\bbackground[\s-]+(?:check|screen)/i],
  ['trained', /\btrain(?:ed|ing)\b/i],
] as const;
const PAYERS = /\b(?:medicaid|medicare|private[\s-]pay|long[\s-]term[\s-]care insurance|veterans?(?:'|’| )|VA benefits|VA aid)\b/i;

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search}`;
  } catch {
    return url;
  }
};

// curly and straight apostrophes compare as one (each is one character, so positions do not move)
const sameQuotes = (value: string): string => value.replace(/[’‘]/g, "'").toLowerCase();

// ---------------------------------------------------------------------------------------------------------------
// The facts for one site
// ---------------------------------------------------------------------------------------------------------------

export function computeFacts(content: WebsiteContent, niche: Niche): Fact[] {
  const pages = content.pages;
  if (!pages.length) return [];
  const home = pages[0];
  const probes = content.probes;
  const facts: Fact[] = [];
  // A page that builds its content with scripts was not readable: no fact is made from its words, and nothing
  // its scripts would add to the page (a heading, a form, a link) can be said to be missing.
  const readable = pages.filter((page) => !page.textUnreadable);
  const allReadable = readable.length === pages.length;
  // a form inside an embedded frame is not read: "no form" cannot be said of a page with one
  const anyFrame = pages.some((page) => page.facts.hasIframe);

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
  const says = (
    id: keyof typeof SAYS_FACTS,
    pageUrl: string,
    quote: string,
    options: { suffix?: string; values?: Values; hintValues?: Values; markup?: boolean } = {}
  ) => {
    if (!quote) return;
    const values = options.values ?? [];
    facts.push({
      id: `${id}${options.suffix ?? ''}`,
      area: SAYS_FACTS[id].area,
      family: 'says',
      label: text(SAYS_FACTS[id].label, ...values),
      hint: text(SAYS_FACTS[id].label, ...(options.hintValues ?? values)),
      pageUrl,
      quote,
      ...(options.markup ? { markup: true } : {}),
    });
  };
  // words in the readable text: the page's words when found, and nothing at all when not (positive only)
  const words = (patterns: RegExp | RegExp[], found: keyof typeof SAYS_FACTS) => {
    const hit = findWords(readable, patterns);
    if (hit) says(found, hit.pageUrl, hit.quote);
  };

  // --- Found
  pages.forEach((page, index) => {
    const at = `@${index + 1}`;
    const path = pathOf(page.url);
    const ref = `page ${index + 1}`;
    if (!page.facts.title) absent('no_title', at, [path], [ref]);
    if (!page.facts.metaDescription) absent('no_meta_description', at, [path], [ref]);
    // a heading is in the body, which a script-built page fills in itself
    if (page.facts.h1Count === 0 && !page.textUnreadable) absent('no_h1', at, [path], [ref]);
    if (page.facts.h1Count > 1) measured('multiple_h1', at, [page.facts.h1Count, path], [page.facts.h1Count, ref]);
    // the page's own instruction, exactly as written in its code
    if (/\bnoindex\b/.test(page.facts.robotsMeta)) says('noindex', page.url, page.facts.robotsMetaRaw, { suffix: at, values: [path], hintValues: [ref], markup: true });
  });
  if (home.facts.title) measured('title_length', '', [home.facts.title.length]);
  if (home.facts.metaDescription) measured('description_length', '', [home.facts.metaDescription.length]);
  if (probes?.robots.state === 'found' && probes.robots.disallowsHome) {
    // the file's own line when it can be quoted; otherwise a plain statement with no quotation marks
    if (probes.robots.rule && probes.robots.rule.length <= MAX_SNIPPET) says('robots_disallows_home', new URL('/robots.txt', home.url).href, probes.robots.rule, { markup: true });
    else measured('robots_blocks_home');
  }
  if (probes?.sitemap.state === 'missing') absent('no_sitemap');
  if (probes?.sitemap.state === 'found') measured('sitemap_listed', '', [probes.sitemap.locCount]);
  if (!home.facts.ogTitle) absent('no_og_title');
  if (!home.facts.ogImage) absent('no_og_image');
  if (!pages.some((page) => page.facts.hasLocalBusinessSchema)) absent('no_local_business_data');
  words(PHONE, 'phone_number');
  words(STREET, 'street_address');
  // the name the site gives itself in its own data, looked for in what a visitor can read on the home page
  const name = home.facts.ogSiteName || pages.map((page) => page.facts.schemaName).find(Boolean) || '';
  if (name.length >= 3 && !home.textUnreadable) {
    const wanted = sameQuotes(name);
    const hit = home.segments.find((segment) => sameQuotes(segment.value).includes(wanted));
    if (hit) {
      const index = sameQuotes(hit.value).indexOf(wanted);
      says('business_name', home.url, hit.value.slice(index, index + name.length));
    }
  }

  // --- Clear next step
  // the link's words a visitor can see; a link with no visible words is still a link, so nothing is "not found"
  const withTel = readable.find((page) => page.facts.phoneLink?.text);
  if (withTel) says('tel_link', withTel.url, withTel.facts.phoneLink!.text);
  else if (!pages.some((page) => page.facts.hasPhoneLink) && allReadable) absent('no_tel_link');
  const withMail = readable.find((page) => page.facts.emailLink?.text);
  if (withMail) says('mailto_link', withMail.url, withMail.facts.emailLink!.text);
  else if (!pages.some((page) => page.facts.hasEmailLink) && allReadable) absent('no_mailto_link');
  if (!pages.some((page) => page.facts.formCount > 0) && allReadable && !anyFrame) absent('no_form');
  words(HOURS, 'hours');
  words(SERVICE_AREA, 'service_area');

  // --- Trust
  if (probes?.https === 'no_answer') absent('no_https_answer');
  if (probes?.httpsRedirect === 'no_redirect') absent('no_https_redirect');
  if (!pages.some((page) => page.facts.hasPrivacyLink) && allReadable) absent('no_privacy_link');
  words(COPYRIGHT, 'copyright_year');
  if (probes && probes.links.checked > 0) {
    if (probes.links.broken.length > 0) measured('broken_links', '', [probes.links.broken.length, probes.links.checked]);
    else measured('links_all_answer', '', [probes.links.checked]);
  }
  // one fact for the site: how many linked pages redirect off it, naming up to three. The paths are printed, never hinted.
  const offSite = content.offSitePages ?? [];
  if (offSite.length > 0) {
    const named = offSite.slice(0, MAX_OFF_SITE_NAMED).map(pathOf).join(', ');
    const more = offSite.length > MAX_OFF_SITE_NAMED ? ` and ${offSite.length - MAX_OFF_SITE_NAMED} more` : '';
    measured('redirects_off_site', '', [offSite.length, `${named}${more}`], [offSite.length, '']);
  }

  // --- Home care: the two doors, and the words a careful family or a referrer looks for. Words only, no verdict.
  if (niche === 'home_care') {
    // a careers link is found by its words or its address, on ANY site (an applicant portal elsewhere is common).
    // Its absence is said only from every link of every page, hidden ones included, and only when every page was readable.
    const isCareers = (link: PageLink) => CAREERS.test(link.text) || CAREERS.test(pathOf(link.href));
    const hostOf = (url: string) => {
      try {
        return new URL(url).host;
      } catch {
        return '';
      }
    };
    const homeHost = hostOf(home.url);
    const visible = readable.flatMap((page) => page.facts.links.filter((link) => !link.hidden && link.text).map((link) => ({ page, link })));
    const careers = visible.filter(({ link }) => isCareers(link) && /^https?:/i.test(link.href));
    const onSite = careers.find(({ link }) => hostOf(link.href) === homeHost);
    const elsewhere = careers.find(({ link }) => hostOf(link.href) !== homeHost);
    const first = home.textUnreadable ? undefined : home.facts.firstLinks.find((link) => /^https?:/i.test(link.href) && isCareers(link));
    if (first?.text) says(hostOf(first.href) === homeHost ? 'careers_link' : 'careers_link_elsewhere', home.url, first.text);
    else {
      if (onSite) says('careers_link', onSite.page.url, onSite.link.text);
      if (elsewhere) says('careers_link_elsewhere', elsewhere.page.url, elsewhere.link.text);
    }
    const anyCareersLink = pages.some((page) => page.facts.links.some(isCareers));
    if (!anyCareersLink && allReadable) absent('no_careers_link');
    else if (!first && (onSite || elsewhere) && !home.textUnreadable) absent('no_careers_link_first');

    // positive only: one real piece of a visible form's words (a label, a button), never job-application wording
    for (const page of readable) {
      const piece = page.facts.formParts
        .filter((parts) => !parts.some((part) => CAREERS.test(part)))
        .flatMap((parts) => parts)
        .find((part) => REQUEST_CARE.test(part));
      if (piece) {
        says('request_care_form', page.url, piece.slice(0, MAX_SNIPPET));
        break;
      }
    }

    for (const [word, pattern] of HOME_CARE_WORDS) words(pattern, `word_${word}`);
    words(PAYERS, 'payer_words');
  }

  return facts;
}

// How a cited fact is printed. The words come from this module (or from the page, for "says"), never from the model.
export function factEvidence(fact: Fact): Evidence {
  if (fact.family === 'absent') return { kind: 'absent', label: fact.label };
  // a count the code made: never the "measured" kind, which belongs to injected measurements only
  if (fact.family === 'measured') return { kind: 'counted', text: fact.label };
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
