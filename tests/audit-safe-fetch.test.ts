import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_URL_LENGTH,
  UnsafeUrlError,
  checkUrl,
  isPublicAddress,
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

type Route = Partial<Omit<TransportResponse, 'body'>> & { body?: string | Uint8Array[]; hang?: boolean; throws?: Error }

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
      status: route.status ?? 200,
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
