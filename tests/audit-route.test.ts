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
vi.mock('@/lib/audit/generate-pdf', () => ({ generateAuditPdf: vi.fn(async () => Buffer.from('%PDF-')) }))

import { POST } from '@/app/api/audit/generate/route'
import { fetchWebsiteContent } from '@/lib/audit/fetch-website'
import { runAudit } from '@/lib/audit/run-audit'
import { generateAuditPdf } from '@/lib/audit/generate-pdf'
import { setRunLater } from '@/lib/audit/background'
import { auditLimiter } from '@/lib/audit/limits'
import { auditQueue } from '@/lib/audit/queue'
import { UnsafeUrlError } from '@/lib/audit/safe-fetch'

const URL_ = 'http://localhost/api/audit/generate'
const body = { websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name }
const ACCEPTED = "We're on it. Your audit will be in your inbox shortly."
const COULD_NOT_FINISH = 'We could not finish your audit automatically. Nate has your request and will send it himself.'
const TOO_MANY = "You've requested several audits recently. Please try again later, or email n.garrett@enclavellc.net."
const LIMIT_REACHED = "The free audit has reached its limit for today. Please email n.garrett@enclavellc.net and we'll run yours by hand."
const PREVIEW = "Thanks. We're rebuilding the free audit this week, so Nate will run yours by hand and email it to you himself."
const LEAD_NOT_SENT = 'We could not pass your request on. Please contact n.garrett@enclavellc.net.'
const ADMIN = 'n.garrett@enclavellc.net'

// each caller gets its own address and email unless a test wants them shared
const from = (ip: string) => ({ 'cf-connecting-ip': ip })
const visitor = (n: number) => ({ ...body, userEmail: `visitor${n}@example.test` })

function expectNothingRan() {
  expect(vi.mocked(fetchWebsiteContent)).not.toHaveBeenCalled()
  expect(vi.mocked(runAudit)).not.toHaveBeenCalled()
  expect(vi.mocked(generateAuditPdf)).not.toHaveBeenCalled()
}

// THE BACKGROUND RUN, under the test's control. The route hands its after-response work to runLater; here that
// work is kept, and a test decides when it runs: `post` answers and then runs it to the end (the usual case),
// `POST` alone answers and leaves it held, so a test can look at the moment between the answer and the work.
let held: Array<() => Promise<void>> = []
async function runHeld() {
  const work = held
  held = []
  await Promise.all(work.map((run) => run()))
}
async function post(request: Parameters<typeof POST>[0]) {
  const res = await POST(request)
  await runHeld()
  return res
}
// what was mailed, in order: who to, and which mail
const mails = () =>
  send.mock.calls.map(([mail]) => `${mail.to === ADMIN ? 'admin' : 'visitor'}: ${mail.subject.replace(/ for https?:\S+/, '').replace(/: https?:\S+/, '')}`)
const ACCEPT_MAIL = 'admin: Audit requested'
const REPORT_MAILS = ['visitor: Your Website Audit Report is Ready!', 'admin: New Audit Lead']
const FAILURE_MAILS = ['visitor: About your website audit', 'admin: Audit failed: run it by hand']

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.mocked(runAudit).mockClear()
  vi.mocked(fetchWebsiteContent).mockClear()
  vi.mocked(generateAuditPdf).mockClear()
  // the limiter and the queue live for the life of the process: start every test with empty counts
  auditLimiter.reset()
  auditQueue.reset()
  held = []
  setRunLater((work) => void held.push(work))
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  // the automated pipeline runs only for addresses on the preview list; the tests' visitor is on it
  // (in a different letter case, to show the comparison ignores case)
  vi.stubEnv('AUDIT_PREVIEW_EMAILS', ` someone@else.test , ${LEAD.email.toUpperCase()} `)
  logs = spyLogs()
})
afterEach(() => {
  setRunLater()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/audit/generate', () => {
  describe('accept, answer, then work', () => {
    it('the admin is told BEFORE the visitor is answered and before any work; the visitor is answered before the audit runs', async () => {
      const order: string[] = []
      send.mockImplementation(async (mail: { to: string; subject: string }) => {
        order.push(`mail ${mail.to === ADMIN ? 'admin' : 'visitor'}: ${mail.subject.split(/ for |: http/)[0]}`)
        return resendOk()
      })
      vi.mocked(fetchWebsiteContent).mockImplementationOnce(async () => (order.push('fetch'), { pages: [] }))
      vi.mocked(runAudit).mockImplementationOnce(async () => (order.push('model'), auditFixture))
      vi.mocked(generateAuditPdf).mockImplementationOnce(async () => (order.push('document'), Buffer.from('%PDF-')))

      const res = await POST(postJson(URL_, body))
      order.push('ANSWERED')
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ success: true, accepted: true, message: ACCEPTED })
      // at the moment of the answer: the accept mail is out, and nothing else has happened
      expect(order).toEqual(['mail admin: Audit requested', 'ANSWERED'])
      expectNothingRan()
      expect(held).toHaveLength(1)

      await runHeld()
      expect(order).toEqual([
        'mail admin: Audit requested',
        'ANSWERED',
        'fetch',
        'model',
        'document',
        'mail visitor: Your Website Audit Report',
        'mail admin: New Audit Lead',
      ])
      expect(loggedText(logs.log)).toMatch(/\[Audit\] [0-9a-f]{8} completed/)
      expectNoPii(logs, { includeLog: true })
    })

    it('the answer promises no time, and is the same whatever the audit goes on to do', async () => {
      send.mockResolvedValue(resendOk())
      vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new UnsafeUrlError('BLOCKED_ADDRESS'))
      const failing = await (await post(postJson(URL_, body, from('203.0.113.1')))).json()
      const working = await (await post(postJson(URL_, body, from('203.0.113.2')))).json()
      expect(failing).toEqual(working)
      expect(working.message).toBe(ACCEPTED)
      expect(JSON.stringify(working)).not.toMatch(/minute|\d/)
    })

    it('the accept mail carries the lead and the niche, escaped, and is not a report', async () => {
      send.mockResolvedValue(resendOk())
      await POST(postJson(URL_, { ...body, userName: '<b>Zed</b> "Q" & Co', niche: 'home_care' }))
      expect(send).toHaveBeenCalledTimes(1)
      const mail = send.mock.calls[0][0]
      expect(mail.to).toBe(ADMIN)
      expect(mail.subject).toBe('Audit requested')
      expect(mail.attachments).toBeUndefined()
      expect(mail.html).toContain(SITE)
      expect(mail.html).toContain(LEAD.email)
      expect(mail.html).toContain('&lt;b&gt;Zed&lt;/b&gt; &quot;Q&quot; &amp; Co')
      expect(mail.html).not.toContain('<b>Zed</b>')
      expect(mail.html).toContain('<strong>Audit written for:</strong> home care agency')
      expect(mail.html).not.toMatch(/<a\b/i)
      expectNoPii(logs, { includeLog: true })
    })

    it.each([
      ['returns an error', () => send.mockResolvedValueOnce(resendErr())],
      ['throws', () => send.mockRejectedValueOnce(new Error(`ECONNRESET sending about ${LEAD.email} ${SITE}`))],
      ['returns no id', () => send.mockResolvedValueOnce({ data: null, error: null, headers: null })],
    ])('if the accept mail cannot be sent (Resend %s) the request is NOT accepted: 502, no work scheduled, the queue place given back', async (_, arrange) => {
      arrange()
      const res = await post(postJson(URL_, body))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json).toMatchObject({ success: false, error: 'EMAIL_FAILED', message: LEAD_NOT_SENT })
      expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
      expect(send).toHaveBeenCalledTimes(1)
      expectNothingRan()
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      expect(loggedText(logs.error)).toMatch(new RegExp(`\\[Audit\\] ${json.requestId} accept mail failed: admin: `))
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('niche', () => {
    it('defaults to general, accepts home_care, and reaches the audit and the report', async () => {
      send.mockResolvedValue(resendOk())
      await post(postJson(URL_, body, from('203.0.113.1')))
      expect(vi.mocked(runAudit).mock.calls[0][2]).toMatchObject({ niche: 'general' })
      await post(postJson(URL_, { ...body, niche: 'home_care' }, from('203.0.113.2')))
      expect(vi.mocked(runAudit).mock.calls[1][2]).toMatchObject({ niche: 'home_care' })
    })

    it.each(['lawn_care', 'HOME_CARE', '', 'home care', 7, null, ['home_care']])('anything else (%j) is a 400, and nothing is counted, mailed or run', async (niche) => {
      for (let i = 0; i < 5; i++) {
        const res = await post(postJson(URL_, { ...body, niche }, from('203.0.113.9')))
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ success: false, error: 'VALIDATION_ERROR' })
      }
      expect(send).not.toHaveBeenCalled()
      expectNothingRan()
      send.mockResolvedValue(resendOk())
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
    })

    it('a lead mail carries the niche too', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      send.mockResolvedValue(resendOk())
      await post(postJson(URL_, { ...body, niche: 'home_care' }))
      expect(send.mock.calls[0][0].html).toContain('<strong>Audit written for:</strong> home care agency')
    })
  })

  describe('when the audit cannot be finished, the process carries on and two people are told', () => {
    it.each([
      ['the site cannot be read (refused address)', () => vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new UnsafeUrlError('BLOCKED_ADDRESS')), 'fetch: UnsafeUrlError BLOCKED_ADDRESS'],
      ['the site cannot be read (unreachable)', () => vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new Error(`getaddrinfo ENOTFOUND ${SITE}`)), 'fetch: Error'],
      ['the model gives no usable audit', () => vi.mocked(runAudit).mockResolvedValueOnce({ success: false, error: 'AUDIT_FAILED', message: 'x', websiteUrl: SITE }), 'model: StageFailure AUDIT_FAILED'],
      ['the model step throws', () => vi.mocked(runAudit).mockRejectedValueOnce(new RangeError(`bad ${SITE} ${LEAD.email}`)), 'model: RangeError'],
      ['the document cannot be made', () => vi.mocked(generateAuditPdf).mockRejectedValueOnce(new TypeError(`cannot render ${SITE} for ${LEAD.email}`)), 'document: TypeError'],
    ])('%s: exactly one failure mail to the visitor and one to the admin with the code', async (_, arrange, code) => {
      send.mockResolvedValue(resendOk())
      arrange()
      const res = await post(postJson(URL_, body))
      expect(res.status).toBe(202)
      expect(mails()).toEqual([ACCEPT_MAIL, ...FAILURE_MAILS])

      const [, toVisitor, toAdmin] = send.mock.calls.map(([mail]) => mail)
      expect(toVisitor.to).toBe(LEAD.email)
      expect(toVisitor.html).toContain(COULD_NOT_FINISH)
      // the visitor is not told why, and nothing about the failure is in their mail
      expect(toVisitor.html).not.toMatch(/BLOCKED|Error|StageFailure|fetch|model|document/)
      expect(toVisitor.attachments).toBeUndefined()
      expect(toAdmin.html).toContain(`<strong>Failure code:</strong> ${code}`)
      expect(toAdmin.html).toContain(LEAD.email)
      expect(toAdmin.html).toContain(SITE)

      // the log line carries the request id, the stage and the code, and nothing of the visitor's
      expect(loggedText(logs.error)).toMatch(new RegExp(`\\[Audit\\] [0-9a-f]{8} failed at ${code}`))
      expect(loggedText(logs.error, logs.warn, logs.log)).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
      expectNoPii(logs, { includeLog: true })
      // the place in the queue came back, and the next audit runs
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      send.mockClear()
      expect((await post(postJson(URL_, body, from('203.0.113.200')))).status).toBe(202)
      expect(mails()).toEqual([ACCEPT_MAIL, ...REPORT_MAILS])
    })

    it.each([
      ['returns an error', () => send.mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendErr()).mockResolvedValue(resendOk())],
      ['throws', () => send.mockResolvedValueOnce(resendOk()).mockRejectedValueOnce(new Error(`ECONNRESET sending to ${LEAD.email}`)).mockResolvedValue(resendOk())],
    ])('the report cannot be confirmed to the visitor (Resend %s): the visitor is sent NOTHING more (they may have it), the admin one mail saying so', async (_, arrange) => {
      // [RULE 8 / P3-11] one audit never mails the visitor both a report and a failure: a send that errors or throws
      // may still have been delivered
      arrange()
      await post(postJson(URL_, body))
      expect(mails()).toEqual([ACCEPT_MAIL, REPORT_MAILS[0], FAILURE_MAILS[1]])
      expect(send.mock.calls.filter(([mail]) => mail.to === LEAD.email)).toHaveLength(1)
      expect(send.mock.calls[2][0].html).toContain('<strong>Failure code:</strong> email: StageFailure REPORT_NOT_SENT')
      expect(send.mock.calls[2][0].html).toContain('The visitor has NOT been told anything')
      expect(loggedText(logs.error)).toMatch(/\[Audit\] [0-9a-f]{8} failed at email: StageFailure REPORT_NOT_SENT/)
      expectNoPii(logs, { includeLog: true })
    })

    it('[fold 1] visitor report sent, admin report failed: no failure mails, the admin failure is only a logged code', async () => {
      send.mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendErr(500, 'internal_server_error'))
      await post(postJson(URL_, body))
      expect(mails()).toEqual([ACCEPT_MAIL, ...REPORT_MAILS])
      const logged = loggedText(logs.error, logs.warn)
      expect(logged).toMatch(/\[Audit\] [0-9a-f]{8} .*admin: 500 internal_server_error/)
      expect(loggedText(logs.log)).toMatch(/completed/)
      expectNoPii(logs, { includeLog: true })
    })

    it('even the failure mails failing does not throw out of the background work', async () => {
      send.mockResolvedValueOnce(resendOk()).mockRejectedValue(new Error(`mail is down for ${LEAD.email}`))
      vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new UnsafeUrlError('TIMEOUT'))
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(202)
      await expect(runHeld()).resolves.toBeUndefined()
      expect(mails()).toEqual([ACCEPT_MAIL, ...FAILURE_MAILS])
      expect(loggedText(logs.error)).toMatch(/failure mail not sent: user: threw Error/)
      expect(loggedText(logs.error)).toMatch(/failure mail not sent: admin: threw Error/)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('at most 2 audits running and 5 waiting', () => {
    it('two run at once, five wait their turn, and the eighth request is passed on as a lead with the preview sentence', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1000')
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', Array.from({ length: 12 }, (_, i) => `visitor${i}@example.test`).join(','))
      send.mockResolvedValue(resendOk())
      // each audit stops in its fetch until the test lets it go
      const gates: Array<() => void> = []
      let fetching = 0
      let peak = 0
      vi.mocked(fetchWebsiteContent).mockImplementation(async () => {
        fetching++
        peak = Math.max(peak, fetching)
        await new Promise<void>((open) => gates.push(open))
        fetching--
        return { pages: [] }
      })

      const running: Array<Promise<void>> = []
      for (let i = 0; i < 7; i++) {
        const res = await POST(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))
        expect(res.status).toBe(202)
        expect(await res.json()).toMatchObject({ accepted: true, message: ACCEPTED })
        // the work starts as soon as the response is out, as it does in production
        running.push(...held.splice(0).map((run) => run()))
      }
      await new Promise((resolve) => setImmediate(resolve))
      expect(auditQueue.stats()).toEqual({ held: 7, running: 2, waiting: 5 })
      expect(fetching).toBe(2)
      expect(send).toHaveBeenCalledTimes(7)

      // the eighth: no place. It is not accepted; it becomes a lead, and the visitor reads the preview sentence
      const eighth = await POST(postJson(URL_, visitor(7), from('203.0.113.7')))
      expect(eighth.status).toBe(202)
      expect(await eighth.json()).toEqual({ success: true, preview: true, message: PREVIEW })
      expect(held).toHaveLength(0)
      expect(send).toHaveBeenCalledTimes(8)
      expect(send.mock.calls[7][0].subject).toBe('Audit request to run by hand')
      expect(send.mock.calls[7][0].html).toContain('as many audits as this server runs at once were already under way')
      expect(auditQueue.stats()).toEqual({ held: 7, running: 2, waiting: 5 })

      // let them through one at a time: never more than two in their fetch at once
      for (let done = 0; done < 7; done++) {
        expect(fetching).toBeLessThanOrEqual(2)
        gates.shift()!()
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
      }
      await Promise.all(running)
      expect(peak).toBe(2)
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(7)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      // and now there is room again
      vi.mocked(fetchWebsiteContent).mockImplementation(async () => ({ pages: [] }))
      expect((await post(postJson(URL_, visitor(8), from('203.0.113.8')))).status).toBe(202)
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(8)
      expectNoPii(logs, { includeLog: true })
    })

    it('a listed request made into a lead because the queue is full spends none of the day\'s audit slots', async () => {
      // ten audits a day; seven fill the queue, then three listed requests find it full
      vi.stubEnv('AUDIT_DAILY_LIMIT', '10')
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', Array.from({ length: 20 }, (_, i) => `visitor${i}@example.test`).join(','))
      send.mockResolvedValue(resendOk())
      const gates: Array<() => void> = []
      vi.mocked(fetchWebsiteContent).mockImplementation(async () => {
        await new Promise<void>((open) => gates.push(open))
        return { pages: [] }
      })
      const running: Array<Promise<void>> = []
      for (let i = 0; i < 7; i++) {
        expect((await POST(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))).status).toBe(202)
        running.push(...held.splice(0).map((run) => run()))
      }
      await new Promise((resolve) => setImmediate(resolve))
      expect(auditQueue.stats()).toEqual({ held: 7, running: 2, waiting: 5 })

      for (let i = 7; i < 10; i++) {
        const res = await POST(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))
        expect(res.status).toBe(202)
        expect(await res.json()).toEqual({ success: true, preview: true, message: PREVIEW })
      }
      expect(held).toHaveLength(0)
      // the leads hold no queue place either
      expect(auditQueue.stats()).toEqual({ held: 7, running: 2, waiting: 5 })

      // free the queue
      while (gates.length || auditQueue.stats().held) {
        gates.shift()?.()
        await new Promise((resolve) => setImmediate(resolve))
      }
      await Promise.all(running)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })

      // seven audits were admitted, so exactly three of the ten slots are left: the three leads took none
      vi.mocked(fetchWebsiteContent).mockImplementation(async () => ({ pages: [] }))
      for (let i = 10; i < 13; i++) {
        const res = await post(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))
        expect(await res.json()).toMatchObject({ accepted: true })
      }
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(10)
      // and the eleventh audit of the day is past the ceiling
      const past = await post(postJson(URL_, visitor(13), from('203.0.113.13')))
      expect(past.status).toBe(429)
      expect(await past.json()).toMatchObject({ leadSent: true })
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(10)
    })

    it('a request that fails before it is admitted gives back its queue place and its audit slot', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1')
      // the accept mail fails: not admitted
      send.mockResolvedValueOnce(resendErr())
      expect((await post(postJson(URL_, body, from('203.0.113.20')))).status).toBe(502)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      // handing the work on throws, after the place and the slot were taken: not admitted
      send.mockResolvedValue(resendOk())
      setRunLater(() => {
        throw new TypeError('after broke')
      })
      expect((await post(postJson(URL_, body, from('203.0.113.21')))).status).toBe(500)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      setRunLater((work) => void held.push(work))
      expect(vi.mocked(runAudit)).not.toHaveBeenCalled()
      // the one slot of the day is still there, and the audit runs
      send.mockResolvedValue(resendOk())
      expect(await (await post(postJson(URL_, body, from('203.0.113.22')))).json()).toMatchObject({ accepted: true })
      expect(vi.mocked(runAudit)).toHaveBeenCalledTimes(1)
    })
  })

  describe('[fold 3] the server-normalised URL is used downstream, and never logged', () => {
    it('a scheme-less URL reaches the email step as a valid URL, without throwing or being logged', async () => {
      send.mockResolvedValue(resendOk())
      const res = await post(postJson(URL_, { ...body, websiteUrl: 'httppii-site.example.test' }))
      expect(res.status).toBe(202)
      const normalised = 'https://httppii-site.example.test'
      expect(vi.mocked(fetchWebsiteContent).mock.calls[0][0]).toBe(normalised)
      expect(vi.mocked(runAudit).mock.calls[0][1]).toBe(normalised)
      expect(send).toHaveBeenCalledTimes(3)
      expect(send.mock.calls[0][0].html).toContain(normalised)
      expect(send.mock.calls[1][0].subject).toContain(normalised)
      expect(send.mock.calls[1][0].attachments[0].filename).toBe('httppii-site.example.test-website-audit.pdf')
      expectNoPii(logs, { includeLog: true })
    })

    it('an unexpected error in the request itself logs only the request id and the error name', async () => {
      vi.spyOn(auditQueue, 'reserve').mockImplementationOnce(() => {
        throw new TypeError(`queue broke for ${SITE} ${LEAD.email}`)
      })
      const res = await post(postJson(URL_, body))
      expect(res.status).toBe(500)
      const json = await res.json()
      expect(json).toMatchObject({ success: false, error: 'SERVER_ERROR' })
      expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
      const logged = loggedText(logs.error, logs.warn)
      expect(logged).toContain(json.requestId)
      expect(logged).toContain('TypeError')
      expectNothingRan()
      expectNoPii(logs, { includeLog: true })
    })
  })

  describe('[RULE 7] the visitor\'s free text is bounded at the door', () => {
    it.each([
      ['a 200k-character business type', { businessType: 'UNTRUSTEDPAGE'.repeat(10_000) + 'CONTENT'.repeat(10_000) }],
      ['a 101-character business type', { businessType: 'b'.repeat(101) }],
      ['a 101-character name', { userName: 'n'.repeat(101) }],
    ])('%s is a 400: nothing counted, mailed or run', async (_, extra) => {
      send.mockResolvedValue(resendOk())
      const res = await post(postJson(URL_, { ...body, ...extra }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('VALIDATION_ERROR')
      expect(send).not.toHaveBeenCalled()
      expectNothingRan()
    })

    it('100 characters of each is accepted', async () => {
      send.mockResolvedValue(resendOk())
      expect((await post(postJson(URL_, { ...body, businessType: 'b'.repeat(100), userName: 'n'.repeat(100) }))).status).toBe(202)
    })
  })

  describe('[RULE 8] a hung or failed start never leaves anyone without word', () => {
    it('the work cannot be started after the accept mail went out: both people get the failure mails, the visitor the honest answer', async () => {
      send.mockResolvedValue(resendOk())
      setRunLater(() => {
        throw new TypeError('after() outside a request')
      })
      const res = await post(postJson(URL_, body))
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ success: false, error: 'NOT_STARTED', message: COULD_NOT_FINISH })
      expect(mails()).toEqual([ACCEPT_MAIL, ...FAILURE_MAILS])
      expect(send.mock.calls[2][0].html).toContain('<strong>Failure code:</strong> start: accepted, then could not be started')
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      expectNothingRan()
      expectNoPii(logs, { includeLog: true })
    })

    it('a hung report send cannot hold a queue place: after 20 seconds the place comes back and the admin is told', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      send.mockResolvedValueOnce(resendOk()).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(resendOk())
      const res = await POST(postJson(URL_, body))
      expect(res.status).toBe(202)
      const work = runHeld()
      await vi.advanceTimersByTimeAsync(1)
      expect(auditQueue.stats().held).toBe(1)
      await vi.advanceTimersByTimeAsync(20_000)
      await work
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      // the visitor's send was attempted once and never followed by a failure mail; the admin got one mail
      expect(mails()).toEqual([ACCEPT_MAIL, REPORT_MAILS[0], FAILURE_MAILS[1]])
      expect(send.mock.calls[2][0].html).toContain('email: StageFailure REPORT_NOT_SENT')
      vi.useRealTimers()
    })

    it('a hung accept mail ends after 20 seconds as a failed send: 502, and the place and the slot come back', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1')
      send.mockReturnValueOnce(new Promise(() => {}))
      const pending = POST(postJson(URL_, body, from('203.0.113.70')))
      await vi.advanceTimersByTimeAsync(20_000)
      const res = await pending
      expect(res.status).toBe(502)
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
      expect(loggedText(logs.error)).toMatch(/accept mail failed: admin: timeout/)
      vi.useRealTimers()
      // the day's one slot is still there
      send.mockResolvedValue(resendOk())
      expect(await (await post(postJson(URL_, body, from('203.0.113.71')))).json()).toMatchObject({ accepted: true })
    })
  })

  describe('[fold 4] missing configuration still gives the visitor a way through', () => {
    it.each(['ANTHROPIC_API_KEY', 'RESEND_API_KEY'])('500 with the fallback contact when %s is missing: not accepted, nothing mailed, no place taken', async (key) => {
      vi.stubEnv(key, undefined)
      const res = await post(postJson(URL_, body))
      expect(res.status).toBe(500)
      expect((await res.json()).message).toContain('Please contact n.garrett@enclavellc.net')
      expect(send).not.toHaveBeenCalled()
      expectNothingRan()
      expect(auditQueue.stats()).toEqual({ held: 0, running: 0, waiting: 0 })
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
        const res = await post(postJson(URL_, { ...body, websiteUrl }, from('203.0.113.50')))
        expect(res.status).toBe(400)
        const json = await res.json()
        expect(json.error).toBe('INVALID_URL')
        expect(JSON.stringify(json)).not.toContain('pii-site')
      }
      expectNothingRan()
      expect(send).not.toHaveBeenCalled()
      // five bad requests used none of this caller's three turns
      send.mockResolvedValue(resendOk())
      expect((await post(postJson(URL_, body, from('203.0.113.50')))).status).toBe(202)
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
      for (let i = 0; i < 3; i++) expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
      vi.mocked(fetchWebsiteContent).mockClear()
      vi.mocked(runAudit).mockClear()
      vi.mocked(generateAuditPdf).mockClear()
      send.mockClear()

      expect(await expect429(await post(postJson(URL_, body, from('203.0.113.9'))), TOO_MANY)).toBe(3600)
      expectNothingRan()
      expect(send).not.toHaveBeenCalled()
      // another address is not affected
      expect((await post(postJson(URL_, body, from('203.0.113.10')))).status).toBe(202)

      vi.setSystemTime(new Date('2026-11-10T10:00:00Z'))
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
      expect(loggedText(logs.warn)).toMatch(/\[Audit\] [0-9a-f]{8} rate limited: ip/)
      expectNoPii(logs, { includeLog: true })
    })

    it('[3c] only cf-connecting-ip names the caller: requests without it share one bucket, whatever x-forwarded-for they send', async () => {
      // three requests, each claiming a different address in x-forwarded-for: all counted as the one "unknown" caller
      for (let i = 0; i < 3; i++) expect((await post(postJson(URL_, visitor(i), { 'x-forwarded-for': `198.51.100.${i}, 10.0.0.1` }))).status).toBe(202)
      await expect429(await post(postJson(URL_, visitor(4), { 'x-forwarded-for': '198.51.100.99' })), TOO_MANY)
      await expect429(await post(postJson(URL_, visitor(5))), TOO_MANY)
      // a request that did come through Cloudflare is its own caller, and x-forwarded-for changes nothing for it
      for (let i = 0; i < 3; i++) expect((await post(postJson(URL_, visitor(10 + i), { 'cf-connecting-ip': '203.0.113.77', 'x-forwarded-for': `198.51.100.${i}` }))).status).toBe(202)
      await expect429(await post(postJson(URL_, visitor(14), { 'cf-connecting-ip': '203.0.113.77', 'x-forwarded-for': '198.51.100.200' })), TOO_MANY)
    })

    it('[3b] an IPv6 caller is counted by its /64, and name+tag@ is the same address as name@', async () => {
      for (let i = 0; i < 3; i++) expect((await post(postJson(URL_, visitor(i), from(`2001:db8:abcd:12::${i + 1}`)))).status).toBe(202)
      await expect429(await post(postJson(URL_, visitor(4), from('2001:db8:abcd:12:ffff:ffff:ffff:ffff'))), TOO_MANY)
      expect((await post(postJson(URL_, visitor(5), from('2001:db8:abcd:13::1')))).status).toBe(202)

      for (let i = 0; i < 5; i++) expect((await post(postJson(URL_, { ...body, userEmail: `tagged+${i}@example.test` }, from(`203.0.113.${i}`)))).status).toBe(202)
      await expect429(await post(postJson(URL_, { ...body, userEmail: 'tagged+more@example.test' }, from('203.0.113.50'))), TOO_MANY)
      await expect429(await post(postJson(URL_, { ...body, userEmail: 'Tagged@example.test' }, from('203.0.113.51'))), TOO_MANY)
    })

    it('[3d] the hourly limit fires on the LEAD path: 100 visitors who are not on the list, then 429, with the day\'s audit ceiling untouched', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-10T09:00:00Z'))
      // the default ceiling of 30 audits a day is in force, and none of these requests may use it
      for (let i = 0; i < 100; i++) expect((await post(postJson(URL_, visitor(i), from(`198.51.100.${i}`)))).status).toBe(202)
      expect(send).toHaveBeenCalledTimes(100)
      await expect429(await post(postJson(URL_, visitor(101), from('198.51.100.101'))), LIMIT_REACHED)
      expect(send).toHaveBeenCalledTimes(100)
      expectNothingRan()
      expect(loggedText(logs.warn)).toMatch(/rate limited: global/)
      expect(loggedText(logs.warn)).not.toMatch(/rate limited: daily/)

      // an hour on, a listed address still gets a full audit: the 100 leads took none of the 30 audit slots
      vi.setSystemTime(new Date('2026-11-10T10:00:01Z'))
      for (let i = 0; i < 5; i++) expect((await post(postJson(URL_, body, from(`203.0.113.${i}`)))).status).toBe(202)
      expect(vi.mocked(runAudit)).toHaveBeenCalledTimes(5)
    })

    it('the 6th request for one email in a day is 429 whatever the IP', async () => {
      for (let i = 0; i < 5; i++) expect((await post(postJson(URL_, body, from(`203.0.113.${i}`)))).status).toBe(202)
      vi.mocked(fetchWebsiteContent).mockClear()
      vi.mocked(runAudit).mockClear()
      vi.mocked(generateAuditPdf).mockClear()
      const retryAfter = await expect429(await post(postJson(URL_, { ...body, userEmail: LEAD.email.toUpperCase() }, from('203.0.113.200'))), TOO_MANY)
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
      for (let i = 0; i < 5; i++) expect((await post(postJson(URL_, visitor(i), from(`203.0.113.${i}`)))).status).toBe(202)
      expect(audits()).toBe(0)
      // two real audits use the day's two slots
      for (const ip of ['203.0.113.50', '203.0.113.51']) expect((await post(postJson(URL_, body, from(ip)))).status).toBe(202)
      expect(audits()).toBe(2)
      send.mockClear()

      // the third listed request is not run, is told so, and its lead still reaches a person
      const res = await post(postJson(URL_, body, from('203.0.113.52')))
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('Retry-After'))).toBe(3600)
      expect(await res.json()).toEqual({ success: false, error: 'RATE_LIMITED', leadSent: true, message: CEILING_LEAD })
      expect(audits()).toBe(2)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0].html).toContain('Audit requested after today&#39;s audit limit was reached: run it by hand.')
      expect(send.mock.calls[0][0].attachments).toBeUndefined()
      expect(loggedText(logs.warn)).toMatch(/rate limited: daily \(lead passed on\)/)

      // a visitor who is not on the list is unaffected by the used-up ceiling
      expect((await post(postJson(URL_, visitor(9), from('203.0.113.9')))).status).toBe(202)
      expectNoPii(logs, { includeLog: true })

      vi.setSystemTime(new Date('2026-11-11T00:00:00Z'))
      const nextDay = await post(postJson(URL_, body, from('203.0.113.53')))
      expect(await nextDay.json()).toMatchObject({ accepted: true })
      expect(audits()).toBe(3)
      expect(audits()).toBe(3)
    })

    it('if that lead cannot be sent, the visitor is told to write in (nobody knows they asked)', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1')
      expect((await post(postJson(URL_, body, from('203.0.113.60')))).status).toBe(202)
      send.mockResolvedValue(resendErr())
      const res = await post(postJson(URL_, body, from('203.0.113.61')))
      expect(res.status).toBe(502)
      expect((await res.json()).message).toBe('We could not pass your request on. Please contact n.garrett@enclavellc.net.')
      expect(audits()).toBe(1)
    })

    it.each(['0', '-1', 'lots', '2.5', ''])('an unusable AUDIT_DAILY_LIMIT (%j) falls back to 30 audits', async (value) => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', value)
      const listed = Array.from({ length: 31 }, (_, i) => `listed${i}@pii-list.example.test`)
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', listed.join(','))
      for (let i = 0; i < 30; i++) expect((await post(postJson(URL_, { ...body, userEmail: listed[i] }, from(`198.51.100.${i}`)))).status).toBe(202)
      const res = await post(postJson(URL_, { ...body, userEmail: listed[30] }, from('198.51.100.31')))
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
        for (let i = 0; i < 100; i++, n++) expect((await post(postJson(URL_, visitor(n), from(`198.18.${Math.floor(n / 200)}.${n % 200}`)))).status).toBe(202)
      }
      expect(send).toHaveBeenCalledTimes(200)
      vi.setSystemTime(new Date('2026-11-10T05:00:00Z'))
      send.mockClear()
      await expect429(await post(postJson(URL_, visitor(999), from('198.19.0.1'))), LIMIT_REACHED)
      expect(send).not.toHaveBeenCalled()
      expect(loggedText(logs.warn)).toMatch(/rate limited: lead cap/)
      // a real audit still runs: the lead cap is not the audit ceiling
      expect((await post(postJson(URL_, body, from('198.19.0.2')))).status).toBe(202)
      // and the lead cap comes back the next UTC day
      vi.setSystemTime(new Date('2026-11-11T00:30:00Z'))
      expect((await post(postJson(URL_, visitor(1000), from('198.19.0.3')))).status).toBe(202)
    })

    it('the global limit: the 101st request in an hour is 429 with the "limit for today" wording', async () => {
      vi.stubEnv('AUDIT_DAILY_LIMIT', '1000')
      for (let i = 0; i < 100; i++) expect((await post(postJson(URL_, visitor(i), from(`198.51.100.${i}`)))).status).toBe(202)
      await expect429(await post(postJson(URL_, visitor(101), from('198.51.100.101'))), LIMIT_REACHED)
      expect(loggedText(logs.warn)).toMatch(/rate limited: global/)
    })

    it('attempts are counted even when the pipeline fails afterwards, so failures cannot be used to hammer for free', async () => {
      // two audits that are accepted and then fail in the background, and one request refused for configuration
      vi.mocked(fetchWebsiteContent).mockRejectedValueOnce(new UnsafeUrlError('BLOCKED_ADDRESS'))
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
      vi.mocked(runAudit).mockResolvedValueOnce({ success: false, error: 'AUDIT_FAILED', message: 'x', websiteUrl: SITE })
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
      expect(mails().filter((mail) => mail === FAILURE_MAILS[1])).toHaveLength(2)
      vi.stubEnv('ANTHROPIC_API_KEY', undefined)
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(500)
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')

      const calls = vi.mocked(fetchWebsiteContent).mock.calls.length
      await expect429(await post(postJson(URL_, body, from('203.0.113.9'))), TOO_MANY)
      expect(vi.mocked(fetchWebsiteContent).mock.calls.length).toBe(calls)
    })

    it('a body that fails validation is not counted', async () => {
      for (let i = 0; i < 6; i++) expect((await post(postJson(URL_, { websiteUrl: SITE, userEmail: 'not-an-email' }, from('203.0.113.9')))).status).toBe(400)
      expect((await post(postJson(URL_, body, from('203.0.113.9')))).status).toBe(202)
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
      await expectPreview(await post(postJson(URL_, body)))
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0].to).toBe('n.garrett@enclavellc.net')
      expectNoPii(logs, { includeLog: true })
    })

    it('the lead email carries the escaped name, email and normalised URL, the fixed line, and no attachment', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      vi.stubEnv('ADMIN_EMAIL', 'owner@enclave.example.test')
      send.mockResolvedValue(resendOk())
      await expectPreview(await post(postJson(URL_, stranger)))

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
      await expectPreview(await post(postJson(URL_, { websiteUrl: SITE, userEmail: LEAD.email })))
      expect(send.mock.calls[0][0].html).toContain('<strong>Name:</strong> Not provided')
    })

    it('an address on the list, in a different letter case, gets the full pipeline', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', `first@else.test,${LEAD.email.toUpperCase()}`)
      send.mockResolvedValue(resendOk())
      const res = await post(postJson(URL_, { ...body, userEmail: ` ${LEAD.email} `.trim() }))
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ success: true, accepted: true, message: ACCEPTED })
      expect(vi.mocked(fetchWebsiteContent)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(runAudit)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(generateAuditPdf)).toHaveBeenCalledTimes(1)
      expect(mails()).toEqual([ACCEPT_MAIL, ...REPORT_MAILS])
    })

    it.each([
      ['returns an error', () => send.mockResolvedValue(resendErr())],
      ['throws', () => send.mockRejectedValue(new Error(`ECONNRESET sending about ${LEAD.email} ${SITE}`))],
      ['returns no id', () => send.mockResolvedValue({ data: null, error: null, headers: null })],
    ])('when the lead email cannot be sent (Resend %s) the visitor is told, with the address to write to', async (_, arrange) => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      arrange()
      const res = await post(postJson(URL_, body))
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
      await expectPreview(await post(postJson(URL_, body, from('203.0.113.1'))))
      expect(send).toHaveBeenCalledTimes(1)

      vi.stubEnv('RESEND_API_KEY', undefined)
      const res = await post(postJson(URL_, body, from('203.0.113.2')))
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ success: false, error: 'CONFIG_ERROR' })
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('the rate limits still come first: a 4th request from one IP in the hour is 429 even for an address not on the list', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      send.mockResolvedValue(resendOk())
      for (let i = 0; i < 3; i++) await expectPreview(await post(postJson(URL_, visitor(i), from('203.0.113.9'))))
      expect(send).toHaveBeenCalledTimes(3)
      const res = await post(postJson(URL_, visitor(4), from('203.0.113.9')))
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ success: false, error: 'RATE_LIMITED', message: TOO_MANY })
      expect(send).toHaveBeenCalledTimes(3)
      expectNoPii(logs, { includeLog: true })
    })

    it('a bad URL is still a 400 on the gated path, with no lead email', async () => {
      vi.stubEnv('AUDIT_PREVIEW_EMAILS', undefined)
      const res = await post(postJson(URL_, { ...body, websiteUrl: 'http://pii-site.example.test:8080/' }))
      expect(res.status).toBe(400)
      expect(send).not.toHaveBeenCalled()
    })
  })
})
