import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, expectNoPii, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { sendAuditEmails } from '@/lib/audit/send-emails'

const options = () => ({
  document: Buffer.from('docx'),
  userEmail: LEAD.email,
  userName: LEAD.name,
  adminEmail: 'n.garrett@enclavellc.net',
  websiteUrl: SITE,
  auditResults: auditFixture,
})

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

function expectFailureWithoutPii(result: { success: boolean; error?: string }) {
  expect(result.success).toBe(false)
  expect(result.error).toBeTruthy()
  for (const v of [LEAD.email, LEAD.name, SITE]) expect(result.error).not.toContain(v)
  expectNoPii(logs)
}

describe('sendAuditEmails', () => {
  it('succeeds when both sends return an id', async () => {
    send.mockResolvedValue(resendOk())
    expect(await sendAuditEmails(options())).toEqual({ success: true })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('fails when the visitor send returns an error', async () => {
    send.mockResolvedValueOnce(resendErr()).mockResolvedValueOnce(resendOk())
    expectFailureWithoutPii(await sendAuditEmails(options()))
  })

  it('fails when the admin send returns an error', async () => {
    send.mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendErr(500, 'internal_server_error'))
    expectFailureWithoutPii(await sendAuditEmails(options()))
  })

  it('fails when a send throws, without logging what it threw', async () => {
    send.mockRejectedValue(new Error(`connect ECONNRESET while sending to ${LEAD.email} for ${SITE}`))
    expectFailureWithoutPii(await sendAuditEmails(options()))
  })
})
