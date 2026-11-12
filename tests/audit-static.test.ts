import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The guard only protects requests that go through it. This test fails if anything in the audit code
// could make a request another way.
const root = fileURLToPath(new URL('..', import.meta.url))
const GUARDED_DIRS = ['src/lib/audit', 'src/app/api/audit']
const THE_GUARD = 'src/lib/audit/safe-fetch.ts'
// The ONE exception: Google's PageSpeed test is a fixed, trusted host, not the audited site, so it does not go
// through the guard. It is allowed in this file only, through one reference to the platform's fetch, to one
// fixed endpoint (checked below).
const PAGESPEED = 'src/lib/audit/pagespeed.ts'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [path] : []
  })
}

// a call to the global: `fetch(`, not `safeFetchPage(`, `.fetch(` or `prefetch(`
const BARE_FETCH = /(?<![A-Za-z0-9_$.])fetch\s*\(/
const GLOBAL_FETCH = /\b(?:globalThis|window|self|global)\s*(?:\.\s*fetch|\[\s*['"]fetch['"]\s*\])/
const OTHER_CLIENTS = /(?:from\s+|require\(\s*|import\(\s*)['"](?:node:)?(?:https?|http2|net|tls|dgram|undici|axios|got|node-fetch|cross-fetch|superagent|needle)['"]/
// (cheerio can fetch a page by itself with fromURL: that would be a request around the guard too)
const XHR = /\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bfromURL\b/

const files = GUARDED_DIRS.flatMap((dir) => sourceFiles(join(root, dir))).map((path) => ({
  name: relative(root, path).split('\\').join('/'),
  text: readFileSync(path, 'utf8'),
}))

describe('nothing in the audit code reaches the network around the guard', () => {
  it('the patterns do catch what they are meant to catch, and leave the guard\'s own name alone', () => {
    for (const bad of ['await fetch(url)', 'const r = fetch (url)', '(fetch(u))', 'x = [fetch(u)]', '\nfetch(\n  url)']) expect(bad).toMatch(BARE_FETCH)
    for (const fine of ['safeFetchPage(url)', 'client.fetch(url)', 'prefetch(url)', 'fetchWebsiteContent(url)', '// we never fetch a page here', 'fetchPageRaw']) expect(fine).not.toMatch(BARE_FETCH)
    for (const bad of ['globalThis.fetch(u)', "globalThis['fetch'](u)", 'window.fetch']) expect(bad).toMatch(GLOBAL_FETCH)
    for (const bad of ["import * as http from 'node:http'", "import https from 'https'", "require('undici')", "import axios from 'axios'", "await import('node:net')"]) expect(bad).toMatch(OTHER_CLIENTS)
  })

  it('there are audit source files to scan, and the guard is one of them', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files.map((f) => f.name)).toContain(THE_GUARD)
    expect(files.map((f) => f.name)).toContain('src/app/api/audit/generate/route.ts')
  })

  it.each(files.map((f) => [f.name, f.text]))('%s has no bare fetch( call', (name, text) => {
    expect(text).not.toMatch(BARE_FETCH)
    if (name !== PAGESPEED) expect(text).not.toMatch(GLOBAL_FETCH)
    expect(text).not.toMatch(XHR)
  })

  it('the PageSpeed exception is exactly one request, to Google\'s fixed endpoint, with redirects refused', () => {
    const text = files.find((f) => f.name === PAGESPEED)!.text
    const globals = text.match(new RegExp(GLOBAL_FETCH.source, 'g')) ?? []
    expect(globals).toEqual(['globalThis.fetch'])
    expect(text).toContain('(options.fetch ?? globalThis.fetch)(pageSpeedRequestUrl(address), {')
    expect(text).toContain("export const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';")
    expect(text).toContain('return `${PAGESPEED_ENDPOINT}?${params.toString()}`;')
    expect(text).toContain("redirect: 'error'")
  })

  it.each(files.filter((f) => f.name !== THE_GUARD).map((f) => [f.name, f.text]))('%s imports no HTTP or socket client of its own', (_, text) => {
    expect(text).not.toMatch(OTHER_CLIENTS)
  })

  it('the old unguarded helper is gone, and the fetcher requests pages only through the guard', () => {
    for (const f of files) expect(f.text, f.name).not.toContain('fetchPageRaw')
    const fetcher = files.find((f) => f.name === 'src/lib/audit/fetch-website.ts')!.text
    expect(fetcher).toContain("from './safe-fetch'")
    expect(fetcher).toContain('safeFetchPage(')
  })

  // The real transport takes options (a port, a CA) so that ONE test can drive it against a local server.
  // Production must never pass them: with a port or a CA of its own choosing the guard's promises are gone.
  describe('createNodeTransport is called with no arguments anywhere under src/', () => {
    const WITH_ARGUMENTS = /(?<!function )createNodeTransport\s*\(\s*[^)\s]/
    const allSrc = sourceFiles(join(root, 'src')).map((path) => ({ name: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))

    it('the pattern catches a call with arguments and passes the definition and the bare call', () => {
      for (const bad of ['createNodeTransport({ port: 8443 })', 'createNodeTransport( options )', 'createNodeTransport(\n  { ca }\n)', 'x = createNodeTransport(undefined)']) expect(bad).toMatch(WITH_ARGUMENTS)
      for (const fine of ['createNodeTransport()', 'createNodeTransport( )', 'export function createNodeTransport(options?: NodeTransportOptions): Transport {']) expect(fine).not.toMatch(WITH_ARGUMENTS)
    })

    it('no file under src/ passes it anything, and it is called exactly once, by the guard', () => {
      expect(allSrc.length).toBeGreaterThan(20)
      for (const f of allSrc) expect(f.text, f.name).not.toMatch(WITH_ARGUMENTS)
      const callers = allSrc.filter((f) => /(?<!function )createNodeTransport\s*\(/.test(f.text)).map((f) => f.name)
      expect(callers).toEqual([THE_GUARD])
      const guard = allSrc.find((f) => f.name === THE_GUARD)!.text
      expect(guard.match(/(?<!function )createNodeTransport\s*\(/g)).toHaveLength(1)
      expect(guard).toContain('const defaultTransport: Transport = createNodeTransport();')
      // and nothing re-exports it for other code to pick up
      expect(allSrc.find((f) => f.name === 'src/lib/audit/index.ts')!.text).not.toContain('createNodeTransport')
    })
  })

  it('the guard itself uses node:http and node:https with a pinned lookup, and no global request function', () => {
    const guard = files.find((f) => f.name === THE_GUARD)!.text
    expect(guard).toContain("from 'node:http'")
    expect(guard).toContain("from 'node:https'")
    expect(guard).toMatch(/lookup:\s*pinnedLookup/)
    expect(guard).toMatch(/agent:\s*false/)
    expect(guard).not.toMatch(BARE_FETCH)
  })
})
