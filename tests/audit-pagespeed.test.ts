import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, loggedText, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { extractPage } from '@/lib/audit/fetch-website'
import { PAGESPEED_CATEGORIES, PAGESPEED_ENDPOINT, pageSpeedMeasurements, runPageSpeed } from '@/lib/audit/pagespeed'
import { runAuditJob, type AuditJob, type PipelineDeps } from '@/lib/audit/pipeline'
import { TOOL_NAME, runAudit } from '@/lib/audit/run-audit'
import type { AssessedArea, AuditResults, Measurements } from '@/lib/audit/types'

// THE FIXTURE. tests/fixtures/psi-enclavellc-mobile.json is trimmed from a real PageSpeed Insights v5 response
// (mobile, enclavellc.net, recorded 2026-11-11 by the founder): only the fields our code reads are kept, and the
// phone screenshot's data is replaced by a tiny valid 8x8 JPEG made for the fixture. No key is in it.
const FIXTURE_TEXT = readFileSync(new URL('./fixtures/psi-enclavellc-mobile.json', import.meta.url), 'utf8')
const FIXTURE = JSON.parse(FIXTURE_TEXT)
const AUDITS = FIXTURE.lighthouseResult.audits
const CATEGORIES = FIXTURE.lighthouseResult.categories

// a sentinel: if it shows up anywhere it should not, the test can see it
const KEY = 'SENTINEL-KEY-do-not-print-7f3a9c'
const TARGET = 'https://enclavellc.net'

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}
function fakeFetch(make: () => Response | Promise<Response> = () => response(FIXTURE_TEXT)) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => make())
}
// a fetch that never answers until it is aborted, then rejects the way fetch does
const hangingFetch = () =>
  vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
      })
  )
const withAudits = (change: (lr: Record<string, unknown>) => void) => {
  const copy = JSON.parse(FIXTURE_TEXT)
  change(copy.lighthouseResult)
  return JSON.stringify(copy)
}

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  // no test here reaches a real key, and none reaches Google
  vi.stubEnv('GOOGLE_PAGESPEED_API_KEY', undefined)
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('a test reached the real fetch'))))
  logs = spyLogs()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runPageSpeed: the real response becomes a short, fixed set of measures written by our code', () => {
  it('the fixture gives the expected ids, and every printed number comes from the response', async () => {
    const result = await runPageSpeed(TARGET, { apiKey: KEY, fetch: fakeFetch() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { measures, screenshot } = result.measurements as Extract<Measurements, { ok: true }>

    expect(Object.keys(measures)).toEqual([
      'performance_score',
      'largest_contentful_paint',
      'first_contentful_paint',
      'speed_index',
      'total_blocking_time',
      'layout_shift',
      'page_weight',
      'accessibility_score',
      'best_practices_score',
      'seo_score',
    ])

    // the numbers, worked out here from the fixture's raw values
    const seconds = (id: string) => (AUDITS[id].numericValue / 1000).toFixed(1)
    const expected: Record<string, string> = {
      performance_score: `Google's performance score for a phone: ${Math.round(CATEGORIES.performance.score * 100)} of 100`,
      largest_contentful_paint: `the main content appeared after ${seconds('largest-contentful-paint')} seconds on a phone (Google's test)`,
      first_contentful_paint: `the first text or image appeared after ${seconds('first-contentful-paint')} seconds on a phone (Google's test)`,
      speed_index: `most of the screen had filled in after ${seconds('speed-index')} seconds on a phone (Google's speed index)`,
      total_blocking_time: `the page was too busy to answer a tap for ${Math.round(AUDITS['total-blocking-time'].numericValue)} milliseconds in all (Google's test)`,
      layout_shift: `layout shift score ${AUDITS['cumulative-layout-shift'].numericValue.toFixed(2)}: how much the page jumps while it loads (Google's test; 0 is best)`,
      page_weight: `the page weighs ${Math.round(AUDITS['total-byte-weight'].numericValue / 1024)} KB in all (Google's test)`,
      accessibility_score: `Google's accessibility score: ${Math.round(CATEGORIES.accessibility.score * 100)} of 100`,
      best_practices_score: `Google's best-practices score: ${Math.round(CATEGORIES['best-practices'].score * 100)} of 100`,
      seo_score: `Google's search (SEO) score: ${Math.round(CATEGORIES.seo.score * 100)} of 100`,
    }
    for (const [id, display] of Object.entries(expected)) expect(measures[id].display, id).toBe(display)

    // and as plain words, so a change in rounding shows up here too
    expect(measures.performance_score).toEqual({ value: 95, unit: 'of 100', display: "Google's performance score for a phone: 95 of 100" })
    expect(measures.largest_contentful_paint).toMatchObject({ value: 1.2, unit: 's' })
    expect(measures.speed_index).toMatchObject({ value: 5.5, unit: 's' })
    expect(measures.total_blocking_time).toMatchObject({ value: 36, unit: 'ms' })
    expect(measures.layout_shift).toMatchObject({ value: 0, unit: 'score' })
    expect(measures.page_weight).toMatchObject({ value: 982, unit: 'KB', display: "the page weighs 982 KB in all (Google's test)" })

    // every number printed is the measure's own value (or the fixed "100" of a score, or the fixed "0 is best")
    for (const [id, m] of Object.entries(measures)) {
      const numbers = m.display.match(/\d+(?:\.\d+)?/g) ?? []
      const allowed = new Set([String(m.value), m.value.toFixed(1), m.value.toFixed(2), '100', '0'])
      for (const n of numbers) expect(allowed.has(n), `${id}: ${n}`).toBe(true)
      expect(m.display).not.toContain(' ')
      expect(m.display.length).toBeLessThanOrEqual(120)
    }

    // the phone screenshot, decoded from the data URI and checked to be the type it says
    const dataUri: string = AUDITS['final-screenshot'].details.data
    expect(screenshot).toEqual({ mediaType: 'image/jpeg', dataBase64: dataUri.slice('data:image/jpeg;base64,'.length) })
    expect([...Buffer.from(screenshot!.dataBase64, 'base64').subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  })

  it('a screenshot that is not what it says, too big, or not base64 is left out; the measures stay', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    for (const data of [
      `data:image/jpeg;base64,${png}`,
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      'data:image/jpeg;base64,not base64!',
      `data:image/jpeg;base64,${'A'.repeat(2_000_004)}`,
      'https://example.test/shot.jpg',
    ]) {
      const body = withAudits((lr) => void ((lr.audits as Record<string, { details: { data: string } }>)['final-screenshot'].details.data = data))
      const result = await runPageSpeed(TARGET, { apiKey: KEY, fetch: fakeFetch(() => response(body)) })
      expect(result.ok).toBe(true)
      if (result.ok && result.measurements.ok) {
        expect(result.measurements.screenshot).toBeUndefined()
        expect(Object.keys(result.measurements.measures)).toHaveLength(10)
      }
    }
  })

  it('a measure whose value is missing or not a number is left out, the rest stay', async () => {
    const body = withAudits((lr) => {
      const audits = lr.audits as Record<string, unknown>
      delete audits['speed-index']
      ;(audits['total-blocking-time'] as { numericValue: unknown }).numericValue = 'fast'
      ;(lr.categories as Record<string, { score: unknown }>).seo.score = null
    })
    const result = await runPageSpeed(TARGET, { apiKey: KEY, fetch: fakeFetch(() => response(body)) })
    expect(result.ok && result.measurements.ok && Object.keys(result.measurements.measures)).toEqual([
      'performance_score',
      'largest_contentful_paint',
      'first_contentful_paint',
      'layout_shift',
      'page_weight',
      'accessibility_score',
      'best_practices_score',
    ])
  })
})

describe('the request: one GET to Google, the key in a header only', () => {
  it('the header carries the key and the URL does not; mobile; the four categories; the site URL and nothing else', async () => {
    const fetch = fakeFetch()
    await runPageSpeed(TARGET, { apiKey: KEY, fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    const sent = new URL(String(url))
    expect(`${sent.origin}${sent.pathname}`).toBe(PAGESPEED_ENDPOINT)
    expect(String(url)).not.toContain(KEY)
    expect(sent.searchParams.has('key')).toBe(false)
    expect([...sent.searchParams.keys()].sort()).toEqual(['category', 'category', 'category', 'category', 'strategy', 'url'])
    expect(sent.searchParams.get('url')).toBe(TARGET)
    expect(sent.searchParams.get('strategy')).toBe('mobile')
    expect(sent.searchParams.getAll('category')).toEqual(['performance', 'accessibility', 'best-practices', 'seo'])
    expect(PAGESPEED_CATEGORIES).toEqual(['performance', 'accessibility', 'best-practices', 'seo'])
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('X-Goog-Api-Key')).toBe(KEY)
    // a redirect is refused rather than followed, so the key header is never carried to another host
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('the site URL is the normalised address: no query, no fragment, no trailing slash, no credentials', async () => {
    const fetch = fakeFetch()
    await runPageSpeed('https://enclavellc.net/?utm=x#top', { apiKey: KEY, fetch })
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('url')).toBe(TARGET)
    for (const bad of ['ftp://enclavellc.net', 'https://user:pw@enclavellc.net', 'not a url']) {
      const f = fakeFetch()
      expect(await runPageSpeed(bad, { apiKey: KEY, fetch: f })).toEqual({ ok: false, code: 'bad_url' })
      expect(f).not.toHaveBeenCalled()
    }
  })

  it('the key is read from the GOOGLE_PAGESPEED_API_KEY setting when none is passed', async () => {
    vi.stubEnv('GOOGLE_PAGESPEED_API_KEY', ` ${KEY} `)
    const fetch = fakeFetch()
    expect((await runPageSpeed(TARGET, { fetch })).ok).toBe(true)
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-Goog-Api-Key')).toBe(KEY)
  })
})

describe('failures come back as codes, never as the body or the key', () => {
  it.each<[string, Parameters<typeof runPageSpeed>[1], string]>([
    ['no key setting', { fetch: fakeFetch() }, 'no_key'],
    ['an empty key', { apiKey: '   ', fetch: fakeFetch() }, 'no_key'],
    ['a key with a line break in it', { apiKey: `${KEY}\nX-Other: 1`, fetch: fakeFetch() }, 'no_key'],
    ['a timeout', { apiKey: KEY, fetch: hangingFetch(), timeoutMs: 20 }, 'timeout'],
    ['429 from Google', { apiKey: KEY, fetch: fakeFetch(() => response(`{"error":{"code":429,"message":"Quota exceeded for key ${KEY}"}}`, 429)) }, 'http_429'],
    ['500 from Google', { apiKey: KEY, fetch: fakeFetch(() => response(`{"error":{"code":500,"message":"Lighthouse returned error for ${KEY}"}}`, 500)) }, 'http_500'],
    ['a Lighthouse runtime error', { apiKey: KEY, fetch: fakeFetch(() => response(withAudits((lr) => void (lr.runtimeError = { code: 'NO_FCP', message: `no paint ${KEY}` })))) }, 'runtime_error'],
    ['malformed JSON', { apiKey: KEY, fetch: fakeFetch(() => response('{"lighthouseResult": {')) }, 'bad_json'],
    ['no audits at all', { apiKey: KEY, fetch: fakeFetch(() => response(withAudits((lr) => void delete lr.audits))) }, 'bad_json'],
    ['audits with nothing we read', { apiKey: KEY, fetch: fakeFetch(() => response(withAudits((lr) => ((lr.audits = {}), (lr.categories = {}))))) }, 'bad_json'],
    ['no lighthouseResult', { apiKey: KEY, fetch: fakeFetch(() => response('{"kind":"pagespeedonline#result"}')) }, 'bad_json'],
    ['a network error whose message carries the key', { apiKey: KEY, fetch: vi.fn(async () => Promise.reject(new TypeError(`Invalid header value ${KEY}`))) }, 'network'],
    ['a test that ended on another site', { apiKey: KEY, fetch: fakeFetch(() => response(withAudits((lr) => void (lr.finalDisplayedUrl = 'https://elsewhere.example.test/')))) }, 'other_site'],
  ])('%s', async (_, options, code) => {
    const result = await runPageSpeed(TARGET, options)
    expect(result).toEqual({ ok: false, code })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('an abort from the caller ends the request with its own code', async () => {
    const controller = new AbortController()
    const pending = runPageSpeed(TARGET, { apiKey: KEY, fetch: hangingFetch(), signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'aborted' })
  })

  it('no key setting: Google is never asked', async () => {
    const fetch = fakeFetch()
    await runPageSpeed(TARGET, { fetch })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('the key never appears in a log line or an error', () => {
  it('across every outcome, through the module and through the pipeline', async () => {
    const fetches = [
      fakeFetch(),
      fakeFetch(() => response(`{"error":{"message":"bad key ${KEY}"}}`, 400)),
      fakeFetch(() => response(`not json ${KEY}`)),
      fakeFetch(() => response(withAudits((lr) => void (lr.runtimeError = { code: 'X', message: KEY })))),
      vi.fn(async () => Promise.reject(new Error(`connect failed ${KEY}`))),
      vi.fn(() => {
        throw new Error(`sync throw ${KEY}`)
      }),
      hangingFetch(),
    ]
    for (const fetch of fetches) {
      const options = { apiKey: KEY, fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 20 }
      await expect(runPageSpeed(TARGET, options)).resolves.toBeDefined()
      await expect(pageSpeedMeasurements(TARGET, options)).resolves.toBeDefined()
      const { deps } = stages({ measure: (url, o) => pageSpeedMeasurements(url, { ...o, ...options }) })
      await expect(runAuditJob(job, deps)).resolves.toBe('sent')
    }
    // and the setting path, with the key in the setting
    vi.stubEnv('GOOGLE_PAGESPEED_API_KEY', KEY)
    vi.stubGlobal('fetch', fakeFetch(() => response(`{"error":{"message":"${KEY}"}}`, 403)))
    await expect(runAuditJob(job, stages().deps)).resolves.toBe('sent')

    const all = loggedText(logs.log, logs.warn, logs.error)
    expect(all).toContain('[Audit] abcd1234 pagespeed: ')
    expect(all).not.toContain(KEY)
    expect(all).not.toContain('SENTINEL')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// In the pipeline
// ---------------------------------------------------------------------------------------------------------------

const job: AuditJob = { requestId: 'abcd1234', websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name, niche: 'general', adminEmail: 'n.garrett@enclavellc.net' }

function stages(overrides: PipelineDeps = {}) {
  const calls: string[] = []
  const mocks = {
    fetchSite: vi.fn(async (..._args: unknown[]) => (calls.push('fetch'), { pages: [] })),
    audit: vi.fn(async (..._args: unknown[]) => (calls.push('model'), auditFixture)),
    makeDocument: vi.fn(async (..._args: unknown[]) => (calls.push('document'), Buffer.from('docx'))),
    sendReport: vi.fn(async (..._args: unknown[]) => (calls.push('report mails'), { success: true, userSent: true, adminSent: true })),
    sendFailure: vi.fn(async (..._args: unknown[]) => (calls.push('failure mails'), { userSent: true, adminSent: true, errors: [] as string[] })),
  }
  return { calls, mocks, deps: { ...(mocks as PipelineDeps), ...overrides } }
}

// the real model step with a stand-in client that answers with the given tool input
function realModelStep(reply: unknown) {
  const create = vi.fn(async (_params: { tools: Array<{ input_schema: { properties: Record<string, unknown> } }>; messages: Array<{ content: unknown }>; system: string }) => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't', name: TOOL_NAME, input: reply }],
    _request_id: 'req_1',
  }))
  const audit: PipelineDeps['audit'] = (c, url, options, deps) => runAudit(c, url, options, { ...deps, client: { messages: { create } } as never })
  return { create, audit }
}

const HOME = `${SITE}/`
const PAGE = extractPage('<html><head><title>Sunrise Home Care of Dayton Ohio</title></head><body><h1>Care at home</h1><p>We help older adults stay at home in comfort.</p></body></html>', HOME)
const QUOTE = { kind: 'quote', pageUrl: HOME, text: 'We help older adults stay at home in comfort.' }
const measureEvidence = (id: string) => ({ kind: 'measure', pageUrl: '', text: id })
function replyFor(areas: string[], speed?: Array<{ text: string; evidence: unknown }>, callouts = false) {
  return {
    whereYouStand: 'A plain offer with little to act on.',
    working: [
      { title: 'Plain words', line: 'You say what you do.', evidence: QUOTE },
      { title: 'A clear heading', line: 'The heading names the service.', evidence: QUOTE },
    ],
    fixes: ['one', 'two', 'three'].map((n) => ({ headline: `Fix ${n}`, whatWeSaw: 'What the page says.', evidence: QUOTE, whyItMatters: 'It costs calls.', theFix: 'Change it.', effort: 'ten_minutes', selfServe: true })),
    areas: areas.map((key) => ({ key, score: 6, line: 'A line.', findings: key === 'speed' && speed ? speed : [{ text: 'A finding.', evidence: QUOTE }] })),
    ...(callouts ? { phoneCallouts: [] } : {}),
  }
}
const FOUR = ['found', 'first_impression', 'next_step', 'trust']
const FIVE = ['found', 'first_impression', 'speed', 'next_step', 'trust']

describe('runAuditJob with PageSpeed', () => {
  it('PageSpeed starts in parallel with reading the site, with the site URL the audit uses', async () => {
    let measureStarted = false
    let fetchSawMeasure = false
    const measure = vi.fn(async (_url: string, _o?: { signal?: AbortSignal }): Promise<Measurements> => ((measureStarted = true), { ok: false, reason: 'no_key' }))
    const { deps } = stages({
      measure,
      fetchSite: async () => {
        fetchSawMeasure = measureStarted
        return { pages: [] }
      },
    })
    await runAuditJob(job, deps)
    expect(fetchSawMeasure).toBe(true)
    expect(measure.mock.calls[0][0]).toBe(SITE)
  })

  it('reading the site fails: the PageSpeed request is aborted, and the audit fails as before', async () => {
    let signal: AbortSignal | undefined
    const { mocks, deps } = stages({
      measure: (_url, o) => ((signal = o?.signal), new Promise<Measurements>(() => {})),
      fetchSite: async () => Promise.reject(new Error('site down')),
    })
    await expect(runAuditJob(job, deps)).resolves.toBe('failed')
    expect(signal?.aborted).toBe(true)
    expect(mocks.sendFailure).toHaveBeenCalledWith(job, 'fetch: Error')
  })

  it('the default, with no key setting: Google is not asked, the log says no_key, Speed is not measured', async () => {
    const { audit, create } = realModelStep(replyFor(FOUR))
    const sendReport = vi.fn(async (_o: { auditResults: AuditResults }) => ({ success: true, userSent: true, adminSent: true }))
    const sendFailure = vi.fn()
    const outcome = await runAuditJob(job, { fetchSite: async () => ({ pages: [PAGE] }), audit, makeDocument: async () => Buffer.from('docx'), sendReport, sendFailure })
    expect(outcome).toBe('sent')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(loggedText(logs.log, logs.warn)).toContain('[Audit] abcd1234 pagespeed: no_key')
    expect(sendReport.mock.calls[0][0].auditResults.areas.find((a) => a.key === 'speed')).toEqual({ key: 'speed', name: 'Speed', assessed: false, reason: 'Not measured in this audit.' })
    expect(JSON.stringify(create.mock.calls[0][0].tools)).not.toMatch(/measure|screen|speed/)
    expect(sendFailure).not.toHaveBeenCalled()
  })

  it.each<[string, () => ReturnType<typeof fakeFetch> | ReturnType<typeof hangingFetch>, string]>([
    ['a timeout', hangingFetch, 'timeout'],
    ['429', () => fakeFetch(() => response('{}', 429)), 'http_429'],
    ['500', () => fakeFetch(() => response('{}', 500)), 'http_500'],
    ['a runtime error', () => fakeFetch(() => response(withAudits((lr) => void (lr.runtimeError = { code: 'NO_FCP' })))), 'runtime_error'],
    ['malformed JSON', () => fakeFetch(() => response('{')), 'bad_json'],
    ['missing audits', () => fakeFetch(() => response(withAudits((lr) => void delete lr.audits))), 'bad_json'],
  ])('PageSpeed fails with %s: the report still goes out with Speed not assessed, and no failure mail', async (_, makeFetch, code) => {
    const { audit, create } = realModelStep(replyFor(FOUR))
    const sendReport = vi.fn(async (_o: { auditResults: AuditResults }) => ({ success: true, userSent: true, adminSent: true }))
    const sendFailure = vi.fn()
    const fetch = makeFetch()
    const outcome = await runAuditJob(job, {
      fetchSite: async () => ({ pages: [PAGE] }),
      measure: (url, o) => pageSpeedMeasurements(url, { ...o, apiKey: KEY, fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 20 }),
      audit,
      makeDocument: async () => Buffer.from('docx'),
      sendReport,
      sendFailure,
    })
    expect(outcome).toBe('sent')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sendFailure).not.toHaveBeenCalled()
    expect(loggedText(logs.log, logs.warn, logs.error)).toContain(`[Audit] abcd1234 pagespeed: ${code}`)
    expect(sendReport.mock.calls[0][0].auditResults.areas.find((a) => a.key === 'speed')).toEqual({ key: 'speed', name: 'Speed', assessed: false, reason: 'Not measured in this audit.' })
    expect(JSON.stringify(create.mock.calls[0][0].tools)).not.toMatch(/measure|speed/)
  })

  it('a measure step that throws (even synchronously) never fails the audit', async () => {
    const { calls, mocks, deps } = stages({
      measure: () => {
        throw new Error(`boom ${KEY}`)
      },
    })
    await expect(runAuditJob(job, deps)).resolves.toBe('sent')
    expect(calls).toEqual(['fetch', 'model', 'document', 'report mails'])
    expect(mocks.audit.mock.calls[0][3]).toEqual({ requestId: 'abcd1234', measurements: { ok: false, reason: 'failed' } })
    expect(loggedText(logs.log, logs.warn, logs.error)).toContain('[Audit] abcd1234 pagespeed: failed')
    expect(loggedText(logs.log, logs.warn, logs.error)).not.toContain(KEY)
  })
})

describe('with the fixture measured: Speed is offered and a measure citation verifies', () => {
  const run = async (reply: unknown) => {
    const { audit, create } = realModelStep(reply)
    const sendReport = vi.fn(async (_o: { auditResults: AuditResults }) => ({ success: true, userSent: true, adminSent: true }))
    // (the fixture was measured on enclavellc.net: a test that ended on another site would not count)
    const outcome = await runAuditJob({ ...job, websiteUrl: TARGET }, {
      fetchSite: async () => ({ pages: [PAGE] }),
      measure: (url, o) => pageSpeedMeasurements(url, { ...o, apiKey: KEY, fetch: fakeFetch() as unknown as typeof globalThis.fetch }),
      audit,
      makeDocument: async () => Buffer.from('docx'),
      sendReport,
      sendFailure: vi.fn(),
    })
    return { outcome, create, results: sendReport.mock.calls[0]?.[0].auditResults }
  }

  it('the Speed area, the measure kind and the screenshot are offered; a real id prints the measure\'s own words', async () => {
    const { outcome, create, results } = await run(
      replyFor(FIVE, [{ text: 'The main content appears after 1.2 seconds.', evidence: measureEvidence('largest_contentful_paint') }], true)
    )
    expect(outcome).toBe('sent')
    expect(loggedText(logs.log)).toContain('[Audit] abcd1234 pagespeed: ok')
    const params = create.mock.calls[0][0]
    const tool = JSON.stringify(params.tools[0])
    expect(tool).toContain('"enum":["quote","fact","measure","screen"]')
    expect(tool).toContain('"enum":["found","first_impression","speed","next_step","trust"]')
    const blocks = params.messages[0].content as Array<{ type: string; text?: string; source?: { media_type: string } }>
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text'])
    expect(blocks[1].source?.media_type).toBe('image/jpeg')
    expect(blocks[0].text).toContain("- [largest_contentful_paint] the main content appeared after 1.2 seconds on a phone (Google's test)")
    expect(blocks[0].text).not.toContain(KEY)
    expect(params.system).not.toContain(KEY)

    const speed = results!.areas.find((a) => a.key === 'speed') as AssessedArea
    expect(speed).toMatchObject({ assessed: true, score: 6 })
    expect(speed.findings[0].evidence).toEqual({ kind: 'measured', text: "the main content appeared after 1.2 seconds on a phone (Google's test)" })
    expect(JSON.stringify(results)).not.toContain(KEY)
  })

  it('a made-up measure id is refused', async () => {
    const { results } = await run(
      replyFor(
        FIVE,
        [
          { text: 'The main content appears after 1.2 seconds.', evidence: measureEvidence('largest_contentful_paint') },
          { text: 'The page is ready late.', evidence: measureEvidence('time_to_interactive') },
          { text: 'The page weighs 982 KB.', evidence: measureEvidence('page_weight') },
        ],
        true
      )
    )
    const speed = results!.areas.find((a) => a.key === 'speed') as AssessedArea
    expect(speed.findings.map((f) => f.evidence)).toEqual([
      { kind: 'measured', text: "the main content appeared after 1.2 seconds on a phone (Google's test)" },
      { kind: 'measured', text: "the page weighs 982 KB in all (Google's test)" },
    ])
    expect(results!.droppedFindings).toBe(1)
    expect(JSON.stringify(results)).not.toContain('The page is ready late.')
  })
})
