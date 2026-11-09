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
  fetchWebsiteContent: vi.fn(async () => ({ homepage: '<html></html>' })),
}))
vi.mock('@/lib/audit/run-audit', () => ({ runAudit: vi.fn(async () => auditFixture) }))
vi.mock('@/lib/audit/generate-document', () => ({ generateAuditDocument: vi.fn(async () => Buffer.from('docx')) }))

import { POST } from '@/app/api/audit/generate/route'
import { fetchWebsiteContent } from '@/lib/audit/fetch-website'
import { runAudit } from '@/lib/audit/run-audit'
import { generateAuditDocument } from '@/lib/audit/generate-document'

const URL_ = 'http://localhost/api/audit/generate'
const body = { websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name }
const SENT = `Your audit has been emailed to ${LEAD.email}. Check your inbox in 2-3 minutes.`
const NOT_SENT = 'Your audit ran but we could not email it. Please contact n.garrett@enclavellc.net.'

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.mocked(runAudit).mockClear()
  vi.mocked(fetchWebsiteContent).mockClear()
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  logs = spyLogs()
})
afterEach(() => {
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
})
