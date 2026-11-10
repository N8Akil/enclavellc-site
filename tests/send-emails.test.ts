import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, SITE, auditFixture, expectNoPii, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { NOT_ASSESSED_SENTENCE, UNASSESSED_CATEGORIES, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { sendAuditEmails } from '@/lib/audit/send-emails'
import type { AuditResults } from '@/lib/audit/types'

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
      criticalIssues: [{ title: '"><script>alert(3)</script>', description: '', impact: '', evidence: auditFixture.criticalIssues[0].evidence }],
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

  describe('the new result shape', () => {
    const SCORE_LINE = 'Score for the two areas read: 6.4 of 10'
    const shaped = (): AuditResults => ({
      ...auditFixture,
      categories: [
        auditFixture.categories[0],
        { key: 'seo', name: 'SEO Fundamentals', assessed: true, score: 7, status: 'Good', weight: 0.25, findings: [], recommendations: [] },
        { key: 'trust_signals', name: 'Trust Signals', assessed: false, reason: UNSUPPORTED_SENTENCE },
        ...UNASSESSED_CATEGORIES.map((name) => ({ name, assessed: false as const, reason: NOT_ASSESSED_SENTENCE })),
      ],
      criticalIssues: [
        { title: 'Loud banner', description: 'd', impact: 'i', evidence: { pageUrl: `${SITE}/offers`, quote: 'Save <script>alert("now")</script> today' } },
        { title: 'No description', description: 'd', impact: 'i', evidence: { pageUrl: `${SITE}/about`, absent: 'a meta description' } },
      ],
      droppedFindings: 3,
    })
    const li = (html: string, name: string) => html.split('<li>').find((item) => item.startsWith(`<strong>${name}:</strong>`)) ?? ''

    it('an area that was not assessed shows the fixed sentence and no score, in the visitor email', async () => {
      send.mockResolvedValue(resendOk())
      await sendAuditEmails({ ...options(), auditResults: shaped() })
      const html: string = send.mock.calls[0][0].html

      expect(li(html, 'Content Quality')).toContain('6 of 10')
      expect(li(html, 'SEO Fundamentals')).toContain('7 of 10')
      for (const name of UNASSESSED_CATEGORIES) {
        const item = li(html, name.replace('&', '&amp;'))
        expect(item, name).toContain(NOT_ASSESSED_SENTENCE)
        expect(item, name).not.toMatch(/\d\s*(\/|of)\s*10/)
      }
      const leftOut = li(html, 'Trust Signals')
      expect(leftOut).toContain(UNSUPPORTED_SENTENCE)
      expect(leftOut).not.toMatch(/\d\s*(\/|of)\s*10/)
      expect(html).not.toMatch(/>\s*0(\.0)?\s*(\/|of)\s*10/)
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('NaN')

      // the score is labelled as covering the assessed areas only, and the old "8 key areas" claim is gone
      expect(html).toContain(SCORE_LINE)
      expect(html).not.toMatch(/Overall Score|8 key areas/)
      expect(html).toContain('How this was made and what it does not cover')
      expect(html).toContain('It does not compare your site with competitors')
    })

    it('a quote containing <script> or a double quote is escaped, and shown with its page path', async () => {
      send.mockResolvedValue(resendOk())
      await sendAuditEmails({ ...options(), auditResults: shaped() })
      const html: string = send.mock.calls[0][0].html
      expect(html).toContain('On /offers: \u201CSave &lt;script&gt;alert(&quot;now&quot;)&lt;/script&gt; today\u201D')
      expect(html).toContain('Looked for: a meta description, not found on /about')
      for (const [mail] of send.mock.calls) {
        expect(mail.html).not.toContain('<script')
        expect(mail.html).not.toContain('alert("now")')
      }
    })

    it('the admin email ranks only assessed areas and says what the score covers', async () => {
      send.mockResolvedValue(resendOk())
      await sendAuditEmails({ ...options(), auditResults: shaped() })
      const html: string = send.mock.calls[1][0].html
      expect(html).toContain('<strong>Highest Score:</strong> SEO Fundamentals (7)')
      expect(html).toContain('<strong>Lowest Score:</strong> Content Quality (6)')
      expect(html).toContain('<strong>Score covers:</strong> the two areas read')
      expect(html).toContain('Visual Design &amp; Branding')
      expect(html).toContain('<strong>Findings removed (evidence did not check out):</strong> 3')
    })

    it('no exclamation mark was added: the only ones left are the three in the copy that was already there', async () => {
      send.mockResolvedValue(resendOk())
      await sendAuditEmails({ ...options(), auditResults: shaped() })
      const [[visitorMail], [adminMail]] = send.mock.calls
      const visible = (html: string) => html.replace('<!DOCTYPE html>', '').replace(/<!--[\s\S]*?-->/g, '')
      const visitorText = `${visitorMail.subject}\n${visible(visitorMail.html)}`
      const existing = ['is Ready!', 'Your Website Audit is Ready!', 'Great news!']
      expect(visitorText.split('!').length - 1).toBe(existing.length)
      for (const phrase of existing) expect(visitorText).toContain(phrase)
      expect(`${adminMail.subject}\n${visible(adminMail.html)}`).not.toContain('!')
    })
  })

  it('fails when a send throws, without logging what it threw', async () => {
    send.mockRejectedValue(new Error(`connect ECONNRESET while sending to ${LEAD.email} for ${SITE}`))
    expectFailureWithoutPii(await sendAuditEmails(options()))
  })
})
