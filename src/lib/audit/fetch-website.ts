// src/lib/audit/fetch-website.ts
// Reads the target site's homepage and up to MAX_LINKED_PAGES same-host pages it links to, then asks the site a
// few more things (robots.txt, sitemap.xml, whether http:// leads to https://, whether its own links answer).
// Every request goes through safe-fetch.ts; nothing here opens a connection itself.
// Only the audited site's own host is ever asked. robots.txt and sitemap.xml are READ, NEVER FOLLOWED: no address
// found inside either file is requested.

import * as cheerio from 'cheerio';
import {
  AUDIT_FETCH_DEADLINE_MS,
  MAX_LINK_CHECKS,
  MAX_LINKED_PAGES,
  MAX_SITE_REQUESTS,
  PAGE_TEXT_CAP,
  TOTAL_TEXT_CAP,
  TRUNCATION_MARKER,
} from './config';
import {
  PLAIN_TEXT_TYPES,
  XML_TYPES,
  checkUrl,
  safeCheckLink,
  safeFetchPage,
  UnsafeUrlError,
  type SafeFetchOptions,
} from './safe-fetch';
import type { FetchedPage, PageFacts, PageLink, PageSegment, SiteProbes, WebsiteContent } from './types';

export interface FetchWebsiteOptions extends Pick<SafeFetchOptions, 'resolver' | 'transport' | 'timeoutMs' | 'maxBytes'> {
  // whole-audit time limit across all page requests
  deadlineMs?: number;
  concurrency?: number;
  // requests to the site per audit, every hop counted; MAX_SITE_REQUESTS when left out
  maxRequests?: number;
}

export async function fetchWebsiteContent(url: string, options: FetchWebsiteOptions = {}): Promise<WebsiteContent> {
  const { deadlineMs = AUDIT_FETCH_DEADLINE_MS, concurrency = 3, maxRequests = MAX_SITE_REQUESTS, ...fetchOptions } = options;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  // one request budget for everything this audit asks the site, redirects included (safe-fetch.ts requestBudget)
  const guarded: SafeFetchOptions = { ...fetchOptions, signal: deadline.signal, requestBudget: { remaining: maxRequests } };

  try {
    const start = normalizeUrl(url);
    // page reads never follow a redirect off the site: the typed host and its www/apex twin only
    const pageRead = { ...guarded, sameSiteOnly: sameSite(new URL(start).hostname) };
    // the homepage must load; a failure here (a redirect off the site included: LEFT_SITE) fails the audit with
    // the guard's typed error
    const home = await safeFetchPage(start, pageRead);
    const homepage = extractPage(home.html, home.finalUrl);
    // links are followed on the host that actually answered (a site that redirects to www keeps its pages)
    const baseHost = new URL(home.finalUrl).host;
    const links = discoverInternalLinks(home.html, home.finalUrl, baseHost).slice(0, MAX_LINKED_PAGES);

    // a few at a time, in order; a linked page that fails or is refused is skipped
    const linked: Array<FetchedPage | null> = new Array(links.length).fill(null);
    // the linked addresses whose read was redirected off the site (not followed), in link order
    const offSite: Array<string | null> = new Array(links.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < links.length && !deadline.signal.aborted) {
        const index = cursor++;
        try {
          const page = await safeFetchPage(links[index], pageRead);
          // a page that ends on the site's twin host rather than the one that answered is not read as one of its pages
          if (new URL(page.finalUrl).host !== baseHost) continue;
          linked[index] = extractPage(page.html, page.finalUrl);
        } catch (error) {
          if (error instanceof UnsafeUrlError && error.code === 'LEFT_SITE') offSite[index] = links[index];
          // skipped
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, links.length)) }, worker));

    const seen = new Set<string>([homepage.url]);
    const pages: FetchedPage[] = [homepage];
    for (const page of linked) {
      if (!page || seen.has(page.url)) continue;
      seen.add(page.url);
      pages.push(page);
    }
    const probes = await probeSite(home.finalUrl, pages, guarded, pageRead.sameSiteOnly, deadline.signal, concurrency);
    return { pages: capTotal(pages), probes, offSitePages: offSite.filter((link): link is string => link !== null) };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}

// The audited site, as page reads see it: the host typed and its www/apex twin (example.com and www.example.com,
// either way round), compared without regard to letter case. Nothing else is the same site: not another subdomain.
// (Ports and schemes are the guard's business: rule 1 already refuses any port but the scheme's default.)
export function sameSite(siteHostname: string): (hostname: string) => boolean {
  const bare = (name: string) => name.toLowerCase().replace(/^\[|\]$/g, '');
  const host = bare(siteHostname);
  // "www.example.com" -> "example.com"; a name that is only "www." and one label keeps its www
  const apex = /^www\.[^.]+\.[^.]/.test(host) ? host.slice(4) : host;
  return (hostname) => {
    const candidate = bare(hostname);
    return candidate === apex || candidate === `www.${apex}`;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The site besides its pages. All of it on the host that answered, through the guard, inside the same time budget.
// ---------------------------------------------------------------------------------------------------------------

// Does robots.txt tell every crawler to stay off the home page? Read from the group for "*": a "Disallow: /"
// with no "Allow: /" beside it. Nothing in the file is followed. `rule` is the file's own line that says so, exactly
// as written (trimmed), so it can be quoted; '' when there is none.
export function readRobots(text: string): { disallowsHome: boolean; rule: string } {
  let inStarGroup = false;
  let lastWasAgent = false;
  let disallow = false;
  let allow = false;
  let rule = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      // consecutive user-agent lines share one group
      inStarGroup = lastWasAgent ? inStarGroup || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStarGroup) continue;
    if (field === 'disallow' && value === '/') {
      disallow = true;
      rule ||= raw.trim();
    }
    if (field === 'allow' && (value === '/' || value === '/$')) allow = true;
  }
  const disallowsHome = disallow && !allow;
  return { disallowsHome, rule: disallowsHome ? rule : '' };
}

// How many <loc> entries a sitemap has, or 0 when it is not XML with any. The addresses are counted, never requested.
export function countSitemapLocs(xml: string): number {
  try {
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('loc').filter((_, el) => squash($(el).text()).length > 0).length;
  } catch {
    return 0;
  }
}

async function probeSite(
  homeUrl: string,
  pages: FetchedPage[],
  guarded: SafeFetchOptions,
  // the same-site rule of the page reads: robots.txt, the sitemap and the http:// probe follow a redirect only within
  // the site, and one that points anywhere else ends with LEFT_SITE before that host is resolved (link checks have
  // their own, stricter same-host rule and do not take this)
  onSite: (hostname: string) => boolean,
  deadline: AbortSignal,
  concurrency: number
): Promise<SiteProbes> {
  const home = new URL(homeUrl);
  const origin = `${home.protocol}//${home.host}`;
  const siteRead = { ...guarded, sameSiteOnly: onSite };
  // missing = the audited host itself answered 404 or 410: the file is not there. Everything else (401, 403, 429,
  // 5xx, a wrong content type, a timeout, a refusal, the budget spent, a redirect off the site: a file that lives
  // on another site is not ours to read) is unknown, and nothing is claimed.
  const missingOrUnknown = (error: unknown): 'missing' | 'unknown' =>
    error instanceof UnsafeUrlError && error.code === 'HTTP_STATUS' && (error.status === 404 || error.status === 410) && !error.hostChanged
      ? 'missing'
      : 'unknown';

  const robots = (async (): Promise<SiteProbes['robots']> => {
    try {
      const file = await safeFetchPage(`${origin}/robots.txt`, { ...siteRead, allowedContentTypes: PLAIN_TEXT_TYPES });
      // a redirect to another host is not this site's robots.txt
      if (new URL(file.finalUrl).host !== home.host) return { state: 'unknown' };
      return { state: 'found', ...readRobots(file.html) };
    } catch (error) {
      return { state: missingOrUnknown(error) };
    }
  })();

  const sitemap = (async (): Promise<SiteProbes['sitemap']> => {
    try {
      const file = await safeFetchPage(`${origin}/sitemap.xml`, { ...siteRead, allowedContentTypes: XML_TYPES });
      if (new URL(file.finalUrl).host !== home.host) return { state: 'unknown' };
      const locCount = countSitemapLocs(file.html);
      // an answer with no address in it is no claim either way (an error page served as XML looks the same)
      return locCount > 0 ? { state: 'found', locCount } : { state: 'unknown' };
    } catch (error) {
      return { state: missingOrUnknown(error) };
    }
  })();

  // Does the site answer on https:// at all? A site read over https does. A site read over http:// is ASKED: one
  // request to https://<same host>/, same-site redirects only. It has https when that ends on an https:// page;
  // 'no_answer' only when the request failed with a connection or TLS error (NETWORK); anything else is unknown.
  const https = (async (): Promise<NonNullable<SiteProbes['https']>> => {
    if (home.protocol === 'https:') return 'yes';
    try {
      const secure = await safeFetchPage(`https://${home.host}/`, siteRead);
      return secure.finalUrl.startsWith('https://') ? 'yes' : 'unknown';
    } catch (error) {
      if (!(error instanceof UnsafeUrlError)) return 'unknown';
      // it answered over https with a page of another type: it has https
      if (error.code === 'BAD_CONTENT_TYPE') return 'yes';
      return error.code === 'NETWORK' ? 'no_answer' : 'unknown';
    }
  })();

  // one extra request: the same host over http://. Where it ends up is the answer. Its redirect to https:// (on the
  // host or its www/apex twin) is followed; one to another site ends the probe unanswered ('unknown'). Asked only
  // when the site is known to have https.
  const httpsRedirect = (async (): Promise<SiteProbes['httpsRedirect']> => {
    if ((await https) !== 'yes') return 'unknown';
    try {
      const plain = await safeFetchPage(`http://${home.host}/`, siteRead);
      return plain.finalUrl.startsWith('https://') ? 'redirects' : 'no_redirect';
    } catch {
      return 'unknown';
    }
  })();

  // links on the pages read that point at this same host and were not themselves read as pages
  const read = new Set(pages.map((page) => page.url.replace(/\/$/, '')));
  const candidates: string[] = [];
  for (const page of pages) {
    for (const { href } of page.facts.ownLinks) {
      if (candidates.length >= MAX_LINK_CHECKS) break;
      if (read.has(href.replace(/\/$/, '')) || candidates.includes(href)) continue;
      candidates.push(href);
    }
  }
  const links: SiteProbes['links'] = { checked: 0, broken: [] };
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length && !deadline.aborted) {
      const url = candidates[cursor++];
      try {
        const { status, leftHost } = await safeCheckLink(url, home.host, guarded);
        // a link that leads to another host was not checked there, so it is not counted as checked at all
        if (leftHost) continue;
        links.checked += 1;
        if (status >= 400 && status <= 599) links.broken.push({ url, status });
      } catch {
        // no answer (a timeout, a refusal): nothing is claimed about this link
      }
    }
  };
  // the three questions first, then the links: never more than a few requests to the site at once
  await Promise.all([robots, sitemap, httpsRedirect]);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, candidates.length)) }, worker));

  return { robots: await robots, sitemap: await sitemap, httpsRedirect: await httpsRedirect, https: await https, links };
}

// Keeps the total text sent to the model under TOTAL_TEXT_CAP. Later pages are cut first, visibly.
function capTotal(pages: FetchedPage[]): FetchedPage[] {
  const kept: FetchedPage[] = [];
  let used = 0;
  for (const page of pages) {
    const room = TOTAL_TEXT_CAP - used;
    if (room <= TRUNCATION_MARKER.length + 200) break;
    if (page.text.length <= room) {
      kept.push(page);
      used += page.text.length;
    } else {
      const cut = cutPage(page, room);
      kept.push(cut);
      used += cut.text.length;
    }
  }
  return kept;
}

function discoverInternalLinks(html: string, baseUrl: string, baseHost: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seenUrls = new Set<string>([normalizeUrl(baseUrl)]);

  $('a[href]').each((_, element) => {
    const href = ($(element).attr('href') || '').trim();
    if (!href || href.startsWith('#')) return;
    if (/\.(pdf|doc|docx|xls|xlsx|zip|png|jpg|jpeg|gif|svg|webp|mp4|mp3)$/i.test(href.split(/[?#]/)[0])) return;

    try {
      // rule 1 here too, so mailto:, tel:, javascript:, odd ports and credentials never become a request
      const urlObj = checkUrl(new URL(href, baseUrl));
      // only the same host as the page that answered
      if (urlObj.host !== baseHost) return;
      // the query is kept: on some sites (?page_id=12) it is what tells one page from another
      const normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`;
      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        links.push(normalizedUrl);
      }
    } catch {
      // not a URL the audit may request: skip
    }
  });

  // shorter paths first, then alphabetically
  return links.sort((a, b) => {
    const aDepth = (a.match(/\//g) || []).length;
    const bDepth = (b.match(/\//g) || []).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.localeCompare(b);
  });
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Turns one page's HTML into the facts the code can state and the labelled text the model reads.
// STRUCTURAL facts (is there a title, an H1, a tel: link, a form...) are read from the FULL document. Every WORD
// kept for quoting or for a fact (link text, form words, the text itself) is read only AFTER the hidden markup is
// set aside, so nothing the page hides can be quoted. A hidden link is still counted as a link; its words are not kept.
export function extractPage(html: string, url: string): FetchedPage {
  // the block boundary is our own private-use character: none may come from the page
  const $ = cheerio.load(html.replace(BLOCK_RE, ''));

  const title = squash($('title').first().text());
  const metaDescription = squash($('meta[name="description" i]').attr('content') || '');
  const images = $('img');
  const robotsMetaRaw = ($('meta[name="robots" i]').attr('content') || '').trim().slice(0, 160);

  // VISIBLE TEXT ONLY, as far as the markup itself says: text the page hides in its own markup is not read, so it
  // can be neither quoted nor used as evidence. Set aside: <template>, <noscript>, [hidden], aria-hidden="true", and
  // inline styles with display:none, visibility:hidden, or a zero width, height or font-size.
  // THE LIMIT: hiding done in a stylesheet (a class) or by script is NOT detected. This is a text read, not a render.
  $(`[${HIDDEN_MARK}]`).removeAttr(HIDDEN_MARK);
  $('template, noscript, [hidden], [aria-hidden="true" i]').attr(HIDDEN_MARK, '');
  $('[style]')
    .filter((_, el) => HIDING_STYLE.test(($(el).attr('style') || '').toLowerCase().replace(/\s+/g, '')))
    .attr(HIDDEN_MARK, '');
  const isHidden = (el: Parameters<typeof $>[0]) => $(el).closest(`[${HIDDEN_MARK}]`).length > 0;

  // every link of the page, any host: its address, and its words only when a visitor can see them
  const links: Array<PageLink & { hidden: boolean }> = [];
  $('a[href]').each((_, el) => {
    if (links.length >= MAX_LINKS_KEPT) return;
    const hidden = isHidden(el);
    links.push({ text: hidden ? '' : squash($(el).text()), href: absolute(($(el).attr('href') || '').trim(), url), hidden });
  });
  const visibleLinks = links.filter((link) => !link.hidden);
  const firstOf = (scheme: string): PageLink | null => {
    const link = visibleLinks.find((l) => l.href.toLowerCase().startsWith(scheme));
    return link ? { text: link.text, href: link.href } : null;
  };
  // each visible form's visible words, piece by piece (a label, a button...), so a fact can quote one real piece
  const formParts = $('form')
    .filter((_, form) => !isHidden(form))
    .map((_, form) => [
      $(form)
        .find('label, button, legend, h2, h3, p, option')
        .filter((__, el) => !isHidden(el))
        .map((__, el) => squash($(el).text()).slice(0, 160))
        .get()
        .filter(Boolean),
    ])
    .get() as string[][];

  const facts: PageFacts = {
    isHttps: url.startsWith('https://'),
    title,
    metaDescription,
    h1Count: $('h1').length,
    imageCount: images.length,
    imagesWithoutAlt: images.filter((_, el) => $(el).attr('alt') === undefined).length,
    hasCanonical: $('link[rel="canonical" i][href]').length > 0,
    hasViewportMeta: $('meta[name="viewport" i]').length > 0,
    hasPhoneLink: $('a[href^="tel:" i]').length > 0,
    hasEmailLink: $('a[href^="mailto:" i]').length > 0,
    hasSocialLinks:
      $(
        'a[href*="facebook.com" i], a[href*="twitter.com" i], a[href*="//x.com" i], a[href*="linkedin.com" i], a[href*="instagram.com" i], a[href*="youtube.com" i], a[href*="tiktok.com" i]'
      ).length > 0,
    hasPrivacyLink:
      $('a[href]').filter((_, el) => /privacy/i.test($(el).attr('href') || '') || /privacy/i.test($(el).text())).length > 0,
    formCount: $('form').length,
    // a form can live in an embedded frame, which is not read: then "no form" cannot be said
    hasIframe: $('iframe').length > 0,
    // scripts that can build the page (structured data blocks are not that)
    hasScripts: $('script').filter((_, el) => !/ld\+json/i.test($(el).attr('type') || '')).length > 0,
    robotsMeta: robotsMetaRaw.toLowerCase(),
    robotsMetaRaw,
    ogTitle: squash($('meta[property="og:title" i]').attr('content') || ''),
    ogImage: squash($('meta[property="og:image" i]').attr('content') || ''),
    ogSiteName: squash($('meta[property="og:site_name" i]').attr('content') || ''),
    ...readStructuredData($),
    phoneLink: firstOf('tel:'),
    emailLink: firstOf('mailto:'),
    firstLinks: visibleLinks.slice(0, FIRST_LINKS).map(({ text, href }) => ({ text, href })),
    ownLinks: ownLinks(visibleLinks, url),
    links,
    forms: formParts.map((parts) => parts.join(' ').slice(0, 300)),
    formParts,
  };

  // not content: removed before any text is read; then what the page hides
  $('script, style, iframe').remove();
  $(`[${HIDDEN_MARK}]`).remove();

  const altItems = $('img')
    .map((_, el) => squash($(el).attr('alt') || ''))
    .get()
    .filter(Boolean);

  // Block elements end a block (our private boundary); inline pieces that read as separate words get a space.
  // A quote is checked inside ONE block, so it cannot run from a heading into the paragraph after it.
  $(BLOCK_TAGS).each((_, el) => {
    $(el).before(BLOCK).after(BLOCK);
  });
  $('br, a, button, label, option').each((_, el) => {
    $(el).before(' ').after(' ');
  });

  const items = (selector: string) =>
    $(selector)
      .map((_, el) => squashText($(el).text()))
      .get()
      .filter(Boolean);
  const h1 = items('h1');
  const h2 = items('h2');
  const h3 = items('h3');
  // how much a visitor can read without scripts running
  const visibleLength = squashText($('body').text()).length;

  // navigation and footer are read on their own, then taken out so the body text is the page's own content
  const navigation = blocksOf($('header, nav').not('header nav, footer nav').text());
  const footer = blocksOf($('footer').text());
  $('header, nav, footer').remove();
  const actions = [...new Set(items('a, button').filter((label) => label.length <= 60))].slice(0, 40);
  const content = blocksOf($('body').text());

  // Each field is OUR label followed by the PAGE'S words. The words are also kept on their own (segments), so a
  // quote can be checked against what the page said and never against a label or a separator we added. A list
  // field is one segment per item (" | " between them); a text field is one segment per block (a space between).
  const fields: Array<[label: string, values: string[], joiner: string]> = [
    ['Title', [title], ' | '],
    ['Meta Description', [metaDescription], ' | '],
    ['Main Heading (H1)', h1, ' | '],
    ['Section Headings (H2)', h2, ' | '],
    ['Subsection Headings (H3)', h3, ' | '],
    ['Navigation', navigation, ' '],
    ['Content', content, ' '],
    ['Links and Buttons', actions, ' | '],
    ['Image Alt Text', altItems, ' | '],
    ['Footer', footer, ' '],
  ];
  let full = '';
  const segments: PageSegment[] = [];
  fields.forEach(([label, values, joiner], index) => {
    full += `${index ? '\n' : ''}${label}: `;
    values.forEach((value, i) => {
      if (i) full += joiner;
      if (value) segments.push({ start: full.length, value });
      full += value;
    });
  });

  // A page whose visible text is this small while scripts are present builds its content with scripts: what a
  // visitor reads was not in what we read, so no fact is made from its text.
  const textUnreadable = facts.hasScripts && visibleLength < SCRIPT_PAGE_MIN_TEXT;
  return cutPage({ url, title: title || 'Untitled', text: full, truncated: false, facts, segments, textUnreadable }, PAGE_TEXT_CAP);
}

// how many of a page's links count as "the first links": roughly what sits in the header and the first screen
const FIRST_LINKS = 15;
// links kept per page (their address and visible words), at most
const MAX_LINKS_KEPT = 500;
// a page with scripts and less visible text than this is taken to be built by its scripts
export const SCRIPT_PAGE_MIN_TEXT = 200;

const HIDDEN_MARK = 'data-enclave-audit-hidden';
const BLOCK = '';
const BLOCK_RE = //g;
const BLOCK_TAGS =
  'p, div, li, h1, h2, h3, h4, h5, h6, td, th, tr, section, article, header, footer, nav, main, aside, dt, dd, blockquote, figcaption, summary, form, ul, ol, table, fieldset, address, pre, details';
// text with our block boundaries read as spaces
const squashText = (text: string): string => squash(text.replace(BLOCK_RE, ' '));
// text split at our block boundaries, one entry per non-empty block
const blocksOf = (text: string): string[] => text.split(BLOCK).map(squash).filter(Boolean);

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// Links to the page's own host, absolute and without fragment, each passing rule 1 of the guard.
function ownLinks(links: PageLink[], pageUrl: string): PageLink[] {
  const host = new URL(pageUrl).host;
  const found = new Map<string, PageLink>();
  for (const { text, href } of links) {
    if (!href || href.startsWith('#')) continue;
    try {
      const link = checkUrl(new URL(href, pageUrl));
      if (link.host !== host) continue;
      link.hash = '';
      if (!found.has(link.href)) found.set(link.href, { text, href: link.href });
    } catch {
      // not a link the audit may request
    }
  }
  return [...found.values()];
}

// schema.org types that are a LocalBusiness or one of its kinds
const LOCAL_BUSINESS_TYPE = /(LocalBusiness|Business|Store|Restaurant|Dentist|Physician|Plumber|Electrician|Locksmith|RoofingContractor|GeneralContractor|HousePainter|MovingCompany|ProfessionalService|LegalService|HomeHealthCare|MedicalClinic|Pharmacy|AutoRepair|ChildCare|Hotel|RealEstateAgent|TravelAgency)$/;

// Reads the page's structured data: JSON-LD blocks (a block that is not valid JSON is ignored), and schema.org
// types written as microdata (itemtype) or RDFa (typeof).
function readStructuredData($: cheerio.CheerioAPI): { hasLocalBusinessSchema: boolean; schemaName: string } {
  let hasLocalBusinessSchema = false;
  let schemaName = '';
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((item) => visit(item, depth + 1));
    const record = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(record['@type'] ?? []).filter((t): t is string => typeof t === 'string');
    if (types.some((type) => LOCAL_BUSINESS_TYPE.test(type))) {
      hasLocalBusinessSchema = true;
      if (!schemaName && typeof record.name === 'string') schemaName = squash(record.name).slice(0, 120);
    }
    visit(record['@graph'], depth + 1);
  };
  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()), 0);
    } catch {
      // not JSON
    }
  });
  // microdata: itemtype="https://schema.org/Plumber"; RDFa: typeof="schema:LocalBusiness" (space-separated tokens)
  const tokens = (value: string | undefined) => (value || '').split(/\s+/).map((t) => t.replace(/^.*[/:#]/, '')).filter(Boolean);
  $('[itemtype], [typeof]').each((_, el) => {
    const types = [...tokens($(el).attr('itemtype')), ...tokens($(el).attr('typeof'))];
    if (!types.some((type) => LOCAL_BUSINESS_TYPE.test(type))) return;
    hasLocalBusinessSchema = true;
    if (!schemaName) {
      const name = $(el).find('[itemprop="name"], [property="name"], [property="schema:name"]').first();
      schemaName = squash(name.attr('content') || name.text()).slice(0, 120);
    }
  });
  return { hasLocalBusinessSchema, schemaName };
}

// (?:^|;) keeps max-height:0 and line-height:0 out of it: those do not hide text by themselves
const HIDING_STYLE = /(?:^|;)(?:display:none|visibility:hidden|(?:width|height|font-size):0(?:\.0+)?(?:px|em|rem|pt|%|vh|vw)?)(?:!important)?(?:;|$)/;

// Cuts a page's text to `cap` characters with the visible marker, and its segments with it.
function cutPage(page: FetchedPage, cap: number): FetchedPage {
  if (page.text.length <= cap) return page;
  const keep = Math.max(0, cap - TRUNCATION_MARKER.length - 1);
  // the marker is ours; whatever of the page's words was cut off is no longer quotable
  const body = page.truncated ? page.text.slice(0, page.text.length - TRUNCATION_MARKER.length - 1) : page.text;
  const text = `${body.slice(0, keep)} ${TRUNCATION_MARKER}`;
  const segments = page.segments
    .filter((segment) => segment.start < keep)
    .map((segment) => ({ start: segment.start, value: segment.value.slice(0, keep - segment.start) }));
  return { ...page, text, truncated: true, segments };
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  // no query, no fragment, no trailing slash
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
}

const URL_ERRORS: Partial<Record<UnsafeUrlError['code'], string>> = {
  BLOCKED_SCHEME: 'URL must use HTTP or HTTPS protocol',
  HAS_CREDENTIALS: 'URL must not include a username or password',
  BLOCKED_PORT: 'URL must not include a port number',
};

// Rule 1 of the fetch guard, before any request: scheme, credentials, port, length, plus a real-looking host.
// On success, `url` is the normalised URL the rest of the pipeline should use. Messages never echo the input.
export function validateUrl(url: string): { valid: boolean; error?: string; url?: string } {
  try {
    const trimmed = url.trim();
    // a bare domain ("example.com/page") gets https://; anything that already names a scheme is judged as written
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = checkUrl(candidate);

    if (!parsed.hostname.includes('.') && !parsed.hostname.includes(':')) {
      return { valid: false, error: 'URL must include a valid domain' };
    }

    return { valid: true, url: normalizeUrl(parsed.href) };
  } catch (error) {
    const message = error instanceof UnsafeUrlError ? URL_ERRORS[error.code] : undefined;
    return { valid: false, error: message || 'Invalid URL format' };
  }
}
