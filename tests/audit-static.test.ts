import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The guard only protects requests that go through it. This test fails if anything in the audit code
// could make a request another way.
const root = fileURLToPath(new URL('..', import.meta.url))
const GUARDED_DIRS = ['src/lib/audit', 'src/app/api/audit']
const THE_GUARD = 'src/lib/audit/safe-fetch.ts'

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
const XHR = /\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/

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

  it.each(files.map((f) => [f.name, f.text]))('%s has no bare fetch( call', (_, text) => {
    expect(text).not.toMatch(BARE_FETCH)
    expect(text).not.toMatch(GLOBAL_FETCH)
    expect(text).not.toMatch(XHR)
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

  it('the guard itself uses node:http and node:https with a pinned lookup, and no global request function', () => {
    const guard = files.find((f) => f.name === THE_GUARD)!.text
    expect(guard).toContain("from 'node:http'")
    expect(guard).toContain("from 'node:https'")
    expect(guard).toMatch(/lookup:\s*pinnedLookup/)
    expect(guard).toMatch(/agent:\s*false/)
    expect(guard).not.toMatch(BARE_FETCH)
  })
})
