// src/lib/audit/fetch-website.ts
// Service to fetch and extract content from target websites
// Enhanced to discover and analyze ALL connected pages

import * as cheerio from 'cheerio';
import type { WebsiteContent } from './types';

interface DiscoveredPage {
  url: string;
  title: string;
  content: string;
}

interface EnhancedWebsiteContent extends WebsiteContent {
  discoveredPages: DiscoveredPage[];
  totalPagesAnalyzed: number;
  siteStructure: string[];
}

export async function fetchWebsiteContent(url: string): Promise<EnhancedWebsiteContent> {
  const normalizedUrl = normalizeUrl(url);
  const baseHost = new URL(normalizedUrl).host;

  try {
    // Step 1: Fetch homepage and discover all internal links
    const homepageHtml = await fetchPageRaw(normalizedUrl);
    const homepage = extractTextContent(homepageHtml);

    // Step 2: Discover all internal links from homepage
    const discoveredLinks = discoverInternalLinks(homepageHtml, normalizedUrl, baseHost);

    // Step 3: Fetch all discovered pages (limit to 10 for performance)
    const pagesToFetch = discoveredLinks.slice(0, 10);
    const discoveredPages: DiscoveredPage[] = [];

    // Fetch pages in parallel with timeout
    const pagePromises = pagesToFetch.map(async (link) => {
      try {
        const html = await fetchPageRaw(link.url);
        const content = extractTextContent(html);
        const $ = cheerio.load(html);
        const title = $('title').text() || link.label || 'Untitled';

        return {
          url: link.url,
          title: title.trim(),
          content
        };
      } catch {
        // Skip pages that fail to load
        return null;
      }
    });

    const results = await Promise.allSettled(pagePromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        discoveredPages.push(result.value);
      }
    }

    // Categorize pages for backwards compatibility
    const about = discoveredPages.find(p =>
      p.url.toLowerCase().includes('about') ||
      p.title.toLowerCase().includes('about')
    )?.content;

    const contact = discoveredPages.find(p =>
      p.url.toLowerCase().includes('contact') ||
      p.title.toLowerCase().includes('contact')
    )?.content;

    const services = discoveredPages.find(p =>
      p.url.toLowerCase().includes('service') ||
      p.title.toLowerCase().includes('service')
    )?.content;

    return {
      homepage,
      about,
      contact,
      services,
      discoveredPages,
      totalPagesAnalyzed: discoveredPages.length + 1, // +1 for homepage
      siteStructure: [normalizedUrl, ...discoveredPages.map(p => p.url)]
    };
  } catch (error) {
    throw new Error(`Failed to fetch website content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

interface InternalLink {
  url: string;
  label: string;
}

function discoverInternalLinks(html: string, baseUrl: string, baseHost: string): InternalLink[] {
  const $ = cheerio.load(html);
  const links: InternalLink[] = [];
  const seenUrls = new Set<string>();

  // Add the base URL to prevent re-fetching homepage
  seenUrls.add(normalizeUrl(baseUrl));

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const label = $(element).text().trim();

    if (!href) return;

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl).href;
      const urlObj = new URL(absoluteUrl);

      // Only include internal links (same host)
      if (urlObj.host !== baseHost) return;

      // Skip anchors, javascript, mailto, tel, file downloads
      if (
        href.startsWith('#') ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.match(/\.(pdf|doc|docx|xls|xlsx|zip|png|jpg|jpeg|gif|svg|mp4|mp3)$/i)
      ) {
        return;
      }

      // Normalize and dedupe
      const normalizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.replace(/\/$/, '');

      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        links.push({
          url: normalizedUrl,
          label: label || urlObj.pathname
        });
      }
    } catch {
      // Invalid URL, skip
    }
  });

  // Sort by likely importance (shorter paths first, then alphabetically)
  return links.sort((a, b) => {
    const aDepth = (a.url.match(/\//g) || []).length;
    const bDepth = (b.url.match(/\//g) || []).length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.url.localeCompare(b.url);
  });
}

async function fetchPageRaw(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'EnclaveLLC-AuditBot/1.0 (Website Audit Service)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000), // 15 second timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

function extractTextContent(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts, styles, and nav elements
  $('script, style, nav, footer, iframe, noscript, header').remove();

  // Extract meaningful content
  const title = $('title').text();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
  const h1 = $('h1').map((_, el) => $(el).text().trim()).get().join(' | ');
  const h2 = $('h2').map((_, el) => $(el).text().trim()).get().join(' | ');
  const h3 = $('h3').map((_, el) => $(el).text().trim()).get().join(' | ');
  const paragraphs = $('p').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(' ');
  const lists = $('li').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(' ');
  const images = $('img').map((_, el) => $(el).attr('alt') || '').get().filter(Boolean).join(' ');

  // Check for common elements
  const hasContactForm = $('form').length > 0;
  const hasPhone = $('a[href^="tel:"]').length > 0;
  const hasEmail = $('a[href^="mailto:"]').length > 0;
  const hasSocialLinks = $('a[href*="facebook"], a[href*="twitter"], a[href*="linkedin"], a[href*="instagram"]').length > 0;

  // Combine content with clear sections
  return `
Title: ${title}
Meta Description: ${metaDescription}
Meta Keywords: ${metaKeywords}
Main Heading (H1): ${h1}
Section Headings (H2): ${h2}
Subsection Headings (H3): ${h3}
Content: ${paragraphs}
List Items: ${lists}
Image Alt Text: ${images}
Has Contact Form: ${hasContactForm ? 'Yes' : 'No'}
Has Phone Number: ${hasPhone ? 'Yes' : 'No'}
Has Email Link: ${hasEmail ? 'Yes' : 'No'}
Has Social Links: ${hasSocialLinks ? 'Yes' : 'No'}
  `.trim();
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    // Try adding https:// if not present
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return normalizeUrl(`https://${url}`);
    }
    throw new Error('Invalid URL format');
  }
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const normalized = normalizeUrl(url);
    const parsed = new URL(normalized);

    // Basic validation
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }

    if (!parsed.hostname.includes('.')) {
      return { valid: false, error: 'URL must include a valid domain' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
