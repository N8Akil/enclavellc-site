// src/lib/audit/fetch-website.ts
// Reads the target site's homepage and up to MAX_LINKED_PAGES same-host pages it links to.
// Every request goes through safe-fetch.ts; nothing here opens a connection itself.

import * as cheerio from 'cheerio';
import {
  AUDIT_FETCH_DEADLINE_MS,
  MAX_LINKED_PAGES,
  PAGE_TEXT_CAP,
  TOTAL_TEXT_CAP,
  TRUNCATION_MARKER,
} from './config';
import { checkUrl, safeFetchPage, UnsafeUrlError, type SafeFetchOptions } from './safe-fetch';
import type { FetchedPage, PageFacts, WebsiteContent } from './types';

export interface FetchWebsiteOptions extends Pick<SafeFetchOptions, 'resolver' | 'transport' | 'timeoutMs' | 'maxBytes'> {
  // whole-audit time limit across all page requests
  deadlineMs?: number;
  concurrency?: number;
}

export async function fetchWebsiteContent(url: string, options: FetchWebsiteOptions = {}): Promise<WebsiteContent> {
  const { deadlineMs = AUDIT_FETCH_DEADLINE_MS, concurrency = 3, ...fetchOptions } = options;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  const guarded = { ...fetchOptions, signal: deadline.signal };

  try {
    // the homepage must load; a failure here fails the audit with the guard's typed error
    const home = await safeFetchPage(normalizeUrl(url), guarded);
    const homepage = extractPage(home.html, home.finalUrl);
    // links are followed on the host that actually answered (a site that redirects to www keeps its pages)
    const baseHost = new URL(home.finalUrl).host;
    const links = discoverInternalLinks(home.html, home.finalUrl, baseHost).slice(0, MAX_LINKED_PAGES);

    // a few at a time, in order; a linked page that fails or is refused is skipped
    const linked: Array<FetchedPage | null> = new Array(links.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < links.length && !deadline.signal.aborted) {
        const index = cursor++;
        try {
          const page = await safeFetchPage(links[index], guarded);
          // a redirect off the site's host is not part of this site
          if (new URL(page.finalUrl).host !== baseHost) continue;
          linked[index] = extractPage(page.html, page.finalUrl);
        } catch {
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
    return { pages: capTotal(pages) };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
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
      const text = cutText(page.text, room);
      kept.push({ ...page, text, truncated: true });
      used += text.length;
    }
  }
  return kept;
}

function cutText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, Math.max(0, cap - TRUNCATION_MARKER.length - 1))} ${TRUNCATION_MARKER}`;
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
      const normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.replace(/\/$/, '');
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
// Facts are read from the FULL document. Header, navigation and footer text are kept, labelled.
export function extractPage(html: string, url: string): FetchedPage {
  const $ = cheerio.load(html);

  const title = squash($('title').first().text());
  const metaDescription = squash($('meta[name="description" i]').attr('content') || '');
  const images = $('img');
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
  };

  const altText = squash(
    images
      .map((_, el) => $(el).attr('alt') || '')
      .get()
      .filter(Boolean)
      .join(' | ')
  );

  // not content: removed before any text is read
  $('script, style, iframe, noscript, template').remove();
  // keep words apart that sit in separate blocks
  $('p, div, li, br, h1, h2, h3, h4, h5, h6, td, th, tr, section, article, header, footer, nav, main, aside, a, button, label, option, dt, dd, blockquote, figcaption, summary').each(
    (_, el) => {
      $(el).before(' ').after(' ');
    }
  );

  const list = (selector: string) =>
    squash(
      $(selector)
        .map((_, el) => squash($(el).text()))
        .get()
        .filter(Boolean)
        .join(' | ')
    );
  const h1 = list('h1');
  const h2 = list('h2');
  const h3 = list('h3');

  // navigation and footer are read on their own, then taken out so the body text is the page's own content
  const navigation = squash($('header, nav').not('header nav, footer nav').text());
  const footer = squash($('footer').text());
  $('header, nav, footer').remove();
  const actions = [
    ...new Set(
      $('a, button')
        .map((_, el) => squash($(el).text()))
        .get()
        .filter((label) => label.length > 0 && label.length <= 60)
    ),
  ]
    .slice(0, 40)
    .join(' | ');
  const content = squash($('body').text());

  const full = [
    `Title: ${title}`,
    `Meta Description: ${metaDescription}`,
    `Main Heading (H1): ${h1}`,
    `Section Headings (H2): ${h2}`,
    `Subsection Headings (H3): ${h3}`,
    `Navigation: ${navigation}`,
    `Content: ${content}`,
    `Links and Buttons: ${actions}`,
    `Image Alt Text: ${altText}`,
    `Footer: ${footer}`,
  ].join('\n');

  const text = cutText(full, PAGE_TEXT_CAP);
  return { url, title: title || 'Untitled', text, truncated: text !== full, facts };
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
