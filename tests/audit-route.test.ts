import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, expectNoPii, loggedText, postJson, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))
// the pipeline before the email step: no network, no AI call
vi.mock('@/lib/audit/fetch-website', () => ({
  validateUrl: () => ({ valid: true }),
  fetchWebsiteContent: vi.fn(async () => ({ homepage: '<html></html>' })),
}))
vi.mock('@/lib/audit/run-audit', () => ({ runAudit: vi.fn(async () => auditFixture) }))
vi.mock('@/lib/audit/generate-document', () => ({ generateAuditDocument: vi.fn(async () => Buffer.from('docx')) }))

import { POST } from '@/app/api/audit/generate/route'

const URL_ = 'http://localhost/api/audit/generate'
const body = { websiteUrl: SITE, userEmail: LEAD.email, userName: LEAD.name }

let logs: ReturnType<typeof spyLogs>
beforeEach(() => {
  send.mockReset()
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-placeholder-not-a-key')
  vi.stubEnv('RESEND_API_KEY', 're_test_placeholder_not_a_key')
  logs = spyLogs()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/audit/generate', () => {
  it('still reports success when both emails go out', async () => {
    send.mockResolvedValue(resendOk())
    const res = await POST(postJson(URL_, body))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it.each([
    ['returns an error', () => send.mockResolvedValue(resendErr())],
    ['throws', () => send.mockRejectedValue(new Error(`ECONNRESET sending to ${LEAD.email}`))],
  ])('is honest when the email step fails (Resend %s)', async (_, arrange) => {
    arrange()
    const res = await POST(postJson(URL_, body))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const text = await res.text()
    expect(text).not.toContain('is being generated')
    const json = JSON.parse(text)
    expect(json.success).toBe(false)
    expect(json.message).toBe('Your audit ran but we could not email it. Please contact n.garrett@enclavellc.net.')
    expect(json.requestId).toMatch(/^[0-9a-f]{8}$/)
    expect(loggedText(logs.error, logs.warn)).toContain(json.requestId)
    expectNoPii(logs)
  })
})
