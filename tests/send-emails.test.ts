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
    expect(await sendAuditEmails(options())).toEqual({ success: true, userSent: true, adminSent: true })
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

  // fold 1: the route needs to know which send went out
  it('[fold 1] reports which send went out: visitor yes, admin no', async () => {
    send.mockResolvedValueOnce(resendOk()).mockResolvedValueOnce(resendErr(500, 'internal_server_error'))
    expect(await sendAuditEmails(options())).toMatchObject({ success: false, userSent: true, adminSent: false })
  })

  it('[fold 1] reports which send went out: visitor no, admin yes', async () => {
    send.mockResolvedValueOnce(resendErr()).mockResolvedValueOnce(resendOk())
    expect(await sendAuditEmails(options())).toMatchObject({ success: false, userSent: false, adminSent: true })
  })

  // fold 2: everything user-supplied (or derived from the visitor's site) is escaped in both emails
  it('[fold 2] escapes the name, URL, email and audit text in both emails, and caps the name', async () => {
    send.mockResolvedValue(resendOk())
    const evilName = `<a href=x>Zed</a>"><script>alert(1)</script>${'x'.repeat(200)}`
    const evilUrl = 'https://inject.example.test/?q="><script>alert(2)</script>&r=<a href=x>'
    const evilAudit = {
      ...auditFixture,
      topStrengths: [{ title: '<a href=x>strength</a>', description: '' }],
      criticalIssues: [{ title: '"><script>alert(3)</script>', description: '', impact: '' }],
      categories: [{ ...auditFixture.categories[0], name: '<a href=x>cat</a>' }],
    }
    await sendAuditEmails({ ...options(), userName: evilName, websiteUrl: evilUrl, userEmail: 'zed"><script>@example.test', auditResults: evilAudit })
    expect(send).toHaveBeenCalledTimes(2)
    for (const [mail] of send.mock.calls) {
      expect(mail.html).not.toContain('<script')
      expect(mail.html).not.toContain('<a href=x')
      expect(mail.html).not.toContain('x'.repeat(101))
      expect(mail.html).toContain('&lt;script&gt;')
      expect(mail.html).toContain('&lt;a href=x&gt;')
    }
  })

  it('fails when a send throws, without logging what it threw', async () => {
    send.mockRejectedValue(new Error(`connect ECONNRESET while sending to ${LEAD.email} for ${SITE}`))
    expectFailureWithoutPii(await sendAuditEmails(options()))
  })
})
