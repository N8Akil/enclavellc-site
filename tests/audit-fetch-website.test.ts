import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_LINKED_PAGES, PAGE_TEXT_CAP, TOTAL_TEXT_CAP, TRUNCATION_MARKER } from '@/lib/audit/config'
import { extractPage, fetchWebsiteContent, validateUrl } from '@/lib/audit/fetch-website'
import { UnsafeUrlError, type ResolvedAddress, type Transport, type TransportRequest } from '@/lib/audit/safe-fetch'

// No socket and no DNS: the resolver and transport are stand-ins.
const PUBLIC = '93.184.216.34'
const HTML = { 'content-type': 'text/html' }

function site(pages: Record<string, string | { status?: number; headers?: Record<string, string>; hang?: boolean }>, dns: Record<string, string[]> = {}) {
  const calls: TransportRequest[] = []
  let inFlight = 0
  let peak = 0
  const transport: Transport = async (request) => {
    calls.push(request)
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      await Promise.resolve()
      const page = pages[request.url.href]
      if (page === undefined) return { status: 404, headers: HTML, body: (async function* () {})() }
      if (typeof page !== 'string' && page.hang) return await new Promise<never>(() => {})
      const body = typeof page === 'string' ? page : ''
      const status = typeof page === 'string' ? 200 : page.status ?? 200
      const headers = typeof page === 'string' ? HTML : page.headers ?? HTML
      return { status, headers, body: (async function* () { yield new TextEncoder().encode(body) })() }
    } finally {
      inFlight--
    }
  }
  const resolver = vi.fn(async (hostname: string): Promise<ResolvedAddress[]> => (dns[hostname] ?? [PUBLIC]).map((address) => ({ address, family: 4 })))
  return { calls, transport, resolver, options: { transport, resolver }, peak: () => peak }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('extractPage', () => {
  const html = `<html><head><title> Garrett   Plumbing </title><meta name="description" content="Family plumbers.">
<link rel="canonical" href="https://x.example.test/"><meta name="viewport" content="width=device-width">
<script>var secret = "SCRIPT-TEXT"</script><style>.x{color:red} /* STYLE-TEXT */</style></head>
<body><header><a href="tel:+15550100">Call 555-0100</a><nav><a href="/about">About us</a><a href="mailto:hi@x.example.test">Email us</a></nav></header>
<main><h1>Plumbing done right</h1><h2>Services</h2><p>We fix leaks.</p><p>We fit boilers.</p><ul><li>Drains</li><li>Heaters</li></ul>
<img src="a.jpg" alt="A van"><img src="b.jpg"><img src="c.jpg" alt=""><form><button>Get a quote</button></form>
<iframe src="x">IFRAME-TEXT</iframe><noscript>NOSCRIPT-TEXT</noscript></main>
<footer><a href="/privacy-policy">Privacy</a><a href="https://www.facebook.com/x">Facebook</a> 12 Main Street</footer></body></html>`

  it('computes the facts on the FULL document, including what sits in the header, navigation and footer', () => {
    expect(extractPage(html, 'https://x.example.test/').facts).toEqual({
      isHttps: true,
      title: 'Garrett Plumbing',
      metaDescription: 'Family plumbers.',
      h1Count: 1,
      imageCount: 3,
      imagesWithoutAlt: 1,
      hasCanonical: true,
      hasViewportMeta: true,
      hasPhoneLink: true,
      hasEmailLink: true,
      hasSocialLinks: true,
      hasPrivacyLink: true,
      formCount: 1,
    })
  })

  it('reports what is missing when it is missing', () => {
    expect(extractPage('<html><body><p>Hello</p></body></html>', 'http://x.example.test/').facts).toEqual({
      isHttps: false,
      title: '',
      metaDescription: '',
      h1Count: 0,
      imageCount: 0,
      imagesWithoutAlt: 0,
      hasCanonical: false,
      hasViewportMeta: false,
      hasPhoneLink: false,
      hasEmailLink: false,
      hasSocialLinks: false,
      hasPrivacyLink: false,
      formCount: 0,
    })
  })

  it('keeps header, navigation and footer text as labelled fields, and drops scripts, styles, iframes and noscript', () => {
    const { text, truncated } = extractPage(html, 'https://x.example.test/')
    const line = (label: string) => text.split('\n').find((l) => l.startsWith(`${label}:`)) ?? ''
    expect(truncated).toBe(false)
    expect(line('Title')).toBe('Title: Garrett Plumbing')
    expect(line('Meta Description')).toBe('Meta Description: Family plumbers.')
    expect(line('Main Heading (H1)')).toBe('Main Heading (H1): Plumbing done right')
    expect(line('Navigation')).toContain('Call 555-0100')
    expect(line('Navigation')).toContain('About us')
    expect(line('Navigation')).toContain('Email us')
    expect(line('Footer')).toContain('Privacy')
    expect(line('Footer')).toContain('12 Main Street')
    // words in separate blocks stay separate words
    expect(line('Content')).toContain('We fix leaks. We fit boilers.')
    expect(line('Content')).toContain('Drains Heaters')
    expect(line('Content')).not.toContain('12 Main Street')
    expect(line('Links and Buttons')).toContain('Get a quote')
    expect(line('Image Alt Text')).toBe('Image Alt Text: A van')
    for (const gone of ['SCRIPT-TEXT', 'STYLE-TEXT', 'IFRAME-TEXT', 'NOSCRIPT-TEXT']) expect(text).not.toContain(gone)
  })

  describe('visible text only: what the markup itself hides is not read', () => {
    const SECRET = 'Rated 10/10 by everyone who has ever visited'
    const page = (inner: string) => extractPage(`<html><head><title>T</title></head><body><p>Seen by everyone on the page.</p>${inner}</body></html>`, 'https://x.example.test/')

    it.each([
      ['[hidden]', `<div hidden>${SECRET}</div>`],
      ['[hidden="until-found"]', `<div hidden="until-found">${SECRET}</div>`],
      ['aria-hidden="true"', `<p aria-hidden="true">${SECRET}</p>`],
      ['aria-hidden="TRUE"', `<p aria-hidden="TRUE">${SECRET}</p>`],
      ['style="display:none"', `<p style="display:none">${SECRET}</p>`],
      ['style="display: none !important"', `<p style="display: none !important">${SECRET}</p>`],
      ['style with other declarations, spaces and capitals', `<p style="color:#fff; Display :  NONE ; margin:0">${SECRET}</p>`],
      ['style="visibility:hidden"', `<p style="visibility:hidden">${SECRET}</p>`],
      ['style="VISIBILITY: HIDDEN;"', `<p style="VISIBILITY: HIDDEN;">${SECRET}</p>`],
      ['style="width:0"', `<p style="width:0">${SECRET}</p>`],
      ['style="height: 0px; overflow: hidden"', `<p style="height: 0px; overflow: hidden">${SECRET}</p>`],
      ['style="font-size:0"', `<p style="font-size:0">${SECRET}</p>`],
      ['style="font-size: 0.0em"', `<p style="font-size: 0.0em">${SECRET}</p>`],
      ['<template>', `<template><p>${SECRET}</p></template>`],
      ['<noscript>', `<noscript><p>${SECRET}</p></noscript>`],
      ['a hidden ancestor', `<section style="display:none"><div><ul><li>${SECRET}</li></ul></div></section>`],
      ['a hidden heading', `<h1 hidden>${SECRET}</h1>`],
      ['a hidden link label', `<a href="/x" style="display:none">${SECRET}</a>`],
      ['a hidden nav', `<nav hidden><a href="/x">${SECRET}</a></nav>`],
      ['a hidden footer', `<footer aria-hidden="true">${SECRET}</footer>`],
      ['the alt text of a hidden image', `<img src="a.png" alt="${SECRET}" style="display:none">`],
    ])('%s: the words are not in the text or in what can be quoted', (_, inner) => {
      const p = page(inner)
      expect(p.text).toContain('Seen by everyone on the page.')
      expect(p.text).not.toContain('Rated 10/10')
      expect(JSON.stringify(p.segments)).not.toContain('Rated 10/10')
    })

    // THE LIMIT, stated in the code too: only the markup is read. A stylesheet or a script can hide text and
    // this cannot know. These cases document that, and show the rule above is not simply dropping everything.
    it.each([
      ['plain visible markup', `<p>${SECRET}</p>`],
      ['aria-hidden="false"', `<p aria-hidden="false">${SECRET}</p>`],
      ['style="display:block"', `<p style="display:block">${SECRET}</p>`],
      ['style="max-height:0"', `<p style="max-height:0">${SECRET}</p>`],
      ['style="line-height:0"', `<p style="line-height:0">${SECRET}</p>`],
      ['style="width:0.5em"', `<p style="width:0.5em">${SECRET}</p>`],
      ['style="height:100px; min-width:0"', `<p style="height:100px; min-width:0">${SECRET}</p>`],
      ['NOT DETECTED: hidden by a class in a stylesheet', `<style>.h{display:none}</style><p class="h">${SECRET}</p>`],
      ['NOT DETECTED: hidden off-screen by inline position', `<p style="position:absolute; left:-9999px">${SECRET}</p>`],
    ])('%s: the words ARE read', (_, inner) => {
      expect(page(inner).text).toContain(SECRET)
    })

    it('facts are still read from the whole document: a phone link inside a hidden menu counts as a phone link', () => {
      const p = page('<nav hidden><a href="tel:+15550100">Call us</a></nav>')
      expect(p.facts.hasPhoneLink).toBe(true)
      expect(p.text).not.toContain('Call us')
    })
  })

  describe('segments: the page\'s own words, apart from our labels', () => {
    it('every segment is exactly the slice of the text it points at, and none carries a label, a separator or the marker', () => {
      const p = extractPage(html, 'https://x.example.test/')
      expect(p.segments.length).toBeGreaterThan(8)
      for (const segment of p.segments) {
        expect(p.text.slice(segment.start, segment.start + segment.value.length)).toBe(segment.value)
        expect(segment.value).not.toMatch(/^(Title|Meta Description|Main Heading \(H1\)|Section Headings \(H2\)|Subsection Headings \(H3\)|Navigation|Content|Links and Buttons|Image Alt Text|Footer): /)
        expect(segment.value).not.toContain(' | ')
        expect(segment.value).not.toContain('\n')
      }
      const values = p.segments.map((s) => s.value)
      expect(values).toContain('Garrett Plumbing')
      expect(values).toContain('Family plumbers.')
      expect(values).toContain('Plumbing done right')
      expect(values).toContain('A van')
      // list fields are one segment per item, so a quote cannot run across our " | "
      expect(values).toContain('Get a quote')
      // the labels are in the text that is sent, and in no segment
      expect(p.text).toContain('Title: Garrett Plumbing\nMeta Description: Family plumbers.\nMain Heading (H1): Plumbing done right')
    })

    it('when a page is cut, the segments are cut with it: nothing past the cut, and not the marker', () => {
      const long = extractPage(`<html><head><title>Long</title></head><body><p>${'word '.repeat(5000)}</p><footer>The footer was cut off</footer></body></html>`, 'https://x.example.test/')
      expect(long.truncated).toBe(true)
      const end = long.text.length - TRUNCATION_MARKER.length - 1
      for (const segment of long.segments) {
        expect(segment.start + segment.value.length).toBeLessThanOrEqual(end)
        expect(long.text.slice(segment.start, segment.start + segment.value.length)).toBe(segment.value)
        expect(segment.value).not.toContain(TRUNCATION_MARKER)
      }
      expect(JSON.stringify(long.segments)).not.toContain('The footer was cut off')
    })
  })

  it('caps a long page with a visible marker and says it was cut', () => {
    const page = extractPage(`<html><body><p>${'word '.repeat(5000)}</p></body></html>`, 'https://x.example.test/')
    expect(PAGE_TEXT_CAP).toBe(12_000)
    expect(page.truncated).toBe(true)
    expect(page.text.length).toBeLessThanOrEqual(PAGE_TEXT_CAP)
    expect(page.text.endsWith(TRUNCATION_MARKER)).toBe(true)
  })
})

describe('validateUrl applies rule 1 before any request', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['http://example.com/about/?q=1#top', 'http://example.com/about'],
    ['  https://example.com:443/x ', 'https://example.com/x'],
    ['httppii-site.example.test', 'https://httppii-site.example.test'],
  ])('accepts %s as %s', (input, url) => {
    expect(validateUrl(input)).toEqual({ valid: true, url })
  })

  it.each([
    ['ftp://example.com', 'URL must use HTTP or HTTPS protocol'],
    ['file:///etc/hosts', 'URL must use HTTP or HTTPS protocol'],
    ['http://user:pass@example.com/', 'URL must not include a username or password'],
    ['user:pass@example.com', 'URL must not include a username or password'],
    ['http://example.com:8080/', 'URL must not include a port number'],
    ['example.com:3002', 'URL must not include a port number'],
    ['http://localhost/', 'URL must include a valid domain'],
    ['intranet', 'URL must include a valid domain'],
    ['', 'Invalid URL format'],
    ['http://exa mple.com', 'Invalid URL format'],
    [`https://example.com/${'a'.repeat(2100)}`, 'Invalid URL format'],
  ])('refuses %s', (input, error) => {
    const result = validateUrl(input)
    expect(result).toEqual({ valid: false, error })
    // the message never repeats what was sent
    if (input.length > 3) expect(result.error).not.toContain(input.trim())
  })
})

describe('fetchWebsiteContent', () => {
  const home = `<html><head><title>Home</title></head><body><h1>Home</h1>
<a href="/about">About</a><a href="/contact/">Contact</a><a href="/about#team">Team</a><a href="/brochure.pdf">PDF</a>
<a href="mailto:a@b.test">Mail</a><a href="tel:1">Tel</a><a href="javascript:void(0)">JS</a>
<a href="https://other.example.test/x">Elsewhere</a><a href="http://x.example.test:8080/admin">Odd port</a>
<a href="https://u:p@x.example.test/secret">Creds</a><a href="http://192.168.1.49/router">Router</a>
<a href="/moved">Moved</a><a href="/away">Away</a><a href="/inward">Inward</a></body></html>`

  it('reads the homepage and its same-host links through the guard, and nothing else', async () => {
    const s = site({
      'https://x.example.test/': home,
      'https://x.example.test/about': '<html><head><title>About</title></head><body><p>About text</p></body></html>',
      'https://x.example.test/contact': '<html><head><title>Contact</title></head><body><p>Contact text</p></body></html>',
      'https://x.example.test/moved': { status: 301, headers: { location: '/about' } },
      'https://x.example.test/away': { status: 302, headers: { location: 'https://other.example.test/x' } },
      'https://x.example.test/inward': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
      'https://other.example.test/x': '<html><head><title>Other site</title></head><body>OTHER-SITE-TEXT</body></html>',
    })
    const result = await fetchWebsiteContent('https://x.example.test', s.options)

    expect(result.pages.map((p) => p.url)).toEqual(['https://x.example.test/', 'https://x.example.test/about', 'https://x.example.test/contact'])
    expect(result.pages.map((p) => p.title)).toEqual(['Home', 'About', 'Contact'])
    expect(JSON.stringify(result)).not.toContain('OTHER-SITE-TEXT')

    const requested = s.calls.map((c) => c.url.href)
    // never requested: the pdf, mailto, tel, javascript, the other host, the odd port, the credentials, the router
    for (const url of requested) expect(url).toMatch(/^https:\/\/(x|other)\.example\.test\//)
    expect(requested.filter((u) => u.includes('other.example.test'))).toEqual(['https://other.example.test/x'])
    expect(requested).not.toContain('https://x.example.test/brochure.pdf')
    expect(requested.some((u) => u.includes('8080') || u.includes('secret') || u.includes('192.168') || u.includes('169.254'))).toBe(false)
    // every request went to the vetted public address
    expect(new Set(s.calls.map((c) => c.address))).toEqual(new Set([PUBLIC]))
  })

  it('follows links on the host that answered when the site redirects to www', async () => {
    const s = site({
      'https://x.example.test/': { status: 301, headers: { location: 'https://www.x.example.test/' } },
      'https://www.x.example.test/': '<html><head><title>Home</title></head><body><a href="/about">About</a><a href="https://x.example.test/old">Old</a></body></html>',
      'https://www.x.example.test/about': '<html><head><title>About</title></head><body>About</body></html>',
    })
    const result = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(result.pages.map((p) => p.url)).toEqual(['https://www.x.example.test/', 'https://www.x.example.test/about'])
  })

  it('reads at most ten linked pages, a few at a time', async () => {
    const links = Array.from({ length: 25 }, (_, i) => `<a href="/p${String(i).padStart(2, '0')}">P${i}</a>`).join('')
    const pages: Record<string, string> = { 'https://x.example.test/': `<html><body>${links}</body></html>` }
    for (let i = 0; i < 25; i++) pages[`https://x.example.test/p${String(i).padStart(2, '0')}`] = `<html><head><title>P${i}</title></head><body>page ${i}</body></html>`
    const s = site(pages)
    const result = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(MAX_LINKED_PAGES).toBe(10)
    expect(result.pages).toHaveLength(11)
    expect(s.calls).toHaveLength(11)
    expect(s.peak()).toBeLessThanOrEqual(3)
  })

  it('a homepage at a refused address fails with the guard\'s typed error and no request', async () => {
    const s = site({}, { 'inside.example.test': ['10.0.0.8'] })
    const error = await fetchWebsiteContent('https://inside.example.test', s.options).catch((e) => e)
    expect(error).toBeInstanceOf(UnsafeUrlError)
    expect(error.code).toBe('BLOCKED_ADDRESS')
    expect(String(error)).not.toContain('inside')
    expect(s.calls).toHaveLength(0)
  })

  it('an unreachable homepage fails with a typed error that says nothing of the site', async () => {
    const s = site({})
    const error = await fetchWebsiteContent('https://x.example.test', s.options).catch((e) => e)
    expect(error).toBeInstanceOf(UnsafeUrlError)
    expect(error.code).toBe('HTTP_STATUS')
    expect(String(error)).not.toContain('example')
  })

  it('keeps the total text under the cap, cutting later pages with the marker', async () => {
    const big = (n: number) => `<html><head><title>P${n}</title></head><body><p>${`page${n} `.repeat(3000)}</p></body></html>`
    const links = Array.from({ length: 10 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join('')
    const pages: Record<string, string> = { 'https://x.example.test/': `<html><body>${links}<p>${'home '.repeat(3000)}</p></body></html>` }
    for (let i = 0; i < 10; i++) pages[`https://x.example.test/p${i}`] = big(i)
    const result = await fetchWebsiteContent('https://x.example.test', site(pages).options)
    const total = result.pages.reduce((sum, p) => sum + p.text.length, 0)
    expect(TOTAL_TEXT_CAP).toBe(60_000)
    expect(total).toBeLessThanOrEqual(TOTAL_TEXT_CAP)
    expect(result.pages.length).toBeLessThan(11)
    for (const p of result.pages) {
      expect(p.text.length).toBeLessThanOrEqual(PAGE_TEXT_CAP)
      expect(p.truncated).toBe(true)
      expect(p.text.endsWith(TRUNCATION_MARKER)).toBe(true)
    }
  })

  it('stops at the whole-audit deadline of 45 seconds and returns what it has', async () => {
    vi.useFakeTimers()
    const links = Array.from({ length: 10 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join('')
    const pages: Record<string, string | { hang: boolean }> = { 'https://x.example.test/': `<html><head><title>Home</title></head><body>${links}</body></html>` }
    for (let i = 0; i < 10; i++) pages[`https://x.example.test/p${i}`] = { hang: true }
    const s = site(pages)
    let done: Awaited<ReturnType<typeof fetchWebsiteContent>> | undefined
    // a 30 s per-request limit here, so the 45 s deadline is what ends the second round, not the request limit
    const running = fetchWebsiteContent('https://x.example.test', { ...s.options, timeoutMs: 30_000 }).then((r) => (done = r))
    await vi.advanceTimersByTimeAsync(44_999)
    expect(done).toBeUndefined()
    // homepage, three that hung for 30 s, three more in flight
    expect(s.calls).toHaveLength(7)
    await vi.advanceTimersByTimeAsync(1)
    await running
    expect(done!.pages.map((p) => p.title)).toEqual(['Home'])
    // the three in flight were told to stop, and the other four links were never started
    expect(s.calls.slice(4).every((c) => c.signal.aborted)).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(s.calls).toHaveLength(7)
  })
})
