import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_LINK_CHECKS, MAX_LINKED_PAGES, PAGE_TEXT_CAP, TOTAL_TEXT_CAP, TRUNCATION_MARKER } from '@/lib/audit/config'
import { countSitemapLocs, extractPage, fetchWebsiteContent, readRobots, sameSite, validateUrl } from '@/lib/audit/fetch-website'
import { UnsafeUrlError, type ResolvedAddress, type Transport, type TransportRequest } from '@/lib/audit/safe-fetch'

// No socket and no DNS: the resolver and transport are stand-ins.
const PUBLIC = '93.184.216.34'
const HTML = { 'content-type': 'text/html' }

type Served = string | { status?: number; headers?: Record<string, string>; hang?: boolean; body?: string; head?: number; throws?: boolean }
function site(pages: Record<string, Served>, dns: Record<string, string[]> = {}) {
  const calls: TransportRequest[] = []
  let inFlight = 0
  let peak = 0
  // how many response bodies were actually read from
  let bodiesRead = 0
  const transport: Transport = async (request) => {
    calls.push(request)
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      await Promise.resolve()
      const page = pages[request.url.href]
      const read = (text: string) => (async function* () { bodiesRead++; yield new TextEncoder().encode(text) })()
      if (page === undefined) return { status: 404, headers: HTML, body: read('not found') }
      if (typeof page !== 'string' && page.hang) return await new Promise<never>(() => {})
      if (typeof page !== 'string' && page.throws) throw new Error(`connect ECONNREFUSED ${request.address}`)
      const body = typeof page === 'string' ? page : page.body ?? ''
      const status = typeof page === 'string' ? 200 : request.method === 'HEAD' && page.head !== undefined ? page.head : page.status ?? 200
      const headers = typeof page === 'string' ? HTML : page.headers ?? HTML
      return { status, headers, body: read(body) }
    } finally {
      inFlight--
    }
  }
  const resolver = vi.fn(async (hostname: string): Promise<ResolvedAddress[]> => (dns[hostname] ?? [PUBLIC]).map((address) => ({ address, family: 4 })))
  // the requests that read a page of the site (as opposed to robots.txt, the sitemap, the http:// probe, link checks)
  const pageCalls = () => calls.filter((c) => (c.method ?? 'GET') === 'GET' && c.url.protocol === 'https:' && !/^\/(robots\.txt|sitemap\.xml)$/.test(c.url.pathname))
  return { calls, pageCalls, transport, resolver, options: { transport, resolver }, peak: () => peak, bodiesRead: () => bodiesRead }
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
    expect(extractPage(html, 'https://x.example.test/').facts).toMatchObject({
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

  it('reads what the five areas need from the full document: robots meta, sharing details, structured data, first links, own links, forms', () => {
    const rich = `<html><head><title>T</title>
<meta name="ROBOTS" content="NoIndex, nofollow">
<meta property="og:title" content=" Garrett  Plumbing "><meta property="og:image" content="https://x.example.test/share.png"><meta property="og:site_name" content="Garrett Plumbing">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},{"@type":["Plumber","Organization"],"name":"Garrett Plumbing LLC"}]}</script>
<script type="application/ld+json">{ this is not json</script></head>
<body><header><a href="/">Home</a><a href="tel:+15550100"> Call  555-0100 </a><a href="mailto:hi@x.example.test">hi@x.example.test</a><a href="/careers#top">Careers</a></header>
<a href="/about?x=1">About</a><a href="https://other.example.test/">Elsewhere</a><a href="http://x.example.test:8080/a">Odd port</a><a href="/about?x=1#team">About again</a>
<form><label>Your name</label><input name="n" placeholder="PLACEHOLDER-NOT-SHOWN"><button>Request care</button></form></body></html>`
    const { facts } = extractPage(rich, 'https://x.example.test/')
    expect(facts).toMatchObject({
      robotsMeta: 'noindex, nofollow',
      ogTitle: 'Garrett Plumbing',
      ogImage: 'https://x.example.test/share.png',
      ogSiteName: 'Garrett Plumbing',
      hasLocalBusinessSchema: true,
      schemaName: 'Garrett Plumbing LLC',
      phoneLink: { text: 'Call 555-0100', href: 'tel:+15550100' },
      emailLink: { text: 'hi@x.example.test', href: 'mailto:hi@x.example.test' },
    })
    expect(facts.firstLinks.slice(0, 4)).toEqual([
      { text: 'Home', href: 'https://x.example.test/' },
      { text: 'Call 555-0100', href: 'tel:+15550100' },
      { text: 'hi@x.example.test', href: 'mailto:hi@x.example.test' },
      { text: 'Careers', href: 'https://x.example.test/careers#top' },
    ])
    // own links: this host only, each once, no fragment, and only what rule 1 of the guard allows
    expect(facts.ownLinks).toEqual([
      { text: 'Home', href: 'https://x.example.test/' },
      { text: 'Careers', href: 'https://x.example.test/careers' },
      { text: 'About', href: 'https://x.example.test/about?x=1' },
    ])
    // a form's visible words only
    expect(facts.forms).toEqual(['Your name Request care'])
  })

  it('with none of those, each is empty, and a page whose structured data is not a local business says so', () => {
    const { facts } = extractPage('<html><head><script type="application/ld+json">{"@type":"WebSite","name":"Just a site"}</script></head><body><p>Hello</p></body></html>', 'http://x.example.test/')
    expect(facts).toMatchObject({ robotsMeta: '', ogTitle: '', ogImage: '', ogSiteName: '', hasLocalBusinessSchema: false, schemaName: '', phoneLink: null, emailLink: null, firstLinks: [], ownLinks: [], forms: [] })
  })

  it('reports what is missing when it is missing', () => {
    expect(extractPage('<html><body><p>Hello</p></body></html>', 'http://x.example.test/').facts).toMatchObject({
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
    // never requested: mailto, tel, javascript, the other host's own links, the odd port, the credentials, the router
    for (const url of requested) expect(url).toMatch(/^https?:\/\/(x|other)\.example\.test\//)
    // a page read that redirects to another host stops at the redirect: the other host is never requested
    expect(requested.filter((u) => u.includes('other.example.test'))).toEqual([])
    expect(s.resolver.mock.calls.map(([host]) => host)).not.toContain('other.example.test')
    // and the two links that redirect off the site are recorded as such (the metadata address is another host too)
    expect(result.offSitePages).toEqual(['https://x.example.test/away', 'https://x.example.test/inward'])
    // the pdf is never read as a page; it is only asked whether it answers (HEAD), like any link on the site's own host
    expect(s.pageCalls().map((c) => c.url.href)).not.toContain('https://x.example.test/brochure.pdf')
    expect(s.calls.filter((c) => c.url.pathname === '/brochure.pdf').map((c) => c.method)).toEqual(['HEAD'])
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

  describe('a page read never follows a redirect off the site', () => {
    const page = (title: string, links = '') => `<html><head><title>${title}</title></head><body>${links}</body></html>`

    it('sameSite: the host and its www/apex twin, either way round and in any letter case; nothing else', () => {
      for (const typed of ['x.example.test', 'www.x.example.test', 'WWW.X.Example.TEST']) {
        const onSite = sameSite(typed)
        expect(['x.example.test', 'www.x.example.test', 'X.EXAMPLE.TEST', 'Www.X.example.test'].map(onSite), typed).toEqual([true, true, true, true])
        expect(['shop.x.example.test', 'www.www.x.example.test', 'example.test', 'x.example.test.evil.test', 'other.example.test', 'wwwx.example.test'].map(onSite), typed).toEqual([false, false, false, false, false, false])
      }
      // another subdomain of the same apex is another site
      expect(sameSite('shop.x.example.test')('x.example.test')).toBe(false)
      expect(sameSite('shop.x.example.test')('www.shop.x.example.test')).toBe(true)
    })

    it('a linked page that redirects to another host: that host is never asked, and the page is recorded as leading off the site', async () => {
      const s = site({
        'https://x.example.test/': page('Home', '<a href="/about">About</a><a href="/book">Book</a>'),
        'https://x.example.test/about': page('About'),
        'https://x.example.test/book': { status: 302, headers: { location: 'https://booking.other.test/x' } },
        'https://booking.other.test/x': page('OTHER-SITE-TEXT'),
      })
      const result = await fetchWebsiteContent('https://x.example.test', s.options)
      expect(result.pages.map((p) => p.url)).toEqual(['https://x.example.test/', 'https://x.example.test/about'])
      expect(result.offSitePages).toEqual(['https://x.example.test/book'])
      expect(s.calls.filter((c) => c.url.host === 'booking.other.test')).toEqual([])
      expect(s.resolver.mock.calls.map(([host]) => host)).not.toContain('booking.other.test')
      expect(JSON.stringify(result)).not.toContain('OTHER-SITE-TEXT')
    })

    it('a linked page that redirects to a different subdomain of the same site is not followed either', async () => {
      const s = site({
        'https://x.example.test/': page('Home', '<a href="/shop">Shop</a>'),
        'https://x.example.test/shop': { status: 301, headers: { location: 'https://shop.x.example.test/' } },
      })
      const result = await fetchWebsiteContent('https://x.example.test', s.options)
      expect(result.offSitePages).toEqual(['https://x.example.test/shop'])
      expect(s.calls.some((c) => c.url.host === 'shop.x.example.test')).toBe(false)
      expect(s.resolver.mock.calls.map(([host]) => host)).not.toContain('shop.x.example.test')
    })

    it('a home page that redirects to another host fails with LEFT_SITE, and that host is never asked', async () => {
      const s = site({ 'https://x.example.test/': { status: 301, headers: { location: 'https://other.example.test/' } }, 'https://other.example.test/': page('Other') })
      const error = await fetchWebsiteContent('https://x.example.test', s.options).catch((e) => e)
      expect(error).toBeInstanceOf(UnsafeUrlError)
      expect(error.code).toBe('LEFT_SITE')
      expect(s.calls.map((c) => c.url.href)).toEqual(['https://x.example.test/'])
      expect(s.resolver.mock.calls.map(([host]) => host)).toEqual(['x.example.test'])
    })

    it('the www/apex twin is followed both ways: apex -> www and www -> apex, for the home page and for a linked page', async () => {
      // www -> apex on the home page (apex -> www is the test above)
      const back = site({
        'https://www.x.example.test/': { status: 301, headers: { location: 'https://X.example.test/' } },
        'https://x.example.test/': page('Home', '<a href="/about">About</a>'),
        'https://x.example.test/about': page('About'),
      })
      const result = await fetchWebsiteContent('https://www.x.example.test', back.options)
      expect(result.pages.map((p) => p.url)).toEqual(['https://x.example.test/', 'https://x.example.test/about'])
      expect(result.offSitePages).toEqual([])

      // a linked page that sends its visitor to the twin: the twin IS asked (the same site), and it is not "off the site"
      const twin = site({
        'https://x.example.test/': page('Home', '<a href="/old">Old</a>'),
        'https://x.example.test/old': { status: 301, headers: { location: 'https://www.x.example.test/old' } },
        'https://www.x.example.test/old': page('Old'),
      })
      const linked = await fetchWebsiteContent('https://x.example.test', twin.options)
      expect(twin.pageCalls().map((c) => c.url.href)).toContain('https://www.x.example.test/old')
      expect(linked.offSitePages).toEqual([])
    })
  })

  it('reads at most ten linked pages, a few at a time', async () => {
    const links = Array.from({ length: 25 }, (_, i) => `<a href="/p${String(i).padStart(2, '0')}">P${i}</a>`).join('')
    const pages: Record<string, string> = { 'https://x.example.test/': `<html><body>${links}</body></html>` }
    for (let i = 0; i < 25; i++) pages[`https://x.example.test/p${String(i).padStart(2, '0')}`] = `<html><head><title>P${i}</title></head><body>page ${i}</body></html>`
    const s = site(pages)
    const result = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(MAX_LINKED_PAGES).toBe(10)
    expect(result.pages).toHaveLength(11)
    expect(s.pageCalls()).toHaveLength(11)
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

describe('the site besides its pages: robots.txt, the sitemap, the http:// address, its own links', () => {
  const TEXT = { 'content-type': 'text/plain; charset=utf-8' }
  const XML = { 'content-type': 'application/xml' }
  const home = (links = '') => `<html><head><title>Home</title></head><body><h1>Home</h1>${links}</body></html>`
  // addresses that appear ONLY inside the files: one on the site itself, one on another site, two internal ones
  const SECRET_URLS = ['https://x.example.test/only-in-the-file', 'https://other.example.test/from-file', 'http://10.0.0.1/admin', 'http://169.254.169.254/latest/']

  describe('readRobots', () => {
    it.each([
      ['User-agent: *\nDisallow: /', true],
      ['user-agent: *\ndisallow: /   # everything', true],
      ['User-agent: *\r\nDisallow: /\r\n', true],
      ['User-agent: googlebot\nUser-agent: *\nDisallow: /', true],
      ['User-agent: *\nDisallow: /\nAllow: /', false],
      ['User-agent: *\nDisallow: /admin', false],
      ['User-agent: *\nDisallow:', false],
      ['User-agent: badbot\nDisallow: /', false],
      ['User-agent: badbot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/', false],
      ['User-agent: *\nAllow: /\n\nUser-agent: badbot\nDisallow: /', false],
      ['# nothing here', false],
      ['', false],
      ['<html>not a robots file</html>', false],
    ])('%j disallows the home page: %s', (text, expected) => {
      expect(readRobots(text)).toEqual({ disallowsHome: expected, rule: 'Disallow: /' })
    })
  })

  describe('countSitemapLocs', () => {
    it.each([
      ['<?xml version="1.0"?><urlset><url><loc>https://x.example.test/</loc></url><url><loc>https://x.example.test/a</loc></url></urlset>', 2],
      ['<sitemapindex><sitemap><loc>https://x.example.test/s1.xml</loc></sitemap></sitemapindex>', 1],
      ['<urlset><url><loc>  </loc></url></urlset>', 0],
      ['<urlset></urlset>', 0],
      ['<html><body>Page not found</body></html>', 0],
      ['', 0],
    ])('%j has %i', (xml, expected) => {
      expect(countSitemapLocs(xml)).toBe(expected)
    })
  })

  it('reads robots.txt and sitemap.xml with their own content types, and reports what they say', async () => {
    const s = site({
      'https://x.example.test/': home(),
      'https://x.example.test/robots.txt': { headers: TEXT, body: 'User-agent: *\nDisallow: /\nSitemap: https://x.example.test/sitemap.xml' },
      'https://x.example.test/sitemap.xml': { headers: XML, body: '<urlset><url><loc>https://x.example.test/</loc></url><url><loc>https://x.example.test/a</loc></url><url><loc>https://x.example.test/b</loc></url></urlset>' },
      'http://x.example.test/': { status: 301, headers: { location: 'https://x.example.test/' } },
    })
    const { probes } = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(probes).toEqual({
      robots: { state: 'found', disallowsHome: true, rule: 'Disallow: /' },
      sitemap: { state: 'found', locCount: 3 },
      httpsRedirect: 'redirects',
      links: { checked: 0, broken: [] },
    })
    // every one of those requests went through the guard to the vetted address
    expect(new Set(s.calls.map((c) => c.address))).toEqual(new Set([PUBLIC]))
  })

  it('READ, NEVER FOLLOWED: no address found inside robots.txt or the sitemap is ever requested', async () => {
    const s = site({
      'https://x.example.test/': home(),
      'https://x.example.test/robots.txt': { headers: TEXT, body: `User-agent: *\nAllow: /\n${SECRET_URLS.map((u) => `Sitemap: ${u}\nDisallow: ${u}`).join('\n')}` },
      'https://x.example.test/sitemap.xml': { headers: XML, body: `<sitemapindex>${SECRET_URLS.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('')}</sitemapindex>` },
    })
    const { probes, pages } = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(probes!.sitemap).toEqual({ state: 'found', locCount: 4 })
    expect(pages).toHaveLength(1)
    // exactly four requests: the home page, the two files, and the http:// address. Nothing from inside the files.
    expect(s.calls.map((c) => c.url.href).sort()).toEqual(['http://x.example.test/', 'https://x.example.test/', 'https://x.example.test/robots.txt', 'https://x.example.test/sitemap.xml'])
    for (const call of s.calls) for (const secret of ['10.0.0.1', '169.254', 'other.example.test', 'only-in-the-file', 'from-file']) expect(`${call.url.href} ${call.address}`).not.toContain(secret)
    expect(new Set(s.resolver.mock.calls.map(([host]) => host))).toEqual(new Set(['x.example.test']))
  })

  it.each([
    ['not there (404)', {}, { robots: { state: 'missing' }, sitemap: { state: 'missing' } }],
    [
      'served as an HTML page (a soft 404)',
      { 'https://x.example.test/robots.txt': '<html>Not found</html>', 'https://x.example.test/sitemap.xml': '<html>Not found</html>' },
      { robots: { state: 'missing' }, sitemap: { state: 'missing' } },
    ],
    [
      'a sitemap that is XML with no address in it',
      { 'https://x.example.test/sitemap.xml': { headers: XML, body: '<urlset></urlset>' } },
      { sitemap: { state: 'missing' } },
    ],
    [
      'no answer at all',
      { 'https://x.example.test/robots.txt': { throws: true }, 'https://x.example.test/sitemap.xml': { throws: true } },
      { robots: { state: 'unknown' }, sitemap: { state: 'unknown' } },
    ],
    [
      'redirected to another host',
      {
        'https://x.example.test/robots.txt': { status: 302, headers: { location: 'https://other.example.test/robots.txt' } },
        'https://other.example.test/robots.txt': { headers: TEXT, body: 'User-agent: *\nDisallow: /' },
      },
      { robots: { state: 'unknown' } },
    ],
  ])('robots.txt / sitemap.xml %s', async (_, served, expected) => {
    const s = site({ 'https://x.example.test/': home(), ...(served as Record<string, Served>) })
    const { probes } = await fetchWebsiteContent('https://x.example.test', s.options)
    expect(probes).toMatchObject(expected)
  })

  it.each([
    ['ends on https://', { status: 301, headers: { location: 'https://x.example.test/' } }, 'redirects'],
    ['answers on http:// itself', home(), 'no_redirect'],
    ['does not answer on http://', { throws: true }, 'unknown'],
    ['answers with an error on http://', { status: 500 }, 'unknown'],
  ])('the http:// address %s: %s', async (_, served, expected) => {
    const s = site({ 'https://x.example.test/': home(), 'http://x.example.test/': served as Served })
    expect((await fetchWebsiteContent('https://x.example.test', s.options)).probes!.httpsRedirect).toBe(expected)
    expect(s.calls.filter((c) => c.url.protocol === 'http:')).toHaveLength(1)
  })

  describe('robots.txt, the sitemap and the http:// probe follow a redirect only within the site', () => {
    const OTHER = 'elsewhere.example.org'
    const neverAsked = (s: ReturnType<typeof site>) => {
      expect(s.calls.filter((c) => c.url.hostname === OTHER)).toEqual([])
      expect(s.resolver.mock.calls.map(([host]) => host)).not.toContain(OTHER)
    }

    it('robots.txt redirected to another site: not followed (no lookup, no connection), and "unknown"', async () => {
      const s = site({
        'https://x.example.test/': home(),
        'https://x.example.test/robots.txt': { status: 302, headers: { location: `https://${OTHER}/robots.txt` } },
        [`https://${OTHER}/robots.txt`]: { headers: TEXT, body: 'User-agent: *\nDisallow: /' },
      })
      expect((await fetchWebsiteContent('https://x.example.test', s.options)).probes!.robots).toEqual({ state: 'unknown' })
      neverAsked(s)
    })

    it('robots.txt redirected within the site is followed: on the same host it is read, on the www twin it is asked', async () => {
      const same = site({
        'https://x.example.test/': home(),
        'https://x.example.test/robots.txt': { status: 301, headers: { location: '/robots-live.txt' } },
        'https://x.example.test/robots-live.txt': { headers: TEXT, body: 'User-agent: *\nDisallow: /' },
      })
      expect((await fetchWebsiteContent('https://x.example.test', same.options)).probes!.robots).toEqual({ state: 'found', disallowsHome: true, rule: 'Disallow: /' })
      const twin = site({
        'https://x.example.test/': home(),
        'https://x.example.test/robots.txt': { status: 301, headers: { location: 'https://www.x.example.test/robots.txt' } },
        'https://www.x.example.test/robots.txt': { headers: TEXT, body: 'User-agent: *\nDisallow: /' },
      })
      await fetchWebsiteContent('https://x.example.test', twin.options)
      expect(twin.calls.map((c) => c.url.href)).toContain('https://www.x.example.test/robots.txt')
    })

    it('the sitemap redirected to another site: not followed (no lookup, no connection), and "unknown"', async () => {
      const s = site({
        'https://x.example.test/': home(),
        'https://x.example.test/sitemap.xml': { status: 302, headers: { location: `https://${OTHER}/sitemap.xml` } },
        [`https://${OTHER}/sitemap.xml`]: { headers: XML, body: '<urlset><url><loc>https://x.example.test/</loc></url></urlset>' },
      })
      expect((await fetchWebsiteContent('https://x.example.test', s.options)).probes!.sitemap).toEqual({ state: 'unknown' })
      neverAsked(s)
    })

    it('the sitemap redirected within the site is followed: on the same host it is read, on the www twin it is asked', async () => {
      const body = '<urlset><url><loc>https://x.example.test/</loc></url><url><loc>https://x.example.test/a</loc></url></urlset>'
      const same = site({
        'https://x.example.test/': home(),
        'https://x.example.test/sitemap.xml': { status: 301, headers: { location: '/sitemap_index.xml' } },
        'https://x.example.test/sitemap_index.xml': { headers: XML, body },
      })
      expect((await fetchWebsiteContent('https://x.example.test', same.options)).probes!.sitemap).toEqual({ state: 'found', locCount: 2 })
      const twin = site({
        'https://x.example.test/': home(),
        'https://x.example.test/sitemap.xml': { status: 301, headers: { location: 'https://www.x.example.test/sitemap.xml' } },
        'https://www.x.example.test/sitemap.xml': { headers: XML, body },
      })
      await fetchWebsiteContent('https://x.example.test', twin.options)
      expect(twin.calls.map((c) => c.url.href)).toContain('https://www.x.example.test/sitemap.xml')
    })

    it('the http:// address redirected to another site: not followed (no lookup, no connection), and "unknown"', async () => {
      const s = site({
        'https://x.example.test/': home(),
        'http://x.example.test/': { status: 301, headers: { location: `https://${OTHER}/` } },
        [`https://${OTHER}/`]: home(),
      })
      expect((await fetchWebsiteContent('https://x.example.test', s.options)).probes!.httpsRedirect).toBe('unknown')
      neverAsked(s)
    })

    it('the http:// address redirected to https:// on its www twin still "redirects", both ways round', async () => {
      // http://x.example.test -> https://www.x.example.test (the site answers on www)
      const toWww = site({
        'https://x.example.test/': { status: 301, headers: { location: 'https://www.x.example.test/' } },
        'https://www.x.example.test/': home(),
        'http://www.x.example.test/': { status: 301, headers: { location: 'https://www.x.example.test/' } },
      })
      expect((await fetchWebsiteContent('https://x.example.test', toWww.options)).probes!.httpsRedirect).toBe('redirects')
      // the probe asks the host that answered: http://www... ; and from the apex typed site, http:// apex -> https:// www
      const apexToWww = site({
        'https://x.example.test/': home(),
        'http://x.example.test/': { status: 301, headers: { location: 'https://www.x.example.test/' } },
        'https://www.x.example.test/': home(),
      })
      expect((await fetchWebsiteContent('https://x.example.test', apexToWww.options)).probes!.httpsRedirect).toBe('redirects')
      expect(apexToWww.calls.map((c) => c.url.href)).toContain('https://www.x.example.test/')
      // www -> apex
      const toApex = site({
        'https://www.x.example.test/': home(),
        'http://www.x.example.test/': { status: 301, headers: { location: 'https://x.example.test/' } },
        'https://x.example.test/': home(),
      })
      expect((await fetchWebsiteContent('https://www.x.example.test', toApex.options)).probes!.httpsRedirect).toBe('redirects')
    })
  })

  it('a site that is itself on http:// is not asked the redirect question', async () => {
    const s = site({ 'http://x.example.test/': home() })
    const { probes, pages } = await fetchWebsiteContent('http://x.example.test', s.options)
    expect(pages[0].facts.isHttps).toBe(false)
    expect(probes!.httpsRedirect).toBe('unknown')
    expect(s.calls.filter((c) => c.url.href === 'http://x.example.test/')).toHaveLength(1)
  })

  describe('link checks', () => {
    it('asks the site\'s OWN links for their status: HEAD first, GET only on 405 or 501, and no body is ever read', async () => {
      const links = ['/ok', '/gone', '/broken', '/no-head', '/no-head-501', '/forbidden', '/moved-here', '/moved-away', '/file.pdf']
        .map((path) => `<a href="${path}">${path}</a>`)
        .join('')
      const external = '<a href="https://other.example.test/x">Other site</a><a href="https://partner.example.test/">Partner</a><a href="mailto:a@b.test">Mail</a><a href="tel:1">Tel</a>'
      const page = '<html><head><title>P</title></head><body>page</body></html>'
      const s = site({
        'https://x.example.test/': home(links + external),
        // /ok is read as a page, so it is known to answer and is not asked again
        'https://x.example.test/ok': page,
        'https://x.example.test/gone': { status: 404 },
        'https://x.example.test/broken': { status: 500 },
        'https://x.example.test/no-head': { head: 405, status: 200, headers: { 'content-type': 'application/pdf' }, body: 'BODY-NOT-READ' },
        'https://x.example.test/no-head-501': { head: 501, status: 404 },
        'https://x.example.test/forbidden': { status: 403 },
        'https://x.example.test/moved-here': { status: 301, headers: { location: '/ok' } },
        'https://x.example.test/moved-away': { status: 302, headers: { location: 'https://other.example.test/landing' } },
        'https://x.example.test/file.pdf': { status: 200, headers: { 'content-type': 'application/pdf' }, body: 'PDF-NOT-READ' },
      })
      const before = s.bodiesRead()
      const { probes, pages } = await fetchWebsiteContent('https://x.example.test', s.options)
      expect(pages.map((p) => p.url)).toEqual(['https://x.example.test/', 'https://x.example.test/ok'])

      // moved-away leads to another host: it is not followed and not counted as checked
      expect(probes!.links.checked).toBe(7)
      expect(probes!.links.broken.sort((a, b) => a.url.localeCompare(b.url))).toEqual([
        { url: 'https://x.example.test/broken', status: 500 },
        { url: 'https://x.example.test/forbidden', status: 403 },
        { url: 'https://x.example.test/gone', status: 404 },
        { url: 'https://x.example.test/no-head-501', status: 404 },
      ])

      const heads = s.calls.filter((c) => c.method === 'HEAD').map((c) => c.url.pathname)
      // moved-here is followed on the same host with HEAD again
      expect(heads.sort()).toEqual(['/broken', '/file.pdf', '/forbidden', '/gone', '/moved-away', '/moved-here', '/no-head', '/no-head-501', '/ok'].sort())
      // GET: each of these paths was tried once as a page (that is how the site's pages are found). Only the two
      // whose server refused HEAD were asked a second time with GET; the pdf, never a page, was never asked with GET.
      const gets = (path: string) => s.calls.filter((c) => (c.method ?? 'GET') === 'GET' && c.url.pathname === path).length
      expect(['/gone', '/broken', '/forbidden', '/moved-here', '/moved-away'].map(gets)).toEqual([1, 1, 1, 1, 1])
      expect(['/no-head', '/no-head-501'].map(gets)).toEqual([2, 2])
      expect(gets('/file.pdf')).toBe(0)
      // and the order for a link is HEAD, then GET
      const order = s.calls.filter((c) => c.url.pathname === '/no-head').map((c) => c.method ?? 'GET')
      expect(order).toEqual(['GET', 'HEAD', 'GET'])

      // EXTERNAL LINKS ARE NEVER REQUESTED BY A LINK CHECK: not the ones on the page, not the one a redirect points at
      expect(s.calls.filter((c) => c.method === 'HEAD' && c.url.host !== 'x.example.test')).toEqual([])
      expect(s.calls.some((c) => c.url.host === 'partner.example.test')).toBe(false)
      expect(s.resolver.mock.calls.map(([host]) => host)).not.toContain('partner.example.test')
      // nor by a page read: the page read of /moved-away stops at its redirect, so no request at all leaves the site
      expect(s.calls.filter((c) => c.url.host !== 'x.example.test').map((c) => `${c.method ?? 'GET'} ${c.url.href}`)).toEqual([])
      // no body of a checked link was read: the bodies read are the pages, the two files and the http probe at most
      const linkPaths = new Set(['/gone', '/broken', '/no-head', '/no-head-501', '/forbidden', '/moved-here', '/moved-away', '/file.pdf'])
      expect(s.bodiesRead() - before).toBeLessThanOrEqual(s.calls.filter((c) => !linkPaths.has(c.url.pathname) && c.method !== 'HEAD').length)
      expect(JSON.stringify({ probes, pages })).not.toMatch(/BODY-NOT-READ|PDF-NOT-READ/)
    })

    it('at most 20 links are asked, a few at a time', async () => {
      const links = Array.from({ length: 60 }, (_, i) => `<a href="/l${String(i).padStart(2, '0')}.pdf">L${i}</a>`).join('')
      const s = site({ 'https://x.example.test/': home(links) })
      const { probes } = await fetchWebsiteContent('https://x.example.test', s.options)
      expect(MAX_LINK_CHECKS).toBe(20)
      expect(s.calls.filter((c) => c.method === 'HEAD')).toHaveLength(20)
      expect(probes!.links.checked).toBe(20)
      expect(probes!.links.broken).toHaveLength(20)
      expect(s.peak()).toBeLessThanOrEqual(3)
    })

    it('a link that does not answer is not counted as checked or as broken', async () => {
      const s = site({ 'https://x.example.test/': home('<a href="/a.pdf">A</a><a href="/b.pdf">B</a>'), 'https://x.example.test/a.pdf': { throws: true }, 'https://x.example.test/b.pdf': { status: 200 } })
      expect((await fetchWebsiteContent('https://x.example.test', s.options)).probes!.links).toEqual({ checked: 1, broken: [] })
    })

    it('link checks stay inside the 45 second budget: after the deadline no more links are asked', async () => {
      vi.useFakeTimers()
      const links = Array.from({ length: 20 }, (_, i) => `<a href="/l${String(i).padStart(2, '0')}.pdf">L${i}</a>`).join('')
      const pages: Record<string, Served> = { 'https://x.example.test/': home(links) }
      for (let i = 0; i < 20; i++) pages[`https://x.example.test/l${String(i).padStart(2, '0')}.pdf`] = { hang: true }
      const s = site(pages)
      let done: Awaited<ReturnType<typeof fetchWebsiteContent>> | undefined
      const running = fetchWebsiteContent('https://x.example.test', { ...s.options, timeoutMs: 30_000 }).then((r) => (done = r))
      await vi.advanceTimersByTimeAsync(44_999)
      expect(done).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      await running
      const asked = s.calls.filter((c) => c.method === 'HEAD').length
      // three at a time, each cut at 30 s, then the deadline: six at most were ever started
      expect(asked).toBeLessThanOrEqual(6)
      expect(done!.probes!.links).toEqual({ checked: 0, broken: [] })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(s.calls.filter((c) => c.method === 'HEAD')).toHaveLength(asked)
    })
  })
})
