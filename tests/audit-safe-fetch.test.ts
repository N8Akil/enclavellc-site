import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_URL_LENGTH,
  UnsafeUrlError,
  checkUrl,
  isPublicAddress,
  PLAIN_TEXT_TYPES,
  READABLE_TYPES,
  XML_TYPES,
  safeCheckLink,
  safeFetchPage,
  type ResolvedAddress,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '@/lib/audit/safe-fetch'
import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from '@/lib/audit/config'

// No socket is opened and no DNS is asked anywhere in this file: the resolver and the transport are stand-ins.
const PUBLIC = '93.184.216.34'
const PUBLIC_2 = '151.101.1.69'
const PRIVATE = '192.168.1.49'
const HTML = { 'content-type': 'text/html; charset=utf-8' }

type Route = Partial<Omit<TransportResponse, 'body'>> & { body?: string | Uint8Array[]; hang?: boolean; throws?: Error; head?: number }

function harness(routes: Record<string, Route> = {}, dns: Record<string, ResolvedAddress[]> = {}) {
  const calls: TransportRequest[] = []
  let chunksServed = 0
  const transport: Transport = async (request) => {
    calls.push(request)
    const route = routes[request.url.href]
    if (!route) throw new Error(`no route for ${request.url.href}`)
    if (route.throws) throw route.throws
    if (route.hang) return new Promise<TransportResponse>(() => {})
    const chunks = typeof route.body === 'string' ? [new TextEncoder().encode(route.body)] : route.body ?? []
    return {
      status: request.method === 'HEAD' && route.head !== undefined ? route.head : route.status ?? 200,
      headers: route.headers ?? HTML,
      body: (async function* () {
        for (const chunk of chunks) {
          chunksServed++
          yield chunk
        }
      })(),
    }
  }
  const resolver = vi.fn(async (hostname: string) => {
    const answer = dns[hostname]
    if (!answer) throw new Error(`ENOTFOUND ${hostname}`)
    return answer
  })
  return { calls, transport, resolver, options: { transport, resolver }, chunksServed: () => chunksServed }
}

const v4 = (address: string): ResolvedAddress => ({ address, family: 4 })

async function refusal(promise: Promise<unknown>): Promise<UnsafeUrlError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UnsafeUrlError)
    return error as UnsafeUrlError
  }
  throw new Error('expected a refusal, but the request went through')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('isPublicAddress', () => {
  it.each([
    // IPv4, every refused range: first and last address
    ['0.0.0.0', false],
    ['0.255.255.255', false],
    ['10.0.0.0', false],
    ['10.255.255.255', false],
    ['100.64.0.0', false],
    ['100.127.255.255', false],
    ['127.0.0.1', false],
    ['127.255.255.255', false],
    ['169.254.0.0', false],
    ['169.254.169.254', false],
    ['172.16.0.0', false],
    ['172.31.255.255', false],
    ['192.0.0.0', false],
    ['192.0.0.255', false],
    ['192.0.2.1', false],
    ['192.88.99.1', false],
    ['192.168.0.0', false],
    ['192.168.255.255', false],
    ['198.18.0.0', false],
    ['198.19.255.255', false],
    ['198.51.100.7', false],
    ['203.0.113.7', false],
    ['224.0.0.1', false],
    ['239.255.255.255', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
    // IPv4, the public neighbours of those ranges
    ['1.1.1.1', true],
    ['9.255.255.255', true],
    ['11.0.0.0', true],
    ['100.63.255.255', true],
    ['100.128.0.0', true],
    ['126.255.255.255', true],
    ['128.0.0.1', true],
    ['169.253.255.255', true],
    ['169.255.0.0', true],
    ['172.15.255.255', true],
    ['172.32.0.0', true],
    ['192.0.1.1', true],
    ['192.0.3.1', true],
    ['192.167.255.255', true],
    ['192.169.0.0', true],
    ['198.17.255.255', true],
    ['198.20.0.0', true],
    ['198.51.99.1', true],
    ['198.51.101.1', true],
    ['203.0.112.1', true],
    ['203.0.114.1', true],
    ['223.255.255.255', true],
    [PUBLIC, true],
    // IPv6
    ['::', false],
    ['::1', false],
    ['fc00::1', false],
    ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['fe80::1', false],
    ['febf::1', false],
    ['fec0::1', false],
    ['ff00::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['2001:db8:ffff::1', false],
    ['64:ff9b::7f00:1', false],
    ['64:ff9b::5db8:d822', false],
    ['2001::1', false],
    ['2002:c0a8:131::1', false],
    ['100::1', false],
    ['2606:4700:4700::1111', true],
    ['2a00:1450:4001:81b::200e', true],
    // IPv4-mapped and IPv4-compatible: judged by the IPv4 address inside
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:a00:1', false],
    ['::ffff:c0a8:131', false],
    ['::ffff:169.254.169.254', false],
    ['0:0:0:0:0:ffff:7f00:1', false],
    ['::127.0.0.1', false],
    ['::10.0.0.1', false],
    ['::a00:1', false],
    ['::ffff:93.184.216.34', true],
    ['::ffff:5db8:d822', true],
    // not plain address literals: never public
    ['', false],
    ['localhost', false],
    ['example.com', false],
    ['2130706433', false],
    ['0x7f.0.0.1', false],
    ['0177.0.0.1', false],
    ['127.1', false],
    ['1.2.3', false],
    ['1.2.3.4.5', false],
    ['256.1.1.1', false],
    ['fe80::1%eth0', false],
    ['[::1]', false],
    [' 1.1.1.1', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })

  // The spellings a URL parser accepts for loopback: what new URL() turns them into is what gets judged.
  it.each(['http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://0x7f000001/', 'http://017700000001/', 'http://127.0.1/'])(
    'the odd spelling %s is normalised by new URL() to a loopback literal and is not public',
    (spelling) => {
      const host = new URL(spelling).hostname
      expect(host).toMatch(/^127\./)
      expect(isPublicAddress(host)).toBe(false)
    }
  )
})

describe('checkUrl (rule 1)', () => {
  it.each([
    ['ftp://example.com/', 'BLOCKED_SCHEME'],
    ['file:///etc/hosts', 'BLOCKED_SCHEME'],
    ['javascript:alert(1)', 'BLOCKED_SCHEME'],
    ['gopher://example.com/', 'BLOCKED_SCHEME'],
    ['http://user@example.com/', 'HAS_CREDENTIALS'],
    ['http://user:pass@example.com/', 'HAS_CREDENTIALS'],
    ['https://:pass@example.com/', 'HAS_CREDENTIALS'],
    ['http://example.com:8080/', 'BLOCKED_PORT'],
    ['http://example.com:443/', 'BLOCKED_PORT'],
    ['https://example.com:80/', 'BLOCKED_PORT'],
    ['https://example.com:3002/', 'BLOCKED_PORT'],
    ['not a url', 'BAD_URL'],
    ['http://', 'BAD_URL'],
    [`https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`, 'BAD_URL'],
  ])('refuses %s with %s', (url, code) => {
    expect(() => checkUrl(url)).toThrow(UnsafeUrlError)
    try {
      checkUrl(url)
    } catch (error) {
      expect((error as UnsafeUrlError).code).toBe(code)
    }
  })

  it.each(['http://example.com/', 'https://example.com/a?b=c', 'http://example.com:80/', 'https://example.com:443/x'])('accepts %s', (url) => {
    expect(checkUrl(url).hostname).toBe('example.com')
  })
})

describe('safeFetchPage', () => {
  it('fetches a public page, sending identity encoding, and returns the final URL', async () => {
    const h = harness({ 'https://example.com/': { body: '<html><title>ok</title></html>' } }, { 'example.com': [v4(PUBLIC)] })
    const page = await safeFetchPage('https://example.com/', h.options)
    expect(page).toEqual({ finalUrl: 'https://example.com/', html: '<html><title>ok</title></html>' })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toMatchObject({ address: PUBLIC, family: 4, hostname: 'example.com' })
    expect(h.calls[0].headers['Accept-Encoding']).toBe('identity')
  })

  // RED-FIRST LIST. Every case is refused before any byte is asked of the target, and the transport
  // (the only thing that could open a connection) is never called for the target.
  describe('refused before any connection to the target', () => {
    it.each([
      ['loopback 127.0.0.1', 'http://127.0.0.1/', 'BLOCKED_ADDRESS'],
      ['IPv6 loopback', 'http://[::1]/', 'BLOCKED_ADDRESS'],
      ['a 10/8 address', 'http://10.1.2.3/', 'BLOCKED_ADDRESS'],
      ['a 192.168/16 address', 'http://192.168.1.49/', 'BLOCKED_ADDRESS'],
      ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/', 'BLOCKED_ADDRESS'],
      ['an IPv4-mapped IPv6 literal of a private address', 'http://[::ffff:10.0.0.1]/', 'BLOCKED_ADDRESS'],
      ['an IPv4-mapped IPv6 literal of loopback', 'http://[::ffff:127.0.0.1]/', 'BLOCKED_ADDRESS'],
      ['a decimal-encoded IPv4 host', 'http://2130706433/', 'BLOCKED_ADDRESS'],
      ['a hex-encoded IPv4 host', 'http://0x7f000001/', 'BLOCKED_ADDRESS'],
      ['a dotted-hex IPv4 host', 'http://0x7f.0.0.1/', 'BLOCKED_ADDRESS'],
      ['an octal IPv4 host', 'http://0177.0.0.1/', 'BLOCKED_ADDRESS'],
      ['a short-form IPv4 host', 'http://127.1/', 'BLOCKED_ADDRESS'],
      ['a non-80/443 port', 'http://example.com:8080/', 'BLOCKED_PORT'],
      ['a URL with credentials', 'http://user:pass@example.com/', 'HAS_CREDENTIALS'],
      ['a non-http scheme', 'ftp://example.com/', 'BLOCKED_SCHEME'],
    ])('%s', async (_, url, code) => {
      // example.com resolves publicly here, so the port and credentials cases cannot pass by a DNS accident
      const h = harness({}, { 'example.com': [v4(PUBLIC)] })
      const error = await refusal(safeFetchPage(url, h.options))
      expect(error.code).toBe(code)
      expect(h.calls).toHaveLength(0)
      expect(h.resolver).not.toHaveBeenCalled()
    })

    it('a hostname that resolves to a private address', async () => {
      const h = harness({}, { 'intranet.example.com': [v4('10.0.0.5')] })
      expect((await refusal(safeFetchPage('http://intranet.example.com/', h.options))).code).toBe('BLOCKED_ADDRESS')
      expect(h.calls).toHaveLength(0)
    })

    it('a hostname whose resolver returns one public and one private address', async () => {
      const h = harness({}, { 'mixed.example.com': [v4(PUBLIC), v4(PRIVATE)] })
      expect((await refusal(safeFetchPage('http://mixed.example.com/', h.options))).code).toBe('BLOCKED_ADDRESS')
      expect(h.calls).toHaveLength(0)
    })

    it('a hostname with a public IPv4 answer and a loopback IPv6 answer', async () => {
      const h = harness({}, { 'mixed6.example.com': [v4(PUBLIC), { address: '::1', family: 6 }] })
      expect((await refusal(safeFetchPage('https://mixed6.example.com/', h.options))).code).toBe('BLOCKED_ADDRESS')
      expect(h.calls).toHaveLength(0)
    })

    it('a public hostname whose redirect points at a private address: the first hop connects, the second never does', async () => {
      const h = harness(
        { 'http://example.com/': { status: 302, headers: { location: `http://${PRIVATE}/admin` } } },
        { 'example.com': [v4(PUBLIC)] }
      )
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('BLOCKED_ADDRESS')
      expect(h.calls).toHaveLength(1)
      expect(h.calls[0].address).toBe(PUBLIC)
      expect(h.calls.some((call) => call.address === PRIVATE || call.url.hostname === PRIVATE)).toBe(false)
    })

    it('a redirect to a hostname that resolves privately, to an odd port, to credentials, or to another scheme', async () => {
      for (const [location, code] of [
        ['http://inside.example.com/', 'BLOCKED_ADDRESS'],
        ['http://example.com:3002/', 'BLOCKED_PORT'],
        ['http://a:b@example.com/', 'HAS_CREDENTIALS'],
        ['file:///etc/hosts', 'BLOCKED_SCHEME'],
        ['http://169.254.169.254/latest/', 'BLOCKED_ADDRESS'],
        ['http://[::ffff:127.0.0.1]/', 'BLOCKED_ADDRESS'],
      ] as const) {
        const h = harness(
          { 'https://example.com/': { status: 301, headers: { Location: location } } },
          { 'example.com': [v4(PUBLIC)], 'inside.example.com': [v4('172.16.4.4')] }
        )
        expect((await refusal(safeFetchPage('https://example.com/', h.options))).code).toBe(code)
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0].address).toBe(PUBLIC)
      }
    })
  })

  describe('pinning (DNS rebinding)', () => {
    it('asks the resolver once per hop and connects to the address that was vetted, even if a second answer would be private', async () => {
      const h = harness({ 'http://rebind.example.com/': { body: '<html></html>' } })
      h.resolver.mockResolvedValueOnce([v4(PUBLIC)]).mockResolvedValue([v4('127.0.0.1')])
      await safeFetchPage('http://rebind.example.com/', h.options)
      expect(h.resolver).toHaveBeenCalledTimes(1)
      expect(h.calls).toHaveLength(1)
      expect(h.calls[0].address).toBe(PUBLIC)
      // the name is still what the Host header and TLS use
      expect(h.calls[0].hostname).toBe('rebind.example.com')
    })

    it('vets every hop again: one resolver call and one vetted address per hop', async () => {
      const h = harness(
        {
          'http://example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
          'https://www.example.com/': { status: 302, headers: { location: '/home' } },
          'https://www.example.com/home': { body: '<html>home</html>' },
        },
        { 'example.com': [v4(PUBLIC)], 'www.example.com': [v4(PUBLIC_2)] }
      )
      const page = await safeFetchPage('http://example.com/', h.options)
      // a relative Location resolves against the current URL
      expect(page.finalUrl).toBe('https://www.example.com/home')
      expect(h.resolver).toHaveBeenCalledTimes(3)
      expect(h.calls.map((call) => call.address)).toEqual([PUBLIC, PUBLIC_2, PUBLIC_2])
    })

    it('a rebind on the second hop is refused: the second answer is vetted, not trusted', async () => {
      const h = harness({ 'http://example.com/': { status: 302, headers: { location: 'http://example.com/next' } } })
      h.resolver.mockResolvedValueOnce([v4(PUBLIC)]).mockResolvedValue([v4('10.0.0.1')])
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('BLOCKED_ADDRESS')
      expect(h.calls).toHaveLength(1)
    })
  })

  describe('redirects', () => {
    it('follows at most five and then fails', async () => {
      const routes: Record<string, Route> = {}
      for (let i = 0; i < 10; i++) routes[`http://example.com/${i}`] = { status: 302, headers: { location: `/${i + 1}` } }
      const h = harness(routes, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/0', h.options))).code).toBe('TOO_MANY_REDIRECTS')
      expect(h.calls).toHaveLength(6)
    })

    it('a redirect with no Location fails', async () => {
      const h = harness({ 'http://example.com/': { status: 302, headers: {} } }, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('BAD_REDIRECT')
    })
  })

  describe('limits', () => {
    it('stops reading and fails when the body passes 2 MB, whatever Content-Length claims', async () => {
      const megabyte = new Uint8Array(1024 * 1024)
      const h = harness(
        { 'http://example.com/': { headers: { ...HTML, 'content-length': '10' }, body: [megabyte, megabyte, megabyte, megabyte, megabyte] } },
        { 'example.com': [v4(PUBLIC)] }
      )
      expect(FETCH_MAX_BYTES).toBe(2 * 1024 * 1024)
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('TOO_LARGE')
      // the third chunk tipped it over; the fourth and fifth were never read
      expect(h.chunksServed()).toBe(3)
    })

    it('accepts a body of exactly the cap', async () => {
      const h = harness({ 'http://example.com/': { body: [new Uint8Array(1000)] } }, { 'example.com': [v4(PUBLIC)] })
      await expect(safeFetchPage('http://example.com/', { ...h.options, maxBytes: 1000 })).resolves.toBeTruthy()
      const over = harness({ 'http://example.com/': { body: [new Uint8Array(1001)] } }, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/', { ...over.options, maxBytes: 1000 }))).code).toBe('TOO_LARGE')
    })

    it.each([['application/json'], ['application/pdf'], ['text/plain'], ['image/png'], ['']])('refuses content type "%s"', async (type) => {
      const h = harness({ 'http://example.com/': { headers: type ? { 'content-type': type } : {}, body: 'x' } }, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('BAD_CONTENT_TYPE')
    })

    it.each([['text/html'], ['TEXT/HTML; charset=UTF-8'], ['application/xhtml+xml']])('accepts content type "%s"', async (type) => {
      const h = harness({ 'http://example.com/': { headers: { 'Content-Type': type }, body: 'x' } }, { 'example.com': [v4(PUBLIC)] })
      await expect(safeFetchPage('http://example.com/', h.options)).resolves.toMatchObject({ html: 'x' })
    })

    it.each([404, 500, 304, 204 + 96])('fails on HTTP %s', async (status) => {
      const h = harness({ 'http://example.com/': { status, body: 'x' } }, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/', h.options))).code).toBe('HTTP_STATUS')
    })

    it('times out after 10 seconds when the server never answers', async () => {
      vi.useFakeTimers()
      expect(FETCH_TIMEOUT_MS).toBe(10_000)
      const h = harness({ 'http://example.com/': { hang: true } }, { 'example.com': [v4(PUBLIC)] })
      const outcome = refusal(safeFetchPage('http://example.com/', h.options))
      await vi.advanceTimersByTimeAsync(9_999)
      let settled = false
      void outcome.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await outcome).code).toBe('TIMEOUT')
      // the request was told to stop
      expect(h.calls[0].signal.aborted).toBe(true)
    })

    it('times out when the body stalls part-way', async () => {
      vi.useFakeTimers()
      const transport: Transport = async () => ({
        status: 200,
        headers: HTML,
        body: (async function* () {
          yield new Uint8Array(10)
          await new Promise(() => {})
        })(),
      })
      const outcome = refusal(safeFetchPage('http://example.com/', { transport, resolver: async () => [v4(PUBLIC)] }))
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await outcome).code).toBe('TIMEOUT')
    })

    it('times out when the resolver never answers', async () => {
      vi.useFakeTimers()
      const h = harness()
      const outcome = refusal(safeFetchPage('http://example.com/', { transport: h.transport, resolver: () => new Promise(() => {}) }))
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await outcome).code).toBe('TIMEOUT')
      expect(h.calls).toHaveLength(0)
    })

    it('fails at once when the whole-audit deadline has already passed, and when it passes mid-request', async () => {
      const spent = new AbortController()
      spent.abort()
      const h = harness({ 'http://example.com/': { hang: true } }, { 'example.com': [v4(PUBLIC)] })
      expect((await refusal(safeFetchPage('http://example.com/', { ...h.options, signal: spent.signal }))).code).toBe('TIMEOUT')
      expect(h.calls).toHaveLength(0)

      const deadline = new AbortController()
      const outcome = refusal(safeFetchPage('http://example.com/', { ...h.options, signal: deadline.signal }))
      await new Promise((resolve) => setImmediate(resolve))
      deadline.abort()
      expect((await outcome).code).toBe('TIMEOUT')
    })
  })

  describe('errors say nothing about where the request was going', () => {
    it('no message, name or string form carries the URL, the hostname or an address', async () => {
      const secretHost = 'secret-host.example.com'
      const failing: Array<Promise<unknown>> = []
      const dns = { [secretHost]: [v4(PUBLIC)], 'inside.example.com': [v4(PRIVATE)] }
      const cases: Array<[string, Record<string, Route>]> = [
        [`http://${PRIVATE}/path-secret`, {}],
        ['http://inside.example.com/path-secret', {}],
        [`http://${secretHost}:8080/path-secret`, {}],
        [`http://u:p@${secretHost}/path-secret`, {}],
        [`ftp://${secretHost}/path-secret`, {}],
        ['http://unknown-secret-host.example.com/path-secret', {}],
        [`http://${secretHost}/path-secret`, { [`http://${secretHost}/path-secret`]: { status: 302, headers: { location: `http://${PRIVATE}/path-secret` } } }],
        [`http://${secretHost}/path-secret`, { [`http://${secretHost}/path-secret`]: { status: 500 } }],
        [`http://${secretHost}/path-secret`, { [`http://${secretHost}/path-secret`]: { headers: { 'content-type': 'text/plain' } } }],
        [`http://${secretHost}/path-secret`, { [`http://${secretHost}/path-secret`]: { body: [new Uint8Array(FETCH_MAX_BYTES + 1)] } }],
        [`http://${secretHost}/path-secret`, { [`http://${secretHost}/path-secret`]: { throws: new Error(`connect ECONNREFUSED ${PUBLIC}:80 (${secretHost}/path-secret)`) } }],
      ]
      const codes: string[] = []
      for (const [url, routes] of cases) {
        const h = harness(routes, dns)
        const attempt = safeFetchPage(url, h.options)
        failing.push(attempt.catch(() => {}))
        const error = await refusal(attempt)
        codes.push(error.code)
        const said = `${error.name} ${error.message} ${String(error)} ${JSON.stringify(error)} ${error.stack?.split('\n')[0]}`
        for (const needle of [secretHost, 'secret', 'inside.example', PRIVATE, PUBLIC, 'path-secret', 'example.com', 'http://', 'ECONNREFUSED']) {
          expect(said, `error for case ${codes.length} leaked "${needle}"`).not.toContain(needle)
        }
        expect(error.message).toBe(`audit fetch refused: ${error.code}`)
        expect((error as { cause?: unknown }).cause).toBeUndefined()
      }
      await Promise.all(failing)
      expect(codes).toEqual([
        'BLOCKED_ADDRESS',
        'BLOCKED_ADDRESS',
        'BLOCKED_PORT',
        'HAS_CREDENTIALS',
        'BLOCKED_SCHEME',
        'DNS_FAILED',
        'BLOCKED_ADDRESS',
        'HTTP_STATUS',
        'BAD_CONTENT_TYPE',
        'TOO_LARGE',
        'NETWORK',
      ])
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The per-call content types (robots.txt, sitemap.xml) and the link check. Both are the same guard: the tests
// below show the default is unchanged and that neither can be used to get around rules 1-3.
// ---------------------------------------------------------------------------------------------------------------

describe('allowedContentTypes: a per-call choice among plain text formats', () => {
  const served = (type: string): Record<string, Route> => ({ 'https://example.com/file': { headers: { 'content-type': type }, body: 'the body' } })
  const dns = { 'example.com': [v4(PUBLIC)] }

  it('the default is unchanged: HTML only', async () => {
    for (const type of ['text/html', 'application/xhtml+xml']) {
      await expect(safeFetchPage('https://example.com/file', harness(served(type), dns).options)).resolves.toMatchObject({ html: 'the body' })
    }
    for (const type of ['text/plain', 'application/xml', 'text/xml', 'application/json', 'application/pdf', 'image/png']) {
      expect((await refusal(safeFetchPage('https://example.com/file', harness(served(type), dns).options))).code).toBe('BAD_CONTENT_TYPE')
    }
    // leaving the option undefined is the default too
    expect((await refusal(safeFetchPage('https://example.com/file', { ...harness(served('text/plain'), dns).options, allowedContentTypes: undefined }))).code).toBe('BAD_CONTENT_TYPE')
  })

  it('the option REPLACES the list for that one call: text/plain for robots.txt, the XML types for a sitemap', async () => {
    expect(PLAIN_TEXT_TYPES).toEqual(['text/plain'])
    expect(XML_TYPES).toEqual(['application/xml', 'text/xml'])
    const plain = { allowedContentTypes: PLAIN_TEXT_TYPES }
    const xml = { allowedContentTypes: XML_TYPES }
    await expect(safeFetchPage('https://example.com/file', { ...harness(served('text/plain; charset=utf-8'), dns).options, ...plain })).resolves.toMatchObject({ html: 'the body' })
    await expect(safeFetchPage('https://example.com/file', { ...harness(served('application/xml'), dns).options, ...xml })).resolves.toMatchObject({ html: 'the body' })
    await expect(safeFetchPage('https://example.com/file', { ...harness(served('TEXT/XML; charset=UTF-8'), dns).options, ...xml })).resolves.toMatchObject({ html: 'the body' })
    // a call that asked for text/plain does not also get HTML, and the next call without the option is HTML-only again
    expect((await refusal(safeFetchPage('https://example.com/file', { ...harness(served('text/html'), dns).options, ...plain }))).code).toBe('BAD_CONTENT_TYPE')
    expect((await refusal(safeFetchPage('https://example.com/file', { ...harness(served('text/plain'), dns).options, ...xml }))).code).toBe('BAD_CONTENT_TYPE')
    expect((await refusal(safeFetchPage('https://example.com/file', harness(served('text/plain'), dns).options))).code).toBe('BAD_CONTENT_TYPE')
  })

  it.each([
    ['a pdf', ['application/pdf']],
    ['an image', ['image/png']],
    ['anything', ['*/*']],
    ['a wildcard subtype', ['text/*']],
    ['json', ['application/json']],
    ['javascript', ['text/javascript']],
    ['a readable type with one that is not', ['text/plain', 'application/octet-stream']],
    ['an empty list', []],
    ['an empty string', ['']],
  ])('the option cannot be widened to %s: refused before anything is resolved or requested', async (_, types) => {
    expect(READABLE_TYPES).toEqual(['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml'])
    const h = harness(served(types[0] || 'text/html'), dns)
    expect((await refusal(safeFetchPage('https://example.com/file', { ...h.options, allowedContentTypes: types }))).code).toBe('BAD_CONTENT_TYPE')
    expect(h.calls).toHaveLength(0)
    expect(h.resolver).not.toHaveBeenCalled()
  })

  describe('with the option set, rules 1-3 are exactly as before', () => {
    const option = { allowedContentTypes: [...PLAIN_TEXT_TYPES, ...XML_TYPES] }
    it.each([
      ['loopback 127.0.0.1', 'http://127.0.0.1/robots.txt', 'BLOCKED_ADDRESS'],
      ['IPv6 loopback', 'http://[::1]/robots.txt', 'BLOCKED_ADDRESS'],
      ['a 10/8 address', 'http://10.1.2.3/sitemap.xml', 'BLOCKED_ADDRESS'],
      ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/', 'BLOCKED_ADDRESS'],
      ['an IPv4-mapped IPv6 literal of a private address', 'http://[::ffff:10.0.0.1]/robots.txt', 'BLOCKED_ADDRESS'],
      ['a decimal-encoded IPv4 host', 'http://2130706433/robots.txt', 'BLOCKED_ADDRESS'],
      ['a non-80/443 port', 'http://example.com:8080/robots.txt', 'BLOCKED_PORT'],
      ['a URL with credentials', 'http://user:pass@example.com/robots.txt', 'HAS_CREDENTIALS'],
      ['a non-http scheme', 'file:///etc/hosts', 'BLOCKED_SCHEME'],
    ])('%s is refused with no connection', async (_, url, code) => {
      const h = harness({}, dns)
      expect((await refusal(safeFetchPage(url, { ...h.options, ...option }))).code).toBe(code)
      expect(h.calls).toHaveLength(0)
      expect(h.resolver).not.toHaveBeenCalled()
    })

    it('a hostname with one private answer, a redirect to a private address, and a rebind are refused as before; the pin holds', async () => {
      const mixed = harness({}, { 'mixed.example.com': [v4(PUBLIC), v4(PRIVATE)] })
      expect((await refusal(safeFetchPage('https://mixed.example.com/robots.txt', { ...mixed.options, ...option }))).code).toBe('BLOCKED_ADDRESS')
      expect(mixed.calls).toHaveLength(0)

      const redirect = harness({ 'https://example.com/robots.txt': { status: 302, headers: { location: `http://${PRIVATE}/secret.txt` } } }, dns)
      expect((await refusal(safeFetchPage('https://example.com/robots.txt', { ...redirect.options, ...option }))).code).toBe('BLOCKED_ADDRESS')
      expect(redirect.calls.map((c) => c.address)).toEqual([PUBLIC])

      const rebind = harness({ 'https://rebind.example.com/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *' } })
      rebind.resolver.mockResolvedValueOnce([v4(PUBLIC)]).mockResolvedValue([v4('127.0.0.1')])
      await safeFetchPage('https://rebind.example.com/robots.txt', { ...rebind.options, ...option })
      expect(rebind.resolver).toHaveBeenCalledTimes(1)
      expect(rebind.calls.map((c) => c.address)).toEqual([PUBLIC])
    })

    it('the size cap and the time limit apply to these files as to a page', async () => {
      vi.useFakeTimers()
      const megabyte = new Uint8Array(1024 * 1024)
      const big = harness({ 'https://example.com/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: [megabyte, megabyte, megabyte] } }, dns)
      expect((await refusal(safeFetchPage('https://example.com/sitemap.xml', { ...big.options, ...option }))).code).toBe('TOO_LARGE')
      const slow = harness({ 'https://example.com/robots.txt': { hang: true } }, dns)
      const outcome = refusal(safeFetchPage('https://example.com/robots.txt', { ...slow.options, ...option }))
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
      expect((await outcome).code).toBe('TIMEOUT')
    })
  })
})

describe('sameSiteOnly: a page read that never follows a redirect off the caller\'s site', () => {
  const dns = { 'example.com': [v4(PUBLIC)], 'www.example.com': [v4(PUBLIC)], 'other.example.org': [v4(PUBLIC_2)], 'inside.example.com': [v4(PRIVATE)] }
  const onSite = (hostname: string) => hostname === 'example.com' || hostname === 'www.example.com'

  it('a redirect to another host ends the read with LEFT_SITE: that host is neither resolved nor connected to', async () => {
    const h = harness(
      {
        'https://example.com/book': { status: 302, headers: { location: 'https://other.example.org/landing' } },
        'https://other.example.org/landing': { body: '<html>OTHER-SITE-TEXT</html>' },
      },
      dns
    )
    const error = await refusal(safeFetchPage('https://example.com/book', { ...h.options, sameSiteOnly: onSite }))
    expect(error.code).toBe('LEFT_SITE')
    expect(h.calls.map((c) => c.url.href)).toEqual(['https://example.com/book'])
    expect(h.calls.some((c) => c.hostname === 'other.example.org' || c.address === PUBLIC_2)).toBe(false)
    expect(h.resolver.mock.calls.map(([host]) => host)).toEqual(['example.com'])
    // and it says nothing about either host
    expect(`${error.message} ${String(error)}`).not.toMatch(/example/)
  })

  it('is asked on EVERY hop: a hop that stays on the site is followed, the first one that leaves is not', async () => {
    const h = harness(
      {
        'https://example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
        'https://www.example.com/': { status: 302, headers: { location: 'http://other.example.org/' } },
      },
      dns
    )
    const asked: string[] = []
    const predicate = (hostname: string) => (asked.push(hostname), onSite(hostname))
    expect((await refusal(safeFetchPage('https://example.com/', { ...h.options, sameSiteOnly: predicate }))).code).toBe('LEFT_SITE')
    expect(asked).toEqual(['www.example.com', 'other.example.org'])
    expect(h.calls.map((c) => c.url.href)).toEqual(['https://example.com/', 'https://www.example.com/'])
    expect(h.resolver.mock.calls.map(([host]) => host)).toEqual(['example.com', 'www.example.com'])
  })

  it('a redirect the predicate allows is followed and vetted as before; the other rules still refuse what they refused', async () => {
    const ok = harness(
      { 'https://example.com/': { status: 301, headers: { location: 'https://www.example.com/home' } }, 'https://www.example.com/home': { body: '<html>home</html>' } },
      dns
    )
    expect((await safeFetchPage('https://example.com/', { ...ok.options, sameSiteOnly: onSite })).finalUrl).toBe('https://www.example.com/home')
    expect(ok.resolver).toHaveBeenCalledTimes(2)
    // a host the predicate allows but that resolves privately: still BLOCKED_ADDRESS, never connected
    const inside = harness({ 'https://example.com/': { status: 302, headers: { location: 'https://inside.example.com/' } } }, dns)
    const allowInside = (hostname: string) => onSite(hostname) || hostname === 'inside.example.com'
    expect((await refusal(safeFetchPage('https://example.com/', { ...inside.options, sameSiteOnly: allowInside }))).code).toBe('BLOCKED_ADDRESS')
    expect(inside.calls).toHaveLength(1)
    // rule 1 on the new URL runs first: an odd port is BLOCKED_PORT whatever the predicate would say
    const port = harness({ 'https://example.com/': { status: 302, headers: { location: 'https://www.example.com:8443/' } } }, dns)
    expect((await refusal(safeFetchPage('https://example.com/', { ...port.options, sameSiteOnly: onSite }))).code).toBe('BLOCKED_PORT')
  })

  it('without the option the guard is unchanged: a redirect to another public host is followed', async () => {
    const h = harness(
      {
        'https://example.com/book': { status: 302, headers: { location: 'https://other.example.org/landing' } },
        'https://other.example.org/landing': { body: '<html>landed</html>' },
      },
      dns
    )
    const page = await safeFetchPage('https://example.com/book', h.options)
    expect(page.finalUrl).toBe('https://other.example.org/landing')
    expect(h.calls.map((c) => `${c.url.href} ${c.address}`)).toEqual([`https://example.com/book ${PUBLIC}`, `https://other.example.org/landing ${PUBLIC_2}`])
  })
})

describe('safeCheckLink: one link on the site\'s own host, status only', () => {
  const HOST = 'example.com'
  const dns = { 'example.com': [v4(PUBLIC)], 'other.example.org': [v4(PUBLIC_2)], 'inside.example.com': [v4(PRIVATE)] }

  it.each([200, 204])('reports a %i as it is, with HEAD alone, without reading any body', async (status) => {
    const h = harness({ 'https://example.com/a': { status, body: 'BODY' } }, dns)
    await expect(safeCheckLink('https://example.com/a', HOST, h.options)).resolves.toEqual({ status, leftHost: false })
    expect(h.calls.map((c) => c.method)).toEqual(['HEAD'])
    expect(h.calls[0].address).toBe(PUBLIC)
    expect(h.chunksServed()).toBe(0)
  })

  // [P3-15] some servers refuse or mishandle HEAD: an error answer to HEAD is asked again with GET, and the link
  // counts as broken only when GET says so too
  it.each([403, 404, 410, 500, 503])('an error %i to HEAD is asked again with GET; GET\'s answer is the one reported, and no body is read', async (status) => {
    const h = harness({ 'https://example.com/a': { status, body: 'BODY' } }, dns)
    await expect(safeCheckLink('https://example.com/a', HOST, h.options)).resolves.toEqual({ status, leftHost: false })
    expect(h.calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
    expect(h.chunksServed()).toBe(0)
    const headOnly = harness({ 'https://example.com/a': { head: status, status: 200, body: 'BODY' } }, dns)
    await expect(safeCheckLink('https://example.com/a', HOST, headOnly.options)).resolves.toEqual({ status: 200, leftHost: false })
    expect(headOnly.chunksServed()).toBe(0)
  })

  it.each([405, 501])('a server that refuses HEAD with %i is asked once more with GET, and still no body is read', async (head) => {
    const h = harness({ 'https://example.com/a': { head, status: 404, headers: { 'content-type': 'application/pdf' }, body: [new Uint8Array(10), new Uint8Array(10)] } }, dns)
    await expect(safeCheckLink('https://example.com/a', HOST, h.options)).resolves.toEqual({ status: 404, leftHost: false })
    expect(h.calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
    // each of the two requests resolved the name and was vetted on its own
    expect(h.resolver).toHaveBeenCalledTimes(2)
    expect(h.chunksServed()).toBe(0)
  })

  it('any content type is fine: nothing is read, so there is nothing to refuse', async () => {
    const h = harness({ 'https://example.com/a.pdf': { headers: { 'content-type': 'application/pdf' }, body: 'PDF' } }, dns)
    await expect(safeCheckLink('https://example.com/a.pdf', HOST, h.options)).resolves.toEqual({ status: 200, leftHost: false })
    expect(h.chunksServed()).toBe(0)
  })

  it('a redirect that stays on the host is followed, and each hop is vetted again', async () => {
    const h = harness({ 'https://example.com/old': { status: 301, headers: { location: '/new' } }, 'https://example.com/new': { status: 404 } }, dns)
    await expect(safeCheckLink('https://example.com/old', HOST, h.options)).resolves.toEqual({ status: 404, leftHost: false })
    // (the 404 to HEAD is asked again with GET, which follows the same redirect, vetted again)
    expect(h.calls.map((c) => `${c.method} ${c.url.pathname} ${c.address}`)).toEqual([`HEAD /old ${PUBLIC}`, `HEAD /new ${PUBLIC}`, `GET /old ${PUBLIC}`, `GET /new ${PUBLIC}`])
    expect(h.resolver).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['another site', 'https://other.example.org/landing'],
    ['a subdomain', 'https://www.example.com/landing'],
    ['a private address', `http://${PRIVATE}/admin`],
    ['the metadata address', 'http://169.254.169.254/latest/'],
  ])('a redirect to %s is reported and NOT followed: that host is never asked', async (_, location) => {
    const h = harness({ 'https://example.com/out': { status: 302, headers: { location } } }, { ...dns, 'www.example.com': [v4(PUBLIC_2)] })
    await expect(safeCheckLink('https://example.com/out', HOST, h.options)).resolves.toEqual({ status: 302, leftHost: true })
    expect(h.calls.map((c) => c.url.href)).toEqual(['https://example.com/out'])
    expect(h.resolver).toHaveBeenCalledTimes(1)
  })

  it('a redirect to the same host on the other scheme is still the same host: followed, and vetted again', async () => {
    const h = harness({ 'https://example.com/out': { status: 302, headers: { location: 'http://example.com/plain' } }, 'http://example.com/plain': { status: 200 } }, dns)
    await expect(safeCheckLink('https://example.com/out', HOST, h.options)).resolves.toEqual({ status: 200, leftHost: false })
    expect(h.calls.map((c) => c.url.href)).toEqual(['https://example.com/out', 'http://example.com/plain'])
    expect(h.resolver).toHaveBeenCalledTimes(2)
  })

  it('a redirect to a URL that breaks rule 1 is refused, even though it would not have been followed', async () => {
    for (const [location, code] of [['https://other.example.org:8443/x', 'BLOCKED_PORT'], ['https://u:p@other.example.org/x', 'HAS_CREDENTIALS'], ['ftp://other.example.org/x', 'BLOCKED_SCHEME']] as const) {
      const h = harness({ 'https://example.com/out': { status: 302, headers: { location } } }, dns)
      expect((await refusal(safeCheckLink('https://example.com/out', HOST, h.options))).code).toBe(code)
      expect(h.calls).toHaveLength(1)
    }
  })

  it.each([
    ['a link on another host', 'https://other.example.org/x', 'BLOCKED_ADDRESS'],
    ['a link on a subdomain', 'https://www.example.com/x', 'BLOCKED_ADDRESS'],
    ['an odd port', 'https://example.com:8443/x', 'BLOCKED_PORT'],
    ['credentials', 'https://u:p@example.com/x', 'HAS_CREDENTIALS'],
    ['another scheme', 'ftp://example.com/x', 'BLOCKED_SCHEME'],
  ])('%s is never requested at all', async (_, url, code) => {
    const h = harness({}, { ...dns, 'www.example.com': [v4(PUBLIC_2)] })
    expect((await refusal(safeCheckLink(url, HOST, h.options))).code).toBe(code)
    expect(h.calls).toHaveLength(0)
    expect(h.resolver).not.toHaveBeenCalled()
  })

  it('rules 2 and 3 hold for a link check: a host that resolves privately, a mixed answer and a rebind on the second request are refused', async () => {
    const inside = harness({}, dns)
    expect((await refusal(safeCheckLink('https://inside.example.com/x', 'inside.example.com', inside.options))).code).toBe('BLOCKED_ADDRESS')
    expect(inside.calls).toHaveLength(0)

    const mixed = harness({}, { 'example.com': [v4(PUBLIC), v4('10.0.0.9')] })
    expect((await refusal(safeCheckLink('https://example.com/x', HOST, mixed.options))).code).toBe('BLOCKED_ADDRESS')
    expect(mixed.calls).toHaveLength(0)

    // HEAD is answered 405 from the public address; the name then resolves privately for the GET: refused
    const rebind = harness({ 'https://example.com/x': { head: 405, status: 200 } })
    rebind.resolver.mockResolvedValueOnce([v4(PUBLIC)]).mockResolvedValue([v4('127.0.0.1')])
    expect((await refusal(safeCheckLink('https://example.com/x', HOST, rebind.options))).code).toBe('BLOCKED_ADDRESS')
    expect(rebind.calls.map((c) => `${c.method} ${c.address}`)).toEqual([`HEAD ${PUBLIC}`])
  })

  it('times out like any request, and says nothing about the host when it fails', async () => {
    vi.useFakeTimers()
    const h = harness({ 'https://example.com/slow': { hang: true } }, dns)
    const outcome = refusal(safeCheckLink('https://example.com/slow', HOST, h.options))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    const error = await outcome
    expect(error.code).toBe('TIMEOUT')
    expect(`${error.message} ${String(error)}`).not.toMatch(/example|93\.184/)
  })
})


describe('[RULE 3, RULE 9] what an answer says, what is asked for, and how many requests', () => {
  const dns = { 'example.com': [v4(PUBLIC)], 'www.example.com': [v4(PUBLIC)] }

  it('an HTTP_STATUS refusal carries the status, and whether it answered on another host than the one asked; never the host', async () => {
    const h = harness({ 'https://example.com/sitemap.xml': { status: 403 } }, dns)
    const error = await refusal(safeFetchPage('https://example.com/sitemap.xml', { ...h.options, allowedContentTypes: XML_TYPES }))
    expect(error).toMatchObject({ code: 'HTTP_STATUS', status: 403, hostChanged: false })
    expect(JSON.stringify(error)).not.toMatch(/example/)
    const moved = harness({ 'https://example.com/s.xml': { status: 301, headers: { location: 'https://www.example.com/s.xml' } }, 'https://www.example.com/s.xml': { status: 404 } }, dns)
    expect(await refusal(safeFetchPage('https://example.com/s.xml', { ...moved.options, allowedContentTypes: XML_TYPES }))).toMatchObject({ status: 404, hostChanged: true })
  })

  it('a read asks for exactly the types it accepts: a sitemap read does not ask for HTML', async () => {
    const h = harness({ 'https://example.com/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: '<urlset/>' }, 'https://example.com/': { body: '<html></html>' } }, dns)
    await safeFetchPage('https://example.com/sitemap.xml', { ...h.options, allowedContentTypes: XML_TYPES })
    await safeFetchPage('https://example.com/', h.options)
    expect(h.calls.map((c) => c.headers.Accept)).toEqual(['application/xml,text/xml', 'text/html,application/xhtml+xml'])
  })

  it('a shared request budget: each hop takes one before it is resolved; at zero nothing is resolved or connected', async () => {
    const h = harness({ 'https://example.com/a': { status: 302, headers: { location: '/b' } }, 'https://example.com/b': { body: '<html></html>' } }, dns)
    const budget = { remaining: 3 }
    await safeFetchPage('https://example.com/a', { ...h.options, requestBudget: budget })
    expect(budget.remaining).toBe(1)
    expect((await refusal(safeFetchPage('https://example.com/a', { ...h.options, requestBudget: budget }))).code).toBe('OVER_BUDGET')
    // the first hop of the second request took the last one; its redirect hop was refused before any lookup
    expect(h.resolver).toHaveBeenCalledTimes(3)
    expect(h.calls).toHaveLength(3)
    expect(budget.remaining).toBe(0)
    expect((await refusal(safeCheckLink('https://example.com/a', 'example.com', { ...h.options, requestBudget: budget }))).code).toBe('OVER_BUDGET')
    expect(h.calls).toHaveLength(3)
  })
})
