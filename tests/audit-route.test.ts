import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, expectNoPii, loggedText, postJson, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))
// the pipeline before the email step: no network, no AI call. validateUrl stays real.
vi.mock('@/lib/audit/fetch-website', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit/fetch-website')>()),
  fetchWebsiteContent: vi.fn(async () => ({ pages: [] })),
}))
vi.mock('@/lib/audit/run-audit', () => ({ runAudit: vi.fn(async () => auditFixture) }))
vi.mock('@/lib/audit/generate-document', () => ({ generateAuditDocument: vi.fn(async () => Buffer.from('docx')) }))

import { POST } from '@/app/api/audit/generate/route'
import { fetchWebsiteContent } from '@/lib/audit/fetch-website'
import { runAudit } from '@/lib/audit/run-audit'
import { generateAuditDocument } from '@/lib/audit/generate-document'
import { auditLimiter } from '@/lib/audit/limits'
import { UnsafeUrlError } from '@/lib/audit/safe-fetch'

const URL_ = 'http://localhost/api/audit/generate'
const body = { websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name }
const SENT = `Your audit has been emailed to ${LEAD.email}. Check your inbox in 2-3 minutes.`
const NOT_SENT = 'Your audit ran but we could not email it. Please contact n.garrett@enclavellc.net.'
const UNREACHABLE = 'Unable to access the website. Please verify the URL is correct and the site is publicly accessible.'
const TOO_MANY = "You've requested several audits recently. Please try again later, or email n.garrett@enclavellc.net."
const LIMIT_REACHED = "The free audit has reached its limit for today. Please email n.garrett@enclavellc.net and we'll run yours by hand."
const PREVIEW = "Thanks. We're rebuilding the free audit this week, so Nate will run yours by hand and email it to you himself."
const LEAD_NOT_SENT = 'We could not pass your request on. Please contact n.garrett@enclavellc.net.'

// each caller gets its own address and email unless a test wants them shared
const from = (ip: string) => ({ 'cf-connecting-ip': ip })
const visitor = (n: number) => ({ ...body, userEmail: `visitor${n}@example.test` })

function expectNothingRan() {
  expect(vi.mocked(fetchWebsiteContent)).not.toHaveBeenCalled()
  expect(vi.mocked(runAudit)).not.toHaveBeenCalled()
  expect(vi.mocked(generateAuditDocument)).not.toHaveBeenCalled()
}

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.mocked(runAudit).mockClear()
  vi.mocked(fetchWebsiteContent).mockClear()
  vi.mocked(generateAuditDocument).mockClear()
  // the limiter lives for the life of the process: start every test with empty counts
  auditLimiter.reset()
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  // the automated pipeline runs only for addresses on the preview list; the tests' visitor is on it
  // (in a different letter case, to show the comparison ignores case)
  vi.stubEnv('AUDIT_PREVIEW_EMAILS', ` someone@else.test , ${LEAD.email.toUpperCase()} `)
  logs = spyLogs()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function expectNotSent(res: Response) {
  expect(res.status).toBe(502)
  const text = await res.text()
  expect(text).not.toContain('is being generated')
  const json = JSON.parse(text)
  expect(json.success).toBe(false)
  expect(json.message).toBe(NOT_SENT)
  expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
  expect(loggedText(logs.error, logs.warn)).toContain(json.requestId)
  expectNoPii(logs, { includeLog: true })
}

describe('POST /api/audit/generate', () => {
  it('reports success, honestly worded, when both emails go out', async () => {
    send.mockResolvedValue(resendOk())
    const res = await POST(postJson(URL_, body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, message: SENT })
  })

  it.each([
    ['returns an error', () => send.mockResolvedValue(resendErr())],
    ['throws', () => send.mockRejectedValue(new Error(`ECONNRESET sending to ${LEAD.email}`))],
  ])('is honest when the email step fails (Resend %s)', async (_, arrange) => {
    arrange()
    await expectNotSent(await POST(postJson(URL_, body)))
  })

  describe('[fold 1] partial success', () => {
    it('visitor email sent, admin email failed: 2xx for the visitor, the admin failure is only a logged code', async () => {
      send.mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendErr(500, 'internal_server_error'))
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, message: SENT })
      const logged = loggedText(logs.error, logs.warn)
      expect(logged).toMatch(/\[Audit\] [0-9a-f]{8} .*admin: 500 internal_server_error/)
      expectNoPii(logs, { includeLog: true })
    })

    it('visitor email failed, admin email sent: the honest 502', async () => {
      send.mockResolvedValueOnce(resendErr()).mockResolvedValueOnce(resendOk())
      await expectNotSent(await POST(postJson(URL_, body)))
    })
  })

  describe('[fold 3] the server-normalised URL is used downstream, and never logged', () => {
    it('a scheme-less URL reaches the email step as a valid URL, without throwing or being logged', async () => {
      send.mockResolvedValue(resendOk())
      const res = await POST(postJson(URL_, { ...body, websiteUrl: 'httppii-site.example.test' }))
      expect(res.status).toBe(200)
      const normalised = 'https://httppii-site.example.test'
      expect(vi.mocked(fetchWebsiteContent).mock.calls[0][0]).toBe(normalised)
      expect(vi.mocked(runAudit).mock.calls[0][1]).toBe(normalised)
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls[0][0].subject).toContain(normalised)
      expect(send.mock.calls[0][0].attachments[0].filename).toMatch(/^Website-Audit-httppii-site\.example\.test-/)
      expectNoPii(logs, { includeLog: true })
    })

    it('an unexpected error logs only the request id and the error name', async () => {
      vi.mocked(generateAuditDocument).mockRejectedValueOnce(new TypeError(`cannot render ${SITE} for ${LEAD.email}`))
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
      const logged = loggedText(logs.error, logs.warn)
      expect(logged).toContain(json.requestId)
      expect(logged).toContain('TypeError')
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('[fold 4] missing configuration still gives the visitor a way through', () => {
    it.each(['ANTHROPIC_API_KEY', 'RESEND_API_KEY'])('500 with the fallback contact when %s is missing', async (key) => {
      vi.stubEnv(key, undefined)
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(500)
      expect((await res.json()).message).toContain('Please contact n.garrett@enclavellc.net')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('URL rules come first: a bad URL is a 400 before anything is counted or requested', () => {
    it.each([
      ['a non-web scheme', 'ftp://pii-site.example.test/'],
      ['credentials in the URL', 'https://user:pass@pii-site.example.test/'],
      ['a non-default port', 'http://pii-site.example.test:3002/'],
      ['a bare internal name', 'http://localhost/'],
    ])('%s', async (_, websiteUrl) => {
      for (let i = 0; i < 5; i++) {
        const res = await POST(postJson(URL_, { ...body, websiteUrl }, from('203.0.113.50')))
        expect(res.status).toBe(400)
        const json = await res.json()
        expect(json.error).toBe('INVALID_URL')
        expect(JSON.stringify(json)).not.toContain('pii-site')
      }
      expectNothingRan()
      expect(send).not.toHaveBeenCalled()
      // five bad requests used none of this caller's three turns
      send.mockResolvedValue(resendOk())
      expect((await POST(postJson(URL_, body, from('203.0.113.50')))).status).toBe(200)
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('a site that cannot be read', () => {
    it('an address the guard refused gets exactly the same answer as an unreachable site, and the reason is only a logged code', async () => {
      const answers: unknown[] = []
      for (const failure of [
        new UnsafeUrlError('BLOCKED_ADDRESS'),
        new UnsafeUrlError('HTTP_STATUS'),
        new UnsafeUrlError('TIMEOUT'),
        new Error(`getaddrinfo ENOTFOUND ${SITE}`),
      ]) {
        vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(failure)
        const res = await POST(postJson(URL_, body, from(`203.0.113.${answers.length}`)))
        expect(res.status).toBe(400)
        answers.push(await res.json())
      }
      expect(answers[0]).toEqual({ success: false, error: 'FETCH_FAILED', message: UNREACHABLE })
      for (const answer of answers) expect(answer).toEqual(answers[0])
      expect(vi.mocked(runAudit)).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      const logged = loggedText(logs.error, logs.warn)
      expect(logged).toMatch(/\[Audit\] [0-9a-f]{8} fetch failed: UnsafeUrlError BLOCKED_ADDRESS/)
      expect(logged).toMatch(/fetch failed: UnsafeUrlError HTTP_STATUS/)
      expect(logged).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('rate limits, before any request or model call', () => {
    beforeEach(() => send.mockResolvedValue(resendOk()))

    async function expect429(res: Response, message: string) {
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ success: false, error: 'RATE_LIMITED', message })
      return Number(res.headers.get('retry-after'))
    }

    it('the 4th request from one IP in an hour is 429, does nothing, and is allowed again after the hour', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-10T09:00:00Z'))
      for (let i = 0; i < 3; i++) expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(200)
      vi.mocked(fetchWebsiteContent).mockClear()
      vi.mocked(runAudit).mockClear()
      vi.mocked(generateAuditDocument).mockClear()
      send.mockClear()

      expect(await expect429(await POST(postJson(URL_, body, from('203.0.113.9'))), TOO_MANY)).toBe(3600)
      expectNothingRan()
      expect(send).not.toHaveBeenCalled()
      // another address is not affected
      expect((await POST(postJson(URL_, body, from('203.0.113.10')))).status).toBe(200)

      vi.setSystemTime(new Date('2026-11-10T10:00:00Z'))
      expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(200)
      expect(loggedText(logs.warn)).toMatch(/\[Audit\] [0-9a-f]{8} rate limited: ip/)
      expectNoPii(logs, { includeLog: true })
    })

    it('without cf-connecting-ip the first x-forwarded-for entry is the caller; with neither, everyone shares one bucket', async () => {
      for (let i = 0; i < 3; i++) expect((await POST(postJson(URL_, body, { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }))).status).toBe(200)
      await expect429(await POST(postJson(URL_, body, { 'x-forwarded-for': '198.51.100.7, 10.9.9.9' })), TOO_MANY)
      for (let i = 0; i < 2; i++) expect((await POST(postJson(URL_, body))).status).toBe(200)
      await expect429(await POST(postJson(URL_, body)), TOO_MANY)
    })

    it('the 6th request for one email in a day is 429 whatever the IP', async () => {
      for (let i = 0; i < 5; i++) expect((await POST(postJson(URL_, body, from(`203.0.113.${i}`)))).status).toBe(200)
      vi.mocked(fetchWebsiteContent).mockClear()
      vi.mocked(runAudit).mockClear()
      vi.mocked(generateAuditDocument).mockClear()
      const retryAfter = await expect429(await POST(postJson(URL_, { ...body, userEmail: LEAD.email.toUpperCase() }, from('203.0.113.200'))), TOO_MANY)
      expect(retryAfter).toBeGreaterThan(86_000)
      expectNothingRan()
      expect(loggedText(logs.warn)).toMatch(/rate limited: email/)
      expectNoPii(logs, { includeLog: true })
    })

    const CEILING_LEAD = 'The free audit has reached its limit for today. Nate has your request and will run yours by hand.'
    const audits = () => vi.mocked(runAudit).mock.calls.length

    it('the daily AUDIT ceiling is used only by requests that run an audit; past it a listed request becomes a lead; it comes back at the UTC day change', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-10T23:00:00Z'))
      vi.stubEnv('AUDIT_DAILY_LIMIT', '2')
      // visitors who are not on the list spend nothing and never use the ceiling, however many there are
      for (let i = 0; i < 5; i++) expect((await POST(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))).status).toBe(202)
      expect(audits()).toBe(0)
      // two real audits use the day's two slots
      for (const ip of ['203.0.113.50', '203.0.113.51']) expect((await POST(postJson(URL_, body, from(ip)))).status).toBe(200)
      expect(audits()).toBe(2)
      send.mockClear()

      // the third listed request is not run, is told so, and its lead still reaches a person
      const res = await POST(postJson(URL_, body, from('203.0.113.52')))
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('Retry-After'))).toBe(3600)
      expect(await res.json()).toEqual({ success: false, error: 'RATE_LIMITED', leadSent: true, message: CEILING_LEAD })
      expect(audits()).toBe(2)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0].html).toContain('Audit requested after today&#39;s audit limit was reached: run it by hand.')
      expect(send.mock.calls[0][0].attachments).toBeUndefined()
      expect(loggedText(logs.warn)).toMatch(/rate limited: daily \(lead passed on\)/)

      // a visitor who is not on the list is unaffected by the used-up ceiling
      expect((await POST(postJson(URL_, visitor(9), from('203.0.113.9')))).status).toBe(202)
      expectNoPii(logs, { includeLog: true })

      vi.setSystemTime(new Date('2026-11-11T00:00:00Z'))
      expect((await POST(postJson(URL_, body, from('203.0.113.53')))).status).toBe(200)
      expect(audits()).toBe(3)
    })

    it('if that lead cannot be sent, the visitor is told to write in (nobody knows they asked)', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1')
      expect((await POST(postJson(URL_, body, from('203.0.113.60')))).status).toBe(200)
      send.mockResolvedValue(resendErr())
      const res = await POST(postJson(URL_, body, from('203.0.113.61')))
      expect(res.status).toBe(502)
      expect((await res.json()).message).toBe('We could not pass your request on. Please contact n.garrett@enclavellc.net.')
      expect(audits()).toBe(1)
    })

    it.each(['0', '-1', 'lots', '2.5', ''])('an unusable AUDIT_DAILY_LIMIT (%j) falls back to 30 audits', async (value) => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', value)
      const listed = Array.from({ length: 31 }, (_, i) => `listed${i}@pii-list.example.test`)
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', listed.join(','))
      for (let i = 0; i < 30; i++) expect((await POST(postJson(URL_, { ...body, userEmail: listed[i] }, from(`198.51.100.${i}`)))).status).toBe(200)
      const res = await POST(postJson(URL_, { ...body, userEmail: listed[30] }, from('198.51.100.31')))
      expect(res.status).toBe(429)
      expect((await res.json()).message).toBe(CEILING_LEAD)
      expect(audits()).toBe(30)
    })

    it('lead emails have their own daily cap (200): the 201st lead of a day is refused and sends nothing; audits are untouched by it', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1000')
      let n = 0
      // 100 an hour is the global limit, so the 200 leads take two separate hours of one UTC day
      for (const hour of ['2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z']) {
        vi.setSystemTime(new Date(hour))
        for (let i = 0; i < 100; i++, n++) expect((await POST(postJson(URL_, visitor(n), from(`198.18.${Math.floor(n / 200)}.${n % 200}`)))).status).toBe(202)
      }
      expect(send).toHaveBeenCalledTimes(200)
      vi.setSystemTime(new Date('2026-11-10T05:00:00Z'))
      send.mockClear()
      await expect429(await POST(postJson(URL_, visitor(999), from('198.19.0.1'))), LIMIT_REACHED)
      expect(send).not.toHaveBeenCalled()
      expect(loggedText(logs.warn)).toMatch(/rate limited: lead cap/)
      // a real audit still runs: the lead cap is not the audit ceiling
      expect((await POST(postJson(URL_, body, from('198.19.0.2')))).status).toBe(200)
      // and the lead cap comes back the next UTC day
      vi.setSystemTime(new Date('2026-11-11T00:30:00Z'))
      expect((await POST(postJson(URL_, visitor(1000), from('198.19.0.3')))).status).toBe(202)
    })

    it('the global limit: the 101st request in an hour is 429 with the "limit for today" wording', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1000')
      for (let i = 0; i < 100; i++) expect((await POST(postJson(URL_, visitor(i), from(`198.51.100.${i}`)))).status).toBe(202)
      await expect429(await POST(postJson(URL_, visitor(101), from('198.51.100.101'))), LIMIT_REACHED)
      expect(loggedText(logs.warn)).toMatch(/rate limited: global/)
    })

    it('attempts are counted even when the pipeline fails afterwards, so failures cannot be used to hammer for free', async () => {
      vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new UnsafeUrlError('BLOCKED_ADDRESS'))
      expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(400)
      vi.mocked(runAudit).mockResolvedValueOnce({ success: false, error: 'AUDIT_FAILED', message: 'x', websiteUrl: SITE })
      expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(500)
      vi.stubEnv('ANTHROPIC_API_KEY', undefined)
      expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(500)
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')

      const calls = vi.mocked(fetchWebsiteContent).mock.calls.length
      await expect429(await POST(postJson(URL_, body, from('203.0.113.9'))), TOO_MANY)
      expect(vi.mocked(fetchWebsiteContent).mock.calls.length).toBe(calls)
    })

    it('a body that fails validation is not counted', async () => {
      for (let i = 0; i < 6; i++) expect((await POST(postJson(URL_, { websiteUrl: SITE, userEmail: 'not-an-email' }, from('203.0.113.9')))).status).toBe(400)
      expect((await POST(postJson(URL_, body, from('203.0.113.9')))).status).toBe(200)
    })
  })

  describe('preview gate: only listed addresses get the automated report', () => {
    const stranger = { websiteUrl: 'pii-site.example.test/pricing?ref=1', userEmail: 'Stranger.Piitest@Example.test', userName: '<b>Sam</b> "Piitest" & Co' }

    async function expectPreview(res: Response) {
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ success: true, preview: true, message: PREVIEW })
      expectNothingRan()
    }

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['only commas and spaces', ' , ,'],
      ['a list without this address', 'someone@else.test, other@else.test'],
      ['a list where this address is only part of another', `x${LEAD.email}, ${LEAD.email}.uk`],
    ])('list %s: 202 preview, nothing automated runs, one lead email goes to the admin', async (_, list) => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', list)
      send.mockResolvedValue(resendOk())
      await expectPreview(await POST(postJson(URL_, body)))
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0].to).toBe('n.garrett@enclavellc.net')
      expectNoPii(logs, { includeLog: true })
    })

    it('the lead email carries the escaped name, email and normalised URL, the fixed line, and no attachment', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      vi.stubEnv('ADMIN_EMAIL', 'owner@enclave.example.test')
      send.mockResolvedValue(resendOk())
      await expectPreview(await POST(postJson(URL_, stranger)))

      expect(send).toHaveBeenCalledTimes(1)
      const mail = send.mock.calls[0][0]
      expect(mail.to).toBe('owner@enclave.example.test')
      expect(mail.attachments).toBeUndefined()
      expect(mail.html).toContain('Audit requested while the free audit is in preview: run it by hand.')
      expect(mail.html).toContain('https://pii-site.example.test/pricing')
      expect(mail.html).not.toContain('ref=1')
      expect(mail.html).toContain('Stranger.Piitest@Example.test')
      expect(mail.html).toContain('&lt;b&gt;Sam&lt;/b&gt; &quot;Piitest&quot; &amp; Co')
      expect(mail.html).not.toContain('<b>Sam</b>')
      expect(`${mail.subject}${mail.html.replace('<!DOCTYPE html>', '')}`).not.toContain('!')
      expectNoPii(logs, { includeLog: true })
      expect(loggedText(logs.error, logs.warn, logs.log)).not.toMatch(/Stranger|Sam|Piitest/i)
    })

    it('with no name the lead says so', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      send.mockResolvedValue(resendOk())
      await expectPreview(await POST(postJson(URL_, { websiteUrl: SITE, userEmail: LEAD.email })))
      expect(send.mock.calls[0][0].html).toContain('<strong>Name:</strong> Not provided')
    })

    it('an address on the list, in a different letter case, gets the full pipeline', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', `first@else.test,${LEAD.email.toUpperCase()}`)
      send.mockResolvedValue(resendOk())
      const res = await POST(postJson(URL_, { ...body, userEmail: ` ${LEAD.email} `.trim() }))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, message: SENT })
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(runAudit)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(generateAuditDocument)).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['returns an error', () => send.mockResolvedValue(resendErr())],
      ['throws', () => send.mockRejectedValue(new Error(`ECONNRESET sending about ${LEAD.email} ${SITE}`))],
      ['returns no id', () => send.mockResolvedValue({ data: null, error: null, headers: null })],
    ])('when the lead email cannot be sent (Resend %s) the visitor is told, with the address to write to', async (_, arrange) => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      arrange()
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json).toMatchObject({ success: false, error: 'EMAIL_FAILED', message: LEAD_NOT_SENT })
      expect(json.preview).toBeUndefined()
      expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
      expect(send).toHaveBeenCalledTimes(1)
      expectNothingRan()
      expect(loggedText(logs.error)).toMatch(new RegExp(`\\[Audit\\] ${json.requestId} preview lead failed: admin: `))
      expectNoPii(logs, { includeLog: true })
    })

    it('the gated path needs the email key only: a missing Anthropic key does not block it, a missing email key does', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      vi.stubEnv('ANTHROPIC_API_KEY', undefined)
      send.mockResolvedValue(resendOk())
      await expectPreview(await POST(postJson(URL_, body, from('203.0.113.1'))))
      expect(send).toHaveBeenCalledTimes(1)

      vi.stubEnv('RESEND_API_KEY', undefined)
      const res = await POST(postJson(URL_, body, from('203.0.113.2')))
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ success: false, error: 'CONFIG_ERROR' })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('the rate limits still come first: a 4th request from one IP in the hour is 429 even for an address not on the list', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      send.mockResolvedValue(resendOk())
      for (let i = 0; i < 3; i++) await expectPreview(await POST(postJson(URL_, visitor(i), from('203.0.113.9'))))
      expect(send).toHaveBeenCalledTimes(3)
      const res = await POST(postJson(URL_, visitor(4), from('203.0.113.9')))
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ success: false, error: 'RATE_LIMITED', message: TOO_MANY })
      expect(send).toHaveBeenCalledTimes(3)
      expectNoPii(logs, { includeLog: true })
    })

    it('a bad URL is still a 400 on the gated path, with no lead email', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      const res = await POST(postJson(URL_, { ...body, websiteUrl: 'http://pii-site.example.test:8080/' }))
      expect(res.status).toBe(400)
      expect(send).not.toHaveBeenCalled()
    })
  })
})
