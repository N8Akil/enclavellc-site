import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, expectNoPii, loggedText, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { extractPage } from '@/lib/audit/fetch-website'
import { ACCEPT_MESSAGE, FAILURE_MESSAGE, sendAcceptMail, sendFailureMails } from '@/lib/audit/notify'
import { notMeasured, runAuditJob, type AuditJob, type PipelineDeps } from '@/lib/audit/pipeline'
import { TOOL_NAME } from '@/lib/audit/run-audit'
import { UnsafeUrlError } from '@/lib/audit/safe-fetch'
import type { AuditResults, Measurements, WebsiteContent } from '@/lib/audit/types'

// One audit, start to finish, with every stage a stand-in: no page is requested, no model is called, no mail is sent.
const job: AuditJob = { requestId: 'abcd1234', websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name, niche: 'home_care', adminEmail: 'n.garrett@enclavellc.net', businessType: 'Home care' }
const content: WebsiteContent = { pages: [] }

function stages(overrides: PipelineDeps = {}) {
  const calls: string[] = []
  // the stand-ins, kept apart so a test can look at what each was called with
  const mocks = {
    fetchSite: vi.fn(async (..._args: unknown[]) => (calls.push('fetch'), content)),
    audit: vi.fn(async (..._args: unknown[]) => (calls.push('model'), auditFixture)),
    makeDocument: vi.fn(async (..._args: unknown[]) => (calls.push('document'), Buffer.from('docx'))),
    sendReport: vi.fn(async (..._args: unknown[]) => (calls.push('report mails'), { success: true, userSent: true, adminSent: true })),
    sendFailure: vi.fn(async (..._args: unknown[]) => (calls.push('failure mails'), { userSent: true, adminSent: true, errors: [] as string[] })),
  }
  const deps: PipelineDeps = { ...(mocks as PipelineDeps), ...overrides }
  return { calls, mocks, deps }
}

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  logs = spyLogs()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the words the visitor is given', () => {
  it('promise no time, and say who has the request when the audit cannot be finished', () => {
    expect(ACCEPT_MESSAGE).toBe("We're on it. Your audit will be in your inbox shortly.")
    expect(FAILURE_MESSAGE).toBe('We could not finish your audit automatically. Nate has your request and will send it himself.')
    for (const message of [ACCEPT_MESSAGE, FAILURE_MESSAGE]) expect(message).not.toMatch(/\d|minute|hour|!/)
  })
})

describe('runAuditJob', () => {
  it('runs the stages in order and sends the report; the niche and the request id travel with it', async () => {
    const { calls, mocks, deps } = stages()
    await expect(runAuditJob(job, deps)).resolves.toBe('sent')
    expect(calls).toEqual(['fetch', 'model', 'document', 'report mails'])
    expect(mocks.fetchSite).toHaveBeenCalledWith(SITE)
    expect(mocks.audit.mock.calls[0].slice(1, 3)).toEqual([SITE, { businessType: 'Home care', niche: 'home_care' }])
    expect(mocks.sendReport.mock.calls[0][0]).toMatchObject({ userEmail: LEAD.email, adminEmail: 'n.garrett@enclavellc.net', websiteUrl: SITE, auditResults: auditFixture })
    expect(mocks.sendFailure).not.toHaveBeenCalled()
    expect(loggedText(logs.log)).toContain('[Audit] abcd1234 completed')
    expectNoPii(logs, { includeLog: true })
  })

  describe('measurements: nothing measures a site yet, and the default says so', () => {
    it('the default returns "not configured", and that is what the model step is given', async () => {
      await expect(notMeasured()).resolves.toEqual({ ok: false, reason: 'not_configured' })
      const { mocks, deps } = stages()
      await runAuditJob(job, deps)
      expect(mocks.audit.mock.calls[0][3]).toEqual({ requestId: 'abcd1234', measurements: { ok: false, reason: 'not_configured' } })
    })

    it('an injected measurement is passed through to the model step untouched', async () => {
      const measured: Measurements = { ok: true, measures: { load_time: { value: 4.2, unit: 's', display: '4.2 seconds' } }, screenshot: { mediaType: 'image/png', dataBase64: 'AAAA' } }
      const measure = vi.fn(async () => measured)
      const { mocks, deps } = stages({ measure })
      await runAuditJob(job, deps)
      expect(measure).toHaveBeenCalledWith(SITE)
      expect(mocks.audit.mock.calls[0][3]).toEqual({ requestId: 'abcd1234', measurements: measured })
    })

    it('a measurement that throws is not a failed audit: the report still goes out, with nothing measured', async () => {
      const { calls, mocks, deps } = stages({ measure: vi.fn(async () => Promise.reject(new Error(`measuring ${SITE} failed for ${LEAD.email}`))) })
      await expect(runAuditJob(job, deps)).resolves.toBe('sent')
      expect(calls).toEqual(['fetch', 'model', 'document', 'report mails'])
      expect(mocks.audit.mock.calls[0][3]).toEqual({ requestId: 'abcd1234', measurements: { ok: false, reason: 'failed' } })
      expectNoPii(logs, { includeLog: true })
    })

    it('END TO END with the real model step and the default: Speed is "Not measured in this audit." and the model is offered no measure, no screenshot', async () => {
      const page = extractPage('<html><head><title>Sunrise Home Care of Dayton Ohio</title></head><body><h1>Care at home</h1><p>We help older adults stay at home in comfort.</p></body></html>', `${SITE}/`)
      const QUOTE = 'We help older adults stay at home in comfort.'
      const evidence = { kind: 'quote', pageUrl: `${SITE}/`, text: QUOTE }
      const reply = {
        whereYouStand: 'A plain offer with little to act on.',
        working: [{ title: 'Plain words', line: 'You say what you do.', evidence }, { title: 'A clear heading', line: 'The heading names the service.', evidence }],
        // (headlines in words: RULE 10 refuses a digit that is not in the evidence)
        fixes: ['one', 'two', 'three'].map((n) => ({ headline: `Fix ${n}`, whatWeSaw: 'What the page says.', evidence, whyItMatters: 'It costs calls.', theFix: 'Change it.', effort: 'ten_minutes', selfServe: true })),
        areas: ['found', 'first_impression', 'next_step', 'trust'].map((key) => ({ key, score: 6, line: 'A line.', findings: [{ text: 'A finding.', evidence }] })),
      }
      const create = vi.fn(async (_params: { tools: unknown[]; messages: Array<{ content: unknown }> }) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: TOOL_NAME, input: reply }], _request_id: 'req_1' }))
      const { runAudit } = await import('@/lib/audit/run-audit')
      const sendReport = vi.fn(async (_options: { auditResults: AuditResults }) => ({ success: true, userSent: true, adminSent: true }))
      const outcome = await runAuditJob(job, {
        fetchSite: async () => ({ pages: [page] }),
        audit: (c, url, options, deps) => runAudit(c, url, options, { ...deps, client: { messages: { create } } as never }),
        makeDocument: async () => Buffer.from('docx'),
        sendReport,
      })
      expect(outcome).toBe('sent')
      const results = sendReport.mock.calls[0][0].auditResults
      expect(results.areas.find((a: { key: string }) => a.key === 'speed')).toEqual({ key: 'speed', name: 'Speed', assessed: false, reason: 'Not measured in this audit.' })
      expect(results.areas.map((a: { name: string }) => a.name)).toEqual(['Found', 'First impression', 'Speed', 'Two clear doors', 'Trust'])
      const params = create.mock.calls[0][0]
      expect(JSON.stringify(params.tools)).not.toMatch(/measure|screen|speed|phoneCallouts/)
      expect(typeof params.messages[0].content).toBe('string')
    })
  })

  describe('whatever goes wrong, it does not throw, and exactly one failure mail goes to each person', () => {
    it.each<[string, PipelineDeps, string, string[]]>([
      ['the site is refused by the guard', { fetchSite: async () => Promise.reject(new UnsafeUrlError('BLOCKED_ADDRESS')) }, 'fetch: UnsafeUrlError BLOCKED_ADDRESS', []],
      ['the site times out', { fetchSite: async () => Promise.reject(new UnsafeUrlError('TIMEOUT')) }, 'fetch: UnsafeUrlError TIMEOUT', []],
      ['the fetch throws something with the address in it', { fetchSite: async () => Promise.reject(new Error(`ENOTFOUND ${SITE} for ${LEAD.email}`)) }, 'fetch: Error', []],
      ['the model gives no usable audit', { audit: async () => ({ success: false as const, error: 'AUDIT_FAILED', message: 'x', websiteUrl: SITE }) }, 'model: StageFailure AUDIT_FAILED', ['fetch']],
      ['the model step throws', { audit: async () => Promise.reject(new RangeError(`bad ${LEAD.email}`)) }, 'model: RangeError', ['fetch']],
      ['the document cannot be made', { makeDocument: async () => Promise.reject(new TypeError(`cannot render ${SITE}`)) }, 'document: TypeError', ['fetch', 'model']],
      ['a stage throws something that is not an Error', { fetchSite: async () => Promise.reject('just a string') }, 'fetch: string', []],
    ])('%s', async (_, broken, code, ranBefore) => {
      const { calls, mocks, deps } = stages(broken)
      await expect(runAuditJob(job, deps)).resolves.toBe('failed')
      expect(calls).toEqual([...ranBefore, 'failure mails'])
      expect(mocks.sendFailure).toHaveBeenCalledTimes(1)
      expect(mocks.sendFailure).toHaveBeenCalledWith(job, code)
      expect(loggedText(logs.error)).toContain(`[Audit] abcd1234 failed at ${code}`)
      expect(loggedText(logs.log)).not.toContain('completed')
      expectNoPii(logs, { includeLog: true })
    })

    // [RULE 8 / P3-11] once the report mail to the visitor was attempted, the visitor may have it: the failure goes to
    // the admin only, never a failure mail to the visitor as well
    it.each<[string, PipelineDeps, string]>([
      ['the report mails throw', { sendReport: async () => Promise.reject(new Error(`mail to ${LEAD.email} failed`)) }, 'email: Error'],
      ['the report does not reach the visitor', { sendReport: async () => ({ success: false, userSent: false, adminSent: false, error: 'user: 422 validation_error' }) }, 'email: StageFailure REPORT_NOT_SENT'],
      ['the report send times out', { sendReport: async () => ({ success: false, userSent: false, adminSent: false, error: 'user: timeout' }) }, 'email: StageFailure REPORT_NOT_SENT'],
    ])('%s: the admin is told, the visitor is not sent a failure mail', async (_, broken, code) => {
      const { calls, mocks, deps } = stages(broken)
      await expect(runAuditJob(job, deps)).resolves.toBe('failed')
      expect(calls).toEqual(['fetch', 'model', 'document', 'failure mails'])
      expect(mocks.sendFailure).toHaveBeenCalledTimes(1)
      expect(mocks.sendFailure).toHaveBeenCalledWith(job, code, { visitor: false })
      expect(loggedText(logs.error)).toContain(`[Audit] abcd1234 failed at ${code}`)
    })

    it('the report reaches the visitor but not the admin: that is a sent audit, with the admin failure logged as a code', async () => {
      const { calls, mocks, deps } = stages({ sendReport: async () => ({ success: false, userSent: true, adminSent: false, error: 'admin: 500 internal_server_error' }) })
      await expect(runAuditJob(job, deps)).resolves.toBe('sent')
      expect(calls).toEqual(['fetch', 'model', 'document'])
      expect(mocks.sendFailure).not.toHaveBeenCalled()
      expect(loggedText(logs.error)).toContain('[Audit] abcd1234 email failed: admin: 500 internal_server_error')
    })

    it('even the failure mails failing, or throwing, does not throw out of the job', async () => {
      const notSent = stages({ fetchSite: async () => Promise.reject(new UnsafeUrlError('HTTP_STATUS')), sendFailure: async () => ({ userSent: false, adminSent: false, errors: ['user: 500 x', 'admin: threw Error'] }) })
      await expect(runAuditJob(job, notSent.deps)).resolves.toBe('failed')
      expect(loggedText(logs.error)).toContain('[Audit] abcd1234 failure mail not sent: user: 500 x')
      expect(loggedText(logs.error)).toContain('[Audit] abcd1234 failure mail not sent: admin: threw Error')

      const throws = stages({ fetchSite: async () => Promise.reject(new UnsafeUrlError('HTTP_STATUS')), sendFailure: async () => Promise.reject(new TypeError(`mail broke for ${LEAD.email}`)) })
      await expect(runAuditJob(job, throws.deps)).resolves.toBe('failed')
      expect(loggedText(logs.error)).toContain('[Audit] abcd1234 failure mails threw: TypeError')
      expectNoPii(logs, { includeLog: true })
    })
  })
})

describe('the mails around a background audit', () => {
  const lead = { userEmail: 'zed"><script>@example.test', userName: '<b>Zed</b>', websiteUrl: 'https://x.example.test/"><script>alert(1)</script>', niche: 'home_care' as const, adminEmail: 'n.garrett@enclavellc.net' }

  it('the accept mail goes to the admin only, says an audit was requested, and escapes everything from the visitor', async () => {
    send.mockResolvedValue(resendOk())
    await expect(sendAcceptMail(lead)).resolves.toEqual({ sent: true })
    expect(send).toHaveBeenCalledTimes(1)
    const mail = send.mock.calls[0][0]
    expect(mail.to).toBe('n.garrett@enclavellc.net')
    expect(mail.subject).toBe('Audit requested')
    expect(mail.html).toContain('Audit requested. It is running now')
    expect(mail.html).toContain('<strong>Audit written for:</strong> home care agency')
    expect(mail.html).not.toContain('<script')
    expect(mail.html).not.toContain('<b>Zed</b>')
    expect(mail.html).toContain('&lt;b&gt;Zed&lt;/b&gt;')
    expect(mail.html).not.toMatch(/<a\b/i)
    expect(`${mail.subject}${mail.html.replace('<!DOCTYPE html>', '')}`).not.toContain('!')
  })

  it('the failure mails: one honest sentence to the visitor with no reason given, and the code to the admin', async () => {
    send.mockResolvedValue(resendOk())
    await expect(sendFailureMails(lead, 'fetch: UnsafeUrlError BLOCKED_ADDRESS')).resolves.toEqual({ userSent: true, adminSent: true, errors: [] })
    expect(send).toHaveBeenCalledTimes(2)
    const [visitor, admin] = send.mock.calls.map(([mail]) => mail)
    expect(visitor.to).toBe(lead.userEmail)
    expect(visitor.subject).toBe('About your website audit')
    expect(visitor.html).toContain('We could not finish your audit automatically. Nate has your request and will send it himself.')
    expect(visitor.html).not.toMatch(/BLOCKED|UnsafeUrl|fetch|code/)
    expect(visitor.html).toContain('Hi &lt;b&gt;Zed&lt;/b&gt;,')
    expect(admin.to).toBe('n.garrett@enclavellc.net')
    expect(admin.subject).toBe('Audit failed: run it by hand')
    expect(admin.html).toContain('<strong>Failure code:</strong> fetch: UnsafeUrlError BLOCKED_ADDRESS')
    expect(admin.html).toContain('The visitor has been told you will send it.')
    for (const mail of [visitor, admin]) {
      expect(mail.html).not.toContain('<script')
      expect(mail.html).not.toMatch(/<a\b/i)
      expect(mail.attachments).toBeUndefined()
      expect(`${mail.subject}${mail.html.replace('<!DOCTYPE html>', '')}`).not.toContain('!')
    }
  })

  it('each failure mail is attempted whatever happened to the other, and failures come back as codes without the addresses', async () => {
    send.mockRejectedValueOnce(new Error(`cannot reach ${lead.userEmail}`)).mockResolvedValueOnce(resendOk())
    const result = await sendFailureMails(lead, 'model: RangeError')
    expect(result).toEqual({ userSent: false, adminSent: true, errors: ['user: threw Error'] })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
