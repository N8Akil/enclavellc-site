import { execFileSync } from 'node:child_process'
import dns from 'node:dns'
import { getEventListeners } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createNodeTransport, raceAbort, safeFetchPage, type Transport, type TransportRequest } from '@/lib/audit/safe-fetch'

// The REAL node transport, driven against a TLS server on this machine's loopback. Nothing leaves the machine and
// no name is looked up: the hostname below is in a reserved TLD (RFC 2606) and the test never asks DNS for it.
//
// The transport is handed 127.0.0.1 as the "vetted" address ON PURPOSE. The guard's refusal of loopback and every
// other non-public address is tested in audit-safe-fetch.test.ts; this file tests what happens after vetting:
// the connection goes to the pinned address, under the hostname's name, with certificate checks intact.
const NAME = 'audit-test.example'
const OTHER_NAME = 'other-name.example'
const BODY = '<html><head><title>pinned</title></head><body>served over the pinned connection</body></html>'

let dir = ''
let cert = Buffer.alloc(0)
let server: https.Server
let port = 0
const seen: Array<{ sni: string | false | undefined; host: string | undefined; path: string | undefined }> = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'audit-transport-test-'))
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  try {
    // a throwaway self-signed certificate for the test name; it lives in a temp directory and is deleted afterwards
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', `/CN=${NAME}`, '-addext', `subjectAltName=DNS:${NAME}`],
      { stdio: 'pipe' }
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new Error(
      code === 'ENOENT'
        ? 'tests/audit-transport.test.ts needs the `openssl` command-line tool on PATH to make a throwaway certificate. It is not installed. This test does not skip: install openssl.'
        : `tests/audit-transport.test.ts could not make a throwaway certificate with openssl (${code ?? 'exit ' + (error as { status?: number }).status}).`
    )
  }
  cert = readFileSync(certPath)
  server = https.createServer({ key: readFileSync(keyPath), cert }, (req, res) => {
    seen.push({ sni: (req.socket as unknown as { servername?: string | false }).servername, host: req.headers.host, path: req.url })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(BODY)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// installed for EVERY test in this file, so no test here can reach DNS whatever the code under test does
let lookup: MockInstance
beforeEach(() => {
  lookup = spyOnSystemResolver()
})

afterEach(() => {
  seen.length = 0
  vi.restoreAllMocks()
})

// The system resolver is what node would use if the pin were not in place. The stand-in answers "not found"
// at once, so even a broken pin cannot make this test send a DNS query.
function spyOnSystemResolver() {
  return vi.spyOn(dns, 'lookup').mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: Error) => void
    callback(Object.assign(new Error('getaddrinfo ENOTFOUND (test stand-in)'), { code: 'ENOTFOUND' }))
  }) as unknown as typeof dns.lookup)
}

function request(hostname: string, path = '/page?x=1'): TransportRequest {
  return {
    url: new URL(`https://${hostname}${path}`),
    hostname,
    address: '127.0.0.1',
    family: 4,
    headers: { 'User-Agent': 'audit-transport-test', Accept: 'text/html', 'Accept-Encoding': 'identity' },
    signal: new AbortController().signal,
  }
}

async function bodyOf(response: Awaited<ReturnType<Transport>>): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of response.body) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

describe('the real node transport, on a pinned address', () => {
  it('connects to the pinned address under the hostname: 200, the body, SNI and Host carry the hostname, and DNS is never asked', async () => {
    const transport = createNodeTransport({ port, ca: cert })
    const response = await transport(request(NAME))

    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toBe(BODY)
    // (node adds the port to Host only because the test port is not 443; the name part is what matters)
    expect(seen).toEqual([{ sni: NAME, host: `${NAME}:${port}`, path: '/page?x=1' }])
    // the name is in a reserved TLD and cannot resolve, and nothing asked: only the pinned address can have been used
    expect(lookup).not.toHaveBeenCalled()
  })

  it('the whole guard works over the real transport: a page is fetched through safeFetchPage', async () => {
    const transport = createNodeTransport({ port, ca: cert })
    // the resolver is a stand-in that returns a public address; the transport stand-in below swaps in loopback,
    // because the guard itself would (rightly) never hand loopback to a transport
    const page = await safeFetchPage(`https://${NAME}/home`, {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: (req) => transport({ ...req, address: '127.0.0.1', family: 4 }),
    })
    expect(page).toEqual({ finalUrl: `https://${NAME}/home`, html: BODY })
    expect(seen).toEqual([{ sni: NAME, host: `${NAME}:${port}`, path: '/home' }])
    expect(lookup).not.toHaveBeenCalled()
  })

  // The two below are the known-positives that pinning does not weaken certificate checks.
  it('REJECTS a different hostname pinned to the same address: the certificate does not name it', async () => {
    const transport = createNodeTransport({ port, ca: cert })
    await expect(transport(request(OTHER_NAME))).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
    expect(seen).toEqual([])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('REJECTS the right hostname when the certificate is not from a trusted authority (no ca option, as in production)', async () => {
    const transport = createNodeTransport({ port })
    const error = await transport(request(NAME)).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']).toContain(error.code)
    expect(seen).toEqual([])
  })

  it('through the guard, both certificate failures surface as the typed NETWORK refusal with nothing about the host', async () => {
    const cases: Array<[string, Transport]> = [
      [NAME, createNodeTransport({ port })],
      [OTHER_NAME, createNodeTransport({ port, ca: cert })],
    ]
    for (const [hostname, transport] of cases) {
      const error = await safeFetchPage(`https://${hostname}/`, {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        transport: (req) => transport({ ...req, address: '127.0.0.1', family: 4 }),
      }).catch((e) => e)
      expect(error).toMatchObject({ name: 'UnsafeUrlError', code: 'NETWORK', message: 'audit fetch refused: NETWORK' })
    }
    expect(seen).toEqual([])
  })

  it('an aborted signal stops the real request', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = createNodeTransport({ port, ca: cert })
    await expect(transport({ ...request(NAME), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual([])
  })
})

describe('raceAbort leaves no listener behind', () => {
  it('removes its abort listener when the work resolves, and when it rejects', async () => {
    const { signal } = new AbortController()
    for (let i = 0; i < 200; i++) await raceAbort(Promise.resolve(i), signal)
    for (let i = 0; i < 200; i++) await raceAbort(Promise.reject(new Error('x')), signal).catch(() => {})
    expect(getEventListeners(signal, 'abort')).toHaveLength(0)
  })

  it('still rejects with TIMEOUT when the signal aborts first, or was already aborted', async () => {
    const controller = new AbortController()
    const pending = raceAbort(new Promise(() => {}), controller.signal)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(raceAbort(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('a body of many chunks does not pile listeners onto the request signal', async () => {
    let requestSignal: AbortSignal | undefined
    let peak = 0
    const transport: Transport = async (req) => {
      requestSignal = req.signal
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: (async function* () {
          for (let i = 0; i < 500; i++) {
            peak = Math.max(peak, getEventListeners(req.signal, 'abort').length)
            yield new Uint8Array(10)
          }
        })(),
      }
    }
    const page = await safeFetchPage('https://example.com/', { transport, resolver: async () => [{ address: '93.184.216.34', family: 4 }] })
    expect(page.html).toHaveLength(5000)
    expect(requestSignal).toBeDefined()
    // one listener for the chunk being awaited, never one per chunk already read
    expect(peak).toBeLessThanOrEqual(1)
  })
})
