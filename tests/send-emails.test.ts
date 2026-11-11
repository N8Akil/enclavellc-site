import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEAD, REPORT_SITE, SITE, auditFixture, expectNoPii, reportFixture, resendErr, resendOk, spyLogs } from './helpers'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { NOT_MEASURED_SENTENCE, UNSUPPORTED_SENTENCE } from '@/lib/audit/config'
import { LEAD_INS, evidenceLine } from '@/lib/audit/present'
import { sendAuditEmails } from '@/lib/audit/send-emails'
import { escapeHtml } from '@/lib/email/escape'
import type { AuditResults } from '@/lib/audit/types'

const options = () => ({
  document: new Uint8Array(Buffer.from('%PDF-1.7 report')),
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

  it('attaches the report as a PDF named after the site, to the visitor and to the admin copy', async () => {
    send.mockResolvedValue(resendOk())
    await sendAuditEmails(options())
    expect(send).toHaveBeenCalledTimes(2)
    for (const [mail] of send.mock.calls) {
      expect(mail.attachments).toEqual([
        { filename: 'pii-site.example.test-website-audit.pdf', content: Buffer.from('%PDF-1.7 report').toString('base64'), contentType: 'application/pdf' },
      ])
    }
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

  // [P3-11] the admin's copy says the report went out, so it is sent only once the visitor's report is confirmed;
  // otherwise the pipeline writes to the admin once, saying it was not confirmed
  it('[fold 1] reports which send went out: visitor no, so no admin copy either', async () => {
    send.mockResolvedValueOnce(resendErr()).mockResolvedValueOnce(resendOk())
    expect(await sendAuditEmails(options())).toMatchObject({ success: false, userSent: false, adminSent: false })
    expect(send).toHaveBeenCalledTimes(1)
  })

  // fold 2: everything user-supplied (or derived from the visitor's site) is escaped in both emails
  it('[fold 2] escapes the name, URL, email and audit text in both emails, and caps the name', async () => {
    send.mockResolvedValue(resendOk())
    const evilName = `<a href=x>Zed</a>"><script>alert(1)</script>${'x'.repeat(200)}`
    const evilUrl = 'https://inject.example.test/?q="><script>alert(2)</script>&r=<a href=x>'
    const evilAudit: AuditResults = {
      ...auditFixture,
      whereYouStand: '<a href=x>stand</a>',
      working: [{ title: '<a href=x>strength</a>', line: '<a href=x>line</a>', evidence: { kind: 'quote', pageUrl: `${SITE}/`, quote: '<a href=x>quoted</a> "><script>alert(4)</script>' } }],
      fixes: [{ ...auditFixture.fixes[0], headline: '"><script>alert(3)</script>', whatWeSaw: '<a href=x>saw</a>', evidence: { kind: 'measured', text: '<a href=x>measured</a>' } }],
      areas: [{ key: 'found', name: '<a href=x>cat</a>', assessed: true, score: 6, status: 'Needs Improvement', weight: 0.2, line: '<a href=x>area line</a>', findings: [] }, { key: 'speed', name: '<a href=x>speed</a>', assessed: false, reason: '<a href=x>reason</a>' }],
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

  describe('the five-area shape', () => {
    const visible = (html: string) => html.replace('<!DOCTYPE html>', '').replace(/<!--[\s\S]*?-->/g, '')
    const li = (html: string, start: string) => html.split('<li>').find((item) => item.startsWith(start)) ?? ''
    const sendBoth = async (auditResults: AuditResults = reportFixture) => {
      send.mockResolvedValue(resendOk())
      await sendAuditEmails({ ...options(), websiteUrl: REPORT_SITE, auditResults })
      return { visitor: send.mock.calls[0][0].html as string, admin: send.mock.calls[1][0].html as string }
    }

    it('an area that was not assessed shows its fixed sentence and no score; an assessed one shows its score and line', async () => {
      const { visitor: html } = await sendBoth()
      expect(li(html, '<strong>Found:</strong>')).toContain('8 of 10. Search engines can read you; your link looks bare when shared.')
      expect(li(html, '<strong>Two clear doors:</strong>')).toContain('5 of 10.')
      for (const [name, sentence] of [['Speed', NOT_MEASURED_SENTENCE], ['Trust', UNSUPPORTED_SENTENCE]]) {
        const item = li(html, `<strong>${name}:</strong>`)
        expect(item, name).toContain(sentence)
        expect(item, name).not.toMatch(/\d\s*(\/|of)\s*10/)
      }
      expect(html).not.toMatch(/>\s*0(\.0)?\s*(\/|of)\s*10/)
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('Clear next step')

      // the score is labelled as covering the assessed areas only; the sentence on where they stand is there
      expect(html).toContain('Score for the three areas assessed: 7.2 of 10')
      expect(html).toContain('Families can reach you in one tap; caregivers cannot find where to apply.')
      expect(html).not.toMatch(/Overall Score|8 key areas|action plan/i)
      expect(html).toContain('How this was made and what it does not cover')
    })

    it('[ruling 1] every strength and every fix in the visitor email is printed with what it rests on, under exactly one lead-in', async () => {
      const { visitor: html } = await sendBoth()
      const claims = [
        ...reportFixture.working.map((w) => ({ start: `<strong>${escapeHtml(w.title)}:</strong>`, evidence: w.evidence })),
        ...reportFixture.fixes.map((f) => ({ start: `<strong>${escapeHtml(f.headline)}</strong>`, evidence: f.evidence })),
      ]
      expect(claims).toHaveLength(5)
      for (const { start, evidence } of claims) {
        const item = li(html, start)
        expect(item, start).not.toBe('')
        expect(item).toContain(escapeHtml(evidenceLine(evidence)))
        expect(LEAD_INS.filter((leadIn) => item.includes(leadIn)), start).toHaveLength(1)
      }
      // each lead-in in the mail belongs to one of those claims: nothing else is dressed as evidence
      const total = LEAD_INS.reduce((sum, leadIn) => sum + (html.split(leadIn).length - 1), 0)
      expect(total).toBe(5)
      expect(html).toContain('Looked for on the pages read, not found: a careers or apply link')
      expect(html).toContain('Counted on your pages: your home page title is 96 characters long')
      expect(html).not.toContain('Measured:')
    })

    it('a quote containing <script>, a tag or a double quote is escaped, and shown with its page path', async () => {
      const { visitor, admin } = await sendBoth()
      expect(visitor).toContain('Your page says: “Call now &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; save today” (on /)')
      expect(visitor).toContain('“Ask us about &lt;b&gt;payment&lt;/b&gt; options today” (on /services?x=1)')
      for (const html of [visitor, admin]) {
        expect(html).not.toContain('<script')
        expect(html).not.toContain('alert("x")')
        expect(html).not.toContain('<b>payment</b>')
      }
    })

    it('[7d] neither email makes a link out of the visitor\'s URL: it is shown as text only', async () => {
      send.mockResolvedValue(resendOk())
      const url = 'https://pii-site.example.test/a-path-the-visitor-chose'
      await sendAuditEmails({ ...options(), websiteUrl: url, auditResults: reportFixture })
      expect(send).toHaveBeenCalledTimes(2)
      for (const [mail] of send.mock.calls) {
        expect(mail.html).toContain(url)
        const hrefs = [...(mail.html as string).matchAll(/href\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1])
        for (const href of hrefs) {
          expect(href).not.toContain('pii-site')
          expect(href).toMatch(/^(https:\/\/enclavellc\.net(\/|$)|mailto:)/)
        }
        expect(mail.html).not.toMatch(/<a\b[^>]*>[^<]*pii-site/i)
      }
      // the admin email still shows the address, as words
      expect(send.mock.calls[1][0].html).toMatch(/<strong>Website:<\/strong>\s*https:\/\/pii-site\.example\.test\/a-path-the-visitor-chose/)
    })

    it('the admin email ranks only assessed areas, names the niche and says what the score covers', async () => {
      const { admin: html } = await sendBoth()
      expect(html).toContain('<strong>Highest Score:</strong> Found (8)')
      expect(html).toContain('<strong>Lowest Score:</strong> Two clear doors (5)')
      expect(html).toContain('<strong>Audit written for:</strong> a home care agency')
      expect(html).toContain('<strong>Fixes listed:</strong> 3')
      expect(html).toContain('<strong>Score covers:</strong> the three areas assessed')
      expect(html).toContain('<strong>Not assessed:</strong> Speed, Trust')
      expect(html).toContain('<strong>Findings removed (evidence did not check out):</strong> 2')
    })

    it('no exclamation mark was added: the only ones left are the three in the copy that was already there', async () => {
      await sendBoth()
      const [[visitorMail], [adminMail]] = send.mock.calls
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

describe('[RULE 8] every mail has a time limit: a hung send is a failed send with a code', () => {
  afterEach(() => vi.useRealTimers())

  it(`a report send that never answers fails after ${20} seconds with "timeout", and no admin copy goes out`, async () => {
    vi.useFakeTimers()
    send.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(resendOk())
    const pending = sendAuditEmails(options())
    await vi.advanceTimersByTimeAsync(19_999)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ success: false, userSent: false, adminSent: false, error: 'user: timeout' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('the accept, failure and lead mails have the same limit', async () => {
    const { sendAcceptMail, sendFailureMails, MAIL_TIMEOUT_MS } = { ...(await import('@/lib/audit/notify')), ...(await import('@/lib/audit/mail')) }
    const { sendPreviewLead } = await import('@/lib/audit/preview')
    expect(MAIL_TIMEOUT_MS).toBe(20_000)
    vi.useFakeTimers()
    send.mockReturnValue(new Promise(() => {}))
    const lead = { userEmail: LEAD.email, userName: LEAD.name, websiteUrl: SITE, niche: 'general' as const, adminEmail: 'n.garrett@enclavellc.net' }
    const accept = sendAcceptMail(lead)
    const preview = sendPreviewLead(lead)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await accept).toEqual({ sent: false, error: 'admin: timeout' })
    expect(await preview).toEqual({ sent: false, error: 'admin: timeout' })
    const failure = sendFailureMails(lead, 'fetch: x')
    await vi.advanceTimersByTimeAsync(40_000)
    expect(await failure).toEqual({ userSent: false, adminSent: false, errors: ['user: timeout', 'admin: timeout'] })
  })

  it('a send that rejects after its time limit does not become an unhandled rejection', async () => {
    vi.useFakeTimers()
    let reject: (e: Error) => void = () => {}
    send.mockReturnValueOnce(new Promise((_, r) => (reject = r)))
    const { sendMail } = await import('@/lib/audit/mail')
    const pending = sendMail('user', { from: 'a@b.test', to: 'c@d.test', subject: 's', html: 'h' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await pending).toEqual({ sent: false, error: 'user: timeout' })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    reject(new Error('late'))
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})

describe('[P3-14] the score colour follows the status label', () => {
  it.each([
    [7.5, 'Good', '#27AE60'],
    [9.1, 'Excellent', '#27AE60'],
    [5.5, 'Needs Improvement', '#F39C12'],
    [6.9, 'Needs Improvement', '#F39C12'],
    [4.9, 'Critical', '#C0392B'],
  ] as const)('%s (%s) is %s', async (overallScore, overallStatus, colour) => {
    send.mockResolvedValue(resendOk())
    await sendAuditEmails({ ...options(), websiteUrl: REPORT_SITE, auditResults: { ...reportFixture, overallScore, overallStatus } })
    // the visitor's score badge, and the score in the admin's copy
    expect(send.mock.calls[0][0].html).toContain(`background-color: ${colour}; color: white; font-size: 48px`)
    expect(send.mock.calls[1][0].html).toContain(`<span style="color: ${colour}; font-weight: bold; font-size: 18px;">`)
  })
})
